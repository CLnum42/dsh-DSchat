/**
 * The streaming-scroll contract, in a real Chromium.
 *
 * Four behaviours the v0.5 anchor test does not cover, all of them about what
 * happens AFTER the anchor is taken:
 *
 *   1. 首条也置顶 — the anchor must work for the FIRST question of a conversation
 *      the panel did not know about when it sent. That is the one send whose
 *      transcript arrives together with a conversation SWITCH, and a switch is
 *      exactly what used to drop the anchor on the floor: the view fell back to
 *      「跟随最新」 and every arriving token moved it.
 *   2. 老会话也一样 — and it must work for the ordinary case too: a question sent
 *      into a conversation that was ALREADY on screen. That one caught a second
 *      bug, and the one the reader reported: the anchor was taken and applied,
 *      but the answer below the question was SHORTER than the viewport, so the
 *      browser clamped the scroll and left the question partway down the screen —
 *      then every arriving token grew the content and dragged the view with it.
 *      The fix is the empty space the transcript borrows at the bottom while an
 *      anchored answer is short (`spacerRef`), which is sized so the question
 *      reaches the top edge and shrinks as the answer grows into it.
 *   3. 长答案不动 — once the answer is taller than the viewport it keeps
 *      growing BELOW the fold, and the viewport must not move at all. Not
 *      "jump to the question once" — the whole point is that reading the first
 *      screenful is not interrupted by the text being appended under it.
 *   4. 读者优先 — after the reader scrolls the transcript by hand, no later
 *      token may drag the viewport back — and giving the borrowed space back must
 *      not clamp the very scroll they just made.
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

/** One long answer, grown paragraph by paragraph while the reader watches. */
const ANSWER = Array.from(
  { length: 40 },
  (_, i) => `第 ${i + 1} 段：这是一段足够长的回答正文，用来把消息流撑到需要滚动的高度。`,
).join('\n\n')

/**
 * Mount the real panel against a fixture the test drives from the outside.
 *
 * The page owns an object at `window.__stream`; the test mutates it (append
 * answer text, mark the turn finished) and the stub API reads it, which is how
 * a stream is reproduced without a web page, an engine or a network.
 *
 * @param options.history - finished exchanges the conversation already has when
 *   the panel mounts. 0 (the default) starts from an empty rail, where the first
 *   send is what creates the conversation; a positive number starts from a
 *   conversation that is already on screen, which is the case the reader hits
 *   every time after the first message.
 * @returns the browser page plus the fixture, once the panel has mounted.
 */
async function mount(options: { history?: number } = {}): Promise<{
  view: import('playwright-core').Page
  close: () => Promise<void>
}> {
  const history = options.history ?? 0
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const dir = mkdtempSync(join(root, '.tmp-scroll-follow-'))
  try {
    writeFileSync(join(dir, 'entry.tsx'), `
      import { createElement } from 'react'
      import { createRoot } from 'react-dom/client'
      import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
      import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
      import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

      const now = Date.now()
      const paragraph = (i) => '第 ' + i + ' 段：这是一段足够长的回答正文，用来把消息流撑到需要滚动的高度。'
      const longAnswer = (n) => Array.from({ length: n }, (_, i) => paragraph(i + 1)).join('\\n\\n')

      /*
       * The fixture, owned by the page and driven by the test through
       * window.__stream. No message bodies live on /state (the host summarizes
       * them), so the panel fetches a body once and then follows the TAIL feed —
       * which is what the stub below reproduces.
       */
      const stream = window.__stream = { chats: [], activeChatId: undefined, busy: false, streaming: false, content: '', seq: 0 }

      /*
       * A conversation with finished turns already in it. Mounted BEFORE the
       * panel renders, so the panel opens on it exactly as it opens on a real
       * stored conversation — no send, no switch.
       */
      if (${history} > 0) {
        const messages = []
        for (let i = 1; i <= ${history}; i += 1) {
          messages.push({ id: 'u' + i, role: 'user', content: '第 ' + i + ' 个问题：请展开说明一下。', ts: now + i * 1000 })
          messages.push({ id: 'a' + i, role: 'assistant', content: longAnswer(20), ts: now + i * 1000 + 1, thinkingMs: 5000 })
        }
        stream.chats.push({
          id: 'c1', title: '已有会话', createdAt: now, updatedAt: now, model: 'deepseek-reasoner', streaming: false, messages,
        })
        stream.activeChatId = 'c1'
      }

      const ok = async (extra) => ({ ok: true, ...extra })
      const pending = () => new Promise(() => undefined)
      const summary = (chat) => { const { messages, ...rest } = chat; return { ...rest, messageCount: messages.length } }
      const newest = () => stream.chats.find(chat => chat.id === stream.activeChatId)

      const api = {
        state: async () => ({
          ok: true, engine: 'ready', loggedIn: true, busy: stream.busy, deepThink: false, search: false,
          activeChatId: stream.activeChatId, chats: stream.chats.map(summary),
        }),
        chat: async (id) => {
          const chat = stream.chats.find(candidate => candidate.id === (id ?? stream.activeChatId)) ?? stream.chats[0]
          return ok({ chat: { ...chat, messages: [...chat.messages] } })
        },
        tail: async (chatId) => {
          const chat = stream.chats.find(candidate => candidate.id === (chatId ?? stream.activeChatId))
          const last = chat === undefined ? undefined : [...chat.messages].reverse().find(item => item.role === 'assistant')
          if (chat === undefined || last === undefined) return ok({ busy: stream.busy, streaming: stream.streaming })
          // head 0: the whole body every tick, which is the "full resend" branch
          // of the protocol and cannot desync this fixture.
          return ok({
            chatId: chat.id, busy: stream.busy, streaming: stream.streaming,
            messageCount: chat.messages.length, updatedAt: chat.updatedAt,
            message: { id: last.id, role: 'assistant', ts: last.ts, streaming: stream.streaming, head: 0, tail: stream.content },
          })
        },
        send: async (text) => {
          stream.seq += 1
          const chat = newest()
          /*
           * Ids that cannot collide with the seeded history (u1, a1, …): a
           * duplicate id would make the panel's querySelector pick the HISTORY
           * row and anchor the view to a question hundreds of pixels up the
           * transcript, which reads exactly like the bug this test is about.
           */
          const userId = 'sent-u' + stream.seq
          const answerId = 'sent-a' + stream.seq
          if (chat === undefined) {
            // A conversation the panel has never seen: the send CREATES it, so
            // the panel's own view switches chats in the same commit that the
            // new question appears in — behaviour 1.
            stream.chats.push({
              id: 'c1', title: '新的对话', createdAt: now, updatedAt: now, model: 'deepseek-chat', streaming: true,
              messages: [
                { id: userId, role: 'user', content: text, ts: now },
                { id: answerId, role: 'assistant', content: stream.content, ts: now, streaming: true },
              ],
            })
            stream.activeChatId = 'c1'
          } else {
            chat.messages.push({ id: userId, role: 'user', content: text, ts: now })
            chat.messages.push({ id: answerId, role: 'assistant', content: stream.content, ts: now, streaming: true })
          }
          stream.streaming = true
          stream.busy = true
          return ok({ chatId: stream.activeChatId })
        },
        context: async () => ok({ workspaces: [], cwd: '/' }),
        newChat: pending, stop: pending, wake: pending, openLogin: pending, closeBrowser: pending,
        setDeepThink: pending, setSearch: pending, transfer: pending, exportFile: pending,
        renameChat: pending, deleteChat: pending, clearChats: pending, webChats: pending,
        recover: pending, restore: pending, attach: pending,
      }
      /*
       * End the turn, exactly as the host does: the panel only sends a new
       * message when nothing is in flight, so a test that wants a second send
       * has to let the first one finish.
       */
      window.__finish = () => {
        stream.busy = false
        stream.streaming = false
        for (const chat of stream.chats) {
          chat.streaming = false
          for (const message of chat.messages) if (message.role === 'assistant') message.streaming = false
        }
      }
      window.__mount = () => {        const style = document.createElement('style')
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
    await view.waitForTimeout(400)
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

/** How far the LAST question sits from the top of the scroll box (px). */
async function questionOffset(view: import('playwright-core').Page): Promise<number> {
  return await view.evaluate(() => {
    const list = document.querySelector('.dsh-dschat-thread') as HTMLElement
    const rows = list.querySelectorAll('[data-role="user"]')
    const last = rows[rows.length - 1] as HTMLElement
    return Math.round(last.getBoundingClientRect().top - list.getBoundingClientRect().top)
  })
}

/**
 * The scroll box's own position, its distance from the end, and how much empty
 * space it is currently borrowing at the bottom (px).
 *
 * `borrowed` is the panel's answer to "can the anchored question reach the top
 * at all": it is non-zero exactly while the answer below the question is shorter
 * than the viewport.
 */
async function metrics(view: import('playwright-core').Page): Promise<{ top: number; gap: number; borrowed: number }> {
  return await view.evaluate(() => {
    const list = document.querySelector('.dsh-dschat-thread') as HTMLElement
    const spacer = document.querySelector('.dsh-dschat-thread-spacer') as HTMLElement | null
    return {
      top: Math.round(list.scrollTop),
      gap: Math.round(list.scrollHeight - list.scrollTop - list.clientHeight),
      borrowed: spacer === null ? -1 : Math.round(spacer.getBoundingClientRect().height),
    }
  })
}

/** Grow the answer on the page, as arriving tokens do. `streaming` keeps the feed on. */
async function grow(view: import('playwright-core').Page, paragraphs: number): Promise<void> {
  await view.evaluate((count: number) => {
    const stream = (window as unknown as { __stream: { content: string } }).__stream
    stream.content = Array.from(
      { length: count },
      (_, i) => `第 ${i + 1} 段：这是一段足够长的回答正文，用来把消息流撑到需要滚动的高度。`,
    ).join('\n\n')
  }, paragraphs)
}

test('the first question of a conversation the panel did not know is anchored, and its answer does not move the view', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount()
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = mounted
  try {
    // The first answer is already tall enough that 「anchored at the top」 and
    // 「pinned to the end」 are different views by a wide margin (the same rule
    // the v0.5 anchor test follows), then it grows for the whole test.
    await grow(view, 12)
    await view.locator('.dsh-dschat-input').fill('第一条问题：这条会被锚定在顶部。')
    await view.locator('.dsh-dschat-send').click()

    /*
     * The question has to reach the top of the viewport: the conversation is
     * created by this very send, so the panel switches chats in the same commit
     * the question appears in.
     */
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 1
    }, undefined, { timeout: 10_000 })
    await view.waitForTimeout(500)
    const anchored = await questionOffset(view)
    assert.ok(anchored >= -2 && anchored <= 4, `the sent question is at the very top of the view (measured ${anchored}px)`)

    /** The position the anchor settled on — the viewport must not leave it. */
    const before = await metrics(view)

    /*
     * The answer now outgrows the viewport several times over. Every tick is a
     * /state or tail response, i.e. the same render the old code used to answer
     * by pinning the transcript to its end.
     */
    for (const paragraphs of [10, 20, 30, 40]) {
      await grow(view, paragraphs)
      await view.waitForTimeout(400)
    }
    const after = await metrics(view)
    assert.equal(after.top, before.top, 'the viewport did not move while the answer grew below the fold')
    assert.ok(after.gap > before.gap, 'the transcript really did grow past the bottom of the viewport')
    assert.ok(
      (await questionOffset(view)) <= 4,
      'the question is still the first line of the viewport',
    )
  } finally {
    await mounted.close()
  }
})

test('a question sent into the open conversation is anchored, and a long answer leaves the viewport alone', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount()
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = mounted
  try {
    await grow(view, 12)
    await view.locator('.dsh-dschat-input').fill('第一条问题：先建立一段对话。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 1
    }, undefined, { timeout: 10_000 })
    await view.waitForTimeout(400)

    // The turn has to be over before a second one may be sent: the panel queues
    // anything submitted while the page is busy (and says so).
    await view.evaluate(() => { (window as unknown as { __finish: () => void }).__finish() })
    await view.waitForTimeout(600)

    // A second question in the SAME conversation: the panel's view does not
    // switch, so this is the anchor path the v0.5 test already covers — kept
    // here because the growth assertion below is the new part.
    await view.locator('.dsh-dschat-input').fill('第二条问题：这条也要置顶。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 2
    }, undefined, { timeout: 10_000 })
    await view.waitForTimeout(500)
    const anchored = await questionOffset(view)
    assert.ok(anchored >= -2 && anchored <= 4, `the second question is at the very top of the view (measured ${anchored}px)`)
    const before = await metrics(view)

    for (const paragraphs of [10, 20, 30, 40]) {
      await grow(view, paragraphs)
      await view.waitForTimeout(400)
    }
    const after = await metrics(view)
    assert.equal(after.top, before.top, 'the viewport stayed where the anchor put it')
    assert.ok(after.gap > before.gap, 'the answer grew past the bottom of the viewport')
  } finally {
    await mounted.close()
  }
})

test('after the reader scrolls by hand, arriving tokens do not drag the viewport back', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount()
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = mounted
  try {
    /*
     * A conversation with a long answer, then a SECOND question: the anchor has
     * to have a screenful of transcript above it, or "the reader scrolled away"
     * is not a move the browser can even make (scrolling up from the first
     * message clamps at zero, which is the anchor's own position).
     */
    await grow(view, 12)
    await view.locator('.dsh-dschat-input').fill('第一条问题：先把这段对话撑长。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 1
    }, undefined, { timeout: 10_000 })
    await view.evaluate(() => { (window as unknown as { __finish: () => void }).__finish() })
    await view.waitForTimeout(600)

    await grow(view, 40)
    await view.locator('.dsh-dschat-input').fill('一条会被读者自己滚开的问题。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 2
    }, undefined, { timeout: 10_000 })
    await view.waitForTimeout(600)

    /*
     * The reader takes the wheel: a wheel-sized scroll UP, away from both the
     * anchor and the end — far enough that the panel has to read it as the
     * reader's own move rather than as the browser landing a pixel or two off.
     * What they read next is their business; no arriving token may move them.
     */
    const before = await metrics(view)
    await view.evaluate(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement
      list.scrollTop = Math.max(0, list.scrollTop - 200)
    })
    await view.waitForTimeout(250)
    const parked = await metrics(view)
    assert.ok(parked.top < before.top, 'the reader really did move the transcript up')
    assert.ok(parked.gap > 96, 'the reader is nowhere near the end of the transcript')

    for (const paragraphs of [60, 80, 100]) {
      await grow(view, paragraphs)
      await view.waitForTimeout(400)
    }
    const after = await metrics(view)
    assert.equal(after.top, parked.top, 'the viewport is exactly where the reader left it')
  } finally {
    await mounted.close()
  }
})

test('even a small wheel move wins over the anchor', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount()
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = mounted
  try {
    // The anchor needs a screenful of transcript above it — see the test above.
    await grow(view, 12)
    await view.locator('.dsh-dschat-input').fill('第一条问题：先把这段对话撑长。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 1
    }, undefined, { timeout: 10_000 })
    await view.evaluate(() => { (window as unknown as { __finish: () => void }).__finish() })
    await view.waitForTimeout(600)

    await grow(view, 40)
    await view.locator('.dsh-dschat-input').fill('一条会被轻轻滚一下的问题。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 2
    }, undefined, { timeout: 10_000 })
    await view.waitForTimeout(600)

    /*
     * A SMALL move — 20px, inside the panel's own drift tolerance, which exists
     * to absorb the difference between where a scroll was asked to land and
     * where the browser put it. It is not a gesture, so the tolerance alone
     * would let the next tick pull it back. A wheel event says who did it, and
     * the move has to stand.
     */
    const before = await metrics(view)
    await view.evaluate(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement
      list.scrollTop = Math.max(0, list.scrollTop - 20)
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, bubbles: true }))
    })
    await view.waitForTimeout(250)
    const parked = await metrics(view)
    assert.ok(parked.top < before.top, 'the reader’s 20px move was not undone by the next tick')

    for (const paragraphs of [60, 80, 100]) {
      await grow(view, paragraphs)
      await view.waitForTimeout(400)
    }
    const after = await metrics(view)
    assert.equal(after.top, parked.top, 'the viewport stayed where the reader put it')
    assert.ok(
      after.top <= before.top,
      'and it was not pulled back towards the anchor position either',
    )
  } finally {
    await mounted.close()
  }
})

/**
 * The reader's own report, as a test.
 *
 * 「第一条会自动跳到页面最顶端，一问一答之后，第二条用户 prompt 发送后并没有跳到
 * 最顶端，而是直接附在当前对话的下方」 — a question sent into a conversation that
 * was ALREADY on screen. The anchor was taken and applied, but the answer below
 * the question was shorter than the viewport, so the browser clamped the scroll:
 * the question stopped ~190px down the screen and every arriving token grew the
 * content and pulled the transcript further. The space borrowed at the bottom is
 * what fixes it.
 *
 * The fixture mounts the conversation BEFORE the panel renders, so there is no
 * conversation switch anywhere in this test — that is the whole point, and the
 * reason the other anchor tests (which create their chat with the first send)
 * passed while the real panel did not.
 */
test('a question sent into a conversation that was already on screen lands at the very top', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount({ history: 3 })
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = mounted
  try {
    // The panel opens on the stored conversation, at its end.
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 3
    }, undefined, { timeout: 10_000 })
    await view.waitForTimeout(400)
    const opened = await metrics(view)
    assert.equal(opened.borrowed, 0, 'nothing is borrowed until a question is sent')

    // A SHORT answer — two paragraphs, well under a viewport. This is the shape
    // that used to clamp.
    await grow(view, 2)
    await view.locator('.dsh-dschat-input').fill('第四条问题：这条应该跳到最顶端。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 4
    }, undefined, { timeout: 10_000 })
    await view.waitForTimeout(400)

    const anchored = await questionOffset(view)
    assert.ok(anchored >= -2 && anchored <= 4, `the question is at the very top (measured ${anchored}px)`)
    const before = await metrics(view)
    assert.ok(before.borrowed > 0, 'the space that makes that position reachable was borrowed')
    assert.equal(
      before.borrowed,
      await view.evaluate(() => {
        const list = document.querySelector('.dsh-dschat-thread') as HTMLElement
        const question = [...list.querySelectorAll('[data-role="user"]')].at(-1) as HTMLElement
        const spacer = document.querySelector('.dsh-dschat-thread-spacer') as HTMLElement
        // Everything the viewport still needs in order to put the question's top
        // edge against its own: one client height, minus what is already below.
        const content = list.scrollHeight - spacer.getBoundingClientRect().height
        const questionTop = question.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
        return Math.round(list.clientHeight - (content - questionTop))
      }),
      'and it is exactly the shortfall, no more',
    )

    /*
     * The answer grows into the borrowed space. `scrollTop` must not move — that
     * is the whole complaint — and the space shrinks as the answer fills it, so
     * that `scrollHeight` (and with it the reader's position) stays constant.
     * Once the answer is a screenful tall the space is gone and the answer keeps
     * growing below the fold.
     */
    let borrowed = before.borrowed
    for (const paragraphs of [6, 12, 20]) {
      await grow(view, paragraphs)
      await view.waitForTimeout(400)
      const step = await metrics(view)
      assert.equal(step.top, before.top, `the viewport held still at ${paragraphs} paragraphs`)
      assert.ok(
        step.borrowed <= borrowed,
        `and the borrowed space never grew back (${step.borrowed} after ${borrowed})`,
      )
      assert.ok((await questionOffset(view)) <= 4, 'with the question still the first line')
      borrowed = step.borrowed
    }
    assert.equal(borrowed, 0, 'a screenful of answer leaves nothing left to borrow')
  } finally {
    await mounted.close()
  }
})

test('the borrowed space is given back without moving the reader', async (t) => {
  let mounted: Awaited<ReturnType<typeof mount>> | undefined
  try {
    mounted = await mount({ history: 3 })
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }
  const { view } = mounted
  try {
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 3
    }, undefined, { timeout: 10_000 })
    await grow(view, 2)
    await view.locator('.dsh-dschat-input').fill('第五条问题：读者随后会自己滚动。')
    await view.locator('.dsh-dschat-send').click()
    await view.waitForFunction(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement | null
      return list !== null && list.querySelectorAll('[data-role="user"]').length === 4
    }, undefined, { timeout: 10_000 })
    await view.waitForTimeout(400)
    assert.ok((await metrics(view)).borrowed > 0, 'the anchored question is sitting on borrowed space')

    /*
     * The reader wheels up 100px — INSIDE the borrowed space, which is where
     * they are by construction (the answer does not fill the view yet). Taking
     * the space back here would clamp the scroll they just made, so it has to
     * survive this moment.
     */
    const before = await metrics(view)
    await view.evaluate(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement
      list.scrollTop -= 100
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
    })
    await view.waitForTimeout(300)
    const parked = await metrics(view)
    assert.equal(parked.top, before.top - 100, 'the reader’s scroll was not clamped away')
    assert.ok(parked.borrowed > 0, 'so the space they were sitting in is still there')

    // The answer grows underneath; the viewport still does not move.
    await grow(view, 8)
    await view.waitForTimeout(400)
    assert.equal((await metrics(view)).top, parked.top, 'and the arriving tokens left them alone')

    /*
     * Now the reader goes back INTO the content — above everything the space was
     * holding up. The space is no longer load-bearing, so it is given back, and
     * because their position no longer depends on it there is no clamp: they
     * stay exactly where they put themselves.
     */
    const intended = await view.evaluate(() => {
      const list = document.querySelector('.dsh-dschat-thread') as HTMLElement
      const spacer = document.querySelector('.dsh-dschat-thread-spacer') as HTMLElement
      const content = list.scrollHeight - spacer.getBoundingClientRect().height
      /*
       * 150px above the content end rather than 60: the panel reads "within 96px
       * of the end" as 「following the newest line」 and would legitimately pull
       * the reader the rest of the way, which is not what this test is about.
       */
      const wanted = Math.max(0, content - list.clientHeight - 150)
      list.scrollTop = wanted
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: -150, bubbles: true }))
      return Math.round(wanted)
    })
    await view.waitForTimeout(1_500)
    const inside = await metrics(view)
    assert.equal(inside.borrowed, 0, 'the space is given back once the reader is inside the content')
    assert.equal(inside.top, intended, 'and giving it back did not clamp their position')
    assert.ok(inside.gap >= 0, 'with the transcript ending where it really ends')
  } finally {
    await mounted.close()
  }
})
