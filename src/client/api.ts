/**
 * Browser-side API client for the /api/dsh-dschat route family. This is the
 * only data access path the panel uses — plain fetch, same origin, loopback
 * fenced on the host.
 */

import { DSCHAT_API, type DSchatErrorCode, type TransferMode, type TransferPreview, type DSchatState, type DSchatTail, type WakeResult, type WebChatSummary } from '../protocol.ts'

/** Shape every /api/dsh-dschat response carries: ok plus optional error. */
interface ApiResult {
  ok: boolean
  error?: string
}

/**
 * The client's name for the wake/login reply.
 *
 * It mirrors `WakeResult` from the protocol rather than redeclaring the fields,
 * because the two halves are wired over one JSON body: a field added on the host
 * and forgotten here is a silent no-op on the panel.
 */
export type ApiWakeResult = WakeResult

/** Endpoint payloads always extend ApiResult. */
type EndpointResult<T> = T & ApiResult

/**
 * How long a route may take before this client stops waiting (ms).
 *
 * Without a deadline a single stuck host request hangs its caller forever, and
 * the panel's callers ARE the UI: `/state` is a sequential poll (the next tick
 * is only scheduled after this one resolves) and `/tail` drives the streaming
 * feed, so one unanswered request froze the transcript, the phase rail and the
 * live reply until the socket finally closed — the "面板卡住了，什么都
 * 不动" report. A timeout turns that into a visible, retryable failure.
 *
 * 30 s is the common case. The slow routes pass their own budget: a launch is
 * 45 s of page.goto, distillation is several sequential model calls.
 */
const REQUEST_TIMEOUT_MS = 30_000

/** Deadlines for the routes whose honest worst case is longer than the default. */
const TIMEOUT = {
  /** Cheap status reads — the polls the feed hangs off. */
  poll: 15_000,
  /** Submitting may launch a browser first (45 s goto + typing). */
  send: 120_000,
  /** Opening/relaunching the visible login window. */
  login: 180_000,
  /** Reading the web sidebar; a cold launch can precede it. */
  webList: 120_000,
  /** Distilling a transcript is several sequential model calls. */
  transfer: 300_000,
  /** Up to 24 MiB of base64 over the loopback socket. */
  attach: 60_000,
} as const

/**
 * The host's per-run CSRF token, echoed on every mutating request.
 *
 * Re-read whenever a response carries one (both `/state` and `/token` do), and
 * dropped when the host answers `code: 'CSRF'` — which is exactly what a host
 * restart looks like from here, since the token is per run. The single retry
 * below is what makes a restart invisible to the reader instead of a panel that
 * refuses every action until it is reloaded.
 */
let csrfToken = ''

/** Header the host expects the token in (see routes.ts). */
const CSRF_HEADER = 'x-dschat-token'

/** Remember a token from any response that carries one. */
function rememberToken(payload: unknown): void {
  const value = (payload as { csrfToken?: unknown } | undefined)?.csrfToken
  if (typeof value === 'string' && value !== '') csrfToken = value
}

/** One in-flight token fetch, so a burst of calls performs one handshake. */
let tokenInFlight: Promise<void> | undefined

/** Fetch the token, giving up quietly: the call it precedes reports its own failure. */
async function loadToken(): Promise<void> {
  if (tokenInFlight !== undefined) return tokenInFlight
  tokenInFlight = (async () => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(DSCHAT_API.token, { method: 'GET', signal: controller.signal })
      rememberToken(await response.json().catch(() => undefined))
    } catch {
      // Left empty on purpose: the mutating call that needed it answers with the
      // host's own 403, which the panel already knows how to show.
    } finally {
      window.clearTimeout(timer)
      tokenInFlight = undefined
    }
  })()
  return tokenInFlight
}

/**
 * One request to the plugin's own route family.
 *
 * `body === undefined` means a read (GET); anything else is a POST, which is
 * what every mutating route now requires — the panel never had a say in that,
 * and a GET that clears history is precisely what the fence exists to stop.
 *
 * @param retried - internal; guards the one retry after a CSRF rejection.
 */
async function request<T>(path: string, body?: unknown, timeoutMs: number = REQUEST_TIMEOUT_MS, retried = false): Promise<EndpointResult<T>> {
  const mutating = body !== undefined
  if (mutating && csrfToken === '') await loadToken()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {}
    if (mutating) {
      headers['content-type'] = 'application/json'
      if (csrfToken !== '') headers[CSRF_HEADER] = csrfToken
    }
    const response = await fetch(path, {
      method: mutating ? 'POST' : 'GET',
      headers: mutating ? headers : undefined,
      body: mutating ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const payload = (await response.json().catch(() => ({}))) as EndpointResult<T>
    /*
     * A stale token (a host restart, a rotated run) is answered once by
     * re-reading the token and repeating the call. Repeating is safe: the guard
     * rejected the request BEFORE its handler ran, so nothing executed twice.
     */
    if (!retried && response.status === 403 && (payload as { code?: unknown }).code === 'CSRF') {
      csrfToken = ''
      await loadToken()
      window.clearTimeout(timer)
      return request<T>(path, body, timeoutMs, true)
    }
    rememberToken(payload)
    if (!response.ok && payload.ok !== true) {
      return { ...payload, ok: false, error: payload.error ?? `HTTP ${response.status}` }
    }
    return payload
  } catch (error) {
    /*
     * An abort is OUR deadline, not a broken connection, and it is reported as a
     * plain failure so every caller's existing `ok !== true` path handles it
     * (a toast, a retry, or the next poll tick). Anything else still throws, as
     * before — a genuine network error is information the caller may want.
     */
    if (controller.signal.aborted) {
      /*
       * Punctuation only — never a language. This module has no translator (it
       * is also the transport the tests drive), and the sentence it used to
       * hardcode was Chinese, so an English reader got 「请求超时（30 秒）：/state」
       * in a toast. The numbers and the path are the whole information; callers
       * that want a sentence wrap it in their own localized copy.
       */
      return { ok: false, error: `timeout after ${Math.round(timeoutMs / 1000)}s: ${path}` } as EndpointResult<T>
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

/** Result of one transfer request (mirrors TransferResult). */
export interface ApiTransferResult {
  ok: boolean
  sessionId?: string
  distilled?: boolean
  attached?: boolean
  continued?: boolean
  /** True when the same handoff was already in the target session (a retry). */
  duplicate?: boolean
  workspaceId?: string
  filePath?: string
}

/** Result of one recover request (mirrors RecoverResult). */
export interface ApiRecoverResult {
  ok: boolean
  chatId?: string
  title?: string
  sessionId?: string
  created?: boolean
  updated?: boolean
  /** Messages the sync appended (see RecoverResult). */
  added?: number
  /** Stored messages completed from a longer web copy. */
  completed?: number
  /** Stored messages whose text the web copy replaced. */
  replaced?: number
  /** Stored messages the web copy does not have. */
  kept?: number
  messageCount?: number
  source?: string
}

export class DSchatApi {
  state(): Promise<EndpointResult<DSchatState>> {
    return request<DSchatState>(DSCHAT_API.state, undefined, TIMEOUT.poll)
  }

  /**
   * Streaming tail for one chat: the last reply as `local.slice(0, head) + tail`.
   *
   * `at` is the length of the copy the panel already holds, which is all the
   * host needs to decide between a delta and a full resend. Polled ~10×/s while
   * a turn is in flight — never call `/state` at that rate, it answers with the
   * entire transcript store.
   */
  tail(chatId: string | undefined, at: number): Promise<EndpointResult<DSchatTail>> {
    const query = new URLSearchParams()
    if (chatId !== undefined) query.set('chat', chatId)
    query.set('at', String(at))
    return request<DSchatTail>(`${DSCHAT_API.tail}?${query.toString()}`, undefined, TIMEOUT.poll)
  }

  /*
   * These three drive the browser, so they are POSTs now. They used to be GETs
   * with no body, which made them reachable by a plain `<img src=...>` from any
   * other page on this machine — opening a login window, waking a browser or
   * killing the user's session — with no line of the panel involved.
   */
  openLogin(): Promise<EndpointResult<ApiWakeResult>> {
    return request<ApiWakeResult>(DSCHAT_API.openLogin, {}, TIMEOUT.login)
  }

  /**
   * "I want to type": start the web page in the mode that suits an existing
   * session, without assuming the visible login window is wanted.
   *
   * See `WakeResult`: `loginWindow` means a visible window is already open, so
   * the caller must not ask for one again.
   */
  wake(): Promise<EndpointResult<ApiWakeResult>> {
    return request<ApiWakeResult>(DSCHAT_API.wake, {}, TIMEOUT.login)
  }

  closeBrowser(): Promise<EndpointResult<{ ok: boolean }>> {
    return request<{ ok: boolean }>(DSCHAT_API.closeBrowser, {}, TIMEOUT.login)
  }

  newChat(): Promise<EndpointResult<{ ok: boolean; chatId?: string }>> {
    return request<{ ok: boolean; chatId?: string }>(DSCHAT_API.newChat, {}, TIMEOUT.login)
  }

  /** Host facts: workspace list + the most recent session cwd. */
  context(): Promise<EndpointResult<{
    ok: boolean
    workspaces: Array<{ id: string; path: string; title: string }>
    cwd?: string
    settings?: {
      browserChannel: string
      browserExecutablePath: string
      browserProxy: string
      browserHeadless: boolean
      replyTimeoutMs: number
      dataDir: string
      profileDir: string
      exportDir: string
      transferDistill: boolean
      transferProvider: string
      transferModel: string
      announceToAgent: boolean
    }
  }>> {
    return request<{
      ok: boolean
      workspaces: Array<{ id: string; path: string; title: string }>
      cwd?: string
      settings?: {
        browserChannel: string
        browserExecutablePath: string
        browserProxy: string
        browserHeadless: boolean
        replyTimeoutMs: number
        dataDir: string
        profileDir: string
        exportDir: string
        transferDistill: boolean
        transferProvider: string
        transferModel: string
        announceToAgent: boolean
      }
    }>(DSCHAT_API.context, undefined, TIMEOUT.poll)
  }

  /**
   * Persist pasted/dropped bytes and get back a real path for the engine.
   *
   * `name` comes back as well, and that is not redundant: `path` is the stored
   * `${uuid}__${name}${ext}`, whose last segment is what the composer used to
   * print as the label. The bare name is what the chip shows.
   */
  attach(input: { name: string; mediaType: string; data: string }): Promise<EndpointResult<{ ok: boolean; path?: string; bytes?: number; name?: string }>> {
    return request<{ ok: boolean; path?: string; bytes?: number; name?: string }>(DSCHAT_API.attach, input, TIMEOUT.attach)
  }

  /**
   * The URL an attachment's bytes are served from.
   *
   * A plain string rather than a fetch, because it is the `src` of an `<img>`:
   * the browser's own image cache then does the work (the same thumbnail is not
   * re-read on every poll), and a missing file simply fails to load, which is
   * what `onError` would answer anyway.
   *
   * @param path - the absolute path `/attach` answered with.
   */
  attachmentUrl(path: string): string {
    return `${DSCHAT_API.attachment}?path=${encodeURIComponent(path)}`
  }

  /**
   * Undo a delete by re-importing the transcript the panel still holds.
   *
   * `webSessionId` travels with it so the host can match the original web
   * conversation by id; title matching (the fallback) is ambiguous, because
   * every chat starts out titled 「新的对话」.
   */
  restore(chat: { title: string; model: string; messages: unknown[]; webSessionId?: string }): Promise<EndpointResult<{ ok: boolean; chatId?: string; created?: boolean }>> {
    return request<{ ok: boolean; chatId?: string; created?: boolean }>(DSCHAT_API.restore, chat)
  }

  /**
   * Submit one message. `stored` on a failure means the user message DID reach
   * the transcript and only the reply never started — see SendResult.stored.
   *
   * `code` is carried through because `BUSY` is not an error the reader should
   * see: it means the previous turn was still running when this one arrived
   * (the panel's own snapshot lags the engine by up to a poll), and the panel
   * answers it by queueing the message instead of refusing it.
   */
  send(text: string, images?: string[]): Promise<EndpointResult<{ ok: boolean; chatId?: string; stored?: boolean; code?: DSchatErrorCode }>> {
    return request<{ ok: boolean; chatId?: string; stored?: boolean; code?: DSchatErrorCode }>(DSCHAT_API.send, { text, images }, TIMEOUT.send)
  }

  stop(): Promise<EndpointResult<{ ok: boolean }>> {
    return request<{ ok: boolean }>(DSCHAT_API.stop, {})
  }

  setDeepThink(enabled: boolean): Promise<EndpointResult<{ ok: boolean }>> {
    return request<{ ok: boolean }>(DSCHAT_API.deepThink, { enabled })
  }

  setSearch(enabled: boolean): Promise<EndpointResult<{ ok: boolean }>> {
    return request<{ ok: boolean }>(DSCHAT_API.search, { enabled })
  }

  /**
   * Ask what a transfer WOULD write, without writing anything.
   *
   * The whole point of the hand-off preview: distillation drops the reasoning
   * and every source link, and it can fail into a raw replay without saying so,
   * so the reader gets to see (and edit) the first message before a session
   * exists.
   */
  transferPreview(
    chatId: string,
    cwd?: string,
    mode?: TransferMode,
    workspaceId?: string,
    targetSessionId?: string,
  ): Promise<EndpointResult<TransferPreview>> {
    return request<TransferPreview>(DSCHAT_API.transferPreview, { chatId, cwd, mode, workspaceId, targetSessionId }, TIMEOUT.transfer)
  }

  /**
   * Write the hand-off.
   *
   * `seed` carries the text the reader confirmed (and possibly edited) together
   * with whether it came from a distillation, so the host writes those exact
   * bytes instead of distilling a second time.
   */
  transfer(
    chatId: string,
    cwd?: string,
    mode?: TransferMode,
    workspaceId?: string,
    targetSessionId?: string,
    seed?: { markdown: string; distilled: boolean },
  ): Promise<EndpointResult<ApiTransferResult>> {
    return request<ApiTransferResult>(DSCHAT_API.transfer, {
      chatId,
      cwd,
      mode,
      workspaceId,
      targetSessionId,
      ...(seed === undefined ? {} : { markdown: seed.markdown, distilled: seed.distilled }),
    }, TIMEOUT.transfer)
  }

  /**
   * Export one conversation to markdown.
   *
   * `cwd` is deliberately omitted by the panel: the host writes into its
   * configured export directory (the OS download folder by default) and reports
   * both the file name and the directory it landed in. The parameter stays for
   * callers that do want a specific target — a script, or a future 「导出到…」.
   */
  exportFile(chatId: string, cwd?: string): Promise<EndpointResult<{ ok: boolean; filePath?: string; dir?: string }>> {
    return request<{ ok: boolean; filePath?: string; dir?: string }>(DSCHAT_API.exportFile, { chatId, cwd })
  }

  renameChat(chatId: string, title: string): Promise<EndpointResult<{ ok: boolean }>> {
    return request<{ ok: boolean }>(DSCHAT_API.renameChat, { chatId, title })
  }

  deleteChat(chatId: string): Promise<EndpointResult<{ ok: boolean }>> {
    return request<{ ok: boolean }>(DSCHAT_API.deleteChat, { chatId })
  }

  clearChats(): Promise<EndpointResult<{ ok: boolean; count?: number }>> {
    return request<{ ok: boolean; count?: number }>(DSCHAT_API.clearChats, {})
  }

  /** Web-side conversations plus the ones missing from local storage. */
  webChats(): Promise<EndpointResult<{ ok: boolean; web: WebChatSummary[]; missing: WebChatSummary[] }>> {
    return request<{ ok: boolean; web: WebChatSummary[]; missing: WebChatSummary[] }>(DSCHAT_API.webChats, undefined, TIMEOUT.webList)
  }

  /**
   * Recover one web conversation. `sessionId` is preferred (titles repeat and
   * `hasText` matching is a substring match); `title` stays for links that
   * predate it.
   */
  recover(chat: { title?: string; sessionId?: string }): Promise<EndpointResult<ApiRecoverResult>> {
    return request<ApiRecoverResult>(DSCHAT_API.recover, chat, TIMEOUT.webList)
  }

  /**
   * What the live page actually contains, for a failed recover.
   *
   * The route has existed since the first release and was reachable only with
   * curl: a failed sync reported "页面可能已改版" and left the reader with nothing
   * to act on. It backs the status card's 「复制诊断」, which is where someone
   * reporting a problem can get the evidence in one click.
   */
  probePage(): Promise<EndpointResult<{ ok: boolean; probe?: Record<string, unknown> }>> {
    return request<{ ok: boolean; probe?: Record<string, unknown> }>(DSCHAT_API.probePage, undefined, TIMEOUT.webList)
  }
}
