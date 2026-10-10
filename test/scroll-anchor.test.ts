/**
 * The v0.5 transcript-scroll contract, in a real Chromium.
 *
 * Three behaviours, none of which a static render can see:
 *
 *   1. 新提问置顶  — after a send, the question just asked sits at the TOP of the
 *      visible transcript (12px down), so the answer is readable from its first
 *      line as it streams in.
 *   2. 提问导航    — the right-edge rail appears once a conversation has more
 *      than one question AND actually overflows, one tick per question, and a
 *      click moves the viewport to that question.
 *   3. 「↓ 最新」  — the way back to the end exists only while the reader is not
 *      at the end, and clicking it returns there.
 *
 * Skipped, not failed, when Chrome is unavailable — the same rule the other
 * browser test in this suite follows.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * One LONG assistant reply.
 *
 * Long enough that "pinned to the bottom" and "the question anchored at the
 * top" are different views by a wide margin: if the answer were about one
 * screenful, a transcript scrolled to its end would ALSO put the question near
 * the top, and the anchoring assertion below could pass without the feature
 * working at all.
 */
const LONG_REPLY = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段：这是一段足够长的回答正文，用来把消息流撑到需要滚动的高度。`).join('\n\n')

test('a send anchors its question to the top, and the navigator jumps between questions', async (t) => {
  const { chromium } = await import('playwright-core')
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }

  const dir = mkdtempSync(join(root, '.tmp-anchor-browser-'))
  try {
    writeFileSync(join(dir, 'entry.tsx'), `
      import { createElement } from 'react'
      import { createRoot } from 'react-dom/client'
      import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
      import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
      import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

      const now = Date.now()
      const reply = ${JSON.stringify(LONG_REPLY)}
      let seq = 0
      const messages = []
      for (let i = 1; i <= 4; i += 1) {
        messages.push({ id: 'u' + i, role: 'user', content: '第 ' + i + ' 个问题：请展开说明一下。', ts: now + i })
        messages.push({ id: 'a' + i, role: 'assistant', content: reply, ts: now + i })
      }
      const chat = { id: 'c1', title: 't', createdAt: now, updatedAt: now, model: 'deepseek-chat', streaming: false, messages }
      const state = { engine: 'ready', loggedIn: true, busy: false, deepThink: false, search: false, activeChatId: 'c1', chats: [chat] }

      const ok = async (extra) => ({ ok: true, ...extra })
      const pending = () => new Promise(() => undefined)
      const api = {
        // A fresh object per poll, exactly as the JSON over the wire does: the
        // panel's memos key off the transcript's identity, so returning the same
        // mutated object would hide a real update (and did, in this test's first
        // draft).
        state: async () => ({
          ok: true,
          /*
           * SUMMARIES, like the host: /state carries no messages now, and the
           * body arrives from chat() below. The panel renders this fixture only
           * if both halves are modelled — which is the real routes' contract.
           *
           * No backticks in this block: it is itself inside a template literal.
           */
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
          // The engine appends the question AND starts a reply below it, which is
          // what makes "the question at the top" a position the browser can
          // actually reach.
          messages.push({ id, role: 'user', content: text, ts: Date.now() })
          messages.push({ id: id + '-a', role: 'assistant', content: reply, ts: Date.now() })
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
      <script>${(await import('node:fs')).readFileSync(outfile, 'utf8')}</script>
      <script>window.__mount()</script></body></html>`, 'utf8')

    const view = await browser.newPage({ viewport: { width: 1000, height: 760 } })
    await view.goto(`file://${page}`, { waitUntil: 'load' })
    await view.waitForSelector('.dsh-dschat-input', { timeout: 15_000 })
    await view.waitForTimeout(600)

    /** How far the last user row is from the top of the scroll box. */
    const anchorOffset = () => view.evaluate(() => {
      const list = document.querySelector('.dsh-dschat-thread')
      const rows = list.querySelectorAll('[data-role="user"]')
      const last = rows[rows.length - 1]
      return Math.round(last.getBoundingClientRect().top - list.getBoundingClientRect().top)
    })

    // 1. The navigator exists: five questions by now (four loaded + the one the
    //    panel is about to send is still to come), and the transcript overflows.
    assert.equal(await view.locator('.dsh-dschat-nav').count(), 1, 'the navigator is on screen for a long transcript')
    assert.equal(await view.locator('.dsh-dschat-nav-item').count(), 4, 'one tick per question')
    assert.equal(
      await view.locator('.dsh-dschat-thread').evaluate(el => getComputedStyle(el).getPropertyValue('padding-right') !== '' ? el.dataset.nav : ''),
      'true',
      'the reading column reserves the navigator gutter',
    )

    // 2. Send, and the new question lands at the top of the viewport.
    await view.locator('.dsh-dschat-input').fill('第 5 个问题：这条会被锚定在顶部。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForTimeout(900)
    const offset = await anchorOffset()
    assert.ok(offset >= 0 && offset <= 24, `the sent question sits at the top of the viewport (measured ${offset}px)`)
    assert.ok(
      (await view.locator('[data-role="user"]').last().innerText()).includes('第 5 个问题：这条会被锚定在顶部。'),
      'the row that was anchored is the one just sent',
    )
    assert.equal(
      await view.locator('.dsh-dschat-nav-item').count(),
      5,
      'the navigator gained the new question',
    )

    // 3. The 「↓ 最新」 pill is offered, because the reader is NOT at the end.
    assert.equal(await view.locator('.dsh-dschat-latest').count(), 1, 'the way back to the end is on screen')

    // 4. Clicking a tick jumps to that question.
    await view.locator('.dsh-dschat-nav-item').first().click()
    // Long enough for a smooth scroll across the whole transcript to land; the
    // panel hands the viewport back as soon as it arrives, so this is wall time,
    // not a race the assertion could win by luck.
    await view.waitForTimeout(1_600)
    const firstOffset = await view.evaluate(() => {
      const list = document.querySelector('.dsh-dschat-thread')
      const first = list.querySelector('[data-role="user"]')
      return Math.round(first.getBoundingClientRect().top - list.getBoundingClientRect().top)
    })
    assert.ok(firstOffset >= -4 && firstOffset <= 24, `the first question is at the top after its tick was clicked (${firstOffset}px)`)
    assert.equal(
      await view.locator('.dsh-dschat-nav-item').first().getAttribute('data-active'),
      'true',
      'the tick the reader jumped to is the current one',
    )

    // 5. The pill returns the reader to the end, and retires itself.
    await view.locator('.dsh-dschat-latest').click()
    await view.waitForTimeout(2_000)
    assert.equal(await view.locator('.dsh-dschat-latest').count(), 0, 'the pill is gone once the reader is back at the end')
    const gap = await view.evaluate(() => {
      const list = document.querySelector('.dsh-dschat-thread')
      return Math.round(list.scrollHeight - list.scrollTop - list.clientHeight)
    })
    assert.ok(gap <= 2, `the transcript is scrolled to its end (${gap}px from the bottom)`)

    await view.close()
  } finally {
    await browser.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
