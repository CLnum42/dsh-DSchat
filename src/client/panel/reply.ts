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
 * The one case that cannot be read off the string is a reply that is STILL
 * streaming: the reasoning fragment grows first and the closer `</details>` only
 * arrives when the model starts answering, so an unterminated opener is
 * ambiguous — the text after `</summary>` is either more reasoning or (once the
 * model moved on) the answer. Quoting the wrong half is worse than quoting
 * nothing, so `replyBody` returns `''` until the block closes.
 */

/** A finished thinking block, matched only at the start of the message. */
const THINKING_BLOCK = /^<details>\s*<summary>[^<]*<\/summary>([\s\S]*?)<\/details>/

/** True for the engine's thinking wrapper, closed or still streaming. */
export function opensWithThinking(content: string): boolean {
  return content.trimStart().startsWith('<details>')
}

/**
 * Answer text of a stored assistant message: the content with a LEADING
 * thinking block removed.
 *
 * Conservative on purpose — only a block that opens the message counts, so a
 * reply that legitimately talks about `<details>` further down is untouched.
 */
export function replyBody(content: string): string {
  const text = content.trimStart()
  if (!opensWithThinking(text)) return content.trim()
  const closed = THINKING_BLOCK.exec(text)
  // Opener without a closer: still reasoning, no answer to hand back yet.
  if (closed === null) return ''
  return text.slice(closed[0].length).trim()
}

/**
 * Reasoning text of a stored assistant message, `''` when it carries none.
 *
 * Used only by the 复制思考过程 action, so the exact whitespace of the source
 * is preserved: what lands on the clipboard is what the model produced.
 */
export function thinkingBody(content: string): string {
  const text = content.trimStart()
  if (!opensWithThinking(text)) return ''
  const closed = THINKING_BLOCK.exec(text)
  if (closed !== null) return (closed[1] ?? '').trim()
  const opener = text.indexOf('</summary>')
  return opener < 0 ? '' : text.slice(opener + '</summary>'.length).trim()
}

/**
 * First line of a reply's ANSWER, for the quote action: the transcript's quote
 * button lifts one line into the composer rather than the whole reply. Empty
 * when there is no answer yet, so the caller can leave the composer alone
 * instead of writing a quote marker with nothing after it.
 */
export function firstLine(content: string): string {
  return replyBody(content).split('\n')[0]?.trim() ?? ''
}
