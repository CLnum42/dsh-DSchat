/**
 * Harness-mode transfer: turn a web-chat transcript into development context.
 *
 * This is the "Continue in Codex" / ChatGPT-mode analog, and like Codex it is
 * a CONTEXT HANDOFF rather than a raw replay: the exploration-phase web
 * conversation is distilled (via the harness LLM) into an executable task
 * brief — the execution-phase state representation the agent actually needs —
 * and that brief seeds a fresh harness session. The raw transcript is kept as
 * the fallback when distillation is unavailable.
 *
 * Two targets:
 *  - new harness session — a COLD persisted session seeded with the distilled
 *    brief (or raw transcript), so it shows up in the GUI list and resumes;
 *  - workspace file — the raw transcript rendered to markdown in the target
 *    project directory, so any agent can read it with file tools.
 *
 * Session creation writes directly through the session-persistence backend
 * (`sessionPersistence.create` + `append`), NOT `ctx.sessions.create()`:
 * the store's `create` produces a LIVE session owned by the calling fiber,
 * which the GUI then refuses to resume ("cannot prepare … while it is live").
 * A cold persisted session is exactly what the GUI's resume path expects.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { Workspace, WorkspaceId, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { answerBody } from './protocol.ts'
import type { TransferMode, DSchatMessage, DSchatSource, DSchatTranscript } from './protocol.ts'

/** Role label used in rendered transcripts. */
const ROLE_LABEL: Record<'user' | 'assistant', string> = { user: '用户', assistant: 'DeepSeek（网页端）' }

/**
 * Remove the collapsible R1 reasoning block(s) from reply markdown.
 *
 * Delegates to the SHARED splitter (protocol.ts), the same one the panel uses to
 * decide where a reply's answer begins: two implementations of that boundary
 * would eventually disagree, and the harness session would read a different
 * reply than the panel showed.
 *
 * @param markdown - the stored message body.
 */
function stripThinking(markdown: string): string {
  return answerBody(markdown).replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Drop the web page's citation markers from a reply.
 *
 * `[citation:N]` (and the raw `[reference:N]` older conversations persist) is a
 * pointer into the reply's SOURCE TABLE — the pages the web search returned.
 * A handoff carries the conversation, not the page the model rested on: with the
 * table gone the numbers are dead weight mid-sentence, and with the table kept
 * the brief would carry URLs the coding agent has no use for and no way to
 * number consistently. Both spellings go, here, so EVERY surface that renders a
 * transcript for consumption is free of them.
 *
 * @param markdown - reply text.
 */
function stripCitations(markdown: string): string {
  return markdown
    // The markers sit mid-sentence; without this a double space is left behind.
    .replace(/\s*\[(?:citation|reference):\d+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The footnote lines for one message's citation table.
 *
 * A transferred/imported transcript is read by an AGENT, which has no panel to
 * resolve `[citation:N]` in: without this the numbers in an answer are noise, and
 * the pages the reply rested on are lost. Numbered to match the markers, one line
 * per message, only when the message actually cited something.
 *
 * @param sources - the message's source table, in citation order.
 * @returns lines to append (empty when there is no table).
 */
function sourceFootnote(sources: readonly DSchatSource[] | undefined): string[] {
  if (sources === undefined || sources.length === 0) return []
  /*
   * Numbered by POSITION, not by order of appearance here: the marker in the
   * answer text is `[citation:N]`, and an entry the page named no URL for keeps
   * its slot (it is simply not listed) so `[2]` always means the second source.
   */
  const entries = sources
    .map((source, index) => ({ source, number: index + 1 }))
    .filter(entry => (entry.source?.url ?? '') !== '')
    .map(({ source, number }) => {
      const title = source.title?.trim()
      return `[${number}] [${title !== undefined && title !== '' ? title : source.url}](${source.url})`
    })
  if (entries.length === 0) return []
  return ['', `> 参考来源：${entries.join(' · ')}`]
}

/**
 * How a transcript is rendered for its reader.
 *
 * The defaults are the ones a HANDOFF needs, because that is the path every
 * caller cares about: the reasoning is dropped (it is the model's scratchpad,
 * including the pages its search browsed), and so are the citation table and its
 * markers — a harness session gets the conversation between the user and the
 * model, and nothing about the web page it happened on.
 *
 * `sources: true` is for the markdown a PERSON reads (导出 markdown): there the
 * footnote is the point, since the reader can open the page it names.
 */
export interface RenderOptions {
  /** Drop the R1 reasoning block (default false — keep what the transcript holds). */
  excludeThinking?: boolean
  /**
   * Keep the citation table and its `[citation:N]` markers (default false).
   *
   * Off is the handoff behaviour described above; on is for reader-facing
   * markdown exports.
   */
  sources?: boolean
}

/** Render the message list of a transcript (no header) to markdown. */
export function renderMessagesMarkdown(messages: DSchatMessage[], options?: RenderOptions): string {
  const excludeThinking = options?.excludeThinking ?? false
  const keepSources = options?.sources ?? false
  const lines: string[] = []
  for (const message of messages) {
    if (message.role === 'assistant' && message.streaming) continue
    let content = (excludeThinking ? stripThinking(message.content) : message.content).trim()
    if (!keepSources) content = stripCitations(content)
    lines.push(`## ${ROLE_LABEL[message.role]}`)
    lines.push('')
    lines.push(content === '' ? '（无内容）' : content)
    if (message.attachments !== undefined && message.attachments.length > 0) {
      lines.push('')
      lines.push(`> 📎 图片附件：${message.attachments.join('、')}`)
    }
    if (keepSources) lines.push(...sourceFootnote(message.sources))
    if (message.error !== undefined) {
      lines.push('')
      lines.push(`> ⚠️ 该条回复可能不完整：${message.error}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

/** Render one transcript to markdown for harness consumption. */
export function renderTranscriptMarkdown(transcript: DSchatTranscript, options?: RenderOptions): string {
  const lines: string[] = []
  lines.push(`# 网页端对话记录：${transcript.title}`)
  lines.push('')
  lines.push(`- 来源：DeepSeek 网页端（chat.deepseek.com）· 模型 ${transcript.model}`)
  lines.push(`- 开始时间：${new Date(transcript.createdAt).toLocaleString()}`)
  lines.push(`- 消息数：${transcript.messages.length}`)
  lines.push('')
  lines.push('> 以下内容由 dsh-dschat 插件从 DeepSeek 网页端会话导出。')
  lines.push('')
  const body = renderMessagesMarkdown(transcript.messages, options)
  if (body !== '') lines.push(body)
  return lines.join('\n').trim() + '\n'
}

/**
 * Framing that turns the distilled brief into established context for the
 * agent — the analog of Codex's "another model started to solve this problem
 * and produced a summary; use it to build on the work already done".
 */
export const HANDOFF_PREAMBLE = '这是一次从 DeepSeek 网页端会话（chat.deepseek.com）转来的上下文交接。下面的任务简报已把该对话提炼为可执行的任务上下文——把它当作既定目标与背景，直接在其基础上继续，不要复述。'

/**
 * The distillation directive. Delivered as the final user message after the
 * raw transcript so the model condenses the exploration phase into the
 * execution-phase state representation. Mirrors Codex's handoff and DSH's
 * compaction checkpoint structure, tuned for "web chat → coding task".
 */
const DISTILL_INSTRUCTION = [
  'You are distilling a web-chat conversation (a user exploring and planning with a DeepSeek web model) into an executable task brief for a coding agent that will resume this work in a FRESH session WITHOUT the raw conversation.',
  '',
  'Output EXACTLY the Markdown structure below — every section, in order, terse bullets, "(none)" for an empty section:',
  '',
  '## Objective',
  '- [the concrete goal/task to execute; quote the user\'s exact wording where it matters]',
  '',
  '## Established Context',
  '- [decisions, constraints, requirements, and facts already settled]',
  '',
  '## Current State',
  '- [what has been designed, decided, or produced so far]',
  '',
  '## Next Steps',
  '- [concrete ordered actions the coding agent should take]',
  '',
  '## Open Questions & Risks',
  '- [anything unresolved, uncertain, or risky]',
  '',
  'Rules:',
  '- Terse, concrete engineering prose. Preserve exact identifiers, paths, commands, error strings, code snippets, and numeric values.',
  '- Do not invent facts; mark uncertainty explicitly.',
  '- Do not mention this distillation request or the web-chat source.',
  '- Output only the brief.',
].join('\n')

/**
 * The `sessionPersistence` surface the transfer path uses.
 *
 * Typed deliberately. The plugin used to read this service untyped, so writing
 * `persistence.append(...)` — an inherited dsh-webchat bug, since the SERVICE has
 * no `append`; `create` hands back a write HANDLE that owns `append`/`flush`/
 * `close` — compiled cleanly and only failed at run time, mid-transfer. Types on
 * this seam turn that class of mistake into a build error.
 */
interface SessionPersistenceHandle {
  read(): Promise<{ events: readonly SessionEvent[] }>
  append(events: readonly SessionEvent[]): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

/** The `sessionPersistence` service as this plugin uses it. */
interface SessionPersistenceService {
  create(header: SessionHeader): Promise<SessionPersistenceHandle>
  open(id: SessionId, access: 'read' | 'write'): Promise<SessionPersistenceHandle>
}

/**
 * Resolve the persistence backend.
 * @param ctx - hosting context.
 * @param required - when true, a missing backend throws instead of returning undefined.
 */
function persistenceOf(ctx: Context, required = true): SessionPersistenceService {
  const service = ctx.get('sessionPersistence') as SessionPersistenceService | undefined
  if (service === undefined && required) {
    throw new Error('未找到会话持久化后端，无法延续已有会话')
  }
  return service as SessionPersistenceService
}

/** Transfer distillation settings (resolved from the plugin config surface). */
export interface DistillConfig {
  /** When true (default), distill the transcript into a task brief via ctx.llm. */
  distill: boolean
  /** Provider route for the distillation call; empty = auto-detect. */
  provider: string
  /** Model id for the distillation call; empty = auto-detect. */
  model: string
  /** Output-token cap for the final brief (single-shot / reduce). Default 4096. */
  maxTokens?: number
  /** Output-token cap for each per-chunk map summary. Default 1024. */
  chunkTokens?: number
}

/** Default output-token cap for the final distillation brief. */
export const DEFAULT_TRANSFER_MAX_TOKENS = 4_096
/** Default output-token cap for one chunk summary in the map phase. */
export const DEFAULT_TRANSFER_CHUNK_TOKENS = 1_024
/** Character budget per chunk when splitting a long transcript for map-reduce. */
export const CHUNK_CHAR_BUDGET = 12_000

/** A successful distillation result. */
export interface DistillResult {
  brief: string
  provider: string
  model: string
}

/** Pick a provider/model for the one-shot distillation call. */
async function resolveDistillTarget(llm: LlmRuntime, provider: string, model: string): Promise<{ provider: string; model: string } | undefined> {
  if (provider !== '' && model !== '') return { provider, model }
  const providers = llm.listProviders()
  if (providers.length === 0) return undefined
  const baseProvider = provider !== ''
    ? provider
    : (providers.find(entry => entry.id.toLowerCase().includes('deepseek')) ?? providers[0]).id
  if (model !== '') return { provider: baseProvider, model }
  const models = await llm.listModels(baseProvider)
  const picked = models.find(entry => entry.id.toLowerCase().includes('chat')) ?? models[0]
  return picked === undefined ? undefined : { provider: baseProvider, model: picked.id }
}

/**
 * Split a transcript's messages into chunks of at most `budget` characters
 * (sum of `message.content.length`), never splitting a single message: a
 * message larger than the budget becomes its own (oversized) chunk. Streaming
 * assistant messages are skipped (they were never completed).
 */
/**
 * The most chunks one distillation may fan out into.
 *
 * The map phase is one SEQUENTIAL model call per chunk, so an unusually long
 * web conversation used to mean an unbounded number of calls: a 200-chunk
 * transcript was 200 round-trips and several minutes with nothing on screen and
 * no way to tell "working" from "stuck". Past this many chunks the remaining
 * ones are folded together rather than each getting its own call, and the
 * truncation is named in the brief so the reader knows the input was clipped.
 */
const MAX_DISTILL_CHUNKS = 20

/** How many of the trailing messages the fold keeps when the chunk cap is hit. */
const OVERFLOW_FOLD_MESSAGES = 40

/**
 * Split a transcript into the slices the map phase summarizes.
 *
 * `MAX_DISTILL_CHUNKS` is a hard ceiling: once it is reached the remaining
 * messages are appended to a final "overflow" slice (capped to its last
 * `OVERFLOW_FOLD_MESSAGES` messages) instead of opening a chunk per message, so
 * the call count — the thing that actually costs time — is bounded.
 */
export function chunkTranscript(transcript: DSchatTranscript, budget: number = CHUNK_CHAR_BUDGET): DSchatMessage[][] {
  // A streaming assistant message is an unfinished reply: it would be distilled
  // as a half sentence. Dropping it here rather than mid-loop keeps the chunk
  // sizes honest.
  const messages = transcript.messages.filter(message => !(message.role === 'assistant' && message.streaming))
  const chunks: DSchatMessage[][] = []
  let current: DSchatMessage[] = []
  let size = 0
  for (const message of messages) {
    const messageSize = Math.max(1, message.content.length)
    // Once MAX-1 slices exist no further split is allowed, so the remainder
    // accumulates into one final slice instead of one call per remaining message.
    if (current.length > 0 && size + messageSize > budget && chunks.length < MAX_DISTILL_CHUNKS - 1) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(message)
    size += messageSize
  }
  if (current.length > 0) {
    /*
     * The ceiling was reached, so this last slice is the overflow. Keep its TAIL
     * — the end of a conversation is the state a handoff is built from, and an
     * unbounded slice would just move the problem into one oversized prompt.
     */
    const overflow = chunks.length >= MAX_DISTILL_CHUNKS - 1 && current.length > OVERFLOW_FOLD_MESSAGES
    chunks.push(overflow ? current.slice(-OVERFLOW_FOLD_MESSAGES) : current)
  }
  return chunks
}

/**
 * The map-phase directive: condense one slice of a long conversation into
 * dense notes a later synthesis step merges. Terse, factual, uncertainty-marked.
 */
const CHUNK_SUMMARY_INSTRUCTION = [
  'You are condensing one slice of a long web-chat conversation (a user exploring and planning with a DeepSeek web model) into dense notes that a later synthesis step will merge into a task brief.',
  '',
  'Preserve exactly, and do not invent:',
  '- decisions, constraints, requirements, and settled facts',
  '- exact identifiers, paths, commands, error strings, code snippets, and numeric values',
  '- anything still open, uncertain, or risky',
  '',
  'Output compact markdown notes. Mark uncertainty explicitly. Do not mention this summarization request or the source. Output only the notes.',
].join('\n')

/**
 * Whether an abort signal has fired.
 *
 * A helper rather than an inline `signal?.aborted === true`, because TypeScript
 * narrows an optional-chain discriminant: after the first such check in a
 * function, the compiler believes the property can only be `false | undefined`
 * and reports every LATER check as an impossible comparison. The flag is read
 * across `await` boundaries here, so it genuinely can change; a call is opaque
 * to that narrowing and says what it means.
 *
 * @param signal - the tool call's abort signal, or nothing.
 */
export function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted
}

/**
 * Run one LLM distillation call and return the assembled text (undefined on
 * failure or cancellation).
 *
 * `signal` is the tool call's own abort signal. A distillation of a long
 * transcript is several sequential model calls, so this is the slowest thing
 * the plugin does on a user's behalf and the first place a cancel has to land:
 * an aborted call stops consuming the stream and reports failure, which makes
 * the caller fall back to the raw transcript (a documented, non-lossy outcome)
 * instead of holding the tool open for minutes after the user cancelled.
 */
async function runDistillCall(llm: LlmRuntime, target: { provider: string; model: string }, instruction: string, maxTokens: number, signal?: AbortSignal): Promise<string | undefined> {
  if (isAborted(signal)) return undefined
  const assembler = new BlockAssembler()
  try {
    for await (const chunk of llm.stream({
      provider: target.provider,
      model: target.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: instruction }],
        // Same producer-owned source kind the session events carry: `plugin` is
        // retired and must not appear in a message this plugin authors.
        source: { kind: 'user' },
      })],
      maxTokens,
      purpose: 'compaction',
    })) {
      if (isAborted(signal)) return undefined
      assembler.push(chunk)
    }
  } catch {
    return undefined
  }
  if (isAborted(signal)) return undefined
  const finish = assembler.finish
  if (finish.kind !== 'stop' && finish.kind !== 'max-tokens') return undefined
  const text = assembler.blocks()
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  return text === '' ? undefined : text
}

/**
 * Distill a web transcript into an executable task brief via the harness LLM.
 * Long transcripts are distilled with map-reduce: each chunk is summarized
 * (map, capped at `chunkTokens`), then the summaries are merged into the final
 * brief (reduce, capped at `maxTokens`). Short transcripts take a single shot.
 * Returns undefined (so callers fall back to the raw transcript) when the LLM
 * service, a provider/model, or a clean completion is unavailable — and when
 * `signal` fires, which the caller reports as a cancellation rather than as a
 * distillation failure.
 */
export async function distillTranscriptToBrief(ctx: Context, transcript: DSchatTranscript, config: DistillConfig, signal?: AbortSignal): Promise<DistillResult | undefined> {
  const llm = ctx.get('llm') as LlmRuntime | undefined
  if (llm === undefined) return undefined
  if (isAborted(signal)) return undefined
  const target = await resolveDistillTarget(llm, config.provider, config.model).catch(() => undefined)
  if (target === undefined) return undefined
  if (isAborted(signal)) return undefined

  const maxTokens = config.maxTokens !== undefined && config.maxTokens > 0 ? config.maxTokens : DEFAULT_TRANSFER_MAX_TOKENS
  const chunkTokens = config.chunkTokens !== undefined && config.chunkTokens > 0 ? config.chunkTokens : DEFAULT_TRANSFER_CHUNK_TOKENS
  const chunks = chunkTranscript(transcript)

  let source: string
  if (chunks.length <= 1) {
    // Single shot: distill the whole transcript directly.
    source = `${DISTILL_INSTRUCTION}\n\n--- 网页对话记录 ---\n\n${renderTranscriptMarkdown(transcript, { excludeThinking: true, sources: false })}`
  } else {
    // Map: summarize each chunk; a failed map falls back to a truncated raw
    // excerpt so no information is silently dropped.
    const summaries: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      // Between chunks is the cheap place to notice a cancel: without this the
      // map phase would run to the end of a twenty-chunk transcript.
      if (isAborted(signal)) return undefined
      const chunkMarkdown = renderMessagesMarkdown(chunks[i], { excludeThinking: true, sources: false })
      const summary = await runDistillCall(
        llm,
        target,
        `${CHUNK_SUMMARY_INSTRUCTION}\n\n--- 片段 ${i + 1} / ${chunks.length} ---\n\n${chunkMarkdown}`,
        chunkTokens,
        signal,
      )
      summaries.push(summary ?? `（片段 ${i + 1} 摘要失败，截取原文）\n${chunkMarkdown.slice(0, CHUNK_CHAR_BUDGET)}`)
    }
    source = `${DISTILL_INSTRUCTION}\n\n--- 网页对话片段摘要（共 ${chunks.length} 段${chunks.length >= MAX_DISTILL_CHUNKS ? `，对话过长已截取末尾 ${OVERFLOW_FOLD_MESSAGES} 条消息` : ''}，已按段摘要） ---\n\n${summaries.join('\n\n---\n\n')}`
  }

  const brief = await runDistillCall(llm, target, source, maxTokens)
  if (brief === undefined) return undefined
  return { brief, provider: target.provider, model: target.model }
}

/**
 * Build a user-message surface event carrying the handoff text at a given seq.
 *
 * `seq` arrives as a plain number (callers count from 0 or from the log's last
 * seq) and is branded here: `SessionSeq` is opaque across the boundary, and the
 * brand is the only thing that keeps an arbitrary integer from being passed
 * where a session position is expected.
 */
export function transcriptUserMessageEvent(markdown: string, seq: number): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: Date.now(),
    // Surface events must declare how they entered the ordered surface; a
    // seeded user prompt appends to the tail.
    surfaceOp: 'append',
    data: {
      id: randomUUID() as MessageId,
      role: 'user',
      content: [{ type: 'text', text: markdown }],
      // v4 RETIRES the `plugin` source kind: native admission rejects it with
      // "format v4 message requires a producer-owned source kind", and a plugin
      // source only survives at all as the rewritten `plugin:<name>` form. A
      // prompt this plugin *injects on the user's behalf* is a user message, so
      // it carries the `user` producer kind — the same one the title event uses.
      source: { kind: 'user' },
    },
  }
}

/** Build the seed user-message event carrying the handoff text (seq 0). */
export function transcriptSeedEvent(markdown: string): SessionEvent<'user/message'> {
  return transcriptUserMessageEvent(markdown, 0)
}

/**
 * Sanitize a web-chat title into a safe single-line session title (the host
 * session-title service strips control characters and collapses whitespace;
 * mirror that lightly so a transferred title never overflows the fold).
 */
function normalizeSessionTitleText(text: string): string {
  const cleaned = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(cleaned).slice(0, 80).join('')
}

/**
 * Build the durable `session/title` event that pins the transferred session's
 * display name to the web chat's title. The `session/title` type is declared by
 * ANOTHER package (`@deepseek-ai/dsh-session-title`, which owns the
 * `sessionTitle` service and the `title` projection), so it is not in this
 * package's compiled `SessionEvent` union — cast through `unknown`.
 * `source.kind: 'user'` is the explicit-user form: it pins the title against
 * automatic regeneration, exactly as that service's own `rename()` does.
 */
function transcriptTitleEvent(title: string, seq: number, time: number): SessionEvent {
  return {
    type: 'session/title',
    seq: SessionSeq(seq),
    time,
    data: {
      title: normalizeSessionTitleText(title),
      messageSeqs: [],
      source: { kind: 'user' },
    },
  } as unknown as SessionEvent
}

/**
 * Whether this deployment understands the `session/title` event at all.
 *
 * `SessionEventMap` members are required-on-read: a build that does not know an
 * event type refuses the WHOLE log unless the envelope carries
 * `ignorable: true`, and a plugin writing through the persistence handle cannot
 * rely on that flag being accepted. `session/title` is declared by the
 * `dsh-session-title` package — not by the core — so on a deployment that does
 * not mount it, this event would turn a perfectly good transferred session into
 * one that cannot be opened.
 *
 * The type and its folder are both owned by that package's service, so the
 * presence of the service is exactly the question "does this build know this
 * event?". The title is a convenience; the log is not — when the service is
 * absent the session is written without a title event and the GUI falls back to
 * its own naming, which is the pre-existing behaviour for an untitled session.
 */
function hasSessionTitleSupport(ctx: Context): boolean {
  return (ctx as unknown as { get(name: string): unknown }).get('sessionTitle') !== undefined
}

/** Validate/normalize a workspace directory (must be absolute). */
function normalizeCwd(cwd: string | undefined): string {
  const resolved = cwd === undefined || cwd === '' ? process.cwd() : cwd
  if (!resolved.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(resolved)) {
    throw new Error(`cwd 必须是绝对路径，收到: ${resolved}`)
  }
  return resolved
}

export interface TransferWorkspaceTarget {
  /** Stable workspace id (from the registry / GUI picker); wins over `path`. */
  workspaceId?: string
  /** Directory path to use as the session cwd (optionally resolves to a workspace). */
  path?: string
}

export interface TransferToSessionInput {
  transcript: DSchatTranscript
  cwd?: string
  /**
   * The calling tool's abort signal, when it has one.
   *
   * Honouring it is part of the tool contract ("Honor `exec.signal`"), and on
   * this path the work being cancelled is a map-reduce distillation over a whole
   * conversation — the longest thing the plugin does.
   */
  signal?: AbortSignal
  /** Target workspace; when set, the session is grouped under it (attached). */
  workspace?: TransferWorkspaceTarget
  /**
   * Existing harness session to CONTINUE instead of creating a new one. When
   * set, the distilled brief (or raw transcript) is appended as a fresh user
   * message to that session rather than seeding a new session.
   */
  targetSessionId?: string
  /**
   * The exact seed text to write, from a confirmed preview.
   *
   * When set, distillation is skipped entirely: the caller is handing over
   * bytes a human has already read (and may have edited). Absent on every path
   * that has not previewed, which keeps the old behaviour.
   */
  seedMarkdown?: string
  /** True when `seedMarkdown` came from a successful distillation. */
  seedDistilled?: boolean
}

/** Resolved transfer destination: the session cwd plus an optional owning workspace. */
export interface ResolvedTransferTarget {
  cwd: string
  workspace?: Workspace
}

/** The result of creating a transferred harness session. */
export interface TransferToSessionResult {
  sessionId: string
  distilled: boolean
  /** True when the session was attached to a workspace; false = ungrouped. */
  attached: boolean
  /** Workspace id the session landed in, when attached. */
  workspaceId?: string
  /**
   * True when this handoff was ALREADY in the target session and nothing was
   * appended (see `handoffProvenance`). A retry, not a second round.
   */
  duplicate?: boolean
}

/**
 * The provenance line every handoff carries.
 *
 * Two jobs, one line: it tells the coding agent (and the reader) which web
 * conversation a brief came from, and its `fingerprint` is what makes the
 * append idempotent — re-running the same transfer finds the same line already
 * in the target session instead of appending a second copy of the same brief.
 *
 * The fingerprint covers the transcript's identity AND the state it was
 * transferred in (message count plus the newest message id), so a genuine
 * second round — the web conversation has moved on since — produces a different
 * line and is appended normally.
 */
export function handoffProvenance(transcript: DSchatTranscript, mode: TransferMode | 'raw' | 'distill'): string {
  const fingerprint = createHash('sha1')
    .update(`${transcript.id}|${transcript.messages.length}|${transcript.messages.at(-1)?.id ?? ''}|${mode}`)
    .digest('hex')
    .slice(0, 10)
  const name = transcript.title.trim() === '' ? transcript.id : transcript.title.trim()
  return `*（dsh-dschat 迁移：${name} · ${transcript.id} · ${fingerprint}）*`
}

/** Access the optional workspace registry without a hard service dependency. */
function workspaceRegistryOf(ctx: Context): WorkspaceRegistry | undefined {
  return ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined
}

/**
 * The row shape the Web Client's session list stores, i.e. the payload of the
 * session controller's forwarded `api-session/added` event. Declared locally
 * because this plugin does not depend on `dsh-api-session-controller`; the
 * fields here are the ones that event actually carries (`SessionSummary`).
 */
interface StoredSessionRow {
  readonly sessionId: string
  readonly updatedAt: number
  readonly running: boolean
  readonly agentAvailable: boolean
  readonly blank: boolean
  readonly cwd?: string
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
}

/** Emit one forwarded Host event without letting a foreign listener break a transfer. */
function emitHostEvent(ctx: Context, name: string, ...args: unknown[]): void {
  try {
    (ctx as unknown as { emit(event: string, ...payload: unknown[]): unknown }).emit(name, ...args)
  } catch {
    // Best-effort by design: the session is already durable, and a deployment
    // that composes no session controller has no `api-session/*` subscribers.
  }
}

/**
 * Announce a session this plugin created straight through the persistence
 * backend, because THAT write path is invisible to the Client.
 *
 * `persistence.create` bypasses `ctx.sessions`, so nothing ever emits
 * `session/created` and the session controller never emits the
 * `api-session/added` row it forwards to every Web page. Two user-visible
 * defects followed from that: the new session never appeared in the sidebar,
 * and `uiWorkspace.openSession(id)` threw `sessions.retain: unknown session`
 * inside the renderer (caught and logged, so the click simply did nothing).
 *
 * `api-session/added` is the public, documented event for "a Session became
 * visible" (`SessionSummary` payload, `emit` mode, forwarded to clients), so
 * emitting it is exactly the missing notification. Listeners upsert the row,
 * which is what makes the session listable AND retainable.
 */
function announceStoredSession(ctx: Context, header: SessionHeader, updatedAt: number): void {
  const row: StoredSessionRow = {
    sessionId: header.id,
    // The seed user message is the session's first activity; createdAt is the
    // same instant, and using the event time keeps list ordering honest.
    updatedAt,
    running: false,
    // Cold by construction: this session has no live owner until the user opens
    // it, which is what lets the GUI resume rather than adopt it.
    agentAvailable: false,
    blank: false,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(header.parentSession === undefined ? {} : { parentSessionId: header.parentSession }),
    ...(header.origin === undefined ? {} : { origin: header.origin }),
  }
  emitHostEvent(ctx, 'api-session/added', row)
}

/**
 * Announce activity on an existing session after appending to its stored log.
 *
 * The append goes through a persistence handle rather than the live Session, so
 * `session/event` never fires and the Client row would keep its old recency.
 * `api-session/activity` is the forwarded event that carries that recency.
 */
function announceStoredActivity(ctx: Context, sessionId: string, updatedAt: number): void {
  emitHostEvent(ctx, 'api-session/activity', sessionId, updatedAt)
}

/** Turn a persistence refusal on the append path into an actionable message. */
function appendRefusal(sessionId: string, error: unknown): Error {
  const name = error instanceof Error ? error.name : ''
  if (name === 'SessionPersistenceNotFoundError') return new Error(`找不到 harness 会话 ${sessionId}`)
  if (name === 'SessionAlreadyOwnedError') {
    return new Error(`会话 ${sessionId} 正在使用中（已在 GUI 打开或正在运行），无法向其日志追加消息；请改选一个未打开的会话，或改用「新建会话」`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Resolve the transfer destination. A `workspace.workspaceId` is validated
 * BEFORE the session is persisted so an unknown id fails fast instead of
 * leaving an orphan ungrouped session; `workspace.path` is realpath-canonicalized
 * (an existing directory) and opportunistically resolved to a workspace; with
 * no workspace the existing `cwd` behavior applies unchanged.
 */
async function resolveTransferTarget(ctx: Context, input: TransferToSessionInput): Promise<ResolvedTransferTarget> {
  const registry = workspaceRegistryOf(ctx)
  const target = input.workspace

  if (target?.workspaceId !== undefined && target.workspaceId !== '') {
    if (registry === undefined) {
      throw new Error(`无法归入工作区 ${target.workspaceId}：当前部署未挂载工作区服务`)
    }
    const workspace = registry.get(target.workspaceId as WorkspaceId)
    if (workspace === undefined) {
      throw new Error(`工作区 ${target.workspaceId} 不存在或已删除`)
    }
    return { cwd: workspace.path, workspace }
  }

  if (target?.path !== undefined && target.path !== '') {
    let cwd: string
    try {
      cwd = await realpath(target.path)
    } catch {
      throw new Error(`工作区路径不可用（不存在或不是目录）：${target.path}`)
    }
    const workspace = registry === undefined ? undefined : await registry.resolveByPath(cwd).catch(() => undefined)
    return { cwd, workspace }
  }

  return { cwd: normalizeCwd(input.cwd) }
}

/**
 * Refuse an unusable append target before the expensive half of a transfer runs.
 *
 * Claiming the write handle is the real test — it is what a live agent's
 * ownership refuses — and it is released immediately: this is a check, not the
 * append (which claims it again and writes). The cost is one log read, and it
 * buys an instant, accurate error instead of one that arrives after a full
 * distillation.
 */
async function assertAppendable(ctx: Context, sessionId: string): Promise<void> {
  const persistence = persistenceOf(ctx)
  const handle = await persistence.open(SessionId(sessionId), 'write').catch((error: unknown) => {
    throw appendRefusal(sessionId, error)
  })
  await handle.close()
}

/**
 * Continue an EXISTING harness session by appending the handoff as a fresh
 * user message — the "same task, another web round" resume path. The session's
 * stored log is loaded (which also durably closes any crash-orphaned turn) to
 * learn the next contiguous seq and turn number, then an open turn is appended
 * carrying the message; the resume loop closes the open turn and claims the
 * message as pending input, exactly like a queued user prompt. No new session
 * or header is created, so the target keeps its cwd/title/workspace.
 */
async function appendToExistingSession(ctx: Context, sessionId: string, markdown: string, distilled: boolean): Promise<TransferToSessionResult> {  const persistence = persistenceOf(ctx)
  const id = SessionId(sessionId)
  // `write` claims single-writer ownership, so appending is refused while a
  // driver still owns the session — correct, since a live session's log must
  // not be written behind its own store. A refusal is reported in the user's
  // terms (see `appendRefusal`) instead of as a storage class name.
  const handle = await persistence.open(id, 'write').catch((error: unknown) => {
    throw appendRefusal(sessionId, error)
  })
  try {
    const result = await appendThroughHandle(handle, id, markdown, distilled)
    // The append wrote the stored log, not the live Session, so the controller
    // saw no `session/event`; announce the activity or the sidebar keeps
    // showing the session at its old position.
    announceStoredActivity(ctx, id, Date.now())
    return result
  } finally {
    await handle.close()
  }
}
/** The append half, with the write handle already owned. */
async function appendThroughHandle(
  handle: SessionPersistenceHandle,
  id: SessionId,
  markdown: string,
  distilled: boolean,
): Promise<TransferToSessionResult> {
  const inspection = await handle.read()

  /*
   * Idempotence, read off the session's own log.
   *
   * 「追加到已有会话」 used to append unconditionally, so anything that ran the
   * transfer twice — a retry after the panel's request timed out, an agent
   * calling the tool again, a double click — put the whole brief in the session
   * twice, and the resumed agent read the same task as two. The provenance line
   * the handoff already carries identifies it exactly (same web conversation,
   * same state, same mode), so a second append of the same brief is skipped and
   * reported as `duplicate`. A genuinely newer round produces a different line
   * and still appends.
   */
  const marker = provenanceOf(markdown)
  if (marker !== undefined && sessionContainsProvenance(inspection.events, marker)) {
    return { sessionId: id, distilled, attached: false, duplicate: true }
  }

  let nextSeq = 0
  let maxTurn = 0
  for (const event of inspection.events) {
    if (event.seq >= nextSeq) nextSeq = event.seq + 1
    const turn = (event as { data?: { turn?: number } }).data?.turn
    if (typeof turn === 'number' && turn > maxTurn) maxTurn = turn
  }
  const turn = maxTurn + 1
  const now = Date.now()

  // Open a turn + step and enter the user message, leaving both open so the
  // resume path closes them (`turn/end` interrupted) and claims the message.
  const appended: SessionEvent[] = [
    { type: 'turn/start', seq: SessionSeq(nextSeq), time: now, data: { turn } },
    { type: 'step/start', seq: SessionSeq(nextSeq + 1), time: now, data: { turn, step: 1 } },
    transcriptUserMessageEvent(markdown, nextSeq + 2),
  ]
  await handle.append(appended)

  return { sessionId: id, distilled, attached: false }
}

/** The provenance line inside one handoff, or undefined when it carries none. */
function provenanceOf(markdown: string): string | undefined {
  return /（dsh-dschat 迁移：[^）]*）/.exec(markdown)?.[0]
}

/** True when any user message in the session already carries this provenance. */
function sessionContainsProvenance(events: readonly SessionEvent[], marker: string): boolean {
  for (const event of events) {
    if (event.type !== 'user/message') continue
    // Through `unknown` on purpose: a `user/message` event's `content` is a
    // discriminated union of blocks, and the narrowing this scan needs (a text
    // block, at any shape) is wider than the union — a direct assertion is
    // rejected as a mistake, correctly.
    const content = (event as unknown as { data?: { content?: Array<{ type?: string; text?: string }> } }).data?.content ?? []
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.includes(marker)) return true
    }
  }
  return false
}

/**
 * What a transfer is about to write, before anything is written.
 *
 * The hand-off used to be invisible until it had happened: the panel picked a
 * mode, the host distilled (or silently failed to and replayed the raw log
 * instead), and a session appeared. Since distillation is LOSSY — it drops the
 * whole reasoning chain and every source link — "which of the two did I just
 * get?" is not a detail the reader can be left to infer from a success toast.
 * This is the draft both the preview and the write are built from, so what is
 * shown is byte-for-byte what will be written.
 */
export interface HandoffDraft {
  /** The exact text that becomes the session's first user message. */
  markdown: string
  /** True when an LLM brief was produced. */
  distilled: boolean
  /** The mode actually used (after the config default was applied). */
  mode: TransferMode
  /** True when distillation was asked for but could not run. */
  fallback: boolean
  /** Why not, in the reader's terms — set only when `fallback`. */
  fallbackReason?: string
  /** Provider/model that produced the brief, when distilled. */
  provider?: string
  model?: string
}

/**
 * Build the hand-off text: preamble, body (brief or raw transcript), provenance.
 *
 * Extracted so the preview and the write cannot drift: the panel shows this
 * function's output and then hands the SAME string back to be written.
 */
export async function buildHandoffDraft(ctx: Context, transcript: DSchatTranscript, config: DistillConfig, mode?: TransferMode, signal?: AbortSignal): Promise<HandoffDraft> {
  const shouldDistill = mode === 'distill' ? true : mode === 'raw' ? false : config.distill
  const rawMarkdown = renderTranscriptMarkdown(transcript, { excludeThinking: true, sources: false })
  let body = rawMarkdown
  let distilled = false
  let provider: string | undefined
  let model: string | undefined
  let fallbackReason: string | undefined
  if (shouldDistill && !isAborted(signal)) {
    const result = await distillTranscriptToBrief(ctx, transcript, config, signal)
    if (result === undefined) {
      // A cancel is reported as a cancel. Without the distinction an abort read
      // as "distillation unavailable", which is a different (and wrong) story
      // for the human: it blames the deployment instead of their own stop.
      fallbackReason = isAborted(signal)
        ? '已取消（收到中止信号），本次改用原文迁移'
        : '蒸馏不可用（LLM 服务、提供方或模型不可用，或调用未正常结束），本次改用原文迁移'
    } else {
      body = `${result.brief}\n\n> （已由 ${result.provider}/${result.model} 从网页对话蒸馏生成）`
      distilled = true
      provider = result.provider
      model = result.model
    }
  }
  /*
   * The provenance line goes last so it stays the handoff's footer, and it is
   * added in BOTH modes: it is what makes a repeat append recognisable (see
   * appendThroughHandle) and what tells the resumed agent where the brief came
   * from. Its mode is the REQUESTED one, not the achieved one: the fingerprint
   * is the dedupe key, and a re-run of "distill this conversation" that fell
   * back once and succeeded the next time must still be recognised as the same
   * hand-off rather than appended a second time.
   */
  const markdown = `${HANDOFF_PREAMBLE}\n\n${body}\n\n${handoffProvenance(transcript, shouldDistill ? 'distill' : 'raw')}`
  return {
    markdown,
    distilled,
    mode: shouldDistill ? 'distill' : 'raw',
    fallback: shouldDistill && !distilled,
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
  }
}

/**
 * Resolve the destination and build the hand-off WITHOUT writing anything.
 *
 * The destination is resolved first for the same reason `transferToHarnessSession`
 * does it: a typo'd workspace or a session a live agent still owns should cost
 * nothing, not a full distillation.
 */
export async function previewHarnessTransfer(ctx: Context, input: TransferToSessionInput, config: DistillConfig, mode?: TransferMode): Promise<HandoffDraft> {
  const continueId = input.targetSessionId !== undefined && input.targetSessionId !== '' ? input.targetSessionId : undefined
  if (continueId === undefined) await resolveTransferTarget(ctx, input)
  else await assertAppendable(ctx, continueId)
  return buildHandoffDraft(ctx, input.transcript, config, mode, input.signal)
}

/**
 * Create a new COLD harness session seeded with a distilled task brief (or the
 * raw transcript when the user chooses 'raw' / distillation is unavailable),
 * written straight through the session-persistence backend so the GUI lists it
 * and can resume it later (no live-store ownership). When `input.workspace`
 * names a registered workspace, the session's cwd is set to that workspace's
 * canonical path and the session is attached to the workspace's account, so
 * the GUI groups it under that workspace instead of "ungrouped".
 *
 * `mode` is the user's explicit choice; when undefined the plugin config
 * default (`transferDistill`) applies. When `input.seedMarkdown` is set — the
 * panel/agent confirmed a preview — those exact bytes are written and no
 * distillation runs.
 */
export async function transferToHarnessSession(ctx: Context, input: TransferToSessionInput, config: DistillConfig, mode?: TransferMode): Promise<TransferToSessionResult> {
  const continueId = input.targetSessionId !== undefined && input.targetSessionId !== '' ? input.targetSessionId : undefined

  /*
   * Resolve the destination BEFORE distilling.
   *
   * Distillation is the expensive half: several sequential model calls over the
   * whole transcript. It used to run first, so a typo'd workspace id, a deleted
   * target session or one a live agent still owns all burned a full
   * distillation before answering with an error the host could have raised
   * immediately.
   */
  let target: ResolvedTransferTarget | undefined
  if (continueId === undefined) {
    target = await resolveTransferTarget(ctx, input)
  } else {
    await assertAppendable(ctx, continueId)
  }

  /*
   * A confirmed preview is written verbatim. This is the only path that can
   * produce bytes a human edited, so it must not be re-derived: re-running the
   * distillation here would silently discard their edits and pay for the model
   * calls twice.
   */
  let seedMarkdown: string
  let distilled: boolean
  if (input.seedMarkdown !== undefined && input.seedMarkdown.trim() !== '') {
    seedMarkdown = input.seedMarkdown
    distilled = input.seedDistilled === true
  } else {
    const draft = await buildHandoffDraft(ctx, input.transcript, config, mode, input.signal)
    seedMarkdown = draft.markdown
    distilled = draft.distilled
  }

  // Continue an existing session instead of creating a new one.
  if (continueId !== undefined) {
    return appendToExistingSession(ctx, continueId, seedMarkdown, distilled)
  }
  if (target === undefined) throw new Error('转移目标未解析')

  const id = SessionId(`session-${randomUUID()}`)
  const createdAt = Date.now()
  // `isSeeded` is a REQUIRED format-v4 header field. This session is brand new:
  // its seed events are ordinary first messages, and it inherits no events from
  // a parent, so it is unseeded (the store's own default, `meta.isSeeded ?? false`).
  // Omitting it fails restore with "format v4 header lacks required field isSeeded".
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt,
    cwd: target.cwd,
    isSeeded: false,
    delegationDepth: 0,
  }

  // Seed the handoff message, then pin the display name to the web chat's
  // title (seq 1, immediately after the seed) so the GUI list shows the chat
  // title instead of falling back to the cwd basename or the raw session id.
  // The title event is written only where the deployment actually declares that
  // event type — see hasSessionTitleSupport.
  const seedEvent = transcriptSeedEvent(seedMarkdown)
  const title = normalizeSessionTitleText(input.transcript.title)
  const events: SessionEvent[] = [seedEvent]
  if (title !== '' && hasSessionTitleSupport(ctx)) {
    events.push(transcriptTitleEvent(title, seedEvent.seq + 1, seedEvent.time))
  }

  const persistence = persistenceOf(ctx, false)
  const cold = persistence !== undefined
  if (persistence !== undefined) {
    // Cold path: create the stored session under `header`, write the seed +
    // title events through the returned write handle, then release ownership.
    // A cold session is what the GUI's resume path expects — `ctx.sessions.create`
    // would make it LIVE and owned by this fiber, and the GUI refuses to resume
    // a session while it is live. `append`'s contiguous-seq contract starts at 0
    // for a fresh session, matching the seed event's seq; `session/end-seed` is
    // re-added on resume, so it is not written here.
    const handle = await persistence.create(header)
    try {
      await handle.append(events)
      // Durability barrier: without it the session is only a deferred
      // materialization and a crash before the next barrier loses it.
      await handle.flush()
    } finally {
      await handle.close()
    }
  } else {
    // No persistence backend mounted (the deployment has no resume path).
    // `ctx.sessions.create` publishes a live session, which emits
    // `session/created` itself — no announcement is needed there.
    ctx.sessions.create(id, { meta: { cwd: target.cwd }, seed: events })
  }

  let attached = false
  if (target.workspace !== undefined) {
    try {
      await target.workspace.attachSession(id)
      attached = true
    } catch {
      // Non-fatal: the session is already persisted; it simply stays ungrouped.
      attached = false
    }
  }

  // Announce BEFORE returning: the panel navigates to this session as soon as
  // the HTTP response lands, and the Client can only retain a session its list
  // knows. The announcement travels the Client's own event socket, so the panel
  // also retries briefly — this just makes that race one tick wide instead of
  // "never".
  if (cold) announceStoredSession(ctx, header, seedEvent.time)

  const workspaceId = attached && target.workspace !== undefined ? target.workspace.id : undefined
  return { sessionId: id, distilled, attached, workspaceId }
}

export interface ExportTranscriptInput {
  transcript: DSchatTranscript
  cwd?: string
}

/** Write the transcript markdown into the target directory; returns the path. */
export function exportTranscriptFile(input: ExportTranscriptInput): { filePath: string } {
  const cwd = normalizeCwd(input.cwd)
  const slug = input.transcript.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'dschat'
  const fileName = `dschat-${slug}-${input.transcript.id.slice(-6)}.md`
  const filePath = join(cwd, fileName)
  mkdirSync(cwd, { recursive: true })
  /*
   * The one render that KEEPS the citation table: this file is for a person,
   * who can open the pages a reply rested on. Every handoff path drops them.
   */
  writeFileSync(filePath, renderTranscriptMarkdown(input.transcript, { sources: true }), 'utf8')
  return { filePath: basename(filePath) }
}
