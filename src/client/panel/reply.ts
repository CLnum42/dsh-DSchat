/**
 * Splitting a stored assistant message into its two halves.
 *
 * The engine renders reasoning and answer into ONE markdown string, with the
 * reasoning wrapped in a `<details><summary>思考过程</summary>` block in front
 * of the answer (see `snapshot()` in engine/engine.ts). That is the right shape
 * for the transcript — the renderer already collapses it into a summary row —
 * but it is the wrong shape for the things the reader does with a reply:
 *
 *   - 复制 copied the whole thing, reasoning included, into the clipboard.
 *   - 引用到输入框 quoted only the message's FIRST LINE, which is the opening
 *     `<details>` tag, so the composer filled up with the literal
 *     `> <details><summary>思考过程</summary>` and no actual text.
 *
 * Both actions now go through these helpers, so "the reply" means the answer
 * and nothing else. The reasoning is still one click away (复制思考过程) and
 * still right there in the bubble.
 *
 * The SPLITTER itself lives in protocol.ts, shared with the host half: a
 * transferred harness session must read the same "answer, not reasoning" text
 * the panel shows, and two implementations of "where does the answer start"
 * would be two answers to the same question. This module keeps the panel-side
 * names (and the one extra helper the quote action needs).
 */

import { answerBody, opensWithThinking, thinkingBody } from '../../protocol.ts'

export { answerBody, opensWithThinking, thinkingBody }

/**
 * Answer text of a stored assistant message: the content with a LEADING
 * thinking block removed.
 *
 * Conservative on purpose — only a block that opens the message counts, so a
 * reply that legitimately talks about `<details>` further down is untouched.
 */
export const replyBody = answerBody

/**
 * First line of a reply's ANSWER, for the quote action: the transcript's quote
 * button lifts one line into the composer rather than the whole reply. Empty
 * when there is no answer yet, so the caller can leave the composer alone
 * instead of writing a quote marker with nothing after it.
 */
export function firstLine(content: string): string {
  return replyBody(content).split('\n')[0]?.trim() ?? ''
}

/**
 * What 分享 puts on the clipboard.
 *
 * Plain markdown rather than a link: these conversations live in the reader's own
 * DeepSeek account, and the web page's own 分享 produces a public link through a
 * flow this plugin does not own (it opens the page's dialog, which the engine's
 * selector surface cannot drive reliably — the same reason 朗读 is not carried).
 * What the reader actually wants to hand to someone else is the exchange, so the
 * clipboard gets the QUESTION and the ANSWER under the conversation's title.
 *
 * The reasoning is excluded, exactly as in 复制 and in the markdown export: it is
 * the model's working, not the text being shared. It lives here rather than in
 * the panel so the shape of a shared excerpt is a pure function that can be
 * asserted on — see test/reply.test.ts.
 *
 * @param title - the conversation title (the panel resolves it, see `chatTitleOf`).
 * @param question - the question this answer replies to ('' when there is none).
 * @param answer - the answer body, already stripped of its reasoning wrapper.
 */
export function shareText(title: string, question: string, answer: string): string {
  const lines = [`# ${title}`, '']
  if (question !== '') lines.push(`> ${question}`, '')
  lines.push(answer.trim(), '', '— DeepSeek')
  return lines.join('\n')
}
