/**
 * The stale-reply guard: a question must never be answered with the PREVIOUS
 * turn's reply.
 *
 * This is the reported failure, verbatim. A conversation had been idle for
 * three hours; the reader asked 「开封有什么适合自驾游的景点？」 and the panel
 * stored — 1.8 s later, `streaming: false`, no `thinkingMs`, NO error — a
 * whitespace-collapsed replica of the previous answer (「这个文件的题目是
 * …"口语"与"经典"之间…」), while the web page itself still showed the new
 * question sitting in its composer.
 *
 * The mechanism, reconstructed from what was stored:
 *
 *   1. the page's request never reached the teed capture, so the reply loop
 *      took the DOM fallback on its very first tick;
 *   2. the fallback's freshness check compared virtualizer KEYS — and a
 *      virtualizer hands out new keys when it re-renders old rows, so "a key I
 *      have not seen" passed while the newest assistant row in the DOM was
 *      still the previous reply;
 *   3. `domSnapshot()` returns the last assistant row; that old row was
 *      committed as this turn's answer;
 *   4. `DOM_STABLE_MS` then fired (the "reply" never changed again) and the loop
 *      exited reporting success.
 *
 * Both halves of the fix are pinned here: the previous reply is snapshotted
 * before Enter and scrapes are compared against it by CONTENT
 * (`repeatsPreviousReply`), and a turn that only ever produced that replica
 * fails loudly instead of storing it. The controls matter as much as the catch —
 * the fallback must still follow a page that really does render a new answer.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* ------------------------------------------------------------------ fixtures */

/** The previous turn, exactly as it was stored (reasoning + answer). */
const PREVIOUS_REPLY = [
  '<details><summary>思考过程</summary>',
  '',
  '我们需要回答用户：“这个文件的题目是什么？” 需要根据文件内容判断。文件开头 Page 1 有：',
  '',
  '口语”与“经典”之间  ',
  '',
  '## 德明《红楼梦》节译与19世纪俄国汉学的知识考古  ',
  '',
  '所以题目可能是《“口语”与“经典”之间——德明〈红楼梦〉节译与19世纪俄国汉学的知识考古》？ 注意开头显示 “口语”与“经典”之间 （前面可能缺了左引号？显示为 口语”与“经典”之间）。下一行副标题：德明《红楼梦》节译与19世纪俄国汉学的知识考古。 所以完整标题：口语”与“经典”之间——德明《红楼梦》节译与19世纪俄国汉学的知识考古？ 应该回答。可以简洁。注意可能主标题是“口语”与“经典”之间，副标题是“德明《红楼梦》节译与19世纪俄国汉学的知识考古”。用户问“这个文件的题目是什么？” 直接给出。',
  '',
  '</details>',
  '',
  '这个文件的题目是：',
  '',
  '**“口语”与“经典”之间——德明《红楼梦》节译与19世纪俄国汉学的知识考古**',
  '',
  '其中主标题为：**“口语”与“经典”之间**  ',
  '副标题为：**德明《红楼梦》节译与19世纪俄国汉学的知识考古**',
].join('\n')

/**
 * The stale snapshot as the scrape really produced it: a round trip through the
 * page's DOM (block boundaries collapsed to spaces) and through the engine's own
 * `serializeToMarkdown`, cut off where the page had rendered to at that instant
 * — note the emphasis span that never closed, which is why the opening `**` and
 * the opening quote are missing.
 *
 * Byte-for-byte the value that was committed to the reader's transcript.
 */
const REPLICA = '<details><summary>思考过程</summary>\n\n'
  + '我们需要回答用户：“这个文件的题目是什么？” 需要根据文件内容判断。文件开头 Page 1 有：口语”与“经典”之间德明《红楼梦》节译与19世纪俄国汉学的知识考古所以题目可能是《“口语”与“经典”之间——德明〈红楼梦〉节译与19世纪俄国汉学的知识考古》？ 注意开头显示 “口语”与“经典”之间 （前面可能缺了左引号？显示为 口语”与“经典”之间）。下一行副标题：德明《红楼梦》节译与19世纪俄国汉学的知识考古。 所以完整标题：口语”与“经典”之间——德明《红楼梦》节译与19世纪俄国汉学的知识考古？ 应该回答。可以简洁。注意可能主标题是“口语”与“经典”之间，副标题是“德明《红楼梦》节译与19世纪俄国汉学的知识考古”。用户问“这个文件的题目是什么？” 直接给出。'
  + '\n\n</details>\n\n这个文件的题目是：'

/** A plausible answer to the new question, used by the fresh-reply control. */
const KAIFENG_ANSWER = '开封适合自驾游的景点：清明上河园、龙亭公园、铁塔公园、开封府，彼此车程都在二十分钟内。'

/** The DOM parts the scrape fixes on for the previous reply. */
const STALE_THINK = REPLICA.slice(REPLICA.indexOf('</summary>') + '</summary>'.length, REPLICA.indexOf('\n\n</details>')).trim()
const STALE_BODY = '这个文件的题目是：'

/* ------------------------------------------------------------- content guard */

test('the replica of a previous reply is recognised, a real new answer is not', async () => {
  const { previousReplyMessage, repeatsPreviousReply } = await import('../src/engine/engine.ts')
  const previous = previousReplyMessage([
    { id: 'u1', role: 'user', content: '这个文件的题目是什么？', ts: 1 },
    { id: 'a1', role: 'assistant', content: PREVIOUS_REPLY, ts: 2 },
  ])

  assert.equal(previous, PREVIOUS_REPLY, 'the whole stored reply is the baseline, reasoning included')
  assert.equal(repeatsPreviousReply(REPLICA, previous), true, 'the reported replica is caught')
  assert.equal(repeatsPreviousReply(PREVIOUS_REPLY, previous), true, 'a re-render of the reply itself is a replica')

  // The controls matter as much as the catch: refusing a REAL answer would
  // trade a wrong answer for no answer at all.
  assert.equal(
    repeatsPreviousReply('开封适合自驾游的景点有清明上河园、龙亭公园、铁塔公园和开封府。', previous),
    false,
    'an unrelated answer passes',
  )
  assert.equal(
    repeatsPreviousReply(
      '这个文件的题目是：**“口语”与“经典”之间——德明《红楼梦》节译与19世纪俄国汉学的知识考古**\n\n'
      + '如果你想改一个更适合投稿的题目，我建议从副标题入手，把“知识考古”换成更具体的方法论表述。',
      previous,
    ),
    false,
    'an answer that opens the same way and then turns over passes',
  )
  assert.equal(repeatsPreviousReply(REPLICA, ''), false, 'a fresh chat has nothing to repeat')
  assert.equal(repeatsPreviousReply('好的', previous), false, 'text too short to judge is never refused')
  /*
   * The "too short to judge" threshold is deliberately low, because a LIVE
   * scrape catches the reply while it is still an opening fragment. A real
   * browser replay of the reported page caught a 10-character replica being
   * committed while the guard stayed silent: the minimum had been set to a
   * whole finished answer's worth of text.
   */
  const shortReply = '<details><summary>思考过程</summary>\n\n旧思考\n\n</details>\n\n旧答复'
  assert.equal(repeatsPreviousReply(shortReply, shortReply), true, 'a short reply is still a reply, and its replica still a replica')
  assert.equal(
    repeatsPreviousReply(REPLICA, '好的，我来帮你看看这个文件。'),
    false,
    'a short genuine answer that merely starts alike is not refused',
  )
  assert.equal(
    previousReplyMessage([{ id: 'u1', role: 'user', content: '问', ts: 1 }]),
    '',
    'a conversation with no assistant turn yet has no previous reply',
  )
})

/* --------------------------------------------------------------- the engine */

interface DomState {
  /** Virtualizer keys, in DOM order. */
  keys: string[]
  /** Reasoning + the answer currently rendered at the end of the list. */
  think: string
  reply: string
  /** The question row, empty until this turn's own row mounts. */
  question: string
}

/**
 * A page shaped like the reported one: signed in, composer mounted, the previous
 * turn rendered, and no teed capture ever starting (the request never reached
 * it). `onEnter` replays what the page does when Enter lands — including the
 * virtualizer re-rendering the old assistant row under a brand-new key, which is
 * what defeated the key-set check.
 */
function pageStub(options: { state: DomState; onEnter: (state: DomState) => void }) {
  const state = options.state
  const calls = { evaluate: 0, enter: 0 }
  const noop = async () => undefined
  const locator = (selector: string) => ({
    count: async () => (selector === 'textarea' ? 1 : 0),
    first: () => locator(selector),
    click: noop,
    fill: noop,
    type: noop,
    waitFor: noop,
  })

  /**
   * The rows `scrapeConversation` would find. The last row is what
   * `domSnapshot` reads, so this is the page's answer for the whole turn.
   */
  const scraped = () => {
    const out: Array<Record<string, unknown>> = [
      { role: 'user', parts: [{ kind: 'body', markdown: '', text: '这个文件的题目是什么？' }] },
      {
        role: 'assistant',
        parts: [
          { kind: 'think', markdown: '', text: '旧思考' },
          { kind: 'body', markdown: '', text: '旧答复' },
        ],
      },
    ]
    if (state.question !== '') {
      out.push({ role: 'user', parts: [{ kind: 'body', markdown: '', text: state.question }] })
    }
    /*
     * A row renders only the halves the page actually has. An empty part is not
     * a row with an empty body — the scrape would hand back a reply with no
     * answer in it, and the loop would settle on that.
     */
    const parts: Array<Record<string, unknown>> = []
    if (state.think !== '') parts.push({ kind: 'think', markdown: '', text: state.think })
    if (state.reply !== '') parts.push({ kind: 'body', markdown: '', text: state.reply })
    if (parts.length > 0) out.push({ role: 'assistant', parts })
    return out
  }

  const page = {
    isClosed: () => false,
    url: () => 'https://chat.deepseek.com/a/chat/s/sid-1',
    locator,
    keyboard: { press: async () => { calls.enter += 1; options.onEnter(state) } },
    /*
     * Real time still has to pass: the reply loop paces itself with this call,
     * and the turn's `replyTimeoutMs` is measured against the wall clock. A
     * no-op here spins the loop through its whole budget in microseconds and no
     * test-side timer ever gets to fire.
     */
    waitForTimeout: async (ms: number) => { await new Promise(resolve => setTimeout(resolve, Math.min(ms, 20))) },
    waitForFunction: noop,
    setDefaultTimeout: () => undefined,
    close: noop,
    goto: noop,
    evaluate: async (fn: unknown, arg?: unknown) => {
      calls.evaluate += 1
      // The engine's evaluate bodies are told apart by their source, exactly
      // the way the real page would run them.
      const source = String(fn)
      if (source.includes('__wcCursor')) {
        // No capture installed ⇒ `readCapture` answers null, which is what puts
        // the reply loop on the DOM fallback from its first tick.
        return null
      }
      if (source.includes('__wcStream =')) return undefined // resetCapture
      if (source.includes('data-virtual-list-item-key') && source.includes('getAttribute')) {
        return arg === '[data-virtual-list-item-key]' ? [...state.keys] : []
      }
      if (source.includes('element.cloneNode')) return scraped()
      return undefined
    },
  }
  return { page, state, calls }
}

async function engineWith(page: unknown, dataDir: string, replyTimeoutMs = 3_000) {
  const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
  const { TranscriptStore } = await import('../src/store.ts')
  const store = new TranscriptStore({ dataDir })
  const engine = new DeepSeekWebEngine(store as never, {
    dataDir,
    profileDir: join(dataDir, 'profile'),
    // The assertions are about what gets stored. The budget still has to clear
    // the reply loop's own `DOM_STABLE_MS` window (1 s + one 80 ms tick), or
    // every turn would end as a timeout before the loop could settle.
    replyTimeoutMs,
  })
  Object.assign(engine as object, { page, context: { close: async () => undefined } })
  const chat = store.createChat('deepseek-reasoner')
  store.appendMessage(chat.id, { id: 'u1', role: 'user', content: '这个文件的题目是什么？', ts: Date.now() })
  store.appendMessage(chat.id, { id: 'a1', role: 'assistant', content: PREVIOUS_REPLY, ts: Date.now() })
  return { engine, store, chatId: chat.id }
}

test('a turn whose page only ever shows the previous reply stores nothing', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-stale-reply-'))
  try {
    const stub = pageStub({
      state: { keys: ['k-1', 'k-2'], think: '', reply: '旧答复', question: '' },
      onEnter: state => {
        // The page renumbers the OLD rows and never mounts a row for this turn:
        // the key-set check the old code relied on passes right here.
        state.keys = ['k-9', 'k-8']
        state.question = '开封有什么适合自驾游的景点？'
        state.think = STALE_THINK
        state.reply = STALE_BODY
      },
    })
    // The DOM already holds the previous reply, so the first scrape after Enter
    // reads it — the exact window the bug lived in.
    stub.state.think = STALE_THINK
    stub.state.reply = STALE_BODY

    const { engine, store, chatId } = await engineWith(stub.page, dataDir)
    const result = await engine.send('开封有什么适合自驾游的景点？', true)
    store.flush()

    const messages = store.getChat(chatId)?.messages ?? []
    const replies = messages.filter(message => message.role === 'assistant')
    assert.equal(result.reply, '', 'nothing is reported as this turn\'s reply')
    assert.equal(result.ok, false, 'and the turn fails instead of "succeeding" with an old answer')
    assert.match(String(result.error), /没有回复这次提问/, `the reader is told what happened: ${String(result.error)}`)
    assert.equal(replies.length, 1, 'only the real previous reply is in the transcript')
    assert.equal(replies[0]?.content, PREVIOUS_REPLY, 'stored verbatim, not replaced by the collapsed replica')
    assert.ok(
      !messages.some(message => (message.content ?? '').includes('这个文件的题目是：\n其中主标题为')),
      'the collapsed replica that was actually committed never lands',
    )
    assert.equal(
      messages.filter(message => message.role === 'user').length,
      2,
      'the question stays in the transcript, so its 重试 can resend it',
    )
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('a page that renders the new answer is still followed, DOM fallback and all', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-fresh-reply-'))
  try {
    const stub = pageStub({
      state: { keys: ['k-1', 'k-2'], think: '', reply: '旧答复', question: '' },
      onEnter: state => {
        state.keys = ['k-1', 'k-2', 'k-3', 'k-4']
        state.question = '开封有什么适合自驾游的景点？'
      },
    })
    // This turn's answer renders a tick later, as it does live.
    const timer = setTimeout(() => {
      stub.state.think = '开封是八朝古都，自驾的话景点之间都不远。'
      stub.state.reply = KAIFENG_ANSWER
    }, 150)

    const { engine, store, chatId } = await engineWith(stub.page, dataDir)
    const result = await engine.send('开封有什么适合自驾游的景点？', true)
    clearTimeout(timer)
    store.flush()

    assert.equal(result.ok, true, `the fresh reply must still land: ${String(result.error)}`)
    assert.match(result.reply, /清明上河园/, 'it is the answer to THIS question')
    const replies = (store.getChat(chatId)?.messages ?? []).filter(message => message.role === 'assistant')
    assert.equal(replies.length, 2, 'the previous reply plus this turn\'s answer')
    assert.match(replies[1]?.content ?? '', /清明上河园/)
    assert.doesNotMatch(replies[1]?.content ?? '', /旧答复/)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
