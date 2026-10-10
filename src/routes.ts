/**
 * The /api/dsh-dschat route family: engine state, browser login control,
 * chat operations (new chat / send / stop / switch model), transcript
 * export, and the harness transfer that seeds a new session with a web
 * transcript.
 *
 * Trust fence, in three layers, because "loopback only" is not the whole answer
 * for an endpoint that drives a browser:
 *
 *   1. LOOPBACK — the peer socket must be 127.0.0.1/::1 and the Host header must
 *      name it. LAN-exposed deployments must not serve these routes at all.
 *   2. METHOD + ORIGIN — a mutating route answers POST only, and a request that
 *      carries an `Origin`/`Sec-Fetch-Site` naming another origin is refused.
 *      Without this a page on ANY other local port could clear the whole
 *      transcript store with `<img src="http://127.0.0.1:57531/api/dsh-dschat/clear">`
 *      — no CORS needed, because a simple GET is enough to run the handler.
 *   3. CSRF TOKEN — a per-run token the panel reads from `/state` and echoes in
 *      `x-dschat-token`. Origin checks cover the browsers that send those
 *      headers; the token is what covers the case where one does not.
 *
 * Read-only routes keep answering GET (the panel's polls are GETs) and carry
 * layers 1 and 3 only, since a cross-site read cannot see the response.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { DeepSeekWebEngine } from './engine/engine.ts'
import type { TranscriptStore } from './store.ts'
import type { DSchatApiCode, DSchatChatSummary, DSchatMessage, DSchatSource, DSchatTranscript } from './protocol.ts'
import { exportTranscriptFile, previewHarnessTransfer, transferToHarnessSession } from './transfer.ts'
import type { DistillConfig } from './transfer.ts'
import { ATTACHMENT_DIR, SAFE_EXTENSION, attachmentDir, isInsideDirectory, isSameOrInsideDirectory } from './attachments.ts'

/** Cap on JSON request bodies (chat ops are small). */
const MAX_JSON_BODY_BYTES = 64 * 1024

/**
 * Cap on the UNDO body, which is not a chat op: it carries a whole transcript.
 *
 * 「撤销」 re-imports the conversation the panel still holds in memory, so this
 * body is as large as the conversation the reader just deleted — routinely past
 * 64 KiB on any real chat with a few long replies and their source tables. The
 * generic cap used to apply here, and a body over it came back as `undefined`,
 * which the handler then read as "no messages": the undo restored an EMPTY
 * conversation and reported success. Generous on purpose, and still bounded —
 * a body past this is answered with 413 rather than an empty transcript.
 */
const MAX_RESTORE_BODY_BYTES = 24 * 1024 * 1024

/**
 * Cap on one attachment. The browser sends the bytes base64-encoded, so the
 * body is ~4/3 of the file.
 *
 * 36 MiB of body is a 24 MiB file — the panel's own MAX_ATTACH_BYTES refuses
 * anything larger before it is encoded, and this is the backstop for a caller
 * that does not go through the panel. It has to stay above that number, or the
 * composer would accept a file the host then rejects with a generic
 * "图片数据为空或超过 9 MiB".
 */
const MAX_ATTACHMENT_BODY_BYTES = 36 * 1024 * 1024

/** Attachments older than this are pruned on the next upload. */
const ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * mediaType → extension.
 *
 * The panel now attaches documents as well as images (`isAttachableFile` no
 * longer filters on `image/`), so this table has to cover what a browser
 * actually reports for the formats the web page accepts. An unmapped type still
 * works — the supplied file NAME is the fallback — this only keeps the common
 * ones exactly right, and keeps a nameless paste well-named.
 */
const MEDIA_EXTENSION: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/json': '.json',
  'application/rtf': '.rtf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'text/html': '.html',
  'text/x-python': '.py',
  'application/javascript': '.js',
  'application/typescript': '.ts',
  'application/xml': '.xml',
  'application/yaml': '.yaml',
  'application/zip': '.zip',
  'application/gzip': '.gz',
}

/**
 * Pick a safe on-disk extension.
 *
 * Order: the media type wins (it is the browser's own reading of the bytes),
 * then an allow-listed extension from the supplied name, then `.bin`.
 *
 * The old tail was a blanket `.png`, which was harmless when only images could
 * be attached and is a lie now: a nameless `.docx` would land as `x.png`, and
 * the web page — which reads the extension — would refuse it. An unknown type
 * keeps `.bin` for the same reason: better an honest refusal than a file
 * mislabelled as an image.
 */
function attachmentExtension(mediaType: string, name: string): string {
  const mapped = MEDIA_EXTENSION[mediaType.toLowerCase()]
  if (mapped !== undefined) return mapped
  const fromName = extname(name).toLowerCase()
  return SAFE_EXTENSION.test(fromName) ? fromName : '.bin'
}

/**
 * Cap on the readable half of a stored attachment's file name, in BYTES.
 *
 * The label is a convenience (see {@link fileLabel}), not an identity, so it is
 * bounded: a 200-character title pasted out of a chat client would push the
 * real extension past what some tools still open by. Measured in bytes because
 * the cut must not split a multi-byte character.
 */
const ATTACHMENT_LABEL_MAX_BYTES = 60

/**
 * The reader-facing name of an attachment, safe for a file system.
 *
 * Attachments used to be stored as a bare `${randomUUID}${ext}`, so the panel's
 * chip showed `8f3c1e2b-4d7a-4f1e-….png` — the UUID, which is the one part of
 * that path which means nothing to a human. The stored name is now
 * `${uuid}__${label}${ext}`: the UUID still guarantees uniqueness and still
 * leads, so the path remains an opaque, unguessable token, while this label
 * carries the name the reader actually chose.
 *
 * Everything unsafe is REPLACED rather than escaped: separators and control
 * characters could not be written anyway, and `:`/`*`/`?`/`"`/`<`/`>`/`|`
 * break Windows or read as markup. This runs on private data (the route is
 * loopback-only), so the goal is a well-formed name, not a security boundary —
 * the boundary is that the EXTENSION is still chosen by
 * {@link attachmentExtension}, never by this label.
 *
 * @param name - the caller-supplied file name (may be empty, or a whole path).
 * @returns a non-empty, single-segment label bounded to
 *   {@link ATTACHMENT_LABEL_MAX_BYTES} UTF-8 bytes.
 */
export function fileLabel(name: string): string {
  // `basename` first: a browser sends the bare name, but a path-shaped caller
  // must not be able to inject a separator into the stored file name.
  const flat = basename(name).replace(/[\u0000-\u001f\u007f]/g, '')
  const cleaned = flat.replace(/[/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim()
  if (cleaned === '') return 'file'
  const bytes = Buffer.from(cleaned, 'utf8')
  if (bytes.length <= ATTACHMENT_LABEL_MAX_BYTES) return cleaned
  /*
   * Cut on a byte boundary, then step back over any continuation byte so the
   * result is still valid UTF-8 — decoding a split character would turn it into
   * U+FFFD and put a replacement glyph in the reader's file name.
   */
  let end = ATTACHMENT_LABEL_MAX_BYTES
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
  const truncated = bytes.subarray(0, end).toString('utf8').trim()
  return truncated === '' ? 'file' : truncated
}

/**
 * The on-disk name for one uploaded attachment: unique ID first, readable label
 * second, safe extension last.
 *
 * The label drops the name's OWN extension when it is the one we are about to
 * append: `screenshot.png` used to land as `…__screenshot.png.png`, which is not
 * wrong so much as ugly, and it makes the extension read as part of the name in
 * every listing. When the two disagree — a `.jpeg` reported as `image/jpeg` and
 * re-appended as `.jpg` — the name keeps its own spelling and the storage
 * extension stays authoritative, because that is the one the page reads.
 *
 * @param name - the caller's file name.
 * @param mediaType - the browser's media type for the bytes.
 */
export function attachmentFileName(name: string, mediaType: string): string {
  const extension = attachmentExtension(mediaType, name)
  const label = fileLabel(name)
  const trimmed = label.toLowerCase().endsWith(extension.toLowerCase()) && label.length > extension.length
    ? label.slice(0, -extension.length)
    : label
  return `${randomUUID()}__${trimmed}${extension}`
}

/**
 * Extension → media type, for serving an attachment back to the panel.
 *
 * The inverse of {@link MEDIA_EXTENSION} plus the text formats the allow-list
 * admits but the upload table never needs to name, because the browser always
 * reports a type for those. Anything unrecognized is served as an opaque
 * download rather than guessed at: a wrong `image/*` on a PDF would make the
 * panel render a broken thumbnail where a file chip belongs.
 */
const EXTENSION_MEDIA: Record<string, string> = (() => {
  const table: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.heic': 'image/heic',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.markdown': 'text/markdown; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.tsv': 'text/tab-separated-values; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jsonl': 'application/x-ndjson; charset=utf-8',
    '.log': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.yaml': 'application/yaml; charset=utf-8',
    '.yml': 'application/yaml; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.tex': 'text/plain; charset=utf-8',
    '.rtf': 'application/rtf',
    '.srt': 'text/plain; charset=utf-8',
    '.vtt': 'text/vtt; charset=utf-8',
  }
  for (const [mediaType, extension] of Object.entries(MEDIA_EXTENSION)) {
    if (table[extension] === undefined) table[extension] = mediaType
  }
  return table
})()

/** The name stored after the `uuid__` prefix, for the download header. */
function labelOf(file: string): string {
  const at = file.indexOf('__')
  return at === -1 ? file : file.slice(at + 2)
}

/**
 * Every attachment path the stored transcripts still reference.
 *
 * Built on demand (pruning happens once per upload, not per poll) because a
 * lifetime registry would go stale the moment a transcript is deleted or a
 * store is loaded from disk. Cheap at this cadence: one pass over the message
 * lists.
 */
function referencedAttachments(store: TranscriptStore): Set<string> {
  const referenced = new Set<string>()
  for (const chat of store.list()) {
    for (const message of chat.messages) {
      for (const path of message.attachments ?? []) referenced.add(path)
    }
  }
  return referenced
}

/**
 * Drop attachment files past their TTL so pasted files cannot pile up.
 *
 * `referenced` is the set of absolute paths the stored transcripts still point
 * at, and a referenced file is NEVER pruned no matter how old it is. Time alone
 * was the only rule before, which quietly broke old conversations: a transcript
 * older than the TTL reopened as dead image/PDF chips, and its attachments were
 * exported as paths that no longer exist. The TTL is about garbage, not about
 * history.
 */
function pruneAttachments(dir: string, referenced: ReadonlySet<string>): void {
  try {
    const cutoff = Date.now() - ATTACHMENT_TTL_MS
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (referenced.has(path)) continue
      try {
        if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true })
      } catch {
        // A file that vanished mid-scan is already gone; nothing to prune.
      }
    }
  } catch {
    // Pruning is housekeeping: never fail an upload because of it.
  }
}

/**
 * Loopback-only trust fence (mirrors dsh-ssh), FAIL-CLOSED.
 *
 * The address test used to accept `undefined` as loopback. A socket whose
 * `remoteAddress` the runtime has not filled in (a Unix-domain socket, a
 * transport this code has not met) is not evidence of a local caller — it is
 * missing evidence — and reading "unknown" as "trusted" is how the fence around
 * a route that drives a browser and clears history becomes decoration.
 */
function isLoopbackRequest(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  const address = req.socket.remoteAddress ?? ''
  const loopbackHost = host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]')
  const loopbackAddr = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  return loopbackHost && loopbackAddr
}

/** One header as a single string (`set-cookie`-style arrays are ignored). */
function headerValue(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return typeof value === 'string' ? value : ''
}

/** The request's method, upper-cased; an absent method counts as GET. */
function methodOf(req: IncomingMessage): string {
  return (req.method ?? 'GET').toUpperCase()
}

/**
 * True when the request is not provably from ANOTHER origin.
 *
 * Two independent signals, both of which a browser sets and page script cannot
 * forge:
 *
 *   - `Origin`, when present, must name this very server. It rides every
 *     non-GET request a browser makes, including same-origin ones, so a page on
 *     another local port (`http://127.0.0.1:8080` → same-site, different origin)
 *     is refused here even though `Sec-Fetch-Site` would call it `same-site`.
 *   - `Sec-Fetch-Site`, when present, must be `same-origin` or `none`; both
 *     `cross-site` and the `same-site` another local port produces are refused.
 *
 * A caller that sends NEITHER header is not a document in a browser — it is a
 * script, a test, or curl — and the loopback fence plus the CSRF token still
 * apply to it.
 */
function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = headerValue(req, 'origin')
  /*
   * Compare host[:port] only: the harness serves plain http, and the scheme a
   * caller wrote does not change which server answered.
   *
   * `Origin: null` — a sandboxed iframe or a `file://` page — is treated as
   * FOREIGN rather than as "no origin". It is not this server by construction,
   * and the only legitimate caller (the panel) is served from this very origin,
   * so it always sends a real one.
   */
  if (origin !== '') {
    const withoutScheme = origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    if (withoutScheme !== (req.headers.host ?? '')) return false
  }
  const site = headerValue(req, 'sec-fetch-site')
  if (site !== '' && site !== 'same-origin' && site !== 'none') return false
  return true
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/**
 * One FAILED route answer.
 *
 * Every failure goes through here so it cannot forget its `code`: the panel
 * needs the code to render a sentence in the reader's own language, and a route
 * that answers with only a Chinese string is a route that prints Chinese into an
 * English interface. `error` stays as the technical detail beside the code (see
 * {@link DSchatApiCode}).
 */
function failure(res: ServerResponse, status: number, code: DSchatApiCode, error: string): void {
  writeJson(res, status, { ok: false, code, error })
}

/**
 * One conversation, without its messages.
 *
 * `/state` answers with these instead of whole transcripts: it is polled every
 * 1.5 s, and the store on this machine is 5.86 MB — none of which a sidebar row
 * or a streaming flag needs. See {@link DSchatChatSummary}.
 */
export function summarizeChat(chat: DSchatTranscript): DSchatChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    model: chat.model,
    streaming: chat.streaming,
    messageCount: chat.messages.length,
    ...(chat.webSessionId === undefined ? {} : { webSessionId: chat.webSessionId }),
  }
}

/** How many conversation ids one search answers with. */
const SEARCH_LIMIT = 50

/**
 * Which conversations match `needle`, by title or by any message body.
 *
 * Runs in the host because that is where the text is: the panel's filter used to
 * scan the messages it held, which only worked while `/state` shipped the whole
 * store. Newest first (the list is already in that order), and bounded — a
 * one-letter query matches everything, and the panel only needs to know which
 * rows to show.
 *
 * @param needle - the raw query; trimmed and lower-cased here.
 */
export function searchChats(store: TranscriptStore, needle: string): string[] {
  const query = needle.trim().toLowerCase()
  if (query === '') return []
  const hits: string[] = []
  for (const chat of store.list()) {
    if (hits.length >= SEARCH_LIMIT) break
    if (chat.title.toLowerCase().includes(query)) {
      hits.push(chat.id)
      continue
    }
    if (chat.messages.some(message => message.content.toLowerCase().includes(query))) hits.push(chat.id)
  }
  return hits
}

/**
 * Validate the message list a `/restore` caller hands over.
 *
 * 「撤销」 re-imports the conversation the panel still holds, so this body is
 * written straight into the transcript file and is then read back by the panel,
 * the export, `dschat_import` and `dschat_transfer` — i.e. it is a local write
 * primitive whose output ends up in an agent's context. Treating it as
 * "whatever the caller sent" is how one malformed record becomes a rendering
 * crash or a permanently-streaming row, far from its cause.
 *
 * A record is kept only when it is UNAMBIGUOUSLY a message: a known role and a
 * string body. Everything else is DROPPED and counted rather than repaired into
 * a guess — but a single bad entry must not fail the whole undo, because the
 * realistic bad case is one stale field on one of forty messages.
 *
 * @param value - the raw `messages` field.
 */
export function sanitizeRestoreMessages(value: unknown): { messages: DSchatMessage[]; dropped: number } {
  if (!Array.isArray(value)) return { messages: [], dropped: 0 }
  const messages: DSchatMessage[] = []
  let dropped = 0
  for (const entry of value) {
    const message = sanitizeRestoreMessage(entry)
    if (message === undefined) dropped += 1
    else messages.push(message)
  }
  return { messages, dropped }
}

/** One validated message, or undefined when it is not one. */
function sanitizeRestoreMessage(value: unknown): DSchatMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const role = record['role']
  if (role !== 'user' && role !== 'assistant') return undefined
  const content = record['content']
  if (typeof content !== 'string') return undefined
  const id = typeof record['id'] === 'string' && record['id'] !== '' ? record['id'] : randomUUID()
  const ts = typeof record['ts'] === 'number' && Number.isFinite(record['ts']) && record['ts'] > 0 ? record['ts'] : Date.now()
  const error = typeof record['error'] === 'string' ? record['error'] : undefined
  const thinkingMs = typeof record['thinkingMs'] === 'number' && Number.isFinite(record['thinkingMs']) && record['thinkingMs'] >= 0
    ? record['thinkingMs']
    : undefined
  const attachments = stringList(record['attachments'])
  const sources = sourceList(record['sources'])
  return {
    id,
    role,
    content,
    ts,
    /*
     * ALWAYS false. A restored message is by definition not being generated:
     * `streaming: true` on a row nobody is streaming leaves the panel's reply
     * indicator running forever with no engine turn behind it.
     */
    streaming: false,
    ...(error === undefined ? {} : { error }),
    ...(thinkingMs === undefined ? {} : { thinkingMs }),
    ...(attachments === undefined ? {} : { attachments }),
    ...(sources === undefined ? {} : { sources }),
  }
}

/** A list of non-empty strings, or undefined when there is nothing usable. */
function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.filter((item): item is string => typeof item === 'string' && item !== '')
  return kept.length === 0 ? undefined : kept
}

/** A citation table, or undefined when there is nothing usable. */
function sourceList(value: unknown): DSchatSource[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept: DSchatSource[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record['url'] !== 'string') continue
    kept.push(typeof record['title'] === 'string' ? { url: record['url'], title: record['title'] } : { url: record['url'] })
  }
  return kept.length === 0 ? undefined : kept
}

/**
 * Length of the prefix two strings share — the `head` of a /tail delta.
 *
 * The streaming case is pure append, so the length check plus `startsWith` flat
 * compare settles it before the character scan ever runs.
 */
function commonPrefixLength(a: string, b: string): number {
  if (a.length < b.length && b.startsWith(a)) return a.length
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

/** One /tail delta: what the client must drop and what it must append. */
export interface TailDelta {
  /** Length of the client's usable prefix; 0 means "discard your copy". */
  head: number
  /** The remainder — the whole body when `head` is 0. */
  tail: string
}

/**
 * Compute the delta for one message.
 *
 * `previous` is the content the PREVIOUS response handed over, `at` the length
 * the client says it holds. The two agree on every normal tick, and `head` is
 * then the unchanged prefix — which for a streaming reply is everything but the
 * new characters, so a tick costs ~50 bytes instead of the whole transcript.
 *
 * Any disagreement is answered with the whole body (`head: 0`). That is what
 * makes the feed self-healing: a dropped request, a page reload or a second
 * client costs one full response, never a corrupted message. Since content only
 * grows, equal length implies equal content, so an agreeing `at` is a safe
 * "your copy is my copy" test rather than a guess.
 *
 * Exported because the merge is a contract between two halves that must not
 * drift; the panel applies `local.slice(0, head) + tail`.
 */
export function tailDelta(previous: string | undefined, content: string, at: number): TailDelta {
  const head = previous === undefined || !Number.isInteger(at) || at !== previous.length
    ? 0
    : commonPrefixLength(previous, content)
  return { head, tail: content.slice(head) }
}

/** Read a JSON request body. */
async function readJsonBody(req: IncomingMessage, maxBytes: number = MAX_JSON_BODY_BYTES): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function stringField(body: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = body?.[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Resolved runtime settings surfaced to the panel's settings page (read-only). */
export interface HostSettingsView {
  browserChannel: string
  browserExecutablePath: string
  browserProxy: string
  browserHeadless: boolean
  replyTimeoutMs: number
  dataDir: string
  profileDir: string
  /** Where 「导出 markdown」 writes, resolved (never empty). */
  exportDir: string
  transferDistill: boolean
  transferProvider: string
  transferModel: string
  announceToAgent: boolean
}

/** Host-side facts the panel needs for its transfer and export targets. */
export interface HostContextView {
  /** Workspaces available as a new session's home. */
  workspaces: Array<{ id: string; path: string; title: string }>
  /** Working directory of the most recently created live session, when known. */
  cwd?: string
  /** Resolved plugin settings, for the native settings page. */
  settings: HostSettingsView
}

/** Route family dependencies. */
export interface DSchatRoutesDeps {
  ctx: Context
  engine: DeepSeekWebEngine
  store: TranscriptStore
  /**
   * The running bundle's version and build time (injected at build time).
   *
   * Reported through `/state` so the panel's status card can answer "which build
   * is this?" — a question `package.json`, the git tag and the newest tarball
   * each answer differently.
   */
  build: { version: string; build: string }
  distill: DistillConfig
  /**
   * Where 「导出 markdown」 writes when the caller names no directory.
   *
   * Supplied as a getter rather than a value so a settings edit lands on the
   * next export without re-registering the route: the host resolves it from the
   * live config on every call (`resolveExportDir`).
   */
  exportDir: () => string
  /** Optional host facts (workspace list + recent session cwd) for the panel. */
  hostContext?: () => HostContextView
}

/** Header the panel echoes the per-run CSRF token in. */
const CSRF_HEADER = 'x-dschat-token'

/** What a route does to the world, which decides how hard the fence is. */
type RouteAccess = 'read' | 'write'

/** Build every /api/dsh-dschat route. */
export function makeRoutes(deps: DSchatRoutesDeps): WebRoute[] {
  const { ctx, engine, store, build, distill, hostContext, exportDir } = deps

  /*
   * One CSRF token per plugin run.
   *
   * The panel reads it from `/state` (or the tiny `/token` route) and echoes it
   * in `x-dschat-token` on every mutating call. A cross-site page cannot read
   * either response — there is no CORS grant here and the bodies are JSON, which
   * a `<script src>` will not execute — so it cannot produce the header, and
   * neither can an `<img>`/`<form>` trigger that never runs our JavaScript at
   * all. Rotating per run (rather than persisting) means a token leaked by a log
   * or a stale tab is worthless after a restart, and the client answers a 403
   * `CSRF` by re-reading the token and retrying once, so a restart mid-session
   * is invisible to the reader.
   */
  const csrfToken = randomUUID()

  /**
   * The three-layer fence; see the module header.
   *
   * @param access - 'write' for anything that changes state or drives the
   *   browser, 'read' for the polls.
   */
  const guard = (req: IncomingMessage, res: ServerResponse, access: RouteAccess = 'read'): boolean => {
    if (!isLoopbackRequest(req)) {
      failure(res, 403, 'LOOPBACK', 'loopback only')
      return false
    }
    if (access === 'write') {
      if (methodOf(req) !== 'POST') {
        failure(res, 405, 'METHOD', '该操作只接受 POST 请求')
        return false
      }
      if (!isSameOriginRequest(req)) {
        failure(res, 403, 'ORIGIN', '跨站请求被拒绝（Origin/Sec-Fetch-Site 不匹配）')
        return false
      }
      if (headerValue(req, CSRF_HEADER) !== csrfToken) {
        failure(res, 403, 'CSRF', '缺少或无效的 CSRF 令牌，请刷新面板')
        return false
      }
      return true
    }
    const method = methodOf(req)
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      failure(res, 405, 'METHOD', '该接口只接受 GET 请求')
      return false
    }
    return true
  }

  const stateView = async (): Promise<Record<string, unknown>> => {
    const status = await engine.status()
    return {
      ok: true,
      /*
       * The CSRF token rides /state because that is the panel's first call and
       * it already happens on mount: no second handshake, no ordering problem.
       */
      csrfToken,
      engine: status.engine,
      engineError: status.engineError,
      loggedIn: status.loggedIn,
      pageUrl: status.pageUrl,
      deepThink: status.deepThink,
      search: status.search,
      busy: status.busy,
      preparingNewChat: status.preparingNewChat,
      busySince: status.busySince,
      lastError: status.lastError,
      lastErrorCode: status.lastErrorCode,
      // A store that failed to load or save: the panel says so once instead of
      // letting the history look quietly empty.
      storeWarning: store.storeWarning(),
      // Constant for the life of the process, and the only honest answer to
      // "which build is running?" — see the build-time defines.
      version: build.version,
      build: build.build,
      activeChatId: store.activeChat()?.id,
      // Summaries, NOT transcripts: this is the 1.5 s poll. The bodies travel
      // on `/chat?id=` for the one conversation the panel is rendering.
      chats: store.list().map(summarizeChat),
    }
  }

  /**
   * The content the previous /tail response handed to the browser, per message.
   *
   * The delta is expressed against THIS rather than against anything the client
   * echoes back, which is what keeps a tick to a few dozen bytes: the client
   * only has to send the length it holds. Bounded because at most one reply
   * streams at a time — a long session cannot grow the map without limit.
   */
  const tailSent = new Map<string, string>()
  const TAIL_SENT_LIMIT = 4

  /** Build one tail response: cheap status + the view chat's last reply. */
  const tailView = (req: IncomingMessage): Record<string, unknown> => {
    const query = new URL(req.url ?? '/', 'http://x').searchParams
    const requested = query.get('chat') ?? undefined
    const chat = (requested === undefined ? store.activeChat() : store.get(requested))
      ?? store.activeChat()
    const base = {
      ok: true,
      chatId: chat?.id,
      activeChatId: store.activeChat()?.id,
      busy: engine.getBusy(),
      busySince: engine.getBusySince(),
      streaming: chat?.streaming === true,
      title: chat?.title,
      updatedAt: chat?.updatedAt,
      messageCount: chat?.messages.length,
    }
    if (chat === undefined) return { ...base, message: null }
    const message = [...chat.messages].reverse().find(candidate => candidate.role === 'assistant')
    if (message === undefined) return { ...base, message: null }

    const content = message.content
    const delta = tailDelta(tailSent.get(message.id), content, Number(query.get('at') ?? ''))
    // Keep the map most-recent-first, then drop the overflow.
    tailSent.delete(message.id)
    tailSent.set(message.id, content)
    for (const key of tailSent.keys()) {
      if (tailSent.size <= TAIL_SENT_LIMIT) break
      tailSent.delete(key)
    }
    return {
      ...base,
      message: {
        id: message.id,
        role: message.role,
        ts: message.ts,
        streaming: message.streaming === true,
        error: message.error,
        length: content.length,
        head: delta.head,
        tail: delta.tail,
        /*
         * The reasoning duration rides the tail from the moment the answer
         * starts: that is when the engine measures it, and the answer itself can
         * then stream for another minute with this feed as the panel's only
         * source. Absent for a reply with no reasoning (or one still thinking).
         */
        ...(message.thinkingMs === undefined ? {} : { thinkingMs: message.thinkingMs }),
        /*
         * The citation table travels WHOLE on every tail, never as a delta:
         * numbering is positional, so a partially-patched table would point
         * citations at the wrong source. It is a few URLs per reply, and the
         * search step that fills it precedes the answer that cites it — which
         * is what makes a chip clickable the moment it renders.
         */
        ...(message.sources === undefined || message.sources.length === 0
          ? {}
          : { sources: message.sources }),
      },
    }
  }

  return [
    {
      kind: 'exact',
      path: '/api/dsh-dschat/state',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        writeJson(res, 200, await stateView())
      },
    },
    {
      /**
       * The CSRF token on its own.
       *
       * Exists so the client can re-arm after a host restart without paying for
       * a whole `/state` (which reads the live page's toggle states and copies
       * the entire transcript store). Read-only, like `/state`, and useless to a
       * cross-site caller for the same reason: no CORS grant, JSON body.
       */
      kind: 'exact',
      path: '/api/dsh-dschat/token',
      handler: (req, res) => {
        if (!guard(req, res)) return
        writeJson(res, 200, { ok: true, csrfToken })
      },
    },
    {
      /**
       * One conversation WITH its messages.
       *
       * The other half of `/state`'s summary: the panel fetches the body of the
       * conversation it renders, and of the one a reply is streaming into. `id`
       * omitted means the active conversation, so the first paint after a reload
       * needs no id at all.
       */
      kind: 'exact',
      path: '/api/dsh-dschat/chat',
      handler: (req, res) => {
        if (!guard(req, res)) return
        const query = new URL(req.url ?? '/', 'http://x').searchParams
        const id = query.get('id') ?? store.activeChat()?.id
        const chat = id === undefined ? undefined : store.getChat(id)
        if (chat === undefined) {
          failure(res, 404, 'NOT_FOUND', '找不到该对话记录')
          return
        }
        writeJson(res, 200, { ok: true, chat })
      },
    },
    {
      /**
       * Which conversations contain a string.
       *
       * Read-only and loopback-fenced like every other route. It answers with
       * IDS, not transcripts: the panel already has the summaries, and a search
       * that shipped the matching bodies would recreate the very payload this
       * change removed.
       */
      kind: 'exact',
      path: '/api/dsh-dschat/search-conversations',
      handler: (req, res) => {
        if (!guard(req, res)) return
        const query = new URL(req.url ?? '/', 'http://x').searchParams
        writeJson(res, 200, { ok: true, ids: searchChats(store, query.get('q') ?? '') })
      },
    },
    {
      /**
       * The streaming feed.
       *
       * Deliberately answers WITHOUT calling `engine.status()`: that reads the
       * deep-think/search toggles out of the live page, i.e. one or two CDP
       * round trips into the very page the reply loop is polling. `/state` keeps
       * that job at its slow cadence; this route only reports flags the engine
       * already holds in memory.
       */
      kind: 'exact',
      path: '/api/dsh-dschat/tail',
      handler: (req, res) => {
        if (!guard(req, res)) return
        writeJson(res, 200, tailView(req))
      },
    },
    {
      // Host facts the panel cannot read from a Client service without guessing
      // its shape: the workspace list and the most recent session's cwd.
      kind: 'exact',
      path: '/api/dsh-dschat/context',
      handler: (req, res) => {
        if (!guard(req, res)) return
        const view = hostContext?.()
        writeJson(res, 200, { ok: true, workspaces: view?.workspaces ?? [], cwd: view?.cwd, settings: view?.settings })
      },
    },
    {
      /**
       * "I want to type": bring the page up in the right mode.
       *
       * The panel calls this from the composer's focus, from the online/offline
       * placeholder click and before a send that arrives while the engine is
       * down. It answers `loginWindow: true` when a visible window is waiting
       * for the user, which is the panel's cue NOT to ask for one as well.
       *
       * Deliberately not the same route as `open-login`: that one is the
       * explicit 「打开登录窗口」 action and the escalation. Collapsing the two is
       * what made a click open a login window that was almost never needed (the
       * profile is usually still authenticated) and then launch a second browser
       * for the actual chat.
       */
      kind: 'exact',
      path: '/api/dsh-dschat/wake',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const result = await engine.wake()
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/open-login',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const result = await engine.openLoginWindow()
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/close-browser',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        await engine.disposeBrowser()
        writeJson(res, 200, { ok: true })
      },
    },
    {
      // Undo for delete: re-imports the transcript the panel still holds in
      // memory, so "撤销" restores the real conversation instead of a copy of
      // its title. Returns the new chat id.
      kind: 'exact',
      path: '/api/dsh-dschat/restore',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req, MAX_RESTORE_BODY_BYTES)
        /*
         * An unreadable body is NOT "a conversation with no messages".
         *
         * `readJsonBody` answers `undefined` for an oversize body, for invalid
         * JSON and for a request that never arrived; treating that as an empty
         * message list is what turned a failed undo into "撤销成功，但对话是空
         * 的". Refuse loudly instead, so the panel shows its delete-failed
         * toast and the reader still has the text on screen to copy out.
         */
        if (body === undefined) {
          failure(res, 413, 'TOO_LARGE', `撤销失败：对话数据无法读取（超过 ${Math.round(MAX_RESTORE_BODY_BYTES / (1024 * 1024))} MiB 或格式损坏），已保留当前内容。`)
          return
        }
        const restored = sanitizeRestoreMessages(body['messages'])
        if (restored.messages.length === 0) {
          failure(res, 400, 'BAD_REQUEST', restored.dropped > 0
            ? `撤销失败：${String(restored.dropped)} 条消息结构不合法，没有可恢复的内容。`
            : '撤销失败：没有可恢复的消息。')
          return
        }
        // The web session id travels with the undo too, so the restored
        // transcript re-attaches to the same web conversation instead of being
        // matched by its (non-unique) title.
        const webSessionId = stringField(body, 'webSessionId')
        const result = store.importTranscript({
          title: stringField(body, 'title') ?? '恢复的对话',
          model: stringField(body, 'model') ?? 'deepseek-chat',
          ...(webSessionId === undefined ? {} : { webSessionId }),
          messages: restored.messages,
        })
        writeJson(res, 200, {
          ok: true,
          chatId: result.chat.id,
          created: result.created,
          // Reported so the panel can say "2 条记录已跳过" instead of silently
          // dropping them.
          ...(restored.dropped === 0 ? {} : { dropped: restored.dropped }),
        })
      },
    },
    {
      // Paste / drop target: the browser has file BYTES, but the engine drives
      // the page's file input, which needs a real path. Persist the bytes under
      // the plugin's data dir and hand the path back, so attaching a file is
      // "drop it" instead of "type its absolute path".
      kind: 'exact',
      path: '/api/dsh-dschat/attach',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req, MAX_ATTACHMENT_BODY_BYTES)
        const data = typeof body?.['data'] === 'string' ? body['data'] : ''
        if (data === '') {
          failure(res, 400, 'BAD_REQUEST', 'empty attachment body（文件数据为空或超过 24 MiB）')
          return
        }
        const bytes = Buffer.from(data, 'base64')
        if (bytes.length === 0) {
          failure(res, 400, 'BAD_REQUEST', 'attachment is not valid base64')
          return
        }
        const dir = join(store.dataDir, ATTACHMENT_DIR)
        try {
          mkdirSync(dir, { recursive: true })
          pruneAttachments(dir, referencedAttachments(store))
          const name = stringField(body, 'name') ?? 'pasted-file'
          const path = join(dir, attachmentFileName(name, stringField(body, 'mediaType') ?? ''))
          writeFileSync(path, bytes, { mode: 0o600 })
          writeJson(res, 200, { ok: true, path, bytes: bytes.length, name })
        } catch (error) {
          failure(res, 500, 'INTERNAL', `写入附件失败：${String(error)}`)
        }
      },
    },
    {
      /*
       * Read one stored attachment back, so the composer can show a real
       * THUMBNAIL for an image instead of a paperclip.
       *
       * The bytes travel over this route rather than a data URL carried in the
       * panel's state: a 24 MiB photo would otherwise sit base64-encoded (~33%
       * larger) in the composer, in every snapshot of it, and in the bundle's
       * own cached module. Going through the host also means a transcript
       * recovered from disk — which holds only the old, bare-UUID paths —
       * renders thumbnails exactly like a freshly pasted file.
       *
       * Trust fence: this serves a file from the plugin's own data directory,
       * so it carries the same loopback check as every other route, and the
       * path is CONTAINED to that directory before a byte is read — a
       * `../`-shaped path is answered 404 rather than followed.
       */
      kind: 'exact',
      path: '/api/dsh-dschat/attachment',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const requested = new URL(req.url ?? '/', 'http://x').searchParams.get('path') ?? ''
        if (requested === '') {
          failure(res, 400, 'BAD_REQUEST', '缺少 path 参数')
          return
        }
        const dir = resolve(join(store.dataDir, ATTACHMENT_DIR))
        const absolute = resolve(requested)
        // Compare against `dir/` so a sibling directory sharing the prefix
        // cannot be reached — and `readFileSync` below is then enough to tell a
        // file from a directory, a pruned path, or anything else that is not
        // there, because it fails for all three.
        if (!absolute.startsWith(`${dir}/`)) {
          failure(res, 404, 'PATH', '附件不在附件目录内')
          return
        }
        const file = basename(absolute)
        const mediaType = EXTENSION_MEDIA[extname(file).toLowerCase()] ?? 'application/octet-stream'
        /*
         * Read whole, then answer — rather than piping a stream.
         *
         * The file is capped at the upload limit (24 MiB), the panel asks for a
         * 56px thumbnail, and the bytes are read into the same buffer either
         * way; piping would only add a second response shape to this route
         * family, where every other route answers `writeHead` + `end`. It also
         * makes the failure mode uniform: a file that vanished between the
         * `statSync` and the read is answered like the pruned one above.
         */
        let bytes: Buffer
        try {
          bytes = readFileSync(absolute)
        } catch {
          failure(res, 404, 'NOT_FOUND', '附件不存在')
          return
        }
        /*
         * `inline` with an explicit filename: the panel renders this in an
         * `<img>`, and a reader who opens the URL directly gets the original
         * name back instead of the stored `uuid__` one.
         */
        res.writeHead(200, {
          'content-type': mediaType,
          'content-length': String(bytes.length),
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(labelOf(file))}`,
          'cache-control': 'private, max-age=300',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        })
        res.end(bytes)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/new-chat',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const result = await engine.newChat()
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/send',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req)
        const text = stringField(body, 'text')
        if (text === undefined) {
          failure(res, 400, 'BAD_REQUEST', '缺少 text 字段')
          return
        }
        // GUI sends resolve immediately; the reply streams in the background
        // into the transcript and the panel polls /state for live updates.
        const images = Array.isArray(body?.['images'])
          ? (body['images'] as unknown[]).filter(value => typeof value === 'string').map(value => value as string)
          : undefined
        /*
         * Containment at the HTTP boundary.
         *
         * The panel's flow is: drop a file → `/attach` writes it under
         * `<dataDir>/attachments` → `/send` hands that path back. Nothing else
         * legitimately reaches this route, so a path outside that directory is
         * refused here rather than being pushed into the page's file input —
         * which is what turned this route into "upload any readable file on the
         * machine to the user's DeepSeek account". `dschat_send` is a different
         * door with a documented "any local path" contract, so the engine's own
         * checks (regular file, type, size, count) stay the only rule there.
         */
        if (images !== undefined && images.length > 0) {
          const dir = attachmentDir(store.dataDir)
          const outside = images.filter(path => !isInsideDirectory(dir, path))
          if (outside.length > 0) {
            failure(res, 403, 'PATH', `附件路径不在附件目录内：${outside.slice(0, 3).join('、')}`)
            return
          }
        }
        const result = await engine.send(text, false, images)
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/stop',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        await engine.stop()
        writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/deep-think',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req)
        const enabled = typeof body?.['enabled'] === 'boolean' ? body['enabled'] : undefined
        if (enabled === undefined) {
          failure(res, 400, 'BAD_REQUEST', '缺少 enabled 字段')
          return
        }
        const result = await engine.setDeepThink(enabled)
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/search',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req)
        const enabled = typeof body?.['enabled'] === 'boolean' ? body['enabled'] : undefined
        if (enabled === undefined) {
          failure(res, 400, 'BAD_REQUEST', '缺少 enabled 字段')
          return
        }
        const result = await engine.setSearch(enabled)
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      /**
       * Build the hand-off text WITHOUT writing it.
       *
       * P0 trust fix: distillation is lossy and can fail silently, so the panel
       * shows the bytes here, lets the reader edit them, and only then calls
       * `/transfer` with the confirmed text. Resolving the destination happens
       * here too, so a bad workspace/target session is reported before the
       * expensive part.
       */
      kind: 'exact',
      path: '/api/dsh-dschat/transfer-preview',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req)
        const chatId = stringField(body, 'chatId') ?? store.activeChat()?.id
        const cwd = stringField(body, 'cwd')
        const workspaceId = stringField(body, 'workspaceId')
        const targetSessionId = stringField(body, 'targetSessionId')
        const mode = body?.['mode'] === 'raw' ? 'raw' : body?.['mode'] === 'distill' ? 'distill' : undefined
        const transcript: DSchatTranscript | undefined = chatId === undefined ? undefined : store.getChat(chatId)
        if (transcript === undefined) {
          failure(res, 404, 'NOT_FOUND', '找不到该对话记录')
          return
        }
        try {
          const workspace = workspaceId === undefined ? undefined : { workspaceId }
          const draft = await previewHarnessTransfer(ctx, { transcript, cwd, workspace, targetSessionId }, distill, mode)
          writeJson(res, 200, { ok: true, ...draft })
        } catch (error) {
          failure(res, 500, 'INTERNAL', String(error))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/transfer',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req)
        const chatId = stringField(body, 'chatId') ?? store.activeChat()?.id
        const cwd = stringField(body, 'cwd')
        const workspaceId = stringField(body, 'workspaceId')
        const targetSessionId = stringField(body, 'targetSessionId')
        const mode = body?.['mode'] === 'raw' ? 'raw' : body?.['mode'] === 'distill' ? 'distill' : undefined
        /*
         * The confirmed preview, when there was one. It is passed through
         * verbatim (see `seedMarkdown`): the reader may have edited it, and
         * distilling again would both discard that and pay for the model calls
         * twice.
         */
        const seedMarkdown = stringField(body, 'markdown')
        const transcript: DSchatTranscript | undefined = chatId === undefined ? undefined : store.getChat(chatId)
        if (transcript === undefined) {
          failure(res, 404, 'NOT_FOUND', '找不到该对话记录')
          return
        }
        try {
          const workspace = workspaceId === undefined ? undefined : { workspaceId }
          const { sessionId, distilled, attached, workspaceId: attachedWorkspaceId, duplicate } = await transferToHarnessSession(ctx, {
            transcript,
            cwd,
            workspace,
            targetSessionId,
            ...(seedMarkdown === undefined ? {} : { seedMarkdown, seedDistilled: body?.['distilled'] === true }),
          }, distill, mode)
          writeJson(res, 200, {
            ok: true,
            sessionId,
            distilled,
            attached,
            continued: targetSessionId !== undefined,
            // True when the brief was already in the target session and nothing
            // was appended: the panel says so instead of implying a new handoff.
            duplicate: duplicate === true,
            workspaceId: attachedWorkspaceId,
          })
        } catch (error) {
          failure(res, 500, 'INTERNAL', String(error))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/export',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req)
        const chatId = stringField(body, 'chatId') ?? store.activeChat()?.id
        /*
         * The destination is the HOST's decision, not the panel's.
         *
         * It used to be `cwd` — the working directory of the most recent
         * harness session — which meant 「导出 markdown」 dropped the file into
         * whatever project happened to be open, a place the reader had no
         * reason to look. The default is now the download folder (see
         * `resolveExportDir`), and an explicit `cwd` is still honoured — but
         * only WITHIN the configured export directory.
         *
         * The parameter used to accept any absolute path at all, which made
         * "write a file wherever I say" a feature of a route whose trust fence
         * is a loopback check. Keeping the caller's choice (a script can still
         * pick a subfolder, the settings page can probe its own folder) while
         * bounding where it can land costs the legitimate uses nothing.
         */
        const allowedDir = resolve(exportDir())
        const requestedDir = stringField(body, 'cwd')
        if (requestedDir !== undefined && !isSameOrInsideDirectory(allowedDir, requestedDir)) {
          failure(res, 403, 'PATH', `导出目录必须在 ${allowedDir} 内（可在插件配置的 exportDir 中修改）`)
          return
        }
        const cwd = requestedDir ?? allowedDir
        const transcript: DSchatTranscript | undefined = chatId === undefined ? undefined : store.getChat(chatId)
        if (transcript === undefined) {
          failure(res, 404, 'NOT_FOUND', '找不到该对话记录')
          return
        }
        try {
          const { filePath } = exportTranscriptFile({ transcript, cwd })
          writeJson(res, 200, { ok: true, filePath, dir: cwd })
        } catch (error) {
          failure(res, 500, 'INTERNAL', String(error))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/web-chats',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const web = await engine.listWebConversations()
        /*
         * "Missing" is decided by SESSION ID, not title. A title-only check
         * hid the conversations imported before this plugin stored ids (so
         * their truncated transcripts could never be refreshed), and it also
         * mis-reported two different conversations that share a title.
         */
        const imported = store.webSessionIds()
        const missing = web.filter(item => item.sessionId === undefined || !imported.has(item.sessionId))
        writeJson(res, 200, { ok: true, web, missing })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/recover',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req)
        const title = stringField(body, 'title')
        const sessionId = stringField(body, 'sessionId')
        if (title === undefined && sessionId === undefined) {
          failure(res, 400, 'BAD_REQUEST', '缺少 title 或 sessionId 字段')
          return
        }
        const result = await engine.recoverWebConversation({
          ...(title === undefined ? {} : { title }),
          ...(sessionId === undefined ? {} : { sessionId }),
        })
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      /*
       * Scraper diagnostics. Read-only and loopback-fenced like every other
       * route; it reports what the live page contains so a failed recover can
       * be diagnosed without a debugger attached.
       */
      kind: 'exact',
      path: '/api/dsh-dschat/probe-page',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        writeJson(res, 200, { ok: true, probe: await engine.probePage() })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/rename',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req)
        const chatId = stringField(body, 'chatId')
        const title = stringField(body, 'title')
        if (chatId === undefined || title === undefined) {
          failure(res, 400, 'BAD_REQUEST', '缺少 chatId 或 title 字段')
          return
        }
        const renamed = store.renameChat(chatId, title)
        if (renamed === undefined) failure(res, 404, 'NOT_FOUND', '找不到该对话记录')
        else writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/delete',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const body = await readJsonBody(req)
        const chatId = stringField(body, 'chatId')
        if (chatId === undefined) {
          failure(res, 400, 'BAD_REQUEST', '缺少 chatId 字段')
          return
        }
        const deleted = store.deleteChat(chatId)
        if (!deleted) failure(res, 404, 'NOT_FOUND', '找不到该对话记录')
        else writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/clear',
      handler: async (req, res) => {
        if (!guard(req, res, 'write')) return
        const count = store.clearAllChats()
        writeJson(res, 200, { ok: true, count })
      },
    },
  ]
}
