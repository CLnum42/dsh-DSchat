/**
 * Shared wire surface of dsh-DSchat: API paths, transcript data model, and
 * engine status views. Imported by both the host routes and the browser panel
 * (the client bundle inlines it — there is no shared runtime identity).
 */

/** How one DSchat message was produced (drives the panel's message rendering). */
export type DSchatRole = 'user' | 'assistant'

/**
 * One source a web reply cites.
 *
 * The web numbers its SOURCES 1..M per answer, and writes `[citation:N]` into
 * the markdown — the marker carries no URL, so without this table a citation
 * could only ever render as a bare number (the reported "显示为数字注释，点不开").
 * The engine collects the URLs while the reply streams (and from the web's own
 * stored fragments when recovering a conversation), in the very order the web
 * numbered them, so `sources[N - 1]` IS citation N.
 */
export interface DSchatSource {
  readonly url: string
  /** The result's title when the page reported one. */
  readonly title?: string
}

/** One transcript message (markdown text). */
export interface DSchatMessage {
  /** Local stable id. */
  readonly id: string
  readonly role: DSchatRole
  /** Markdown body. */
  readonly content: string
  /** Unix epoch ms. */
  readonly ts: number
  /** True while the engine is still streaming this message. */
  readonly streaming?: boolean
  /** Set when the exchange failed (content may be partial). */
  readonly error?: string
  /**
   * How long the model spent on this reply's reasoning, in ms.
   *
   * Measured by the engine while the reply streamed: from the first reasoning
   * fragment to the first answer fragment (see `streamReply`). It is the only
   * honest source for the panel's 「已思考（用时 X 分 Y 秒）」 line — the page's
   * own timer is not part of the stored transcript.
   *
   * Absent for a reply that carried no reasoning, for one still thinking, and
   * for a transcript RECOVERED from the web (the history endpoint stores the
   * reasoning text but no timing), where the panel says 「已思考」 with no
   * duration rather than inventing one.
   */
  readonly thinkingMs?: number
  /** Local absolute paths of images attached to a user message. */
  readonly attachments?: string[]
  /**
   * Search sources this reply cites, in the web's own citation order.
   *
   * Absent when the reply used no search (and for transcripts recovered from
   * the DOM, where the page exposes no URL table).
   */
  readonly sources?: readonly DSchatSource[]
}

/** One web chat session transcript (persisted locally). */
export interface DSchatTranscript {
  readonly id: string
  title: string
  readonly createdAt: number
  updatedAt: number
  /** Model the chat currently runs on the web (deepseek-chat / deepseek-reasoner). */
  model: string
  /** Replaced wholesale when a recover brings back a more complete history. */
  messages: DSchatMessage[]
  /** True while an assistant reply is streaming. */
  streaming: boolean
  /**
   * Web session id (`/a/chat/s/<id>`) this transcript was recovered from.
   *
   * This — not the title — is a web conversation's real identity: titles
   * repeat, get renamed, and the old title-only dedup made a second recover of
   * the same conversation a no-op (so a short import could never be repaired).
   */
  webSessionId?: string
}

/** One conversation as listed by the web sidebar. */
export interface WebChatSummary {
  title: string
  /**
   * Session id carried by the row's own `/a/chat/s/<id>` href. Absent only if
   * the markup changed; callers then fall back to title matching.
   */
  sessionId?: string
}

/**
 * Where a recovered transcript actually came from.
 *
 * `history-api` — the page's own authenticated history endpoint (one request,
 * the whole conversation, markdown + thinking).
 * `page-cache` — the app's persisted IndexedDB cache (used when the endpoint
 * is unavailable, and after opening a conversation the page had not cached).
 * `dom` — last resort: open the conversation and harvest the virtualised list.
 */
export type RecoverSource = 'history-api' | 'page-cache' | 'dom'

/** Result of recovering one web conversation into the local store. */
export interface RecoverResult {
  readonly ok: boolean
  readonly chatId?: string
  readonly title?: string
  readonly sessionId?: string
  /** True when a new local transcript was created. */
  readonly created?: boolean
  /** True when an existing transcript was overwritten with a fuller history. */
  readonly updated?: boolean
  /** Number of messages written. */
  readonly messageCount?: number
  readonly source?: RecoverSource
  readonly error?: string
}

/**
 * Structured engine error codes so callers (panel / agent tools) can act on a
 * failure instead of only printing it: NEED_LOGIN → prompt the login window;
 * PAGE_CHANGED → the DeepSeek page/stream protocol moved and the plugin likely
 * needs an upgrade; TIMEOUT → generation exceeded the reply window; NETWORK →
 * browser launch / HTTP / connectivity failure.
 */
export type DSchatErrorCode = 'NEED_LOGIN' | 'PAGE_CHANGED' | 'TIMEOUT' | 'NETWORK' | 'BUSY'

/** Coarse engine state for the panel. */
export type EngineState = 'stopped' | 'launching' | 'ready' | 'error'

/**
 * The fine-grained phase the panel's status gauge renders. Derived from the
 * coarse state plus login/busy/streaming so the user always sees which step the
 * engine is on — the single biggest "why is nothing happening" complaint about
 * the previous panel.
 */
export type DSchatPhase =
  | 'stopped'
  | 'launching'
  | 'need-login'
  | 'ready'
  | 'thinking'
  | 'streaming'
  | 'error'

/** Snapshot the panel polls. */
export interface DSchatState {
  readonly engine: EngineState
  readonly engineError?: string
  /** null = unknown yet; false = browser up but not logged in; true = chat page ready. */
  readonly loggedIn: boolean | null
  readonly pageUrl?: string
  /** Deep-think (R1) toggle state read from the page. */
  readonly deepThink: boolean
  /** Internet-search toggle state read from the page. */
  readonly search: boolean
  readonly activeChatId?: string
  readonly chats: DSchatTranscript[]
  /** True while a message is being sent / replied (serialized engine busy). */
  readonly busy: boolean
  /**
   * True while a just-created chat's page work is still on the engine queue.
   * The panel has already switched to the empty conversation; this drives the
   * "preparing" hint so the pause is explained instead of looking stuck.
   */
  readonly preparingNewChat?: boolean
  /** Epoch ms when the current turn started (panel renders the elapsed timer). */
  readonly busySince?: number
  /** Last send error, transient for the panel to display. */
  readonly lastError?: string
  /** Structured code for the last error (so the panel can show a targeted action). */
  readonly lastErrorCode?: DSchatErrorCode
  /**
   * A transcript-store problem (an unreadable file that was quarantined, or a
   * write that failed), reported once so the reader learns it before the
   * history looks inexplicably empty.
   */
  readonly storeWarning?: string
}

/**
 * One streaming tail response — the cheap, high-frequency feed the panel uses
 * while a reply is in flight.
 *
 * `/state` answers with the WHOLE store (2.6 MB on a 108-chat history) and, on
 * the way out, asks the page for its toggle states; polling that at the ~100 ms
 * a smooth reply needs would cost more than the reply itself. `/tail` answers
 * with one message, expressed as a delta against what the previous response
 * handed over, so a tick usually carries a few dozen new characters.
 */
export interface DSchatTail {
  readonly ok: boolean
  /** Chat this tail describes (the requested one, or the active chat). */
  readonly chatId?: string
  readonly activeChatId?: string
  /** True while a turn is in flight — the panel's signal to keep tailing. */
  readonly busy: boolean
  readonly busySince?: number
  /** The chat's own streaming flag. */
  readonly streaming: boolean
  readonly title?: string
  readonly updatedAt?: number
  readonly messageCount?: number
  /**
   * The chat's last assistant message, as `content = local.slice(0, head) + tail`.
   *
   * `head` is the length of the prefix this message shares with what the
   * PREVIOUS tail response carried; a `head` of 0 means the client's copy was
   * not usable (it desynced, or the message is new) and `tail` is the whole
   * body. Applying that one rule is all the client needs.
   */
  readonly message?: {
    readonly id: string
    readonly role: DSchatRole
    readonly ts: number
    readonly streaming: boolean
    readonly error?: string
    /**
     * Reasoning duration in ms, once the model has started answering.
     *
     * Carried on the tail — not only on the finished message — because the
     * label under the reasoning is rendered the moment the reasoning ends, and
     * the answer then streams for another minute with the tail as the only
     * feed.
     */
    readonly thinkingMs?: number
    /** Full content length in UTF-16 units (the client's next `at`). */
    readonly length: number
    readonly head: number
    readonly tail: string
    /**
     * Search sources collected so far, in citation order.
     *
     * Carried on the tail — not only on the finished message — because the
     * source URLs arrive DURING the reply (the search step precedes the answer
     * that cites it), so a citation chip can be clickable the moment it renders.
     */
    readonly sources?: readonly DSchatSource[]
  } | null
  readonly error?: string
}

/**
 * True when a stored reply body carries answer text AFTER its thinking block.
 *
 * The engine renders reasoning and answer into ONE markdown string, with the
 * reasoning wrapped in a leading `<details>` block. That makes the boundary
 * between 「还在思考」 and 「开始回答」 a property of the string, and both halves
 * need it: the engine times the reasoning with it (from the first snippet of
 * reasoning to the first snippet of answer), and the panel renders the two
 * halves apart.
 *
 * A message with no thinking block at all is all answer, so any content counts.
 * An UNTERMINATED block counts as "no answer yet" — the closer is written by the
 * engine only once the reasoning is complete, so its absence means the model is
 * still thinking.
 *
 * @param markdown - the stored message body.
 */
export function hasAnswerBody(markdown: string): boolean {
  const text = markdown.trimStart()
  if (!text.startsWith('<details>')) return text !== ''
  const close = text.indexOf('</details>')
  if (close < 0) return false
  return text.slice(close + '</details>'.length).trim() !== ''
}

/**
 * Derive the panel phase from a state snapshot. Pure so both halves (and tests)
 * agree on what the gauge shows.
 */
export function phaseOf(state: Pick<DSchatState, 'engine' | 'loggedIn' | 'busy' | 'chats'>): DSchatPhase {
  if (state.engine === 'error') return 'error'
  if (state.engine === 'launching') return 'launching'
  if (state.engine === 'stopped') return state.loggedIn === false ? 'need-login' : 'stopped'
  if (state.loggedIn === false) return 'need-login'
  if (state.busy) return state.chats.some(chat => chat.streaming) ? 'streaming' : 'thinking'
  return 'ready'
}

/**
 * Normalize a wire source list.
 *
 * POSITIONS ARE THE CONTRACT (`sources[N - 1]` is `[citation:N]`), so an entry
 * is never dropped — that would renumber every source after it and silently
 * point a claim at the wrong page. An entry the page did not name a URL for is
 * kept as an empty-url placeholder and renders as a plain, unclickable chip.
 * Only a wholly empty table becomes `undefined` (a reply that cited nothing has
 * no table at all).
 *
 * @param input - the list as it arrived (`undefined`/empty = no search).
 */
export function sourcesOf(input: readonly DSchatSource[] | undefined): DSchatSource[] | undefined {
  if (input === undefined || input.length === 0) return undefined
  // Trailing placeholders carry no number anyone can cite, so they are trimmed;
  // an interior one must stay (see above).
  let end = input.length
  while (end > 0 && (input[end - 1]?.url ?? '') === '') end--
  if (end === 0) return undefined
  return input.slice(0, end).map(source => (source?.title === undefined ? { url: source?.url ?? '' } : { url: source.url, title: source.title }))
}

/**
 * True when two source tables are the same list.
 *
 * The tail resends the whole table (numbering is positional), so without this
 * every tick would produce a fresh array and defeat React's identity bail-out —
 * the panel folds a tail ~10×/s.
 */
export function sameSources(left: readonly DSchatSource[] | undefined, right: readonly DSchatSource[] | undefined): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false
  return left.every((source, index) => source.url === right[index]?.url && source.title === right[index]?.title)
}

/**
 * Fold one {@link DSchatTail} response into the panel's snapshot.
 *
 * The other half of the /tail contract: the host computes `head`/`tail` from
 * what it last sent, and this applies it as `content.slice(0, head) + tail`.
 * Both live here — rather than one on each side — because they are one
 * agreement, and a change to either that the other does not follow is a
 * corrupted transcript rather than a visible error.
 *
 * Returns the SAME object when nothing changed, which matters: the panel folds
 * a response in ~10×/s and React bails out of re-rendering only on identity.
 * Pure, so the merge is testable without a browser.
 */
export function mergeTail(state: DSchatState, tail: DSchatTail): DSchatState {
  const status = {
    busy: tail.busy,
    busySince: tail.busySince,
    activeChatId: tail.activeChatId ?? state.activeChatId,
  }
  const statusChanged = state.busy !== status.busy
    || state.busySince !== status.busySince
    || state.activeChatId !== status.activeChatId

  const chatId = tail.chatId
  const chatIndex = chatId === undefined ? -1 : state.chats.findIndex(chat => chat.id === chatId)
  const message = tail.message ?? null
  if (chatIndex < 0 || message === null) return statusChanged ? { ...state, ...status } : state

  const chat = state.chats[chatIndex]
  const position = chat.messages.findIndex(item => item.id === message.id)
  const existing = position < 0 ? undefined : chat.messages[position]
  const content = (existing?.content ?? '').slice(0, message.head) + message.tail
  /*
   * Sources are sent whole on every tail (small, and numbering must never be
   * patched up incrementally), so an arrival is either a new table or the same
   * one — compare by URL list to keep React's identity bail-out working.
   */
  const sources = sourcesOf(message.sources) ?? existing?.sources
  const sourcesChanged = !sameSources(existing?.sources, sources)
  /*
   * The reasoning duration arrives ONCE, on the first tail after the answer
   * starts. It is never cleared: a tail that omits it (an older host, a tick
   * that raced the measurement) must not make the label fall back to 「思考中」.
   */
  const thinkingMs = message.thinkingMs ?? existing?.thinkingMs
  const messageChanged = existing === undefined
    || existing.content !== content
    || existing.streaming !== message.streaming
    || existing.error !== message.error
    || existing.thinkingMs !== thinkingMs
    || sourcesChanged
  const chatChanged = chat.streaming !== tail.streaming
    || (tail.updatedAt !== undefined && chat.updatedAt !== tail.updatedAt)
  if (!messageChanged && !chatChanged && !statusChanged) return state

  const merged: DSchatMessage = {
    ...(existing ?? {}),
    id: message.id,
    role: message.role,
    content,
    ts: message.ts,
    streaming: message.streaming,
    error: message.error,
    ...(thinkingMs === undefined ? {} : { thinkingMs }),
    ...(sources === undefined ? {} : { sources }),
  }
  return {
    ...state,
    ...status,
    chats: state.chats.map((item, i) => (i === chatIndex
      ? {
          ...item,
          streaming: tail.streaming,
          updatedAt: tail.updatedAt ?? item.updatedAt,
          messages: position < 0
            ? [...item.messages, merged]
            : item.messages.map((candidate, j) => (j === position ? merged : candidate)),
        }
      : item)),
  }
}

/** Engine-level operation results surfaced to agent tools. */
export interface SendResult {
  readonly ok: boolean
  readonly chatId?: string
  readonly reply?: string
  readonly error?: string
  /** Structured error code (when ok is false) for actionable handling. */
  readonly code?: DSchatErrorCode
  /**
   * True when the USER message reached the transcript even though the turn
   * failed (the reply never started).
   *
   * The panel needs this to know what a failed send means: `stored` set means
   * the message is already visible in the conversation and the right repair is
   * 「重试」, while `stored` unset means nothing was recorded and the draft must
   * go back into the composer — putting it back in the other case would
   * duplicate the message on the next send.
   */
  readonly stored?: boolean
}

/** Result of transferring a transcript into harness mode. */
export interface TransferResult {
  readonly ok: boolean
  readonly sessionId?: string
  readonly filePath?: string
  /** True when the session was attached to a workspace (grouped); false = ungrouped. */
  readonly attached?: boolean
  /** Workspace id the session landed in, when attached. */
  readonly workspaceId?: string
  /** True when the brief was appended to an existing session instead of a new one. */
  readonly continued?: boolean
  readonly error?: string
}

/**
 * How a transfer seeds the new harness session: 'distill' condenses the web
 * conversation into an executable task brief via the harness LLM; 'raw'
 * replays the full transcript verbatim. The web panel lets the user choose.
 */
export type TransferMode = 'distill' | 'raw'

/** API path constants shared by host routes and the browser panel. */
export const DSCHAT_API = {
  state: '/api/dsh-dschat/state',
  /**
   * Cheap streaming feed: one message, as a delta. Polled fast while a reply is
   * in flight; `/state` stays the slow, authoritative, whole-store snapshot.
   */
  tail: '/api/dsh-dschat/tail',
  context: '/api/dsh-dschat/context',
  openLogin: '/api/dsh-dschat/open-login',
  closeBrowser: '/api/dsh-dschat/close-browser',
  newChat: '/api/dsh-dschat/new-chat',
  restore: '/api/dsh-dschat/restore',
  attach: '/api/dsh-dschat/attach',
  send: '/api/dsh-dschat/send',
  stop: '/api/dsh-dschat/stop',
  deepThink: '/api/dsh-dschat/deep-think',
  search: '/api/dsh-dschat/search',
  transfer: '/api/dsh-dschat/transfer',
  exportFile: '/api/dsh-dschat/export',
  renameChat: '/api/dsh-dschat/rename',
  deleteChat: '/api/dsh-dschat/delete',
  clearChats: '/api/dsh-dschat/clear',
  webChats: '/api/dsh-dschat/web-chats',
  recover: '/api/dsh-dschat/recover',
  /**
   * Read-only diagnostics for the page scrapers. Exists because a failed
   * recover used to report only "读取网页会话历史失败（页面可能已改版）", which
   * cannot be acted on; this reports what the page actually contains.
   */
  probePage: '/api/dsh-dschat/probe-page',
} as const
