/**
 * The /api/dsh-dschat route family: engine state, browser login control,
 * chat operations (new chat / send / stop / switch model), transcript
 * export, and the harness transfer that seeds a new session with a web
 * transcript. Every route carries the same loopback-only trust fence the
 * dsh-ssh plugin uses — these endpoints drive a browser and create sessions,
 * so LAN-exposed deployments must not serve them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { DeepSeekWebEngine } from './engine/engine.ts'
import type { TranscriptStore } from './store.ts'
import type { DSchatTranscript } from './protocol.ts'
import { exportTranscriptFile, transferToHarnessSession } from './transfer.ts'
import type { DistillConfig } from './transfer.ts'

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

/** Pasted files are copied here so the engine has a real path to upload. */
const ATTACHMENT_DIR = 'attachments'

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
 * Extensions this route will write to disk when the media type says nothing.
 *
 * An allow-list rather than "whatever the caller put in the name": the name is
 * caller-controlled in principle (the route is loopback-only, but the file it
 * writes is handed straight to a browser's file input), and it is the only
 * thing stopping a nameless paste from landing as `.exe` or `.command`.
 * Everything here is plain text or a document the web page reads rather than
 * runs.
 */
const SAFE_EXTENSION = /^\.(png|jpg|jpeg|webp|gif|bmp|tiff|heic|svg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|markdown|csv|tsv|json|jsonl|log|xml|yaml|yml|htm|html|tex|rtf|srt|vtt|py|js|mjs|cjs|ts|tsx|jsx|java|c|h|cpp|hpp|cs|go|rs|rb|php|sh|sql|ini|toml|conf|cfg)$/

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

/** Loopback-only trust fence (mirrors dsh-ssh). */
function isLoopbackRequest(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  const address = req.socket.remoteAddress ?? ''
  const loopbackHost = host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]')
  const loopbackAddr = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address === undefined
  return loopbackHost && loopbackAddr
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
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

/** Build every /api/dsh-dschat route. */
export function makeRoutes(deps: DSchatRoutesDeps): WebRoute[] {
  const { ctx, engine, store, distill, hostContext, exportDir } = deps

  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (isLoopbackRequest(req)) return true
    writeJson(res, 403, { ok: false, error: 'loopback only' })
    return false
  }

  const stateView = async (): Promise<Record<string, unknown>> => {
    const status = await engine.status()
    return {
      ok: true,
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
      activeChatId: store.activeChat()?.id,
      chats: store.list(),
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
      kind: 'exact',
      path: '/api/dsh-dschat/open-login',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const result = await engine.openLoginWindow()
        writeJson(res, result.ok ? 200 : 500, { ok: result.ok, error: result.error })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/close-browser',
      handler: async (req, res) => {
        if (!guard(req, res)) return
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
        if (!guard(req, res)) return
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
          writeJson(res, 413, {
            ok: false,
            error: `撤销失败：对话数据无法读取（超过 ${Math.round(MAX_RESTORE_BODY_BYTES / (1024 * 1024))} MiB 或格式损坏），已保留当前内容。`,
          })
          return
        }
        const messages = Array.isArray(body['messages']) ? body['messages'] as DSchatTranscript['messages'] : []
        if (messages.length === 0) {
          writeJson(res, 400, { ok: false, error: '撤销失败：没有可恢复的消息。' })
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
          messages: [...messages],
        })
        writeJson(res, 200, { ok: true, chatId: result.chat.id, created: result.created })
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
        if (!guard(req, res)) return
        const body = await readJsonBody(req, MAX_ATTACHMENT_BODY_BYTES)
        const data = typeof body?.['data'] === 'string' ? body['data'] : ''
        if (data === '') {
          writeJson(res, 400, { ok: false, error: 'empty attachment body（文件数据为空或超过 24 MiB）' })
          return
        }
        const bytes = Buffer.from(data, 'base64')
        if (bytes.length === 0) {
          writeJson(res, 400, { ok: false, error: 'attachment is not valid base64' })
          return
        }
        const dir = join(store.dataDir, ATTACHMENT_DIR)
        try {
          mkdirSync(dir, { recursive: true })
          pruneAttachments(dir, referencedAttachments(store))
          const name = stringField(body, 'name') ?? 'pasted-file'
          const path = join(dir, `${randomUUID()}${attachmentExtension(stringField(body, 'mediaType') ?? '', name)}`)
          writeFileSync(path, bytes, { mode: 0o600 })
          writeJson(res, 200, { ok: true, path, bytes: bytes.length, name })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: `写入附件失败：${String(error)}` })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/new-chat',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const result = await engine.newChat()
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/send',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        const text = stringField(body, 'text')
        if (text === undefined) {
          writeJson(res, 400, { ok: false, error: '缺少 text 字段' })
          return
        }
        // GUI sends resolve immediately; the reply streams in the background
        // into the transcript and the panel polls /state for live updates.
        const images = Array.isArray(body?.['images'])
          ? (body['images'] as unknown[]).filter(value => typeof value === 'string').map(value => value as string)
          : undefined
        const result = await engine.send(text, false, images)
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/stop',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        await engine.stop()
        writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/deep-think',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        const enabled = typeof body?.['enabled'] === 'boolean' ? body['enabled'] : undefined
        if (enabled === undefined) {
          writeJson(res, 400, { ok: false, error: '缺少 enabled 字段' })
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
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        const enabled = typeof body?.['enabled'] === 'boolean' ? body['enabled'] : undefined
        if (enabled === undefined) {
          writeJson(res, 400, { ok: false, error: '缺少 enabled 字段' })
          return
        }
        const result = await engine.setSearch(enabled)
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/transfer',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        const chatId = stringField(body, 'chatId') ?? store.activeChat()?.id
        const cwd = stringField(body, 'cwd')
        const workspaceId = stringField(body, 'workspaceId')
        const targetSessionId = stringField(body, 'targetSessionId')
        const mode = body?.['mode'] === 'raw' ? 'raw' : body?.['mode'] === 'distill' ? 'distill' : undefined
        const transcript: DSchatTranscript | undefined = chatId === undefined ? undefined : store.getChat(chatId)
        if (transcript === undefined) {
          writeJson(res, 404, { ok: false, error: '找不到该对话记录' })
          return
        }
        try {
          const workspace = workspaceId === undefined ? undefined : { workspaceId }
          const { sessionId, distilled, attached, workspaceId: attachedWorkspaceId, duplicate } = await transferToHarnessSession(ctx, { transcript, cwd, workspace, targetSessionId }, distill, mode)
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
          writeJson(res, 500, { ok: false, error: String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/export',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        const chatId = stringField(body, 'chatId') ?? store.activeChat()?.id
        /*
         * The destination is the HOST's decision, not the panel's.
         *
         * It used to be `cwd` — the working directory of the most recent
         * harness session — which meant 「导出 markdown」 dropped the file into
         * whatever project happened to be open, a place the reader had no
         * reason to look. The default is now the download folder (see
         * `resolveExportDir`), and `cwd` is still honoured when a caller sends
         * one explicitly (the settings page's own "open folder" test, and any
         * script that wants the file next to its data).
         */
        const cwd = stringField(body, 'cwd') ?? exportDir()
        const transcript: DSchatTranscript | undefined = chatId === undefined ? undefined : store.getChat(chatId)
        if (transcript === undefined) {
          writeJson(res, 404, { ok: false, error: '找不到该对话记录' })
          return
        }
        try {
          const { filePath } = exportTranscriptFile({ transcript, cwd })
          writeJson(res, 200, { ok: true, filePath, dir: cwd })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: String(error) })
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
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        const title = stringField(body, 'title')
        const sessionId = stringField(body, 'sessionId')
        if (title === undefined && sessionId === undefined) {
          writeJson(res, 400, { ok: false, error: '缺少 title 或 sessionId 字段' })
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
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        const chatId = stringField(body, 'chatId')
        const title = stringField(body, 'title')
        if (chatId === undefined || title === undefined) {
          writeJson(res, 400, { ok: false, error: '缺少 chatId 或 title 字段' })
          return
        }
        const renamed = store.renameChat(chatId, title)
        if (renamed === undefined) writeJson(res, 404, { ok: false, error: '找不到该对话记录' })
        else writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/delete',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        const chatId = stringField(body, 'chatId')
        if (chatId === undefined) {
          writeJson(res, 400, { ok: false, error: '缺少 chatId 字段' })
          return
        }
        const deleted = store.deleteChat(chatId)
        if (!deleted) writeJson(res, 404, { ok: false, error: '找不到该对话记录' })
        else writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-dschat/clear',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const count = store.clearAllChats()
        writeJson(res, 200, { ok: true, count })
      },
    },
  ]
}
