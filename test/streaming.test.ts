/**
 * Streaming-path tests: the incremental SSE parser, the /tail delta contract,
 * and the coalesced store writer.
 *
 * These are the three things that turn "the reply arrives in paragraphs" into
 * "the reply arrives". Each one is a place where a plausible-looking edit
 * silently reintroduces whole-buffer work, so each is pinned by behaviour (the
 * parser and the delta) or by the shape of what actually lands on disk (the
 * store) rather than by reading the source.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/* ------------------------------------------------------------------ fixtures */

/**
 * A `/chat/completion` body that exercises every branch the parser has: the
 * opening snapshot, a reasoning fragment, search results, a TOOL_OPEN citation,
 * bare deltas, path-addressed deltas and the FINISHED status.
 *
 * Built as lines (not one string) so a test can split it anywhere — including
 * between a `\r` and its `\n`.
 */
function sseBody(): string {
  const line = (payload: unknown): string => `data: ${JSON.stringify(payload)}\r\n`
  const lines: string[] = []
  lines.push(line({ v: { response: { fragments: [{ type: 'THINK', content: '' }, { type: 'RESPONSE', content: '' }] } } }))
  lines.push(line({ p: 'response/fragments/-1/results', o: 'SET', v: [{ url: 'https://a.example/1', title: '甲页' }, { url: 'https://b.example/2' }] }))
  lines.push(line({ p: 'response/fragments', o: 'APPEND', v: [{ type: 'RESPONSE', content: '金庸' }] }))
  lines.push(line({ v: '的武侠' }))
  lines.push(line({ p: 'response/fragments/-1/content', o: 'APPEND', v: '小说' }))
  lines.push(line({ p: 'response/fragments', o: 'APPEND', v: [{ type: 'TOOL_OPEN', id: 7, result: { title: '示例页', url: 'https://a.example/1' } }] }))
  lines.push(line({ v: [{ p: 'content', o: 'APPEND', v: '见[reference:7]' }, { p: 'references', o: 'APPEND', v: [{ id: 7, type: 'TOOL_OPEN' }] }] }))
  lines.push(line({ p: 'response/fragments/-1/content', o: 'APPEND', v: '。' }))
  lines.push(line({ p: 'response/status', o: 'SET', v: 'FINISHED' }))
  return lines.join('')
}

/** Deterministic pseudo-random chunk sizes (no Math.random in a test). */
function chunkSizes(length: number, seed: number): number[] {
  const sizes: number[] = []
  let state = seed
  let remaining = length
  while (remaining > 0) {
    state = (state * 1103515245 + 12345) % 2147483648
    const size = Math.min(remaining, 1 + (state % 7))
    sizes.push(size)
    remaining -= size
  }
  return sizes
}

/** Feed a body through the incremental parser in the given chunk sizes. */
function feed(raw: string, sizes: number[]) {
  const parser = createParser()
  let at = 0
  for (const size of sizes) {
    parser.push(raw.slice(at, at + size))
    at += size
  }
  parser.finish()
  return parser.snapshot()
}

/* --------------------------------------------------- lazily built entry points */

let engineModule: any
/** The parser lives in engine.ts, which imports playwright-core at run time. */
async function loadEngine() {
  if (engineModule === undefined) engineModule = await import('../src/engine/engine.ts')
  return engineModule as {
    createStreamReplyParser: () => any
    parseStreamReply: (raw: string) => any
  }
}

function createParser(): any {
  return (engineModule as any).createStreamReplyParser()
}

/**
 * `routes.ts` reaches the harness through `transfer.ts` (`@deepseek-ai/dsh-llm`
 * and friends only resolve inside a running harness), so the pure helpers are
 * bundled with those specifiers aliased away.
 */
async function loadRoutes() {
  const dir = mkdtempSync(join(root, '.tmp-streaming-test-'))
  const entry = join(dir, 'entry.ts')
  const outfile = join(dir, 'routes.mjs')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(entry, `export { tailDelta } from ${JSON.stringify(join(root, 'src/routes.ts'))}\n`)
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    alias: {
      '@deepseek-ai/dsh-llm': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-session': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-tools': join(root, 'test/stubs/harness.ts'),
      'playwright-core': join(root, 'test/stubs/harness.ts'),
    },
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, dispose: () => { rmSync(dir, { recursive: true, force: true }) } }
}

/* ------------------------------------------------------------------- parser */

test('the incremental parser agrees with the whole-body parse at every split', async () => {
  const { parseStreamReply } = await loadEngine()
  const raw = sseBody()
  const whole = parseStreamReply(raw)
  assert.ok(whole.markdown.includes('金庸的武侠小说'), 'the fixture parses to the reply text')

  const splits: Array<[string, number[]]> = [
    ['one shot', [raw.length]],
    ['one character at a time', new Array(raw.length).fill(1)],
    ['random small chunks', chunkSizes(raw.length, 12345)],
    ['random small chunks (other seed)', chunkSizes(raw.length, 99991)],
    ['line at a time', raw.split('\n').map((part, i, all) => (i === all.length - 1 ? part.length : part.length + 1))],
  ]
  for (const [label, sizes] of splits) {
    assert.deepEqual(feed(raw, sizes), whole, `feeding ${label} matches the whole-body parse`)
  }
})

/*
 * A citation is a NUMBER in the answer text, so the URLs have to be captured
 * out of band while the reply streams — and the order is the contract: the web
 * numbers its sources 1..M, and the panel resolves `[citation:N]` as
 * `sources[N - 1]`. Getting the order wrong does not break the render; it
 * silently links a claim to the wrong page, which is why this is pinned here.
 */
test('the parser keeps each reply\'s sources in citation order', async () => {
  const { parseStreamReply } = await loadEngine()
  const parsed = parseStreamReply(sseBody())
  assert.deepEqual(parsed.sources, [
    { url: 'https://a.example/1', title: '甲页' },
    { url: 'https://b.example/2' },
  ], 'the search results arrive in citation order, with the titles the page gave')
  assert.ok(parsed.markdown.includes('[citation:1]'), 'the TOOL_OPEN citation resolves onto that table')
  // A reply with no search has no table at all — the panel then keeps rendering
  // the plain chips instead of offering links to nothing.
  const plain = parseStreamReply('data: {"v":"没有搜索的回答"}\r\n')
  assert.deepEqual(plain.sources, [])
})

test('the parser holds a line split between carriage return and newline', async () => {
  const { parseStreamReply } = await loadEngine()
  const raw = sseBody()
  const whole = parseStreamReply(raw)
  // Cut at every '\r' so the CRLF pair is always broken across two pushes —
  // splitting on /\r?\n/ instead of '\n' would lose the line's payload here.
  const cuts = [...raw.matchAll(/\r/g)].map(match => match.index)
  assert.ok(cuts.length > 4, 'the fixture is CRLF-terminated')
  for (const cut of cuts) {
    assert.deepEqual(feed(raw, [cut + 1, raw.length - cut - 1]), whole, `split after the CR at ${cut}`)
  }
})

test('the parser keeps state across pushes instead of replaying the buffer', async () => {
  const { parseStreamReply } = await loadEngine()
  const raw = sseBody()
  const whole = parseStreamReply(raw)
  const parser = createParser()
  const half = Math.floor(raw.length / 2)
  parser.push(raw.slice(0, half))
  const early = parser.snapshot()
  parser.push(raw.slice(half))
  parser.finish()
  const rest = parser.snapshot()
  assert.deepEqual(rest, whole, 'the second half completes the first')
  // The reasoning/search bookkeeping accumulated in the FIRST push must still be
  // there afterwards: re-parsing the tail alone could not have reconstructed it.
  assert.ok(early.thinking.includes('搜索到 2 个网页'), 'the first push already recorded the search step')
  assert.equal(rest.thinking, whole.thinking, 'and the state survived the second push')
})

test('a chunk boundary inside a JSON payload does not lose the event', async () => {
  const { parseStreamReply } = await loadEngine()
  const raw = sseBody()
  const whole = parseStreamReply(raw)
  // Every offset, not a sample: the payload boundary is where an incremental
  // parser that re-split the accumulated buffer would double-apply.
  for (let cut = 1; cut < raw.length; cut++) {
    assert.deepEqual(feed(raw, [cut, raw.length - cut]), whole, `cut at ${cut}`)
  }
})

/* ----------------------------------------------------------------- /tail */

test('the tail delta sends only the new suffix and resends after a desync', async () => {
  const { mod, dispose } = await loadRoutes()
  try {
    const tailDelta = mod.tailDelta as (previous: string | undefined, content: string, at: number) => { head: number; tail: string }
    const first = '金庸'
    const grown = '金庸的武侠小说'

    // Nothing served yet: the client gets the whole body, whatever it claims.
    assert.deepEqual(tailDelta(undefined, first, 0), { head: 0, tail: first })

    // The normal tick: the client holds exactly what we last sent.
    assert.deepEqual(tailDelta(first, grown, first.length), { head: first.length, tail: first.slice(first.length) + grown.slice(first.length) })

    // A client that is behind (a dropped request) is resynced, not corrupted.
    assert.deepEqual(tailDelta(first, grown, 0), { head: 0, tail: grown })
    assert.deepEqual(tailDelta(first, grown, first.length - 1), { head: 0, tail: grown })
    assert.deepEqual(tailDelta(first, grown, first.length + 5), { head: 0, tail: grown })
    // A non-numeric `at` (no query param) is a resync too, not a NaN compare.
    assert.deepEqual(tailDelta(first, grown, Number.NaN), { head: 0, tail: grown })

    // Applying either shape reconstructs the host's copy exactly.
    for (const [local, at] of [[first, first.length], ['', 0], ['金', 1]] as Array<[string, number]>) {
      const delta = tailDelta(first, grown, at)
      assert.equal(local.slice(0, delta.head) + delta.tail, grown, `applying the delta from ${JSON.stringify(local)} yields the body`)
    }

    // The prefix can shrink (the thinking block grows as search steps land), and
    // the delta must still rebuild the body rather than assume pure append.
    const thinkA = '<details><summary>思考过程</summary>\n\n搜索到 2 个网页\n\n</details>\n\n金庸'
    const thinkB = '<details><summary>思考过程</summary>\n\n搜索到 2 个网页\n\n浏览 1 个页面\n- 示例页\n\n</details>\n\n金庸'
    const delta = tailDelta(thinkA, thinkB, thinkA.length)
    assert.equal(thinkA.slice(0, delta.head) + delta.tail, thinkB, 'a changed prefix is resynced from the divergence')
  } finally {
    dispose()
  }
})

/* ------------------------------------------------------------------ store */

test('transcript writes are coalesced and land as compact JSON', async () => {
  const { TranscriptStore } = await import('../src/store.ts')
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-store-'))
  const file = join(dataDir, 'transcripts.json')
  try {
    const store = new TranscriptStore({ dataDir })
    const chat = store.createChat('deepseek-chat')
    store.appendMessage(chat.id, { id: 'm1', role: 'assistant', content: '好', ts: Date.now() })

    // A streaming reply upserts the same message ~10×/s. None of those may
    // block on serializing the whole store, so nothing is written yet.
    for (let i = 0; i < 40; i++) {
      store.upsertMessage(chat.id, { id: 'm1', role: 'assistant', content: '好'.repeat(i + 1), ts: Date.now(), streaming: true })
    }
    assert.equal(existsSync(file), false, 'no write happened inside the debounce window')

    // The end of a turn flushes: the finished reply is durable immediately.
    store.flush()
    assert.equal(existsSync(file), true, 'flush lands the write')
    const text = readFileSync(file, 'utf8')
    assert.equal(text.includes('\n'), false, 'the file is compact, not pretty-printed')
    const parsed = JSON.parse(text)
    assert.equal(parsed.chats[0].messages[0].content, '好'.repeat(40), 'flush wrote the latest content')

    // Mutations after a flush are coalesced again rather than written inline.
    store.setStreaming(chat.id, false)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).chats[0].streaming, true, 'the new mutation is still pending')
    store.flush()
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).chats[0].streaming, false, 'flush lands it')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------- store rescue */

/**
 * A store that cannot be read must never be silently replaced.
 *
 * The failure this pins: `read()` caught every error and returned "no history",
 * and the first write then overwrote the only copy of every conversation. The
 * unreadable file has to be moved aside first, and the reader has to be told.
 */
test('an unreadable store is quarantined, not overwritten', async () => {
  const { TranscriptStore } = await import('../src/store.ts')
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-corrupt-'))
  const file = join(dataDir, 'transcripts.json')
  try {
    const broken = '{ "version": 1, "chats": [ {"id": "chat-1",'
    writeFileSync(file, broken, 'utf8')

    const store = new TranscriptStore({ dataDir })
    assert.equal(store.list().length, 0, 'a broken file starts an empty session')
    assert.ok(store.storeWarning() !== undefined, 'the reader is told what happened')
    assert.match(String(store.storeWarning()), /无法解析/, 'and the warning names the cause')

    // The original bytes survive under a quarantined name.
    const quarantined = readdirSync(dataDir).filter(name => name.startsWith('transcripts.json.corrupt-'))
    assert.equal(quarantined.length, 1, 'the unreadable file was moved aside')
    assert.equal(readFileSync(join(dataDir, quarantined[0]), 'utf8'), broken, 'byte for byte')

    // Only now may a write land, and it must not resurrect the broken file.
    store.flush()
    assert.equal(existsSync(file), true, 'the store writes a fresh file')
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).chats, [], 'and it is empty, as reported')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('a store that is merely missing loads empty and says nothing', async () => {
  const { TranscriptStore } = await import('../src/store.ts')
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-first-'))
  try {
    const store = new TranscriptStore({ dataDir })
    assert.equal(store.list().length, 0)
    assert.equal(store.storeWarning(), undefined, 'a first run is not a problem to report')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('an import without a web id never lands in an unrelated chat', async () => {
  const { TranscriptStore } = await import('../src/store.ts')
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-import-'))
  try {
    const store = new TranscriptStore({ dataDir })
    const first = store.createChat('deepseek-chat')
    const second = store.createChat('deepseek-chat')
    // Every new chat shares this title — which is exactly why it can never be
    // used as an identity for a restore.
    assert.equal(first.title, second.title)

    // The undo path: no id, no title matching allowed.
    const restored = store.importTranscript({
      title: second.title,
      model: 'deepseek-chat',
      messages: [{ id: 'r1', role: 'user', content: '恢复的内容', ts: 1 }],
    })
    assert.equal(restored.created, true, 'the restore creates its own transcript')
    assert.notEqual(restored.chat.id, second.id, 'and never grafts onto a look-alike')
    assert.equal(second.messages.length, 0, 'the unrelated chat is untouched')

    // A recover may match by title when the title is a real name and the
    // candidate carries no web id of its own.
    const named = store.importTranscript({ title: '河南特产', model: 'deepseek-chat', messages: [{ id: 'a', role: 'user', content: '一', ts: 1 }] })
    const again = store.importTranscript({
      title: '河南特产', model: 'deepseek-chat', matchByTitle: true,
      messages: [{ id: 'a', role: 'user', content: '一', ts: 1 }, { id: 'b', role: 'assistant', content: '二', ts: 2 }],
    })
    assert.equal(again.created, false, 'a re-sync upgrades the transcript it named')
    assert.equal(again.chat.id, named.chat.id)

    // ...but never a chat that is already bound to a specific web conversation.
    const bound = store.importTranscript({
      title: '已绑定', model: 'deepseek-chat', webSessionId: 'web-1',
      messages: [{ id: 'c', role: 'user', content: '一', ts: 1 }],
    })
    const other = store.importTranscript({
      title: '已绑定', model: 'deepseek-chat', matchByTitle: true,
      messages: [{ id: 'd', role: 'user', content: '别的会话', ts: 1 }],
    })
    assert.equal(other.created, true, 'a bound transcript is not a title-match candidate')
    assert.notEqual(other.chat.id, bound.chat.id)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

/* --------------------------------------------------------------- merge */

/**
 * `mergeTail` is the panel's half of the /tail contract. It has to be exercised
 * against the host's half rather than in isolation, because the failure mode is
 * a transcript that looks fine and has the wrong text in it.
 */
test('the panel merge reconstructs the host transcript from deltas alone', async () => {
  const { mergeTail } = await import('../src/protocol.ts')
  const { mod, dispose } = await loadRoutes()
  try {
    const tailDelta = mod.tailDelta as (previous: string | undefined, content: string, at: number) => { head: number; tail: string }

    const base: any = {
      engine: 'ready', loggedIn: true, deepThink: false, search: false, busy: true, activeChatId: 'c1',
      chats: [{ id: 'c1', title: 't', createdAt: 1, updatedAt: 1, model: 'deepseek-chat', streaming: true,
        messages: [{ id: 'u1', role: 'user', content: '问', ts: 1 }] }],
    }

    // Drive the real host delta and the real client merge together, in 3-char
    // steps, exactly as the two halves do over the wire.
    const full = '金庸的武侠小说里，侠义与成长是少年最容易接住的东西。'
    const steps: number[] = []
    for (let at = 3; at < full.length; at += 3) steps.push(at)
    steps.push(full.length)
    let server = ''          // what the host last handed over
    let state = base
    for (const at of steps) {
      const content = full.slice(0, at)
      const clientCopy = (() => {
        const chat = state.chats.find((c: any) => c.id === 'c1')
        const last = [...chat.messages].reverse().find((m: any) => m.role === 'assistant')
        return last?.content.length ?? 0
      })()
      const delta = tailDelta(server === '' ? undefined : server, content, clientCopy)
      server = content
      state = mergeTail(state, {
        ok: true, chatId: 'c1', activeChatId: 'c1', busy: true, streaming: true,
        message: { id: 'a1', role: 'assistant', ts: 2, streaming: true, length: content.length, head: delta.head, tail: delta.tail },
      } as any)
    }
    const chat = state.chats[0]
    const assistant = chat.messages.find((m: any) => m.id === 'a1')!
    assert.equal(assistant.content, full, 'the merged transcript is exactly the host body')
    assert.equal(assistant.streaming, true)
    assert.equal(chat.streaming, true)

    // A full resend (head 0) overwrites rather than appends — that is what heals
    // a client that dropped a response.
    const healed = mergeTail({ ...state, chats: [{ ...chat, messages: [chat.messages[0], { ...assistant, content: '坏的' }] }] } as any, {
      ok: true, chatId: 'c1', busy: true, streaming: true,
      message: { id: 'a1', role: 'assistant', ts: 2, streaming: true, length: full.length, head: 0, tail: full },
    } as any)
    assert.equal(healed.chats[0].messages[1].content, full, 'a resend replaces the corrupt copy')

    // An unchanged response must return the SAME object: at ~10 folds/s, a new
    // object every time would re-render the whole panel for nothing.
    const idle = mergeTail(healed, {
      ok: true, chatId: 'c1', activeChatId: 'c1', busy: true, streaming: true,
      message: { id: 'a1', role: 'assistant', ts: 2, streaming: true, length: full.length, head: full.length, tail: '' },
    } as any)
    assert.equal(idle, healed, 'a no-op tail keeps object identity')

    // End of turn: the flags land even though the text does not change.
    const done = mergeTail(healed, {
      ok: true, chatId: 'c1', activeChatId: 'c1', busy: false, streaming: false,
      message: { id: 'a1', role: 'assistant', ts: 2, streaming: false, length: full.length, head: full.length, tail: '' },
    } as any)
    assert.equal(done.busy, false)
    assert.equal(done.chats[0].streaming, false)
    assert.equal(done.chats[0].messages[1].streaming, false)
    assert.equal(done.chats[0].messages[1].content, full)

    /*
     * The reasoning duration arrives once, on the tail that first carries an
     * answer, and must SURVIVE every later tick — those ticks do not repeat it
     * (the engine measures it once), and a label that flipped back to 「思考中」
     * mid-answer would be a lie the reader can see.
     */
    const measured = mergeTail(healed, {
      ok: true, chatId: 'c1', activeChatId: 'c1', busy: true, streaming: true,
      message: { id: 'a1', role: 'assistant', ts: 2, streaming: true, length: full.length, head: full.length, tail: '', thinkingMs: 12_400 },
    } as any)
    assert.equal(measured.chats[0].messages[1].thinkingMs, 12_400, 'the measured duration lands on the message')
    assert.notEqual(measured, healed, 'and the fold is not treated as a no-op')
    const later = mergeTail(measured, {
      ok: true, chatId: 'c1', activeChatId: 'c1', busy: true, streaming: true,
      message: { id: 'a1', role: 'assistant', ts: 2, streaming: true, length: full.length, head: full.length, tail: '' },
    } as any)
    assert.equal(later.chats[0].messages[1].thinkingMs, 12_400, 'a tail that omits it never clears it')
    assert.equal(later, measured, 'and that fold IS a no-op')

    // A message the panel has never seen is appended, not merged into the
    // previous assistant reply.
    const fresh = mergeTail({ ...base, chats: [{ ...base.chats[0], messages: [base.chats[0].messages[0]] }] } as any, {
      ok: true, chatId: 'c1', busy: true, streaming: true,
      message: { id: 'a2', role: 'assistant', ts: 3, streaming: true, length: 2, head: 0, tail: '新' },
    } as any)
    assert.equal(fresh.chats[0].messages.length, 2)
    assert.equal(fresh.chats[0].messages[1].id, 'a2')

    /*
     * The citation table travels WHOLE on the tail (numbering is positional, so
     * it is never patched up incrementally). Two things matter: it lands on the
     * message, and RESENDING the same table keeps object identity — the tail is
     * folded ~10×/s and a fresh array every tick would re-render the reply.
     */
    const cited = mergeTail(fresh, {
      ok: true, chatId: 'c1', busy: true, streaming: true,
      message: {
        id: 'a2', role: 'assistant', ts: 3, streaming: true, length: 2, head: 2, tail: '',
        sources: [{ url: 'https://a.example/1', title: '甲页' }, { url: 'https://b.example/2' }],
      },
    } as any)
    assert.deepEqual(cited.chats[0].messages[1].sources, [
      { url: 'https://a.example/1', title: '甲页' },
      { url: 'https://b.example/2' },
    ])
    const resent = mergeTail(cited, {
      ok: true, chatId: 'c1', busy: true, streaming: true,
      message: {
        id: 'a2', role: 'assistant', ts: 3, streaming: true, length: 2, head: 2, tail: '',
        sources: [{ url: 'https://a.example/1', title: '甲页' }, { url: 'https://b.example/2' }],
      },
    } as any)
    assert.equal(resent, cited, 'an unchanged source table keeps object identity')

    // A tail with no table (the majority of replies) must not erase one the
    // panel already holds: the host omits the field rather than sending [].
    const silent = mergeTail(cited, {
      ok: true, chatId: 'c1', busy: true, streaming: true,
      message: { id: 'a2', role: 'assistant', ts: 3, streaming: true, length: 2, head: 2, tail: '' },
    } as any)
    assert.equal(silent, cited, 'an omitted table leaves the stored one alone')

    // A chat the panel does not have yet still updates the engine flags, so the
    // gauge and the elapsed timer do not freeze.
    const unknown = mergeTail({ ...base, busy: false } as any, {
      ok: true, chatId: 'nope', busy: true, busySince: 5, streaming: true, message: null,
    } as any)
    assert.equal(unknown.busy, true)
    assert.equal(unknown.busySince, 5)
    assert.equal(unknown.chats.length, base.chats.length)
  } finally {
    dispose()
  }
})

/**
 * The rule the reasoning timer is built on: "has the answer started?".
 *
 * The engine stores reasoning and answer in ONE markdown string, so the
 * boundary is a property of that string — the reasoning block is only closed
 * once it is complete, which makes the text after the closer the answer. The
 * timer runs from the first reasoning fragment to the first moment this returns
 * true, and the panel renders the same split, so both halves must agree on it.
 */
test('the reasoning/answer boundary is read off the stored markdown', async () => {
  const { hasAnswerBody } = await import('../src/protocol.ts')

  assert.equal(hasAnswerBody(''), false, 'an empty body has no answer')
  assert.equal(hasAnswerBody('答案'), true, 'a reply with no reasoning is all answer')
  assert.equal(
    hasAnswerBody('<details><summary>思考过程</summary>\n\n还在想\n\n</details>'),
    false,
    'a closed reasoning block with nothing after it is still "no answer"',
  )
  assert.equal(
    hasAnswerBody('<details><summary>思考过程</summary>\n\n还在想'),
    false,
    'an unterminated block means the model is still thinking',
  )
  assert.equal(
    hasAnswerBody('<details><summary>思考过程</summary>\n\n想完了\n\n</details>\n\n答案。'),
    true,
    'text after the closer is the answer',
  )
  assert.equal(
    hasAnswerBody('  <details><summary>思考过程</summary>\n\n想完了\n\n</details>\n\n   \n'),
    false,
    'whitespace after the closer is not an answer',
  )
})
