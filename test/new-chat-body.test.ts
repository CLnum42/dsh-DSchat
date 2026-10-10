/**
 * The brand-new conversation's body, and the race that used to lose it.
 *
 * `/state` carries SUMMARIES and `/chat?id=` carries one conversation's body, so
 * "the panel renders conversation X" is a claim about two requests that are in
 * flight at the same time. 「新对话」 is where they are guaranteed to cross:
 *
 *   t0  POST /newChat resolves with the new id; the panel selects it and asks
 *       for the whole snapshot;
 *   t1  the selection effect asks /chat for the new conversation's body — and
 *       that response routinely lands FIRST, while the panel's copy of the list
 *       still does not contain the new conversation at all;
 *   t2  the snapshot finally arrives and introduces the conversation, empty and
 *       not loaded.
 *
 * At t1 the body was applied with `chats.map(...)`, which is a silent no-op for
 * a chat that is not in the list: nothing marked it loaded, so at t2 the panel
 * held "empty and unloaded" — and every later poll replaced its messages with
 * `[]` again. The reader then saw the reported trio:
 *
 *   · the question never appeared (the poll kept the body empty, and only the
 *     streaming /tail feed could put anything in it — the ANSWER, appended into
 *     an empty transcript);
 *   · the transcript blinked empty once per poll (empty state → answer → empty);
 *   · a conversation WITH history looked like a brand-new one, because the
 *     empty state is exactly what a zero-message chat renders.
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

/*
 * ONE browser for the whole file.
 *
 * Each test needs a fresh page, not a fresh browser, and the suite runs every
 * test file's browser tests concurrently: launching per test doubled this file's
 * share of Chrome instances for nothing, which is exactly the kind of pressure
 * that makes a launch or a CDP call stall on a loaded machine.
 */
let browser: import('playwright-core').Browser | undefined

test.before(async () => {
  try {
    const { chromium } = await import('playwright-core')
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  } catch {
    browser = undefined
  }
})

test.after(async () => {
  await browser?.close()
  browser = undefined
})

/**
 * Boot the panel against a mock whose `/state` answers LATE.
 *
 * `stateDelayMs` is the whole race: with it at 0 the snapshot introduces the new
 * conversation before its body resolves and the panel looks fine (which is why
 * this survived the existing suite). At 150 ms the body arrives first, exactly
 * as it does against the real host.
 *
 * `bodyDelayMs` slows `/chat` for the STORED conversation (`c2`) only, which
 * opens the window a reader sees when they click a conversation in the rail.
 */
async function bootPanel(options: { stateDelayMs: number; bodyDelayMs?: number }) {
  if (browser === undefined) throw new Error('Chrome unavailable')
  const dir = mkdtempSync(join(root, '.tmp-newchat-body-'))

  writeFileSync(join(dir, 'entry.tsx'), `
    import { createElement } from 'react'
    import { createRoot } from 'react-dom/client'
    import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
    import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
    import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

    const STATE_DELAY = ${JSON.stringify(options.stateDelayMs)}
    const BODY_DELAY = ${JSON.stringify(options.bodyDelayMs ?? 0)}
    const now = Date.now()
    const chats = [{
      id: 'c1', title: '旧会话', createdAt: now - 60000, updatedAt: now - 60000,
      model: 'deepseek-chat', streaming: false,
      messages: [
        { id: 'u1', role: 'user', content: '旧问题：这个文件讲的是什么？', ts: now - 60000 },
        { id: 'a1', role: 'assistant', content: '旧回答：它讲的是一份迁移方案。', ts: now - 59000 },
      ],
    }, {
      id: 'c2', title: '有记录的会话', createdAt: now - 600000, updatedAt: now - 300000,
      model: 'deepseek-chat', streaming: false,
      messages: [
        { id: 'u2', role: 'user', content: '更早的问题：附件放在哪里？', ts: now - 600000 },
        { id: 'a2', role: 'assistant', content: '更早的回答：放在 attachments 目录里。', ts: now - 599000 },
      ],
    }]
    let activeChatId = 'c1'
    let seq = 0

    const ok = async (extra) => ({ ok: true, ...extra })
    const pending = () => new Promise(() => undefined)
    const summaries = () => chats.map(({ messages, ...summary }) => ({ ...summary, messageCount: messages.length }))

    const api = {
      /*
       * The snapshot is taken at CALL time and answered late: a request already
       * in flight describes the list as it was, which is what makes the ordering
       * below a real race rather than a contrived reordering.
       */
      state: async () => {
        const snapshot = summaries()
        const active = activeChatId
        if (STATE_DELAY > 0) await new Promise((resolve) => window.setTimeout(resolve, STATE_DELAY))
        return ok({
          engine: 'ready', loggedIn: true, busy: false, deepThink: false, search: false,
          activeChatId: active, chats: snapshot,
        })
      },
      chat: async (id) => {
        const wanted = id ?? activeChatId
        const chat = chats.find((candidate) => candidate.id === wanted)
        if (chat === undefined) return { ok: false, code: 'NOT_FOUND', error: 'no such chat' }
        if (BODY_DELAY > 0 && wanted === 'c2') await new Promise((resolve) => window.setTimeout(resolve, BODY_DELAY))
        return ok({ chat: { ...chat, messages: [...chat.messages] } })
      },
      tail: async (chatId, at) => {
        const chat = chats.find((candidate) => candidate.id === (chatId ?? activeChatId)) ?? chats[0]
        const message = [...chat.messages].reverse().find((item) => item.role === 'assistant')
        if (message === undefined) {
          return ok({ chatId: chat.id, activeChatId, busy: false, streaming: false, message: null })
        }
        const content = message.content
        const head = Math.min(Number(at) || 0, content.length)
        return ok({
          chatId: chat.id, activeChatId, busy: false, streaming: false,
          messageCount: chat.messages.length,
          message: {
            id: message.id, role: 'assistant', ts: message.ts, streaming: false,
            length: content.length, head, tail: content.slice(head),
          },
        })
      },
      context: async () => ok({ workspaces: [], cwd: '/' }),
      send: async (text) => {
        seq += 1
        const chat = chats.find((candidate) => candidate.id === activeChatId)
        /* The engine stores the question first and the answer grows under it. */
        chat.messages.push({ id: 'q' + seq, role: 'user', content: text, ts: Date.now() })
        window.setTimeout(() => {
          chat.messages.push({ id: 'a' + seq, role: 'assistant', content: '回答正文：这是一段不算短的回复，用来占满一屏。', ts: Date.now() })
        }, 120)
        return ok({ chatId: chat.id })
      },
      newChat: async () => {
        const id = 'c-new'
        chats.unshift({ id, title: '新的对话', createdAt: Date.now(), updatedAt: Date.now(), model: 'deepseek-chat', streaming: false, messages: [] })
        activeChatId = id
        return ok({ chatId: id })
      },
      stop: pending, wake: pending, openLogin: pending, closeBrowser: pending,
      setDeepThink: pending, setSearch: pending, transfer: pending, exportFile: pending,
      renameChat: pending, deleteChat: pending, clearChats: pending, webChats: pending,
      recover: pending, restore: pending, attach: pending, searchConversations: pending,
    }
    window.__mount = () => {
      const style = document.createElement('style')
      style.textContent = PANEL_CSS
      document.head.appendChild(style)
      const tt = (key) => zh[key] ?? key
      createRoot(document.getElementById('seat')).render(createElement(DSchatPanel, {
        api, tt, t: tt,
        openSession: async () => true,
        pickDirectory: async () => null,
        createWorkspace: async () => ({ workspaceId: 'w', title: 'w' }),
      }))
    }
    /*
     * Every state the transcript passes through, recorded on the mutation that
     * produced it. A 100 ms sampler cannot see a flash that lasts one tail tick,
     * and "the page blinks" is exactly that kind of event.
     */
    window.__watch = () => {
      const log = []
      const record = () => {
        log.push({
          t: Date.now(),
          users: document.querySelectorAll('[data-role="user"]').length,
          answers: document.querySelectorAll('[data-role="assistant"]').length,
          empty: document.querySelector('.dsh-dschat-empty') !== null,
        })
      }
      new MutationObserver(record).observe(document.getElementById('seat'), {
        childList: true, subtree: true, characterData: true,
      })
      record()
      window.__log = log
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
  await view.waitForTimeout(600)

  return {
    view,
    /** What the transcript holds right now, as the reader would see it. */
    transcript: () => view.evaluate(() => ({
      users: [...document.querySelectorAll('[data-role="user"]')].map(node => node.textContent ?? ''),
      answers: [...document.querySelectorAll('[data-role="assistant"]')].map(node => node.textContent ?? ''),
      empty: document.querySelector('.dsh-dschat-empty') !== null,
    })),
    close: async () => {
      await view.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('a conversation created while /state is in flight still loads its body', async (t) => {
  if (browser === undefined) {
    t.skip('Chrome unavailable, browser half skipped')
    return
  }
  // The body of the new conversation resolves while the snapshot that would
  // introduce it is still on the wire — the real ordering, made reliable.
  const panel = await bootPanel({ stateDelayMs: 150 })
  const { view } = panel
  try {
    // 1. Start a new conversation, as the toolbar button does.
    await view.getByRole('button', { name: '新对话' }).click()
    /*
     * Wait for the swap rather than for a wall-clock interval: the point of the
     * test is what happens ONCE the new conversation is on screen, and a fixed
     * sleep turns a loaded machine into a flake.
     */
    await view.waitForSelector('.dsh-dschat-empty', { timeout: 15_000 })
    const fresh = await panel.transcript()
    assert.equal(fresh.users.length, 0, 'a brand-new conversation has no messages')
    assert.equal(fresh.empty, true, 'and renders the empty state')

    // 2. Ask the first question in it.
    const question = '第一条问题：请介绍一下这个插件。'
    await view.locator('.dsh-dschat-input').fill(question)
    await view.evaluate(() => { window.__watch() })
    await view.locator('.dsh-dschat-send').click()

    /*
     * 3. Watch the transcript for a few polls.
     *
     * Two things have to be true: the question is on screen, and the transcript
     * never falls back to the empty state once it holds anything — the empty
     * state IS the "brand-new conversation" page the reader reported being
     * thrown back to, mid-answer.
     */
    await view.waitForTimeout(3_000)
    const log: Array<{ t: number; users: number; answers: number; empty: boolean }> =
      await view.evaluate(() => window.__log)
    /* Collapse the streaming noise: one entry per distinct observable state. */
    const states = log.filter((entry, index) => index === 0
      || entry.users !== log[index - 1]?.users
      || entry.answers !== log[index - 1]?.answers
      || entry.empty !== log[index - 1]?.empty)

    const last = await panel.transcript()
    assert.ok(
      last.users.some(text => text.includes(question)),
      `the question must be visible; transcript states were ${JSON.stringify(states)}`,
    )
    assert.ok(last.answers.length > 0, 'the answer must be visible too')

    const firstContent = states.findIndex(entry => entry.users + entry.answers > 0)
    const emptied = states
      .slice(Math.max(0, firstContent))
      .findIndex(entry => entry.empty && entry.users + entry.answers === 0)
    assert.equal(
      emptied, -1,
      `the transcript must not blink back to the empty state; states were ${JSON.stringify(states)}`,
    )
  } finally {
    await panel.close()
  }
})

test('a stored conversation does not render as a brand-new one while its body loads', async (t) => {
  if (browser === undefined) {
    t.skip('Chrome unavailable, browser half skipped')
    return
  }
  // A deliberately slow body for the stored conversation (c2), so the window
  // the reader actually sees is wide enough to inspect.
  const panel = await bootPanel({ stateDelayMs: 0, bodyDelayMs: 600 })
  const { view } = panel
  try {
    await view.waitForSelector('.dsh-dschat-msg', { timeout: 15_000 })

    // Open the other stored conversation — the one with history in it.
    await view.locator('.dsh-dschat-item', { hasText: '有记录的会话' })
      .locator('.dsh-dschat-item-main').click()

    /*
     * Mid-fetch. Its messages are empty and its body is not loaded, which is the
     * exact pair that used to fall into the empty branch — i.e. the panel showed
     * 「在 DSH 里直接聊 DeepSeek 网页端」 for a conversation that has two messages,
     * and the reader read that as "my conversation is gone / I am in a new chat".
     */
    await view.waitForTimeout(250)
    const during = await view.evaluate(() => ({
      newChatPage: document.querySelectorAll('.dsh-dschat-empty:not(.dsh-dschat-loading)').length,
      loading: document.querySelectorAll('.dsh-dschat-loading').length,
    }))
    assert.equal(during.newChatPage, 0, 'a stored conversation must never render as a brand-new one')
    assert.equal(during.loading, 1, 'it says it is loading instead')

    // And it fills in with the real transcript.
    await view.getByText('更早的问题').first().waitFor({ timeout: 10_000 })
    const after = await panel.transcript()
    assert.equal(after.users.length, 1, 'the conversation shows its one question')
    assert.equal(after.answers.length, 1, 'and its one answer')
    assert.equal(after.empty, false, 'with no placeholder left behind')
  } finally {
    await panel.close()
  }
})
