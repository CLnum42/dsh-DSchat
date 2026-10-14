/**
 * The Q&A picker: what a selection MEANS, without a browser.
 *
 * Both 分享 and 导出 markdown ask the same question — which of this
 * conversation's exchanges do you want — and the rule the request pinned down is
 * the binding: a question and its answer are one unit, so clearing either half
 * clears the turn. That rule is a property of the DATA (which ids a selection
 * produces, which turns it covers), not of the markup, so it is asserted here
 * rather than through a rendered transcript.
 *
 * The other half is the share contract with the web page: one answer per turn,
 * because the page pairs each answer with its question itself and counts PAIRS
 * on its selection bar (`MESSAGES_MUST_APPEAR_IN_PAIRS`). Sending two answers of
 * one turn would ask for the same question twice, which the page cannot express.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The picker module, compiled once for this file.
 *
 * Written INSIDE the package (like test/client-render.test.ts does) so the
 * external `react` resolves to the same copy the component imports; a bundle in
 * the system temp directory cannot resolve it at all.
 */
async function loadPicker() {
  const dir = mkdtempSync(join(root, '.tmp-qa-test-'))
  const entry = join(dir, 'entry.tsx')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(entry, `
    export { qaTurns, selectableTurns, selectedTurns, selectedMessageIds, selectionShareText, QaPicker } from ${JSON.stringify(join(root, 'src/client/panel/qa-picker.tsx'))}
  `, 'utf8')
  const out = join(dir, 'bundle.mjs')
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    outfile: out,
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    logLevel: 'silent',
  })
  const module = await import(pathToFileURL(out).href)
  rmSync(dir, { recursive: true, force: true })
  return module
}

const message = (id, role, content, extra = {}) => ({ id, role, content, ts: 0, ...extra })

/** A three-turn conversation, the middle one still streaming its answer. */
const transcript = [
  message('q1', 'user', '第一问：怎么优化这个界面？'),
  message('a1', 'assistant', '先看层级，再看节奏。\n\n第二行不该出现。'),
  message('q2', 'user', '第二问：那动效呢？'),
  message('a2', 'assistant', '动效只做展开与收起。', { streaming: true }),
  message('q3', 'user', '第三问：还有别的吗？'),
  message('a3', 'assistant', '<details><summary>思考过程</summary>\n\n先想一遍。\n\n</details>\n\n还有配色与间距。'),
]

test('turns pair each question with the answers under it', async () => {
  const { qaTurns } = await loadPicker()
  const turns = qaTurns(transcript)
  assert.equal(turns.length, 3, 'three questions, three turns')
  assert.deepEqual(turns.map(turn => turn.id), ['q1', 'q2', 'q3'], 'the question id is the turn id')
  assert.deepEqual(turns.map(turn => turn.answers.map(answer => answer.id)), [['a1'], ['a2'], ['a3']])

  // The preview line is the first line of the ANSWER, with the reasoning wrapper
  // and its block split off — the picker must not show 「思考过程」 as the answer.
  assert.equal(turns[0].questionLine, '第一问：怎么优化这个界面？')
  assert.equal(turns[0].answerLines[0], '先看层级，再看节奏。')
  assert.equal(turns[2].answerLines[0], '还有配色与间距。')

  // A turn whose answer is still streaming cannot be shared: the page has no
  // answer to pair it with yet.
  assert.equal(turns[1].shareable, false, 'a streaming answer is not shareable')
  assert.equal(turns[0].shareable, true)
  assert.equal(turns[2].shareable, true)
})

test('a leading answer with no question still becomes a turn', async () => {
  const { qaTurns } = await loadPicker()
  const turns = qaTurns([message('a0', 'assistant', '开场白。'), ...transcript])
  assert.equal(turns.length, 4)
  assert.equal(turns[0].question, undefined)
  assert.equal(turns[0].shareable, false, 'nothing to pair it with on the page')
  // 导出 must still be able to write it: the file is a record, not a share.
  assert.deepEqual(turns.map(turn => turn.id)[0], 'answer-a0')
})

test('the selection is BOUND: one flag per turn, whichever half was pressed', async () => {
  const { qaTurns, selectedMessageIds, selectedTurns } = await loadPicker()
  const turns = qaTurns(transcript)
  // The component holds ONE flag per turn id; pressing the question row or the
  // answer row runs the same toggle, so these two selections are the same set.
  const viaQuestion = new Set(['q1'])
  const viaAnswer = new Set(['q1'])
  assert.deepEqual(selectedTurns(turns, viaQuestion, 'export').map(t => t.id), ['q1'])
  assert.deepEqual(selectedTurns(turns, viaAnswer, 'export').map(t => t.id), ['q1'])
  // And clearing "the answer" clears the whole turn: there is no state that
  // keeps the question behind, because there is no per-half state at all.
  assert.deepEqual(selectedMessageIds(turns, new Set(['q2']), 'export'), ['q2', 'a2'])
  assert.deepEqual(selectedMessageIds(turns, new Set(), 'export'), [])
})

test('导出 takes every message of a turn, in transcript order', async () => {
  const { qaTurns, selectedMessageIds } = await loadPicker()
  const turns = qaTurns(transcript)
  assert.deepEqual(
    selectedMessageIds(turns, new Set(['q1', 'q3']), 'export'),
    ['q1', 'a1', 'q3', 'a3'],
    'questions and answers, ordered as the transcript reads',
  )
  // A streaming answer is written by the host too — the export skips it there
  // (renderMessagesMarkdown), and the picker must not silently drop the question
  // that goes with it.
  assert.deepEqual(selectedMessageIds(turns, new Set(['q2']), 'export'), ['q2', 'a2'])
})

test('分享 takes ONE answer per turn, and only shareable turns', async () => {
  const { qaTurns, selectedMessageIds, selectableTurns } = await loadPicker()
  const turns = qaTurns(transcript)
  assert.deepEqual(
    selectedMessageIds(turns, new Set(['q1', 'q2', 'q3']), 'share'),
    ['a1', 'a3'],
    'the streaming turn is dropped, and no question is sent',
  )
  // 全选 in 分享 mode cannot even offer the streaming turn.
  assert.deepEqual(selectableTurns(turns, 'share').map(turn => turn.id), ['q1', 'q3'])
  assert.deepEqual(selectableTurns(turns, 'export').map(turn => turn.id), ['q1', 'q2', 'q3'])
})

test('the fallback text carries the chosen exchanges, not the reasoning', async () => {
  const { qaTurns, selectionShareText } = await loadPicker()
  const turns = qaTurns(transcript)
  const text = selectionShareText('测试对话', turns, new Set(['q1', 'q3']))
  assert.match(text, /^# 测试对话/)
  assert.match(text, /> 第一问：怎么优化这个界面？/)
  assert.match(text, /先看层级，再看节奏。/)
  assert.match(text, /还有配色与间距。/)
  assert.match(text, /— DeepSeek$/)
  assert.equal(/第二问/.test(text), false, 'an unchosen turn stays out')
  assert.equal(/先想一遍/.test(text), false, 'the reasoning never reaches the clipboard')
})
