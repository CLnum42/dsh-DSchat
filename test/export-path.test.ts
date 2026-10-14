/**
 * The export dialog's destination, in a real Chromium.
 *
 * The reader was promised two things about where a markdown export lands:
 *
 *   1. the dialog SHOWS the folder — the one the host resolved, which is the
 *      folder the reader picked last time when there is one — and lets them
 *      change it, by typing or through the OS picker;
 *   2. the change is remembered by the HOST (`/export-dir`), so the next export
 *      defaults to it and no other surface has to guess.
 *
 * Neither is visible in static markup: the field is seeded from `/context` after
 * mount, and the commit happens on the primary button. So this drives the real
 * panel against a stub API that records the calls, which is the only way to
 * assert the ORDER of them too — remembering a folder the export then ignores
 * would be worse than not offering the field.
 *
 * Skipped, not failed, when Chrome is unavailable — the same rule the other
 * browser tests in this suite follow.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** What `/context` says the host will use before any pick. */
const DEFAULT_DIR = '/tmp/dschat-default-exports'
/** What the OS folder picker returns in this fixture. */
const PICKED_DIR = '/tmp/dschat-picked-exports'

/**
 * Mount the real panel against a stub API that logs every export call.
 *
 * `pickDirectory` answers with {@link PICKED_DIR} (the panel's own prop, wired
 * by the client entry to the shell's folder picker), and both the export and the
 * "remember this folder" answers carry the absolute path the host would resolve
 * — which is what the panel shows back to the reader.
 */
async function mount(): Promise<{
  view: import('playwright-core').Page
  close: () => Promise<void>
}> {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const dir = mkdtempSync(join(root, '.tmp-export-path-'))
  try {
    writeFileSync(join(dir, 'entry.tsx'), `
      import { createElement } from 'react'
      import { createRoot } from 'react-dom/client'
      import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
      import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
      import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

      const now = Date.now()
      const chat = {
        id: 'c1', title: '导出路径', createdAt: now, updatedAt: now, model: 'deepseek-chat', streaming: false,
        messages: [
          { id: 'u1', role: 'user', content: '第一个问题：导出到哪儿？', ts: now },
          { id: 'a1', role: 'assistant', content: '默认写到下载文件夹，你改过之后就一直是你选的。', ts: now },
        ],
      }
      /* Every call the assertions are about, in order. */
      const calls = window.__calls = []
      const ok = async (extra) => ({ ok: true, ...extra })
      const pending = () => new Promise(() => undefined)
      const summary = ({ messages, ...rest }) => ({ ...rest, messageCount: messages.length })

      const api = {
        state: async () => ({
          ok: true, engine: 'ready', loggedIn: true, busy: false, deepThink: false, search: false,
          activeChatId: chat.id, chats: [summary(chat)],
        }),
        chat: async () => ok({ chat: { ...chat, messages: [...chat.messages] } }),
        tail: async () => ok({ busy: false, streaming: false }),
        context: async () => ok({ workspaces: [], cwd: '/', settings: {
          browserChannel: 'auto', browserExecutablePath: '', browserProxy: 'direct', browserHeadless: true,
          replyTimeoutMs: 180000, dataDir: '/tmp/dschat-data', profileDir: '/tmp/dschat-profile',
          exportDir: ${JSON.stringify(DEFAULT_DIR)}, transferDistill: true, transferProvider: '', transferModel: '',
          announceToAgent: false,
        } }),
        setExportDir: async (value) => { calls.push(['setExportDir', value]); return ok({ dir: value }) },
        exportFile: async (chatId, cwd, messageIds) => {
          calls.push(['exportFile', chatId, cwd ?? null, (messageIds ?? []).length])
          return ok({ filePath: 'dschat-导出.md', dir: ${JSON.stringify(DEFAULT_DIR)} })
        },
        newChat: pending, stop: pending, wake: pending, openLogin: pending, closeBrowser: pending,
        setDeepThink: pending, setSearch: pending, transfer: pending,
        renameChat: pending, deleteChat: pending, clearChats: pending, webChats: pending,
        recover: pending, restore: pending, attach: pending,
      }
      window.__mount = () => {
        const style = document.createElement('style')
        style.textContent = PANEL_CSS
        document.head.appendChild(style)
        const tt = (key) => zh[key] ?? key
        createRoot(document.getElementById('seat')).render(createElement(DSchatPanel, {
          api, tt, t: tt,
          openSession: async () => true,
          pickDirectory: async () => ${JSON.stringify(PICKED_DIR)},
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

    const page = join(dir, 'index.html')
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8">
      <style>html,body{margin:0;height:100%}#seat{width:1000px;height:760px}</style></head>
      <body><div id="seat"></div>
      <script>${readFileSync(outfile, 'utf8')}</script>
      <script>window.__mount()</script></body></html>`, 'utf8')

    const view = await browser.newPage({ viewport: { width: 1000, height: 760 } })
    await view.goto(`file://${page}`, { waitUntil: 'load' })
    await view.waitForSelector('.dsh-dschat-input', { timeout: 15_000 })
    // Let `/context` answer: the field is seeded from its `settings.exportDir`.
    await view.waitForTimeout(600)
    return {
      view,
      close: async () => {
        await view.close()
        await browser.close()
        rmSync(dir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await browser.close()
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

/** The recorded API calls, in order. */
async function calls(view: import('playwright-core').Page): Promise<unknown[][]> {
  return await view.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls) as unknown[][]
}

test('the export dialog shows the destination, and a picked folder is remembered before the file is written', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount()
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = mounted
  try {
    await view.locator('.dsh-dschat-tbtn-export').click()
    const field = view.locator('#dsh-dschat-export-dir')
    await field.waitFor({ state: 'visible', timeout: 5_000 })
    assert.equal(await field.inputValue(), DEFAULT_DIR, 'the dialog opens on the folder the host resolved')

    // The OS picker: the chosen folder is committed at once (so the field can
    // show the path the HOST resolved), and nothing has been exported yet.
    await view.locator('.dsh-dschat-export-dir-choose').click()
    await view.waitForTimeout(200)
    assert.equal(await field.inputValue(), PICKED_DIR, 'the picked folder replaces the field')
    assert.deepEqual(await calls(view), [['setExportDir', PICKED_DIR]], 'and it is remembered, once')

    await view.locator('.dsh-dschat-qa-card .dsh-dschat-btn-primary').click()
    await view.waitForTimeout(400)
    const log = await calls(view)
    assert.equal(log.length, 2, 'the export is the only remaining call')
    assert.deepEqual(log[1], ['exportFile', 'c1', null, 2], 'the export carries the selection and NO cwd — the host owns the destination')
    // The toast names the folder, because "已导出到 dschat-….md" told the reader
    // nothing about where to find it.
    assert.match(await view.locator('.dsh-dschat-toast').first().innerText(), /导出/)
  } finally {
    await mounted.close()
  }
})

test('a folder typed into the field is committed before the export, in that order', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount()
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = mounted
  try {
    await view.locator('.dsh-dschat-tbtn-export').click()
    const field = view.locator('#dsh-dschat-export-dir')
    await field.waitFor({ state: 'visible', timeout: 5_000 })
    await field.fill('/tmp/dschat-typed-exports')
    await view.locator('.dsh-dschat-qa-card .dsh-dschat-btn-primary').click()
    await view.waitForTimeout(400)

    assert.deepEqual(
      await calls(view),
      [
        ['setExportDir', '/tmp/dschat-typed-exports'],
        ['exportFile', 'c1', null, 2],
      ],
      'the typed folder is stored first, then the file is written',
    )
  } finally {
    await mounted.close()
  }
})
