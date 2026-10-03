/**
 * End-to-end proof, in a REAL browser: a page that only ever shows its previous
 * answer must never get that answer stored as the reply to a new question.
 *
 * The unit tests in stale-reply.test.ts replace the page with a mock, which
 * pins the decision precisely but never runs a real virtualizer, a real
 * `innerText`, or a real capture script. This file closes that gap: a local
 * page shaped like an opened DeepSeek conversation — `[data-virtual-list-item-key]`
 * rows, a `.ds-think-content` / `.ds-markdown` assistant row, a composer — is
 * driven through the engine's own `send()` against a real headless Chrome.
 *
 * Both directions are replayed, because the guard has to be safe in both:
 *
 *   A. the page renumbers its old rows and NEVER renders an answer for the new
 *      question (the reported failure) → the old reply must NOT be stored, and
 *      the turn must fail with an explanation;
 *   B. the page renders a genuine new answer a moment later → it must still
 *      land, reasoning and all.
 *
 * Nothing here talks to the network or to DeepSeek: the only origin involved is
 * a throwaway HTTP server on 127.0.0.1, and every test gets a temp browser
 * profile.
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
 * The previous turn's reply as the page renders it, transcribed from the real
 * failure: reasoning and answer in one assistant row.
 */
const OLD_THINK = '我们需要回答用户：“这个文件的题目是什么？” 需要根据文件内容判断。文件开头 Page 1 有：口语”与“经典”之间德明《红楼梦》节译与19世纪俄国汉学的知识考古'
const OLD_ANSWER = '这个文件的题目是：**“口语”与“经典”之间——德明《红楼梦》节译与19世纪俄国汉学的知识考古**'

/** This turn's genuine answer, used by the second test. */
const NEW_THINK = '开封是八朝古都，景点之间都不远。'
const NEW_ANSWER = '开封适合自驾游的景点：清明上河园、龙亭公园、铁塔公园、开封府。'

/**
 * The page under test.
 *
 * @param mode - `'stale'` renumbers the old rows on Enter and never renders an
 *   answer for the new question; `'fresh'` renders one after `delayMs`.
 */
function chatPage(mode: 'stale' | 'fresh', delayMs = 150) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>chat</title></head><body>
<div id="list"></div>
<textarea id="chat-input" placeholder="给 DeepSeek 发送消息"></textarea>
<script>
  var busy = false, mode = ${JSON.stringify(mode)}, delayMs = ${String(delayMs)};
  var list = document.getElementById('list');
  var input = document.getElementById('chat-input');

  /** One message row, keyed the way the app's virtualizer keys its items. */
  function row(key, html) {
    var item = document.createElement('div');
    item.setAttribute('data-virtual-list-item-key', key);
    item.innerHTML = html;
    list.appendChild(item);
  }
  function userRow(key, text) {
    row(key, '<div class="ds-user-message">' + text + '</div>');
  }
  function assistantRow(key, think, answer) {
    row(key, '<div class="ds-assistant-message-main-content">'
      + (think ? '<div class="ds-think-content">' + think + '</div>' : '')
      + (answer ? '<div class="ds-markdown"><p>' + answer + '</p></div>' : '')
      + '</div>');
  }

  // The conversation as it stands before the new question.
  userRow('k-1', '这个文件的题目是什么？');
  assistantRow('k-2', ${JSON.stringify(OLD_THINK)}, ${JSON.stringify(OLD_ANSWER)});

  input.addEventListener('keydown', onEnter);
  // Also at the document, the way the real app wires its global shortcuts: a
  // keystroke the composer does not own must still reach the page.
  document.addEventListener('keydown', onEnter);

  function onEnter(event) {
    if (event.key !== 'Enter' || busy) return;
    var question = event.target === input ? input.value : '';
    if (event.target === input) input.value = '';
    busy = true;
    // Every mounted row is renumbered, as a virtualizer does when it re-renders
    // around an insertion. "A key I have not seen" therefore proves nothing —
    // which is precisely how the reported scrape passed its freshness check.
    var mounted = list.querySelectorAll('[data-virtual-list-item-key]');
    for (var i = 0; i < mounted.length; i++) mounted[i].setAttribute('data-virtual-list-item-key', 'k-' + (100 + i));
    userRow('k-200', question);
    if (mode === 'fresh') {
      setTimeout(function () {
        assistantRow('k-201', ${JSON.stringify(NEW_THINK)}, ${JSON.stringify(NEW_ANSWER)});
      }, delayMs);
    }
  }
</script></body></html>`
}

function startServer(html: () => string): Promise<{ url: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html())
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ url: `http://127.0.0.1:${String(port)}/a/chat/s/e2e`, server })
    })
  })
}

async function engineOn(url: string, dataDir: string) {
  const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
  const { TranscriptStore } = await import('../src/store.ts')
  const store = new TranscriptStore({ dataDir })
  const engine = new DeepSeekWebEngine(store as never, {
    dataDir,
    profileDir: join(dataDir, 'profile'),
    headless: true,
    baseUrl: url,
    // The point is what gets stored, not how long the loop waits — but the
    // budget still has to clear the reply loop's own DOM-stability window.
    replyTimeoutMs: 4_000,
  })
  const chat = store.createChat('deepseek-reasoner')
  store.appendMessage(chat.id, { id: 'u1', role: 'user', content: '这个文件的题目是什么？', ts: Date.now() })
  store.appendMessage(chat.id, {
    id: 'a1',
    role: 'assistant',
    content: `<details><summary>思考过程</summary>\n\n${OLD_THINK}\n\n</details>\n\n${OLD_ANSWER}`,
    ts: Date.now(),
  })
  return { engine, store, chatId: chat.id }
}

/** Skip the file's engine tests when no Chrome is installed (CI, fresh box). */
async function chromeAvailable(t: { skip: (reason: string) => void }): Promise<boolean> {
  try {
    const { chromium } = await import('playwright-core')
    const probe = await chromium.launch({ channel: 'chrome', headless: true })
    await probe.close()
    return true
  } catch (error) {
    t.skip(`Chrome unavailable, stale-reply e2e skipped: ${String(error)}`)
    return false
  }
}

test('a real page that only shows its old answer never has it stored as the new reply', async t => {
  if (!(await chromeAvailable(t))) return
  const { url, server } = await startServer(() => chatPage('stale'))
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-stale-e2e-'))
  try {
    const { engine, store, chatId } = await engineOn(url, dataDir)
    const result = await engine.send('开封有什么适合自驾游的景点？', true)
    store.flush()
    const messages = store.getChat(chatId)?.messages ?? []
    const replies = messages.filter(message => message.role === 'assistant')

    assert.equal(result.ok, false, 'the turn must not report success')
    assert.match(String(result.error), /没有回复这次提问/, `and must explain itself: ${String(result.error)}`)
    assert.equal(replies.length, 1, 'the old answer is still the only reply in the transcript')
    /*
     * The assertion has to be about the COPY, not about the old answer's text:
     * the previous reply is the one that legitimately contains 「口语”与
     * “经典”之间」 (it answers a question about that very document). What must
     * not exist is a SECOND row carrying it — which is exactly what the report
     * showed: the same answer stored twice, the second time as this question's.
     */
    assert.equal(
      messages.filter(message => (message.content ?? '').includes('口语”与“经典”之间')).length,
      1,
      'the old answer appears exactly once, as its own turn\'s reply',
    )
    assert.ok(
      !messages.some(message => (message.content ?? '').includes('如果你需要')),
      'and nothing new was invented for this turn',
    )
    assert.equal(messages.filter(message => message.role === 'user').length, 2, 'the question is kept for a retry')
    await engine.disposeBrowser()
  } finally {
    server.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('a real page that renders the new answer is still followed', async t => {
  if (!(await chromeAvailable(t))) return
  const { url, server } = await startServer(() => chatPage('fresh'))
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-fresh-e2e-'))
  try {
    const { engine, store, chatId } = await engineOn(url, dataDir)
    const result = await engine.send('开封有什么适合自驾游的景点？', true)
    store.flush()
    const replies = (store.getChat(chatId)?.messages ?? []).filter(message => message.role === 'assistant')

    assert.equal(result.ok, true, `the fresh answer must land: ${String(result.error)}`)
    assert.match(result.reply, /清明上河园/, 'the reply is the answer to THIS question')
    assert.match(result.reply, /开封是八朝古都/, 'reasoning included')
    assert.equal(replies.length, 2, 'the old reply plus the new answer')
    assert.match(replies[1]?.content ?? '', /清明上河园/)
    await engine.disposeBrowser()
  } finally {
    server.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
