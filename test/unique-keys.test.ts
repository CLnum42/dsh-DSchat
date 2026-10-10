/**
 * Message-identity tests: a chat may not hold two messages with one id, and the
 * panel must render correctly even if it somehow does.
 *
 * The bug these pin: a stored duplicate id made React's keyed reconciliation
 * drop a child, so the previous conversation's answer was never removed from
 * the DOM. It stayed visible ABOVE the brand-new chat's empty state — the
 * "开新会话却还留着旧聊天记录" report. Nothing threw and nothing logged; the
 * transcript was still correct, only the DOM leaked.
 *
 * Two layers are therefore guarded separately, because a revert of either one
 * re-opens the hole in a different way:
 *
 *   store  — the invariant (unique ids per chat), healed at load and at import;
 *   panel  — the rendering, which must survive an id collision regardless.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Bundle the store so the test exercises the shipped source, not a copy. */
async function loadStore() {
  const dir = mkdtempSync(join(tmpdir(), 'dschat-store-'))
  const outfile = join(dir, 'store.mjs')
  await build({
    entryPoints: [join(root, 'src/store.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { ...mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Write a store file whose one chat holds the given messages. */
function seed(dir: string, messages: unknown[]): string {
  writeFileSync(join(dir, 'transcripts.json'), JSON.stringify({
    version: 1,
    activeChatId: 'c1',
    chats: [{
      id: 'c1', title: 't', createdAt: 1, updatedAt: 1, model: 'deepseek-chat', streaming: false, messages,
    }],
  }))
  return join(dir, 'transcripts.json')
}

test('the store drops the same message stored twice and re-ids genuine collisions', async (t) => {
  const { TranscriptStore, cleanup } = await loadStore()
  t.after(cleanup)
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-store-data-'))
  t.after(() => rmSync(dataDir, { recursive: true, force: true }))

  const twice = { id: 'X', role: 'assistant', content: 'same bytes', ts: 5 }
  seed(dataDir, [
    { id: 'a', role: 'user', content: 'q', ts: 1 },
    twice,
    // Same id, DIFFERENT content: two real messages that collided, not a copy.
    { id: 'X', role: 'assistant', content: 'different', ts: 9 },
    twice,
    { id: '', role: 'assistant', content: 'no id at all', ts: 2 },
  ])

  const store = new TranscriptStore({ dataDir })
  const messages = store.getChat('c1').messages

  // 5 records in: the byte-identical copy is gone, everything else survives.
  assert.equal(messages.length, 4, 'the exact duplicate record is dropped')
  assert.deepEqual(messages.map(message => message.content), ['q', 'same bytes', 'different', 'no id at all'])

  const ids = messages.map(message => message.id)
  assert.equal(new Set(ids).size, ids.length, 'every message carries its own id')
  assert.ok(ids.every(id => typeof id === 'string' && id !== ''), 'no empty id survives')

  // The repair is durable, not just an in-memory view: a second load (a restart)
  // must not have to fix the same file again.
  store.flush()
  const onDisk = JSON.parse(readFileSync(join(dataDir, 'transcripts.json'), 'utf8')) as {
    chats: Array<{ messages: Array<{ id: string }> }>
  }
  const diskIds = onDisk.chats[0]!.messages.map(message => message.id)
  assert.equal(new Set(diskIds).size, diskIds.length, 'the healed ids were persisted')
})

test('a healthy store is not rewritten just for being opened', async (t) => {
  const { TranscriptStore, cleanup } = await loadStore()
  t.after(cleanup)
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-store-clean-'))
  t.after(() => rmSync(dataDir, { recursive: true, force: true }))

  const file = seed(dataDir, [
    { id: 'a', role: 'user', content: 'q', ts: 1 },
    { id: 'b', role: 'assistant', content: 'a', ts: 2 },
  ])
  const before = readFileSync(file, 'utf8')
  new TranscriptStore({ dataDir })
  // No flush(): a load that needed no repair must not have armed a write at all.
  assert.equal(readFileSync(file, 'utf8'), before, 'an untouched store stays byte-identical')
})

test('importTranscript repairs ids it is handed', async (t) => {
  const { TranscriptStore, cleanup } = await loadStore()
  t.after(cleanup)
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-store-import-'))
  t.after(() => rmSync(dataDir, { recursive: true, force: true }))

  const store = new TranscriptStore({ dataDir })
  // A recover / 「撤销」 payload that reuses one id, plus a record with none.
  const imported = store.importTranscript({
    title: '导入的对话',
    model: 'deepseek-chat',
    messages: [
      { id: 'dup', role: 'user', content: '问题', ts: 1 },
      { id: 'dup', role: 'assistant', content: '另一个回复', ts: 2 },
      { id: '', role: 'assistant', content: '没有 id', ts: 3 },
    ] as never,
  })
  const ids = imported.chat.messages.map(message => message.id)
  assert.equal(imported.chat.messages.length, 3, 'no content is lost to the repair')
  assert.equal(new Set(ids).size, 3, 'imported messages get distinct ids')
  assert.ok(ids.every(id => typeof id === 'string' && id !== ''))
})

test('the panel keys every message distinctly even when the ids collide', async (t) => {
  // threadKeys is the panel's own guard: it must produce unique keys for ANY
  // input, because the store repair cannot cover a file that never went
  // through it. Guarded here as a pure function, and again through the real
  // component in the browser test below.
  // The bundle lives INSIDE the package (not the OS temp dir) so its `react`
  // import resolves against this package's own node_modules — a file under
  // /var/folders cannot see them, and the panel module imports React.
  const dir = mkdtempSync(join(root, '.tmp-thread-keys-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const entry = join(dir, 'entry.tsx')
  writeFileSync(entry, `
    export { threadKeys } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
  `, 'utf8')
  const outfile = join(dir, 'keys.mjs')
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    logLevel: 'silent',
  })
  const { threadKeys } = await import(pathToFileURL(outfile).href) as {
    threadKeys: (messages: Array<{ id: string }>) => string[]
  }

  // The shape that caused the leak: three records, one id shared by two.
  const keys = threadKeys([{ id: 'a' }, { id: 'b' }, { id: 'a' }])
  assert.equal(new Set(keys).size, keys.length, 'duplicate ids still yield unique keys')
  assert.deepEqual(keys, ['a', 'b', 'a#2'], 'the first occurrence keeps the plain id')

  // Three of a kind, an empty id, and a pathological id that looks like a
  // suffixed one — none may produce a repeated key.
  const nasty = threadKeys([{ id: 'x' }, { id: 'x' }, { id: 'x' }, { id: 'x#2' }, { id: '' }])
  assert.equal(new Set(nasty).size, nasty.length, 'a suffixed id cannot be forged into a collision')

  // Stable while the list is unchanged: a re-render must not renumber keys.
  assert.deepEqual(threadKeys([{ id: 'a' }, { id: 'b' }, { id: 'a' }]), keys)
})

test('switching to a new chat leaves no message node behind (real browser)', async (t) => {
  const { chromium } = await import('playwright-core')
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }

  const dir = mkdtempSync(join(root, '.tmp-unique-keys-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  try {
    writeFileSync(join(dir, 'entry.tsx'), `
      import { createElement } from 'react'
      import { createRoot } from 'react-dom/client'
      import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
      import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
      import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

      window.__mount = (initial) => {
        const style = document.createElement('style')
        style.textContent = PANEL_CSS
        document.head.appendChild(style)
        let state = initial
        const ok = async (extra) => ({ ok: true, ...extra })
        const pending = () => new Promise(() => undefined)
        const api = {
          state: async () => ({
            ok: true,
            ...state,
            engine: 'ready', loggedIn: true, deepThink: true, search: true, busy: false,
            chats: state.chats.map(({ messages: own, ...summary }) => ({ ...summary, messageCount: own.length })),
          }),
          chat: async (id) => {
            const wanted = id ?? state.activeChatId
            const chat = state.chats.find(candidate => candidate.id === wanted) ?? state.chats[0]
            return ok({ chat: { ...chat, messages: [...chat.messages] } })
          },
          tail: async () => ok({ busy: false, streaming: false }),
          context: async () => ok({ workspaces: [], cwd: '/' }),
          newChat: async () => {
            const fresh = { id: 'chat-new', title: '新的对话', createdAt: Date.now(), updatedAt: Date.now(), model: 'deepseek-reasoner', messages: [], streaming: false }
            state = { ...state, chats: [fresh, ...state.chats], activeChatId: 'chat-new' }
            return ok({ chatId: 'chat-new' })
          },
          send: pending, stop: pending, wake: pending, openLogin: pending, closeBrowser: pending,
          setDeepThink: pending, setSearch: pending, transfer: pending, exportFile: pending,
          renameChat: pending, deleteChat: pending, clearChats: pending, webChats: pending,
          recover: pending, restore: pending, attach: pending,
        }
        const tt = (key) => zh[key] ?? key
        createRoot(document.getElementById('seat')).render(createElement(DSchatPanel, {
          api, tt, t: tt,
          openSession: async () => true,
          pickDirectory: async () => null,
          createWorkspace: async () => ({ workspaceId: 'w', title: 'w' }),
        }))
      }
    `, 'utf8')

    const outfile = join(dir, 'ui.mjs')
    await build({
      entryPoints: [join(dir, 'entry.tsx')],
      outfile,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      target: ['chrome120'],
      logLevel: 'silent',
    })

    const now = Date.now()
    /*
     * The exact corruption seen in a real store: the SAME reply recorded twice
     * under one id. The panel is handed it directly — no store in the path — so
     * this asserts the rendering guard on its own, which is what has to hold
     * for a hand-edited file or any future importer that skips the repair.
     */
    const duplicate = { id: 'dup-1', role: 'assistant', ts: now - 3000, content: '### 旧的回复\n\n- 一\n- 二\n' }
    const chat = {
      id: 'chat-a', title: '旧的对话', createdAt: now - 60000, updatedAt: now - 1000,
      model: 'deepseek-reasoner', streaming: false,
      messages: [
        { id: 'u1', role: 'user', ts: now - 9000, content: '问一句' },
        { id: 'dup-1', role: 'assistant', ts: now - 8000, content: '第一条，id 与最后一条相同。' },
        duplicate,
      ],
    }

    const page = join(dir, 'index.html')
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8">
      <style>html,body{margin:0;height:100%}#seat{width:1200px;height:800px}</style></head>
      <body><div id="seat"></div>
      <script>${readFileSync(outfile, 'utf8')}</script>
      <script>window.__mount(${JSON.stringify({ chats: [chat], activeChatId: 'chat-a' })})</script>
      </body></html>`, 'utf8')

    const view = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const reactErrors: string[] = []
    view.on('console', message => {
      const text = message.text()
      if (message.type() === 'error' && text.includes('same key')) reactErrors.push(text)
    })
    await view.goto(`file://${page}`, { waitUntil: 'load' })
    await view.waitForSelector('.dsh-dschat-thread', { timeout: 15_000 })
    await view.waitForTimeout(500)
    await view.screenshot({ path: join(dir, 'before.png') })

    const before = await view.evaluate(() => ({
      messages: document.querySelectorAll('.dsh-dschat-msg').length,
      empty: document.querySelectorAll('.dsh-dschat-empty').length,
    }))
    assert.deepEqual(before, { messages: 3, empty: 0 }, 'the old chat renders its three messages')

    /*
     * Start a new chat — the action that exposed the leak.
     *
     * The button lives in the composer's ACTION ROW now (it used to be in the
     * header): 会话列表, 搜索, 新建对话. Selected by its accessible name rather
     * than by position, so a future reordering cannot silently click the wrong
     * control.
     */
    await view.locator('.dsh-dschat-actions button[title*="新对话"]').click()
    await view.waitForTimeout(1500)
    await view.screenshot({ path: join(dir, 'after.png') })

    const after = await view.evaluate(() => {
      const empty = document.querySelector('.dsh-dschat-empty')
      const inner = document.querySelector('.dsh-dschat-thread-inner')
      return {
        messages: document.querySelectorAll('.dsh-dschat-msg').length,
        empty: document.querySelectorAll('.dsh-dschat-empty').length,
        strayInsideEmpty: empty === null ? -1 : empty.querySelectorAll('.dsh-dschat-msg').length,
        children: inner === null ? [] : [...inner.children].map(child => child.className),
      }
    })
    /*
     * The assertions are about what the reader SEES, not about an internal
     * field: no message may remain anywhere in the thread, and in particular
     * none may be nested inside the empty state — that nesting is exactly what
     * put the old answer above 「在 DSH 里直接聊 DeepSeek 网页端」.
     */
    assert.equal(after.messages, 0, 'no message node survives the switch to a new chat')
    assert.equal(after.empty, 1, 'the new chat shows its empty state')
    assert.equal(after.strayInsideEmpty, 0, 'the empty state contains no orphaned message')
    assert.ok(after.children.includes('dsh-dschat-empty'), 'the thread holds the empty state')
    assert.ok(
      !after.children.some(cls => cls.includes('dsh-dschat-msg')),
      'the thread holds nothing but the empty state',
    )
    // React must not have been reduced to warning about the collision either:
    // the panel is supposed to hand it unique keys, not survive a known-bad one.
    assert.deepEqual(reactErrors, [], 'React never warns about duplicate keys')
  } finally {
    await browser.close()
  }
})
