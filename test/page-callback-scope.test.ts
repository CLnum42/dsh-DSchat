/**
 * The page callbacks must be SELF-CONTAINED.
 *
 * `page.evaluate(fn, arg)` does not call `fn` from here — playwright stringifies
 * its source and runs it in the BROWSER, with the harness's Node module scope
 * gone. A callback that closes over a module-level constant or helper therefore
 * compiles, type-checks and passes every unit test (the tests replace `evaluate`
 * with a mock), and then throws `ReferenceError` at run time in the real page.
 *
 * That is not a hypothetical: the first version of the conversation-list reader
 * wrote `'x-client-version': WEB_CLIENT_VERSION` and `updatedAt: toEpochMs(...)`
 * inside the callback. Live, on the real account, `listWebConversations()`
 * returned **100 conversations with no pins and no timestamps** — the DOM
 * fallback — instead of the 923 rows the endpoint serves, because the callback's
 * own `try`/`catch` swallowed the `ReferenceError` and reported "the endpoint
 * did not answer". Nothing in the suite could see it: the mock never runs the
 * source.
 *
 * So this test reads the source and asserts the invariant directly. Everything a
 * callback needs has to arrive as its ARGUMENT, exactly the way
 * `listWebConversationsViaApi` and `fetchWebHistory` now do it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const source = readFileSync(join(root, 'src/engine/engine.ts'), 'utf8')

/**
 * Every name declared at module scope in the engine.
 *
 * A page callback that mentions one of these is referring to something that does
 * not exist where it runs.
 */
function moduleScopeNames(text: string): string[] {
  const names: string[] = []
  const pattern = /^(?:export\s+)?(?:const|let|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm
  for (const match of text.matchAll(pattern)) {
    const name = match[1]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * The body of every arrow function passed to `evaluate(...)` / `evalPage(...)`.
 *
 * Located by scanning from each call site to the `=>` that follows it and then
 * matching braces — good enough for this file, which is formatted by hand. A
 * call whose parentheses have already closed before the `=>` (the
 * `page.evaluate(fn)` pass-through inside `evalPage`) is skipped: its "callback"
 * lives somewhere else entirely.
 */
function pageCallbackBodies(text: string): Array<{ start: number; body: string }> {
  const bodies: Array<{ start: number; body: string }> = []
  const call = /\.(?:evaluate|evalPage)\(/g
  for (const match of text.matchAll(call)) {
    const from = (match.index ?? 0) + match[0].length
    const arrow = text.indexOf('=>', from)
    if (arrow < 0) continue
    const head = text.slice(from, arrow)
    // `head` holds this call's parameter list; a `)` that takes the depth below
    // zero means the call closed first (`evaluate(fn)`), not a callback.
    let depth = 0
    let closed = false
    for (const char of head) {
      if (char === '(') depth += 1
      else if (char === ')') {
        depth -= 1
        if (depth < 0) { closed = true; break }
      }
    }
    if (closed) continue
    const open = arrow + 2 + (text.slice(arrow + 2).match(/^\s*/)?.[0].length ?? 0)
    if (text[open] !== '{') continue
    let braces = 0
    let index = open
    for (; index < text.length; index += 1) {
      const char = text[index]
      if (char === '{') braces += 1
      else if (char === '}') {
        braces -= 1
        if (braces === 0) break
      }
    }
    bodies.push({ start: match.index ?? 0, body: text.slice(open, index + 1) })
  }
  return bodies
}

/**
 * The callback body with comments and string literals blanked out.
 *
 * A name inside a comment or a string is not a reference to anything: the
 * callback that documents WHY it cannot call `toEpochMs` was flagged by the
 * first version of this test, which is a false positive that would train a
 * reader to ignore the check. Braces inside `${…}` are dropped with the rest of
 * the template literal, which only means an interpolation is not scanned — the
 * guard is a heuristic for the common mistake, not a parser.
 */
function stripNonCode(body: string): string {
  let out = ''
  let index = 0
  while (index < body.length) {
    const char = body[index]
    const next = body[index + 1]
    if (char === '/' && next === '/') {
      while (index < body.length && body[index] !== '\n') { out += ' '; index += 1 }
      continue
    }
    if (char === '/' && next === '*') {
      while (index < body.length && !(body[index] === '*' && body[index + 1] === '/')) { out += ' '; index += 1 }
      out += '  '
      index += 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      out += ' '
      index += 1
      while (index < body.length && body[index] !== quote) {
        if (body[index] === '\\') { out += '  '; index += 2; continue }
        out += ' '
        index += 1
      }
      out += ' '
      index += 1
      continue
    }
    out += char
    index += 1
  }
  return out
}

test('every page callback is self-contained, with host state passed as arguments', () => {
  const names = moduleScopeNames(source)
  assert.ok(names.includes('WEB_CLIENT_VERSION'), 'the scan found the module scope (sanity check)')
  assert.ok(names.length > 20, 'and found the whole file')

  const bodies = pageCallbackBodies(source)
  /*
   * A floor, not an exact count: the scan skips the one call site that passes a
   * function through by name (`page.evaluate(fn)` inside `evalPage`), and an
   * exact number would fail for the wrong reason every time a callback is added.
   */
  assert.ok(bodies.length >= 10, `found the page callbacks (${String(bodies.length)})`)
  assert.ok(
    bodies.some(({ body }) => body.includes('chat_session/fetch_page')),
    'including the conversation-list reader',
  )

  /*
   * The rule's own check: a callback that mentions a module-scope name IS
   * caught. Without this the whole test could pass by scanning nothing useful.
   */
  const planted = 'async (sid) => { const v = WEB_CLIENT_VERSION; return v }'
  const caught = moduleScopeNames(source).some(name => new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(planted))
  assert.equal(caught, true, 'the rule flags a host-side name inside a callback')

  for (const { start, body } of bodies) {
    const line = source.slice(0, start).split('\n').length
    const code = stripNonCode(body)
    for (const name of names) {
      const used = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(code)
      assert.equal(
        used, false,
        `the page callback at line ${String(line)} references "${name}", which exists only on the host side — ` +
        'pass it as an argument to evaluate() instead (playwright runs the source in the browser).',
      )
    }
    assert.equal(
      /(?<![\w$.])this\./.test(code), false,
      `the page callback at line ${String(line)} uses \`this\`, which is not the engine inside the page`,
    )
  }
})

test('the conversation-list reader sends the values the page needs as its argument', () => {
  /*
   * The two names the real page needs are the client version (the server gates
   * its cursor on the client headers — without them it answers with the first
   * page every time, measured) and the page cap. Both travel in the argument
   * object, which is the only way they can reach the browser.
   */
  assert.match(
    source,
    /\{ maxPages: WEB_CHAT_PAGE_LIMIT, clientVersion: WEB_CLIENT_VERSION \}/,
    'the list reader passes its page cap and client version as the evaluate argument',
  )
  assert.match(
    source,
    /\{ sid: sessionId, clientVersion: WEB_CLIENT_VERSION \}/,
    'and so does the history reader',
  )
})
