/**
 * The browser half's CSRF handshake.
 *
 * The host fence makes a per-run token mandatory on every mutating route, which
 * is only safe because the CLIENT handles it invisibly. Two behaviours carry
 * that weight, and neither is observable from a component test (they render
 * against a stub API) or from the host suite:
 *
 *   - a mutating call must obtain the token BEFORE it is sent, and carry it in
 *     the header — otherwise every button in the panel 403s;
 *   - a host restart rotates the token, and the stale one must be re-read and
 *     the call retried EXACTLY once — otherwise the panel is dead until the
 *     reader reloads the page, and an unbounded retry could re-run a real
 *     operation.
 *
 * These drive the real `DSchatApi` against a scripted `fetch`, so they pin the
 * wire shape (method, header, body) rather than a mock of it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DSCHAT_API } from '../src/protocol.ts'

/** One recorded request plus the answer the script gave it. */
interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

/**
 * Install a scripted fetch, and the two globals the client module needs.
 *
 * `window` is the browser's, and the api module is ordinarily bundled for one;
 * this is the smallest stand-in that lets the module run under `node --test`.
 */
function withFetch(script: (call: Call, index: number) => { status: number; body: unknown }) {
  const calls: Call[] = []
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalFetch = globalThis.fetch
  ;(globalThis as { window?: unknown }).window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  }
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[key.toLowerCase()] = value
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    }
    calls.push(call)
    const answer = script(call, calls.length - 1)
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch
      ;(globalThis as { window?: unknown }).window = originalWindow
    },
  }
}

test('a mutating call fetches the token first and carries it in the header', async () => {
  const { DSchatApi } = await import('../src/client/api.ts')
  const fetcher = withFetch(call => (call.url === DSCHAT_API.token
    ? { status: 200, body: { ok: true, csrfToken: 'token-one' } }
    : { status: 200, body: { ok: true } }))
  try {
    const ok = await new DSchatApi().renameChat('chat-1', '新名字')
    assert.equal(ok.ok, true)
    assert.deepEqual(fetcher.calls.map(call => [call.method, call.url]), [
      ['GET', DSCHAT_API.token],
      ['POST', DSCHAT_API.renameChat],
    ])
    const posted = fetcher.calls[1]!
    assert.equal(posted.headers['x-dschat-token'], 'token-one', 'the token rides the mutating call')
    assert.equal(posted.headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(posted.body), { chatId: 'chat-1', title: '新名字' })
  } finally {
    fetcher.restore()
  }
})

test('a read call never fetches the token and never sends the header', async () => {
  const { DSchatApi } = await import('../src/client/api.ts')
  const fetcher = withFetch(call => (call.url.startsWith(DSCHAT_API.tail)
    ? { status: 200, body: { ok: true, busy: false, streaming: false, message: null } }
    : { status: 500, body: { ok: false, error: 'unexpected' } }))
  try {
    await new DSchatApi().tail('chat-1', 0)
    assert.equal(fetcher.calls.length, 1, 'the poll is one request')
    assert.equal(fetcher.calls[0]!.method, 'GET')
    assert.equal('x-dschat-token' in fetcher.calls[0]!.headers, false, 'a read carries no token')
  } finally {
    fetcher.restore()
  }
})

test('a token rotated by a host restart is re-read and the call retried exactly once', async () => {
  const { DSchatApi } = await import('../src/client/api.ts')
  let posts = 0
  const fetcher = withFetch(call => {
    if (call.url === DSCHAT_API.token) return { status: 200, body: { ok: true, csrfToken: 'token-two' } }
    posts += 1
    // The first attempt still holds the previous run's token; the second does not.
    return posts === 1
      ? { status: 403, body: { ok: false, code: 'CSRF', error: '缺少或无效的 CSRF 令牌，请刷新面板' } }
      : { status: 200, body: { ok: true, count: 3 } }
  })
  try {
    const result = await new DSchatApi().clearChats()
    assert.equal(result.ok, true, 'the retry is what makes a restart invisible to the reader')
    assert.equal(posts, 2, 'exactly one repeat — a blind loop could re-run a real operation')
    assert.deepEqual(fetcher.calls.map(call => `${call.method} ${call.url}`), [
      // The module still holds the previous run's token, which is exactly what a
      // restart looks like from here: the call goes out, is refused, and only
      // then is the token re-read.
      `POST ${DSCHAT_API.clearChats}`,
      `GET ${DSCHAT_API.token}`,
      `POST ${DSCHAT_API.clearChats}`,
    ])
    assert.equal(fetcher.calls[2]!.headers['x-dschat-token'], 'token-two')
  } finally {
    fetcher.restore()
  }
})

test('a second rejection is reported, not retried again', async () => {
  const { DSchatApi } = await import('../src/client/api.ts')
  let posts = 0
  const fetcher = withFetch(call => {
    if (call.url === DSCHAT_API.token) return { status: 200, body: { ok: true, csrfToken: 'token-three' } }
    posts += 1
    return { status: 403, body: { ok: false, code: 'CSRF', error: '缺少或无效的 CSRF 令牌，请刷新面板' } }
  })
  try {
    const result = await new DSchatApi().deleteChat('chat-1')
    assert.equal(result.ok, false, 'a host that keeps refusing is reported to the reader')
    assert.equal(posts, 2, 'the retry is bounded at one')
  } finally {
    fetcher.restore()
  }
})
