/**
 * DeepSeek web engine — the "Codex ChatGPT mode" analog for DeepSeek Harness.
 *
 * Drives a real browser (system Chrome/Edge via playwright-core) against
 * chat.deepseek.com with a dedicated persistent profile, so the user logs in
 * once with their own DeepSeek account (phone / password / Apple / WeChat QR)
 * and the session persists. Chatting happens THROUGH the real web page —
 * messages are typed into the real composer — so the plugin needs no API key,
 * no billing, and stays immune to DeepSeek's private-API PoW challenge.
 *
 * Replies are read by teeing the page's own SSE stream: an injected init
 * script wraps XMLHttpRequest and captures the `/api/v0/chat/completion`
 * response as it streams (the page has already solved PoW + auth, so we get
 * the model's raw markdown for free). DOM scraping of `.ds-markdown` is kept
 * only as a fallback for when the capture cannot install. The web chat runs
 * the `deepseek-chat` model by default (switchable to deepseek-reasoner).
 *
 * All page interactions are best-effort and selector-defensive: failures
 * produce readable errors (never crashes) and the caller decides how to
 * degrade.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import type { TranscriptStore } from '../store.ts'
import type {
  EngineState,
  SendResult,
  DSchatErrorCode,
  DSchatMessage,
  DSchatSource,
  DSchatTranscript,
  RecoverResult,
  RecoverSource,
  WakeResult,
  WebChatSummary,
} from '../protocol.ts'
import { hasAnswerBody, sourcesOf } from '../protocol.ts'
import { serializeToMarkdown } from './html-md.ts'

/**
 * True when an error is just "the browser went away underneath us".
 *
 * This matters because the engine tears the browser down as a normal event:
 * a restart, closing the login window, an explicit dispose, or the profile
 * lock being taken. Any page operation in flight at that moment rejects with
 * one of these messages, and recording it as a lasting engine error leaves the
 * panel showing a dead red banner for a browser that a fresh launch would
 * bring straight back (user report: "引擎错误：无法打开 http:...").
 *
 * Playwright does not export a typed error for this — the message text is the
 * only stable signal, and it is stable across the versions we support.
 */
export function isShutdownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return [
    // "Target page, context or browser has been closed", "Target closed",
    // "Page closed", "Browser has been closed", "Context closed".
    /\btarget\b[^.]*\bclosed\b/i,
    /\b(page|context|browser)\b[^.]*\bhas been closed\b/i,
    /\b(connection|protocol)\b[^.]*\bclosed\b/i,
    /Execution context was destroyed/i,
    /Browser closed/i,
  ].some(pattern => pattern.test(message))
}

/** Engine configuration (resolved from the plugin settings surface). */
export interface DSchatEngineConfig {
  /** Data dir root (browser profile lives under it unless `profileDir` is set). */
  dataDir: string
  /**
   * Browser profile directory override. dsh-DSchat points this at the profile
   * the previous dsh-webchat install already logged into, so the user does not
   * have to log into chat.deepseek.com again after switching plugins.
   */
  profileDir?: string
  /** Browser channel hint: 'chrome' | 'msedge' | 'chromium' | undefined (auto-detect). */
  channel?: string
  /** Explicit browser executable path (overrides channel detection). */
  executablePath?: string
  /** Proxy mode: 'direct' (--no-proxy-server), 'system' (browser default), or a proxy URL. */
  proxy?: string
  /** Visible browser window (required for the one-time login; defaults true). */
  headless?: boolean
  /** Max seconds to wait for a reply before returning the partial. */
  replyTimeoutMs?: number
  /** DeepSeek web origin. */
  baseUrl?: string
}

/** One scraped message from the page. */
interface ScrapedMessage {
  role: 'user' | 'assistant'
  parts: Array<{ kind: 'think' | 'body'; markdown: string; text: string }>
  /**
   * The answer's search sources, in citation order (see {@link DSchatSource}).
   *
   * Only the fragment sources can supply this — the DOM shows citation chips
   * without their targets — so an assistant message scraped off the rendered
   * page has none, while one read from the web's own history has the real URLs.
   */
  sources?: DSchatSource[]
}

/**
 * One fragment of a stored web message — the app's OWN history model, as
 * returned by `/api/v0/chat/history_messages` and as persisted in its
 * IndexedDB cache. Only the fields the plugin reads are modelled.
 *
 *   REQUEST     the user's text
 *   THINK       the reasoning (R1) text
 *   RESPONSE    the answer, already markdown (with `[citation:N]` markers)
 *   FILE        an attachment on the user's message (`files[]`)
 *   TOOL_SEARCH a search step (`content`, `queries[]`, `results[]`)
 *   TOOL_OPEN   one opened page (`result.title`)
 *   TIP         the UI's "AI 生成内容仅供参考" disclaimer
 */
export interface WebFragment {
  type?: string
  content?: string
  status?: string
  files?: Array<{ file_name?: string }>
  queries?: Array<{ query?: string }>
  results?: unknown[]
  result?: { title?: string; url?: string }
}

/** One stored web message (fragment container). */
export interface WebMessage {
  message_id?: number
  role?: string
  status?: string
  fragments?: WebFragment[]
}

/** What the app's history endpoint / cache hands back for one session. */
export interface WebHistory {
  title?: string
  messages: WebMessage[]
}

const DEFAULT_TIMEOUT_MS = 180_000

/**
 * Streaming poll period.
 *
 * Was 350 ms, which put a hard floor of ~3 Hz under everything the panel could
 * show no matter how fast the transport got. Reading the capture is now a
 * delta (page-side cursor) and parsing is incremental, so a tick costs
 * microseconds of JS plus one CDP round trip — 80 ms keeps the transcript
 * ~12×/s ahead of the panel's own poll without hammering the page.
 */
const STREAM_TICK_MS = 80

/**
 * How long the DOM fallback's scrape must stop changing before it is treated
 * as the finished answer.
 *
 * Was a tick count of 3, which silently meant 1050 ms because a tick was
 * 350 ms. At an 80 ms tick that same count would fire in 240 ms and could
 * freeze a previous turn's reply as this one's answer, so the window is now
 * wall-clock and matches the old behaviour exactly.
 */
const DOM_STABLE_MS = 1_000

/**
 * How long one submission may take to show that a turn has started.
 *
 * The page answers an accepted Enter almost immediately: the teed stream's
 * request begins within a tick or two, and the send button becomes the stop
 * button at the same moment. This budget exists to catch the OTHER case — a
 * composer that was not ready and swallowed the keystroke — before the panel
 * spends the full reply timeout (default 180 s) on a turn that never began.
 *
 * The cost of guessing wrong is asymmetric, which is why there is room here for
 * a slow page and not just a fast one: a FALSE failure tells the reader the
 * message was never sent, they retry it, and the page then holds the text
 * twice. Four seconds covers a first send after hours of idling on a page that
 * is still re-establishing itself, while a composer that really swallowed the
 * keystroke still fails long before the reader would give up on it.
 */
const SUBMIT_VERIFY_MS = 4_000

/** How often the submission check looks at the page while it waits. */
const SUBMIT_VERIFY_POLL_MS = 100

/**
 * Sidebar conversation rows on chat.deepseek.com.
 *
 * The site ships hashed CSS-module class names (`_546d736`, `c08e6e93`, …) that
 * churn on every deploy, so `[class*="conversation"]`-style probes match nothing
 * — verified against the live page, where every one of them returned 0 elements.
 * The row is an anchor to `/a/chat/s/<session id>`, which is a routing contract
 * the app cannot rename without breaking its own deep links. Group headings
 * ("置顶" / "今天" / "昨天") live OUTSIDE the anchor, so their text never leaks
 * into a title. Icons inside the row are text-free, so the anchor's own
 * textContent is the title.
 */
export const WEB_CHAT_LINK_SELECTOR = 'a[href*="/a/chat/s/"]'

/**
 * Message list of an opened web conversation. `[data-virtual-list-item-key]` is
 * the virtualizer's item key (structural, not a style class); the inner
 * `ds-*` names are the app's own semantic hooks for the reply body and the
 * reasoning block.
 */
export const WEB_MESSAGE_ITEM_SELECTOR = '[data-virtual-list-item-key]'

/**
 * The stop-generation affordance shown while a reply streams.
 *
 * The site renders its controls as `div[role="button"].ds-button`, not
 * `<button>`: a live probe of both the home and an opened conversation page
 * found ZERO `<button>` elements, so a `button:…`-only list can never match.
 * `role`/`aria-label` spellings lead and the `<button>` ones stay as fallbacks
 * for older page versions.
 */
export const WEB_STOP_SELECTORS = [
  '[role="button"][aria-label*="停止"]',
  '[aria-label*="停止"]',
  '[role="button"][aria-label*="stop generating" i]',
  '[aria-label*="stop generating" i]',
  '[role="button"]:has-text("停止生成")',
  'button:has-text("停止生成")',
  '[role="button"]:has-text("Stop generating")',
  'button:has-text("Stop generating")',
]

/** The "new chat" control, with the same `[role="button"]`-first ordering. */
export const WEB_NEW_CHAT_SELECTORS = [
  '[role="button"]:has-text("新对话")',
  'button:has-text("新对话")',
  '[role="button"]:has-text("New chat")',
  'button:has-text("New chat")',
  '[class*="newChat"]',
]

/**
 * The capture generation this engine half expects.
 *
 * Etched into the page script at BUILD time (playwright serializes
 * `streamCaptureInit`'s source, so the page cannot read a host constant any
 * other way) and compared by the engine against the page's
 * `window.__wcGenSupported`. A page reporting anything else is running an
 * installed bundle older than this source, and the generation guard is then
 * skipped entirely rather than silently discarding every request.
 */
const CAPTURE_GENERATION = 6

/** Capture bookkeeping that lives beside the buffer on the page. */
interface CaptureWindow {
  __wcCaptureInstalled?: boolean
  __wcStream?: StreamCapture
  /** Generation the engine last armed; requests from any other one are ignored. */
  __wcGen?: number
  /** Id of the request that currently owns the buffer. */
  __wcActiveReq?: number
  /** Bytes of the owning request already copied into the buffer. */
  __wcReqLen?: number
  /** Monotonic request key. */
  __wcReqSeq?: number
  /** Generation the installed page script was written for. */
  __wcGenSupported?: number
}

/**
 * Injected before any page script: tee the chat/completion XHR stream into
 * `window.__wcStream`. The DeepSeek web app reads its reply through an
 * XMLHttpRequest (POST /api/v0/chat/completion, responseType "text", SSE
 * body), so wrapping XHR `progress` events captures the raw `event:`/`data:`
 * stream exactly as the page receives it — no PoW, no auth, no selectors.
 * The function must stay self-contained (playwright serializes its source).
 *
 * ONE TURN OWNS THE BUFFER AT A TIME. The teed buffer is a single page-global,
 * but the engine abandons turns routinely — a submit whose verification fails,
 * a reply that hits its timeout, a stop, a user who retries — and the page
 * keeps streaming the abandoned request into that same object. The next turn
 * then inherited another turn's bytes: the observed failure was a message sent
 * the morning after an overnight idle, whose reply was stored as 115 characters
 * of a PREVIOUS turn's reasoning fragment and committed as complete, with no
 * error. So every request records the generation it was sent in
 * (`window.__wcGen`, bumped by the engine through `resetCapture` before it
 * submits), and only a request of the CURRENT generation may take ownership of
 * the buffer, append to it, or mark it done. A request whose generation has
 * passed writes nowhere: no bytes, and — the part that silently cut replies
 * short — no `done` flag to end the next turn's reply loop.
 */
function streamCaptureInit(): void {
  const w = window as unknown as CaptureWindow & {
    XMLHttpRequest: typeof XMLHttpRequest
    fetch: typeof fetch
    TextDecoder: typeof TextDecoder
    Response: typeof Response
  }
  if (w.__wcCaptureInstalled === true) return
  w.__wcCaptureInstalled = true
  w.__wcGenSupported = 6
  w.__wcGen = 0
  w.__wcStream = { text: '', done: false, started: false, status: 0, error: '' }
  // Deliberately `any`: this function is serialized by playwright and executed
  // in the page, so its signature is runtime JS rather than typed host code.
  const X: any = w.XMLHttpRequest
  const origOpen: any = X.prototype.open
  const origSend: any = X.prototype.send
  /** True while the page script and the host agree on the generation scheme. */
  const guarded = (): boolean => w.__wcGenSupported === 6
  /** Whether a request of `gen` is still allowed to write. */
  const current = (gen: number): boolean => guarded() === false || gen === w.__wcGen
  /** Claim the shared buffer for `req`, clearing anything a previous turn left. */
  const takeOwnership = (req: number): void => {
    w.__wcStream = { text: '', done: false, started: true, status: 0, error: '' }
    w.__wcActiveReq = req
    w.__wcReqLen = 0
  }
  /**
   * Append the bytes that are new in `text` to the buffer.
   *
   * Ownership is taken on the first write, which is also what clears whatever
   * the previous owner left behind: a request that reaches this function has
   * already been accepted as current by its caller, so it is the new turn.
   */
  const append = (req: number, text: string, complete: boolean, status?: number): void => {
    if (w.__wcActiveReq !== req) takeOwnership(req)
    const stream = w.__wcStream
    if (stream === undefined) return
    const seen = w.__wcReqLen ?? 0
    if (text.length > seen) {
      stream.text += text.slice(seen)
      w.__wcReqLen = text.length
    }
    stream.started = true
    if (complete) {
      stream.done = true
      stream.status = status ?? stream.status
      if (stream.status >= 400) stream.error = `HTTP ${stream.status}`
    }
  }
  X.prototype.open = function (this: any, method: string, url: string | URL, ...rest: any[]) {
    this.__wcIsChat = typeof url === 'string' && url.includes('/chat/completion')
    return origOpen.call(this, method, url, ...rest)
  }
  X.prototype.send = function (this: any, ...args: any[]) {
    if (this.__wcIsChat === true) {
      // The generation is read at SEND time: a request issued after the engine
      // armed a new turn belongs to it, and one already in flight keeps the
      // generation it started in — which is exactly how a stale request is
      // recognised and ignored.
      this.__wcGen = w.__wcGen ?? 0
      this.__wcReq = (w.__wcReqSeq = (w.__wcReqSeq ?? 0) + 1)
      let lastLen = 0
      const xhr = this
      xhr.addEventListener('progress', () => {
        // Read through the request's recorded generation, not the live one: a
        // request that started before the engine armed the next turn must not
        // slip into the new owner's buffer even if it writes a moment later.
        const text = xhr.responseText ?? ''
        if (current(xhr.__wcGen) === false) return
        if (text.length > lastLen) {
          lastLen = text.length
          append(xhr.__wcReq, text, false)
        }
      })
      xhr.addEventListener('loadend', () => {
        if (current(xhr.__wcGen) === false) return
        append(xhr.__wcReq, xhr.responseText ?? '', true, xhr.status)
      })
    }
    return origSend.apply(this, args)
  }

  // Also tee `fetch` — newer page builds may switch from XHR to fetch for the
  // same /chat/completion stream. response.body.tee() mirrors the stream to the
  // page untouched while we read the twin for capture. A capture failure must
  // never break the page's own consumption, so every step is try/caught.
  const origFetch: any = w.fetch.bind(w)
  w.fetch = function (this: any, input: any, init: any) {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input))
    const isChat = typeof url === 'string' && url.includes('/chat/completion')
    const gen = w.__wcGen ?? 0
    const req = (w.__wcReqSeq = (w.__wcReqSeq ?? 0) + 1)
    return origFetch(input, init).then((response: any) => {
      if (!isChat || response === null || response === undefined) return response
      const body = response.body
      if (body === null || body === undefined || typeof body.tee !== 'function') return response
      try {
        const [pageStream, captureStream] = body.tee()
        const decoder = new w.TextDecoder()
        const reader = captureStream.getReader()
        let captured = ''
        let complete = false
        // The status travels WITH the bytes through `append`: it belongs to the
        // request that owns the buffer, not to the shared object.
        const flush = (): void => append(req, captured, complete, response.status)
        void (async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              captured += decoder.decode(value, { stream: true })
              if (current(gen)) flush()
            }
            captured += decoder.decode()
            complete = true
            if (current(gen)) flush()
          } catch {
            // capture failure must never break the page's own consumption
          }
        })()
        return new w.Response(pageStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      } catch {
        return response
      }
    })
  }
}

/** Live capture buffer shape (mirrors window.__wcStream). */
interface StreamCapture {
  text: string
  done: boolean
  started: boolean
  status: number
  error: string
}

/**
 * One incremental read of {@link streamCaptureInit}'s buffer.
 *
 * `delta` is only what arrived since the previous read — the reply loop tracks
 * a page-side cursor (`window.__wcCursor`) so the whole accumulated SSE body
 * never crosses the CDP boundary twice.
 */
interface StreamCaptureDelta {
  /** SSE text that arrived since the previous read ('' when nothing is new). */
  delta: string
  done: boolean
  started: boolean
  status: number
  error: string
}

/** Parsed reply from the accumulated SSE text. */
export interface ParsedStreamReply {
  /** Markdown body (thinking wrapped in a <details> block). */
  markdown: string
  /** Raw thinking text (empty when the model has none). */
  thinking: string
  /** True once the stream reported FINISHED. */
  finished: boolean
  /**
   * The reply's search sources, in the web's own citation order (1-based:
   * `sources[N - 1]` is `[citation:N]`).
   *
   * Collected from the search steps as they stream in, which is the ONLY place
   * the URLs exist: the answer body carries the numbers alone, so a transcript
   * stored without this table can never render a clickable citation.
   */
  sources: DSchatSource[]
}

/**
 * DeepSeek citation numbering. The web numbers the *sources* (search results)
 * 1..M, not the `[reference:N]` markers. Each `[reference:N]` marker is paired
 * with a `references` op `{id,type}`:
 *   - `TOOL_OPEN`  → a specific opened page whose `result.url` matches one of
 *                    the search results; the citation number is that result's
 *                    1-based position in the search-results list.
 *   - `TOOL_SEARCH` → the search step itself, rendered by the web as a search
 *                    icon (no number) rather than a citation.
 * This is resolved inside `parseStreamReply`, which holds the search-results
 * list and the opened-page id→url map.
 */

/**
 * Defensive clean-up of the DeepSeek search-agent trace tokens. The parser
 * already routes `DEEP_SEARCH` (conversation_mode) and `FINISHED` (status)
 * events away from content, so this normally runs as a no-op; it exists for
 * the DOM-scrape fallback and any residual markers.
 */
function stripSearchTrace(text: string): string {
  return text
    .replace(/DEEP_SEARCH/g, '')
    .replace(/FINISHED+/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The previous turn's reply, as it stood before the new message was submitted.
 *
 * Returns the WHOLE stored message, reasoning block included, because that is
 * what the DOM fallback scrapes: comparing a scrape against a body-only copy
 * would line up the previous answer against the previous reasoning and report
 * every replica as new (the exact mistake this guard exists to prevent, one
 * level down).
 *
 * The last message is not always the reply — a question whose answer never
 * arrived leaves a user message last — so this walks back to the newest
 * assistant message that carries any text, and returns `''` when the
 * conversation has no assistant turn at all (a fresh chat: nothing to repeat).
 *
 * @param messages - the active chat's stored messages, in order.
 */
export function previousReplyMessage(messages: readonly DSchatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.role !== 'assistant') continue
    const text = message.content.trimStart()
    // A reply still streaming its reasoning has no body yet, but it is still
    // the previous reply and still the thing a scrape can echo.
    if (text !== '') return text
  }
  return ''
}

/**
 * Strip everything that differs between two RENDERINGS of one reply.
 *
 * The same answer reaches this file two ways: as the model's own markdown from
 * the teed stream, and as markdown re-serialized from the page's DOM. They
 * differ in whitespace (the DOM collapses block boundaries to spaces), in
 * emphasis markers and quote glyphs (the DOM's innerHTML loses the opening
 * `**` of an interrupted span), and in heading markers. None of that is
 * content, and comparing identity is the entire job here.
 */
function normalizeReplyText(text: string): string {
  return text
    .replace(/<\/?(?:details|summary)[^>]*>/gi, '')
    .replace(/[*_`~>#|]/g, '')
    // Everything that is not a letter or a digit, in any script: whitespace,
    // both quote styles, the em dash the web uses for subtitles, CJK
    // punctuation. `\p{L}`/`\p{N}` are what make this safe for 中文 as well as
    // ASCII — a class listing the punctuation by hand always misses some.
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Shortest normalized text worth comparing.
 *
 * Was 25, which was simply too high: a live reply is scraped while it is still
 * being written, so the text under judgement is routinely a short opening
 * fragment rather than a finished answer. At 25 the guard stayed silent for
 * exactly the replies it exists for — a real-browser replay caught a
 * 「思考过程旧思考旧答复」 replica (10 normalized characters) being committed
 * with the guard reporting "not a replica".
 *
 * 10 is safe at the other end because the overlap ratio is what decides: below
 * this length a shared prefix is normal Chinese prose (「你好」「好的，我…
 * 」), and a false refusal would cost the reader a genuine answer.
 */
const REPLICA_MIN_CHARS = 10

/** Share of the shorter text that must overlap to call it the same reply. */
const REPLICA_OVERLAP = 0.9

/**
 * Whether `scraped` is a re-rendering of `previous` rather than a new answer.
 *
 * "Starts with" alone was too strict: the observed replica was a collapsed copy
 * CUT SHORT mid-answer, so its 49 normalized characters sat entirely inside the
 * previous reply's 74 and then it simply stopped. Overlap of the shorter text is
 * what survives truncation, whitespace collapse and markdown loss while still
 * being far too specific for two DIFFERENT answers to share — a real answer
 * turns over within its first sentence.
 *
 * Both directions count, because the scrape can be longer than the stored copy
 * when the previous turn itself was stored from an early, partial scrape.
 *
 * @param scraped - markdown from the DOM fallback.
 * @param previous - the previous reply as stored (see `previousReplyMessage`).
 */
export function repeatsPreviousReply(scraped: string, previous: string): boolean {
  if (previous === '') return false
  const a = normalizeReplyText(previous)
  const b = normalizeReplyText(scraped)
  const shortest = Math.min(a.length, b.length)
  if (shortest < REPLICA_MIN_CHARS) return false
  const overlap = a.startsWith(b) || b.startsWith(a)
    ? shortest
    : commonPrefixLength(a, b)
  return overlap / shortest >= REPLICA_OVERLAP
}

/** Length of the shared prefix of two strings. */
function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let index = 0
  while (index < limit && a[index] === b[index]) index += 1
  return index
}

/** True when a fragment type is the R1 reasoning (THINK / THINKING). */
function isThinkingType(type: unknown): boolean {
  return typeof type === 'string' && type.toUpperCase().includes('THINK')
}

/**
 * Convert the web app's stored messages into the shape the DOM scraper
 * produces, so both recovery sources share ONE conversion path (and therefore
 * one place where `<details>` thinking blocks and attachments are rendered).
 *
 * Why this is the primary source rather than scraping: the fragment model IS
 * the conversation — the answer arrives as markdown (no HTML→markdown
 * round-trip), the reasoning arrives as its own fragment, and nothing depends
 * on which rows the virtualised list happens to have mounted.
 *
 * Search steps are rendered exactly like the live SSE parser renders them
 * (「搜索到 N 个网页」 / 「浏览 N 个页面」) so a recovered transcript is
 * indistinguishable from one produced by chatting in the panel.
 */
export function webMessagesToScraped(messages: WebMessage[]): ScrapedMessage[] {
  const out: ScrapedMessage[] = []
  for (const message of messages) {
    const fragments = Array.isArray(message.fragments) ? message.fragments : []
    const textOf = (type: string): string =>
      fragments.filter(fragment => fragment.type === type).map(fragment => fragment.content ?? '').join('')
    if (message.role === 'USER') {
      const attachments = fragments
        .filter(fragment => fragment.type === 'FILE')
        .flatMap(fragment => fragment.files ?? [])
        .map(file => (file.file_name ?? '').trim())
        .filter(name => name !== '')
      const body = textOf('REQUEST').trim()
      const content = [body, ...attachments.map(name => `（附件：${name}）`)].filter(part => part !== '').join('\n\n')
      if (content !== '') out.push({ role: 'user', parts: [{ kind: 'body', markdown: '', text: content }] })
      continue
    }
    const parts: ScrapedMessage['parts'] = []
    const thinking = renderThinking(fragments)
    if (thinking !== '') parts.push({ kind: 'think', markdown: '', text: thinking })
    const body = normalizeCitations(textOf('RESPONSE').trim())
    if (body !== '') parts.push({ kind: 'body', markdown: '', text: body })
    /*
     * Search sources, in the order the web numbered them: the answer's
     * `[citation:N]` markers are the ONLY pointers to them, and they are
     * resolvable exactly here (the rendered page keeps the URLs in its own
     * state, which a recover has no access to).
     *
     * A result the page did not name a URL for keeps its SLOT as an empty-url
     * placeholder: `[citation:N]` indexes this list, so dropping one would
     * renumber every source after it and link a claim to the wrong page. The
     * placeholder renders as a plain chip, and trailing ones are trimmed.
     */
    const sources = sourcesOf(
      fragments
        .filter(fragment => fragment.type === 'TOOL_SEARCH' || fragment.type === 'SEARCH')
        .flatMap(fragment => (Array.isArray(fragment.results) ? fragment.results : []))
        .map(result => {
          const entry = (typeof result === 'object' && result !== null ? result : {}) as Record<string, unknown>
          const url = entry['url']
          const title = entry['title'] ?? entry['name']
          return {
            url: typeof url === 'string' ? url : '',
            ...(typeof title === 'string' && title !== '' ? { title } : {}),
          }
        }),
    )
    // A message whose only fragments are a TIP / an unfinished search step has
    // nothing to show and is skipped rather than imported empty.
    if (parts.length > 0) out.push(sources === undefined ? { role: 'assistant', parts } : { role: 'assistant', parts, sources })
  }
  return out
}

/**
 * Render DeepSeek's two citation spellings as the one the panel knows.
 *
 * A stored answer carries either `[citation:N]` (already resolved by the web
 * client) or the raw `[reference:N]` marker it was generated with — older
 * conversations persist the raw form, and the panel's renderer only turns
 * `[citation:N]` into a numbered chip, so the raw form would show up as
 * literal noise. Both mean "source N of this answer"; resolving references to
 * the web's source numbering is impossible here because the persisted
 * `references` array is empty.
 */
function normalizeCitations(text: string): string {
  return text.replace(/\[reference:(\d+)\]/g, '[citation:$1]')
}

/**
 * Render the reasoning + search steps of one assistant message, in fragment
 * order. TOOL_OPEN pages are collected and listed together, mirroring the
 * streaming parser's "浏览 N 个页面" block.
 */
function renderThinking(fragments: WebFragment[]): string {
  let thinking = ''
  const opened: string[] = []
  for (const fragment of fragments) {
    if (isThinkingType(fragment.type)) {
      thinking += fragment.content ?? ''
      continue
    }
    if (fragment.type === 'TOOL_SEARCH' || fragment.type === 'SEARCH') {
      const count = Array.isArray(fragment.results) ? fragment.results.length : 0
      const label = count > 0 ? `搜索到 ${count} 个网页` : (fragment.content ?? '')
      const queries = (fragment.queries ?? [])
        .map(query => (query.query ?? '').trim())
        .filter(query => query !== '')
      if (label !== '') {
        thinking += `\n\n${label}${queries.length === 0 ? '' : `\n${queries.map(query => `- ${query}`).join('\n')}`}\n\n`
      }
      continue
    }
    if (fragment.type === 'TOOL_OPEN') {
      const title = fragment.result?.title
      if (typeof title === 'string' && title !== '') opened.push(title)
    }
  }
  if (opened.length > 0) thinking += `\n\n浏览 ${opened.length} 个页面\n${opened.map(title => `- ${title}`).join('\n')}\n\n`
  return thinking.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Parse the `/api/v0/chat/completion` SSE body into reply text.
 *
 * The stream is `event:` / `data:` lines; each `data:` payload is JSON. The
 * protocol distinguishes the R1 reasoning fragment (type `THINK`) from the
 * answer fragment (type `RESPONSE`), and carries search steps as `TOOL_SEARCH`
 * / `TOOL_OPEN` fragments:
 *   - {"v":{"response":{"fragments":[{"type":"THINK","content":"…"}]}}}
 *     a snapshot carrying the fragment list and their types.
 *   - {"p":"response/fragments","o":"APPEND","v":[{"type":"RESPONSE",…}]}
 *     appends a NEW fragment (reasoning / search / answer); `-1/content`
 *     deltas after this belong to that new fragment.
 *   - {"p":"response/fragments/-1/content","o":"APPEND","v":"是一座"} — appends
 *     a text delta to the CURRENT fragment's content.
 *   - {"p":"response/fragments/-1/results","o":"SET","v":[…]} — search results
 *     for a TOOL_SEARCH step (rendered as "搜索到 N 个网页").
 *   - {"v":"将"} — a bare delta continuing the current fragment; a bare
 *     `{"v":[{p:"content",o:"APPEND",v:"[reference:N]"},…]}` carries citation
 *     markers.
 *   - {"p":"response/status","o":"SET","v":"FINISHED"} — generation complete.
 *
 * Both of these read the same state machine: `parseStreamReply` feeds a whole
 * body (and is what the transfer/import paths and the tests use), while the
 * reply loop holds a {@link createStreamReplyParser} instance and feeds deltas.
 */

/**
 * Incremental feeder produced by {@link createStreamReplyParser}.
 *
 * One long-lived instance owns the parse state (citation tables, current
 * fragment type, body and reasoning text), so replaying a growing stream costs
 * the bytes fed rather than a fresh scan of everything seen so far.
 */
export interface StreamReplyParser {
  /**
   * Feed newly-arrived SSE text. Splitting is safe ANYWHERE — including in the
   * middle of a line — because an unterminated trailing line is held back until
   * its newline arrives.
   */
  push(chunk: string): void
  /** Process a trailing line that arrived without its newline (stream ended). */
  finish(): void
  /** The reply as rendered from everything fed so far. */
  snapshot(): ParsedStreamReply
}

/**
 * Incremental form of {@link parseStreamReply}.
 *
 * The reply loop used to re-parse the WHOLE accumulated stream on every tick:
 * measured at 2.1 ms for a 2k-character reply rising to 14.1 ms at 40k, run
 * ~10×/s over a buffer that only ever grows — quadratic overall, and the reason
 * long replies felt progressively chunkier. Feeding deltas into one parser
 * makes every tick cost its delta instead.
 */
export function createStreamReplyParser(): StreamReplyParser {
  let body = ''
  let thinking = ''
  let finished = false
  let currentType: unknown = 'RESPONSE'
  /** Text after the last newline: a line split across two `push` calls. */
  let pending = ''

  // Citation-resolution state. `searchResults` holds the sources of every search
  // result in stream order (1-based position = the web's citation number);
  // `openById` maps a TOOL_OPEN fragment id → its opened page url.
  const searchResults: DSchatSource[] = []
  const openById = new Map<number, string>()
  let urlToIndex: Map<string, number> | undefined

  const buildUrlIndex = (): Map<string, number> => {
    if (urlToIndex === undefined) {
      urlToIndex = new Map()
      searchResults.forEach((source, i) => {
        if (source.url !== '' && !urlToIndex!.has(source.url)) urlToIndex!.set(source.url, i)
      })
    }
    return urlToIndex
  }

  // Resolve `[reference:N]` markers to `[citation:K]` using their paired
  // `references` op. TOOL_OPEN → the search result's 1-based number;
  // TOOL_SEARCH (and anything unresolved) → dropped (the web shows an icon).
  const resolveCitations = (text: string, refs: unknown[] | null): string => {
    if (!Array.isArray(refs) || refs.length === 0) return text
    let i = 0
    return text.replace(/\[reference:\d+\]/g, () => {
      const ref = refs[i] as Record<string, unknown> | undefined
      i++
      if (typeof ref !== 'object' || ref === null) return ''
      if (ref['type'] !== 'TOOL_OPEN') return ''
      const id = ref['id']
      const url = typeof id === 'number' ? openById.get(id) : undefined
      if (url === undefined) return ''
      const idx = buildUrlIndex().get(url)
      return idx === undefined ? '' : `[citation:${idx + 1}]`
    })
  }

  // Route a content delta to the reasoning (R1) or the answer body. Citation
  // markers are resolved only inside `applyBatchOps`, which has the paired
  // `references` op; plain deltas never carry them.
  const appendContent = (text: string): void => {
    if (isThinkingType(currentType)) thinking += text
    else body += text
  }

  // Append newly-arrived fragments, tracking the current type and rendering
  // TOOL_OPEN steps as a "浏览 N 个页面" status block.
  const appendFragments = (fragments: unknown[]): void => {
    const opened: string[] = []
    for (const frag of fragments) {
      if (typeof frag !== 'object' || frag === null) continue
      const f = frag as Record<string, unknown>
      const type = f['type']
      if (typeof type === 'string') currentType = type
      const content = f['content']
      if (typeof content === 'string' && content !== '') {
        if (isThinkingType(type)) thinking += content
        else if (type === 'RESPONSE' || type === 'TEXT') body += content
      }
      if (type === 'TOOL_OPEN') {
        const result = f['result'] as Record<string, unknown> | undefined
        const title = result?.['title']
        if (typeof title === 'string' && title !== '') opened.push(title)
        const id = f['id']
        const url = result?.['url']
        if (typeof id === 'number' && typeof url === 'string' && url !== '') {
          openById.set(id, url)
        }
      }
    }
    if (opened.length > 0) {
      thinking += `\n\n浏览 ${opened.length} 个页面\n${opened.map(t => `- ${t}`).join('\n')}\n\n`
    }
  }

  // Apply the ops inside a BATCH payload (bare or path-addressed). Citation
  // batches pair a `content` APPEND (`[reference:N]`) with a `references`
  // op, so collect them and resolve after the loop.
  const applyBatchOps = (ops: unknown[]): void => {
    let contentText = ''
    let hasContent = false
    let refs: unknown[] | null = null
    const fragmentsList: unknown[][] = []
    for (const item of ops) {
      if (typeof item !== 'object' || item === null) continue
      const it = item as Record<string, unknown>
      const ip = it['p']
      const iop = it['o']
      const iv = it['v']
      if (ip === 'content' && iop === 'APPEND' && typeof iv === 'string') {
        contentText += iv
        hasContent = true
      } else if (ip === 'references' && Array.isArray(iv)) {
        refs = iv
      } else if (ip === 'fragments' && iop === 'APPEND' && Array.isArray(iv)) {
        fragmentsList.push(iv)
      }
    }
    for (const fr of fragmentsList) appendFragments(fr)
    if (hasContent) {
      if (isThinkingType(currentType)) thinking += contentText
      else body += resolveCitations(contentText, refs)
    }
  }

  /**
   * Apply one complete SSE line. `return` replaces the old loop's `continue`,
   * so this is the original loop body unchanged.
   */
  const consumeLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (payload === '') return
    let obj: unknown
    try {
      obj = JSON.parse(payload)
    } catch {
      return
    }
    if (typeof obj !== 'object' || obj === null) return
    const o = obj as Record<string, unknown>
    const v = o['v']

    // 1. Snapshot — the full fragment list (normally only at reply start).
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && 'response' in v) {
      const resp = (v as Record<string, unknown>)['response'] as Record<string, unknown> | undefined
      const fragments = resp?.['fragments']
      if (Array.isArray(fragments)) {
        let newBody = ''
        let newThinking = ''
        for (const frag of fragments) {
          if (typeof frag !== 'object' || frag === null) continue
          const f = frag as Record<string, unknown>
          const type = f['type']
          if (typeof type === 'string') currentType = type
          const content = f['content']
          if (typeof content !== 'string' || content === '') continue
          if (isThinkingType(type)) newThinking += content
          else if (type === 'RESPONSE' || type === 'TEXT') newBody += content
        }
        if (newBody !== '') body = newBody
        if (newThinking !== '') thinking = newThinking
      }
      return
    }

    const p = o['p']
    const op = o['o']

    // 2. Direct fragment append — a new fragment (reasoning / search / answer).
    if (p === 'response/fragments' && op === 'APPEND' && Array.isArray(v)) {
      appendFragments(v)
      return
    }

    // 3. Path-addressed events — content deltas, search results, status, mode.
    if (typeof p === 'string') {
      // A `-1/content` delta may omit the `o` field (implied APPEND); accept it
      // whenever `o` is absent or "APPEND".
      if (typeof v === 'string' && p === 'response/fragments/-1/content' && op !== 'SET') {
        appendContent(v)
      } else if (op === 'SET' && p === 'response/fragments/-1/results' && Array.isArray(v)) {
        for (const r of v) {
          if (typeof r === 'object' && r !== null) {
            const entry = r as Record<string, unknown>
            const url = entry['url']
            if (typeof url === 'string' && url !== '') {
              // The title is what makes the chip's tooltip and the source list
              // readable ("cnblogs.com" tells the reader nothing about the page).
              const title = entry['title'] ?? entry['name']
              searchResults.push(typeof title === 'string' && title !== '' ? { url, title } : { url })
            }
          }
        }
        // The table just grew: the memoized url → number index must be rebuilt.
        urlToIndex = undefined
        thinking += `\n\n搜索到 ${v.length} 个网页\n\n`
      } else if (op === 'SET' && p === 'response/status' && v === 'FINISHED') {
        finished = true
      } else if (op === 'BATCH' && Array.isArray(v)) {
        applyBatchOps(v)
      }
      // conversation_mode / elapsed_secs / fragment status FINISHED / references → ignored
      return
    }

    // 4. Bare batch — {"v":[{p:"content",o:"APPEND",v:"[reference:N]"},…]}
    if (Array.isArray(v)) {
      applyBatchOps(v)
      return
    }

    // 5. Bare delta — {"v":"…"} continues the current fragment.
    if (typeof v === 'string') appendContent(v)
  }

  /** Render the accumulated state exactly as the whole-text entry point does. */
  const snapshot = (): ParsedStreamReply => {
    const thinkMd = thinking.trim() === ''
      ? ''
      : `<details><summary>思考过程</summary>\n\n${thinking.trim()}\n\n</details>`
    const markdown = [thinkMd, body.trim()].filter(s => s !== '').join('\n\n')
    // A copy, so a caller holding a snapshot never sees the table grow under it.
    return { markdown, thinking, finished, sources: [...searchResults] }
  }

  return {
    push(chunk: string): void {
      if (chunk === '') return
      pending += chunk
      const lastBreak = pending.lastIndexOf('\n')
      if (lastBreak < 0) return
      const complete = pending.slice(0, lastBreak)
      pending = pending.slice(lastBreak + 1)
      // Splitting on '\n' alone (rather than /\r?\n/) keeps a CRLF pair from
      // being seen as a line break in the middle: a chunk ending on '\r' leaves
      // that byte in `pending` until its '\n' arrives, and `consumeLine` trims
      // the '\r' off the reassembled line exactly as the whole-text form did.
      for (const line of complete.split('\n')) consumeLine(line)
    },
    finish(): void {
      if (pending === '') return
      const rest = pending
      pending = ''
      consumeLine(rest)
    },
    snapshot,
  }
}

/**
 * Whole-body entry point — the same state machine, fed in one shot.
 *
 * Kept because the reply loop is not the only reader: it is also the shape the
 * tests and the diagnostics use, and having both spellings share one
 * implementation is what keeps them from drifting.
 */
export function parseStreamReply(raw: string): ParsedStreamReply {
  const parser = createStreamReplyParser()
  parser.push(raw)
  parser.finish()
  return parser.snapshot()
}

/** Order-preserving promise queue — the browser page handles one chat op at a time. */
class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task)
    this.tail = next.catch(() => undefined)
    return next
  }
}

export class DeepSeekWebEngine {
  private readonly store: TranscriptStore
  private readonly config: DSchatEngineConfig
  private readonly profileDir: string
  private context: BrowserContext | undefined
  private page: Page | undefined
  private readonly queue = new SerialQueue()
  private state: EngineState = 'stopped'
  private engineError: string | undefined
  private busy = false
  /** Epoch ms when the current turn started (panel renders the elapsed timer). */
  private busySince: number | undefined
  private lastError: string | undefined
  private lastErrorCode: DSchatErrorCode | undefined
  /**
   * A "new chat" whose local transcript already exists but whose page work is
   * still on the serial queue. The panel switches immediately; `send` rides the
   * same queue, so it can never overtake this.
   */
  private newChatPending = false
  /** Set when that page work failed, so the next send refuses instead of misfiring. */
  private newChatError: string | undefined
  /**
   * True while a self-heal relaunch kicked off by `status()` is still running.
   *
   * `status()` must never await a launch (see its self-heal branch), so the
   * work runs in the background and this flag is what both keeps it to ONE
   * launch and lets the status view report 'launching' honestly meanwhile.
   */
  private relaunchPending = false
  /**
   * The launch currently in flight, if any.
   *
   * `ensureBrowser` used to answer a SECOND caller by polling for ten seconds
   * and then throwing 「浏览器启动超时」 — while one launch is
   * `launchPersistentContext` plus a 45 s `page.goto`, i.e. routinely longer
   * than that budget. Two callers reaching a cold engine (the panel waking it,
   * the `/state` self-heal, or a wake that overtook a send) therefore turned
   * into a spurious timeout on the second one. Holding the promise makes every
   * caller await the SAME launch and see its real outcome.
   */
  private launchInFlight: Promise<Page> | undefined
  private launchedOnce = false
  /**
   * True while a headed one-time login window is open.
   *
   * Cleared as soon as the page reports a session — but the page is no longer
   * closed at that moment (see `watchLogin`), because that close was half of the
   * "网页端启动了两次" report.
   */
  private loginMode = false
  /** Remembered login state — survives the auto-close so the panel stays "已登录". */
  private loggedInOnce = false
  /** Commanded toggle state (best-effort read-back overrides on status). */
  private deepThink = false
  private search = false

  constructor(store: TranscriptStore, config: DSchatEngineConfig) {
    this.store = store
    this.config = config
    this.profileDir = config.profileDir ?? join(config.dataDir, 'browser-profile')
  }

  /** Coarse state for status snapshots. */
  getState(): EngineState {
    return this.state
  }

  getEngineError(): string | undefined {
    return this.engineError
  }

  getBusy(): boolean {
    return this.busy
  }

  /** Epoch ms the current turn started, or undefined while idle. */
  getBusySince(): number | undefined {
    return this.busySince
  }

  getLastError(): string | undefined {
    return this.lastError
  }

  getLastErrorCode(): DSchatErrorCode | undefined {
    return this.lastErrorCode
  }

  /** Set the last error + its structured code together (keeps them in sync). */
  private setLastError(message: string | undefined, code?: DSchatErrorCode): void {
    this.lastError = message
    this.lastErrorCode = code
  }

  private setState(next: EngineState, error?: string): void {
    this.state = next
    this.engineError = error
  }
  /** Resolve a browser launch descriptor (executable + args). */
  private launchOptions(): { channel?: string; executablePath?: string; args: string[] } {
    const args: string[] = []
    const proxy = this.config.proxy ?? 'direct'
    if (proxy === 'direct') args.push('--no-proxy-server')
    else if (proxy.startsWith('http')) args.push(`--proxy-server=${proxy}`)
    // channel wins; explicit path beats both.
    if (this.config.executablePath !== undefined) return { executablePath: this.config.executablePath, args }
    if (this.config.channel !== undefined && this.config.channel !== 'auto') return { channel: this.config.channel, args }
    // Auto: probe the known system browsers in order (playwright channels first,
    // then explicit paths on each OS).
    const candidates: Array<{ channel?: string; executablePath?: string }> = [
      { channel: 'chrome' },
      { channel: 'msedge' },
      { channel: 'chromium' },
      { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { executablePath: '/usr/bin/google-chrome' },
      { executablePath: '/usr/bin/google-chrome-stable' },
      { executablePath: '/usr/bin/microsoft-edge' },
      { executablePath: '/usr/bin/chromium' },
      { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
      { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
    ]
    return { ...candidates[0], args }
  }

  /** True when the cached page/context are still connected (not closed by the user). */
  private isPageAlive(): boolean {
    if (this.page === undefined || this.context === undefined) return false
    try {
      return !this.page.isClosed()
    } catch {
      return false
    }
  }

  /**
   * True when this browser profile has been used before — i.e. it plausibly
   * holds a DeepSeek session.
   *
   * It exists to keep the FIRST run to a single browser launch. A login needs a
   * visible window and a visible window cannot be produced by a browser that is
   * already running, so "launch headless, discover /sign_in, relaunch headed"
   * costs a first-time reader two launches for one login. An empty profile dir
   * settles the question before the first launch: nothing to reuse, so go
   * straight to the login window. A profile that HAS run before is the opposite
   * case — it is very likely still authenticated, and waking it headless is
   * both faster and invisible.
   */
  private hasProfileData(): boolean {
    const marks = [
      join(this.profileDir, 'Default', 'Cookies'),
      join(this.profileDir, 'Cookies'),
      join(this.profileDir, 'Default', 'Local Storage'),
    ]
    return marks.some(mark => {
      try {
        return existsSync(mark)
      } catch {
        return false
      }
    })
  }

  /**
   * Ensure the browser + chat.deepseek.com page exist. Launches the persistent
   * context on first call; subsequent calls reuse the page.
   *
   * Concurrent callers share ONE launch (see `launchInFlight`): this method is
   * reached from three directions at once — the panel waking the engine, the
   * `/state` self-heal, and a send — and each of them used to be able to start
   * its own browser.
   */
  async ensureBrowser(): Promise<Page> {
    if (this.isPageAlive()) return this.page!
    if (this.launchInFlight !== undefined) return await this.launchInFlight
    const task = this.launchBrowser()
    this.launchInFlight = task
    try {
      return await task
    } finally {
      if (this.launchInFlight === task) this.launchInFlight = undefined
    }
  }

  /** The launch itself: pick a browser, open the chat page, report 'ready'. */
  private async launchBrowser(): Promise<Page> {
    // Clear any stale (dead) page/context before relaunching.
    if (this.page !== undefined || this.context !== undefined) await this.disposeBrowser()
    this.setState('launching')
    try {
      mkdirSync(this.profileDir, { recursive: true, mode: 0o700 })
      const options = this.launchOptions()
      const attemptOrder: Array<{ channel?: string; executablePath?: string }> =
        this.config.executablePath !== undefined || (this.config.channel !== undefined && this.config.channel !== 'auto')
          ? [options]
          : this.launchOptionsCandidates()
      let lastError: unknown
      for (const attempt of attemptOrder) {
        try {
          this.context = await chromium.launchPersistentContext(this.profileDir, {
            ...attempt,
            // The one-time login window must be visible; normal (chat) launches
            // are headless by default so the browser stays out of the way.
            headless: this.loginMode ? false : (this.config.headless ?? true),
            viewport: null,
            args: options.args,
          })
          lastError = undefined
          break
        } catch (error) {
          lastError = error
          await this.disposeBrowser()
        }
      }
      if (lastError !== undefined) {
        // A launch interrupted by teardown (restart, the login window being
        // closed) must not be reported as "no browser installed".
        if (isShutdownError(lastError)) {
          this.setState('stopped')
          throw lastError
        }
        this.setState('error', `无法启动浏览器（请检查 Chrome/Edge 是否已安装，或在插件设置中指定可执行文件路径）: ${String(lastError)}`)
        throw new Error(this.engineError)
      }
      const pages = this.context!.pages()
      this.page = pages[0] ?? (await this.context!.newPage())
      this.page.setDefaultTimeout(15_000)
      await this.page.addInitScript(streamCaptureInit)
      await this.openDeepSeekPage()
      this.setState('ready')
      this.launchedOnce = true
      return this.page
    } catch (error) {
      /*
       * Same rule as openDeepSeekPage: a teardown while we were bringing the
       * browser up is not an engine failure. Never let it latch 'error' — the
       * panel would show a red banner for a browser the next click relaunches.
       * openDeepSeekPage has already disposed the dead handles and set
       * 'stopped' in that case.
       */
      if (isShutdownError(error)) {
        if (this.state !== 'stopped') {
          await this.disposeBrowser().catch(() => undefined)
          this.setState('stopped')
        }
      } else if (this.state !== 'error') {
        this.setState('error', String(error))
      }
      throw error
    }
  }

  /** The candidate list used during auto-detection. */
  private launchOptionsCandidates(): Array<{ channel?: string; executablePath?: string }> {
    const all: Array<{ channel?: string; executablePath?: string }> = [
      { channel: 'chrome' },
      { channel: 'msedge' },
      { channel: 'chromium' },
      { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { executablePath: '/usr/bin/google-chrome' },
      { executablePath: '/usr/bin/google-chrome-stable' },
      { executablePath: '/usr/bin/microsoft-edge' },
      { executablePath: '/usr/bin/chromium' },
      { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
      { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
    ]
    return all.filter(candidate => {
      if (candidate.channel !== undefined) return true
      return candidate.executablePath !== undefined && existsSync(candidate.executablePath)
    })
  }

  /** Navigate to the DeepSeek chat root. */
  private async openDeepSeekPage(): Promise<void> {
    if (this.page === undefined) throw new Error('浏览器尚未启动')
    const baseUrl = this.config.baseUrl ?? 'https://chat.deepseek.com'
    try {
      await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      // Let the SPA settle; login redirects to /sign_in when not authenticated.
      await this.page.waitForTimeout(2_500)
    } catch (error) {
      /*
       * The browser being torn down mid-navigation is not a navigation failure.
       * `newChat()` runs this on the background queue precisely so the panel can
       * switch immediately, which means a restart or a closed login window can
       * land here — and the old code then latched `state = 'error'` with
       * "无法打开 …：Target page, context or browser has been closed" forever,
       * because status() only self-heals out of 'ready'. Drop the dead handles
       * and report it as "stopped", which is what it is: nothing is running and
       * the next action launches a fresh browser.
       */
      if (isShutdownError(error)) {
        await this.disposeBrowser()
        this.setState('stopped')
        throw error instanceof Error ? error : new Error(String(error))
      }
      this.setState('error', `无法打开 ${baseUrl}：${String(error)}`)
      throw new Error(this.engineError)
    }
  }

  /** True when the page shows the chat UI (not the login page). */
  async isLoggedIn(): Promise<boolean | null> {
    if (!this.isPageAlive()) return null
    try {
      const url = this.page!.url()
      if (url.includes('/sign_in') || url.includes('/auth')) return false
      const hasComposer = await this.page!.locator('textarea').count().then(count => count > 0).catch(() => false)
      return hasComposer
    } catch {
      return null
    }
  }

  /**
   * Bring the web page up for a reader who wants to type — WITHOUT assuming a
   * login window is what they need.
   *
   * This is what the panel calls when the composer is clicked or a message is
   * submitted while the engine is down. It is deliberately NOT `openLoginWindow`:
   * a profile that is already authenticated only needs a browser, and asking for
   * the visible login window first is what made one click cost two launches —
   * the window opened (headed, disposing whatever was running), saw the
   * persisted session, closed itself again, and the following send had to launch
   * a second, headless browser to do the actual work.
   *
   * So the wake is one launch in the right mode:
   *   - a live page is reused, never relaunched;
   *   - a profile with no history at all goes straight to the visible login
   *     window (there is nothing to reuse, and a login needs a human);
   *   - everything else wakes headless per the browser settings, and only a page
   *     that reports /sign_in escalates to the visible window afterwards.
   *
   * Serialized on the engine queue: a wake may dispose and relaunch a browser,
   * which must never happen while a send is typing into the old one.
   */
  async wake(): Promise<WakeResult> {
    return this.queue.run(async () => {
      if (this.isPageAlive()) {
        const loggedIn = await this.isLoggedIn()
        if (loggedIn === true) this.loggedInOnce = true
        return { ok: true, loggedIn, launched: false }
      }
      /*
       * First run (nothing in the profile, nothing logged in this process): the
       * only useful thing a browser can show is the sign-in page, so open the
       * visible window directly instead of paying for a headless launch that is
       * guaranteed to land on /sign_in and then be thrown away. A profile that
       * has run before gets the quiet path — if its session has expired after
       * all, the panel escalates to the login window on the wake's answer.
       */
      if (!this.loggedInOnce && !this.hasProfileData()) {
        /*
         * Dead handles are dropped FIRST, and deliberately before the mode is
         * set: `disposeBrowser` resets `loginMode`, so setting it first would be
         * silently undone by the dispose inside `launchBrowser` and the
         * first-run window would come up headless — i.e. the launch this branch
         * exists to avoid.
         */
        if (this.page !== undefined || this.context !== undefined) await this.disposeBrowser()
        this.loginMode = true
      }
      try {
        await this.ensureBrowser()
      } catch (error) {
        this.loginMode = false
        return { ok: false, error: String(error), loggedIn: null, launched: false }
      }
      const loggedIn = await this.isLoggedIn()
      if (loggedIn === true) {
        this.loggedInOnce = true
        this.loginMode = false
        return { ok: true, loggedIn: true, launched: true }
      }
      if (this.loginMode) {
        // The visible window is up and waiting for a human; watch it so the
        // panel's next poll flips to 已登录 the moment they finish.
        void this.watchLogin()
        return { ok: true, loggedIn: false, launched: true, loginWindow: true }
      }
      return { ok: true, loggedIn, launched: true }
    })
  }

  /**
   * Open a visible browser window for the one-time login (the panel's explicit
   * 「打开登录窗口」, and the escalation a wake takes when it finds /sign_in).
   *
   * Idempotent and non-destructive on purpose:
   *   - a live page that is ALREADY logged in is reused and brought forward. The
   *     old version disposed it first, so a click that raced a stale "not logged
   *     in" snapshot tore down a perfectly good browser and relaunched it —
   *     the worst form of the double launch;
   *   - a login window that is already open is reused too, so a second click
   *     (or a second panel) cannot spawn a second browser;
   *   - only a page that genuinely cannot log in — the sign-in screen itself, or
   *     no page at all — is replaced by a fresh headed window.
   */
  async openLoginWindow(): Promise<WakeResult> {
    return this.queue.run(() => this.openLoginInner())
  }

  /** The queued-open form: `wake` already runs on the queue and calls this. */
  private async openLoginInner(): Promise<WakeResult> {
    if (this.isPageAlive()) {
      if (this.loginMode) {
        await this.page?.bringToFront().catch(() => undefined)
        return { ok: true, loggedIn: false, launched: false, loginWindow: true, reused: true }
      }
      if (await this.isLoggedIn() === true) {
        this.loggedInOnce = true
        await this.page?.bringToFront().catch(() => undefined)
        return { ok: true, loggedIn: true, launched: false, reused: true }
      }
    }
    try {
      // Close the running (necessarily not-logged-in, probably headless)
      // browser first so we always open a fresh *visible* window.
      if (this.page !== undefined || this.context !== undefined) await this.disposeBrowser()
      this.loginMode = true
      await this.ensureBrowser()
      await this.page?.bringToFront().catch(() => undefined)
      void this.watchLogin()
      return { ok: true, loggedIn: false, launched: true, loginWindow: true }
    } catch (error) {
      this.loginMode = false
      return { ok: false, error: String(error), loggedIn: null, launched: false }
    }
  }

  /**
   * Poll a login window and mark the engine ready once the user has signed in.
   *
   * It used to CLOSE the browser at that moment, and that single line is the
   * other half of the "网页端又启动了一次" report: the next send found no page
   * and launched a fresh (headless) browser, so one login cost two launches and
   * threw away a page that was already sitting on the chat UI, authenticated.
   * The page is KEPT — the next send types straight into it. 「关闭浏览器」 in the
   * panel's ··· menu is how a reader gets rid of the visible window.
   */
  private async watchLogin(): Promise<void> {
    for (let attempt = 0; attempt < 600; attempt++) {
      if (!this.loginMode) return
      if (!this.isPageAlive()) {
        // The user closed the window manually; stop watching. Report it as
        // stopped, or the `/state` self-heal would relaunch a browser behind an
        // abandoned login attempt (it heals a dead page in state 'ready').
        this.loginMode = false
        if (this.state !== 'error') this.setState('stopped')
        return
      }
      if (await this.isLoggedIn() === true) {
        this.loginMode = false
        this.loggedInOnce = true
        this.setState('ready')
        return
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  /** Current page URL (for status/debug). */
  pageUrl(): string | undefined {
    if (!this.isPageAlive()) return undefined
    try {
      return this.page?.url()
    } catch {
      return undefined
    }
  }

  /**
   * Best-effort read of the deep-think (R1) and search toggle state from the
   * page. The toggles are `div.ds-toggle-button` elements (NOT `<button>`)
   * carrying `aria-pressed` plus a `ds-toggle-button--selected` class when on;
   * the search toggle is labeled 智能搜索. Falls back to the last commanded
   * state when the page gives no clear signal.
   */
  private async readToggles(): Promise<{ deepThink: boolean; search: boolean }> {
    if (!this.isPageAlive()) return { deepThink: this.deepThink, search: this.search }
    try {
      const pageState = await this.page!.evaluate(() => {
        const read = (candidates: string[]): boolean | undefined => {
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('[aria-pressed]'))) {
            const label = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`
            if (!candidates.some(candidate => label.includes(candidate))) continue
            const pressed = el.getAttribute('aria-pressed')
            if (pressed === 'true') return true
            if (pressed === 'false') return false
            const cls = typeof el.className === 'string' ? el.className : ''
            if (/ds-toggle-button--selected|--selected|active|checked/i.test(cls)) return true
          }
          return undefined
        }
        return {
          deepThink: read(['深度思考', 'DeepThink', 'Deep Think', 'R1']),
          search: read(['智能搜索', '联网搜索', '搜索', 'Search']),
        }
      })
      return {
        deepThink: pageState.deepThink ?? this.deepThink,
        search: pageState.search ?? this.search,
      }
    } catch {
      return { deepThink: this.deepThink, search: this.search }
    }
  }

  /** Serialized page evaluation guarded against a dead page. */
  private async evalPage<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.page === undefined) throw new Error('浏览器尚未启动')
    return this.page.evaluate(fn)
  }

  /**
   * In-page scraper: returns the ordered rendered messages currently in the
   * DOM. Uses the virtual-list item keys as message boundaries and the
   * assistant-main-content class to split roles. Fallback only — the primary
   * reply source is the teed SSE stream.
   */
  /**
   * The message-list item keys currently mounted in the page.
   *
   * `[data-virtual-list-item-key]` is the app's virtualizer key, and it is the
   * one stable per-message identity the DOM offers (the surrounding class names
   * are hashed and churn on every deploy). Comparing the set before a send with
   * the set after it answers the only question the DOM fallback has to get
   * right: has this turn's reply appeared yet, or is this still the last turn's?
   */
  private async messageKeys(): Promise<string[]> {
    if (this.page === undefined) return []
    return await this.page.evaluate((selector: string) => {
      const keys: string[] = []
      for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const key = element.getAttribute('data-virtual-list-item-key') ?? ''
        if (key !== '') keys.push(key)
      }
      return keys
      // A page that cannot be evaluated (closed, navigating) has no keys: the
      // caller treats that as "no evidence" rather than as "nothing new".
    }, WEB_MESSAGE_ITEM_SELECTOR).catch(() => [] as string[])
  }

  private async scrapeConversation(): Promise<ScrapedMessage[]> {
    if (this.page === undefined) return []
    interface RawMessage {
      role: 'user' | 'assistant'
      parts: Array<{ kind: 'think' | 'body'; markdown: string; text: string }>
    }
    const raw = await this.page.evaluate((itemSelector: string): RawMessage[] => {
      const extract = (element: Element): { markdown: string; text: string } => {
        const clone = element.cloneNode(true) as HTMLElement
        for (const junk of clone.querySelectorAll('.ds-markdown-code-copy-button, button, svg, [class*="copy"]')) {
          junk.remove()
        }
        return { markdown: clone.innerHTML, text: clone.innerText }
      }
      const out: RawMessage[] = []
      const items = document.querySelectorAll(itemSelector)
      for (const item of Array.from(items)) {
        const assistant = item.querySelector('.ds-assistant-message-main-content')
        const think = item.querySelector('.ds-think-content')
        /*
         * A reply whose generation was STOPPED renders without the
         * `.ds-assistant-message-main-content` wrapper (measured: it keeps
         * `.ds-think-content` and `.ds-markdown` only). Testing for the wrapper
         * alone therefore filed those rows as user bubbles, which is the wrong
         * role and the wrong text; any of the three markers identifies a reply.
         */
        const body = assistant === null
          ? item.querySelector('.ds-markdown')
          : (assistant.classList.contains('ds-markdown') ? assistant : assistant.querySelector('.ds-markdown'))
        if (assistant !== null || think !== null || body !== null) {
          const parts: Array<{ kind: 'think' | 'body'; markdown: string; text: string }> = []
          if (think !== null) parts.push({ kind: 'think', ...extract(think) })
          if (body !== null) parts.push({ kind: 'body', ...extract(body) })
          if (parts.length > 0) out.push({ role: 'assistant', parts })
        } else {
          // User message: no .ds-markdown wrapper in the current DOM.
          const clone = item.cloneNode(true) as HTMLElement
          for (const junk of clone.querySelectorAll('button, svg, [class*="copy"]')) {
            junk.remove()
          }
          const text = (clone.innerText ?? '').trim()
          if (text !== '') out.push({ role: 'user', parts: [{ kind: 'body', markdown: '', text }] })
        }
      }
      return out
    }, WEB_MESSAGE_ITEM_SELECTOR)
    return raw
  }

  /** Convert scraped DOM messages into transcript messages (markdown content). */
  private scrapedToMessages(scraped: ScrapedMessage[]): DSchatMessage[] {
    return scraped.map(message => {
      if (message.role === 'user') {
        const text = message.parts.map(part => part.text).join('\n\n').trim()
        return { id: randomUUID(), role: 'user', content: text === '' ? '（无内容）' : text, ts: Date.now() }
      }
      const think = message.parts.filter(part => part.kind === 'think').map(part => part.text).join('\n\n').trim()
      /*
       * Two sources land here: the DOM scraper puts the answer's HTML in
       * `markdown`, while the web's own history (api/cache) already carries
       * markdown in `text`. Prefer the HTML when present, otherwise take the
       * markdown as-is — running already-markdown text through the HTML parser
       * would escape it.
       */
      const body = message.parts
        .filter(part => part.kind === 'body')
        .map(part => (part.markdown === '' ? part.text : serializeToMarkdown(parseMarkup(part.markdown))))
        .join('\n\n')
        .trim()
      const thinkMd = think === '' ? '' : `<details><summary>思考过程</summary>\n\n${think}\n\n</details>`
      const content = [thinkMd, body].filter(Boolean).join('\n\n')
      return message.sources === undefined
        ? { id: randomUUID(), role: 'assistant', content, ts: Date.now() }
        : { id: randomUUID(), role: 'assistant', content, ts: Date.now(), sources: message.sources }
    })
  }

  /**
   * List the web sidebar's conversations with the session id each row links to.
   *
   * The id comes from the row's own `/a/chat/s/<id>` href — the routing
   * contract the site cannot rename without breaking its deep links — and is
   * the only reliable identity: titles repeat, get truncated at 80 chars, and
   * a `hasText` match against one is a substring match ("你好" also matches
   * "你好问候").
   */
  /**
   * The web sidebar, read on the serial queue.
   *
   * Reading it is a page operation that can also LAUNCH the browser (below), so
   * it must not overlap a send that is typing into the composer — see
   * `ensureBrowser`: a launch disposes the current context, which would take the
   * half-typed message with it. Queued here, unqueued in the private inner form
   * so `recoverWebConversation` can call it without deadlocking on a queue that
   * is not re-entrant.
   */
  async listWebConversations(): Promise<WebChatSummary[]> {
    return this.queue.run(() => this.listWebConversationsInner())
  }

  private async listWebConversationsInner(): Promise<WebChatSummary[]> {
    // Listing the web sidebar is a user-initiated read: start the browser when
    // it is cold. Returning [] here instead made "从网页恢复" show an empty
    // list until some other action happened to launch the engine.
    if (this.page === undefined) {
      try {
        await this.ensureBrowser()
      } catch {
        return []
      }
    }
    if (this.page === undefined) return []
    const rows = await this.page.evaluate((selector: string) => {
      const found: Array<{ title: string; sessionId?: string }> = []
      const seen = new Set<string>()
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
        // The row's action buttons are icon-only, so a non-empty anchor text is
        // the title; 80 chars is the sidebar's own truncation budget.
        if (text.length < 1 || text.length > 80) continue
        const href = el.getAttribute('href') ?? ''
        const id = href.split('/a/chat/s/')[1]?.split(/[/?#]/)[0]?.trim() ?? ''
        const key = id === '' ? `title:${text}` : `id:${id}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push(id === '' ? { title: text } : { title: text, sessionId: id })
      }
      // The sidebar is long; the old cap of 50 silently hid half of it.
      return found.slice(0, 200)
    }, WEB_CHAT_LINK_SELECTOR).catch(() => [] as Array<{ title: string; sessionId?: string }>)
    return rows
  }

  /**
   * Recover a web conversation into the local transcript store.
   *
   * Three sources, tried in order of fidelity and speed (the old
   * implementation had only the last one, which is why recovery was slow AND
   * short — the transcript is a virtualised list, so reading the DOM once
   * returns just the few rows around the viewport):
   *
   *   1. `history-api` — the page's own authenticated history endpoint. One
   *      request returns the whole conversation as fragments (markdown answer
   *      + reasoning + attachments), in ~100-300ms.
   *   2. `page-cache`   — the app's persisted IndexedDB cache, read after
   *      opening a conversation the app had not cached yet.
   *   3. `dom`          — open the conversation and harvest EVERY row of the
   *      virtual list by walking its scroller from top to bottom.
   *
   * The result is upserted into the store, so re-recovering a conversation
   * that was imported short (by an older version) repairs it in place instead
   * of being skipped as a duplicate.
   */
  async recoverWebConversation(query: string | { title?: string; sessionId?: string }): Promise<RecoverResult> {
    /*
     * On the serial queue, because recovering ends in `openWebConversation` —
     * a page navigation. Off the queue it could run while a send was still
     * typing into the composer (the release of the queue is not the end of the
     * turn), so the page could be navigated out from under the message being
     * composed. The public entry point queues; the body below is the unqueued
     * form, which also calls the unqueued sidebar read.
     */
    return this.queue.run(() => this.recoverWebConversationInner(query))
  }

  private async recoverWebConversationInner(query: string | { title?: string; sessionId?: string }): Promise<RecoverResult> {
    const asked = typeof query === 'string' ? { title: query } : query
    const askedTitle = asked.title?.trim() ?? ''
    const askedId = asked.sessionId?.trim() ?? ''
    if (askedTitle === '' && askedId === '') return { ok: false, error: '缺少 title 或 sessionId' }
    if (this.page === undefined) {
      try {
        await this.ensureBrowser()
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    }
    if (await this.isLoggedIn() !== true) {
      return { ok: false, error: '尚未登录 DeepSeek 网页端' }
    }
    try {
      /* ------------------------------------------------ 1. identify it */
      let sessionId = askedId
      let title = askedTitle
      if (sessionId === '' || title === '') {
        const rows = await this.listWebConversationsInner()
        const match = sessionId !== ''
          ? rows.find(row => row.sessionId === sessionId)
          : (rows.find(row => row.title === title) ?? rows.find(row => row.title.includes(title)))
        if (match === undefined) return { ok: false, error: `未在网页端找到会话「${askedTitle === '' ? askedId : askedTitle}」` }
        sessionId = sessionId !== '' ? sessionId : (match.sessionId ?? '')
        title = title !== '' ? title : match.title
      }

      /* ------------------------------------- 2. history endpoint (fast path) */
      let scraped: ScrapedMessage[] = []
      let source: RecoverSource = 'history-api'
      /** Messages the endpoint reported; -1 = it did not answer. */
      let apiMessages = -1
      if (sessionId !== '') {
        const history = await this.fetchWebHistory(sessionId)
        if (history !== undefined) {
          apiMessages = history.messages.length
          scraped = webMessagesToScraped(history.messages)
          if (title === '') title = history.title ?? ''
        }
      }

      /*
       * An authoritative empty answer is a fact, not a failure to read: the
       * conversation really has no history yet. Say so instead of opening the
       * page and scraping nothing (a navigation plus a cache poll for a
       * guaranteed empty result).
       */
      if (apiMessages === 0) {
        return {
          ok: false,
          sessionId: sessionId === '' ? undefined : sessionId,
          error: `「${title}」在网页端还没有任何消息（空会话），没有可恢复的内容。`,
        }
      }

      /* ------------------------------------------- 3. the app's own page cache */
      if (scraped.length === 0 && sessionId !== '') {
        source = 'page-cache'
        const cached = await this.readCachedWebHistory(sessionId)
        if (cached !== undefined) {
          scraped = webMessagesToScraped(cached.messages)
          if (title === '') title = cached.title ?? ''
        }
      }

      /*
       * Opening the conversation is the only step that touches the page, so it
       * is deferred until the two read-only sources came back empty — and it
       * is refused while a reply is streaming, because navigating away would
       * kill that stream.
       */
      if (scraped.length === 0) {
        if (this.busy) return { ok: false, error: '正在等待网页端回复，暂时不能打开会话；请稍后重试或先停止生成。' }
        const opened = await this.openWebConversation(sessionId, title)
        if (!opened.ok) return { ok: false, error: opened.error }
        sessionId = sessionId !== '' ? sessionId : opened.sessionId ?? ''
        // The SPA loads a conversation into its cache alongside the first
        // paint, so this usually resolves on the first or second poll.
        if (sessionId !== '') {
          const cached = await this.waitForCachedWebHistory(sessionId)
          if (cached !== undefined) {
            source = 'page-cache'
            scraped = webMessagesToScraped(cached.messages)
            if (title === '') title = cached.title ?? ''
          }
        }
      }

      /* ---------------------------------------------- 4. DOM scroll-harvest */
      if (scraped.length === 0) {
        source = 'dom'
        scraped = await this.harvestConversation()
      }

      if (scraped.length === 0) {
        // Say what is actually true instead of blaming a redesign: the probe
        // reports where the page is and what it does contain.
        const probe = await this.probePage()
        return {
          ok: false,
          sessionId: sessionId === '' ? undefined : sessionId,
          error:
            `未能读到「${title}」的消息内容：接口、页面缓存与页面抓取三种来源都是空的。` +
            `页面停在 ${String(probe.url ?? '未知地址')}，消息节点 ${String(probe.messageItemCount ?? '?')} 个、markdown ${String(probe.markdownCount ?? '?')} 个。` +
            (probe.messageItemCount === 0
              ? '该会话在网页端可能确实是空的（没有历史消息）。'
              : '会话已打开但没有可读内容。'),
        }
      }

      const messages = this.scrapedToMessages(scraped)
      const model = this.deepThink ? 'deepseek-reasoner' : 'deepseek-chat'
      const result = this.store.importTranscript({
        title: title === '' ? '未命名网页会话' : title,
        model,
        messages,
        ...(sessionId === '' ? {} : { webSessionId: sessionId }),
        /*
         * The one caller allowed to match by title: this IS a re-sync of a
         * conversation the web sidebar named, and the DOM-scraped layer has no
         * session id to match on. Everywhere else a title is not an identity —
         * see TranscriptStore.importTranscript.
         */
        matchByTitle: true,
      })
      return {
        ok: true,
        chatId: result.chat.id,
        title: result.chat.title,
        ...(sessionId === '' ? {} : { sessionId }),
        created: result.created,
        updated: result.updated,
        messageCount: messages.length,
        source,
      }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  /** `https://chat.deepseek.com` — the origin every page read must run on. */
  private origin(): string {
    return (this.config.baseUrl ?? 'https://chat.deepseek.com').replace(/\/+$/, '')
  }

  /**
   * Read the whole conversation through the page's OWN history endpoint.
   *
   * This is not an out-of-band API client: it is the same GET the app itself
   * issues on open, made from the app's own page, authorised with the app's
   * own token from `localStorage.userToken`. Omitting the cache parameters
   * makes the server answer with the full message list (`cache_control:
   * REPLACE`) instead of the delta it sends a warm client. Failure is
   * deliberately silent — every caller falls through to the cache, then to the
   * DOM.
   */
  private async fetchWebHistory(sessionId: string): Promise<WebHistory | undefined> {
    if (!this.isPageAlive()) return undefined
    try {
      // A same-origin fetch needs the page to be on the chat origin.
      if (!this.page!.url().startsWith(this.origin())) {
        await this.openDeepSeekPage()
      }
      const result = await this.page!.evaluate(async (sid: string) => {
        try {
          const raw = localStorage.getItem('userToken')
          const token = raw === null ? '' : (JSON.parse(raw)?.value ?? '')
          const response = await fetch(`/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(sid)}`, {
            credentials: 'include',
            headers: token === '' ? {} : { authorization: `Bearer ${token}` },
          })
          if (!response.ok) return { ok: false as const, error: `HTTP ${response.status}` }
          const payload = await response.json()
          const biz = payload?.data?.biz_data
          if (payload?.code !== 0 || biz === undefined || biz === null) {
            return { ok: false as const, error: `code ${String(payload?.code)} ${String(payload?.msg ?? '')}`.trim() }
          }
          return { ok: true as const, title: String(biz?.chat_session?.title ?? ''), messages: biz?.chat_messages ?? [] }
        } catch (error) {
          return { ok: false as const, error: String(error) }
        }
      }, sessionId)
      if (!result.ok) return undefined
      return { title: result.title, messages: result.messages as WebMessage[] }
    } catch {
      return undefined
    }
  }

  /**
   * Read one conversation from the app's own IndexedDB cache (`deepseek-chat`
   * → `history-message`). The app writes the full message list there as it
   * loads a conversation, so this is a complete source without any navigation
   * — and the fallback when the history endpoint is unavailable.
   *
   * The database is opened WITHOUT a version on purpose: `indexedDB.open` on a
   * name that does not exist yet would CREATE an empty database, and the app
   * opening that same version later would find no object store. The existence
   * check first keeps this strictly read-only.
   */
  private async readCachedWebHistory(sessionId: string): Promise<WebHistory | undefined> {
    if (!this.isPageAlive()) return undefined
    try {
      if (!this.page!.url().startsWith(this.origin())) return undefined
      const result = await this.page!.evaluate(async (sid: string) => {
        try {
          const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
          if (!databases.some(database => database.name === 'deepseek-chat')) return undefined
          const handle = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('deepseek-chat')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          try {
            if (!handle.objectStoreNames.contains('history-message')) return undefined
            const record = await new Promise<{ data?: { chat_session?: { title?: string }; chat_messages?: WebMessage[] } } | undefined>((resolve, reject) => {
              const tx = handle.transaction('history-message', 'readonly')
              const request = tx.objectStore('history-message').get(sid)
              request.onsuccess = () => resolve(request.result ?? undefined)
              request.onerror = () => reject(request.error)
            })
            const messages = record?.data?.chat_messages
            if (!Array.isArray(messages)) return undefined
            return { title: String(record?.data?.chat_session?.title ?? ''), messages }
          } finally {
            handle.close()
          }
        } catch {
          return undefined
        }
      }, sessionId)
      if (result === undefined) return undefined
      return { title: result.title, messages: result.messages as WebMessage[] }
    } catch {
      return undefined
    }
  }

  /**
   * Poll the app's cache until the conversation lands in it (or time out).
   *
   * Short on purpose: the app writes the record as it paints the transcript
   * (measured ~1.2s for a conversation it had never seen), and the DOM harvest
   * is waiting behind this as the next tier — a long poll here would only make
   * the fallback slower.
   */
  private async waitForCachedWebHistory(sessionId: string, timeoutMs = 3_000): Promise<WebHistory | undefined> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const cached = await this.readCachedWebHistory(sessionId)
      if (cached !== undefined && cached.messages.length > 0) return cached
      if (Date.now() >= deadline) return undefined
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  /**
   * Harvest EVERY message the page can render, not just the mounted ones.
   *
   * `[data-virtual-list-item-key]` is a virtualiser: only the rows near the
   * viewport exist in the DOM, so one `querySelectorAll` returns a handful of
   * messages no matter how long the conversation is. (Measured: a 16-message
   * conversation had exactly 2 rows mounted.) Recovering from the DOM without
   * this walk is why an import came back as "the last two messages" — the
   * reported "恢复的内容很短".
   *
   * The walk goes TOP-DOWN, not bottom-up, and that ordering is the whole
   * trick:
   *   - anchoring at the top is what makes the app page in the OLDEST messages,
   *     so the list's total height is final before the walk begins;
   *   - walking downward then never re-anchors the virtualiser (walking upward
   *     does, and lost up to half the rows in testing: 28/32, once 2/32).
   * A gap repair pass then revisits whatever the coarse steps skipped, using
   * the scroll offset each neighbouring key was seen at.
   *
   * Slower than the history endpoint by an order of magnitude — which is
   * exactly why it is the last resort — but it is complete, and it needs
   * nothing but the DOM.
   */
  private async harvestConversation(): Promise<ScrapedMessage[]> {
    if (!this.isPageAlive()) return []
    try {
      return await this.page!.evaluate(async (itemSelector: string): Promise<ScrapedMessage[]> => {
        interface RawMessage {
          role: 'user' | 'assistant'
          parts: Array<{ kind: 'think' | 'body'; markdown: string; text: string }>
        }
        const sleep = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms))
        /*
         * Wait for the app to paint the rows a scroll just brought in. React
         * commits on its own scheduler, so two animation frames are the honest
         * signal; the timeout is a race, not the mechanism — a backgrounded
         * page can have rAF throttled, and stalling here would be worse than
         * one extra frame of latency.
         */
        const settle = async (): Promise<void> => {
          await Promise.race([
            new Promise<void>(resolve => {
              let frames = 0
              const tick = (): void => {
                frames += 1
                if (frames >= 2) resolve()
                else window.requestAnimationFrame(tick)
              }
              window.requestAnimationFrame(tick)
            }),
            sleep(60),
          ])
          await sleep(8)
        }
        const extract = (element: Element): { markdown: string; text: string } => {
          const clone = element.cloneNode(true) as HTMLElement
          for (const junk of clone.querySelectorAll('.ds-markdown-code-copy-button, button, svg, [class*="copy"]')) {
            junk.remove()
          }
          return { markdown: clone.innerHTML, text: clone.innerText }
        }
        const readRow = (item: Element): RawMessage | null => {
          const assistant = item.querySelector('.ds-assistant-message-main-content')
          const think = item.querySelector('.ds-think-content')
          /*
           * Same role test as the single-shot scraper: a stopped reply has no
           * `.ds-assistant-message-main-content` wrapper, so the reasoning
           * block or the markdown body has to count as the assistant marker
           * too — otherwise the row is stored as a user bubble.
           */
          const body = assistant === null
            ? item.querySelector('.ds-markdown')
            : (assistant.classList.contains('ds-markdown') ? assistant : assistant.querySelector('.ds-markdown'))
          if (assistant !== null || think !== null || body !== null) {
            const parts: RawMessage['parts'] = []
            if (think !== null) parts.push({ kind: 'think', ...extract(think) })
            if (body !== null) parts.push({ kind: 'body', ...extract(body) })
            return parts.length === 0 ? null : { role: 'assistant', parts }
          }
          const clone = item.cloneNode(true) as HTMLElement
          for (const junk of clone.querySelectorAll('button, svg, [class*="copy"]')) junk.remove()
          const text = (clone.innerText ?? '').trim()
          return text === '' ? null : { role: 'user', parts: [{ kind: 'body', markdown: '', text }] }
        }

        /*
         * Find the list's scroll container.
         *
         * Walking up from the FIRST row is not enough: a row can contain its
         * own scrollable box (a code block, a collapsed reasoning area), and
         * latching onto that made the walk scroll the code block instead of the
         * conversation — a 30-message conversation then harvested 5 rows and
         * reported success. Starting from the rows' nearest COMMON ancestor
         * skips every per-row box by construction.
         */
        const mounted = Array.from(document.querySelectorAll(itemSelector))
        let scroller: HTMLElement | null = null
        if (mounted.length > 0) {
          let common: Element | null = mounted[0]!
          for (const row of mounted.slice(1)) {
            while (common !== null && !common.contains(row)) common = common.parentElement
          }
          let element: Element | null = common
          while (element !== null && element !== document.body) {
            const style = getComputedStyle(element)
            if (/(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 4) {
              scroller = element as HTMLElement
              break
            }
            element = element.parentElement
          }
        }
        const harvest = new Map<string, RawMessage>()
        /** Scroll offset each key was first seen at (drives the gap repair). */
        const seenAt = new Map<string, number>()
        /** Total text of a raw message — the tie-break when re-reading a row. */
        const sizeOf = (message: RawMessage): number =>
          message.parts.reduce((total, part) => total + part.text.length + part.markdown.length, 0)
        /** True when `candidate` is a more complete read of the same row. */
        const better = (candidate: RawMessage, previous: RawMessage): boolean => {
          if (candidate.role !== previous.role) return candidate.role === 'assistant'
          return sizeOf(candidate) > sizeOf(previous)
        }
        /*
         * Rows are re-read on every sweep, not just once.
         *
         * A scroll makes the virtualiser create the row element and fill it in
         * a later commit, so a row caught in that window has no assistant body
         * yet and would be recorded as a plain user bubble — the wrong role AND
         * the wrong text. Keeping the richest observation of each key lets a
         * later sweep correct it.
         */
        const sweep = (): void => {
          const top = scroller === null ? 0 : scroller.scrollTop
          for (const item of Array.from(document.querySelectorAll(itemSelector))) {
            const key = item.getAttribute('data-virtual-list-item-key')
            if (key === null) continue
            const message = readRow(item)
            if (message === null) continue
            const previous = harvest.get(key)
            if (previous === undefined || better(message, previous)) {
              harvest.set(key, message)
              if (!seenAt.has(key)) seenAt.set(key, top)
            }
          }
        }
        sweep()
        if (scroller === null) return Array.from(harvest.values())

        const initialScrollTop = scroller.scrollTop
        const started = performance.now()
        const viewport = Math.max(120, scroller.clientHeight)
        const budgetMs = 25_000
        const scrollTo = async (top: number): Promise<void> => {
          const max = Math.max(0, scroller!.scrollHeight - scroller!.clientHeight)
          scroller!.scrollTop = Math.max(0, Math.min(top, max))
          await settle()
          sweep()
        }

        // 1. Anchor at the top and let the app page in the oldest messages.
        await scrollTo(0)
        for (let round = 0; round < 3; round++) {
          const before = harvest.size
          await scrollTo(0)
          if (harvest.size === before) break
        }

        // 2. Walk down in coarse steps (2 viewports: measured 32/32 on a
        //    32-message conversation, no repair needed).
        const step = viewport * 2
        let steps = 0
        for (let top = 0; top <= scroller.scrollHeight + step && steps < 400; top += step) {
          if (performance.now() - started > budgetMs) break
          steps += 1
          await scrollTo(top)
        }
        await scrollTo(scroller.scrollHeight)

        // 3. Repair: any id missing between the first and last key we saw gets
        //    its own finely-stepped pass over the band its neighbours occupy.
        const keyNumbers = Array.from(harvest.keys()).map(Number).filter(value => Number.isFinite(value)).sort((a, b) => a - b)
        if (keyNumbers.length > 1) {
          const missing: number[] = []
          for (let id = keyNumbers[0]!; id <= keyNumbers[keyNumbers.length - 1]!; id++) {
            if (!harvest.has(String(id))) missing.push(id)
          }
          const fine = Math.max(60, viewport * 0.35)
          for (const id of missing) {
            if (performance.now() - started > budgetMs) break
            const below = keyNumbers.filter(value => value < id).pop()
            const above = keyNumbers.find(value => value > id)
            const from = below === undefined ? 0 : (seenAt.get(String(below)) ?? 0)
            const to = above === undefined ? scroller.scrollHeight : (seenAt.get(String(above)) ?? scroller.scrollHeight)
            for (let top = from; top <= to + fine; top += fine) {
              if (performance.now() - started > budgetMs) break
              await scrollTo(top)
            }
          }
        }
        scroller.scrollTop = initialScrollTop

        const entries = Array.from(harvest.entries())
        const numeric = entries.every(([key]) => Number.isFinite(Number(key)))
        if (numeric) entries.sort((a, b) => Number(a[0]) - Number(b[0]))
        return entries.map(([, message]) => message)
      }, WEB_MESSAGE_ITEM_SELECTOR)
    } catch {
      return []
    }
  }

  /**
   * Open a web conversation so the page loads (and caches) it.
   *
   * With a session id this is a plain `goto` of the conversation's own deep
   * link — deterministic, and the same page the SPA would have rendered. The
   * click-first dance is kept only for the id-less fallback (markup changed),
   * where a swallowed click used to leave the page on the chat root and the
   * scrape returning zero messages.
   */
  private async openWebConversation(sessionId: string, title: string): Promise<{ ok: boolean; error?: string; sessionId?: string }> {
    if (this.page === undefined) return { ok: false, error: '浏览器未启动' }
    const conversationIn = (): string | undefined => {
      const match = /\/a\/chat\/s\/([^/?#]+)/.exec(this.page!.url())
      return match?.[1]
    }

    if (sessionId !== '') {
      const target = `${this.origin()}/a/chat/s/${sessionId}`
      if (!this.page.url().startsWith(target)) {
        await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined)
      }
      await this.waitForTranscriptPaint()
      const landed = conversationIn()
      if (landed === undefined) {
        return { ok: false, error: `打开会话「${title}」后页面没有跳转（当前 ${this.page.url()}）` }
      }
      return { ok: true, sessionId: landed }
    }

    const locator = this.page.locator(WEB_CHAT_LINK_SELECTOR).filter({ hasText: title }).first()
    const matches = await locator.count().catch(() => 0)
    if (matches === 0) return { ok: false, error: `未在网页端找到会话「${title}」` }

    // The href is the authority on which conversation this row means; clicking
    // can be swallowed, but a URL cannot be.
    const href = await locator.getAttribute('href').catch(() => null)
    const target = href === null ? undefined : new URL(href, this.page.url()).toString()
    if (target === undefined) return { ok: false, error: `会话「${title}」的链接不可读` }

    if (!this.page.url().startsWith(target)) {
      // 1. Real click — preserves the app's own SPA behaviour.
      await locator.click({ timeout: 5_000 }).catch(() => undefined)
      await this.page
        .waitForFunction((url: string) => location.href.startsWith(url), target, { timeout: 5_000 })
        .catch(() => undefined)
    }
    // 2. Scroll into view and click again (virtualised / off-screen rows).
    if (!this.page.url().startsWith(target)) {
      await locator.scrollIntoViewIfNeeded().catch(() => undefined)
      await locator.click({ timeout: 5_000, force: true }).catch(() => undefined)
      await this.page
        .waitForFunction((url: string) => location.href.startsWith(url), target, { timeout: 5_000 })
        .catch(() => undefined)
    }
    // 3. Navigate outright (the href is a plain link to the same page).
    if (!this.page.url().startsWith(target)) {
      await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined)
    }
    await this.waitForTranscriptPaint()
    if (!this.page.url().startsWith(target)) {
      return { ok: false, error: `点击会话「${title}」后页面没有跳转（当前 ${this.page.url()}）` }
    }
    return { ok: true, ...(conversationIn() === undefined ? {} : { sessionId: conversationIn()! }) }
  }

  /**
   * Wait for the transcript to actually be painted. The URL alone is not
   * proof: the SPA swaps the route first and the transcript after, and in that
   * window the DOM still holds the previous conversation. Empty is only a
   * legitimate answer after the wait.
   */
  private async waitForTranscriptPaint(timeoutMs = 8_000): Promise<void> {
    if (!this.isPageAlive()) return
    await this.page!
      .waitForFunction(
        (selector: string) => document.querySelectorAll(selector).length > 0,
        WEB_MESSAGE_ITEM_SELECTOR,
        { timeout: timeoutMs },
      )
      .catch(() => undefined)
  }

  /**
   * Arm the stream capture for a new turn: the next `/chat/completion` request
   * becomes the only one this turn can read.
   *
   * Why a generation rather than just clearing the buffer (which is what this
   * used to do): clearing is a WRITE aimed at the old owner, and an abandoned
   * turn's request is still in flight. It keeps appending into whatever object
   * sits at `window.__wcStream` — so the fresh buffer filled up with the
   * PREVIOUS turn's bytes — and, worse, its `loadend` set `done`, which ended
   * the new turn's reply loop on the first tick and committed whatever fragment
   * happened to be in the buffer as the complete answer. Bumping the generation
   * revokes the old request's right to write at all.
   *
   * The cursor is rewound with the buffer, or the first read of the new turn
   * would come back empty.
   *
   * A page still running an older engine bundle reports no
   * `__wcGenSupported`; there the buffer is only cleared, which is the old
   * best-effort behaviour (and unavoidable until the app restarts onto this
   * build). The clear happens either way so that "the buffer is empty at
   * submit" never depends on which script the page is running.
   */
  private async resetCapture(): Promise<void> {
    if (this.page === undefined) return
    await this.page.evaluate((generation: number) => {
      const w = window as unknown as CaptureWindow & { __wcCursor?: number }
      if (w.__wcGenSupported === generation) w.__wcGen = (w.__wcGen ?? 0) + 1
      w.__wcStream = { text: '', done: false, started: false, status: 0, error: '' }
      w.__wcActiveReq = undefined
      w.__wcReqLen = 0
      w.__wcCursor = 0
    }, CAPTURE_GENERATION).catch(() => undefined)
  }

  /**
   * Wait for evidence that a turn has actually begun, up to `timeoutMs`.
   *
   * Three independent signals, any one sufficient:
   *
   *   - the teed stream capture has started (or already produced bytes), which
   *     is the page's own request going out — the strongest possible evidence,
   *     and after {@link resetCapture} it can only be THIS turn's request;
   *   - the stop affordance is on screen, which is what the page shows while
   *     generating;
   *   - the message list grew a row that was not there before Enter — the
   *     page's own copy of the user message, which is slower to appear than
   *     either of the above but survives a page whose streaming UI has not
   *     caught up yet.
   *
   * @param timeoutMs - wall-clock budget for the wait.
   * @param baselineKeys - message-list keys captured before Enter; an empty
   *   baseline (the selector matched nothing) skips the third check, because
   *   "we cannot tell" must not be read as "nothing was submitted".
   * @returns true when a turn is under way, false when the budget ran out.
   */
  private async waitForTurnStart(timeoutMs: number, baselineKeys: readonly string[] = []): Promise<boolean> {
    if (this.page === undefined) return false
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const captureStarted = await this.page.evaluate(() => {
        const w = window as unknown as { __wcStream?: { started?: boolean; text?: string; done?: boolean } }
        const stream = w.__wcStream
        if (stream === undefined) return false
        return stream.started === true || stream.done === true || (stream.text ?? '') !== ''
      }).catch(() => false)
      if (captureStarted) return true
      if (await this.isGenerating()) return true
      if (baselineKeys.length > 0) {
        const keys = await this.messageKeys()
        if (keys.some(key => !baselineKeys.includes(key))) return true
      }
      if (Date.now() >= deadline) return false
      await this.page.waitForTimeout(SUBMIT_VERIFY_POLL_MS)
    }
  }

  /** Detect whether the page is currently generating (stop affordance visible). */
  private async isGenerating(): Promise<boolean> {    if (this.page === undefined) return false
    try {
      for (const selector of WEB_STOP_SELECTORS) {
        if (await this.page.locator(selector).count().catch(() => 0) > 0) return true
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * Click the stop-generation affordance, best effort.
   *
   * Queued, so a click from the panel waits behind whatever the engine is doing
   * to the page.
   */
  async stop(): Promise<void> {
    await this.queue.run(() => this.stopInner())
  }

  /**
   * The unqueued body of {@link stop}.
   *
   * Callers that are ALREADY inside the serial queue must use this one:
   * `SerialQueue.run` appends to a promise chain, so awaiting the queued `stop`
   * from inside a queued task would wait for that task to finish — a deadlock
   * with no error and no timeout. `sendImpl` (failed submit) is such a caller.
   */
  private async stopInner(): Promise<void> {
    if (this.page === undefined) return
    for (const selector of WEB_STOP_SELECTORS) {
      const locator = this.page.locator(selector).first()
      if (await locator.count().catch(() => 0) > 0) {
        await locator.click({ timeout: 5_000 }).catch(() => undefined)
        return
      }
    }
  }

  /** Find the composer textarea (defensive selector list). */
  private async composerLocator(): Promise<ReturnType<Page['locator']>> {
    const selectors = [
      '#chat-input',
      'textarea[placeholder*="给 DeepSeek"]',
      'textarea[placeholder*="发送消息"]',
      'textarea[placeholder*="Send a message"]',
      'textarea',
    ]
    for (const selector of selectors) {
      const locator = this.page!.locator(selector).first()
      if (await locator.count().catch(() => 0) > 0) return locator
    }
    return this.page!.locator('textarea').first()
  }

  /**
   * Upload local files into the composer through the page's (usually hidden)
   * file input. `setInputFiles` fires the input's change event, which is how
   * DeepSeek picks up attachments without clicking its native dialog.
   *
   * Images only used to be attachable because the FIRST selector here tested
   * `accept*="image"` and the caller filtered the drop to image types. The page
   * takes documents too (its own picker allows a wide set), so the selector now
   * prefers an input that accepts more than images and falls back to any file
   * input at all — the page is the authority, and it answers with a visible
   * rejection if it will not take a given type.
   */
  private async attachFiles(paths: string[]): Promise<{ ok: boolean; error?: string }> {
    if (this.page === undefined) return { ok: false, error: '浏览器未启动' }
    if (paths.length === 0) return { ok: true }
    const selectors = [
      'input[type="file"][accept*="."]',
      'input[type="file"][accept*="pdf" i]',
      'input[type="file"][accept*="image" i]',
      'input[type="file"]',
    ]
    /*
     * `.first()` on a selector that matches nothing throws; `.last()` over an
     * empty list is a no-op, so take the LAST input the page exposes — that is
     * the composer's own picker on every revision of the page seen so far, and
     * it stays correct if a second (e.g. image-search) input appears above it.
     */
    for (const selector of selectors) {
      const input = this.page.locator(selector).last()
      if (await input.count().catch(() => 0) === 0) continue
      try {
        await input.setInputFiles(paths)
        // Let the upload + preview render settle before submitting. Longer than
        // the old image-only wait: a document upload is a real round trip.
        await this.page.waitForTimeout(1_500)
        return { ok: true }
      } catch (error) {
        const detail = String(error)
        return {
          ok: false,
          error: /accept|not.*support|file type|unsupported/i.test(detail)
            ? `网页端不接受这个文件类型：${detail}`
            : `文件上传失败：${detail}`,
        }
      }
    }
    return { ok: false, error: '未找到文件上传入口（页面可能已改版或当前会话不支持附件）' }
  }

  /**
   * Send a message through the real web page.
   * @param text - message text.
   * @param wait - when true (agent tools), resolve with the final reply after
   *   streaming completes; when false (GUI), resolve right after the message
   *   is submitted — the reply streams in the background into the transcript
   *   and the panel polls it live.
   */
  send(text: string, wait = false, images?: string[]): Promise<SendResult> {
    return this.queue.run(() => this.sendImpl(text, wait, images))
  }

  private async sendImpl(text: string, wait: boolean, images?: string[]): Promise<SendResult> {
    this.setLastError(undefined)
    /**
     * Whether the user message reached the transcript. Set once it is appended;
     * every failure return carries it so the panel knows whether the draft is
     * still the user's to resend (see SendResult.stored).
     */
    let stored = false
    /*
     * One turn at a time.
     *
     * The serial queue does NOT provide this: `streamReply` is deliberately
     * fire-and-forget for the GUI (below), so the queue is released the moment
     * the message is submitted while the reply is still streaming. `busy` is
     * cleared in streamReply's `finally`, so it is exactly "a turn is running".
     *
     * The capture generation is what makes a second send SAFE (the old buffer
     * could no longer be re-armed out from under the first reply loop, see
     * resetCapture); refusing here is what keeps a second send from being
     * CONFUSING — the page would be generating two replies at once, and the
     * panel would show one transcript.
     */
    if (this.busy) {
      const message = '上一条回复还在生成中，请等它结束或点「停止」后再发送。'
      this.setLastError(message, 'BUSY')
      return { ok: false, error: message, code: 'BUSY' }
    }
    // Running inside the queue, this is observed AFTER any pending new-chat task
    // has settled. Refusing here is the backstop for that task having failed:
    // without it the message would be typed into the conversation we just left.
    if (this.newChatError !== undefined) {
      const detail = this.newChatError
      this.newChatError = undefined
      const message = `新建对话没有完成（${detail}），为避免把消息发进上一个会话，本次发送已取消。请重新点击「新对话」后再试。`
      this.setLastError(message, 'PAGE_CHANGED')
      return { ok: false, error: message, code: 'PAGE_CHANGED' }
    }
    if (!this.isPageAlive()) {
      try {
        await this.ensureBrowser()
      } catch (error) {
        const message = String(error)
        this.setLastError(message, 'NETWORK')
        return { ok: false, error: message, code: 'NETWORK' }
      }
    }
    const loggedIn = await this.isLoggedIn()
    if (loggedIn !== true) {
      const message = '尚未登录 DeepSeek 网页端。请在插件面板点击「打开登录窗口」，在弹出的浏览器中完成登录后重试。'
      this.setLastError(message, 'NEED_LOGIN')
      return { ok: false, error: message, code: 'NEED_LOGIN' }
    }
    try {
      const chat = this.store.ensureActiveChat(this.deepThink ? 'deepseek-reasoner' : 'deepseek-chat')
      const userMessage: DSchatMessage = {
        id: randomUUID(), role: 'user', content: text, ts: Date.now(),
        ...(images !== undefined && images.length > 0 ? { attachments: images } : {}),
      }
      this.store.appendMessage(chat.id, userMessage)
      stored = true
      if (chat.title === '新的对话') {
        this.store.renameChat(chat.id, text.replace(/\s+/g, ' ').slice(0, 40))
      }

      // Type into the real composer and submit with Enter.
      const page = this.page
      if (page === undefined) return { ok: false, error: '浏览器未启动', ...(stored ? { stored: true } : {}) }
      // Arm the capture for THIS turn and drop anything a previous one left in
      // it (see resetCapture), then type.
      await this.resetCapture()
      const composer = await this.composerLocator()
      await composer.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
      await composer.click({ timeout: 5_000 }).catch(() => undefined)
      await composer.fill(text, { timeout: 10_000 }).catch(async () => {
        await composer.type(text, { delay: 5 })
      })
      // Attach any files before submitting (setInputFiles on the page's file input).
      if (images !== undefined && images.length > 0) {
        const attach = await this.attachFiles(images)
        if (!attach.ok) {
          const message = attach.error ?? '文件上传失败'
          this.setLastError(message, 'NETWORK')
          return { ok: false, error: message, code: 'NETWORK', stored: true }
        }
      }
      /*
       * What the message list holds BEFORE this turn: the DOM fallback needs it
       * to tell this turn's reply from the previous one. Taken here, right
       * before Enter, because it is the last moment the page is guaranteed to
       * show only the old turns — and the submit check reads it too, to see
       * whether this turn's own row appeared.
       */
      const baselineKeys = await this.messageKeys()
      /*
       * The previous answer's BODY, snapshotted where it is still the page's
       * answer and nothing else.
       *
       * The key set above says whether the list grew a row, which is not the
       * same as "the page moved on": a virtualizer remounts and recycles rows,
       * so a key can be new while the row under it is an old message, and the
       * submit check accepts that as "this turn started". The DOM fallback then
       * scraped the previous reply and committed it — with no error — as the
       * answer to a question it does not answer. Seen live: 「开封有什么适合
       * 自驾游的景点？」 stored as a 453-character whitespace-collapsed replica
       * of 3-hour-old 「这个文件的题目是什么？」, 1.8 s after the question, with
       * the page still showing that question in its composer.
       *
       * Content is that guard's only dependable identity (see
       * `repeatsPreviousReply`): row keys, timestamps and the page's own
       * affordances have all been observed to lie here, the text has not.
       */
      const previousReply = previousReplyMessage(this.store.getChat(chat.id)?.messages ?? [])
      await page.keyboard.press('Enter')

      /*
       * Verify the submit actually took.
       *
       * Enter is fire-and-forget and every step before it swallows its own
       * failure, so a disabled composer, a send button the page has not wired up
       * yet or a dropped keypress all looked exactly like success: the message
       * was in the transcript, the panel showed it, and then NOTHING happened
       * for the full 180 s reply timeout before an apology about the page
       * structure. One cheap poll of the page's own stop affordance turns that
       * into a fast, accurate failure.
       *
       * The signals are checked in order of strength: the capture (this turn's
       * own request leaving the page), the stop affordance (the page generating),
       * and finally this turn's user row appearing in the list — the third one
       * exists because the first two can both be missed: a page that is still
       * waking up after hours of idling can accept the message and take longer
       * than a second and a half to show either. Missing it is not harmless —
       * the panel then tells the reader the message was not sent, they retry,
       * and the page ends up with the text twice (exactly the duplication seen
       * the morning after an overnight idle), so this decides on evidence rather
       * than on the clock alone.
       */
      const started = await this.waitForTurnStart(SUBMIT_VERIFY_MS, baselineKeys)
      if (!started) {
        /*
         * The page may still be generating — the whole point of the wider
         * budget and the third signal is that "no evidence yet" is not the same
         * as "nothing happened". If it is, stop it: an abandoned turn keeps
         * streaming into the conversation, and the reader's 重试 would then be
         * answered BEHIND it, leaving them with a half-finished reply and their
         * question asked twice (which is what the reported failure looked like
         * on the web side). `busy` is false here, so the only thing the stop
         * affordance can belong to is this submission.
         *
         * `stopInner`, not `stop`: this whole method is already running ON the
         * serial queue, and the queued form would wait for itself.
         */
        await this.stopInner()
        const message = '网页端没有开始生成回复：消息没有送出去（输入框可能未就绪或被禁用）。请重试，或在网页窗口里手动确认后再发送。'
        this.setLastError(message, 'PAGE_CHANGED')
        // The user message stays in the transcript (it is on screen and its
        // 重试 action re-sends it), hence `stored`.
        return { ok: false, error: message, code: 'PAGE_CHANGED', stored: true }
      }

      const assistantId = randomUUID()
      if (!wait) {
        // Fire-and-forget for the GUI: the background loop streams into the
        // transcript; the panel tails /tail and renders live.
        void this.streamReply(chat.id, assistantId, baselineKeys, previousReply)
        return { ok: true, chatId: chat.id, stored }
      }
      const result = await this.streamReply(chat.id, assistantId, baselineKeys, previousReply)
      return { ...result, stored }
    } catch (error) {
      const message = `发送失败：${String(error)}`
      this.setLastError(message)
      return { ok: false, error: message, ...(stored ? { stored: true } : {}) }
    }
  }

  /**
   * Background reply loop. Primary source is the teed SSE stream (raw model
   * markdown, no selectors); if the capture never installs, falls back to
   * scraping the rendered DOM. Writes the growing reply into the transcript
   * until the stream reports done/FINISHED or the timeout hits.
   *
   * @param baselineKeys - the message-list keys mounted BEFORE this turn was
   *   submitted (see `messageKeys`). The DOM fallback uses them to tell this
   *   turn's reply from the previous turn's, which is otherwise what a scrape
   *   taken too early returns.
   * @param previousReply - the previous answer's body as it stood before Enter
   *   (see {@link previousReplyMessage}). The DOM fallback refuses any snapshot
   *   that merely repeats it — the second, content-based half of the same
   *   "is this really a new reply?" question the keys answer structurally.
   */
  private async streamReply(
    chatId: string,
    assistantId: string,
    baselineKeys: readonly string[] = [],
    previousReply = '',
  ): Promise<SendResult> {
    if (this.page === undefined) return { ok: false, error: '浏览器未启动' }
    this.busy = true
    this.busySince = Date.now()
    const started = Date.now()
    const timeout = this.config.replyTimeoutMs ?? DEFAULT_TIMEOUT_MS
    let replyMarkdown = ''
    /**
     * The reply's search sources, kept beside the markdown for the whole turn.
     *
     * Every write of the assistant message carries BOTH: the body holds the
     * citation numbers, so a message stored without its table renders as bare
     * numbers forever (the table cannot be reconstructed from the text).
     */
    let replySources: DSchatSource[] | undefined
    let replyError: string | undefined
    let replyCode: DSchatErrorCode | undefined
    let domChangedAt = 0
    let lastDom = ''
    /**
     * Set when a scrape was thrown away for being the previous reply. The
     * error path turns it into a message the reader can act on instead of a
     * generic timeout (see the loop's exit).
     */
    let staleDomSeen = false

    /**
     * When the reasoning of THIS turn first produced text, 0 before that.
     *
     * The panel's 「已思考（用时 …）」 label needs a duration the web page does
     * not store, so it is measured here: from the first reasoning fragment to
     * the first answer fragment. A reply with no reasoning never sets it, and
     * the label then has no time to show — which is the honest answer.
     */
    let thinkingStartedAt = 0
    /** The measured duration, frozen the moment the answer starts. */
    let thinkingMs: number | undefined

    /**
     * Read the capture buffer, transferring only the bytes that appeared since
     * the previous read.
     *
     * The whole-buffer version shipped the entire accumulated SSE body over CDP
     * on every tick — ~742 KiB per read by the end of a 40k-character reply,
     * re-sent ~12×/s and re-parsed from scratch each time. The page-side cursor
     * (`window.__wcCursor`) makes each read cost its delta; the reply loop keeps
     * the parse state, so nothing is ever replayed.
     */
    const readCapture = async (): Promise<StreamCaptureDelta | null> => {
      if (this.page === undefined) return null
      return this.page.evaluate(() => {
        const w = window as unknown as { __wcStream?: StreamCapture; __wcCursor?: number }
        const stream = w.__wcStream
        if (stream === undefined) return null
        const cursor = w.__wcCursor ?? 0
        const delta = cursor < stream.text.length ? stream.text.slice(cursor) : ''
        w.__wcCursor = stream.text.length
        return { delta, done: stream.done, started: stream.started, status: stream.status, error: stream.error }
      }).catch(() => null)
    }

    const domSnapshot = async (): Promise<{ markdown: string }> => {
      const scraped = await this.scrapeConversation()
      const assistant = [...scraped].reverse().find(message => message.role === 'assistant')
      if (assistant === undefined) return { markdown: '' }
      const think = stripSearchTrace(assistant.parts.filter(part => part.kind === 'think').map(part => part.text).join('\n\n')).trim()
      /*
       * The body part carries its rendered HTML in `markdown` and its plain text
       * in `text`. Reading only the first one meant a reply with no rendered
       * markup — an answer taking shape as a bare text node, which is what a
       * live reply looks like before its first block element exists — came back
       * with an EMPTY body. The loop then settled on the reasoning alone:
       * `DOM_STABLE_MS` fired, the turn was committed as finished, and the
       * answer never appeared. Fall back to the text, exactly as the recovery
       * path (`scrapedToMessages`) already does.
       */
      const bodyPart = assistant.parts.find(part => part.kind === 'body')
      const bodyMarkdown = bodyPart === undefined
        ? ''
        : (bodyPart.markdown === '' ? bodyPart.text : serializeToMarkdown(parseMarkup(bodyPart.markdown)))
      const bodyMd = stripSearchTrace(bodyMarkdown)
      const thinkMd = think === '' ? '' : `<details><summary>思考过程</summary>\n\n${think}\n\n</details>`
      return { markdown: [thinkMd, bodyMd].filter(Boolean).join('\n\n') }
    }

    /**
     * Advance the reasoning clock from one snapshot of the reply so far.
     *
     * The interval being measured is 「reasoning text exists, the answer does
     * not, yet」 → 「the answer has started」, which is exactly how the web page
     * times its own 已思考 label. Two cases deliberately measure NOTHING:
     *
     *   - a reply with no reasoning at all (every plain chat reply);
     *   - a snapshot that carries reasoning AND answer together, i.e. the first
     *     sighting already had both (a scrape that returned the finished reply,
     *     a recovered transcript). The interval was never observed, and a
     *     「用时 1 秒」 invented there would be worse than no time at all.
     */
    const noteThinking = (markdown: string): void => {
      const hasAnswer = hasAnswerBody(markdown)
      if (thinkingStartedAt === 0) {
        if (!markdown.trimStart().startsWith('<details>') || hasAnswer) return
        thinkingStartedAt = Date.now()
        return
      }
      if (thinkingMs === undefined && hasAnswer) thinkingMs = Date.now() - thinkingStartedAt
    }

    try {
      await this.page.waitForTimeout(700)
      let captureSeen = false
      let captureCompleted = false
      // One parser for the whole turn: it owns the citation tables, the current
      // fragment type and the assembled body, so each tick applies its delta
      // instead of rescanning everything received so far.
      const parser = createStreamReplyParser()
      while (Date.now() - started < timeout) {
        const capture = await readCapture()
        if (capture !== null && capture.started) {
          captureSeen = true
          // Primary: feed the teed SSE stream's new bytes to the parser.
          if (capture.delta !== '') parser.push(capture.delta)
          // A stream that ended without a trailing newline still has its last
          // line applied — the whole-body form processed it too.
          if (capture.done) parser.finish()
          const parsed = parser.snapshot()
          if (parsed.markdown !== '') {
            noteThinking(parsed.markdown)
            replyMarkdown = parsed.markdown
            replySources = sourcesOf(parsed.sources)
            this.store.upsertMessage(chatId, {
              id: assistantId, role: 'assistant', content: replyMarkdown, ts: Date.now(),
              streaming: !(capture.done || parsed.finished),
              ...(thinkingMs === undefined ? {} : { thinkingMs }),
              // The citation table rides the message, not the panel: it is the
              // only copy of the URLs, and the answer's numbers are meaningless
              // without it (and unrecoverable after a reload).
              ...(replySources === undefined ? {} : { sources: replySources }),
            })
          }
          if (capture.done || parsed.finished) {
            captureCompleted = true
            break
          }
          if (capture.error !== '') {
            replyError = capture.error
            replyCode = 'NETWORK'
            break
          }
        } else {
          /*
           * Fallback: scrape the rendered DOM until the capture produces data.
           *
           * Only once the message list shows a row that was NOT there when this
           * turn was submitted. Without that check the very first scrape —
           * taken before the page has rendered anything for this turn — returned
           * the PREVIOUS reply, which was then streamed into this turn's
           * assistant message and committed, with no error, as the answer to a
           * question it does not answer.
           *
           * An empty baseline means the selector matched nothing when the turn
           * was submitted (an older page, a changed structure) and there is no
           * evidence to compare against: the old accept-anything behaviour is
           * kept there, because refusing would turn "we cannot tell" into "the
           * reply is lost".
           *
           * The keys alone were not enough — the reported case was a scrape
           * that passed this check and was still the previous answer (a
           * virtualizer hands out a fresh key when it re-renders an old row, so
           * "a key I have not seen" does not mean "a message I have not seen").
           * So the scrape is ALSO refused when it merely repeats `previousReply`
           * as it stood before Enter: a genuine new answer diverges from it
           * within a few characters, while a replica never does (see
           * `repeatsPreviousReply`). Refusing costs a few ticks of streaming
           * smoothness; accepting costs the reader an answer to someone else's
           * question, which is the bug being fixed.
           */
          const keys = await this.messageKeys()
          const fresh = baselineKeys.length === 0 || keys.some(key => !baselineKeys.includes(key))
          if (fresh) {
            const dom = await domSnapshot()
            const replica = dom.markdown !== '' && repeatsPreviousReply(dom.markdown, previousReply)
            if (replica) staleDomSeen = true
            if (dom.markdown !== '' && !replica) {
              noteThinking(dom.markdown)
              if (dom.markdown !== lastDom) {
                lastDom = dom.markdown
                domChangedAt = Date.now()
                replyMarkdown = dom.markdown
              }
              this.store.upsertMessage(chatId, {
                id: assistantId, role: 'assistant', content: replyMarkdown, ts: Date.now(), streaming: true,
                ...(thinkingMs === undefined ? {} : { thinkingMs }),
              })
            }
            if (replyMarkdown !== '' && Date.now() - domChangedAt >= DOM_STABLE_MS) break
          }
        }
        await this.page.waitForTimeout(STREAM_TICK_MS)
      }
      if (replyMarkdown === '' && replyCode === undefined) {
        if (captureSeen && captureCompleted) {
          replyError = '页面协议疑似改版：已捕获到回复流但无法解析出内容，请升级 dsh-dschat 插件'
          replyCode = 'PAGE_CHANGED'
        } else if (staleDomSeen) {
          /*
           * The page never produced anything but its own previous answer, so
           * this question was very likely never submitted: the send was typed
           * and lost (a composer that was not ready, a page that re-rendered
           * instead of sending). Saying so is the whole point — the alternative
           * is committing that old answer as this one's reply.
           */
          replyError = '网页端没有回复这次提问（页面上仍然是上一条回复）。请确认消息是否已送出，或重新发送。'
          replyCode = 'TIMEOUT'
        } else {
          replyError = '等待回复超时（未捕获到网页回复流；可能未登录或页面结构已变化）'
          replyCode = 'TIMEOUT'
        }
      } else if (replyCode === undefined && Date.now() - started >= timeout) {
        replyError = '生成超时，已返回部分内容'
        replyCode = 'TIMEOUT'
      }
      /*
       * An empty turn writes NO message row.
       *
       * A reply that never produced a byte has nothing to show, and the row it
       * used to leave behind was reported as a permanently blank assistant
       * bubble whose error text was the only thing in it. The reader already
       * gets the failure twice over — the panel's error line and this method's
       * return — so the transcript keeps only what was actually said.
       */
      if (replyMarkdown !== '') {
        this.store.upsertMessage(chatId, {
          id: assistantId, role: 'assistant', content: replyMarkdown, ts: Date.now(),
          streaming: false, error: replyError,
          ...(thinkingMs === undefined ? {} : { thinkingMs }),
          ...(replySources === undefined ? {} : { sources: replySources }),
        })
      }
      this.store.setStreaming(chatId, false)
      // The turn is over: land the coalesced writes now rather than leaving the
      // finished reply in a 1 s debounce window.
      this.store.flush()
      if (replyError !== undefined) this.setLastError(replyError, replyCode)
      return { ok: replyError === undefined, chatId, reply: replyMarkdown, error: replyError, code: replyCode }
    } catch (error) {
      const message = `生成过程中断：${String(error)}`
      this.setLastError(message)
      if (replyMarkdown !== '') {
        this.store.upsertMessage(chatId, {
          id: assistantId, role: 'assistant', content: replyMarkdown, ts: Date.now(),
          streaming: false, error: message,
          ...(thinkingMs === undefined ? {} : { thinkingMs }),
          ...(replySources === undefined ? {} : { sources: replySources }),
        })
      }
      this.store.setStreaming(chatId, false)
      this.store.flush()
      return { ok: false, chatId, reply: replyMarkdown, error: message }
    } finally {
      this.busy = false
      this.busySince = undefined
    }
  }

  /**
   * Start a new chat: a fresh local transcript, plus best-effort work on the web
   * page to leave the previous conversation.
   *
   * The local transcript is created and returned IMMEDIATELY, so the panel
   * switches to the empty conversation on click instead of after the browser
   * work. That is safe because `send` rides the same serial queue: a message
   * typed during the handover queues BEHIND this task, so it can never land in
   * the conversation the user just left.
   */
  async newChat(): Promise<{ ok: boolean; chatId?: string; error?: string }> {
    if (this.busy) return { ok: false, error: '正在生成回复，请先停止或等待完成' }
    const chat = this.store.createChat(this.deepThink ? 'deepseek-reasoner' : 'deepseek-chat')
    this.newChatPending = true
    this.newChatError = undefined
    void this.queue.run(async () => {
      try {
        await this.ensureBrowser()
        if (this.page !== undefined) {
          let clicked = false
          for (const selector of WEB_NEW_CHAT_SELECTORS) {
            const locator = this.page.locator(selector).first()
            if (await locator.count().catch(() => 0) > 0) {
              await locator.click({ timeout: 5_000 }).catch(() => undefined)
              clicked = true
              break
            }
          }
          if (!clicked) {
            await this.openDeepSeekPage()
          }
          await this.waitForEmptyConversation()
        }
      } catch (error) {
        /*
         * A teardown here (the app restarting, or the login window being closed
         * while this background task was in flight) says nothing about the
         * conversation state, so it must not arm the send backstop below —
         * otherwise the user's next message is refused for a reason that is
         * already gone. The handles are dropped and the next send relaunches.
         */
        if (isShutdownError(error)) {
          await this.disposeBrowser().catch(() => undefined)
          this.newChatError = undefined
        } else {
          // The page may still be showing the previous conversation. Record it
          // so the next send refuses rather than silently continuing that thread.
          this.newChatError = String(error)
        }
      } finally {
        this.newChatPending = false
      }
    })
    return { ok: true, chatId: chat.id }
  }

  /**
   * Wait until the page really shows an empty conversation.
   *
   * A fixed sleep was both slower than needed and unreliable: it could return
   * while the previous conversation was still painted, so the first message of a
   * "new" chat could be appended to the old one. The virtualizer's item key is
   * the structural signal that the transcript is empty.
   */
  private async waitForEmptyConversation(): Promise<void> {
    if (this.page === undefined) return
    await this.page
      .waitForFunction(
        (selector: string) => document.querySelectorAll(selector).length === 0,
        WEB_MESSAGE_ITEM_SELECTOR,
        { timeout: 8_000 },
      )
      .catch(() => undefined)
  }

  /**
   * Click a toggle on the page by label candidates (best effort — the DeepSeek
   * web UI has no stable contract, so a miss is not an error). The toggles are
   * `div.ds-toggle-button` elements (not `<button>`), so those selectors come
   * first; `<button>` variants remain as fallbacks for older page versions.
   * @returns true when a candidate was clicked.
   */
  private async clickToggle(labels: string[]): Promise<boolean> {
    if (!this.isPageAlive()) return false
    const selectors: string[] = []
    for (const label of labels) {
      selectors.push(
        `div.ds-toggle-button:has-text("${label}")`,
        `[aria-pressed]:has-text("${label}")`,
        `button:has-text("${label}")`,
        `[aria-label*="${label}"]`,
      )
    }
    for (const selector of selectors) {
      const locator = this.page!.locator(selector).first()
      if (await locator.count().catch(() => 0) > 0) {
        await locator.click({ timeout: 5_000 }).catch(() => undefined)
        return true
      }
    }
    return false
  }

  /** Toggle deep-think (R1) mode on the web page. */
  async setDeepThink(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    if (this.busy) return { ok: false, error: '正在生成回复，请先等待完成' }
    return this.queue.run(async () => {
      try {
        await this.ensureBrowser()
        const current = await this.readToggles()
        if (current.deepThink !== enabled) {
          await this.clickToggle(['深度思考', 'DeepThink', 'Deep Think'])
        }
        this.deepThink = enabled
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    })
  }

  /** Toggle internet search on the web page (web label: 智能搜索). */
  async setSearch(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    if (this.busy) return { ok: false, error: '正在生成回复，请先等待完成' }
    return this.queue.run(async () => {
      try {
        await this.ensureBrowser()
        const current = await this.readToggles()
        if (current.search !== enabled) {
          await this.clickToggle(['智能搜索', '联网搜索', 'Search'])
        }
        this.search = enabled
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    })
  }

  /** Close the browser (releases the profile lock). */
  async disposeBrowser(): Promise<void> {
    try {
      await this.context?.close()
    } catch {
      // already closed
    }
    this.context = undefined
    this.page = undefined
    this.loginMode = false
    if (this.state !== 'error') this.setState('stopped')
  }

  /**
   * Diagnostics for the scrapers. A failed recover used to report only
   * "读取网页会话历史失败（页面可能已改版）", which is unfalsifiable — it does not
   * say whether the list was empty, the selector missed, or the page was still
   * loading. This reports what the page actually contains, using the SAME
   * exported selectors the scrapers use, so a report can be acted on.
   */
  async probePage(): Promise<Record<string, unknown>> {
    if (!this.isPageAlive()) {
      return { pageAlive: false, note: '浏览器未启动；先发起一次操作再探测' }
    }
    return await this.page!.evaluate(async (selectors: Record<string, string>): Promise<Record<string, unknown>> => {
      const count = (selector: string): number => {
        try { return document.querySelectorAll(selector).length } catch { return -1 }
      }
      const items = Array.from(document.querySelectorAll(selectors.messageItem))
      const sample = items.slice(0, 4).map(item => {
        const text = (item.textContent ?? '').trim().replace(/\s+/g, ' ')
        return {
          key: item.getAttribute('data-virtual-list-item-key'),
          hasAssistantBody: item.querySelector('.ds-assistant-message-main-content') !== null,
          hasMarkdown: item.querySelector('.ds-markdown') !== null,
          roleAttr: item.getAttribute('data-role') ?? item.getAttribute('class')?.slice(0, 60) ?? null,
          textHead: text.slice(0, 60),
          textLength: text.length,
        }
      })
      /*
       * Report the two recover sources the scrapers cannot see from here: the
       * page's login token (the history endpoint needs it) and the app's own
       * history database. A recover that reads 0 messages has to be
       * distinguishable from one whose sources are unavailable.
       */
      let hasToken = false
      try { hasToken = (JSON.parse(localStorage.getItem('userToken') ?? '{}')?.value ?? '') !== '' } catch { /* unreadable */ }
      let historyCachePresent = false
      try {
        const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
        historyCachePresent = databases.some(database => database.name === 'deepseek-chat')
      } catch { /* unreadable */ }
      return {
        pageAlive: true,
        url: location.href,
        sessionId: /\/a\/chat\/s\/([^/?#]+)/.exec(location.href)?.[1] ?? null,
        readyState: document.readyState,
        linkCount: count(selectors.chatLink),
        messageItemCount: items.length,
        messageItemSample: sample,
        assistantContentCount: count('.ds-assistant-message-main-content'),
        markdownCount: count('.ds-markdown'),
        thinkCount: count('.ds-think-content'),
        textareaCount: count('textarea'),
        hasUserToken: hasToken,
        historyCachePresent,
        bodyLength: document.body?.innerText?.length ?? 0,
        bodyHead: (document.body?.innerText ?? '').slice(0, 200),
      }
    }, {
      chatLink: WEB_CHAT_LINK_SELECTOR,
      messageItem: WEB_MESSAGE_ITEM_SELECTOR,
    })
  }

  /** Engine snapshot for status routes and agent tools. */
  async status(): Promise<{
    engine: EngineState
    engineError?: string
    loggedIn: boolean | null
    pageUrl?: string
    deepThink: boolean
    search: boolean
    busy: boolean
    busySince?: number
    /** A new chat's local transcript exists while its page work is still running. */
    preparingNewChat: boolean
    lastError?: string
    lastErrorCode?: DSchatErrorCode
  }> {
    /*
     * Self-heal. A browser that died (the user closed the window, the profile
     * lock was taken, the app restarted mid-navigation) must not leave a
     * permanent red banner: nothing is running, and relaunching is exactly what
     * the next user action would do anyway.
     *
     * Crucially this also covers 'error' — the reported symptom was a panel
     * stuck on "引擎错误" after a transient teardown, and the old code only
     * self-healed out of 'ready', so the stale message never went away.
     *
     * Scoped to errors with a DEAD page on purpose: a launch failure such as
     * "Chrome is not installed" has no live page either, so a stale error is
     * exactly that. But if something is still connected we keep the message,
     * because then the error genuinely needs reading.
     *
     * The relaunch runs in the BACKGROUND. It used to be awaited right here,
     * which is what made a closed browser window freeze the panel: /state is the
     * poll the whole feed hangs off (1.5 s from the panel, 3 s from the settings
     * page), and one launch is `launchPersistentContext` plus a 45 s page.goto.
     * Every status call then took tens of seconds, so the transcript, the tail
     * feed and the phase rail all stopped — exactly when the UI should have said
     * "starting". Now the caller gets an honest status immediately (the view
     * below reports 'launching' while the flag is up) and the next poll reports
     * the outcome.
     */
    if (this.state === 'ready' && !this.isPageAlive()) {
      if (!this.relaunchPending) {
        this.relaunchPending = true
        void this.ensureBrowser()
          .catch(() => undefined)
          .finally(() => { this.relaunchPending = false })
      }
    } else if (this.engineError !== undefined && !this.isPageAlive()) {
      this.setState('stopped')
    }
    let loggedIn = await this.isLoggedIn()
    if (loggedIn === true) this.loggedInOnce = true
    else if (loggedIn === false) this.loggedInOnce = false
    else if (loggedIn === null && this.loggedInOnce) loggedIn = true
    const toggles = await this.readToggles()
    this.deepThink = toggles.deepThink
    this.search = toggles.search
    return {
      // A background self-heal counts as 'launching': that is what the panel
      // should say while the browser is coming back, and `state` alone still
      // reads 'ready' for the tick or two before the launch flips it.
      engine: this.relaunchPending ? 'launching' : this.state,
      engineError: this.engineError,
      loggedIn,
      pageUrl: this.pageUrl(),
      deepThink: this.deepThink,
      search: this.search,
      busy: this.busy,
      preparingNewChat: this.newChatPending,
      lastError: this.lastError,
      busySince: this.busySince,
      lastErrorCode: this.lastErrorCode,
    }
  }
}

/**
 * Minimal HTML fragment parser used to round-trip scraped `.ds-markdown`
 * innerHTML through htmlToMarkdown (the in-page evaluate returns HTML
 * strings; the converter consumes a light DOM-shaped object graph).
 */
function parseMarkup(html: string): MarkupNode {
  return new MarkupParser(html).parse()
}

export interface MarkupNode {
  readonly tagName?: string
  readonly nodeType: number
  readonly textContent?: string
  readonly children: MarkupNode[]
  readonly attributes: Record<string, string | undefined>
  readonly parent?: MarkupNode
}

/** Tiny HTML tokenizer → light DOM graph (sufficient for DeepSeek's markdown HTML). */
class MarkupParser {
  private readonly tokens: string[]
  private index = 0

  constructor(html: string) {
    // Tokenize into tags and text (naive but adequate: DeepSeek renders
    // well-formed HTML with no unescaped '<' in text).
    this.tokens = html.split(/(<[^>]+>)/).filter(token => token !== '')
  }

  parse(): MarkupNode {
    const root = this.parseChildren(undefined)
    return root
  }

  private parseChildren(parent: MarkupNode | undefined): MarkupNode {
    const node: MarkupNode = { nodeType: 1, children: [], attributes: {}, parent }
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index]
      if (!token.startsWith('<')) {
        node.children.push({ nodeType: 3, textContent: token, children: [], attributes: {}, parent: node })
        this.index++
        continue
      }
      const close = /^<\/([a-zA-Z0-9]+)>$/.exec(token)
      if (close !== null) {
        this.index++
        if (close[1].toLowerCase() === (node.tagName ?? '').toLowerCase()) return node
        continue // mismatched close: ignore
      }
      const open = /^<([a-zA-Z0-9]+)((?:\s+[a-zA-Z0-9-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*(\/?)>$/.exec(token)
      if (open === null) {
        this.index++
        continue
      }
      const [, rawTag, attrsRaw] = open
      const tag = rawTag.toLowerCase()
      const attributes: Record<string, string | undefined> = {}
      if (attrsRaw !== undefined) {
        const attrRe = /([a-zA-Z0-9-]+)(?:=("[^"]*"|'[^']*'|[^\s>]*))?/g
        let match: RegExpExecArray | null
        while ((match = attrRe.exec(attrsRaw)) !== null) {
          const value = match[2] === undefined ? undefined : match[2].replace(/^["']|["']$/g, '')
          attributes[match[1]] = value
        }
      }
      this.index++
      const element: MarkupNode = { tagName: tag, nodeType: 1, children: [], attributes, parent }
      if (!open[3].endsWith('/')) {
        const child = this.parseChildren(element)
        for (const grandchild of child.children) element.children.push(grandchild)
      }
      node.children.push(element)
    }
    return node
  }
}
