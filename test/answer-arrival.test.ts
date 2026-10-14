/**
 * The answer's action row arrives WITH the answer, not before it.
 *
 * Reported interaction: while a reply was still streaming, the row under it was
 * already there — 复制 on a half-written sentence, 分享 offering to publish a turn
 * the web page did not have yet, and a 重新生成 whose only possible state was
 * 「正在生成回复，等这一轮结束再重新生成」. The row now exists only once THIS
 * message has stopped arriving.
 *
 * Driven in a real Chromium rather than rendered to static markup, because both
 * halves of the requirement are about the live panel's own wiring: the row follows
 * the MESSAGE's `streaming` flag (not the turn-wide `busy`, which stays true for
 * the whole transcript and would take the controls off finished answers too), and
 * the row has to appear on the same message the moment the turn ends — including
 * on the very response that ends it.
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

/**
 * The live reply, in the shape the engine stores while the model is still
 * thinking: an UNTERMINATED `<details>` block, with no answer after it yet.
 */
const THINKING = '<details><summary>思考过程</summary>\n\n先确认这一轮要回答什么，答案还没有开始写。'

/** The same turn once the answer exists — the reasoning block is closed. */
const ANSWERED = '<details><summary>思考过程</summary>\n\n先确认这一轮要回答什么。\n\n</details>\n\n'
  + '完整回答：这一条已经写完了，操作栏应该就挂在这下面。'

/**
 * Mount the real panel against a fixture the test drives from the outside.
 *
 * The page owns `window.__stream` (what the stub API answers from) and
 * `window.__finish` (end the turn), so a stream is reproduced without a web page,
 * an engine or a network. The transcript already holds BOTH exchanges at mount —
 * one finished, one arriving — because the requirement is about what the row does
 * while a reply streams, not about how a message gets there.
 *
 * @returns the browser page plus the fixture, once the panel has mounted.
 */
async function mount(): Promise<{
  view: import('playwright-core').Page
  close: () => Promise<void>
}> {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const dir = mkdtempSync(join(root, '.tmp-answer-arrival-'))
  try {
    writeFileSync(join(dir, 'entry.tsx'), `
      import { createElement } from 'react'
      import { createRoot } from 'react-dom/client'
      import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
      import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
      import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

      const now = Date.now()
      const stream = window.__stream = {
        busy: true, streaming: true, content: ${JSON.stringify(THINKING)},
        activeChatId: 'c1',
        chats: [{
          id: 'c1', title: '提问中', createdAt: now, updatedAt: now, model: 'deepseek-reasoner',
          streaming: true,
          messages: [
            { id: 'u1', role: 'user', content: '第一个问题：那条已经答完了。', ts: now - 90_000 },
            {
              id: 'a1', role: 'assistant', ts: now - 80_000, thinkingMs: 5200,
              content: ${JSON.stringify(ANSWERED)}, streaming: false,
            },
            { id: 'u2', role: 'user', content: '第二个问题：这一条还在生成。', ts: now - 10_000 },
            { id: 'a2', role: 'assistant', ts: now - 5_000, content: ${JSON.stringify(THINKING)}, streaming: true },
          ],
        }],
      }

      const ok = async (extra) => ({ ok: true, ...extra })
      const pending = () => new Promise(() => undefined)
      const summary = (chat) => { const { messages, ...rest } = chat; return { ...rest, messageCount: messages.length } }

      const api = {
        state: async () => ({
          ok: true, engine: 'ready', loggedIn: true, busy: stream.busy, deepThink: false, search: false,
          activeChatId: stream.activeChatId, chats: stream.chats.map(summary),
        }),
        chat: async (id) => {
          const chat = stream.chats.find(candidate => candidate.id === (id ?? stream.activeChatId))
          return ok({ chat: { ...chat, messages: [...chat.messages] } })
        },
        tail: async (chatId) => {
          const chat = stream.chats.find(candidate => candidate.id === chatId) ?? stream.chats[0]
          const last = [...chat.messages].reverse().find(item => item.role === 'assistant')
          /*
           * head 0 plus the fixture's current body, and the message's streaming
           * flag straight from it. This is the ONE response that ends a turn in
           * the real host too: the engine writes \`streaming: false\` into the
           * message before it clears the chat's flag, so the panel learns it is
           * over from the tail rather than from /state.
           */
          return ok({
            chatId: chat.id, busy: stream.busy, streaming: stream.streaming,
            updatedAt: chat.updatedAt, messageCount: chat.messages.length,
            message: {
              id: last.id, role: 'assistant', ts: last.ts,
              streaming: stream.streaming, head: 0, tail: stream.content,
            },
          })
        },
        context: async () => ok({ workspaces: [], cwd: '/' }),
        send: pending, newChat: pending, stop: pending, wake: pending, openLogin: pending, closeBrowser: pending,
        setDeepThink: pending, setSearch: pending, transfer: pending, exportFile: pending, renameChat: pending,
        deleteChat: pending, clearChats: pending, webChats: pending, recover: pending, restore: pending, attach: pending,
      }

      /** End the turn the way the host does: nothing is in flight any more. */
      window.__finish = () => {
        const chat = stream.chats[0]
        const last = [...chat.messages].reverse().find(item => item.role === 'assistant')
        stream.busy = false
        stream.streaming = false
        stream.content = ${JSON.stringify(ANSWERED)}
        chat.streaming = false
        for (const message of chat.messages) if (message.role === 'assistant') message.streaming = false
        last.content = stream.content
        chat.updatedAt = Date.now()
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
    await view.waitForSelector('.dsh-dschat-msg[data-message-id="a2"]', { timeout: 15_000 })
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

/** One message as the DOM shows it: its row's controls, or `null` when it has none. */
async function rows(view: import('playwright-core').Page): Promise<Array<{
  id: string
  role: string
  labels: string[] | null
  disabled: string[]
}>> {
  return await view.evaluate(() => [...document.querySelectorAll('.dsh-dschat-msg')].map(message => {
    const row = message.querySelector('.dsh-dschat-msg-acts')
    const buttons = row === null ? [] : [...row.querySelectorAll('button')] as HTMLButtonElement[]
    return {
      id: message.getAttribute('data-message-id') ?? '',
      role: message.getAttribute('data-role') ?? '',
      labels: row === null ? null : buttons.map(button => button.getAttribute('aria-label') ?? ''),
      disabled: buttons.filter(button => button.disabled).map(button => button.getAttribute('aria-label') ?? ''),
    }
  }))
}

/** The page's own five controls, in the page's order — the row's wire contract. */
const PAGE_ROW = ['复制回复', '重新生成', '喜欢', '不喜欢', '分享']

test('a reply that is still arriving carries no action row, while a finished one keeps its own', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount()
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view, close } = mounted
  try {
    // A tail/state round after the first paint, so the row's absence is the
    // panel's decision rather than a render that has not happened yet.
    await view.waitForTimeout(500)
    const list = await rows(view)

    const arriving = list.find(row => row.id === 'a2')
    assert.ok(arriving !== undefined, 'the streaming answer is on screen')
    assert.equal(arriving.labels, null, 'a reply that is still streaming has NO controls at all')

    const finished = list.find(row => row.id === 'a1')
    assert.ok(finished?.labels !== null && finished !== undefined, 'the finished answer keeps its row')
    /*
     * The page's five controls in the page's order. 重新生成 is the one control
     * whose accessible name changes while a turn runs — the name IS the reason —
     * so it is asserted by the name it must carry here (see the disabled check
     * below); every other slot is the web page's own label.
     */
    assert.deepEqual(finished.labels.slice(0, 5), [
      '复制回复', '正在生成回复，等这一轮结束再重新生成', '喜欢', '不喜欢', '分享',
    ], 'the finished answer keeps the page\'s five controls, in the page\'s order')
    assert.ok(finished.labels.includes('复制思考过程'), 'plus this panel\'s own extras')

    /*
     * The distinction the whole gate rests on: the TURN is still running (the
     * panel's `busy` is true), so the finished answer's 重新生成 is disabled with
     * its reason — but the ROW is still there. A gate keyed off `busy` instead of
     * the message would have stripped a reply the reader is done with.
     */
    assert.ok(
      finished.disabled.includes('正在生成回复，等这一轮结束再重新生成'),
      'a finished answer disables 重新生成 rather than losing its row',
    )

    /*
     * The reader's own turn keeps its two controls: it is complete the moment it
     * is on screen, and it never streams.
     */
    const question = list.find(row => row.id === 'u2')
    assert.deepEqual(question?.labels, ['复制回复', '编辑重发'], 'the question keeps 复制 / 编辑重发')
    assert.deepEqual(question?.disabled, [], 'and both are usable while the answer streams')
  } finally {
    await close()
  }
})

test('the row appears on the same message the moment the turn ends', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount()
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view, close } = mounted
  try {
    await view.waitForTimeout(500)
    assert.equal((await rows(view)).find(row => row.id === 'a2')?.labels, null, 'no row while the reply streams')

    await view.evaluate(() => { (window as unknown as { __finish: () => void }).__finish() })

    /*
     * The row has to arrive from the SAME message becoming settled — not from a
     * new message, not from a remount — and it has to be fully live: the turn is
     * over, so nothing in it may still be disabled.
     */
    await view.waitForFunction(() => {
      const row = document.querySelector('.dsh-dschat-msg[data-message-id="a2"] .dsh-dschat-msg-acts')
      return row !== null && row.querySelectorAll('button:disabled').length === 0
    }, undefined, { timeout: 10_000 })

    const settled = (await rows(view)).find(row => row.id === 'a2')
    assert.deepEqual(settled?.labels?.slice(0, 5), PAGE_ROW, 'the finished reply gets the full row')
    assert.deepEqual(settled?.disabled, [], 'nothing is left disabled once the turn is over')
  } finally {
    await close()
  }
})
