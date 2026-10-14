/**
 * The pieces of 分享 that can be reasoned about without a browser.
 *
 * 分享 is the only control in this plugin that PUBLISHES something: it asks the
 * web page to create a URL anyone can open (`shareCreateLink: "Create public
 * link"` in the page's own dictionary). What that costs is split in two here:
 *
 *   - `answerMatchExpectation` decides WHICH answer is being shared. It has to
 *     survive the difference between the stored markdown and the page's
 *     re-serialized HTML, and it has to refuse rather than guess — a share of the
 *     wrong answer is public and irreversible;
 *   - the two failure-sentence builders decide what the reader is told when it
 *     does not work, and the distinction they encode is the important one: a
 *     failed RATING changed nothing, while a failed share may have published a
 *     link (`pressed-no-link`), and the reader has to be told where to remove it.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerMatchExpectation, ratingFailureSentence, shareFailureSentence, shareUrlFrom } from '../src/engine/engine.ts'

/* ------------------------------------------------------------- the link itself */

test('分享 builds the link the web app itself would build', () => {
  // The page's own code is `new URL('/share/' + id, location.href).href`.
  assert.equal(
    shareUrlFrom('abc-123', 'https://chat.deepseek.com/a/chat/s/75371686-f92e-435a-8d7d-3e8797300a25'),
    'https://chat.deepseek.com/share/abc-123',
  )
  // The origin comes from the PAGE, not from a constant: a deployment served
  // from somewhere else must not hand out links pointing at the old host.
  assert.equal(shareUrlFrom('x', 'https://example.test/a/chat'), 'https://example.test/share/x')
  // A URL that will not parse still produces a link rather than a crash: the
  // reader is about to copy this, and an empty string would look like a failure.
  assert.equal(shareUrlFrom('x', 'not a url'), 'https://chat.deepseek.com/share/x')
})

/* ------------------------------------------------------- which answer, exactly */

test('answerMatchExpectation compares the ANSWER, and refuses to guess', () => {
  // The reasoning is stored inside the same string and rendered in a separate
  // element on the page, so a sample taken from it would match nothing.
  const withThinking = '<details><summary>思考过程</summary>\n\n先看约束，再算一遍。\n\n</details>\n\n'
    + '开封适合自驾游的景点有清明上河园、龙亭公园、铁塔公园和开封府，彼此车程都在二十分钟内。'
  const sample = answerMatchExpectation(withThinking)
  assert.equal(sample.prefixed, true, 'a long answer is compared by a prefix')
  assert.equal(sample.sample.length, 24, 'the prefix is exactly the cap')
  assert.equal(sample.sample, '开封适合自驾游的景点有清明上河园龙亭公园铁塔公园')
  assert.match(withThinking, new RegExp(sample.sample.slice(0, 8)), 'the sample is a prefix of the stored answer')
  assert.equal(/先看约束/.test(sample.sample), false, 'the reasoning never reaches the sample')

  // A short answer is compared WHOLE (`prefixed: false`), so a stored copy of a
  // few characters cannot match every answer on the page.
  assert.deepEqual(answerMatchExpectation('好的。'), { sample: '好的', prefixed: false })

  // Markdown syntax, whitespace and citation chips are not content: the sample is
  // letters and digits only.
  const messy = answerMatchExpectation('**要点**：\n\n目标写一句话[citation:1]，约束写死不能改的')
  assert.equal(messy.sample, '要点目标写一句话citation1约束写死不能改的'.slice(0, 24))
  assert.equal(/[*\s]/.test(messy.sample), false, 'no markdown or whitespace survives')

  // A reply that is still thinking has no answer half yet: nothing to match, so
  // the caller refuses instead of sharing the wrong row.
  assert.deepEqual(answerMatchExpectation('<details><summary>思考过程</summary>\n\n还在想。'), { sample: '', prefixed: true })
  assert.deepEqual(answerMatchExpectation(''), { sample: '', prefixed: true })
})

/* ------------------------------------------------------------ what went wrong */

test('a failed rating says nothing was published', () => {
  assert.match(ratingFailureSentence('not-found'), /没有在网页端找到/)
  assert.match(ratingFailureSentence('not-found'), /为避免评错已取消/)
  assert.match(ratingFailureSentence('no-submit'), /没有找到「提交」/)
  assert.match(ratingFailureSentence('no-dialog'), /弹窗没有出现/)
  assert.match(ratingFailureSentence('no-reasons'), /没有找到原因选项/)
  // A row whose control count is wrong is reported WITH the count: that is the
  // number a reader can paste into a bug report.
  assert.match(ratingFailureSentence('controls:10'), /10 个按钮/)
  assert.match(ratingFailureSentence('whatever'), /没有完成（whatever）/)
})

test('a failed share distinguishes "nothing happened" from "it may be public"', () => {
  assert.match(shareFailureSentence('not-found'), /分享已取消/)
  assert.match(shareFailureSentence('no-bar'), /没有进入选择模式/)
  assert.match(shareFailureSentence('no-create-control'), /创建分享链接/)
  assert.match(shareFailureSentence('no-dialog'), /确认框/)
  assert.match(shareFailureSentence('no-confirm-control'), /创建并复制/)
  assert.match(shareFailureSentence('controls:5'), /5 个按钮/)
  /*
   * The multi-turn aborts. A share of N turns can fail AFTER the selection was
   * made but BEFORE anything was created, and the three reasons that can produce
   * are the important ones to distinguish: the page counted a different number
   * of exchanges, a checkbox press did not take, or one of the chosen answers is
   * no longer on the page. None of them may be read as "it may be public".
   */
  assert.match(shareFailureSentence('selection:2/3'), /2 组/)
  assert.match(shareFailureSentence('selection:2/3'), /3 组/)
  assert.match(shareFailureSentence('selection:?/3'), /\? 组/)
  assert.match(shareFailureSentence('checkbox:17'), /没有选中/)
  assert.match(shareFailureSentence('not-found:2'), /2 组/)
  // Every sentence a NON-publishing failure produces says so; the sentence for
  // the publishing one is built by the caller, because it has to name where to
  // delete the link (see `shareMessages`).
  for (const reason of [
    'not-found', 'no-bar', 'no-create-control', 'no-dialog', 'no-confirm-control', 'controls:5', 'other',
    'selection:1/3', 'selection:?/2', 'checkbox:9', 'not-found:2',
  ]) {
    assert.equal(/已创建/.test(shareFailureSentence(reason)), false, `${reason} must not claim a link exists`)
  }
})
