/**
 * The incremental web → local sync.
 *
 * `mergeHistory` decides what a re-sync does to a transcript the reader already
 * has, and every rule in it exists because replacing the whole list was wrong in
 * a way that shows: an id is the panel's handle on a row (the tail delta, the
 * search landing mark, the question navigator's `data-message-id`, the anchor a
 * fresh send scrolls to), the timestamp is the reader's own record of when they
 * asked, and `thinkingMs` / `attachments` are facts measured or chosen LOCALLY
 * that the web copy does not carry at all.
 *
 * These are pure-function tests: no store, no browser.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeHistory, contentKey } from '../src/store.ts'
import type { DSchatMessage } from '../src/protocol.ts'

/** One message, with only the fields a case cares about spelled out. */
function message(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  extra: Partial<DSchatMessage> = {},
): DSchatMessage {
  return { id, role, content, ts: Number(id.replace(/\D/g, '')) || 1, ...extra }
}

/** The web's copy of one turn pair. */
function turn(n: number): DSchatMessage[] {
  return [
    message(`web-u${String(n)}`, 'user', `第 ${String(n)} 个问题：请展开讲讲。`),
    message(`web-a${String(n)}`, 'assistant', `第 ${String(n)} 个回答：这里是正文。`),
  ]
}

test('an empty store takes the web copy whole', () => {
  const incoming = [...turn(1), ...turn(2)]
  const merged = mergeHistory([], incoming)
  assert.equal(merged.messages.length, 4)
  assert.equal(merged.added, 4)
  assert.equal(merged.changed, true)
})

test('a re-sync with nothing new rewrites nothing at all', () => {
  const stored = [...turn(1), ...turn(2)]
  const merged = mergeHistory(stored, [...turn(1), ...turn(2)])
  assert.equal(merged.changed, false, 'an unchanged conversation is not persisted')
  assert.equal(merged.added, 0)
  assert.equal(merged.completed, 0)
  assert.deepEqual(merged.messages, stored, 'and the very same records come back')
})

test('only the missing turns are appended, the stored ones keep their identity', () => {
  const stored = [
    message('local-1', 'user', '第 1 个问题：请展开讲讲。', { ts: 1_000 }),
    message('local-2', 'assistant', '第 1 个回答：这里是正文。', { ts: 2_000, thinkingMs: 7_200 }),
  ]
  const merged = mergeHistory(stored, [...turn(1), ...turn(2)])
  assert.equal(merged.added, 2, 'the second turn is what was missing')
  assert.equal(merged.completed, 0)
  assert.equal(merged.messages.length, 4)
  assert.equal(merged.messages[0]?.id, 'local-1', 'the stored id is the survivor')
  assert.equal(merged.messages[0]?.ts, 1_000, 'and so is the timestamp the reader saw')
  assert.equal(merged.messages[1]?.thinkingMs, 7_200, 'thinkingMs is measured locally and is never dropped')
  assert.equal(merged.messages[3]?.id, 'web-a2', 'the appended turn is the web record')
})

test('a truncated local reply is completed in place, not duplicated', () => {
  const stored = [
    message('local-1', 'user', '第 1 个问题：请展开讲讲。'),
    message('local-2', 'assistant', '第 1 个回答：这里是正文。后面还有一半没有抓到的内容。'),
  ]
  // The web has the full reply; the stored copy is its first half.
  const full: DSchatMessage[] = [
    message('web-u1', 'user', '第 1 个问题：请展开讲讲。'),
    message('web-a1', 'assistant', '第 1 个回答：这里是正文。后面还有一半没有抓到的内容。这是后面那一半。'),
  ]
  const merged = mergeHistory(stored, full)
  assert.equal(merged.messages.length, 2, 'one message, not two')
  assert.equal(merged.completed, 1)
  assert.equal(merged.messages[1]?.id, 'local-2')
  assert.match(merged.messages[1]?.content ?? '', /这是后面那一半/)
})

test('a store that only ever held the LAST exchange is completed, not doubled', () => {
  // The old DOM-only sync stored whatever rows the virtual list had mounted —
  // in practice the tail of the conversation. The second sync must splice the
  // missing head in front of it instead of appending the whole web copy after.
  const stored = turn(9)
  const incoming = [...turn(1), ...turn(2), ...turn(3), ...turn(9)]
  const merged = mergeHistory(stored, incoming)
  assert.equal(merged.messages.length, 8, 'the tail is not duplicated')
  assert.equal(merged.added, 6)
  assert.deepEqual(
    merged.messages.map(item => item.id),
    ['web-u1', 'web-a1', 'web-u2', 'web-a2', 'web-u3', 'web-a3', 'web-u9', 'web-a9'],
    'the head is the web copy, and the stored tail keeps its own records in place',
  )
})

test('a message only the store has is kept, in its place', () => {
  const stored = [
    message('local-u1', 'user', '第 1 个问题：请展开讲讲。'),
    message('local-x', 'user', '这条是本地发出去的，网页端没有。'),
    message('local-a1', 'assistant', '第 1 个回答：这里是正文。'),
  ]
  const merged = mergeHistory(stored, [...turn(1), ...turn(2)])
  assert.equal(merged.kept, 1, 'the local-only message is reported as kept')
  assert.deepEqual(
    merged.messages.map(item => item.id),
    ['local-u1', 'local-x', 'local-a1', 'web-u2', 'web-a2'],
    'and it stays between the turns it belongs to',
  )
})

test('a regenerated answer replaces the text instead of appearing twice', () => {
  const stored = [
    message('local-u1', 'user', '第 1 个问题：请展开讲讲。'),
    message('local-a1', 'assistant', '第 1 个回答：旧的那一版。'),
  ]
  const regenerated: DSchatMessage[] = [
    message('web-u1', 'user', '第 1 个问题：请展开讲讲。'),
    message('web-a1', 'assistant', '第 1 个回答：重新生成的那一版。'),
  ]
  const merged = mergeHistory(stored, regenerated)
  assert.equal(merged.messages.length, 2, 'still one answer')
  assert.equal(merged.messages[1]?.id, 'local-a1', 'wearing the id the panel already knows')
  assert.equal(merged.messages[1]?.content, '第 1 个回答：重新生成的那一版。')
  assert.equal(merged.replaced, 1)
})

test('the reasoning block does not stop two copies of a message from matching', () => {
  // The DOM scraper and the history endpoint render the same reply differently:
  // one carries the inline <details> block, the other does not. Comparing raw
  // text found no overlap at all, which is what made an old short import
  // impossible to repair.
  const bare = contentKey('第 1 个回答：这里是正文。')
  const withThinking = contentKey('<details><summary>思考过程</summary>\n\n先想一下。\n\n</details>\n\n第 1 个回答：这里是正文。')
  assert.equal(bare, withThinking)

  const stored = [message('local-1', 'user', '第 1 个问题：请展开讲讲。'), message('local-2', 'assistant', '第 1 个回答：这里是正文。')]
  const incoming = [
    message('web-u1', 'user', '第 1 个问题：请展开讲讲。'),
    message('web-a1', 'assistant', '<details><summary>思考过程</summary>\n\n先想一下。\n\n</details>\n\n第 1 个回答：这里是正文。'),
  ]
  const merged = mergeHistory(stored, incoming)
  assert.equal(merged.added, 0, 'the same turn is recognised')
  assert.equal(merged.messages.length, 2)
  assert.equal(merged.messages[0]?.id, 'local-1')
})

test('two copies that share nothing fall back to the longer list, never to a guess', () => {
  const stored = [
    message('local-1', 'user', '完全不同的文本甲'),
    message('local-2', 'assistant', '完全不同的文本乙'),
  ]
  // Shorter web copy: the stored transcript is never truncated.
  const shorter = mergeHistory(stored, [message('web-u1', 'user', '完全不同的文本丙')])
  assert.equal(shorter.changed, false)
  assert.deepEqual(shorter.messages, stored)
  // Longer web copy: it wins, exactly as the pre-merge behaviour did — pairing
  // two unrelated messages by position would invent turns.
  const longer = mergeHistory(stored, [...turn(1), ...turn(2)])
  assert.equal(longer.changed, true)
  assert.equal(longer.messages.length, 4)
  assert.equal(longer.messages[0]?.id, 'web-u1')
})

test('the same text sent twice stays two turns', () => {
  const stored = [
    message('local-1', 'user', '继续'),
    message('local-2', 'assistant', '好的，我接着说。'),
    message('local-3', 'user', '继续'),
    message('local-4', 'assistant', '这是第二段。'),
  ]
  const merged = mergeHistory(stored, [...stored])
  assert.equal(merged.changed, false)
  assert.equal(merged.messages.length, 4)
})

/*
 * The stretch that pairs by POSITION but is not the same turns.
 *
 * This is the silent data-loss case, and it was constructed from the real
 * report: a turn that exists only locally (the reader asked it in this panel and
 * the web never stored it) sits in the same slot as an unrelated web turn, so the
 * two stretches line up one-for-one on length and roles. The old rule settled
 * such a stretch "in place" — the web text OVERWROTE the local text while the
 * local id stayed — so the reader's own question disappeared from a conversation
 * that looked untouched. Nothing on screen said anything had been lost.
 */
test('a local-only turn in an unrelated slot is kept, never overwritten in place', () => {
  const stored = [
    message('local-u1', 'user', '第一问：请讲讲方案。'),
    message('local-a1', 'assistant', '第一答：这是方案。'),
    message('local-uX', 'user', '本地独有：这段话只在本地存过。'),
    message('local-aX', 'assistant', '本地独有：这是它对应的回答。'),
    message('local-u2', 'user', '第二问：还有别的吗？'),
    message('local-a2', 'assistant', '第二答：还有。'),
  ]
  const incoming = [
    message('web-u1', 'user', '第一问：请讲讲方案。'),
    message('web-a1', 'assistant', '第一答：这是方案。'),
    message('web-uY', 'user', '无关：网页端的另一段提问。'),
    message('web-aY', 'assistant', '无关：网页端的另一段回答。'),
    message('web-u2', 'user', '第二问：还有别的吗？'),
    message('web-a2', 'assistant', '第二答：还有。'),
  ]
  const merged = mergeHistory(stored, incoming)

  // The local turn survives VERBATIM, and is not wearing the web's text.
  const keptLocalUser = merged.messages.find(item => item.id === 'local-uX')
  const keptLocalAnswer = merged.messages.find(item => item.id === 'local-aX')
  assert.equal(keptLocalUser?.content, '本地独有：这段话只在本地存过。', 'the local question is not overwritten')
  assert.equal(keptLocalAnswer?.content, '本地独有：这是它对应的回答。', 'nor is its answer')
  // The web turn is added beside it — neither copy is dropped.
  assert.ok(
    merged.messages.some(item => item.id === 'web-uY' && item.content === '无关：网页端的另一段提问。'),
    'the web turn is appended rather than replacing the local one',
  )
  assert.equal(merged.kept, 2, 'both local-only messages are reported as kept')
  assert.equal(merged.added, 2, 'and both web messages as added')
})

/*
 * The other half of the same rule: a stretch with no user message in it, where
 * the answer changed, is STILL settled in place. That is what a regenerated
 * reply looks like — the question matched and became an anchor of its own,
 * leaving assistant messages that share nothing but the slot they belong to.
 * Pairing by position is right there, and duplicating the answer would be wrong.
 */
test('an answer-only stretch is still settled in place, with the stored id', () => {
  const stored = [
    message('local-u1', 'user', '第一问：请讲讲方案。'),
    message('local-a1', 'assistant', '第一答：这是旧的那一版。'),
  ]
  const incoming = [
    message('web-u1', 'user', '第一问：请讲讲方案。'),
    message('web-a1', 'assistant', '第一答：这是重新生成的那一版，与上面毫无共同前缀。'),
  ]
  const merged = mergeHistory(stored, incoming)
  assert.equal(merged.messages.length, 2, 'still one answer')
  assert.equal(merged.messages[1]?.id, 'local-a1', 'wearing the id the panel already knows')
  assert.match(merged.messages[1]?.content ?? '', /重新生成/, 'and the web text')
})

/*
 * A USER message the web has reworded is not evidence that the turn was
 * regenerated: it is evidence that the two copies disagree about what was asked.
 * Keeping both is the honest reading — the panel has no way to tell an edit from
 * a different question, and dropping either one loses something real.
 */
test('a reworded question keeps both copies rather than overwriting the local one', () => {
  // One shared turn FIRST, so the two copies have evidence of identity and the
  // disagreement lands in the gap-settling branch rather than in the
  // nothing-matches fallback (which is a different rule, pinned above).
  const stored = [
    message('local-u0', 'user', '开头这一轮两边都有。'),
    message('local-u1', 'user', '帮我写一个抓取网页的脚本，用 Python。'),
  ]
  const incoming = [
    message('web-u0', 'user', '开头这一轮两边都有。'),
    message('web-u1', 'user', '能不能给我一个网页抓取脚本？'),
  ]
  const merged = mergeHistory(stored, incoming)
  assert.deepEqual(
    merged.messages.map(item => item.id),
    ['local-u0', 'local-u1', 'web-u1'],
    'both questions are kept, in the order they were asked',
  )
  assert.equal(merged.kept, 1, 'the local question is reported as kept')
})
