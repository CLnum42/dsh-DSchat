/**
 * The DSchat panel — the whole center-column view, registered into the shell's
 * `main` slot under the key `dschat`.
 *
 * Everything here is a normal React tree inside a slot the shell allocates, so
 * nothing is injected into the DOM, no MutationObserver keeps a row alive, and
 * the Conversation column underneath is untouched (selecting DSchat switches
 * the center panel; the shell restores the Conversation when you leave).
 *
 * All data flows through /api/dsh-dschat routes. All copy flows through the
 * Client locale service. All colour flows through `--dsw-*` theme tokens.
 */

import {
  Fragment,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  mergeTail,
  phaseOf,
  sourcesOf,
  type DSchatMessage,
  type DSchatState,
  type DSchatTail,
  type DSchatTranscript,
  type TransferMode,
} from '../../protocol.ts'
import type { DSchatApi } from '../api.ts'
import {
  CaretIcon, ChatIcon, CheckIcon, ClipIcon, CloseIcon, CopyIcon, DeepThinkIcon, HistoryIcon, MoreIcon,
  PencilIcon, PlusIcon, QuoteIcon, RefreshIcon, SearchIcon,
  SendIcon, ThinkIcon, TrashIcon, WarnIcon, WebSearchIcon, WhaleMark,
} from '../icons.tsx'
import { touchEngineStatus, useEngineStatus } from '../status.ts'
import { Markdown, Thinking } from './Markdown.tsx'
import { firstLine, replyBody, thinkingBody } from './reply.ts'

/** Interpolate `{placeholder}`s in a localized template. */
function fmt(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`)
}

/**
 * True for a file the composer will try to attach.
 *
 * Anything but a directory counts: the page's own file input is the only
 * authority on what DeepSeek accepts (images, PDF, Office documents, txt, md…),
 * and it reports a rejection better than a hand-maintained list here could. A
 * client-side allow-list is what made "只有图片能拖进来" true — the drop handler
 * silently dropped every other file on the floor.
 */
function isAttachableFile(file: File): boolean {
  return file.size > 0
}

/**
 * One attachment cap, mirrored by MAX_ATTACHMENT_BODY_BYTES on the host route.
 *
 * The bytes travel base64-encoded (~4/3 on the wire) and are held in memory on
 * both sides, so this is deliberately below what the web page itself allows —
 * a file the page would accept but that turned the composer into a 200 MB
 * string would be worse than a clear refusal.
 */
const MAX_ATTACH_BYTES = 24 * 1024 * 1024

/** How many attachments one message may carry. */
const MAX_ATTACH_COUNT = 10

/** Human-readable cap for the refusal toast. */
const MAX_ATTACH_LABEL = '24 MB'

/** Best-effort file type for the host, which maps it to an on-disk extension. */
function genericMediaType(file: File): string {
  if (file.type !== '') return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.md')) return 'text/markdown'
  if (name.endsWith('.txt')) return 'text/plain'
  if (name.endsWith('.json')) return 'application/json'
  if (name.endsWith('.csv')) return 'text/csv'
  if (name.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

/**
 * Read one dropped/pasted file into the base64 the host route expects. The
 * browser hands us bytes; the engine needs a path, so the bytes go to the host
 * first (see /api/dsh-dschat/attach).
 *
 * Chunked because `String.fromCharCode(...bytes)` spreads one argument per byte
 * and blows the argument limit somewhere around 100 KB — a pasted screenshot is
 * already past it.
 */
async function fileToBase64(file: File): Promise<{ mediaType: string; data: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return { mediaType: genericMediaType(file), data: btoa(binary) }
}

/** One toast the panel is currently showing. */
interface Toast {
  id: number
  text: string
  error?: boolean
  /** Optional inline action (undo for deletes, open for a finished transfer). */
  action?: { label: string; run: () => void }
  /** Auto-dismiss deadline in ms. */
  ttl: number
}

/** How often the panel polls /state — the whole-store reconciliation snapshot. */
const POLL_IDLE_MS = 1_500
/**
 * How often the panel polls /tail while a reply is in flight.
 *
 * 100 ms is ~10 updates/s: comfortably past the point where the eye reads the
 * text as arriving continuously, and cheap because a tail response carries only
 * the characters that are new (see DSchatTail).
 */
const POLL_TAIL_MS = 100
/** How often the tail loop wakes while idle. It issues no request then, so this
 * only bounds how quickly a reply that starts mid-tick is noticed. */
const POLL_TAIL_IDLE_MS = 150

/**
 * Open one web link in the machine's own default browser.
 *
 * The panel used to route links into a browser column of its own (or into the
 * shell's right Sidebar, which refuses to open anything while a global main
 * panel like this one is on screen), so 「参考来源点开跑到系统浏览器去了」 was the
 * complaint when that column could not render. There is no column any more:
 * every http(s) link goes straight out, which is what the reader wanted and
 * what DeepSeek's own page does.
 *
 * `window.open` is the shell's own external-link path — the Electron main
 * process answers a window-open request with `shell.openExternal(url)` and
 * denies the popup — so this lands in the OS browser, new tab or not, with no
 * plugin-owned window to leak. Non-web schemes are refused here rather than
 * handed to the shell: a `mailto:` or a `dsh-resource:` URL is not a page.
 *
 * @param href - the link target as it appeared in the transcript.
 * @returns true when the click was taken (the anchor must then not navigate).
 */
export function openExternalLink(href: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(href)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  try {
    window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
    return true
  } catch {
    // A blocked `window.open` (a host that sandboxes the panel harder than the
    // desktop shell does) leaves the anchor to its own `target="_blank"`.
    return false
  }
}

/**
 * True when one composer keydown means "send this message".
 *
 * The IME clause is the whole point. A pinyin/Japanese/Korean input method uses
 * Enter to COMMIT the candidate it is showing, and Chromium reports that keydown
 * with `isComposing: true` — the same `key: 'Enter'` a real submit carries. The
 * composer used to test `key`/`shiftKey` alone, so pressing Enter to pick a
 * candidate sent the half-typed draft to the web model and cleared the box.
 *
 * The rule mirrors the host's own composer verbatim
 * (`event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing`),
 * so the panel and the shell behind it agree on what Enter means. `isComposing`
 * is read off the native event because that is where the DOM puts it; the
 * synthetic property is accepted too, for a React that starts proxying it.
 *
 * @param event - the keydown, structurally typed so the rule is testable alone.
 * @returns true when the caller should submit the draft.
 */
export function submitsOnEnter(event: {
  key: string
  shiftKey?: boolean
  isComposing?: boolean
  nativeEvent?: { isComposing?: boolean }
}): boolean {
  if (event.key !== 'Enter' || event.shiftKey === true) return false
  if (event.isComposing === true || event.nativeEvent?.isComposing === true) return false
  return true
}

/** Preset the rail width falls back to (px), matching the shipped stylesheet. */
const RAIL_WIDTH_DEFAULT = 238
/** How narrow the conversation list may be dragged (px). */
const RAIL_WIDTH_MIN = 170
/** How wide it may be dragged (px): past this the chat column stops being readable. */
const RAIL_WIDTH_MAX = 460

/**
 * Where the rail's width is remembered.
 *
 * `localStorage`, not the Host: this is layout state of one browser window, the
 * same way the shell remembers its own sidebar width. A storage failure
 * (private mode, a locked profile) leaves the panel fully usable — the rail
 * simply starts at its default width on the next reload.
 */
const RAIL_STORE = 'dsh-dschat.rail.width'

/**
 * Where the rail's open/closed state is remembered.
 *
 * `'0'` means collapsed; anything else (including nothing) means open, so a
 * reader who has never touched the toggle gets the conversation list. Same
 * storage rationale as the width: a window-level layout preference, and a
 * storage failure only costs the preference, never the panel.
 */
const RAIL_OPEN_STORE = 'dsh-dschat.rail.open'

/** Read one persisted string, or `undefined` when storage is unavailable. */
function readStored(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

/** Persist one string; a refusal is not worth interrupting the user for. */
function writeStored(key: string, value: string | undefined): void {
  try {
    if (value === undefined) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Layout memory only: losing it costs one drag after the next reload.
  }
}

/** Clamp a dragged rail width into the range the layout can survive. */
function clampRailWidth(value: number): number {
  if (!Number.isFinite(value)) return RAIL_WIDTH_DEFAULT
  return Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, Math.round(value)))
}

/** The persisted rail width, or the default when nothing usable is stored. */
function storedRailWidth(): number {
  const stored = readStored(RAIL_STORE)
  if (stored === undefined || stored === '') return RAIL_WIDTH_DEFAULT
  const parsed = Number(stored)
  return Number.isFinite(parsed) ? clampRailWidth(parsed) : RAIL_WIDTH_DEFAULT
}

/**
 * The reasoning row's summary line: 「已思考（用时 1 分 12 秒）」.
 *
 * Three states, in the order the reader meets them:
 *
 *   - still thinking (no duration yet, reply in flight) → 「思考中…」, so the row
 *     says what is happening rather than looking like a finished thought with a
 *     missing number;
 *   - measured → 「已思考（用时 …）」, from the engine's own timing of the turn;
 *   - remembered but unmeasurable (a transcript recovered from the web, whose
 *     history carries the reasoning text but no timing) → plain 「已思考」. A
 *     guessed duration would be worse than none.
 *
 * @param thinkingMs - the measured duration in ms, when there is one.
 * @param streaming - true while this reply is still arriving.
 * @param tr - locale accessor.
 */
export function thoughtLabel(
  thinkingMs: number | undefined,
  streaming: boolean,
  tr: (key: string, values?: Record<string, string>) => string,
): string {
  if (thinkingMs === undefined) return streaming ? tr('msg.thought.running') : tr('msg.thought')
  // Rounded, floored at one second: a sub-second thought reads as "1 秒" rather
  // than "0 秒", which looks like a measurement that failed.
  const seconds = Math.max(1, Math.round(thinkingMs / 1000))
  if (seconds < 60) return fmt(tr('msg.thought.seconds'), { seconds: String(seconds) })
  return fmt(tr('msg.thought.minutes'), {
    minutes: String(Math.floor(seconds / 60)),
    seconds: String(seconds % 60),
  })
}
/**
 * Keep tailing for this long after a send, even before `/state` has reported
 * `busy`. Covers the gap between submitting and the engine's first token, and
 * expires on its own so a send that failed cannot leave the loop polling.
 */
const TAIL_AFTER_SEND_MS = 8_000

/** One row of the shell's session list (`main`'s `useSessions` snapshot). */
interface HarnessSessionRow {
  sessionId: string
  updatedAt: number
  blank?: boolean
  running?: boolean
  agentAvailable?: boolean
  title?: string
  cwd?: string
}

/** The snapshot shape `useSessions` selects over. */
interface HarnessSessionList {
  byId: Record<string, HarnessSessionRow | undefined>
}

export interface DSchatPanelProps {
  /** Typed API client for the /api/dsh-dschat route family. */
  api: DSchatApi
  /** Locale accessor bound to this plugin's namespace. */
  tt: (key: string) => string
  /** Locale accessor the slot system provides when `locale` is declared. */
  t?: (key: string) => string
  /**
   * Navigate to a session (used right after a transfer).
   *
   * Resolves `false` when the shell could not take the navigation — the panel
   * then says so, because the failure mode of the old fire-and-forget call was
   * "the click did nothing" while the reader was left looking at the session
   * that happened to be open before.
   */
  openSession: (sessionId: string) => Promise<boolean>
  /** Host-native directory picker, for creating a target workspace. */
  pickDirectory: () => Promise<string | null>
  /** Create a workspace at a path. */
  createWorkspace: (path: string) => Promise<{ workspaceId: string; title: string }>
  /**
   * The shell's session-list selector, a `main`-slot standard prop.
   *
   * The append target must be a REAL harness session id. This picker used to
   * offer the plugin's own web-chat transcripts, so choosing one sent
   * `chat-…` to the host, which answered `SessionPersistenceNotFoundError:
   * session "chat-…" not found` — the "追加到已有会话" branch could never work.
   * Optional on purpose: a deployment that does not supply the prop keeps the
   * panel renderable, with the append option disabled instead of broken.
   */
  useSessions?: <T,>(selector: (list: HarnessSessionList) => T) => T
}

/**
 * React keys for one thread, guaranteed pairwise distinct.
 *
 * A key has to be unique among its siblings or React's reconciler loses track
 * of a child: on the next update it can leave that child's DOM node orphaned
 * in the parent instead of removing it, which is how an old answer ended up
 * rendered inside a brand-new empty chat.
 *
 * The store heals duplicate ids at load and import, so this normally returns
 * the ids untouched — and it stays id-based (rather than index-based) so a
 * message keeps its identity across streaming updates. It exists for the cases
 * the store cannot cover: a transcript that arrived through a path that did
 * not go through the repair, and a data file edited by hand. Suffixing only
 * the SECOND and later occurrence keeps every key stable while the list is
 * unchanged.
 *
 * @param messages - the chat's messages, in display order.
 * @returns one key per message, same length and order.
 */
export function threadKeys(messages: readonly { id: string }[]): string[] {
  const used = new Set<string>()
  return messages.map(message => {
    let key = message.id
    let suffix = 2
    while (used.has(key)) {
      key = `${message.id}#${suffix}`
      suffix += 1
    }
    used.add(key)
    return key
  })
}

export function DSchatPanel(props: DSchatPanelProps): ReactNode {
  const { api, tt, t, openSession, pickDirectory, createWorkspace, useSessions } = props
  const tr = useCallback(
    (key: string, values?: Record<string, string>): string => {
      const template = (t ?? tt)(key)
      return values === undefined ? template : fmt(template, values)
    },
    [t, tt],
  )

  const [state, setState] = useState<DSchatState | null>(null)
  const [viewChatId, setViewChatId] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [attachBusy, setAttachBusy] = useState(false)
  /**
   * True while `ensureReady` is bringing the web page up.
   *
   * The engine does report 'launching', but only on its next snapshot — up to
   * 1.5 s away, which is the whole click. This makes the composer say
   * 「正在启动网页端…」 on the same frame as the click that asked for it.
   */
  const [waking, setWaking] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [railWidth, setRailWidth] = useState<number>(() => storedRailWidth())
  const [railDragging, setRailDragging] = useState(false)
  const [railOpen, setRailOpen] = useState<boolean>(() => readStored(RAIL_OPEN_STORE) !== '0')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined)
  const [renameDraft, setRenameDraft] = useState('')
  const [clearArmed, setClearArmed] = useState(false)
  const [query, setQuery] = useState('')
  /** Set when the header's search button asks for the box; cleared once focused. */
  const [searchFocus, setSearchFocus] = useState(false)
  /**
   * The message a search result should land on, once the thread has rendered.
   *
   * A plain `scrollIntoView` in the click handler would run before React has
   * mounted the newly selected conversation, so the target has to survive the
   * render that swaps the transcript in — hence state plus a follow-up effect,
   * not an imperative scroll at call time.
   */
  const [jumpId, setJumpId] = useState<string | undefined>(undefined)
  /** The row currently wearing the search-landing mark (cleared on a timer). */
  const [flashId, setFlashId] = useState<string | undefined>(undefined)
  const [deepThink, setDeepThink] = useState(false)
  const [search, setSearch] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // transfer popover
  const [popOpen, setPopOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [transferMode, setTransferMode] = useState<TransferMode>('distill')
  const [transferTarget, setTransferTarget] = useState<'new' | 'continue'>('new')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string | undefined>(undefined)
  const [targetSessionId, setTargetSessionId] = useState<string | undefined>(undefined)
  const [stage, setStage] = useState(0)          // 0 idle, 1..3 running, 4 done
  const [transferring, setTransferring] = useState(false)
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; path: string; title: string }>>([])
  const [cwd, setCwd] = useState<string | undefined>(undefined)

  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  /** The hidden Finder input behind 上传文件 (clicked from the tool row). */
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  /**
   * The two popover wrappers (在 Harness 中继续, 「···」).
   *
   * Their containing boxes, so the outside-click rule can tell "a click inside
   * the menu" from "a click anywhere else" — see the dismiss effect.
   */
  const transferPopRef = useRef<HTMLDivElement | null>(null)
  const morePopRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)
  const prevChatRef = useRef<string | undefined>(undefined)
  const toastSeq = useRef(0)
  const deletedRef = useRef<Map<string, { chat: DSchatTranscript; index: number }>>(new Map())
  /**
   * Which attachments the composer already holds.
   *
   * A ref, not the state value: `uploadFiles` is a `useCallback` that must not
   * be rebuilt per attachment (a rebuilt handler mid-batch loses the count it
   * checked), and the cap has to be read at drop time, not at render time.
   */
  const imagesRef = useRef<string[]>([])
  useEffect(() => { imagesRef.current = images }, [images])

  /**
   * The rail width as the drag handler last set it.
   *
   * A ref as well as state because the pointer-up that PERSISTS the width runs
   * outside React's render cycle: reading the state there would capture the
   * value from the render the handler was created in — i.e. the width the drag
   * started at, which is the one width the user did not choose.
   */
  const railWidthRef = useRef(railWidth)

  /*
   * Streaming-feed plumbing.
   *
   * The tail loop must read the CURRENT snapshot without depending on it (a
   * `useEffect` keyed on `state` would tear the loop down ~10×/s), so the
   * snapshot is mirrored into a ref alongside the conversation it should
   * follow.
   */
  const stateRef = useRef<DSchatState | null>(null)
  const tailChatRef = useRef<string | undefined>(undefined)
  /** Epoch ms until which the loop keeps tailing regardless of `/state`. */
  const tailUntilRef = useRef(0)
  /** True once the current turn has been observed to start (see the poll loop). */
  const turnSeenRef = useRef(false)
  /**
   * Last time the tail loop fell back to a full `/state` (an unmergeable chat).
   * Throttles that fallback so it can never become a fast whole-store poll.
   */
  const lastReconcileRef = useRef(0)

  const toast = useCallback((text: string, options?: { error?: boolean; action?: Toast['action']; ttl?: number }): void => {
    const id = ++toastSeq.current
    const ttl = options?.ttl ?? (options?.action === undefined ? 3_200 : 6_500)
    setToasts(list => [...list, { id, text, error: options?.error, action: options?.action, ttl }])
    window.setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), ttl)
  }, [])

  // Mirror the snapshot for the tail loop (see the refs above).
  useEffect(() => { stateRef.current = state }, [state])

  /**
   * Say it once when the transcript store failed to load or save.
   *
   * The store quarantines an unreadable file and starts empty, which is the
   * right recovery — but silently, it is indistinguishable from "all my
   * conversations are gone". A toast (raised once per mount, guarded by a ref so
   * the 1.5 s poll cannot repeat it) is the difference between a rescue and a
   * disappearance.
   */
  const storeWarningShownRef = useRef(false)
  useEffect(() => {
    const warning = state?.storeWarning
    if (warning === undefined || storeWarningShownRef.current) return
    storeWarningShownRef.current = true
    toast(warning, { error: true, ttl: 15_000 })
  }, [state?.storeWarning, toast])

  /* ------------------------------------------------------------ data feed */

  /**
   * Fetch and apply the authoritative snapshot right now.
   *
   * Shared by the slow poll, the end of a turn and the two places a new chat
   * appears (creating one, and the feed naming a chat the panel has not seen).
   * With `/state` at its slow cadence those moments would otherwise wait up to
   * 1.5 s, which is exactly the pause that reads as "nothing happened".
   */
  const refreshState = useCallback(async (): Promise<void> => {
    try {
      const snapshot = await api.state()
      if (snapshot.ok !== true) return
      const next = snapshot as unknown as DSchatState
      setState(next)
      setViewChatId(previous => {
        if (previous !== undefined && next.chats.some(chat => chat.id === previous)) return previous
        return next.activeChatId ?? next.chats[0]?.id
      })
    } catch {
      // A transient failure keeps the previous snapshot on screen; the poll
      // loop retries on its own.
    }
  }, [api])

  // Poll /state for the authoritative, whole-store snapshot.
  //
  // This used to speed up to 600 ms while a reply streamed, which is what made
  // the output arrive in paragraphs: every one of those polls serializes the
  // ENTIRE transcript store (measured at 2,581,434 bytes / 108 chats on a real
  // history) to move a few dozen new characters, and the renderer then parses
  // all of it. Smooth streaming is now the tail poll's job, so this one stays
  // slow and honest: it is the reconciliation path, not the feed.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      if (cancelled) return
      await refreshState()
      if (cancelled) return
      timer = window.setTimeout(() => { void poll() }, POLL_IDLE_MS)
    }
    void poll()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [refreshState])

  /**
   * The streaming feed.
   *
   * Runs only while a turn is in flight — `stateRef`/`tailUntilRef` decide that
   * without re-subscribing the loop, so a reply that starts mid-poll is picked
   * up on the next 100 ms tick rather than at the next `/state`.
   *
   * Each response is applied as `content.slice(0, head) + tail`, which is the
   * whole protocol: an append costs the appended characters, and a full resend
   * (`head: 0`) heals a desync by construction.
   */
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const wanted = (): boolean =>
      stateRef.current?.busy === true
      || stateRef.current?.chats.some(chat => chat.streaming === true) === true
      || Date.now() < tailUntilRef.current

    /**
     * The length of the copy the panel holds for the message the host is about
     * to describe — its chat's LAST assistant message, the same rule the route
     * uses to pick one.
     *
     * Derived from the snapshot rather than tracked in a ref so a locally
     * dropped update can never desync it: no copy, no length, `at: 0`, and the
     * host answers with the whole body.
     */
    const localAt = (chatId: string | undefined): number => {
      const chat = stateRef.current?.chats.find(candidate => candidate.id === chatId)
      const last = [...(chat?.messages ?? [])].reverse().find(item => item.role === 'assistant')
      return last?.content.length ?? 0
    }

    const advance = (tail: DSchatTail): void => {
      setState(previous => (previous === null ? previous : mergeTail(previous, tail)))
    }

    const poll = async (): Promise<void> => {
      if (cancelled) return
      if (wanted()) {
        const chatId = tailChatRef.current
        // A chat the panel does not know about yet (a brand-new conversation, or
        // the first snapshot still in flight) cannot be merged into, so ask for
        // the full snapshot instead of dropping the reply on the floor — but at
        // the SLOW cadence: falling back to /state on a 100 ms loop would put
        // the 2.5 MB poll back on the hot path, which is the one thing this feed
        // exists to remove.
        if (chatId !== undefined && stateRef.current?.chats.some(chat => chat.id === chatId) !== true) {
          if (Date.now() - lastReconcileRef.current >= POLL_IDLE_MS) {
            lastReconcileRef.current = Date.now()
            void refreshState()
          }
        } else {
          try {
            const response = await api.tail(chatId, localAt(chatId))
            if (cancelled) return
            if (response.ok === true) {
              const tail = response as unknown as DSchatTail
              advance(tail)
              /*
               * End of turn detection.
               *
               * `busy: false` alone is not it: the panel arms the tail loop the
               * moment it submits, and the engine still has to type the message
               * and press Enter before its own `busy` flips — a response in that
               * window would otherwise be read as "the turn is already over",
               * stopping the feed just as the reply begins.
               *
               * So the turn has to be seen to start (busy, or the chat's own
               * streaming flag) before its end counts. That is also the moment to
               * hand back to /state, which carries the title rename and the
               * reordered sidebar this feed deliberately does not.
               */
              if (tail.busy === true || tail.streaming === true) turnSeenRef.current = true
              else if (turnSeenRef.current) {
                turnSeenRef.current = false
                tailUntilRef.current = 0
                void refreshState()
              }
            }
          } catch {
            // The next tick retries; the /state poll is still the safety net.
          }
        }
      }
      // Idle ticks are local-only (no request), so they cost a timer and a
      // couple of ref reads — cheap enough to keep the loop mounted.
      timer = window.setTimeout(() => { void poll() }, wanted() ? POLL_TAIL_MS : POLL_TAIL_IDLE_MS)
    }
    void poll()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [api, refreshState])

  // Host facts for the transfer/export targets (workspace list + recent cwd).
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const context = await api.context()
        if (cancelled || context.ok !== true) return
        setWorkspaces(context.workspaces ?? [])
        setCwd(context.cwd)
      } catch {
        // Targets simply stay empty; the transfer still works ungrouped.
      }
    }
    void load()
    return () => { cancelled = true }
  }, [api])

  // Mirror the page's toggle state whenever the server reports it.
  useEffect(() => {
    if (state === null) return
    setDeepThink(state.deepThink)
    setSearch(state.search)
  }, [state?.deepThink, state?.search])

  const busy = state?.busy ?? false
  // The panel switches to a new conversation the moment it is created; the
  // engine finishes leaving the previous web conversation on its queue. Sending
  // is safe either way (the send queues behind that work), so this only explains
  // the pause.
  const preparingNewChat = state?.preparingNewChat ?? false

  // Elapsed-time ticker, only while a turn is in flight.
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [busy])

  /* ------------------------------------------------------------ rail width */

  /**
   * The conversation list is user-sized, by dragging its right edge.
   *
   * A fixed 238px rail is wrong for both ends of this panel's use: a chat list
   * of 「DSH 插件槽位与 UI 集成方案」-length titles is unreadable there, and a
   * reader who only wants the transcript had no way to shrink it. The drag is a
   * window-level pointer dance (not a mouse-move on the handle) so the pointer
   * can leave the 6px strip — and the window — mid-drag without dropping it, and
   * the width is persisted on pointer-up rather than on every move: a drag emits
   * ~60 events/s and localStorage is synchronous.
   */
  const startRailDrag = useCallback((event: { button?: number; clientX: number; preventDefault: () => void }): void => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = railWidthRef.current
    let width = startWidth
    setRailDragging(true)
    const move = (moveEvent: PointerEvent): void => {
      width = clampRailWidth(startWidth + (moveEvent.clientX - startX))
      railWidthRef.current = width
      setRailWidth(width)
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      setRailDragging(false)
      writeStored(RAIL_STORE, String(width))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [])

  /** Keyboard equivalent of the drag: ← / → resize, Home restores the default. */
  const nudgeRail = useCallback((event: { key: string; preventDefault: () => void }): void => {
    const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
    if (step === 0 && event.key !== 'Home') return
    event.preventDefault()
    const width = event.key === 'Home' ? RAIL_WIDTH_DEFAULT : clampRailWidth(railWidthRef.current + step)
    railWidthRef.current = width
    setRailWidth(width)
    writeStored(RAIL_STORE, String(width))
  }, [])

  /* --------------------------------------------------- rail + header controls */

  /** Show/hide the conversation column, remembering the choice. */
  const toggleRail = useCallback((): void => {
    setRailOpen(previous => {
      const next = !previous
      writeStored(RAIL_OPEN_STORE, next ? '1' : '0')
      return next
    })
  }, [])

  /**
   * Open the conversation-list search.
   *
   * A collapsed rail has to come back first, and the focus has to wait for that
   * render: the input does not exist in the document yet, so focusing it in the
   * same tick is a no-op and the click would look like it did nothing. The
   * follow-up effect owns the actual focus.
   */
  const openSearch = useCallback((): void => {
    if (railOpen) {
      setSearchFocus(true)
      return
    }
    setRailOpen(true)
    writeStored(RAIL_OPEN_STORE, '1')
    setSearchFocus(true)
  }, [railOpen])

  /** Focus the search box once it is on screen (and clear the request). */
  useEffect(() => {
    if (!searchFocus || !railOpen) return
    const element = searchRef.current
    if (element === null) return
    element.focus()
    element.select()
    setSearchFocus(false)
  }, [searchFocus, railOpen])

  /**
   * True while a search is worth showing as "active" in the header: the box has
   * a query in it, so the control lights up for the same reason the web app's
   * does — the panel is in a mode the reader turned on.
   */
  const searchOpen = query !== '' || searchFocus

  /* ------------------------------------------------------------ composer size */

  /**
   * The tallest the composer may grow before it scrolls internally (px).
   *
   * Mirrors `max-height` in styles.ts; the two must agree or the clamped height
   * and the stylesheet's own cap fight each other.
   */
  const COMPOSER_MAX_HEIGHT = 180

  /**
   * Grow the composer with its content, up to the cap.
   *
   * A `rows={1}` textarea with a fixed min-height shows ~2 lines and scrolls
   * everything else out of sight, so a long prompt was written through a slit —
   * and the stylesheet's `max-height: 180px` was dead code, because nothing ever
   * changed the element's height. Measuring `scrollHeight` is the only reliable
   * way to do it, and the height must be reset to `auto` first: measuring on top
   * of the previous (larger) height can never shrink the box back.
   */
  const resizeComposer = useCallback((): void => {
    const input = inputRef.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }, [])

  // On every draft change — typing, paste, or a 引用/编辑 action filling the box.
  useEffect(() => { resizeComposer() }, [draft, resizeComposer])

  const chats = state?.chats ?? []
  const viewChat = chats.find(chat => chat.id === viewChatId) ?? chats[0]
  const phase = state === null
    ? 'stopped'
    : phaseOf({ engine: state.engine, loggedIn: state.loggedIn, busy: state.busy, chats: state.chats })
  const loggedIn = state?.loggedIn ?? null
  /*
   * The header's whale mark: the engine status lives in a module store because
   * the mark is the ONE part of this header that has to keep telling the truth
   * while the panel itself is unmounted (see ../status.ts). The panel is the
   * authority on it — it polls — so every new snapshot is published here, and
   * the mark's colour, its tooltip and its click all read the same value.
   */
  useEffect(() => { if (state !== null) touchEngineStatus(state) }, [state])
  const engine = useEngineStatus(tr)
  /*
   * A browser that is up (or coming up). 'stopped' with loggedIn true means a
   * live session whose browser was closed explicitly, so the placeholder should
   * say "start it" rather than "sign in" — the profile is still authenticated.
   */
  const engineLive = phase === 'ready' || phase === 'thinking' || phase === 'streaming' || phase === 'launching'
  const streaming = viewChat?.streaming ?? false
  const canSend = loggedIn === true && !busy

  const filtered = useMemo(() => {
    if (query.trim() === '') return chats
    const needle = query.trim().toLowerCase()
    return chats.filter(chat =>
      chat.title.toLowerCase().includes(needle)
      || chat.messages.some(message => message.content.toLowerCase().includes(needle)))
  }, [chats, query])

  /*
   * The append-to-existing-session targets, read from the shell's own session
   * list. `useSessions` is a hook, so it is called in one fixed position (the
   * whole-state selector keeps the returned reference stable across renders).
   *
   * `agentAvailable !== true` is the "cold" test that matters here: the host
   * appends through the persistence write handle, and a session whose agent is
   * live already holds that writer, so offering it would only produce a
   * refusal. Cold sessions are exactly the ones that accept the append and
   * then resume with the brief as their next input.
   */
  const harnessList = useSessions === undefined ? undefined : useSessions(state => state)
  const continuationTargets = useMemo(() => {
    const byId = harnessList?.byId ?? {}
    return Object.values(byId)
      .filter((row): row is HarnessSessionRow => row !== undefined && row.agentAvailable !== true)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(row => ({ id: row.sessionId, title: row.title ?? row.cwd ?? row.sessionId }))
  }, [harnessList])
  /** The append target the next transfer would use (the picker's current value). */
  const continueTargetId = continuationTargets.some(target => target.id === targetSessionId)
    ? targetSessionId
    : continuationTargets[0]?.id

  /* ------------------------------------------------------------ auto-scroll */

  // Point the tail feed at the conversation actually on screen (`viewChat`
  // falls back to the newest chat, so it — not the raw id — is the truth).
  useEffect(() => { tailChatRef.current = viewChat?.id }, [viewChat?.id])

  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    /*
     * A search jump outranks "keep the newest line visible": the reader asked
     * for a specific message, and the pin would immediately undo the scroll.
     * The target is cleared straight away so the next tick's auto-scroll (and
     * the next streamed token) behaves normally again.
     */
    if (jumpId !== undefined) {
      const target = list.querySelector(`[data-message-id="${jumpId}"]`)
      if (target !== null) {
        pinnedRef.current = false
        target.scrollIntoView({ block: 'center' })
        // A landing mark, so the reader can see WHICH row the search found
        // rather than guessing from the scroll position. Fades on its own; see
        // the `.dsh-dschat-msg-jump` rule.
        setFlashId(jumpId)
      }
      setJumpId(undefined)
      return
    }
    const switched = prevChatRef.current !== viewChatId
    prevChatRef.current = viewChatId
    if (switched || pinnedRef.current) list.scrollTop = list.scrollHeight
  }, [state, viewChatId, jumpId])

  const onThreadScroll = useCallback((): void => {
    const list = listRef.current
    if (list === null) return
    pinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 96
  }, [])

  /**
   * Retire the search-landing mark.
   *
   * It exists to answer "which one did you find?" for as long as it takes to
   * look, so it fades out on a timer rather than on the next click: a highlight
   * that waits for the reader to dismiss it is one more thing to dismiss. The
   * timer is re-armed per id, so clicking a second result restarts the clock
   * instead of inheriting the first one's remaining time.
   */
  useEffect(() => {
    if (flashId === undefined) return
    const timer = window.setTimeout(() => setFlashId(undefined), 1_800)
    return () => window.clearTimeout(timer)
  }, [flashId])

  /* ------------------------------------------------------------ operations */

  /**
   * Bring the web page up because the reader wants to type — and only ask for
   * the visible login window when it is genuinely needed.
   *
   * This replaces the old "focus ⇒ openLogin()" shortcut, which is what made a
   * single click cost two browser launches. `openLogin` always disposes and
   * relaunches a HEADED window, so on a profile that is already authenticated
   * (the normal case — the session lives in the persistent browser profile) it
   * opened a window it did not need, the login watcher saw the session and
   * closed that window again, and the next send had no page left to use and
   * launched a second, headless browser to do the actual work.
   *
   * Now: wake (reuse the page if there is one, otherwise launch ONCE in the mode
   * the profile deserves) → escalate to the login window only on a sign-in page.
   * The engine coalesces concurrent launches; this ref coalesces the panel's own
   * requests, so clicking around the card cannot queue a wake per click.
   */
  const wakeRef = useRef<Promise<boolean> | null>(null)
  const ensureReady = useCallback(async (): Promise<boolean> => {
    if (wakeRef.current !== null) return await wakeRef.current
    const task = (async (): Promise<boolean> => {
      setWaking(true)
      try {
        const woken = await api.wake().catch(() => undefined)
        if (woken === undefined) return false
        if (woken.ok !== true) {
          /*
           * A host that predates `/wake` answers 404 — and that pairing is REAL,
           * not hypothetical: the two halves are installed together but loaded
           * independently (the browser half is fetched from disk, the host half
           * is a module generation that only a Harness restart replaces), so a
           * page refresh after an upgrade meets exactly this. Falling back to
           * the login route keeps the composer working; on a matching host the
           * wake answers and this branch never runs.
           */
          if (/HTTP 404/.test(woken.error ?? '')) {
            await api.openLogin().catch(() => undefined)
            return false
          }
          toast(woken.error ?? tr('toast.wake.failed'), { error: true })
          return false
        }
        if (woken.loggedIn === true) return true
        /*
         * Up, but on the sign-in screen. `loginWindow` already true means the
         * wake itself opened the visible window (a profile with no history at
         * all goes straight there) — asking again would dispose that fresh
         * window and open a second one.
         */
        if (woken.loginWindow !== true) {
          const opened = await api.openLogin().catch(() => undefined)
          if (opened !== undefined && opened.ok !== true && opened.error !== undefined) {
            toast(opened.error, { error: true })
            return false
          }
        }
        return false
      } finally {
        setWaking(false)
        // Flip the composer to editable NOW. The 1.5 s snapshot poll would get
        // there on its own, but that lag is exactly the pause that reads as
        // "the click did nothing".
        void refreshState()
      }
    })()
    wakeRef.current = task
    try {
      return await task
    } finally {
      wakeRef.current = null
    }
  }, [api, toast, tr, refreshState])

  /**
   * Retry a failed exchange: resend the last user message the web session
   * actually received.
   *
   * Declared BEFORE `send` because a failed send that DID record the message
   * offers this as its toast action, and the dependency array of `send` would
   * otherwise read this binding while it is still in its temporal dead zone.
   */
  const retry = useCallback(async (): Promise<void> => {
    const chat = chats.find(item => item.id === viewChatId) ?? chats[0]
    if (chat === undefined || busy) return
    const lastUser = [...chat.messages].reverse().find(message => message.role === 'user')
    if (lastUser === undefined) return
    pinnedRef.current = true
    tailUntilRef.current = Date.now() + TAIL_AFTER_SEND_MS
    const result = await api.send(lastUser.content, lastUser.attachments).catch(() => undefined)
    if (result !== undefined && result.ok !== true) toast(result.error ?? '', { error: true })
    else void refreshState()
  }, [chats, viewChatId, busy, api, toast, refreshState])

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' && images.length === 0) return
    if (busy) return
    /*
     * Enter on a composer whose engine is down used to be a silent no-op: the
     * message stayed in the box and nothing explained why. The reader's intent
     * is unambiguous (they wrote a message and pressed Enter), so wake the
     * engine first and only refuse if there is genuinely nobody logged in — the
     * draft is left in place either way.
     */
    if (loggedIn !== true && !await ensureReady()) {
      toast(tr('toast.send.needLogin'), { error: true })
      return
    }
    setDraft('')
    const sentImages = images
    setImages([])
    pinnedRef.current = true
    // Start tailing now rather than when /state next reports busy: the gap
    // between Enter and the first token is exactly when a stalled panel looks
    // broken. The deadline expires on its own, so a send that fails cannot
    // leave the loop polling.
    tailUntilRef.current = Date.now() + TAIL_AFTER_SEND_MS
    try {
      const result = await api.send(text, sentImages.length > 0 ? sentImages : undefined)
      if (result.ok !== true) {
        /*
         * A send that failed must not eat the message.
         *
         * The composer is cleared BEFORE the request (a message that is already
         * on its way must not still be editable in the box), so every failure
         * has to put the text back — otherwise a logged-out engine, a browser
         * that would not start or a rejected attach silently costs the reader a
         * paragraph they just wrote.
         *
         * `stored` decides WHICH repair is right. When the engine already
         * appended the user message (it is in the transcript, only the reply
         * never started) putting the text back would duplicate it on the next
         * send, so the toast offers 「重试」 instead — the same action the
         * message row would carry. Nothing is overwritten if the reader has
         * already started typing something else.
         */
        if (result.stored === true) {
          toast(result.error ?? tr('toast.send.failed'), {
            error: true,
            action: { label: tr('msg.retry'), run: () => { void retry() } },
          })
        } else {
          setDraft(current => (current === '' ? text : current))
          if (sentImages.length > 0) setImages(current => (current.length === 0 ? sentImages : current))
          toast(result.error ?? tr('toast.send.failed'), { error: true })
        }
      } else if (result.chatId !== undefined) {
        setViewChatId(result.chatId)
      }
      // The first exchange pins the chat's title and the user message is already
      // stored, so pull the snapshot now instead of waiting out the slow poll.
      void refreshState()
    } catch (error) {
      setDraft(current => (current === '' ? text : current))
      if (sentImages.length > 0) setImages(current => (current.length === 0 ? sentImages : current))
      toast(String(error), { error: true })
    }
  }, [draft, images, busy, loggedIn, api, toast, tr, refreshState, retry, ensureReady])

  const stop = useCallback(async (): Promise<void> => {
    await api.stop().catch(() => undefined)
  }, [api])

  const newChat = useCallback(async (): Promise<void> => {
    try {
      const result = await api.newChat()
      if (result.ok === true && result.chatId !== undefined) {
        setViewChatId(result.chatId)
        pinnedRef.current = true
        // The new transcript exists immediately, but the panel's copy of the
        // chat list only learns about it from a snapshot — and `viewChat` falls
        // back to the newest KNOWN chat until then, which looks like the click
        // did nothing.
        void refreshState()
      } else toast(result.error ?? 'new chat failed', { error: true })
    } catch (error) {
      toast(String(error), { error: true })
    }
  }, [api, toast, refreshState])

  const toggleDeepThink = useCallback(async (): Promise<void> => {
    const next = !deepThink
    setDeepThink(next)
    const result = await api.setDeepThink(next).catch(() => undefined)
    if (result !== undefined && result.ok !== true) {
      setDeepThink(!next)
      toast(result.error ?? 'toggle failed', { error: true })
    }
  }, [deepThink, api, toast])

  const toggleSearch = useCallback(async (): Promise<void> => {
    const next = !search
    setSearch(next)
    const result = await api.setSearch(next).catch(() => undefined)
    if (result !== undefined && result.ok !== true) {
      setSearch(!next)
      toast(result.error ?? 'toggle failed', { error: true })
    }
  }, [search, api, toast])

  const openLogin = useCallback(async (): Promise<void> => {
    const result = await api.openLogin().catch(() => undefined)
    if (result !== undefined && result.ok !== true) toast(result.error ?? 'open login failed', { error: true })
  }, [api, toast])

  const copyText = useCallback(async (text: string, message: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      toast(message)
    } catch {
      toast(message)
    }
  }, [toast])

  const removeChat = useCallback(async (chat: DSchatTranscript): Promise<void> => {
    const index = chats.findIndex(item => item.id === chat.id)
    const result = await api.deleteChat(chat.id).catch(() => undefined)
    if (result !== undefined && result.ok !== true) {
      toast(tr('toast.delete.failed', { error: result.error ?? '' }), { error: true })
      return
    }
    deletedRef.current.set(chat.id, { chat, index })
    toast(tr('toast.delete.done', { title: chat.title }), {
      action: {
        label: tr('toast.undo'),
        run: () => {
          const entry = deletedRef.current.get(chat.id)
          if (entry === undefined) return
          deletedRef.current.delete(chat.id)
          void api.restore({
            title: entry.chat.title,
            model: entry.chat.model,
            // Carried through so the restored transcript re-attaches to the
            // same web conversation: without it the host can only match on the
            // title, and two conversations can share one (every new chat is
            // 「新的对话」 until its first exchange).
            ...(entry.chat.webSessionId === undefined ? {} : { webSessionId: entry.chat.webSessionId }),
            messages: entry.chat.messages as unknown[],
          }).then(restored => {
            if (restored.ok !== true) {
              // The entry is put BACK: a failed undo must not also lose the only
              // copy of the conversation still on this side of the wire.
              deletedRef.current.set(chat.id, entry)
              toast(tr('toast.delete.failed', { error: restored.error ?? '' }), { error: true })
              return
            }
            toast(tr('toast.restored'))
            if (restored.chatId !== undefined) setViewChatId(restored.chatId)
            void refreshState()
          })
        },
      },
    })
  }, [api, chats, toast, tr, refreshState])

  const clearAll = useCallback(async (): Promise<void> => {
    if (!clearArmed) {
      setClearArmed(true)
      window.setTimeout(() => setClearArmed(false), 3_000)
      return
    }
    setClearArmed(false)
    const result = await api.clearChats().catch(() => undefined)
    if (result !== undefined && result.ok !== true) toast(tr('toast.clear.failed', { error: result.error ?? '' }), { error: true })
    else toast(tr('toast.clear.done'))
  }, [clearArmed, api, toast, tr])

  const recover = useCallback(async (): Promise<void> => {
    const listed = await api.webChats().catch(() => undefined)
    if (listed === undefined || listed.ok !== true) {
      toast(listed?.error ?? 'recover failed', { error: true })
      return
    }
    if (listed.missing.length === 0) {
      toast(tr('toast.recover.empty'))
      return
    }
    /*
     * Recovering is a read per conversation (the page's own history endpoint),
     * so the old one-toast-per-title stream is replaced by one progress toast
     * plus one summary. A conversation that already had a short transcript is
     * refreshed in place rather than skipped, which is what makes a second
     * click able to repair an earlier incomplete import.
     */
    const total = listed.missing.length
    let done = 0
    let recovered = 0
    let refreshed = 0
    let messages = 0
    let lastProgressAt = 0
    const failures: string[] = []
    for (const item of listed.missing) {
      done += 1
      /*
       * Toasts stack, and a first sync walks every conversation on the account
       * (~150ms each), so the progress line is rate-limited to about one per
       * second instead of one per conversation.
       */
      const now = Date.now()
      if (done === total || now - lastProgressAt >= 900) {
        lastProgressAt = now
        toast(tr('toast.recover.progress', { done: String(done), total: String(total), title: item.title }), { ttl: 2_600 })
      }
      const result = await api.recover({
        title: item.title,
        ...(item.sessionId === undefined ? {} : { sessionId: item.sessionId }),
      }).catch(() => undefined)
      if (result === undefined || result.ok !== true) {
        failures.push(`${item.title}：${result?.error ?? '未知错误'}`)
        continue
      }
      recovered += 1
      if (result.updated === true) refreshed += 1
      messages += result.messageCount ?? 0
    }
    toast(tr('toast.recover.summary', {
      count: String(recovered),
      total: String(total),
      messages: String(messages),
      refreshed: String(refreshed),
    }))
    if (failures.length > 0) {
      toast(tr('toast.recover.failed', { list: failures.slice(0, 3).join('；') }), { error: true, ttl: 12_000 })
    }
  }, [api, toast, tr])

  const commitRename = useCallback(async (chat: DSchatTranscript): Promise<void> => {
    const title = renameDraft.trim().replace(/\s+/g, ' ')
    setRenamingId(undefined)
    if (title === '' || title === chat.title) return
    const result = await api.renameChat(chat.id, title).catch(() => undefined)
    if (result !== undefined && result.ok !== true) toast(tr('toast.rename.failed', { error: result.error ?? '' }), { error: true })
    else toast(tr('toast.rename.done'))
  }, [renameDraft, api, toast, tr])

  const exportFile = useCallback(async (): Promise<void> => {
    if (viewChat === undefined) return
    /*
     * No cwd: the destination is the host's setting (the download folder by
     * default), not whatever project the last harness session had open. The
     * toast then names the file AND the folder, because "已导出到 dschat-….md"
     * told the reader nothing about where to find it — the exact complaint that
     * moved the default into 下载.
     */
    const result = await api.exportFile(viewChat.id).catch(() => undefined)
    if (result === undefined || result.ok !== true || result.filePath === undefined) {
      toast(tr('toast.export.failed', { error: result?.error ?? '' }), { error: true })
      return
    }
    toast(tr('toast.export.done', {
      file: result.dir === undefined ? result.filePath : `${result.dir}/${result.filePath}`,
    }))
  }, [viewChat, api, toast, tr])

  const runTransfer = useCallback(async (): Promise<void> => {
    if (viewChat === undefined || transferring) return
    setTransferring(true)
    setStage(1)
    try {
      const result = await api.transfer(
        viewChat.id,
        cwd,
        transferMode,
        transferTarget === 'new' ? targetWorkspaceId : undefined,
        transferTarget === 'continue' ? continueTargetId : undefined,
      )
      if (result.ok !== true || result.sessionId === undefined) {
        setStage(0)
        toast(tr('toast.transfer.failed', { error: result.error ?? '' }), {
          error: true,
          action: { label: tr('toast.transfer.retry'), run: () => { void runTransfer() } },
        })
        return
      }
      const sessionId = result.sessionId
      setStage(result.continued === true ? 2 : 3)
      if (result.duplicate === true) toast(tr('toast.transfer.duplicate'))
      else if (result.continued === true) toast(tr('toast.transfer.continued'))
      else toast(tr('toast.transfer.done'), { action: { label: tr('toast.open'), run: () => { void openSession(sessionId) } } })
      /*
       * Land the user in the session they just created — the whole point of the
       * hand-off is that no further navigation is needed.
       *
       * And if the shell cannot take it (the Client list has not learned the new
       * row), SAY SO. The old fire-and-forget call swallowed that failure, so a
       * transfer left the reader sitting in the previous session, reading its
       * previous brief, with nothing to explain why.
       */
      void (async () => {
        // `await undefined` (a deployment whose face returns nothing) is not a
        // failure — only an explicit `false` is, so the toast cannot cry wolf.
        const opened = await Promise.resolve(openSession(sessionId)).catch(() => false)
        if (opened === false) toast(tr('toast.open.failed'), { error: true })
      })()
      window.setTimeout(() => { setPopOpen(false); setStage(0) }, 600)
    } catch (error) {
      setStage(0)
      toast(tr('toast.transfer.failed', { error: String(error) }), { error: true })
    } finally {
      setTransferring(false)
    }
  }, [viewChat, transferring, api, cwd, transferMode, transferTarget, targetWorkspaceId, continueTargetId, openSession, toast, tr])

  const createTargetWorkspace = useCallback(async (): Promise<void> => {
    try {
      const path = await pickDirectory()
      if (path === null || path === '') return
      const created = await createWorkspace(path)
      setTargetWorkspaceId(created.workspaceId)
      setWorkspaces(list => [...list, { id: created.workspaceId, path, title: created.title }])
      toast(tr('toast.workspace.created', { title: created.title }))
    } catch (error) {
      toast(tr('toast.workspace.failed', { error: String(error) }), { error: true })
    }
  }, [pickDirectory, createWorkspace, toast, tr])

  /* ------------------------------------------------------------ popovers */

  /*
   * A popover closes when the pointer goes down outside it, or on Escape.
   *
   * Both menus used to be closable ONLY by pressing their own trigger again —
   * there was no dismiss path at all. That is a trap the moment the reader
   * wants the panel behind the menu (they click the conversation, the text
   * disappears under a menu that stays), and it is the first thing anyone tries.
   *
   * `pointerdown` in the CAPTURE phase, so the menu is already gone before the
   * click it started lands on whatever is underneath — a click on a conversation
   * row both dismisses the menu and does what it looks like it does. A
   * pointerdown inside either wrapper is left alone; the trigger's own onClick
   * still toggles it, so pressing the trigger twice does not double-toggle.
   */
  useEffect(() => {
    if (!popOpen && !moreOpen) return
    const onDown = (event: Event): void => {
      const target = event.target as Node | null
      if (popOpen && transferPopRef.current?.contains(target) !== true) setPopOpen(false)
      if (moreOpen && morePopRef.current?.contains(target) !== true) setMoreOpen(false)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (popOpen) setPopOpen(false)
      if (moreOpen) setMoreOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onEscape)
    }
  }, [popOpen, moreOpen])

  /* ------------------------------------------------------------ shortcuts */

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (meta && event.key === '/') {
        event.preventDefault()
        inputRef.current?.focus()
        return
      }
      if (event.key === 'Escape' && state?.busy === true) void stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state?.busy, stop])

  /**
   * Attach dropped/pasted files. The host persists the bytes and returns a real
   * path, so the user never types one.
   *
   * Every refusal is per-file and says WHY (too big, too many, host rejected
   * it). Uploading is slow enough for a 20 MB PDF that a silent no-op would
   * read as "拖进来没反应" — which is exactly how the old image-only filter
   * felt for every non-image file.
   */
  const uploadFiles = useCallback(async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    const room = Math.max(0, MAX_ATTACH_COUNT - imagesRef.current.length)
    if (room === 0) {
      toast(tr('toast.attach.tooMany', { limit: String(MAX_ATTACH_COUNT) }), { error: true })
      return
    }
    let batch = files
    if (files.length > room) {
      toast(tr('toast.attach.tooMany', { limit: String(MAX_ATTACH_COUNT) }), { error: true })
      batch = files.slice(0, room)
    }
    setAttachBusy(true)
    try {
      for (const file of batch) {
        if (file.size > MAX_ATTACH_BYTES) {
          toast(tr('toast.attach.tooBig', { name: file.name === '' ? 'file' : file.name, limit: MAX_ATTACH_LABEL }), { error: true })
          continue
        }
        const payload = await fileToBase64(file)
        const result = await api.attach({
          name: file.name === '' ? 'pasted-file' : file.name,
          mediaType: payload.mediaType,
          data: payload.data,
        })
        if (result.ok !== true || result.path === undefined) {
          toast(tr('toast.attach.failed', { error: result.error ?? '' }), { error: true })
          continue
        }
        const path = result.path
        setImages(list => [...list, path])
      }
    } catch (error) {
      toast(tr('toast.attach.failed', { error: String(error) }), { error: true })
    } finally {
      setAttachBusy(false)
    }
  }, [api, imagesRef, toast, tr])

  /* ------------------------------------------------------------ rendering */

  /*
   * The whale's tooltip is the LAST carrier of the status sentence.
   *
   * The header used to render it as a chip — 「● 已就绪 · deepseek-reasoner」 —
   * sitting beside the three window controls, at their height and their radius,
   * so it read as a fourth button that did nothing. The information is real (it
   * says which model answers, and that an error is an ERROR rather than a plain
   * stop) and the header has no width to spare for it, so it moved to the one
   * control it describes. Its `title` is `state.lastError` first, which is the
   * transient send failure the chip used to surface in place of the phase.
   */
  const whaleTitle = state?.lastError ?? (engine.detail === '' ? tr('status.stopped') : engine.detail)

  const elapsed = busy && state?.busySince !== undefined
    ? `${Math.max(0, (now - state.busySince) / 1000).toFixed(1)}s`
    : undefined
  const streamedChars = viewChat?.messages.reduce(
    (total, message) => (message.role === 'assistant' && message.streaming === true ? message.content.length : total), 0) ?? 0

  const modelLabel = viewChat?.model === 'deepseek-reasoner' ? tr('msg.model.think') : tr('msg.model')

  return createElement(
    'div',
    { className: 'dsh-dschat', 'data-rail-drag': railDragging ? 'true' : undefined, 'data-dsh-plugin': 'dschat' },

    /* ---------------------------------------------------------- header */
    /*
     * `data-window-drag` is the desktop shell's OWN drag-region hook: on darwin
     * an element carrying it becomes `-webkit-app-region: drag`, which is what
     * lets the window be moved — and double-clicked to maximise — from any blank
     * spot inside it. The shell marks its own chrome, but this panel is a
     * full-width seat at the top of the window, so its 52px header covered the
     * strip the user was aiming at: the title bar looked empty and stayed dead.
     *
     * Every control inside is already excluded by the shell's blanket rule
     * (`:is(button,a,input,select,textarea,…){-webkit-app-region:no-drag}`), so
     * the buttons keep working; only the empty space between them becomes
     * draggable. The attribute is inert everywhere else (`data-platform` is not
     * darwin on Web/Windows, and nothing else styles it), so this needs no
     * platform branch.
     *
     * The drag region is an EXPLICIT element rather than the header box, because
     * the header's left end is now the whale: an empty element cannot lie about
     * what it covers, while a mark that has stopped covering a strip (a name
     * removed, a control moved) silently takes the window's drag area with it.
     */
    createElement(
      'header',
      { className: 'dsh-dschat-header', 'data-window-drag': true },
      /*
       * The whale leads the header: identity first, controls after — the order
       * the web app itself uses, where the mark sits at the top of its sidebar
       * and the window controls follow.
       *
       * It replaced two things that stood here and both earned their removal:
       * the panel's NAME (`DSchat`, already the sidebar row and the document
       * title — the one place it was redundant) and a status chip that rendered
       * 「● 已就绪 · deepseek-reasoner」 at the window controls' own height, in
       * their own radius, so it read as a fourth button that did nothing when
       * clicked.
       *
       * The colour is the whole point: the mark IS the state lamp, so the
       * engine's condition is legible from the corner of the eye without a row
       * of text. The sentence did not disappear — it became this control's
       * tooltip, where it costs the header no width (see `whaleTitle`). Colour
       * is never the ONLY channel: the button's accessible name carries the
       * phase, so a reader who cannot see the difference still hears it.
       */
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-dschat-whale',
          'data-phase': engine.phase,
          title: whaleTitle,
          'aria-label': whaleTitle,
          /*
           * The mark is also the panel's "bring it up" button, and it means the
           * same thing here as a click in the composer: start the web engine.
           * It used to call `openLogin` — a headed relaunch — which is wrong for
           * the common case it actually faces, a page that is merely down while
           * the persisted session is perfectly good. The explicit
           * 「打开登录窗口」 entries (the banner, the ··· menu, the settings page)
           * are where a visible window is asked for by name.
           */
          onClick: () => { if (loggedIn !== true || !engineLive) void ensureReady() },
        },
        createElement(WhaleMark, { size: 19 }),
      ),
      /*
       * The three window controls: reopen the conversation list, search it,
       * start a new chat. They are the only affordances for the three things
       * this panel can do before a message exists, so they sit next to the mark
       * that names the product they act on.
       */
      createElement(
        'div',
        { className: 'dsh-dschat-hbtns' },
        createElement(
          'button',
          {
            type: 'button',
            className: railOpen ? 'dsh-dschat-hbtn dsh-dschat-hbtn-on' : 'dsh-dschat-hbtn',
            title: railOpen ? tr('rail.hide') : tr('rail.show'),
            'aria-label': railOpen ? tr('rail.hide') : tr('rail.show'),
            'aria-pressed': railOpen,
            onClick: () => { toggleRail() },
          },
          createElement(HistoryIcon, { size: 16 }),
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: searchOpen ? 'dsh-dschat-hbtn dsh-dschat-hbtn-on' : 'dsh-dschat-hbtn',
            title: tr('rail.search.hint'),
            'aria-label': tr('rail.search.hint'),
            'aria-pressed': searchOpen,
            onClick: () => { openSearch() },
          },
          createElement(SearchIcon, { size: 16 }),
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-dschat-hbtn',
            title: tr('action.newChat.hint'),
            'aria-label': tr('action.newChat'),
            disabled: preparingNewChat,
            onClick: () => { void newChat() },
          },
          createElement(PlusIcon, { size: 16 }),
        ),
      ),
      /*
       * The header's run of empty space — still a drag region, now the only
       * one. `aria-hidden` because it carries nothing: it exists so the window
       * can be moved by the title bar's blank strip, which is where a reader
       * reaches for it.
       */
      createElement('div', { className: 'dsh-dschat-spacer', 'data-window-drag': true, 'aria-hidden': 'true' }),

      transferPopover(),

      moreMenu(),
    ),

    /* ---------------------------------------------------------- body */
    createElement(
      'div',
      { className: 'dsh-dschat-body' },
      rail(),
      createElement(
        'div',
        { className: 'dsh-dschat-chat' },
        createElement(
          'div',
          { className: 'dsh-dschat-thread dsh-dschat-scroll', ref: listRef, onScroll: onThreadScroll },
          createElement('div', { className: 'dsh-dschat-thread-inner' }, thread()),
        ),
        composer(),
        phaseRail(),
      ),
    ),

    toasts.length > 0 && createElement(
      'div',
      { className: 'dsh-dschat-toasts' },
      toasts.map(item => createElement(
        'div',
        { key: item.id, className: 'dsh-dschat-toast', 'data-error': item.error === true ? 'true' : undefined },
        createElement('span', { className: item.error === true ? 'dsh-dschat-bad' : 'dsh-dschat-ok' },
          item.error === true ? createElement(WarnIcon, {}) : createElement(CheckIcon, {})),
        createElement('span', null, item.text),
        item.action !== undefined && createElement(
          'button',
          { type: 'button', onClick: () => { item.action?.run() } },
          item.action.label,
        ),
      )),
    ),
  )

  /* ------------------------------------------------------------- sections */

  function rail(): ReactNode {
    /*
     * Collapsed means ABSENT, not narrow. A zero-width aside would still hold
     * its 6px resize strip and its tab stops, so the panel would keep a phantom
     * column the reader cannot see and cannot click past; dropping the subtree
     * gives the conversation the whole width and leaves the header's history
     * button as the single way back.
     */
    if (!railOpen) return null
    return createElement(
      'aside',
      {
        className: 'dsh-dschat-rail',
        style: { width: `${railWidth}px` },
        'data-resizing': railDragging ? 'true' : undefined,
      },
      /*
       * The resize handle. A 6px strip straddling the rail's border, so the
       * pointer does not have to find a 1px line; it is a real separator for
       * assistive tech and takes arrow keys, because a width that can only be
       * set by dragging is a width half the readers cannot set at all.
       */
      createElement('div', {
        className: 'dsh-dschat-rail-resize',
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': tr('rail.resize'),
        'aria-valuenow': railWidth,
        'aria-valuemin': RAIL_WIDTH_MIN,
        'aria-valuemax': RAIL_WIDTH_MAX,
        tabIndex: 0,
        title: tr('rail.resize'),
        onPointerDown: startRailDrag,
        onKeyDown: nudgeRail,
        onDoubleClick: () => {
          railWidthRef.current = RAIL_WIDTH_DEFAULT
          setRailWidth(RAIL_WIDTH_DEFAULT)
          writeStored(RAIL_STORE, String(RAIL_WIDTH_DEFAULT))
        },
      }),
      createElement(
        'div',
        { className: 'dsh-dschat-search' },
        createElement(SearchIcon, {}),
        createElement('input', {
          ref: searchRef,
          value: query,
          placeholder: tr('rail.search'),
          'aria-label': tr('rail.search'),
          onChange: (event: { target: { value: string } }) => setQuery(event.target.value),
          onKeyDown: (event: { key: string; preventDefault: () => void }) => {
            // Escape empties the box, so one key undoes the search without also
            // throwing the reader's place in the list away.
            if (event.key !== 'Escape' || query === '') return
            event.preventDefault()
            setQuery('')
          },
        }),
        query !== '' && createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-dschat-search-clear',
            title: tr('rail.search.clear'),
            'aria-label': tr('rail.search.clear'),
            onClick: () => { setQuery(''); searchRef.current?.focus() },
          },
          createElement(CloseIcon, { size: 10 }),
        ),
      ),
      createElement(
        'div',
        { className: 'dsh-dschat-list dsh-dschat-scroll' },
        filtered.length === 0
          ? createElement('div', { className: 'dsh-dschat-hint-empty' },
              chats.length === 0 ? tr('rail.empty') : tr('rail.noMatch'))
          : filtered.map(chat => (renamingId === chat.id ? renameRow(chat) : chatRow(chat))),
      ),
      createElement(
        'div',
        { className: 'dsh-dschat-rail-foot' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-dschat-btn dsh-dschat-btn-ghost',
            style: { flex: 1, justifyContent: 'center' },
            disabled: loggedIn !== true,
            title: tr('action.recover.hint'),
            onClick: () => { void recover() },
          },
          createElement(RefreshIcon, {}),
          tr('action.recover'),
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: clearArmed ? 'dsh-dschat-btn dsh-dschat-btn-ghost' : 'dsh-dschat-btn',
            disabled: chats.length === 0,
            title: tr('rail.clear'),
            onClick: () => { void clearAll() },
          },
          clearArmed ? tr('rail.clearConfirm') : createElement(TrashIcon, {}),
        ),
      ),
    )
  }

  /**
   * Every message of one chat that matches the current query, oldest first.
   *
   * The rail's filter is a substring test over content and title; this narrows
   * it to the MESSAGES, because "open the chat that matched" is only half of
   * what a search promises — the reader wants the paragraph, and a 30-message
   * conversation does not show it.
   */
  function matchedMessageIds(chat: DSchatTranscript | undefined): string[] {
    const needle = query.trim().toLowerCase()
    if (chat === undefined || needle === '') return []
    return chat.messages
      .filter(message => message.content.toLowerCase().includes(needle))
      .map(message => message.id)
  }

  /** Open a conversation, and land on its first match when one is being sought. */
  function openChat(chat: DSchatTranscript): void {
    setViewChatId(chat.id)
    setJumpId(matchedMessageIds(chat)[0])
  }

  function chatRow(chat: DSchatTranscript): ReactNode {
    return createElement(
      'div',
      {
        key: chat.id,
        className: 'dsh-dschat-item',
        'data-active': chat.id === viewChat?.id ? 'true' : undefined,
      },
      createElement(
        'div',
        {
          className: 'dsh-dschat-item-main',
          onClick: () => { openChat(chat) },
        },
        createElement('div', { className: 'dsh-dschat-item-title', title: chat.title }, chat.title),
        createElement('div', { className: 'dsh-dschat-item-meta' },
          `${fmt(tr('chats.count'), { count: String(chat.messages.length) })} · ${relativeTime(chat.updatedAt, tr)}`),
      ),
      createElement(
        'div',
        { className: 'dsh-dschat-item-acts' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-dschat-mini',
            title: tr('item.rename'),
            onClick: () => { setRenameDraft(chat.title); setRenamingId(chat.id) },
          },
          createElement(PencilIcon, {}),
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-dschat-mini dsh-dschat-mini-danger',
            title: tr('item.delete'),
            onClick: () => { void removeChat(chat) },
          },
          createElement(TrashIcon, {}),
        ),
      ),
    )
  }

  function renameRow(chat: DSchatTranscript): ReactNode {
    return createElement(
      'div',
      { key: chat.id, className: 'dsh-dschat-item', 'data-active': chat.id === viewChat?.id ? 'true' : undefined },
      createElement('input', {
        className: 'dsh-dschat-select',
        autoFocus: true,
        value: renameDraft,
        placeholder: tr('item.rename.placeholder'),
        'aria-label': tr('item.rename'),
        onChange: (event: { target: { value: string } }) => setRenameDraft(event.target.value),
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key === 'Enter') { event.preventDefault(); void commitRename(chat) }
          else if (event.key === 'Escape') setRenamingId(undefined)
        },
        onBlur: () => { void commitRename(chat) },
      }),
    )
  }

  function thread(): ReactNode {
    /*
     * The two branches carry DIFFERENT keys on purpose.
     *
     * Both used to be a bare `div`, which React reconciles as "the same
     * element, updated": it kept the node and swapped the children. That is
     * normally harmless, but it makes the empty state the place where a
     * botched removal becomes visible — and it did. With a duplicated message
     * id the keyed reconciliation dropped one child on the floor, so the old
     * answer's DOM node was never removed; it stayed inside the reused div,
     * i.e. above 「在 DSH 里直接聊 DeepSeek 网页端」, exactly as reported.
     *
     * A distinct key makes the branches different elements to React, so
     * switching to a new chat unmounts the message subtree outright instead of
     * diffing into it. `thread-inner` then holds only what this render built,
     * whatever the stored ids happen to be.
     */
    if (viewChat === undefined || viewChat.messages.length === 0) {
      return createElement(
        'div',
        { className: 'dsh-dschat-empty', key: 'empty' },
        createElement('div', { className: 'dsh-dschat-empty-mark' }, createElement(ChatIcon, { size: 22 })),
        createElement('h3', null, tr('empty.title')),
        createElement('p', null, tr('empty.body')),
        createElement(
          'p',
          { style: { marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'center' } },
          createElement('span', { className: 'dsh-dschat-kbd' }, 'Enter'),
          createElement('span', null, tr('action.send')),
          createElement('span', { className: 'dsh-dschat-kbd' }, '⌘/'),
          createElement('span', null, tr('composer.hint.focus')),
        ),
        loggedIn !== true && createElement(
          'button',
          { type: 'button', className: 'dsh-dschat-btn dsh-dschat-btn-primary', onClick: () => { void openLogin() } },
          tr('action.openLogin'),
        ),
      )
    }
    const keys = threadKeys(viewChat.messages)
    return createElement(
      'div',
      { style: { display: 'contents' }, key: 'thread' },
      createElement(
        'div',
        { className: 'dsh-dschat-day', key: 'day' },
        new Date(viewChat.messages[0]?.ts ?? Date.now()).toLocaleDateString(),
      ),
      ...viewChat.messages.map((message, index) => messageNode(message, keys[index] ?? message.id, index)),
    )
  }

  function messageNode(message: DSchatMessage, key: string, index: number): ReactNode {
    const isUser = message.role === 'user'
    const who = isUser ? tr('msg.you') : modelLabel
    /*
     * What the reader means by "this reply": the ANSWER, not the reasoning the
     * engine prepends to it as a `<details>` block. Both 复制 and 引用 go
     * through reply.ts, so the thinking wrapper can never end up on the
     * clipboard or in the composer again (it used to: quoting took the first
     * LINE of the stored content, which IS the `<details>` opener).
     */
    const reply = isUser ? message.content : replyBody(message.content)
    const thinking = isUser ? '' : thinkingBody(message.content)
    /** The reply's own citation table, normalized (undefined when it cited nothing). */
    const sources = isUser ? undefined : sourcesOf(message.sources)
    /**
     * What every markdown surface inside this message shares: a link goes to
     * the machine's browser, a code block copies itself.
     */
    const markdownOptions = (): {
      onCopyCode: (code: string) => void
      onOpenLink: (href: string) => boolean
    } => ({
      onCopyCode: (code: string) => { void copyText(code, tr('toast.codeCopied')) },
      onOpenLink: openExternalLink,
    })
    /*
     * Quote is only offered once there is something to quote. While a reasoner
     * is still thinking the answer half does not exist yet, and a quote marker
     * with nothing after it would be worse than no button at all.
     */
    const quoted = isUser ? (message.content.split('\n')[0] ?? '').trim() : firstLine(message.content)
    // Copy leads for BOTH roles so the row's first control never moves between
    // messages; the role-specific actions follow it. The reasoning gets its own
    // button rather than riding along in 复制, which is what the reader expects
    // from every other assistant UI.
    const actions: Array<{ key: string; title: string; icon: ReactNode; run: () => void }> = isUser
      ? [
          { key: 'copy', title: tr('msg.copy'), icon: createElement(CopyIcon, {}), run: () => { void copyText(reply, tr('toast.copied')) } },
          { key: 'edit', title: tr('msg.edit'), icon: createElement(PencilIcon, {}), run: () => { setDraft(message.content); inputRef.current?.focus() } },
        ]
      : [
          { key: 'copy', title: tr('msg.copy'), icon: createElement(CopyIcon, {}), run: () => { void copyText(reply, tr('toast.copied')) } },
          ...(thinking === ''
            ? []
            : [{
                key: 'copy-thinking',
                title: tr('msg.copyThinking'),
                icon: createElement(ThinkIcon, {}),
                run: () => { void copyText(thinking, tr('toast.thinkingCopied')) },
              }]),
          ...(quoted === ''
            ? []
            : [{
                key: 'quote',
                title: tr('msg.quote'),
                icon: createElement(QuoteIcon, {}),
                run: () => { setDraft(`> ${quoted}\n\n`); inputRef.current?.focus() },
              }]),
        ]

    const body = createElement(
      'div',
      { className: 'dsh-dschat-msg-body' },
      message.attachments !== undefined && message.attachments.length > 0 && createElement(
        'div',
        { className: 'dsh-dschat-imgs' },
        message.attachments.map(path => createElement('div', { key: path, className: 'dsh-dschat-chip', title: path },
          createElement(ClipIcon, { size: 12 }), createElement('span', null, path.split('/').pop() ?? path))),
      ),
      isUser
        ? createElement('p', null, message.content)
        : createElement(
            Fragment,
            null,
            /*
             * The reasoning, as its own disclosure. The message stores reasoning
             * and answer in ONE string (the engine wraps the reasoning in a
             * `<details>` block), and the panel splits it back apart here:
             *
             *   - the reasoning becomes a button whose summary line carries the
             *     turn's real duration 「已思考（用时 …）」, measured by the engine
             *     while it streamed (see `thoughtLabel`);
             *   - the answer renders as ordinary prose, NOT inside a collapsed
             *     box, so a long reply is readable without a click.
             *
             * Splitting it also keeps `<details>` out of the DOM entirely, which
             * is what lets the row follow the panel's theme tokens.
             */
            thinking !== '' && createElement(Thinking, {
              source: thinking,
              label: thoughtLabel(message.thinkingMs, message.streaming === true, tr),
              /*
               * The live-line inputs. `thinkingMs` is undefined exactly while
               * the model is still reasoning (the engine measures the interval
               * and writes it once the answer starts), and `streaming` is true
               * for the whole turn — together they are the panel's own test for
               * 「思考中」 rather than a separate phase flag that could disagree
               * with the message it describes.
               */
              ...(message.thinkingMs === undefined ? {} : { thinkingMs: message.thinkingMs }),
              ...(message.streaming === undefined ? {} : { streaming: message.streaming }),
              liveLabel: tr('msg.thought.prefix'),
              copyLabel: tr('msg.copy'),
              options: markdownOptions(),
            }),
            createElement(Markdown, {
              source: reply,
              copyLabel: tr('msg.copy'),
              ...markdownOptions(),
              /*
               * The citation table goes over on EVERY tick, streaming or not:
               * it is what turns `[citation:N]` from a dead number into a link
               * to the page the answer cites, and the chips are on screen from
               * the first moment the web numbers its sources.
               */
              ...(sources === undefined ? {} : { sources }),
              /*
               * The source LIST waits for the reply to finish. The web numbers
               * its sources as soon as the search step returns — before a single
               * token of the answer exists — so a list rendered during the
               * stream appeared FIRST, at the top of an empty message, and was
               * then pushed down by the answer growing above it: the reader saw
               * sources, then content. Withholding the heading alone is what
               * orders the transcript the way the page itself ends up (answer,
               * then sources) while keeping the citation chips live.
               */
              ...(sources === undefined || message.streaming === true
                ? {}
                : { sourcesLabel: tr('msg.sources.count', { count: String(sources.length) }) }),
            }),
          ),
      message.streaming === true && createElement('span', { className: 'dsh-dschat-caret' }),
      message.error !== undefined && createElement(
        'div',
        { className: 'dsh-dschat-err' },
        createElement(WarnIcon, {}),
        createElement('span', null, message.content === '' ? message.error : tr('phase.replyPartial')),
        createElement('span', { className: 'dsh-dschat-spacer' }),
        createElement(
          'button',
          { type: 'button', className: 'dsh-dschat-btn dsh-dschat-btn-ghost', onClick: () => { void retry() } },
          tr('msg.retry'),
        ),
      ),
    )

    const acts = createElement(
      'div',
      { className: 'dsh-dschat-msg-acts' },
      actions.map(action => createElement(
        'button',
        { key: action.key, type: 'button', title: action.title, 'aria-label': action.title, onClick: action.run },
        action.icon,
      )),
    )

    return createElement(
      'div',
      {
        key,
        /*
         * `data-message-id` is the search jump's landing mark: the rail filter
         * matches on message CONTENT, so "which row do I scroll to" has to be
         * answerable from the DOM by the id the match reported. `data-index` is
         * the existing order hook and stays as it was.
         */
        className: message.id === flashId ? 'dsh-dschat-msg dsh-dschat-msg-jump' : 'dsh-dschat-msg',
        'data-message-id': message.id,
        'data-role': message.role,
        'data-index': index,
      },
      createElement(
        'div',
        { className: 'dsh-dschat-msg-head' },
        createElement('span', { className: 'dsh-dschat-msg-who' }, who),
        createElement('span', null, new Date(message.ts).toLocaleTimeString()),
      ),
      /*
       * Placement differs by role because the CONTENT does.
       *
       * An assistant message is full-width prose, so its row rides the head line
       * at the message's right edge. A user message is a narrow right-aligned
       * bubble: anchoring its row to the message box parked it at the far LEFT,
       * hundreds of pixels from the bubble. Wrapping the bubble makes the row's
       * containing block the bubble itself, so `right: 100%` puts it just outside
       * the bubble at any width.
       */
      isUser
        ? createElement('div', { className: 'dsh-dschat-msg-line' }, body, acts)
        : createElement(Fragment, null, body, acts),
    )
  }

  function composer(): ReactNode {
    return createElement(
      'div',
      { className: 'dsh-dschat-composer' },
      createElement(
        'div',
        { className: 'dsh-dschat-composer-inner' },
        createElement(
          'div',
          {
            className: dragging ? 'dsh-dschat-card dsh-dschat-dragging' : 'dsh-dschat-card',
            /*
             * The whole card is the "start me" affordance the offline
             * placeholder advertises — it wears the accent wash and the pointer
             * cursor — but only the textarea inside it took focus, so a click on
             * the padding did nothing. Guarded on `target === currentTarget` so
             * this never steals a click from a chip, a pill or the attach
             * button: only a click on the card itself is forwarded to the input.
             */
            onClick: (event: { target: unknown; currentTarget: unknown }) => {
              if (event.target !== event.currentTarget) return
              inputRef.current?.focus()
              if (loggedIn !== true && !busy) void ensureReady()
            },
            // Paste and drop both end at the same place: bytes to the host,
            // path back, chip in the composer. `isAttachableFile` only rules out
            // empty entries — the page's own file input is the authority on
            // which TYPES it takes (see the note on that helper).
            onPaste: (event: { clipboardData?: DataTransfer; preventDefault: () => void }) => {
              const files = Array.from(event.clipboardData?.files ?? []).filter(isAttachableFile)
              if (files.length === 0) return
              event.preventDefault()
              void uploadFiles(files)
            },
            onDragOver: (event: { preventDefault: () => void; dataTransfer?: DataTransfer }) => {
              event.preventDefault()
              // Dropping a file is the whole point; telling the browser so is
              // what turns the cursor into a copy cursor instead of a "no" one.
              if (event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'copy'
              setDragging(true)
            },
            /*
             * `dragleave` fires for every child the pointer crosses, so a plain
             * `setDragging(false)` made the drop hint strobe on and off as the
             * pointer moved from the card to the textarea inside it. Only a
             * leave whose `relatedTarget` is outside the card is a real leave
             * (a null one means the pointer left the window entirely).
             */
            onDragLeave: (event: { relatedTarget?: Node | null; currentTarget?: Node | null }) => {
              const next = event.relatedTarget
              // Both are DOM nodes at runtime; typed as such so `contains` is a
              // real method rather than an `EventTarget` cast.
              if (next !== null && next !== undefined && event.currentTarget?.contains(next) === true) return
              setDragging(false)
            },
            onDrop: (event: { dataTransfer?: DataTransfer; preventDefault: () => void }) => {
              event.preventDefault()
              setDragging(false)
              const files = Array.from(event.dataTransfer?.files ?? []).filter(isAttachableFile)
              if (files.length > 0) void uploadFiles(files)
            },
          },
          images.length > 0 && createElement(
            'div',
            { className: 'dsh-dschat-attachments' },
            images.map((path, index) => createElement(
              'span',
              { key: `${path}-${index}`, className: 'dsh-dschat-chip', title: path },
              createElement(ClipIcon, { size: 12 }),
              createElement('span', null, path.split('/').pop() ?? path),
              createElement('button', {
                type: 'button',
                title: tr('item.rename.cancel'),
                onClick: () => setImages(list => list.filter((_, i) => i !== index)),
              }, '✕'),
            )),
          ),
          createElement('textarea', {
            ref: inputRef,
            className: 'dsh-dschat-input',
            rows: 1,
            value: draft,
            /*
             * readOnly, NOT disabled, while the engine is down.
             *
             * `disabled` removes the element from the tab order and drops every
             * pointer event, so clicking the composer did nothing at all — no
             * cursor, no focus, no feedback — which is exactly the reported
             * "点击输入框无反应". readOnly keeps it focusable and hovering, and
             * the focus/click handler below turns "I want to type" into "start
             * the engine", which is the action the click was asking for.
             */
            readOnly: busy || loggedIn !== true,
            placeholder: busy
              ? tr('composer.busy')
              : (waking || state?.engine === 'launching')
                ? tr('composer.connecting')
                : loggedIn !== true
                  ? (engineLive ? tr('composer.notLoggedIn') : tr('composer.offline'))
                  : tr('composer.placeholder'),
            onFocus: () => {
              if (busy) return
              /*
               * Already up and signed in: nothing to do. Every other case —
               * stopped, launching, or a live page that is not signed in — goes
               * through `ensureReady`, which is idempotent:
               *   - a wake that is already in flight is joined, not repeated;
               *   - the engine reuses a live page instead of relaunching one;
               *   - the visible login window is opened only for a sign-in page.
               * The old handler called `openLogin` here, which forced a headed
               * relaunch even for a profile that was still authenticated.
               */
              if (loggedIn === true && !waking) return
              void ensureReady()
            },
            onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
            onKeyDown: (event: {
              key: string
              shiftKey: boolean
              preventDefault: () => void
              isComposing?: boolean
              nativeEvent?: { isComposing?: boolean }
            }) => {
              // Enter sends; Enter that belongs to an input method does not (see
              // submitsOnEnter — picking a pinyin candidate used to submit).
              if (!submitsOnEnter(event)) return
              event.preventDefault()
              void send()
            },
          }),
          dragging && createElement('div', { className: 'dsh-dschat-dropline' }, tr('composer.attach.drop')),
          createElement(
            'div',
            { className: 'dsh-dschat-tools' },
            /*
             * 深度思考 / 智能搜索 sit BELOW the input, in the composer's own tool row
             * — the web app's layout, where they read as properties of the
             * message you are about to send. In the header they were chrome that
             * applied to nothing in particular, and they crowded the panel title
             * on a narrow column.
             *
             * The pills, their icons and their two states are the web app's own
             * (34px tall, 18px radius, and the same blue when on — see the
             * `.dsh-dschat-toggle` rules), so a reader who knows the page
             * recognises the switches instead of re-learning them.
             *
             * The row reads left to right as two groups: the pills on the left
             * ("what should this message ask for"), then the spacer, then 附件
             * and the send circle on the right ("act on this message now") —
             * the page's own grouping, with the paperclip immediately left of
             * the send button.
             */
            createElement(
              'button',
              {
                type: 'button',
                className: deepThink ? 'dsh-dschat-toggle dsh-dschat-toggle-on' : 'dsh-dschat-toggle',
                disabled: busy || loggedIn !== true,
                title: tr('toggle.deepThink.hint'),
                'aria-pressed': deepThink,
                onClick: () => { void toggleDeepThink() },
              },
              createElement(DeepThinkIcon, { size: 14 }),
              createElement('span', { className: 'dsh-dschat-toggle-text' }, tr('toggle.deepThink')),
            ),
            createElement(
              'button',
              {
                type: 'button',
                className: search ? 'dsh-dschat-toggle dsh-dschat-toggle-on' : 'dsh-dschat-toggle',
                disabled: busy || loggedIn !== true,
                title: tr('toggle.search.hint'),
                'aria-pressed': search,
                onClick: () => { void toggleSearch() },
              },
              createElement(WebSearchIcon, { size: 14 }),
              createElement('span', { className: 'dsh-dschat-toggle-text' }, tr('toggle.search')),
            ),
            /*
             * 附件 is NOT here any more.
             *
             * It sat at the end of the pill group — 34px further left than the
             * page puts it — because the row "had to hold two pills AND the send
             * circle". But the spacer between them is the one part of the row
             * that carries no meaning, and the page's own composer (and the
             * harness's) groups the paperclip with the send control, on the
             * right: both are "act on this message now", while the pills are
             * "what should this message ask for". It now lives there — see the
             * block below the spacer.
             */
            createElement('div', { className: 'dsh-dschat-spacer' }),
            preparingNewChat && createElement(
              'span',
              { className: 'dsh-dschat-hintline', style: { margin: 0 } },
              createElement('span', { className: 'dsh-dschat-spin' }),
              tr('composer.preparing'),
            ),
            /*
             * 附件: the OS file dialog, and the ONLY way files are attached
             * from the panel's own chrome — immediately left of the send
             * control, where chat.deepseek.com and the harness's own composer
             * both put it.
             *
             * A hidden `<input type="file">` clicked from here is the only way
             * to reach Finder — the packaged app has no file-picking API at all
             * (its one native dialog is the directory chooser), and this is
             * exactly what the shell's own composer does for its paperclip. The
             * chosen bytes go to the host (`/attach`), which answers a real path
             * the engine can hand the page's file input.
             *
             * It is a glyph, not a labelled button, because that is what the
             * page shows and because the row has to hold two pills AND the send
             * circle at 320px. The label the button lost is not lost information:
             * the tooltip carries it, and the count of files already attached is
             * on screen as chips above.
             *
             * The in-app browser that used to sit next to it is gone: two ways
             * to attach (by path in a dialog of our own, by bytes through
             * Finder) were one way too many, and the reader who wants a file
             * from their disk wants Finder. Dropping and pasting files still
             * work — those are gestures, not a second button.
             */
            createElement('input', {
              ref: uploadRef,
              type: 'file',
              multiple: true,
              className: 'dsh-dschat-fileinput',
              tabIndex: -1,
              'aria-hidden': true,
              onChange: (event: { target: { files?: FileList | null; value: string } }) => {
                const picked = Array.from(event.target.files ?? [])
                // Clear the control: picking the same file twice in a row fires
                // no `change` otherwise, which reads as "第二次没反应".
                event.target.value = ''
                if (picked.length > 0) void uploadFiles(picked)
              },
            }),
            createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-dschat-attach',
                /*
                 * The visible label is gone (the official row is a bare
                 * paperclip), so the tooltip and the accessible name carry the
                 * words. The hint — which names the kinds of file the page
                 * accepts — is the tooltip; the short label is the name screen
                 * readers announce.
                 */
                title: attachBusy ? tr('composer.upload.busy') : tr('composer.upload.hint'),
                'aria-label': attachBusy ? tr('composer.upload.busy') : tr('composer.upload'),
                disabled: busy || loggedIn !== true || attachBusy,
                onClick: () => uploadRef.current?.click(),
              },
              attachBusy
                ? createElement('span', { className: 'dsh-dschat-spin' })
                : createElement(ClipIcon, { size: 16 }),
            ),
            /*
             * The 「⌘K 搜索」 hint that used to sit here is GONE.
             *
             * It documented the rail's search shortcut from inside the composer,
             * in the one strip this row has to spare — between the paperclip and
             * the send circle — where a keycap plus a label reads as a second,
             * dead button. The shortcut itself is untouched (⌘K still opens the
             * search box); it is the advertisement that was redundant, because
             * the thing it advertises is on screen in the header.
             */
            streaming
              ? createElement(
                  'button',
                  { type: 'button', className: 'dsh-dschat-stop', onClick: () => { void stop() } },
                  createElement('i', null),
                  tr('action.stop'),
                )
              : createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-dschat-send',
                    title: tr('action.send'),
                    'aria-label': tr('action.send'),
                    disabled: !canSend || (draft.trim() === '' && images.length === 0),
                    onClick: () => { void send() },
                  },
                  createElement(SendIcon, {}),
                ),
          ),
        ),
      ),
    )
  }

  function phaseRail(): ReactNode {
    return createElement(
      'div',
      { className: 'dsh-dschat-phase' },
      busy && createElement('span', { className: 'dsh-dschat-spin' }),
      createElement('span', null, busy ? tr('phase.busy') : tr('phase.idle')),
      createElement('span', { className: 'dsh-dschat-sep' }, '|'),
      createElement('span', null, loggedIn === true ? tr('phase.loggedIn') : tr('phase.notLoggedIn')),
      busy && elapsed !== undefined && createElement('span', null, fmt(tr('phase.elapsed'), { time: elapsed })),
      busy && createElement('span', null, fmt(tr('phase.chars'), { count: String(streamedChars) })),
      !busy && viewChat !== undefined && createElement('span', { className: 'dsh-dschat-sep' }, '|'),
      !busy && viewChat !== undefined && createElement(
        'span',
        null,
        fmt(tr('phase.turns'), { count: String(viewChat.messages.length) }),
      ),
      state?.lastError !== undefined && createElement('span', null, `· ${state.lastError}`),
    )
  }

  function transferPopover(): ReactNode {
    const note = transferTarget === 'continue' ? tr('transfer.note.continue') : tr('transfer.note.new')
    return createElement(
      'div',
      { className: 'dsh-dschat-pop-wrap', ref: transferPopRef },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-dschat-btn dsh-dschat-btn-primary',
          disabled: viewChat === undefined || viewChat.messages.length === 0,
          onClick: () => {
            /*
             * Every open starts from 新建会话.
             *
             * The picker is a two-way choice, and the "continue" half remembers
             * its target for as long as the panel is mounted. That made a stale
             * selection a silent trap: the next transfer appended its brief to
             * the PREVIOUS session instead of creating one, so the session the
             * user then opened carried the previous distillation next to the new
             * one. Re-picking 「追加到已有会话」 is one click; discovering that a
             * new session was never created is not.
             */
            if (!popOpen) {
              setTransferTarget('new')
              setTargetSessionId(undefined)
            }
            setPopOpen(open => !open)
          },
        },
        tr('transfer.title'),
        createElement(CaretIcon, {}),
      ),
      popOpen && createElement(
        'div',
        { className: 'dsh-dschat-pop' },
        createElement('h4', null, tr('transfer.title')),
        createElement('p', { className: 'dsh-dschat-sub' }, tr('transfer.sub')),

        createElement('div', { className: 'dsh-dschat-field' },
          createElement('label', null, tr('transfer.mode')),
          createElement('div', { className: 'dsh-dschat-seg' },
            createElement('button', {
              type: 'button',
              'data-on': transferMode === 'distill' ? 'true' : undefined,
              onClick: () => setTransferMode('distill'),
            }, tr('transfer.mode.distill')),
            createElement('button', {
              type: 'button',
              'data-on': transferMode === 'raw' ? 'true' : undefined,
              onClick: () => setTransferMode('raw'),
            }, tr('transfer.mode.raw')),
          ),
        ),
        createElement('p', { className: 'dsh-dschat-hintline' },
          createElement(CheckIcon, {}),
          transferMode === 'distill' ? tr('transfer.mode.distill.hint') : tr('transfer.mode.raw.hint')),

        createElement('div', { className: 'dsh-dschat-field' },
          createElement('label', null, tr('transfer.target')),
          createElement('div', { className: 'dsh-dschat-seg' },
            createElement('button', {
              type: 'button',
              'data-on': transferTarget === 'new' ? 'true' : undefined,
              onClick: () => setTransferTarget('new'),
            }, tr('transfer.target.new')),
            createElement('button', {
              type: 'button',
              'data-on': transferTarget === 'continue' ? 'true' : undefined,
              disabled: continuationTargets.length === 0,
              onClick: () => setTransferTarget('continue'),
            }, tr('transfer.target.continue')),
          ),
        ),

        transferTarget === 'continue' && createElement('div', { className: 'dsh-dschat-field' },
          createElement('label', null, tr('transfer.continueTo')),
          continuationTargets.length === 0
            ? createElement('p', { className: 'dsh-dschat-hintline' }, tr('transfer.continue.empty'))
            : createElement('select', {
              className: 'dsh-dschat-select',
              value: continueTargetId ?? '',
              onChange: (event: { target: { value: string } }) => setTargetSessionId(event.target.value),
            }, continuationTargets.map(target => createElement('option', { key: target.id, value: target.id }, target.title))),
        ),

        transferTarget === 'new' && createElement('div', { className: 'dsh-dschat-field' },
          createElement('label', null, tr('transfer.workspace')),
          createElement('select', {
            className: 'dsh-dschat-select',
            value: targetWorkspaceId ?? '',
            onChange: (event: { target: { value: string } }) => {
              const value = event.target.value
              if (value === '__new__') { void createTargetWorkspace(); return }
              setTargetWorkspaceId(value === '' ? undefined : value)
            },
          },
            createElement('option', { value: '' }, tr('transfer.ungrouped')),
            workspaces.map(workspace => createElement('option', { key: workspace.id, value: workspace.id },
              `${workspace.title} — ${workspace.path}`)),
            createElement('option', { value: '__new__' }, `＋ ${tr('transfer.workspace.new')}`),
          ),
        ),

        stage > 0 && createElement(
          'div',
          { className: 'dsh-dschat-steps' },
          createElement('div', { className: 'dsh-dschat-prog' },
            createElement('i', { style: { width: `${Math.min(stage, 3) / 3 * 100}%` } })),
          [1, 2, 3].map(step => createElement(
            'div',
            { key: step, className: 'dsh-dschat-step', 'data-done': step < stage ? 'true' : undefined },
            step < stage
              ? createElement('span', { className: 'dsh-dschat-tick' }, createElement(CheckIcon, {}))
              : createElement('span', { className: 'dsh-dschat-spin' }),
            createElement('span', null,
              step === 1
                ? (transferMode === 'distill' ? tr('transfer.step.distill') : tr('transfer.mode.raw'))
                : step === 2 ? tr('transfer.step.session') : tr('transfer.step.open')),
          )),
        ),

        createElement('div', { className: 'dsh-dschat-pop-foot' },
          createElement('button', {
            type: 'button',
            className: 'dsh-dschat-btn dsh-dschat-btn-primary',
            disabled: transferring,
            onClick: () => { void runTransfer() },
          }, transferTarget === 'continue' ? tr('transfer.target.continue') : tr('action.startTransfer')),
          createElement('span', { className: 'dsh-dschat-hintline', style: { margin: 0 } }, note),
        ),
      ),
    )
  }

  function moreMenu(): ReactNode {
    return createElement(
      'div',
      { className: 'dsh-dschat-pop-wrap', ref: morePopRef },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-dschat-btn dsh-dschat-btn-icon',
          title: '···',
          'aria-label': '···',
          onClick: () => setMoreOpen(value => !value),
        },
        createElement(MoreIcon, {}),
      ),
      moreOpen && createElement(
        'div',
        { className: 'dsh-dschat-pop', style: { width: '230px' } },
        moreItem('export', tr('action.exportFile'), () => { void exportFile() }),
        moreItem('login', tr('action.openLogin'), () => { void openLogin() }, loggedIn === true),
        moreItem('close', tr('action.closeBrowser'), () => { void api.closeBrowser().catch(() => undefined) }, (state?.engine ?? 'stopped') === 'stopped'),
      ),
    )

    function moreItem(key: string, label: string, run: () => void, hidden = false): ReactNode {
      if (hidden) return null
      return createElement(
        'button',
        {
          key,
          type: 'button',
          className: 'dsh-dschat-btn',
          style: { width: '100%', justifyContent: 'flex-start' },
          onClick: () => { run(); setMoreOpen(false) },
        },
        label,
      )
    }
  }
}

/**
 * Relative time label, falling back to a date once it is older than a week.
 *
 * Localized: the abbreviations used to be hard-coded English ('just now', '7m',
 * '20h') and sat directly under Chinese conversation titles, which read as a
 * half-translated UI. A count and a unit is not a place to skip the dictionary.
 *
 * @param ts - epoch ms the conversation was last updated.
 * @param tr - locale accessor, already bound to the plugin namespace.
 */
function relativeTime(ts: number, tr: (key: string, values?: Record<string, string>) => string): string {
  const delta = Date.now() - ts
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return tr('time.justNow')
  if (minutes < 60) return fmt(tr('time.minutes'), { count: String(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return fmt(tr('time.hours'), { count: String(hours) })
  const days = Math.floor(hours / 24)
  if (days < 7) return fmt(tr('time.days'), { count: String(days) })
  // Past a week the reader wants the date, and the locale's own date format is
  // the only correct way to write it.
  return new Date(ts).toLocaleDateString()
}
