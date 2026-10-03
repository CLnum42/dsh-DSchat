/**
 * The teed-stream capture is a SINGLE page-global object that every
 * `/chat/completion` request on the page writes into. That is fine as long as
 * exactly one turn is ever in flight — and it is not: the engine abandons turns
 * routinely (a submit whose verification fails, a reply that hits its timeout,
 * a stop, a retry), while the page keeps streaming the abandoned request.
 *
 * The observed failure, reported after an overnight idle: the first send of the
 * morning was reported as not sent, the reader retried it, and the retry's
 * answer was stored as 115 characters of the PREVIOUS turn's reasoning
 * fragment — committed as complete, with no error — while the page itself
 * produced the same truncated reply.
 *
 * These tests run the REAL page script (`streamCaptureInit` in
 * `src/engine/engine.ts`, extracted from source and compiled) against a fake
 * page, because that script is what has to hold the line: the round trip that
 * used to let an abandoned request end the next turn's reply loop happens
 * entirely inside the page.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/* ------------------------------------------------------------ script loading */

interface CapturePage {
  [key: string]: any
}

let compiled: string | undefined

/**
 * Extract `streamCaptureInit` from `engine.ts` and compile it to plain JS.
 *
 * Extracted by brace matching rather than by importing the module: the module
 * imports playwright-core and the harness packages, and the function is
 * intentionally NOT exported (only playwright's `addInitScript` serializes it).
 */
async function loadCaptureScript(): Promise<string> {
  if (compiled !== undefined) return compiled
  const source = readFileSync(join(root, 'src/engine/engine.ts'), 'utf8')
  const start = source.indexOf('function streamCaptureInit(')
  assert.ok(start > 0, 'streamCaptureInit exists in engine.ts')
  let depth = 0
  let end = -1
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) { end = i + 1; break }
  }
  assert.ok(end > start, 'the function body is balanced')
  const fn = source.slice(start, end)
  const { transform } = await import('esbuild')
  // No `export`: the compiled script has to run in the vm context as-is, where
  // a top-level function declaration becomes a property of the context object.
  // `cjs` (not `iife`): the iife form tree-shakes the declaration away, since
  // nothing inside the snippet calls it.
  const out = await transform(fn, { loader: 'ts', format: 'cjs', target: 'node22' })
  compiled = out.code
  return compiled
}

/**
 * A fake page whose `XMLHttpRequest` fires the same events the real one does.
 *
 * `append` grows `responseText` and fires `progress` (which is what the capture
 * listens to); `finish` fires `loadend`. Request objects are kept, so a test
 * can drive a specific request — that is how an abandoned turn is simulated.
 */
function fakePage(): CapturePage {
  const XHR = function (this: any) {
    this.listeners = new Map<string, Array<() => void>>()
    this.responseText = ''
    this.status = 0
    this.addEventListener = (type: string, listener: () => void): void => {
      const list = this.listeners.get(type) ?? []
      list.push(listener)
      this.listeners.set(type, list)
    }
    this.fire = (type: string): void => {
      for (const listener of this.listeners.get(type) ?? []) listener()
    }
  }
  // `open`/`send` live on the PROTOTYPE, like the real XHR: the capture wraps
  // them there, and an instance-level copy would shadow the wrapper.
  XHR.prototype.open = function (): void {}
  XHR.prototype.send = function (): void {}
  XHR.prototype.append = function (chunk: string): void {
    this.responseText += chunk
    this.fire('progress')
  }
  XHR.prototype.finish = function (status = 200): void {
    this.status = status
    this.fire('loadend')
  }
  const page: CapturePage = {
    XMLHttpRequest: XHR,
    fetch: () => Promise.reject(new Error('the fake page has no fetch')),
    TextDecoder,
    Response: class { body: unknown; constructor(body: unknown) { this.body = body } },
    requests: [] as any[],
  }
  // A browser global: the script and the engine both reach the page through
  // `window`, so the fake page has to answer to that name as well.
  page.window = page
  return page
}

/**
 * Run the real capture script in a fake page and hand back the page object.
 *
 * Script and call go in as ONE snippet: a function declared in the first
 * `runInContext` call is not visible to the second (each script has its own
 * lexical scope), and the contextified object is the global.
 */
async function installCapture(): Promise<CapturePage> {
  const code = await loadCaptureScript()
  const page = fakePage()
  vm.runInContext(`${code}\nstreamCaptureInit()`, vm.createContext(page), { filename: 'streamCaptureInit.js' })
  return page
}

/** Open and send one `/chat/completion` request, as the page does. */
function chatRequest(page: CapturePage, url = 'https://chat.deepseek.com/api/v0/chat/completion') {
  const xhr = new page.XMLHttpRequest()
  xhr.open('POST', url)
  xhr.send()
  page.requests.push(xhr)
  return xhr
}

/** Arm the next turn exactly as the engine's resetCapture does. */
function armNextTurn(page: CapturePage): void {
  page.__wcGen = (page.__wcGen ?? 0) + 1
  page.__wcStream = { text: '', done: false, started: false, status: 0, error: '' }
  page.__wcActiveReq = undefined
  page.__wcReqLen = 0
  page.__wcCursor = 0
}

/* ----------------------------------------------------------- capture contract */

test('the capture tees only chat/completion and ignores every other request', async () => {
  const page = await installCapture()
  const other = chatRequest(page, 'https://chat.deepseek.com/api/v0/users/current')
  other.append('{"code":0}')
  other.finish()
  assert.equal(page.__wcStream.text, '', 'an unrelated XHR writes nothing into the buffer')
  assert.equal(page.__wcStream.done, false)
})

test('the first request of a turn fills the buffer and reports done', async () => {
  const page = await installCapture()
  armNextTurn(page)
  const xhr = chatRequest(page)
  xhr.append('data: {"v":"你好"}\r\n')
  assert.equal(page.__wcStream.started, true, 'bytes in the buffer are the "a turn began" signal')
  assert.equal(page.__wcStream.done, false, 'and it is not done until the request ends')
  xhr.finish()
  assert.equal(page.__wcStream.done, true)
  assert.equal(page.__wcStream.status, 200)
})

/*
 * THE REGRESSION. This is the overnight-idle sequence, in the order it happens:
 * a turn is submitted, its verification fails and the engine moves on, the
 * reader retries, and only THEN does the abandoned request — still streaming —
 * end. Before the generation tag, that `loadend` set `done` on the retry's
 * buffer, so the retry's reply loop broke on its first tick and committed
 * whatever fragment had arrived (115 characters of the previous turn, in the
 * report) as the complete answer.
 */
test('an abandoned turn cannot end the next turn\'s reply', async () => {
  const page = await installCapture()

  armNextTurn(page)
  const abandoned = chatRequest(page)
  abandoned.append('开发 KET 插件，**不能直接使用受版权保护的教材内容，但可以安全地使用剑桥官方免费发布的考试大纲与')

  // The retry: the engine arms a fresh turn and the user's message goes out.
  armNextTurn(page)
  const retry = chatRequest(page)

  // The abandoned request finally ends — after the retry started.
  abandoned.finish()

  assert.equal(page.__wcStream.done, false, 'the stale loadend must not close the new turn')
  assert.equal(page.__wcStream.text, '', 'and must not leave its own bytes in the new buffer')

  retry.append('data: {"v":"开发插件时，"}\r\n')
  assert.equal(page.__wcStream.text, 'data: {"v":"开发插件时，"}\r\n', 'only the retry\'s bytes are captured')
  retry.finish()
  assert.equal(page.__wcStream.done, true, 'the retry\'s own completion still closes the turn')
})

test('a stale request cannot append bytes into the next turn\'s buffer', async () => {
  const page = await installCapture()
  armNextTurn(page)
  const abandoned = chatRequest(page)
  abandoned.append('旧回合的第一段')
  armNextTurn(page)
  const retry = chatRequest(page)
  abandoned.append('旧回合的第二段')
  assert.equal(page.__wcStream.text, '', 'nothing from the abandoned request reaches the new turn')
  retry.append('新回复')
  assert.equal(page.__wcStream.text, '新回复')
})

/*
 * The page script and the host half have to agree on the generation scheme: the
 * host only bumps a generation when the page reports that it knows about them.
 * If the two numbers drift apart the host silently stops arming anything and
 * the bug above comes back, so the source of both is pinned here.
 */
test('the page script and the host half share one capture generation', async () => {
  const source = readFileSync(join(root, 'src/engine/engine.ts'), 'utf8')
  const host = /const CAPTURE_GENERATION = (\d+)/.exec(source)
  const script = /__wcGenSupported = (\d+)/.exec(source)
  const guard = /__wcGenSupported === (\d+)/.exec(source)
  assert.ok(host !== null, 'the host constant exists')
  assert.ok(script !== null, 'the page script reports the generation it implements')
  assert.ok(guard !== null, 'and the page script guards on that same revision')
  assert.equal(script[1], host[1], 'the page script knows the host\'s generation')
  assert.equal(guard[1], host[1], 'the page script\'s guard matches it')
})

/*
 * Installing the script always REPORTS the revision it implements, which is
 * what lets the host half decide whether arming a generation will do anything:
 * a page carrying an older installed bundle has no `__wcGenSupported`, and the
 * host then keeps the old best-effort behaviour instead of discarding every
 * request that page sends.
 */
test('installing the capture reports the revision it implements', async () => {
  const page = await installCapture()
  assert.equal(page.__wcGenSupported, 6, 'the revision is on the page for the host to read')
  assert.equal(page.__wcGen, 0, 'and nothing is armed until the host arms a turn')
  // A page that predates the scheme: the host's resetCapture only clears, and a
  // normal turn still captures normally.
  const legacy = fakePage()
  vm.runInContext(`${await loadCaptureScript()}\nstreamCaptureInit()`, vm.createContext(legacy))
  delete legacy.__wcGenSupported
  const xhr = chatRequest(legacy)
  xhr.append('回复')
  xhr.finish()
  assert.equal(legacy.__wcStream.text, '回复')
  assert.equal(legacy.__wcStream.done, true)
})

/* ------------------------------------------------------------------ host half */

/*
 * Source-level pins for the host half, in the same spirit as the streaming
 * tests: the arming call has to sit BEFORE the keystroke that submits the turn,
 * and the inline clear it replaced must not come back (it cleared the buffer
 * without revoking the abandoned request that was still writing into it, which
 * is the bug this file exists for).
 */
test('a send arms the capture before it presses Enter', async () => {
  const engine = readFileSync(join(root, 'src/engine/engine.ts'), 'utf8')
  const arm = engine.indexOf('await this.resetCapture()')
  const press = engine.indexOf("await page.keyboard.press('Enter')")
  assert.ok(arm > 0, 'sendImpl arms the capture')
  assert.ok(press > arm, 'and does it before submitting')
  assert.equal(
    /w\.__wcStream = \{ text: '', done: false, started: false, status: 0, error: '' \}\s*\}\)/.test(engine),
    false,
    'the inline buffer clear is gone: arming must revoke the previous turn, not just empty it',
  )
  const reset = /private async resetCapture\(\): Promise<void> \{([\s\S]*?)\n  \}/.exec(engine)
  assert.ok(reset !== null, 'resetCapture exists')
  assert.ok(/__wcGen = \(w\.__wcGen \?\? 0\) \+ 1/.test(reset[1]), 'it advances the generation')
  assert.ok(/__wcCursor = 0/.test(reset[1]), 'and rewinds the read cursor with the buffer')
})

/*
 * The submit check is the engine's only defence against telling the reader a
 * message was not sent when the page actually took it — the failure that made
 * them retry, and the reason the page ended up with the text twice. The third
 * signal (the page's own row for this turn) is what covers a page that is slow
 * to show the streaming UI right after hours of idling.
 */
test('the submit check decides on evidence, not on the clock alone', async () => {
  const engine = readFileSync(join(root, 'src/engine/engine.ts'), 'utf8')
  assert.ok(
    /waitForTurnStart\(SUBMIT_VERIFY_MS, baselineKeys\)/.test(engine),
    'the check is given the pre-submit message list',
  )
  const wait = /private async waitForTurnStart\(([^)]*)\)/.exec(engine)
  assert.ok(wait !== null, 'waitForTurnStart exists')
  assert.ok(/baselineKeys/.test(wait[1]), 'and takes it as a parameter')
  const budget = /const SUBMIT_VERIFY_MS = (\d[\d_]*)/.exec(engine)
  assert.ok(budget !== null, 'the submit budget is a named constant')
  assert.ok(
    Number(budget[1].replaceAll('_', '')) >= 3_000,
    `the budget leaves room for a page that is still waking up (got ${budget[1]} ms)`,
  )

  /*
   * A failed submit must also STOP the page. The check above is deliberately
   * generous, so when it does fail there is a real chance the turn is running
   * and simply showed nothing yet; leaving it alone means it finishes into the
   * conversation, the reader's retry is answered behind it, and the web ends up
   * holding a half reply plus the same question twice.
   */
  const failure = /if \(!started\) \{([\s\S]*?)return \{ ok: false, error: message, code: 'PAGE_CHANGED', stored: true \}/.exec(engine)
  assert.ok(failure !== null, 'the failed-submit branch exists')
  assert.ok(
    /await this\.stopInner\(\)/.test(failure[1]),
    'and stops the page before reporting the failure',
  )
  /*
   * The UNQUEUED form is what it has to call. `sendImpl` already runs inside
   * `SerialQueue.run`, which appends to a promise chain: awaiting the queued
   * `stop()` from in there waits for the task that is doing the waiting. That
   * is a hang with no error and no timeout, so it is pinned by name rather
   * than left to a comment.
   */
  assert.equal(
    /await this\.stop\(\)/.test(failure[1]),
    false,
    'the failed-submit branch must not call the queued stop() from inside the queue',
  )
  assert.ok(
    /async stop\(\): Promise<void> \{\s*await this\.queue\.run\(\(\) => this\.stopInner\(\)\)/.test(engine),
    'the public stop() is the queued wrapper around stopInner()',
  )
})
