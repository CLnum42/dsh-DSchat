/**
 * Browser-side API client for the /api/dsh-dschat route family. This is the
 * only data access path the panel uses — plain fetch, same origin, loopback
 * fenced on the host.
 */

import { DSCHAT_API, type TransferMode, type DSchatState, type DSchatTail, type WakeResult, type WebChatSummary } from '../protocol.ts'

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

async function request<T>(path: string, body?: unknown, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<EndpointResult<T>> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = (await response.json().catch(() => ({}))) as EndpointResult<T>
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
      return { ok: false, error: `请求超时（${Math.round(timeoutMs / 1000)} 秒）：${path}` } as EndpointResult<T>
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

  openLogin(): Promise<EndpointResult<ApiWakeResult>> {
    return request<ApiWakeResult>(DSCHAT_API.openLogin, undefined, TIMEOUT.login)
  }

  /**
   * "I want to type": start the web page in the mode that suits an existing
   * session, without assuming the visible login window is wanted.
   *
   * See `WakeResult`: `loginWindow` means a visible window is already open, so
   * the caller must not ask for one again.
   */
  wake(): Promise<EndpointResult<ApiWakeResult>> {
    return request<ApiWakeResult>(DSCHAT_API.wake, undefined, TIMEOUT.login)
  }

  closeBrowser(): Promise<EndpointResult<{ ok: boolean }>> {
    return request<{ ok: boolean }>(DSCHAT_API.closeBrowser, undefined, TIMEOUT.login)
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

  /** Persist pasted/dropped image bytes and get back a real path for the engine. */
  attach(input: { name: string; mediaType: string; data: string }): Promise<EndpointResult<{ ok: boolean; path?: string; bytes?: number }>> {
    return request<{ ok: boolean; path?: string; bytes?: number }>(DSCHAT_API.attach, input, TIMEOUT.attach)
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
   */
  send(text: string, images?: string[]): Promise<EndpointResult<{ ok: boolean; chatId?: string; stored?: boolean }>> {
    return request<{ ok: boolean; chatId?: string; stored?: boolean }>(DSCHAT_API.send, { text, images }, TIMEOUT.send)
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

  transfer(
    chatId: string,
    cwd?: string,
    mode?: TransferMode,
    workspaceId?: string,
    targetSessionId?: string,
  ): Promise<EndpointResult<ApiTransferResult>> {
    return request<ApiTransferResult>(DSCHAT_API.transfer, { chatId, cwd, mode, workspaceId, targetSessionId }, TIMEOUT.transfer)
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
}
