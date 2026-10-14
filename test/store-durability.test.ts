/**
 * Store durability: the single-writer lock, the format-version refusal, and the
 * shape of the write itself.
 *
 * These are the failure modes that do not announce themselves. Two harness
 * instances pointed at one data dir used to overwrite each other a whole
 * history at a time; a file written by a NEWER plugin version was read as this
 * one's format, reduced to the fields this build knew, and then overwritten; and
 * a `tmp + rename` with no fsync could survive as a correctly named, EMPTY file
 * after a power cut. None of those produce an error at the moment they happen.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STORE_VERSION, TranscriptStore } from '../src/store.ts'

/** A store rooted in its own temp dir, with the dir handed back for inspection. */
function sandbox(): string {
  return mkdtempSync(join(tmpdir(), 'dschat-durability-'))
}

/** One stored conversation, so "did it write?" is a real question. */
function seed(store: TranscriptStore): string {
  const chat = store.createChat('deepseek-chat')
  store.appendMessage(chat.id, { id: 'm1', role: 'user', content: '内容', ts: 1 })
  store.flush()
  return chat.id
}

test('a second live instance refuses to write instead of overwriting the first', () => {
  const dir = sandbox()
  try {
    const file = join(dir, 'transcripts.json')
    // A first instance, stopped where it stands — its pid is still alive (it is
    // this very process), so the lock it left behind is a LIVE owner.
    const first = new TranscriptStore({ dataDir: dir })
    seed(first)
    const before = readFileSync(file, 'utf8')
    assert.equal(existsSync(`${file}.lock`), true, 'the first instance holds the lock')

    /*
     * The second instance is simulated by a foreign LIVE pid, because two stores
     * in one process are legitimately the same writer. Pid 1 always exists and is
     * never us; `process.kill(1, 0)` answers EPERM rather than ESRCH, which is
     * exactly the "alive, but not mine" case the store must respect.
     */
    writeFileSync(`${file}.lock`, '1')
    const second = new TranscriptStore({ dataDir: dir })
    assert.match(String(second.storeWarning()), /另一份 DSH 实例/, 'and it says so')
    assert.equal(second.list().length, 1, 'the history is still readable')

    seed(second)
    assert.equal(readFileSync(file, 'utf8'), before, 'nothing was written over the live owner\'s file')
    first.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a lock left by a dead process is taken over, not obeyed forever', () => {
  const dir = sandbox()
  try {
    const file = join(dir, 'transcripts.json')
    // A crash leaves the file behind; a pid that cannot be alive must not lock
    // the reader out of their own history.
    writeFileSync(`${file}.lock`, '2147483646')
    const store = new TranscriptStore({ dataDir: dir })
    assert.equal(store.storeWarning(), undefined, 'a stale lock is not reported as a problem')
    seed(store)
    assert.equal(existsSync(file), true, 'and writing proceeds')
    assert.equal(readFileSync(`${file}.lock`, 'utf8'), String(process.pid), 'the lock now names this process')
    store.dispose()
    assert.equal(existsSync(`${file}.lock`), false, 'a clean shutdown gives the lock back')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file written by a newer version is reported and never overwritten', () => {
  const dir = sandbox()
  try {
    const file = join(dir, 'transcripts.json')
    // A future format: same envelope, one field this build knows nothing about.
    const future = JSON.stringify({
      version: STORE_VERSION + 1,
      activeChatId: 'chat-future',
      futureOnly: { sharded: true },
      chats: [{ id: 'chat-future', title: '未来的对话', createdAt: 1, updatedAt: 1, model: 'm', messages: [], streaming: false }],
    })
    writeFileSync(file, future)
    const store = new TranscriptStore({ dataDir: dir })
    assert.match(String(store.storeWarning()), /新版本/, 'the reader is told why')
    assert.equal(store.list().length, 1, 'what this build can read is still readable')

    seed(store)
    assert.equal(readFileSync(file, 'utf8'), future, 'the newer file is left byte-for-byte alone')
    store.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a completed write leaves no half-written temp file behind', () => {
  const dir = sandbox()
  try {
    const store = new TranscriptStore({ dataDir: dir })
    seed(store)
    const leftovers = readdirSync(dir).filter(name => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [], 'the temp file is renamed, never accumulated')
    const written = JSON.parse(readFileSync(join(dir, 'transcripts.json'), 'utf8')) as { version: number }
    assert.equal(written.version, STORE_VERSION, 'and the file declares the format it was written in')
    store.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/*
 * The durability of the write cannot be observed from the outside — that is the
 * whole point of an fsync — so the ORDER is pinned instead. Getting it wrong is
 * silent: renaming before the data is flushed is exactly the sequence that
 * leaves an empty file after a power cut, and nothing in a normal test run would
 * ever notice.
 */
test('the write flushes the data before the rename and the directory after it', async () => {
  const { readFileSync: read } = await import('node:fs')
  const source = read(join(import.meta.dirname, '..', 'src', 'store.ts'), 'utf8')
  const write = source.slice(source.indexOf('private writeNow(): void {'))
  const body = write.slice(0, write.indexOf('\n  }'))
  const at = (needle: string): number => {
    const index = body.indexOf(needle)
    assert.ok(index > 0, `writeNow must still ${needle}`)
    return index
  }
  const open = at("openSync(tmp, 'w'")
  const write1 = at('writeSync(handle, data)')
  const flush = at('fsyncSync(handle)')
  const rename = at('renameSync(tmp, this.file)')
  const flushDir = at('syncDirectory(this.dataDir)')
  assert.ok(open < write1 && write1 < flush, 'the data is written, then flushed')
  assert.ok(flush < rename, 'and flushed BEFORE the name can point at it')
  assert.ok(rename < flushDir, 'then the directory entry itself is flushed')
  // A tmp name shared by every writer is what let two processes destroy each
  // other's half-written file.
  assert.match(body, /const tmp = `\$\{this\.file\}\.\$\{String\(process\.pid\)\}/, 'the temp name carries the pid')
  assert.match(body, /if \(!this\.writable\) return/, 'and an unwritable store writes nothing at all')
})

/**
 * `deleteMessage` exists for one caller — 重新生成 — and the two things that make
 * it safe for that caller are what this pins:
 *
 *   - it removes exactly the message named, leaving the question it answered (and
 *     everything else) alone. A regenerate that lost its question too would ask
 *     the page for an answer with nothing to answer;
 *   - it clears the chat's `streaming` flag when the removed row was the last
 *     streaming one. The flag drives the panel's caret and the tail feed, so a
 *     chat left flagged would spin forever over a transcript with no assistant
 *     row in it.
 */
test('deleteMessage removes one message, and only that one', () => {
  const dir = sandbox()
  try {
    const store = new TranscriptStore({ dataDir: dir })
    const chat = store.createChat('deepseek-chat')
    store.appendMessage(chat.id, { id: 'u1', role: 'user', content: '问题一', ts: 1 })
    store.appendMessage(chat.id, { id: 'a1', role: 'assistant', content: '回答一', ts: 2 })
    store.appendMessage(chat.id, { id: 'u2', role: 'user', content: '问题二', ts: 3 })
    store.appendMessage(chat.id, { id: 'a2', role: 'assistant', content: '回答二', ts: 4, streaming: true })

    assert.equal(store.deleteMessage(chat.id, 'a2'), true, 'the answer was there to remove')
    assert.deepEqual(
      store.getChat(chat.id)?.messages.map(message => message.id),
      ['u1', 'a1', 'u2'],
      'exactly the named message is gone; the question it answered stays',
    )
    assert.equal(store.getChat(chat.id)?.streaming, false, 'removing the streaming row clears the flag')

    assert.equal(store.deleteMessage(chat.id, 'a2'), false, 'a second delete reports that nothing was removed')
    assert.equal(store.deleteMessage(chat.id, 'nope'), false, 'an unknown id is not an error, just a no-op')
    assert.equal(store.deleteMessage('no-such-chat', 'u1'), false, 'and neither is an unknown conversation')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
