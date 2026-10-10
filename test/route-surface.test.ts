/**
 * The route surface the panel talks to, checked against the one the host serves.
 *
 * `DSCHAT_API` maps a NAME to a path, and the client builds every URL from it,
 * so a mistake in this table is not a typo the reader can see — it is a call to
 * a route that either does not exist or does something else, answered with an
 * `ok: false` that most callers treat as "nothing to do".
 *
 * That is exactly what happened to conversation search. The map carried the key
 * `search` TWICE — once for `GET /search-conversations` and once for the
 * web-search TOGGLE, `POST /search` — and in an object literal the later key
 * silently wins. `DSCHAT_API.search` therefore resolved to the toggle, so
 * searching a conversation's text became a GET against a write-guarded route:
 * a 405, swallowed by the search filter's `answer.ok !== true` early return. No
 * type error, no runtime error, just a search box that only ever matched titles.
 *
 * Two invariants, both cheap, both of which would have caught it:
 *
 *   1. every key in the literal is unique — checked against the SOURCE, because
 *      the duplicate is gone by the time the object exists;
 *   2. every path the client uses is a path the host registers, and the two
 *      search-shaped names resolve to the two search-shaped routes.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSCHAT_API } from '../src/protocol.ts'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** The literal's lines, as `name: 'path'`, with the comments between them skipped. */
function apiEntries(): Array<{ name: string; path: string; line: number }> {
  const source = readFileSync(join(root, 'src/protocol.ts'), 'utf8')
  const entries: Array<{ name: string; path: string; line: number }> = []
  source.split('\n').forEach((text, index) => {
    const match = /^\s{2}([A-Za-z][A-Za-z0-9]*): '(\/api\/dsh-dschat\/[^']*)',/.exec(text)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      entries.push({ name: match[1], path: match[2], line: index + 1 })
    }
  })
  return entries
}

/** Every route the host actually registers. */
function registeredPaths(): string[] {
  const source = readFileSync(join(root, 'src/routes.ts'), 'utf8')
  return [...source.matchAll(/path: '(\/api\/dsh-dschat\/[^']+)'/g)]
    .map(match => match[1])
    .filter((path): path is string => path !== undefined)
}

test('no two endpoints share a name in DSCHAT_API', () => {
  const seen = new Map<string, number>()
  const clashes: string[] = []
  for (const entry of apiEntries()) {
    const first = seen.get(entry.name)
    if (first === undefined) seen.set(entry.name, entry.line)
    else clashes.push(`\`${entry.name}\` at line ${String(first)} and line ${String(entry.line)}`)
  }
  assert.deepEqual(
    clashes, [],
    'a repeated key is silently dropped, taking its route with it',
  )
})

test('every route the panel calls is one the host serves', () => {
  const registered = new Set(registeredPaths())
  const orphans = apiEntries()
    .filter(entry => !registered.has(entry.path))
    .map(entry => `${entry.name} → ${entry.path}`)
  assert.deepEqual(orphans, [], 'these constants point at paths no route registers')
})

test('conversation search and the web-search toggle are different routes', () => {
  /*
   * The two names a shared key used to collapse: one is a read of the stored
   * history, the other a write to the live page. Existence is not enough —
   * they have to be DIFFERENT, and each has to be the one it says it is.
   */
  assert.equal(DSCHAT_API.searchConversations, '/api/dsh-dschat/search-conversations')
  assert.equal(DSCHAT_API.search, '/api/dsh-dschat/search')
  assert.notEqual(DSCHAT_API.searchConversations, DSCHAT_API.search)
})
