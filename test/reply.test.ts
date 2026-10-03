/**
 * Reply-splitting tests: what 复制 / 引用 to the reader's answer actually mean.
 *
 * The engine stores reasoning and answer as ONE markdown string, reasoning
 * first inside a `<details>` block. Both message actions used to treat that
 * string as the reply — 复制 put the whole reasoning on the clipboard and 引用
 * quoted the opening `<details>` tag itself into the composer. These tests pin
 * the split, including the still-streaming case where the closer has not
 * arrived yet.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replyBody, thinkingBody, firstLine } from '../src/client/panel/reply.ts'

/** The shape the engine writes: reasoning block, blank line, answer. */
const withThinking = [
  '<details><summary>思考过程</summary>',
  '',
  '用户想要动力火车《当》的歌词。我需要搜索。',
  '',
  '</details>',
  '',
  '啊 啊 啊',
  '当山峰没有棱角的时候',
].join('\n')

test('a quoted reply never starts with the thinking wrapper', () => {
  const line = firstLine(withThinking)
  assert.equal(line, '啊 啊 啊')
  assert.ok(!line.includes('<details>'), 'the quoted line is the answer, not the tag')
  assert.ok(!line.includes('思考过程'), 'the quoted line is the answer, not the summary')
})

test('the reply body drops a leading thinking block and keeps the answer', () => {
  assert.equal(replyBody(withThinking), '啊 啊 啊\n当山峰没有棱角的时候')
})

test('the thinking body is the reasoning without the wrapper', () => {
  assert.equal(thinkingBody(withThinking), '用户想要动力火车《当》的歌词。我需要搜索。')
})

test('a reply with no thinking block is its own body', () => {
  const plain = '平顶山明天有雨，气温 14℃ 到 20℃。'
  assert.equal(replyBody(plain), plain)
  assert.equal(thinkingBody(plain), '')
  assert.equal(firstLine(plain), plain)
})

test('a still-streaming reply has no body until the block closes', () => {
  // Mid-thinking: the closer has not arrived, so nothing may be quoted yet.
  const streaming = '<details><summary>思考过程</summary>\n\n用户想要'
  assert.equal(replyBody(streaming), '')
  assert.equal(firstLine(streaming), '')
  assert.equal(thinkingBody(streaming), '用户想要')
  // Closer in, body out.
  const closed = `${streaming}\n\n</details>\n\n收到`
  assert.equal(replyBody(closed), '收到')
})

test('a reply that only mentions details further down is untouched', () => {
  const talky = 'HTML 里 `<details>` 是折叠块，写法是：\n\n<details><summary>x</summary>y</details>'
  assert.equal(replyBody(talky), talky)
  assert.equal(thinkingBody(talky), '')
})

test('an unterminated opener with no summary is never quoted as text', () => {
  assert.equal(replyBody('<details>'), '')
  assert.equal(thinkingBody('<details>'), '')
})
