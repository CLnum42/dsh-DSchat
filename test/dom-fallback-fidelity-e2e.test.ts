/**
 * End-to-end proof, in a REAL browser: the DOM fallback keeps every part of a
 * scraped reply.
 *
 * The unit tests in html-markdown.test.ts pin the round trip precisely, but they
 * call `parseMarkup` directly. This file closes the remaining gap by driving the
 * real path — the engine's in-page scraper hands back `clone.innerHTML`, which
 * is then round-tripped Node-side — with a real headless Chrome, and asserts on
 * what actually lands in the transcript store.
 *
 * Why it matters: the DOM fallback is the path a reply takes when its SSE
 * capture never installed, and a `dom`-sourced recover takes it for a whole
 * conversation. There is no other copy of that text, so anything the round trip
 * loses is gone for good — and it used to lose a great deal. A `<br>` collected
 * the rest of the fragment as its children (the parser only knew `/>` as
 * self-closing) and the converter dropped them; an element never closed, so
 * every sibling nested inside it; and `<pre>`/`<code>` bodies were read from a
 * `textContent` that parsed nodes do not carry. One code block in a reply took
 * the code AND everything after it.
 *
 * Nothing here talks to the network or to DeepSeek: the only origin involved is
 * a throwaway HTTP server on 127.0.0.1, and every test gets a temp profile.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The previous turn's reply, so the replica guard has something to compare. */
const OLD_ANSWER = '上一轮的回复：这里是旧内容。'

/**
 * This turn's answer, rendered the way the page renders one.
 *
 * Every shape here is one the fidelity bugs destroyed, and several of them
 * appear AFTER a `<br>` or an `<img>` — which is where the old parser stopped
 * reading. The `<pre>` body and the checkbox labels are the two that vanished
 * silently even without a void element in front of them.
 */
const ANSWER_HTML = [
  '<p>第一段<br>换行之后的文字</p>',
  '<p>第二段<img src="https://example.test/x.png" alt="示意图">图片之后的文字</p>',
  '<pre><code class="language-python">print("代码块正文")</code></pre>',
  '<ul><li><input type="checkbox" checked>已完成事项</li><li><input type="checkbox">未完成事项</li></ul>',
  '<hr>',
  '<p>最后一段</p>',
].join('')

/** The page under test: one assistant row that gains an answer after Enter. */
function chatPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>chat</title></head><body>
<div id="list"></div>
<textarea id="chat-input" placeholder="给 DeepSeek 发送消息"></textarea>
<script>
  var busy = false;
  var list = document.getElementById('list');
  var input = document.getElementById('chat-input');
  var ANSWER = ${JSON.stringify(ANSWER_HTML)};

  function row(key, html) {
    var item = document.createElement('div');
    item.setAttribute('data-virtual-list-item-key', key);
    item.innerHTML = html;
    list.appendChild(item);
  }
  function userRow(key, text) {
    row(key, '<div class="ds-user-message">' + text + '</div>');
  }
  function assistantRow(key, answer) {
    row(key, '<div class="ds-assistant-message-main-content">'
      + '<div class="ds-markdown">' + answer + '</div></div>');
  }

  // The conversation as it stands before the new question.
  userRow('k-1', '上一轮的问题');
  assistantRow('k-2', '<p>' + ${JSON.stringify(OLD_ANSWER)} + '</p>');

  input.addEventListener('keydown', onEnter);
  document.addEventListener('keydown', onEnter);

  function onEnter(event) {
    if (event.key !== 'Enter' || busy) return;
    var question = event.target === input ? input.value : '';
    if (event.target === input) input.value = '';
    busy = true;
    // Renumber the mounted rows, as the app's virtualizer does when it
    // re-renders around an insertion.
    var mounted = list.querySelectorAll('[data-virtual-list-item-key]');
    for (var i = 0; i < mounted.length; i++) mounted[i].setAttribute('data-virtual-list-item-key', 'k-' + (100 + i));
    userRow('k-200', question);
    setTimeout(function () { assistantRow('k-201', ANSWER); }, 150);
  }
</script></body></html>`
}

function startServer(html: string): Promise<{ url: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ url: `http://127.0.0.1:${String(port)}/a/chat/s/fidelity`, server })
    })
  })
}

/** An engine pointed at the throwaway page, with the previous turn stored. */
async function engineOn(url: string, dataDir: string) {
  const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
  const { TranscriptStore } = await import('../src/store.ts')
  const store = new TranscriptStore({ dataDir })
  const engine = new DeepSeekWebEngine(store as never, {
    dataDir,
    profileDir: join(dataDir, 'profile'),
    headless: true,
    baseUrl: url,
    replyTimeoutMs: 4_000,
  })
  const chat = store.createChat('deepseek-chat')
  store.appendMessage(chat.id, { id: 'u1', role: 'user', content: '上一轮的问题', ts: Date.now() })
  store.appendMessage(chat.id, { id: 'a1', role: 'assistant', content: OLD_ANSWER, ts: Date.now() })
  return { engine, store, chatId: chat.id }
}

/** Skip when no Chrome is installed (CI, a fresh box). */
async function chromeAvailable(t: { skip: (reason: string) => void }): Promise<boolean> {
  try {
    const { chromium } = await import('playwright-core')
    const probe = await chromium.launch({ channel: 'chrome', headless: true })
    await probe.close()
    return true
  } catch (error) {
    t.skip(`Chrome unavailable, DOM-fidelity e2e skipped: ${String(error)}`)
    return false
  }
}

test('a real DOM-fallback reply keeps its line breaks, image, code and checkboxes', async t => {
  if (!(await chromeAvailable(t))) return
  const { url, server } = await startServer(chatPage())
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-fidelity-e2e-'))
  try {
    const { engine, store, chatId } = await engineOn(url, dataDir)
    const result = await engine.send('这一轮的问题', true)
    store.flush()
    const reply = (store.getChat(chatId)?.messages ?? []).filter(message => message.role === 'assistant').at(-1)
    const content = reply?.content ?? ''

    assert.equal(result.ok, true, `the turn must land: ${String(result.error)}`)
    /*
     * One assertion per shape that used to disappear. They are grouped by CAUSE
     * rather than by tag, so a future edit that fixes one and breaks another
     * fails with a sentence that says which rule it broke.
     */
    assert.match(content, /第一段\n换行之后的文字/, 'text after a <br> (void element, and the parser root cause)')
    assert.match(content, /图片之后的文字/, 'text after an <img>')
    assert.ok(content.includes('![示意图](https://example.test/x.png)'), 'and the image still becomes markdown')
    assert.match(content, /```python\nprint\("代码块正文"\)/, 'a fenced block keeps its language and body')
    assert.match(content, /最后一段/, 'text after an <hr>')
    assert.match(content, /\[x\]\s*已完成事项/, 'a checked checkbox keeps its tick and its label')
    assert.match(content, /\[ \]\s*未完成事项/, 'and an unchecked one stays unchecked')
    assert.ok(content.includes('---'), 'the rule itself survives')
    await engine.disposeBrowser()
  } finally {
    server.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
