/**
 * 「新提问置顶」 against the two races that broke it in the field.
 *
 * The v0.5 scroll contract is exercised by `scroll-anchor.test.ts` with a mock
 * that appends the sent message the instant it is sent — which is exactly the
 * case that always worked. On the real engine the panel is fed by
 * `/state` + `/tail`, and two things happen that the happy-path test cannot see:
 *
 *   1. 迟到的快照 — POST /send resolves BEFORE the store carries the new user
 *      message, and the panel polls `/state` on its own clock the whole time. A
 *      poll that lands in that window still shows the OLD transcript, whose last
 *      user row is the PREVIOUS question. Anchoring there — which is what the
 *      panel did, taking "the last user row" as "the row I just sent" — pins the
 *      viewport to a question the reader asked minutes ago, and the reply they
 *      are waiting for streams in somewhere below the fold. Reported as
 *      「新发的 prompt 不会跳转，第一条问题留在顶端」.
 *
 *   2. 答案还太短 — the anchor's scroll is CLAMPED at
 *      `scrollHeight - clientHeight`, so while the answer below the new question
 *      is shorter than the viewport the browser cannot put that question at the
 *      top. The old scroll handler measured the distance from the requested
 *      position, read the clamp as "the reader scrolled away", dropped the
 *      anchor and re-pinned to the bottom — the same wrong view by a second
 *      route, and the one that fires on every send in a short conversation.
 *
 * Both are asserted here by MEASURING the viewport, because both are about where
 * the reader ends up looking. Skipped, not failed, when Chrome is unavailable.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Enough paragraphs that a reply is taller than the viewport. */
const LONG_REPLY = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段：这是一段足够长的回答正文，用来把消息流撑到需要滚动的高度。`).join('\n\n')

/** One line — the answer is deliberately shorter than the viewport. */
const SHORT_REPLY = '好的。'

/**
 * Bundle the panel with a mock API whose transcript the TEST advances.
 *
 * `userAfterMs` / `answerAfterMs` are the two halves of the race, and they are
 * separate on purpose: the engine stores the question first and the answer grows
 * under it afterwards, so a test that appends both at once cannot see the window
 * in which an anchor is taken but the browser cannot yet scroll to it.
 */
async function bootPanel(options: {
  questions: number
  reply: string
  userAfterMs: number
  answerAfterMs: number
}) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const dir = mkdtempSync(join(root, '.tmp-anchor-race-'))

  writeFileSync(join(dir, 'entry.tsx'), `
    import { createElement } from 'react'
    import { createRoot } from 'react-dom/client'
    import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
    import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
    import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

    const now = Date.now()
    const reply = ${JSON.stringify(options.reply)}
    const USER_AFTER = ${JSON.stringify(options.userAfterMs)}
    const ANSWER_AFTER = ${JSON.stringify(options.answerAfterMs)}
    let seq = 0
    const messages = []
    for (let i = 1; i <= ${JSON.stringify(options.questions)}; i += 1) {
      messages.push({ id: 'u' + i, role: 'user', content: '第 ' + i + ' 个问题：请展开说明一下。', ts: now + i })
      messages.push({ id: 'a' + i, role: 'assistant', content: reply, ts: now + i })
    }
    const chat = { id: 'c1', title: 't', createdAt: now, updatedAt: now, model: 'deepseek-chat', streaming: false, messages }
    const state = { engine: 'ready', loggedIn: true, busy: false, deepThink: false, search: false, activeChatId: 'c1', chats: [chat] }

    const ok = async (extra) => ({ ok: true, ...extra })
    const pending = () => new Promise(() => undefined)
    const api = {
      // A fresh object per poll, exactly as JSON over the wire does.
      state: async () => ({
        ok: true,
        // Summaries only; the body comes from chat() — see the sibling note in
        // scroll-anchor.test.ts (and note: no backticks inside this template).
        ...state,
        chats: state.chats.map(({ messages: own, ...summary }) => ({ ...summary, messageCount: own.length })),
      }),
      chat: async (id) => {
        const wanted = id ?? state.activeChatId
        const chat = state.chats.find(candidate => candidate.id === wanted) ?? state.chats[0]
        return ok({ chat: { ...chat, messages: [...chat.messages] } })
      },
      tail: async () => ok({ busy: false, streaming: false }),
      context: async () => ok({ workspaces: [], cwd: '/' }),
      send: async (text) => {
        seq += 1
        const id = 'sent' + seq
        // The question first, the answer later — the store write the panel will
        // not see until it polls again, and the growth that follows it.
        window.setTimeout(() => {
          messages.push({ id, role: 'user', content: text, ts: Date.now() })
        }, USER_AFTER)
        window.setTimeout(() => {
          messages.push({ id: id + '-a', role: 'assistant', content: reply, ts: Date.now() })
        }, ANSWER_AFTER)
        return ok({ chatId: 'c1' })
      },
      newChat: pending, stop: pending, wake: pending, openLogin: pending, closeBrowser: pending,
      setDeepThink: pending, setSearch: pending, transfer: pending, exportFile: pending,
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
  await view.waitForSelector('.dsh-dschat-input', { timeout: 15_000 })
  await view.waitForTimeout(600)

  return {
    view,
    /** How far the last question's row sits below the top of the scroll box. */
    lastQuestionOffset: () => view.evaluate(() => {
      const list = document.querySelector('.dsh-dschat-thread')
      const rows = list.querySelectorAll('[data-role="user"]')
      const last = rows[rows.length - 1]
      return Math.round(last.getBoundingClientRect().top - list.getBoundingClientRect().top)
    }),
    /** Every question's text, in transcript order. */
    questionTexts: () => view.locator('[data-role="user"]').allInnerTexts(),
    close: async () => {
      await view.close()
      await browser.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('a slow store write does not anchor the send to the previous question', async (t) => {
  let panel
  try {
    // Long replies, so the transcript is scrollable and "a previous question at
    // the top" is a view the panel can actually land on.
    panel = await bootPanel({ questions: 3, reply: LONG_REPLY, userAfterMs: 2_600, answerAfterMs: 2_800 })
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = panel
  try {
    // The transcript opens at its end, where the reader was.
    assert.equal(await view.locator('.dsh-dschat-nav-item').count(), 3)

    await view.locator('.dsh-dschat-input').fill('第 4 个问题：这条要等一会儿才进快照。')
    await view.locator('.dsh-dschat-send').click()

    /*
     * The race window: the POST is done, several `/state` polls have landed, and
     * every one of them still describes the OLD transcript. Nothing may anchor
     * during it — least of all question 3, which is what "the last user row"
     * resolves to while question 4 does not exist yet.
     */
    await view.waitForTimeout(1_200)
    assert.equal(
      (await panel.questionTexts()).length,
      3,
      'the store genuinely has not delivered the new question yet',
    )
    assert.ok(
      (await panel.lastQuestionOffset()) < 0,
      'the lagging snapshot did not move the viewport: the previous question is still above the fold, not pinned to the top',
    )

    /*
     * The snapshot lands and the answer starts growing under the question. The
     * answer is long, so the browser CAN put the question at the top — which is
     * where the reader has to end up, or they read their own question nowhere.
     */
    await view.waitForTimeout(4_000)
    assert.equal((await panel.questionTexts()).length, 4, 'the new question arrived')
    const offset = await panel.lastQuestionOffset()
    assert.ok(
      offset >= 0 && offset <= 24,
      `the question just sent sits at the top of the viewport (measured ${offset}px)`,
    )
    assert.ok(
      (await panel.questionTexts())[3].includes('第 4 个问题'),
      'the anchored row is the one just sent',
    )
    assert.equal(await view.locator('.dsh-dschat-nav-item').count(), 4, 'the navigator gained it')
  } finally {
    await panel.close()
  }
})

test('an answer that cannot lift its question to the top does not snap the view to the bottom', async (t) => {
  let panel
  try {
    /*
     * The clamp: the new question is the LAST row and its answer is one line, so
     * the scroll that would put the question at the top stops at the end of the
     * content instead. The anchor has to survive that — dropped, it re-pins the
     * transcript to the bottom and the reader, who was watching their question,
     * is moved for no reason.
     */
    panel = await bootPanel({ questions: 6, reply: SHORT_REPLY, userAfterMs: 0, answerAfterMs: 250 })
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = panel
  try {
    await view.locator('.dsh-dschat-input').fill('第 7 个问题：答案很短，看它钉在哪里。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForTimeout(2_000)

    const verdict = await view.evaluate(() => {
      const list = document.querySelector('.dsh-dschat-thread')
      const rows = list.querySelectorAll('[data-role="user"]')
      const last = rows[rows.length - 1]
      const box = list.getBoundingClientRect()
      const row = last.getBoundingClientRect()
      return {
        // Fully inside the visible transcript, head and all.
        visible: row.top >= box.top - 1 && row.bottom <= box.bottom + 1,
        // Where the panel left the transcript: the end of the content.
        atBottom: Math.round(list.scrollHeight - list.scrollTop - list.clientHeight) <= 2,
      }
    })
    assert.ok(
      verdict.visible,
      'the question just asked is on screen, even though the answer is too short to lift it to the top',
    )
    assert.equal(
      verdict.atBottom,
      true,
      'the transcript rests at the end of the content rather than being yanked further',
    )
  } finally {
    await panel.close()
  }
})
