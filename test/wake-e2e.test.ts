/**
 * End-to-end proof of the "one click, one browser" fix — with a REAL browser.
 *
 * The unit tests in host-smoke.test.ts replace the engine's launch seam with a
 * recorder, which pins the DECISION precisely but never runs
 * `chromium.launchPersistentContext`. This file closes that gap: a real headless
 * Chrome is pointed at a local page that looks like the chat UI (it has a
 * `<textarea>`, which is exactly what `isLoggedIn` reads), and the reported
 * sequence is replayed against it:
 *
 *   click the composer → wake   (one launch)
 *   …then send          → wake  (must NOT launch again)
 *   …then 「打开登录窗口」 →        (must NOT dispose the working browser)
 *
 * Nothing here talks to the network or to DeepSeek: the only origin involved is
 * a throwaway HTTP server on 127.0.0.1. That also means the test never touches
 * the user's real browser profile — it gets a temp one.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A stand-in for the DeepSeek chat page.
 *
 * `isLoggedIn()` is deliberately the only contract that matters here: a
 * `<textarea>` means "the chat UI is loaded" and a URL without `/sign_in` means
 * "not the login screen". Everything this test asserts is about launches, not
 * about chatting, so the page does not need to be more convincing than that.
 */
function startFakeChatServer(): Promise<{ url: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>chat</title></head>'
      + '<body><div id="app"><textarea placeholder="给 DeepSeek 发送消息"></textarea>'
      + '</div></body></html>')
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ url: `http://127.0.0.1:${String(port)}/a/chat/s/e2e`, server })
    })
  })
}

test('waking a real browser twice launches it once, and the login window reuses it', async (t) => {
  const { chromium } = await import('playwright-core')
  let probe
  try {
    probe = await chromium.launch({ channel: 'chrome', headless: true })
  } catch (error) {
    t.skip(`Chrome unavailable, engine e2e skipped: ${String(error)}`)
    return
  }
  await probe.close()

  const { url, server } = await startFakeChatServer()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-wake-e2e-'))
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      // `--no-proxy-server` is the engine's own default and is what lets this
      // reach a loopback origin.
      { dataDir, profileDir: join(dataDir, 'profile'), headless: true, baseUrl: url },
    )

    // 1. The click. One launch, and the page it produced is usable.
    const first = await engine.wake()
    assert.equal(first.ok, true, `the wake failed: ${String(first.error)}`)
    assert.equal(first.launched, true, 'a cold engine launches on the first wake')
    assert.equal(first.loggedIn, true, 'the fake chat UI counts as signed in')

    // 2. The send. Same browser — this is the reported "第二次又启动".
    const second = await engine.wake()
    assert.equal(second.launched, false, 'the second wake reuses the running browser')
    assert.equal(second.loggedIn, true)

    // 3. 「打开登录窗口」 on a signed-in page. The old code disposed the working
    //    browser here and opened a headed one; it must now be a no-op.
    const opened = await engine.openLoginWindow()
    assert.equal(opened.ok, true)
    assert.equal(opened.reused, true, 'the authenticated browser is reused')
    assert.equal(opened.launched, false, 'and nothing is launched for it')
    assert.equal(engine.pageUrl(), url, 'the same page is still the engine page')

    await engine.disposeBrowser()
  } finally {
    server.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
