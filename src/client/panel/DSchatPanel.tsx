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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  mergeTail,
  phaseOf,
  sourcesOf,
  type DSchatMessage,
  type DSchatChatView,
  type DSchatState,
  type DSchatTail,
  type DSchatView,
  type DSchatTranscript,
  type TransferMode,
} from '../../protocol.ts'
import type { DSchatApi } from '../api.ts'
import {
  CaretIcon, ChatIcon, CheckIcon, ClipIcon, CloseIcon, CopyIcon, DeepThinkIcon, MenuIcon,
  MoreIcon, PencilIcon, PlusIcon, QuoteIcon, RefreshIcon, SearchIcon,
  SendIcon, SwapIcon, ThinkIcon, TrashIcon, WarnIcon, WebSearchIcon, WhaleMark,
} from '../icons.tsx'
import { touchEngineStatus, useEngineStatus } from '../status.ts'
import { Markdown, Thinking } from './Markdown.tsx'
import { DSchatStatus } from './DSchatStatus.tsx'
import { firstLine, replyBody, thinkingBody } from './reply.ts'

/** Interpolate `{placeholder}`s in a localized template. */
function fmt(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`)
}

/**
 * The reader-facing sentence for one FAILED api call.
 *
 * Every route answers a failure with a structured `code` plus a technical
 * Chinese detail. The code is what makes the same failure read as English in an
 * English interface — the detail is only the fallback, because this panel has no
 * way to translate a sentence the host composed.
 *
 * The localized sentence WINS over the detail, deliberately: mixing them
 * (`"Path not allowed: 附件路径不在附件目录内：/etc/hosts"`) puts host-language
 * text back into the toast, which is the bug being fixed. The detail is not lost
 * — it is in the response, in the host's own console output, and in 运行状态 →
 * 复制诊断, which is where someone debugging a path or a field actually looks.
 *
 * @param result - the failed response (its `code` is the part that localizes).
 * @param fallback - what to say when there is neither a known code nor a detail.
 * @param tr - locale accessor, already bound to the plugin namespace.
 */
export function explain(
  result: { code?: string; error?: string } | undefined,
  fallback: string,
  tr: (key: string, values?: Record<string, string>) => string,
): string {
  switch (result?.code) {
    case 'NEED_LOGIN': return tr('error.NEED_LOGIN')
    case 'PAGE_CHANGED': return tr('error.PAGE_CHANGED')
    case 'TIMEOUT': return tr('error.TIMEOUT')
    case 'NETWORK': return tr('error.NETWORK')
    case 'BUSY': return tr('error.BUSY')
    case 'LOOPBACK': return tr('error.LOOPBACK')
    case 'METHOD': return tr('error.METHOD')
    case 'ORIGIN': return tr('error.ORIGIN')
    case 'CSRF': return tr('error.CSRF')
    case 'PATH': return tr('error.PATH')
    case 'BAD_REQUEST': return tr('error.BAD_REQUEST')
    case 'TOO_LARGE': return tr('error.TOO_LARGE')
    case 'NOT_FOUND': return tr('error.NOT_FOUND')
    case 'INTERNAL': return tr('error.INTERNAL')
    default: {
      const detail = result?.error
      return detail !== undefined && detail !== '' ? detail : fallback
    }
  }
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

/**
 * One file the composer is holding for the next message.
 *
 * The engine only ever needs `path` — `engine.attachFiles` drives the page's
 * file input with real paths — but the PANEL needs the other three fields to
 * render the chip honestly, and they are the reason this is an object:
 *
 *   - `name` is the file's real name. The host stores attachments as
 *     `${uuid}__${name}${ext}` and answers the bare `name` back, so showing
 *     `path.split('/').pop()` showed the UUID — the one part of the path that
 *     means nothing to a reader ("一串数字").
 *   - `kind` decides between a THUMBNAIL and a file chip. It is taken from the
 *     browser's own media type rather than re-derived from the extension,
 *     because the host's extension table already made that judgement (a
 *     nameless paste becomes `.png` only when the bytes are an image).
 *   - a path recovered from an older transcript has no stored kind, and is
 *     treated as a file — see {@link attachmentKind}.
 */
interface ComposerAttachment {
  /** Absolute host path the engine uploads; the only field it is sent. */
  path: string
  /** The name to show: the reader's own, or the best reading of the path. */
  name: string
  /** The browser's media type for the bytes. */
  mediaType: string
  /** Which face the chip wears. See {@link attachmentKind}. */
  kind: 'image' | 'file'
}

/** Extensions the panel will offer to preview as an image. */
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|avif)$/i

/**
 * The name to show for an attachment that arrived as a bare path.
 *
 * Stored attachments are `${uuid}__${name}${ext}`, and this strips the UUID
 * half. It is deliberately forgiving: the older, pre-label layout is a bare
 * UUID with no `__` at all, and that has nothing better to offer than itself,
 * so it is shown unchanged rather than mangled.
 *
 * @param path - the absolute path out of the transcript or the composer.
 */
function displayNameOf(path: string): string {
  const file = path.split('/').pop() ?? path
  const at = file.indexOf('__')
  return at === -1 ? file : file.slice(at + 2)
}

/**
 * Which face an attachment wears: the extension decides, not the stored type.
 *
 * This is the {@link displayNameOf} problem in reverse, and it has the same
 * shape: a path recovered from disk carries no media type, and an older
 * attachment carries a bare-UUID name whose extension is the only surviving
 * clue. A transcript's attachment that LOOKS like an image therefore still gets
 * a thumbnail, and one that does not gets a chip — the same rule the composer
 * applies to a fresh paste, minus the type it has not got.
 *
 * @param path - the absolute path.
 */
function attachmentKind(path: string): 'image' | 'file' {
  return IMAGE_EXTENSION.test(path) ? 'image' : 'file'
}

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

/**
 * One message waiting for its turn in front of the web page.
 *
 * `id` is local and exists for React keys and for cancelling exactly one row —
 * it is never sent anywhere. `images` holds the composer's OWN attachment
 * records (see {@link ComposerAttachment}), not raw bytes: the files are
 * already on disk, so a queued message can sit there for as long as the reader
 * needs without holding megabytes of base64 in memory, and a message that is
 * cancelled or fails can be handed back to the composer with its names and
 * thumbnail faces intact.
 */
interface QueuedMessage {
  id: string
  text: string
  images: ComposerAttachment[]
}

/**
 * What one engine-start attempt produced.
 *
 * `'login'` is not a failure: the page came up on the sign-in screen and a
 * visible window is waiting for the reader, so the panel must NOT dress it up
 * as an error — it only has to keep the draft and let the reader sign in.
 */
type EnsureReadyResult = { ok: true } | { ok: false; reason: 'login' | 'failed' | 'cooldown' }

/** How often the panel polls /state — the whole-store reconciliation snapshot. */
/**
 * How long typing settles before the host is asked which conversations match.
 *
 * A conversation's text lives in the host now (see the search effect), so every
 * keystroke is a request; 180 ms is below the point a reader notices and above
 * the point a fast typist produces one request per letter.
 */
const SEARCH_DEBOUNCE_MS = 180

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

/**
 * 会话列表 open/closed state, and how the panel gets it.
 *
 * ONE key, not the two the sidebar used (`dsh-dschat.rail.width` and
 * `dsh-dschat.rail.open`). Width is not a setting a dialog can have — it is
 * measured from the panel, and the panel can be 300px or 1400px wide — so the
 * width key is simply abandoned: a stale value left in a reader's localStorage
 * is read by nothing and costs nothing, which is a better outcome than a
 * migration that could mis-read it.
 *
 * The OPEN key keeps its name on purpose. Every reader who has this panel
 * installed already carries a '0' or a '1' under it, and reusing the key means
 * the preference they set is the preference they keep; renaming it would
 * silently reset the panel to its default for all of them. The name is now
 * historical — the element it describes is no longer a rail — and that is
 * recorded here rather than hidden behind a new key.
 *
 * `'0'` means the list stays closed; anything else (including nothing) starts
 * with it open, which is what an upgrade from the sidebar version did.
 */
const RAIL_OPEN_STORE = 'dsh-dschat.rail.open'

/**
 * Read one persisted string, or `undefined` when it is not there.
 *
 * `fallback` is what a caller wants to hear when storage is UNREADABLE, which
 * is not the same answer as "nothing stored":
 *
 *   · a key that is absent is the reader's own state — they have never touched
 *     the control, and every caller here wants its documented default;
 *   · a storage that THROWS is the document's state. It happens in a sandboxed
 *     iframe, in some private-mode profiles, and in a cross-origin frame whose
 *     storage is blocked — that is, in exactly the environments a plugin's UI
 *     is most likely to be embedded in, and a panel that cannot be screenshotted
 *     or tested because its first render depends on storage access is a panel
 *     nobody can verify.
 *
 * The list defaults to OPEN when nothing is stored (an upgrade from the sidebar
 * version keeps its list), so a frame that cannot touch storage must ask for
 * the CLOSED state explicitly rather than inheriting "open" from a failure.
 * That is what the URL parameter is for — see the note on the call site.
 */
function readStored(key: string, fallback?: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * The initial 会话列表 state for THIS document.
 *
 * Normally the reader's own preference, persisted under {@link RAIL_OPEN_STORE}.
 * A `?dschat-list=open|closed` parameter overrides it, and it exists for one
 * consumer: the design and regression scripts, which mount the real panel in a
 * sandboxed iframe where `localStorage` throws. Those scripts need to state the
 * starting condition the same way a reader would — and this panel already reads
 * its URL for nothing else, so nothing here can collide with the host's routing
 * (`searchParams` is per-document and the host never puts its own keys on a
 * plugin's iframe).
 *
 * An unparseable value is ignored rather than treated as closed: a typo in a
 * script should look like the default, not like a bug in the panel.
 */
function initialListOpen(): boolean {
  try {
    const forced = new URLSearchParams(window.location.search).get('dschat-list')
    if (forced === 'open') return true
    if (forced === 'closed') return false
  } catch {
    // No URL or no search params (a test render with a location stub): fall
    // through to the stored preference.
  }
  return readStored(RAIL_OPEN_STORE, '1') !== '0'
}

/** Persist one string; a refusal is not worth interrupting the user for. */
function writeStored(key: string, value: string | undefined): void {
  try {
    if (value === undefined) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Layout memory only: losing it costs one toggle after the next reload.
  }
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

/**
 * Breathing room above a question the panel has just anchored (px).
 *
 * The scroll target is the row's own top edge, and a row begins with its head
 * line (「你 · 14:07」) — flush against the top of the box that head is inside a
 * hairline the reader cannot tell from a clipped line. 12px is the same gap the
 * thread's own padding uses at the other end, so an anchored question and a
 * pinned transcript start their content the same distance down.
 */
const ANCHOR_TOP_GAP = 12

/**
 * How far the transcript may sit from the anchored position before the panel
 * decides the READER moved it (px).
 *
 * Wide enough to absorb the difference between the position the effect asked
 * for and the one the browser landed on, narrow enough that a deliberate drag
 * off the question releases the anchor almost immediately — a reader who stays
 * put must never be mistaken for one who scrolled away, because that mistake
 * drops the anchor and pins the viewport back to the bottom mid-answer.
 */
const ANCHOR_DRIFT_PX = 32

/**
 * How long a programmatic jump may keep the auto-scroll out of the way (ms).
 *
 * Comfortably longer than a Chromium smooth scroll over a long transcript, and
 * short enough that a reader who starts scrolling mid-jump gets the normal
 * behaviour back immediately afterwards.
 */
const JUMP_SETTLE_MS = 900

/**
 * How long a FAILED engine start suppresses the next automatic one (ms).
 *
 * The composer starts the web page by itself — a click in it, a keystroke in it,
 * a send from it. Without this, a start that fails (no network, a browser that
 * will not launch) would be retried by every one of those, and each attempt is
 * a 45 s `page.goto` against a page that is not coming up. The reader is not
 * left waiting on it either: the failure is on screen with a 「重试启动」 button,
 * and that button ignores this cooldown because it IS the explicit request.
 */
const WAKE_RETRY_COOLDOWN_MS = 10_000

/**
 * How long a SUCCESSFUL start suppresses another one (ms).
 *
 * One click in the composer is two gestures in two separate tasks — focus, then
 * click — and a wake can answer in between, so the click asked a second time.
 * The engine answers both cheaply (it reuses the live page), but "one gesture,
 * one start" is the property this path exists to keep.
 */
const WAKE_FRESH_MS = 2_000

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

  /**
   * The panel's snapshot: conversation SUMMARIES plus the bodies it has fetched.
   *
   * `/state` used to answer with every transcript in full — 5.86 MB on this
   * machine, re-sent every 1.5 s. It now answers with summaries, and a body
   * arrives from `/chat?id=` when a conversation is opened (see `ensureBody`).
   * Everything downstream — rendering, the tail merge, the navigator — still
   * works on messages, so the summarization stops here at the transport edge.
   */
  const [state, setState] = useState<DSchatView | null>(null)
  const [viewChatId, setViewChatId] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<ComposerAttachment[]>([])
  const [attachBusy, setAttachBusy] = useState(false)
  /**
   * True while `ensureReady` is bringing the web page up.
   *
   * The engine does report 'launching', but only on its next snapshot — up to
   * 1.5 s away, which is the whole click. This makes the composer say
   * 「正在启动网页端…」 on the same frame as the click that asked for it.
   */
  const [waking, setWaking] = useState(false)
  /**
   * Why the web page is not usable, when starting it failed.
   *
   * Rendered as a notice IN THE CONVERSATION with a retry button, not as a
   * toast: a launch is a 45 s `page.goto` (and, on a fresh profile, a browser
   * window), so its failure is not a passing remark — it is the reason the
   * message the reader just wrote did not go anywhere, and the thing to fix is
   * one click away. A toast also disappears before a reader who glanced at the
   * browser window gets back.
   */
  const [launchError, setLaunchError] = useState<string | undefined>(undefined)
  /**
   * Messages typed while the previous turn was still generating.
   *
   * The web page answers one question at a time, so a second send cannot be
   * forwarded the moment it is written — but the composer must not refuse it
   * either (that is the "输入框不能用" complaint in its other form). It is held
   * here and leaves the moment the running turn ends.
   */
  const [outbox, setOutbox] = useState<QueuedMessage[]>([])
  /** The 「运行状态」 card, opened from the 「···」 menu. */
  const [statusOpen, setStatusOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  /**
   * Whether 会话列表 is up.
   *
   * The name `railOpen` is historical — the element it describes was a left
   * column until it became a dialog — and it is kept because the storage key it
   * mirrors is kept (see RAIL_OPEN_STORE). Renaming the state without renaming
   * the key would be the worse half of the migration: the saved preference
   * would survive, and nothing in the code would explain why the two names
   * disagree.
   */
  const [railOpen, setRailOpen] = useState<boolean>(initialListOpen)
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
  /*
   * The 「↓ 最新」 pill's visibility.
   *
   * `pinnedRef` cannot drive this: it is a ref (writing it does not re-render),
   * and the pill has to appear the moment the reader scrolls away from the end
   * and disappear the moment they come back.
   */
  const [atBottom, setAtBottom] = useState(true)
  /** True while the transcript actually overflows — the navigator only exists then. */
  const [threadScrolls, setThreadScrolls] = useState(false)
  /** Which question the navigator marks as current (an index into `questions`). */
  const [navIndex, setNavIndex] = useState(0)
  /** The navigator's expanded state: ticks alone, or the whole question list. */
  const [navOpen, setNavOpen] = useState(false)
  /** The rail row currently syncing from the web, if any (spins its own button). */
  const [syncId, setSyncId] = useState<string | undefined>(undefined)
  const [deepThink, setDeepThink] = useState(false)
  const [search, setSearch] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // transfer popover
  const [transferOpen, setTransferOpen] = useState(false)
  /**
   * The status sentence, opened from the header's state lamp.
   *
   * It used to hold four entries as well — the old header 「···」 menu, which
   * moved here because they describe and control the ENGINE and the lamp is the
   * header's one engine-shaped control. They have since moved back out, to the
   * 「···」 on the action row (see `moreMenu`): 运行状态 reads a transcript,
   * 导出 markdown writes one out, 打开登录窗口 and 关闭浏览器 drive the page, so
   * they belong on the row that acts on the conversation — and the lamp, whose
   * whole job is to be legible from the corner of the eye, keeps only the
   * sentence that says what its colour means.
   */
  const [lampOpen, setLampOpen] = useState(false)
  /** The engine menu, opened from the action row's 「···」 (see `moreMenu`). */
  const [moreOpen, setMoreOpen] = useState(false)
  const [transferMode, setTransferMode] = useState<TransferMode>('distill')
  const [transferTarget, setTransferTarget] = useState<'new' | 'continue'>('new')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string | undefined>(undefined)
  const [targetSessionId, setTargetSessionId] = useState<string | undefined>(undefined)
  const [stage, setStage] = useState(0)          // 0 idle, 1..3 running, 4 done
  const [transferring, setTransferring] = useState(false)
  /**
   * The hand-off text the host built, held between 预览 and 确认写入.
   *
   * Nothing has been written while this is set: the reader is looking at the
   * exact bytes that would become the new session's first message, and may edit
   * them. `distilled: false` is the case that matters — distillation is LOSSY,
   * and its failure mode is to replay the raw log instead, which used to arrive
   * as the same success toast as a real brief.
   */
  const [preview, setPreview] = useState<{
    distilled: boolean
    fallback: boolean
    fallbackReason?: string
    chars: number
  } | undefined>(undefined)
  /** The editable draft of that text (确认 sends THIS, not the original). */
  const [previewDraft, setPreviewDraft] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; path: string; title: string }>>([])
  const [cwd, setCwd] = useState<string | undefined>(undefined)

  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  /** The hidden Finder input behind 上传文件 (clicked from the tool row). */
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  /**
   * The popover wrappers, one per floating menu (DSH 迁移, the engine 「···」,
   * and the lamp's status sentence).
   *
   * Their containing boxes, so the outside-click rule can tell "a click inside
   * the menu" from "a click anywhere else" — see the dismiss effect. The
   * transfer one moved into the composer's action row with its trigger; the
   * lamp one is the header's own, and the engine one rides the action row's
   * right end.
   */
  const transferPopRef = useRef<HTMLDivElement | null>(null)
  const lampPopRef = useRef<HTMLDivElement | null>(null)
  const morePopRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)
  /*
   * The question the viewport is ANCHORED to, if any (see the scroll effect).
   *
   * `pinnedRef` and this are the two scroll modes and they are mutually
   * exclusive in practice: pinned keeps the newest line visible, anchored keeps
   * one question's head at the top of the viewport while its answer grows below.
   * A send sets the anchor; switching conversations, a navigator or 「↓ 最新」
   * jump, or a scroll the reader did by hand clears it.
   */
  const anchorIdRef = useRef<string | undefined>(undefined)
  /**
   * Where the last programmatic scroll actually left the transcript.
   *
   * The scroll handler's "did the reader move it?" test compares the live
   * position against THIS, not against a freshly measured row. Re-measuring was
   * the bug behind 「发出去了却看不到自己刚问的那句」: a scroll is CLAMPED at
   * `scrollHeight - clientHeight`, so when the answer below the new question is
   * still shorter than the viewport the browser lands somewhere the effect never
   * asked for, the handler reads that as the reader's own doing, drops the
   * anchor and pins the viewport back to the BOTTOM of the previous answer —
   * exactly the view the anchor exists to replace.
   */
  const anchorAppliedTopRef = useRef<number | undefined>(undefined)
  /*
   * A send that has not produced a message yet.
   *
   * The anchor cannot be taken at send time: the user message only exists in
   * the transcript after the next snapshot, so the id to anchor to is not
   * knowable yet. This says "anchor the row that grows the transcript PAST this
   * many user messages", and the scroll effect consumes it.
   *
   * It is a COUNT rather than a flag because a poll can land between the send
   * and the message it appended: the transcript on screen is then still the old
   * one, whose last user row is the PREVIOUS question — and anchoring to that is
   * literally the reported symptom (「第一条问题留在顶端」). A count only
   * satisfies itself on a row that was not there before the send.
   *
   * `true` is the one case with no new row to wait for: 「重试」 re-asks a
   * question that is already in the transcript, so the view should go to the
   * exchange it is retrying.
   */
  const pendingAnchorRef = useRef<number | true | undefined>(undefined)
  /**
   * How many user messages the transcript held when the anchor was last taken.
   *
   * Consecutive sends in one conversation have to raise the bar, not clear it:
   * cleared, the second send's pending count would sit below the rows already on
   * screen and satisfy itself against the FIRST question.
   */
  const anchorFloorRef = useRef(0)
  /*
   * Until when a programmatic jump owns the viewport.
   *
   * A smooth scroll takes a few hundred milliseconds, and during them the
   * transcript is still at its old position — so the FIRST scroll event of a
   * jump reports "still at the end", and the next `/state` tick (every 100ms
   * while a reply is streaming) would pin the reader straight back to the
   * bottom. That is not hypothetical: it is exactly what made a navigator click
   * do nothing at all while an answer was arriving. While this deadline is in
   * the future both the pin and the 「↓ 最新」 pill stand down and let the jump
   * finish.
   */
  const jumpUntilRef = useRef(0)
  /** Where the jump in flight is heading, so it can hand the viewport back the
   *  moment it arrives rather than at the end of the safety window. */
  const jumpTargetRef = useRef<number | undefined>(undefined)
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
  const imagesRef = useRef<ComposerAttachment[]>([])
  useEffect(() => { imagesRef.current = images }, [images])

  /**
   * The queue as the flush loop must read it.
   *
   * `drainOutbox` runs from an effect AND from a click, and both need the head
   * of the queue as it is right now — reading the state variable would capture
   * whichever array the callback was built with.
   */
  const outboxRef = useRef<QueuedMessage[]>([])
  useEffect(() => { outboxRef.current = outbox }, [outbox])
  /** Local ids for queued rows; never sent anywhere. */
  const queueSeq = useRef(0)
  /** True while one queued message is on its way out (one at a time). */
  const flushingRef = useRef(false)
  /**
   * When the last start attempt failed (epoch ms), for WAKE_RETRY_COOLDOWN_MS.
   * 0 = nothing to suppress.
   */
  const wakeFailedAtRef = useRef(0)
  /**
   * The engine's login state as the callbacks need it right now.
   *
   * `deliver`/`drainOutbox` are `useCallback`s that must not be rebuilt on
   * every snapshot (the flush effect keys on them), so they read the live value
   * through a ref instead of closing over a stale one.
   */
  const loggedInRef = useRef<boolean | null>(null)
  useEffect(() => { loggedInRef.current = state?.loggedIn ?? null }, [state?.loggedIn])

  /*
   * Streaming-feed plumbing.
   *
   * The tail loop must read the CURRENT snapshot without depending on it (a
   * `useEffect` keyed on `state` would tear the loop down ~10×/s), so the
   * snapshot is mirrored into a ref alongside the conversation it should
   * follow.
   */
  // `DSchatView`, not the wire `DSchatState`: this snapshot already has the
  // fetched bodies merged in, which is what every reader of `stateRef` below
  // relies on (`chat.loaded`, `chat.messages`). Typing it as the wire state made
  // those reads invisible to the compiler.
  const stateRef = useRef<DSchatView | null>(null)
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
   * Every conversation body this panel has fetched, keyed by id, with the
   * message count it was fetched AT.
   *
   * Why a cache beside the state: `/chat?id=` and the `/state` poll are two
   * requests in flight at once, and they cross in exactly one place — a
   * conversation the panel has never seen. `refreshState` is what introduces one
   * (「新对话」, a recover, another window, the engine storing the first message
   * of a brand-new chat), and the body request the selection effect fires is
   * answered FIRST routinely. Applying it was a `chats.map` over a list that did
   * not carry the chat yet, i.e. a silent no-op, so nothing marked it loaded —
   * and every later poll then replaced its messages with `[]` while the /tail
   * feed kept putting the ANSWER back into the empty body. That is the whole
   * reported trio: the question never appeared, the transcript blinked between
   * the answer and the empty state once per poll, and a conversation with
   * history rendered as the brand-new-conversation page.
   *
   * The COUNT is what makes a cached body usable rather than merely present: a
   * body that no longer agrees with the summary is not applied, it is refetched.
   */
  const bodiesRef = useRef(new Map<string, { messages: DSchatMessage[]; count: number }>())

  /**
   * The conversation the panel means to display, as the body fetcher needs it.
   *
   * `refreshState` has to know which conversation is on screen to decide what
   * still needs a body, and it must not re-subscribe the poll loop on every
   * switch (the loop is keyed on `refreshState`). The state variable is mirrored
   * here for that read; it is written on commit, which is always before the next
   * response lands.
   */
  const viewChatIdRef = useRef<string | undefined>(undefined)
  useEffect(() => { viewChatIdRef.current = viewChatId }, [viewChatId])

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
      const next = snapshot as unknown as DSchatView
      /*
       * Which conversation the snapshot leaves on screen. A selection the reader
       * made that the snapshot still carries is kept; otherwise the host's
       * active conversation (or the newest) wins. Decided here rather than inside
       * a `setViewChatId` updater because the body check below needs the same
       * answer.
       */
      const current = viewChatIdRef.current
      const viewId = current !== undefined && next.chats.some(chat => chat.id === current)
        ? current
        : next.activeChatId ?? next.chats[0]?.id
      /*
       * Which bodies this snapshot invalidates, decided against the snapshot the
       * panel is HOLDING (`stateRef`) rather than inside the updater: the same
       * comparison runs in both places, and a side effect in a state updater runs
       * twice under StrictMode.
       *
       * The count is the one thing `/state` still knows about a conversation's
       * contents, which makes it the staleness oracle: a body of 4 messages
       * against a summary of 5 means the conversation grew without this panel
       * (the reader's own send, an import, a recover, another window), and
       * keeping the 4 would silently show a transcript that is missing a turn.
       * A conversation with no body at all is fetched only while it is the one
       * on screen — the point of summaries is that the rest of the history is
       * never pulled in.
       */
      const pending: string[] = []
      const held = stateRef.current
      const bodies = bodiesRef.current
      for (const chat of next.chats) {
        const previous = held?.chats.find(candidate => candidate.id === chat.id)
        const live = previous?.loaded === true ? previous.messages : undefined
        const cached = bodies.get(chat.id)
        const body = live
          ?? (cached !== undefined && cached.count === chat.messageCount ? cached.messages : undefined)
        if (body !== undefined && body.length !== chat.messageCount) pending.push(chat.id)
        else if (body === undefined && chat.id === viewId && chat.messageCount > 0) pending.push(chat.id)
      }
      setState(previousView => ({
        ...next,
        chats: next.chats.map(chat => {
          const previous = previousView?.chats.find(candidate => candidate.id === chat.id)
          /*
           * A body the panel holds is KEPT: re-fetching the open conversation on
           * every tick would put back the traffic the summaries removed. The
           * cache covers the body whose chat the snapshot had not introduced yet
           * — the case where the fetch resolved first (see `bodiesRef`).
           */
          const live = previous?.loaded === true ? previous.messages : undefined
          const cached = bodies.get(chat.id)
          const body = live
            ?? (cached !== undefined && cached.count === chat.messageCount ? cached.messages : undefined)
          if (body !== undefined) return { ...chat, messages: body, loaded: true }
          /*
           * No authoritative body. A conversation with something already on
           * screen keeps it: the answer the tail feed just appended is real, and
           * blinking it away IS the flicker this path exists to remove. It stays
           * `loaded: false` so the fetch queued above — or the selection effect —
           * is still what makes it authoritative.
           */
          if (previous !== undefined && previous.messages.length > 0) {
            return { ...chat, messages: previous.messages, loaded: false }
          }
          return { ...chat, messages: [] }
        }),
      }))
      for (const id of pending) void ensureBody(id, true)
      setViewChatId(viewId)
    } catch {
      // A transient failure keeps the previous snapshot on screen; the poll
      // loop retries on its own.
    }
  }, [api])

  /**
   * Fetch one conversation's body, unless it is already loaded.
   *
   * The body is what the panel renders, searches within (the navigator), quotes,
   * exports and transfers, so "opening a conversation" has to mean fetching it.
   * `loading` is tracked separately from the view because the fetch is async and
   * two callers (the effect below and the tail loop) can want the same chat at
   * once — one request, not two.
   */
  const bodyRequests = useRef(new Map<string, Promise<void>>())
  const ensureBody = useCallback(async (chatId: string | undefined, force = false): Promise<void> => {
    if (chatId === undefined) return
    const current = stateRef.current?.chats.find(chat => chat.id === chatId)
    // `force` is for the caller that KNOWS the body moved on — the send path,
    // and the staleness check in `refreshState`. Without it a loaded body is left
    // alone, which is what keeps the 1.5 s poll off the wire for the open
    // conversation.
    if (!force && current?.loaded === true) return
    if (bodyRequests.current.has(chatId)) return bodyRequests.current.get(chatId)
    const request = (async () => {
      try {
        const answer = await api.chat(chatId)
        if (answer.ok !== true || answer.chat === undefined) return
        const messages = answer.chat.messages
        /*
         * Cached as well as applied, because the two can disagree about whether
         * the conversation exists yet: the selection effect fires on the tick the
         * panel selects a chat the snapshot has not introduced (`refreshState` is
         * what introduces it, and its response is still in flight), and applying
         * a body to a list without that chat is a no-op. The cache is what
         * carries it across; `refreshState` applies it the moment the summary
         * arrives — see `bodiesRef`.
         */
        bodiesRef.current.set(chatId, { messages, count: messages.length })
        setState(previous => previous === null ? previous : {
          ...previous,
          chats: previous.chats.map(chat => (chat.id === chatId
            ? { ...chat, messages, messageCount: messages.length, loaded: true }
            : chat)),
        })
      } catch {
        // A body that will not load leaves the summary on screen; opening the
        // conversation again retries.
      } finally {
        bodyRequests.current.delete(chatId)
      }
    })()
    bodyRequests.current.set(chatId, request)
    return request
  }, [api])

  /**
   * Whatever is on screen must have its body.
   *
   * One effect covers every way the viewed conversation changes — a click, the
   * first snapshot, a new chat, a transfer — because they all go through
   * `viewChatId`.
   */
  useEffect(() => { void ensureBody(viewChatId) }, [viewChatId, ensureBody])

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

  /* ------------------------------------------------- 会话列表 (dialog) state */

  /**
   * Show/hide the conversation list, remembering the choice.
   *
   * Opening also cancels an in-flight rename. The rename box lives INSIDE the
   * list, so a row left in edit mode when the list closed would come back
   * mid-edit on the next open — with a draft the reader typed minutes ago and
   * no memory of typing. Cancelling is the only state that survives a close
   * without lying about what happened.
   */
  const toggleRail = useCallback((): void => {
    setRailOpen(previous => {
      const next = !previous
      writeStored(RAIL_OPEN_STORE, next ? '1' : '0')
      if (next) setRenamingId(undefined)
      return next
    })
  }, [])

  /**
   * Close the list. The single exit for every way out — the trigger's second
   * press, a click outside, Escape, and picking a conversation.
   */
  const closeList = useCallback((): void => {
    setRailOpen(false)
    writeStored(RAIL_OPEN_STORE, '0')
    setRenamingId(undefined)
  }, [])

  /**
   * How much room the list popover has, measured rather than assumed.
   *
   * The popover opens upward from the action row, so its ceiling is the distance
   * from the trigger's top edge to the top of the space it opens into — a number
   * CSS cannot work out on its own here. It cannot be a percentage: the panel is
   * absolutely positioned, so `max-height: 100%` resolves against the trigger's
   * box (30px), and there is no definite height anywhere above it to inherit.
   *
   * THE ARITHMETIC, because the two offsets are easy to count twice:
   *
   *   wrapTop        the trigger's top edge, measured from the BODY's top edge —
   *                  the body is the column below the header, so the header's own
   *                  height is accounted for and whatever the shell paints above
   *                  the panel is irrelevant. A 560px panel measures 300px here;
   *   - TRIGGER_GAP  the 8px the stylesheet already puts between the popover and
   *                  its trigger (`bottom: calc(100% + 8px)`). It is part of the
   *                  positioning, so it has to come out of the available room —
   *                  and it is ALSO the entire gutter: subtracting one more pixel
   *                  for air is subtracting the same 8px a second time, which is
   *                  what a first version of this did by using 10 and what made
   *                  the list read as 有点矮. (It also made the popover's top edge
   *                  land 4px INSIDE the header, which the same measurement
   *                  caught: gapBelowHeader came out negative.)
   *
   * So the popover's top edge lands exactly on the body's top edge — flush under
   * the header's hairline — and every pixel that is not the trigger gap is a row
   * the reader can see.
   *
   * The value lands on `.dsh-dschat-pop-wrap` as `--dschat-list-avail`, and the
   * stylesheet spends it as the popover's max-height. It is measured on EVERY
   * open (not once) and re-measured whenever the panel resizes: the row sits
   * below a transcript that grows and scrolls, a queue that appears and
   * disappears between the field and the tool row, and an attachment strip that
   * wraps — all of which move this button. A value taken at mount would be wrong
   * the first time a reader attached a file.
   */
  const listWrapRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const wrapper = listWrapRef.current
    /*
     * Measured from the BODY, not from the panel.
     *
     * The body is the column below the header, so its top edge is the first row
     * the popover is allowed to occupy — measuring from the panel's own top
     * would hand the popover the 52px the header occupies, and in a short window
     * that is exactly where it went: at a 560px panel the popover's top landed
     * at y=2, i.e. underneath the header's hairline. `.dsh-dschat-body` is the
     * right anchor because it is the box the transcript scrolls in, which is the
     * space the popover actually opens into.
     */
    const body = wrapper?.closest('.dsh-dschat-body')
    if (!wrapper || !(body instanceof HTMLElement)) return
    /**
     * The one offset that has to come out: the trigger gap the stylesheet sets.
     *
     * `bottom: calc(100% + 8px)` places the popover 8px above the trigger, so the
     * room left for it is `wrapTop - 8`. Reserved as a constant rather than read
     * back from `getComputedStyle`, because it is a literal in the same stylesheet
     * this file ships; the two would have to be changed together either way.
     *
     * There is deliberately NO extra air here. The popover's top edge lands flush
     * on the body's top edge, which is the header's bottom hairline — that is the
     * nearest to the top the list can be while staying out of the header, and
     * padding the difference is exactly the slack that made it read as too short.
     */
    const TRIGGER_GAP = 8
    /** Never so small that the menu is a slit; 120px is about two rows. */
    const MIN_ROOM = 120
    const measure = (): void => {
      const wrapTop = wrapper.getBoundingClientRect().top - body.getBoundingClientRect().top
      const room = Math.max(MIN_ROOM, Math.round(wrapTop - TRIGGER_GAP))
      wrapper.style.setProperty('--dschat-list-avail', `${room}px`)
      /*
       * The same number as a HEIGHT, and it has to be written here rather than
       * resolved in CSS.
       *
       * The panel fills the room it was given instead of shrinking to its rows —
       * see the stylesheet — but `height: 100%` cannot express that: the popover's
       * containing block is the wrapper, and the wrapper is a shrink-to-fit flex
       * item with no definite height, so a percentage resolves to `auto` and the
       * rows would simply not fill. The measured number is the only definite
       * length in this chain, so the panel hands it over.
       */
      wrapper.style.setProperty('--dschat-list-h', `${room}px`)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    /*
     * The BODY is observed, not the wrapper: the wrapper is a 30px-tall flex
     * item whose own box does not change when the composer above it grows — only
     * its POSITION does — and the body's box changes with every layout change
     * that can move it (the window, the queue, the phase line, the attachment
     * strip). Observing the body catches all of them, including a window resize
     * that leaves the wrapper's own size untouched.
     */
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    return () => { observer.disconnect() }
  }, [railOpen])

  /**
   * A click anywhere outside the popover closes it.
   *
   * `pointerdown`, not `click`: a menu that waits for the full press-and-release
   * to disappear has already let the reader start a text selection under it, and
   * every platform menu dismisses on the press.
   *
   * The `contains` guard is belt-and-braces — the listener is attached in an
   * effect, which runs after the click that opened the popover has finished
   * propagating, so it cannot see its own opening — but it also covers the
   * presses that START inside the popover and end outside it, which the
   * browser reports on the popover's own subtree.
   *
   * Listening on `document` rather than on the panel is deliberate: a click on
   * the transcript, the header, the shell's own chrome or a spot outside the
   * window's panel seat is all "outside this menu", and the reader means the
   * same thing by all of them.
   */
  useEffect(() => {
    if (!railOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && listWrapRef.current?.contains(target) === true) return
      closeList()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [railOpen, closeList])

  /**
   * Open the conversation-list search.
   *
   * "Search" means "open the list and put the cursor in its box" — there is no
   * state left in which a search box exists but the reader cannot see it. The
   * focus still has to wait for the render that mounts the input: focusing in
   * the same tick is a no-op, and ⌘K would look like it did nothing. The
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

  /* ------------------------------------------------------------ composer size */

  /**
   * The tallest the composer may grow before it scrolls internally (px).
   *
   * Mirrors `max-height` in styles.ts; the two must agree or the clamped height
   * and the stylesheet's own cap fight each other.
   *
   * Raised 180 → 220 together with the floor below, so the box keeps growing
   * for about the same number of lines before it starts scrolling instead of
   * gaining three lines of room and losing the range above them.
   */
  const COMPOSER_MAX_HEIGHT = 220

  /**
   * Grow the composer with its content, up to the cap.
   *
   * A `rows={1}` textarea with a fixed min-height shows ~2 lines and scrolls
   * everything else out of sight, so a long prompt was written through a slit —
   * and the stylesheet's `max-height: 220px` was dead code, because nothing ever
   * changed the element's height. Measuring `scrollHeight` is the only reliable
   * way to do it, and the height must be reset to `auto` first: measuring on top
   * of the previous (larger) height can never shrink the box back.
   *
   * The EMPTY box's height is not decided here at all: it is the stylesheet's
   * `min-height`, because `scrollHeight` of an empty textarea is one line and
   * this function would happily shrink the box back to it. See the note on
   * `.dsh-dschat-input` for why that floor is three lines.
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
  /*
   * Whether the send control is armed.
   *
   * NOT gated on the engine or on a running turn any more: the composer starts
   * the page itself when it is down, and a turn in flight takes the message into
   * the outbox instead of refusing it. The only thing that makes "send" wrong is
   * an empty box.
   */
  const canSend = draft.trim() !== '' || images.length > 0

  /*
   * The conversation's questions, in order.
   *
   * A user message IS a question here: the web keeps one user turn per question,
   * so this list is exactly "what was asked" — the navigator's rows, and the set
   * of messages a send may anchor to.
   */
  const questions = useMemo(
    () => (viewChat?.messages ?? [])
      .filter(message => message.role === 'user')
      .map(message => ({
        id: message.id,
        text: message.content.trim() === '' ? tr('qnav.attachment') : message.content,
      })),
    [viewChat, tr],
  )

  /**
   * Which conversations match the query.
   *
   * Title matches are decided here (instant, no round trip, and that is what a
   * reader is usually typing). MESSAGE matches are asked of the host, which is
   * where the text is: this filter used to scan the messages the panel held,
   * which only worked while `/state` shipped the whole store — with summaries it
   * would quietly stop finding anything outside the conversations that happen to
   * be open.
   *
   * Debounced, and the previous answer is kept while the next one is in flight,
   * so typing does not make rows flicker.
   */
  const [messageHits, setMessageHits] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const needle = query.trim()
    if (needle === '') {
      setMessageHits(new Set())
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void api.searchConversations(needle)
        .then(answer => {
          if (cancelled || answer.ok !== true) return
          setMessageHits(new Set(answer.ids ?? []))
        })
        .catch(() => undefined)
    }, SEARCH_DEBOUNCE_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [api, query])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return chats
    return chats.filter(chat => chat.title.toLowerCase().includes(needle) || messageHits.has(chat.id))
  }, [chats, query, messageHits])

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

  /**
   * One message's top edge, measured inside the scroll box.
   *
   * `offsetTop` would be wrong here: it is relative to the nearest POSITIONED
   * ancestor, not to the scroller, and every message row is itself
   * `position: relative` (the hover toolbar rides it). Rect arithmetic against
   * the scroll box is the honest measure at any nesting depth.
   *
   * @param list - the scroll box.
   * @param element - the row to measure.
   */
  const contentTop = useCallback((list: HTMLElement, element: Element): number => {
    return element.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
  }, [])

  /**
   * Put a question's head at the top of the viewport.
   *
   * This is the whole of the 「新提问置顶」 behaviour: after a send, the question
   * the reader just asked becomes the top of the visible conversation, so the
   * answer streams into the space BELOW it. Reading an answer from its first
   * line no longer costs a scroll — and, just as important, arriving tokens no
   * longer push the text being read up the screen.
   *
   * @param id - the user message to align.
   * @param behavior - 'smooth' for a navigator click, instant for a send.
   * @returns true when the row was found and the scroll applied.
   */
  const alignQuestion = useCallback((id: string, behavior: ScrollBehavior = 'auto'): boolean => {
    const list = listRef.current
    if (list === null) return false
    const target = list.querySelector(`[data-message-id="${id}"]`)
    if (target === null) return false
    const top = Math.max(0, contentTop(list, target) - ANCHOR_TOP_GAP)
    if (behavior === 'smooth') jumpTargetRef.current = top
    list.scrollTo({ top, behavior })
    /*
     * What the browser will actually apply: the requested top, clamped to the
     * scrollable range. Recorded for the scroll handler rather than re-measured
     * there — see `anchorAppliedTopRef`.
     */
    if (behavior === 'auto') {
      anchorAppliedTopRef.current = Math.min(top, Math.max(0, list.scrollHeight - list.clientHeight))
    }
    return true
  }, [contentTop])

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
    if (switched) {
      // A different conversation has no anchor: it opens at its end, as before.
      // This runs BEFORE the pending send is consumed, because a send can BE
      // what switched the conversation (the first message of a brand-new chat):
      // clearing afterwards threw away the anchor the reader had just asked for.
      anchorIdRef.current = undefined
      anchorAppliedTopRef.current = undefined
      pendingAnchorRef.current = undefined
    }
    /*
     * Consume a pending send.
     *
     * The message the reader just wrote only exists once the snapshot carrying
     * it arrives — and the snapshot that arrives FIRST is regularly the OLD one,
     * because `/state` was already in flight when the send landed. So the anchor
     * is only taken from a user row that grew the transcript past the count the
     * send recorded; anything else is a previous question, and anchoring to one
     * of those is the reported 「新提问没有置顶」 bug.
     */
    const pendingAnchor = pendingAnchorRef.current
    if (pendingAnchor !== undefined) {
      const users = list.querySelectorAll('[data-role="user"]')
      const last = users[users.length - 1]
      const isNew = last !== undefined
        && (pendingAnchor === true || users.length > Math.max(pendingAnchor, anchorFloorRef.current))
      if (isNew) {
        pendingAnchorRef.current = undefined
        anchorIdRef.current = last.getAttribute('data-message-id') ?? undefined
        anchorFloorRef.current = users.length
      }
    }
    if (anchorIdRef.current !== undefined) {
      // Instant on purpose: this runs on every streamed token, and a smooth
      // scroll per token would never settle.
      if (alignQuestion(anchorIdRef.current)) return
      // The anchor's row is gone (a recover replaced the transcript): fall back
      // to following the end rather than leaving the reader parked.
      anchorIdRef.current = undefined
      anchorAppliedTopRef.current = undefined
    }
    if (switched || (pinnedRef.current && Date.now() >= jumpUntilRef.current)) {
      list.scrollTop = list.scrollHeight
    }
    /*
     * `launchError` is a dependency because the notice it renders lands at the
     * BOTTOM of the transcript: a failure that appears below the fold is a
     * failure the reader never sees, which is the whole complaint this notice
     * answers. Arriving here also means the reader was already pinned to the
     * end — a reader who scrolled up to read is not yanked away by it.
     */
  }, [state, viewChatId, jumpId, launchError, alignQuestion])

  /**
   * Everything the transcript's scroll position has to keep true.
   *
   * Three readers, one handler: a single scroll event has to answer all three
   * questions at once, and three listeners would only add three chances to
   * disagree.
   *
   *   · 跟随最新 — are we close enough to the end that the next token may move
   *     the viewport? (`pinnedRef`, plus the 「↓ 最新」 pill's state.)
   *   · 锚点让位 — did the reader take the wheel? An anchor that survived a
   *     manual scroll would yank them back on the next token, which is exactly
   *     the behaviour the anchor exists to remove.
   *   · 导航当前条 — which question is the top of the viewport inside?
   *
   * The anchor test is "is the view where WE put it", and it is answered against
   * `anchorAppliedTopRef` — the position our own scroll recorded — rather than by
   * measuring the row again. Re-measuring looks equivalent and is not: a scroll
   * is clamped at the end of the content, so a question whose answer is still
   * shorter than the viewport leaves the transcript at a position the effect
   * never asked for, which the old test read as 'the reader moved it', dropped
   * the anchor and pinned the viewport to the BOTTOM of the previous answer.
   * Anything further than the tolerance below is the reader's own doing, and the
   * anchor steps aside rather than fighting them for the viewport.
   */
  const onThreadScroll = useCallback((): void => {
    const list = listRef.current
    if (list === null) return
    const gap = list.scrollHeight - list.scrollTop - list.clientHeight
    /*
     * Hand the viewport back the moment a jump lands. The deadline below is only
     * the safety net for one that never arrives (an interrupted animation, a
     * row that vanished mid-flight).
     */
    const target = jumpTargetRef.current
    if (target !== undefined && Math.abs(list.scrollTop - target) <= 2) {
      jumpTargetRef.current = undefined
      jumpUntilRef.current = 0
    }
    // A jump in flight is not "the reader sitting at the end" even though the
    // transcript has not moved yet — see `jumpUntilRef`.
    const pinned = gap < 96 && Date.now() >= jumpUntilRef.current
    pinnedRef.current = pinned
    setAtBottom(current => (current === pinned ? current : pinned))
    const scrolls = list.scrollHeight > list.clientHeight + 24
    setThreadScrolls(current => (current === scrolls ? current : scrolls))
    const anchor = anchorIdRef.current
    if (anchor !== undefined) {
      const applied = anchorAppliedTopRef.current
      if (list.querySelector(`[data-message-id="${anchor}"]`) === null) {
        // The anchor's row is gone (a recover replaced the transcript).
        anchorIdRef.current = undefined
        anchorAppliedTopRef.current = undefined
      } else if (applied !== undefined && Math.abs(list.scrollTop - applied) > ANCHOR_DRIFT_PX) {
        // The reader scrolled away from the anchor we set.
        anchorIdRef.current = undefined
        anchorAppliedTopRef.current = undefined
      }
    }
    /*
     * The navigator's current row: the LAST question whose head has already
     * reached the top of the viewport, i.e. the one the reader is inside. Its
     * rows are the same `[data-role="user"]` nodes the thread renders, so the
     * index lines up with `questions` by construction (both are the user
     * messages, in order).
     */
    const rows = list.querySelectorAll('[data-role="user"]')
    if (rows.length > 0) {
      let index = 0
      for (let i = 0; i < rows.length; i += 1) {
        if (contentTop(list, rows[i]) - list.scrollTop <= 24) index = i
      }
      setNavIndex(current => (current === index ? current : index))
    }
  }, [contentTop])

  /** The 「↓ 最新」 pill: hand the viewport back to the newest line. */
  const jumpToLatest = useCallback((): void => {
    const list = listRef.current
    if (list === null) return
    anchorIdRef.current = undefined
    anchorAppliedTopRef.current = undefined
    pinnedRef.current = true
    jumpUntilRef.current = Date.now() + JUMP_SETTLE_MS
    jumpTargetRef.current = Math.max(0, list.scrollHeight - list.clientHeight)
    setAtBottom(true)
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [])

  /**
   * A navigator click: jump to one question, and let the reader see it land.
   *
   * No anchor is taken. Anchoring exists to stop the NEXT tick from re-pinning
   * the viewport, and a jump already clears `pinnedRef` — while a smooth scroll
   * would trip the scroll handler's "the reader moved it" test on its first
   * frame and drop the anchor again. A jump is a one-shot move; an answer
   * growing further down the transcript does not move the rows above it either
   * way.
   */
  const jumpToQuestion = useCallback((id: string): void => {
    anchorIdRef.current = undefined
    anchorAppliedTopRef.current = undefined
    pinnedRef.current = false
    jumpUntilRef.current = Date.now() + JUMP_SETTLE_MS
    setAtBottom(false)
    if (alignQuestion(id, 'smooth')) setFlashId(id)
    else setJumpId(id)
  }, [alignQuestion])

  /**
   * Keep `threadScrolls` honest when the transcript changes without a scroll.
   *
   * Every scroll event refreshes it, but a conversation that is swapped in for a
   * SHORTER one never fires one: the panel would keep the navigator on screen
   * (and keep the reading column narrowed for it) over a transcript that fits.
   * One boolean per snapshot is the whole cost.
   */
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const scrolls = list.scrollHeight > list.clientHeight + 24
    setThreadScrolls(current => (current === scrolls ? current : scrolls))
  }, [state, viewChatId])

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
   *
   * It is called from the ordinary gestures of a composer that is ALWAYS
   * editable — a click in it, a keystroke in it, Enter in it — so it is also the
   * place that has to be honest when starting fails: the reason goes on screen
   * (in the conversation, next to the message that could not be sent) instead of
   * into a toast that is gone before the reader looks back from the browser
   * window. See `launchError`.
   *
   * @param options.force - true for the explicit 「重试启动」 button, which must
   *   not be swallowed by the cooldown a previous failure armed.
   */
  const wakeRef = useRef<Promise<EnsureReadyResult> | null>(null)
  /**
   * When a start last SUCCEEDED (epoch ms).
   *
   * `wakeRef` coalesces calls that overlap, but one click in the box is two
   * gestures in two tasks — focus, then click — and the first wake can answer in
   * between, so the click asked again. Both are answered cheaply (the engine
   * reuses the live page), but the point of this panel's wake path is that one
   * gesture costs one start, so a start that just worked is not repeated for
   * this long.
   */
  const wakeOkAtRef = useRef(0)
  const ensureReady = useCallback(async (options?: { force?: boolean }): Promise<EnsureReadyResult> => {
    if (wakeRef.current !== null) return await wakeRef.current
    /*
     * A start that just failed is not retried by the next keystroke. The reader
     * is not stuck on it: the notice on screen carries the reason and a button.
     */
    if (options?.force !== true && Date.now() < wakeFailedAtRef.current) return { ok: false, reason: 'cooldown' }
    if (options?.force !== true && Date.now() - wakeOkAtRef.current < WAKE_FRESH_MS) return { ok: true }
    const task = (async (): Promise<EnsureReadyResult> => {
      setWaking(true)
      try {
        const woken = await api.wake().catch(() => undefined)
        if (woken === undefined) {
          const message = tr('engine.notice.unreachable')
          wakeFailedAtRef.current = Date.now() + WAKE_RETRY_COOLDOWN_MS
          setLaunchError(message)
          return { ok: false, reason: 'failed' }
        }
        if (woken.ok !== true) {
          /*
           * A host that predates `/wake` answers 404 — and that pairing is REAL,
           * not hypothetical: the two halves are installed together but loaded
           * independently (the browser half is fetched from disk, the host half
           * is a module generation that only a Harness restart replaces), so a
           * page refresh after an upgrade meets exactly this. Falling back to
           * the login route keeps the composer working, and the notice says why
           * the automatic start did not answer; on a matching host the wake
           * answers and this branch never runs.
           */
          if (/HTTP 404/.test(woken.error ?? '')) {
            await api.openLogin().catch(() => undefined)
            wakeFailedAtRef.current = Date.now() + WAKE_RETRY_COOLDOWN_MS
            setLaunchError(tr('engine.notice.staleHost'))
            return { ok: false, reason: 'failed' }
          }
          wakeFailedAtRef.current = Date.now() + WAKE_RETRY_COOLDOWN_MS
          setLaunchError(explain(woken, tr('toast.wake.failed'), tr))
          return { ok: false, reason: 'failed' }
        }
        if (woken.loggedIn === true) {
          wakeFailedAtRef.current = 0
          wakeOkAtRef.current = Date.now()
          setLaunchError(undefined)
          return { ok: true }
        }
        /*
         * Up, but on the sign-in screen. `loginWindow` already true means the
         * wake itself opened the visible window (a profile with no history at
         * all goes straight there) — asking again would dispose that fresh
         * window and open a second one.
         */
        if (woken.loginWindow !== true) {
          const opened = await api.openLogin().catch(() => undefined)
          if (opened !== undefined && opened.ok !== true && opened.error !== undefined) {
            wakeFailedAtRef.current = Date.now() + WAKE_RETRY_COOLDOWN_MS
            setLaunchError(opened.error)
            return { ok: false, reason: 'failed' }
          }
        }
        /*
         * A window is waiting for the reader, so this is not an error — but it
         * is also not silence: without a word, a message typed before signing in
         * looks like it vanished. The notice carries the actionable half (a
         * 「打开登录窗口」 button), so it is shown here too.
         */
        setLaunchError(tr('engine.notice.needLogin'))
        return { ok: false, reason: 'login' }
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
  }, [api, tr, refreshState])

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
    /*
     * Retry re-asks a question that is already in the transcript, so the anchor
     * is taken from the existing last user row rather than from a new one — the
     * reader is retrying THAT exchange and should be looking at it.
     */
    pendingAnchorRef.current = true
    tailUntilRef.current = Date.now() + TAIL_AFTER_SEND_MS
    const result = await api.send(lastUser.content, lastUser.attachments).catch(() => undefined)
    if (result !== undefined && result.ok !== true) {
      pendingAnchorRef.current = undefined
      toast(explain(result, '', tr), { error: true })
    } else void refreshState()
  }, [chats, viewChatId, busy, api, toast, refreshState])

  /**
   * Push a message back where the reader can see it after a failed send.
   *
   * The composer is cleared the moment a message is accepted (a message on its
   * way must not still be editable in the box), so every failure has to put it
   * back: a logged-out engine, a browser that would not start or a rejected
   * attach used to silently cost the reader a paragraph they had just written.
   * Nothing is overwritten if they have already started typing something else.
   */
  const restoreComposer = useCallback((text: string, sentImages: ComposerAttachment[]): void => {
    setDraft(current => (current === '' ? text : current))
    if (sentImages.length > 0) setImages(current => (current.length === 0 ? sentImages : current))
  }, [])

  /** Hold one message until the running turn ends. See QueuedMessage. */
  const enqueue = useCallback((text: string, queuedImages: ComposerAttachment[]): void => {
    queueSeq.current += 1
    setOutbox(list => [...list, { id: `q-${queueSeq.current}`, text, images: queuedImages }])
    toast(tr('toast.send.queued'))
  }, [toast, tr])

  const dropQueued = useCallback((id: string): void => {
    setOutbox(list => list.filter(item => item.id !== id))
  }, [])

  /**
   * Put one message on the wire, starting the page first when it is down.
   *
   * The return value is what the caller needs to know, and it is deliberately
   * four-way rather than ok/not-ok:
   *
   *   - `sent`   the page took it; the reply streams into the transcript;
   *   - `stored` the page took it into the TRANSCRIPT but the reply never
   *              started — the message must not be sent twice, so the toast
   *              offers 「重试」 instead of the composer getting its text back;
   *   - `busy`   the previous turn was still running (the panel's snapshot lags
   *              the engine by up to a poll), which the queue answers;
   *   - `failed` nothing reached the page; the CALLER decides whether the text
   *              goes back into the composer or stays in the queue.
   *
   * @param text - the message.
   * @param sentImages - attachments already persisted by `/attach`.
   */
  const deliver = useCallback(async (
    text: string,
    sentImages: ComposerAttachment[],
  ): Promise<'sent' | 'stored' | 'busy' | 'failed'> => {
    if (loggedInRef.current !== true) {
      // The reader's intent is unambiguous (they wrote a message and submitted
      // it), so start the page rather than refusing. A failure here has already
      // put its reason on screen — see ensureReady.
      const ready = await ensureReady()
      if (ready.ok !== true) return 'failed'
    }
    pinnedRef.current = true
    /*
     * Ask the scroll effect to anchor the question this send is about to append.
     *
     * The message does not exist yet — it lands in the transcript on a LATER
     * snapshot than the one the panel is holding — so the anchor is taken
     * there, from the first user row that grows the transcript past the count
     * recorded here. That count is measured in the DOM rather than read off the
     * snapshot: it is the same list the effect counts, so a poll that was
     * already in flight cannot make the two disagree. See the effect's "consume
     * a pending send" block.
     */
    pendingAnchorRef.current = listRef.current?.querySelectorAll('[data-role="user"]').length ?? 0
    // Start tailing now rather than when /state next reports busy: the gap
    // between Enter and the first token is exactly when a stalled panel looks
    // broken. The deadline expires on its own, so a send that fails cannot
    // leave the loop polling.
    tailUntilRef.current = Date.now() + TAIL_AFTER_SEND_MS
    // Only the PATHS cross the wire: the name, type and kind are the panel's
    // own presentation, and the host/engine address files by path.
    const paths = sentImages.map(item => item.path)
    let result: Awaited<ReturnType<DSchatApi['send']>>
    try {
      result = await api.send(text, paths.length > 0 ? paths : undefined)
    } catch (error) {
      // Nothing reached the page, so there is no question to anchor to; a
      // pending flag left standing would anchor the NEXT render to whatever
      // user message happened to be last.
      pendingAnchorRef.current = undefined
      toast(String(error), { error: true })
      return 'failed'
    }
    if (result.ok === true) {
      if (result.chatId !== undefined) setViewChatId(result.chatId)
      // The first exchange pins the chat's title and the user message is already
      // stored, so pull the snapshot now instead of waiting out the slow poll.
      void refreshState()
      return 'sent'
    }
    if (result.code === 'BUSY') {
      // The queue owns this message now; its own send raises the flag again.
      pendingAnchorRef.current = undefined
      return 'busy'
    }
    if (result.stored === true) {
      /*
       * `pendingAnchorRef` is deliberately LEFT SET: the message really is in
       * the transcript, so the anchor is exactly what the reader wants — the
       * question at the top, with the retry the toast offers landing under it.
       */
      toast(explain(result, tr('toast.send.failed'), tr), {
        error: true,
        action: { label: tr('msg.retry'), run: () => { void retry() } },
      })
      return 'stored'
    }
    /*
     * A send-level failure gets a toast: the notice covers "the page would not
     * come up", which is a different sentence and is already on screen.
     */
    pendingAnchorRef.current = undefined
    toast(explain(result, tr('toast.send.failed'), tr), { error: true })
    return 'failed'
  }, [api, ensureReady, refreshState, retry, toast, tr])

  /**
   * Send the oldest queued message, if the page is free.
   *
   * One at a time, and only while the engine is signed in and no failure is on
   * screen: a queue that kept retrying against a dead engine would spin once per
   * snapshot forever. A failure therefore leaves its message in the queue and
   * re-arms the notice, whose 「重试启动」 button is what resumes the drain.
   */
  const drainOutbox = useCallback(async (): Promise<void> => {
    if (flushingRef.current) return
    const next = outboxRef.current[0]
    if (next === undefined) return
    flushingRef.current = true
    try {
      const outcome = await deliver(next.text, next.images)
      if (outcome === 'sent' || outcome === 'stored') {
        setOutbox(list => list.filter(item => item.id !== next.id))
        return
      }
      if (outcome === 'busy') return
      setLaunchError(previous => previous ?? tr('engine.notice.queued'))
    } finally {
      flushingRef.current = false
    }
  }, [deliver, tr])

  /**
   * The queue's own clock: drain whenever a turn ends.
   *
   * `busy`/`streaming` both have to be clear — the panel's snapshot can still
   * say idle for a moment after the engine has started the next turn, and the
   * `streaming` flag on the transcript is the earlier of the two signals.
   */
  useEffect(() => {
    if (outbox.length === 0) return
    if (busy || streaming) return
    if (launchError !== undefined) return
    void drainOutbox()
  }, [outbox, busy, streaming, launchError, drainOutbox])

  /**
   * The engine came up: whatever the notice was about is over.
   *
   * A sign-in the reader completed in the browser window lands here within one
   * poll, which is what clears the 「请登录」 notice without them having to
   * dismiss it.
   */
  useEffect(() => {
    if (launchError === undefined) return
    if (loggedIn === true && engineLive) {
      wakeFailedAtRef.current = 0
      setLaunchError(undefined)
    }
  }, [launchError, loggedIn, engineLive])

  /**
   * The 「重试启动」 button: try again, ignoring the failure cooldown.
   *
   * Clearing the notice first is what lets the queue drain effect fire again —
   * the queued messages go out on the same click when the start succeeds.
   */
  const retryEngine = useCallback(async (): Promise<void> => {
    setLaunchError(undefined)
    await ensureReady({ force: true })
  }, [ensureReady])

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    const sentImages = images
    if (text === '' && sentImages.length === 0) return
    // Cleared before the request: a message that has been accepted (on its way,
    // or queued) must not still be sitting in the editor.
    setDraft('')
    setImages([])
    /*
     * A turn is already running.
     *
     * The web page answers one question at a time, so this cannot go out now —
     * but it is NOT refused either: the composer the reader is typing into is an
     * ordinary one, and the honest answer to "send this" is "it will go next",
     * not an error. The message waits in the panel's own queue and leaves the
     * moment the current reply finishes.
     */
    if (busy || streaming) {
      enqueue(text, sentImages)
      return
    }
    const outcome = await deliver(text, sentImages)
    if (outcome === 'busy') enqueue(text, sentImages)
    else if (outcome === 'failed') restoreComposer(text, sentImages)
  }, [draft, images, busy, streaming, deliver, enqueue, restoreComposer])

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
      } else toast(explain(result, tr('send.newChat'), tr), { error: true })
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
      toast(explain(result, tr('send.toggle'), tr), { error: true })
    }
  }, [deepThink, api, toast])

  const toggleSearch = useCallback(async (): Promise<void> => {
    const next = !search
    setSearch(next)
    const result = await api.setSearch(next).catch(() => undefined)
    if (result !== undefined && result.ok !== true) {
      setSearch(!next)
      toast(explain(result, tr('send.toggle'), tr), { error: true })
    }
  }, [search, api, toast])

  const openLogin = useCallback(async (): Promise<void> => {
    const result = await api.openLogin().catch(() => undefined)
    if (result !== undefined && result.ok !== true) toast(explain(result, tr('send.openLogin'), tr), { error: true })
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
      toast(tr('toast.delete.failed', { error: explain(result, '', tr) }), { error: true })
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
              toast(tr('toast.delete.failed', { error: explain(restored, '', tr) }), { error: true })
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
    if (result !== undefined && result.ok !== true) toast(tr('toast.clear.failed', { error: explain(result, '', tr) }), { error: true })
    else toast(tr('toast.clear.done'))
  }, [clearArmed, api, toast, tr])

  /**
   * What a sync changed, in the reader's terms — and only the parts that
   * happened: 「新增 0 条」 is noise, and a merge that found nothing new is a
   * perfectly normal outcome that should not read like a report.
   *
   * @param counts - the merge counters, from one sync or summed over many.
   */
  const syncDetail = useCallback((counts: {
    added?: number
    completed?: number
    replaced?: number
    kept?: number
  }): string => {
    return [
      (counts.added ?? 0) > 0 ? tr('toast.recover.added', { count: String(counts.added) }) : '',
      (counts.completed ?? 0) > 0 ? tr('toast.recover.completed', { count: String(counts.completed) }) : '',
      (counts.replaced ?? 0) > 0 ? tr('toast.recover.replaced', { count: String(counts.replaced) }) : '',
      (counts.kept ?? 0) > 0 ? tr('toast.recover.kept', { count: String(counts.kept) }) : '',
    ].filter(part => part !== '').join(' · ')
  }, [tr])

  /**
   * Sync ONE conversation the rail already holds.
   *
   * The rail's own button only offers conversations the store has never seen,
   * so this is how a transcript that has since been continued on the web catches
   * up. It is a merge, so what it usually reports is 「新增 2 条」 rather than a
   * rewritten transcript.
   */
  const syncChat = useCallback(async (chat: DSchatTranscript): Promise<void> => {
    const sessionId = chat.webSessionId
    if (sessionId === undefined) return
    setSyncId(chat.id)
    try {
      const result = await api.recover({ title: chat.title, sessionId }).catch(() => undefined)
      if (result === undefined || result.ok !== true) {
        toast(explain(result, tr('toast.recover.failed', { list: chat.title }), tr), { error: true })
        return
      }
      void refreshState()
      const detail = syncDetail(result)
      toast(
        detail === ''
          ? tr('toast.sync.uptodate', { title: chat.title })
          : `${tr('toast.sync.done', { title: chat.title })}${tr('send.join')}${detail}`,
        { ttl: 6_000 },
      )
    } finally {
      setSyncId(undefined)
    }
  }, [api, refreshState, syncDetail, toast, tr])

  const recover = useCallback(async (): Promise<void> => {
    const listed = await api.webChats().catch(() => undefined)
    if (listed === undefined || listed.ok !== true) {
      toast(explain(listed, tr('send.recoverList'), tr), { error: true })
      return
    }
    if (listed.missing.length === 0) {
      toast(tr('toast.recover.empty'))
      return
    }
    /*
     * Syncing is a read per conversation (the page's own history endpoint), so
     * the old one-toast-per-title stream is replaced by one progress toast plus
     * one summary. A conversation the panel already holds is MERGED rather than
     * replaced — see TranscriptStore.mergeHistory — which is what lets a second
     * click repair an earlier incomplete import without rewriting the messages
     * the reader already has.
     */
    const total = listed.missing.length
    let done = 0
    let recovered = 0
    let messages = 0
    let added = 0
    let completed = 0
    let replaced = 0
    let kept = 0
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
        failures.push(`${item.title}${tr('send.join')}${explain(result, tr('send.unknown'), tr)}`)
        continue
      }
      recovered += 1
      messages += result.messageCount ?? 0
      added += result.added ?? 0
      completed += result.completed ?? 0
      replaced += result.replaced ?? 0
      kept += result.kept ?? 0
    }
    toast(tr('toast.recover.summary', {
      count: String(recovered),
      total: String(total),
      messages: String(messages),
    }))
    const detail = syncDetail({ added, completed, replaced, kept })
    if (detail !== '') toast(detail, { ttl: 8_000 })
    if (failures.length > 0) {
      toast(tr('toast.recover.failed', { list: failures.slice(0, 3).join(tr('send.join')) }), { error: true, ttl: 12_000 })
    }
  }, [api, toast, tr, syncDetail])

  const commitRename = useCallback(async (chat: DSchatTranscript): Promise<void> => {
    const title = renameDraft.trim().replace(/\s+/g, ' ')
    setRenamingId(undefined)
    if (title === '' || title === chat.title) return
    const result = await api.renameChat(chat.id, title).catch(() => undefined)
    if (result !== undefined && result.ok !== true) toast(tr('toast.rename.failed', { error: explain(result, '', tr) }), { error: true })
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
      toast(tr('toast.export.failed', { error: explain(result, '', tr) }), { error: true })
      return
    }
    toast(tr('toast.export.done', {
      file: result.dir === undefined ? result.filePath : `${result.dir}/${result.filePath}`,
    }))
  }, [viewChat, api, toast, tr])

  /**
   * Step one of the hand-off: build the text and SHOW it. Writes nothing.
   *
   * The transfer used to be one click that wrote immediately, and the case that
   * made that wrong is that distillation can fail: the host then silently
   * replays the whole raw conversation (10–18k characters of log) and the panel
   * showed the same 「已创建会话」 toast as for a real brief. The reader had no
   * way to tell the two apart, and no chance to look before a session existed.
   */
  const loadTransferPreview = useCallback(async (): Promise<void> => {
    if (viewChat === undefined || previewing) return
    setPreviewing(true)
    setStage(1)
    try {
      const result = await api.transferPreview(
        viewChat.id,
        cwd,
        transferMode,
        transferTarget === 'new' ? targetWorkspaceId : undefined,
        transferTarget === 'continue' ? continueTargetId : undefined,
      )
      if (result.ok !== true || typeof result.markdown !== 'string') {
        setStage(0)
        toast(tr('toast.transfer.failed', { error: explain(result, '', tr) }), {
          error: true,
          action: { label: tr('toast.transfer.retry'), run: () => { void loadTransferPreview() } },
        })
        return
      }
      setPreview({
        distilled: result.distilled === true,
        fallback: result.fallback === true,
        ...(result.fallbackReason === undefined ? {} : { fallbackReason: result.fallbackReason }),
        chars: result.markdown.length,
      })
      setPreviewDraft(result.markdown)
      // The preview is not one of the progress steps; the rail belongs to the
      // write, which has not started.
      setStage(0)
    } catch (error) {
      setStage(0)
      toast(tr('toast.transfer.failed', { error: String(error) }), { error: true })
    } finally {
      setPreviewing(false)
    }
  }, [viewChat, previewing, api, cwd, transferMode, transferTarget, targetWorkspaceId, continueTargetId, toast, tr])

  /**
   * Step two: write exactly what the reader confirmed.
   *
   * The draft travels over the wire, so an edit is what lands — the host does
   * not re-distill (which would both discard the edit and pay for the model calls
   * a second time).
   */
  const runTransfer = useCallback(async (): Promise<void> => {
    if (viewChat === undefined || transferring) return
    setTransferring(true)
    setStage(2)
    try {
      const result = await api.transfer(
        viewChat.id,
        cwd,
        transferMode,
        transferTarget === 'new' ? targetWorkspaceId : undefined,
        transferTarget === 'continue' ? continueTargetId : undefined,
        { markdown: previewDraft, distilled: preview?.distilled === true },
      )
      if (result.ok !== true || result.sessionId === undefined) {
        setStage(0)
        toast(tr('toast.transfer.failed', { error: explain(result, '', tr) }), {
          error: true,
          action: { label: tr('toast.transfer.retry'), run: () => { void runTransfer() } },
        })
        return
      }
      const sessionId = result.sessionId
      setStage(result.continued === true ? 2 : 3)
      if (result.duplicate === true) toast(tr('toast.transfer.duplicate'))
      else if (result.continued === true) toast(tr('toast.transfer.continued'))
      /*
       * A hand-off that had to fall back is TOLD APART from a distilled one.
       *
       * `distilled` comes from the host's own report, so this is the reader's
       * only honest answer to "did I get a brief or the whole log?" — the thing
       * the panel used to leave to a single success sentence for both.
       */
      else if (transferMode === 'distill' && result.distilled !== true) toast(tr('toast.transfer.fallback'), { ttl: 12_000 })
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
      window.setTimeout(() => { setTransferOpen(false); setStage(0); setPreview(undefined) }, 600)
    } catch (error) {
      setStage(0)
      toast(tr('toast.transfer.failed', { error: String(error) }), { error: true })
    } finally {
      setTransferring(false)
    }
  }, [viewChat, transferring, api, cwd, transferMode, transferTarget, targetWorkspaceId, continueTargetId, previewDraft, preview, openSession, toast, tr])

  /*
   * A preview describes ONE set of choices.
   *
   * Changing the mode, the destination, the target session or the conversation
   * makes it describe something the reader is no longer about to do, and
   * confirming it would write text they did not choose. Cleared rather than kept
   * so the button always leads back through 预览.
   */
  useEffect(() => { setPreview(undefined); setPreviewDraft('') }, [viewChat?.id, transferMode, transferTarget, targetWorkspaceId, continueTargetId])

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
   * pointerdown inside any wrapper is left alone; the trigger's own onClick
   * still toggles it, so pressing the trigger twice does not double-toggle.
   *
   * The three surfaces are one TABLE rather than three copies of the same two
   * lines: the panel has grown a menu per row (the header's lamp sentence, the
   * composer row's 迁移 and 「···」), and a hand-written branch per menu is how
   * one of them ends up missing its dismiss path — which is the exact bug this
   * effect was written for. A new menu is a row here and nothing else.
   */
  const popovers: Array<[boolean, React.RefObject<HTMLDivElement | null>, (open: boolean) => void]> = [
    [transferOpen, transferPopRef, setTransferOpen],
    [lampOpen, lampPopRef, setLampOpen],
    [moreOpen, morePopRef, setMoreOpen],
  ]
  const anyPopoverOpen = popovers.some(([open]) => open)
  useEffect(() => {
    if (!anyPopoverOpen) return
    const onDown = (event: Event): void => {
      const target = event.target as Node | null
      for (const [open, ref, close] of popovers) {
        if (open && ref.current?.contains(target) !== true) close(false)
      }
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      for (const [open, , close] of popovers) if (open) close(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onEscape)
    }
  }, [anyPopoverOpen, transferOpen, lampOpen, moreOpen])

  /** Escape closes 「运行状态」, like every other dismissible surface here. */
  useEffect(() => {
    if (!statusOpen) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setStatusOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [statusOpen])

  /* ------------------------------------------------------------ shortcuts */

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        /*
         * Through `openSearch()`, NOT `searchRef.current?.focus()`.
         *
         * The ref is null whenever the rail is collapsed — the box is not in the
         * DOM then — so the direct call made ⌘K silently do nothing in exactly
         * the state where a keyboard shortcut is worth the most. `openSearch()`
         * expands the rail first and lets the follow-up effect own the focus.
         *
         * This is also what lets the action row drop its 搜索 button without
         * losing the way in: the shortcut covers the hidden-rail case (where the
         * box does not exist), and the box itself covers every other one.
         */
        openSearch()
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
  }, [state?.busy, stop, openSearch])

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
          toast(tr('toast.attach.tooBig', { name: file.name === '' ? tr('attach.name.unnamed') : file.name, limit: MAX_ATTACH_LABEL }), { error: true })
          continue
        }
        const payload = await fileToBase64(file)
        const sentName = file.name === '' ? tr('attach.name.pasted') : file.name
        const result = await api.attach({
          name: sentName,
          mediaType: payload.mediaType,
          data: payload.data,
        })
        if (result.ok !== true || result.path === undefined) {
          toast(tr('toast.attach.failed', { error: explain(result, '', tr) }), { error: true })
          continue
        }
        /*
         * The chip is built from the NAME the reader chose, never from the
         * stored path.
         *
         * The host answers both: `path` is the opaque `${uuid}__${name}${ext}`
         * it wrote (what the engine is handed), and `name` is the original.
         * Showing the path's last segment is what printed a UUID in the
         * composer, so the label comes from `name`, and the media type — not
         * the path — decides whether this renders as a thumbnail.
         */
        const path = result.path
        const name = result.name === undefined || result.name === '' ? displayNameOf(path) : result.name
        const kind: ComposerAttachment['kind'] = payload.mediaType.startsWith('image/') ? 'image' : 'file'
        setImages(list => [...list, { path, name, mediaType: payload.mediaType, kind }])
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

  /**
   * The status lamp's four colours, in the order the reader was promised them.
   *
   * The phase model has five states and the lamp has four lamps, so the mapping
   * is a deliberate many-to-one — and the pair that shares a colour is the pair
   * that MEANS the same thing to a reader deciding whether to wait:
   *
   *   - `launching` and `need-login` are both amber. Neither is a failure (the
   *     engine is coming up, or it is up and waiting for a sign-in), and both
   *     ask for the same thing — "wait, or click the lamp" — so giving them
   *     separate colours would invent a distinction the reader cannot act on.
   *     Amber was chosen over grey for them: grey is the one colour that means
   *     NOTHING is happening, which is exactly the wrong reading for a browser
   *     that is starting.
   *   - `thinking` and `streaming` keep the running green and breathe instead
   *     of changing hue (see the stylesheet). "Working" is motion, not a
   *     different condition, and a second green — or a blue — would be
   *     indistinguishable from `ready` at 7px.
   *
   * Colour is never the only channel: the lamp's `title` and `aria-label` carry
   * {@link whaleTitle}, which is the whole sentence.
   */
  const lampTone: 'green' | 'red' | 'grey' | 'amber' =
    engine.phase === 'ready' || engine.phase === 'thinking' || engine.phase === 'streaming'
      ? 'green'
      : engine.phase === 'error'
        ? 'red'
        : engine.phase === 'launching' || engine.phase === 'need-login'
          ? 'amber'
          : 'grey'

  const elapsed = busy && state?.busySince !== undefined
    ? `${Math.max(0, (now - state.busySince) / 1000).toFixed(1)}s`
    : undefined
  const streamedChars = viewChat?.messages.reduce(
    (total, message) => (message.role === 'assistant' && message.streaming === true ? message.content.length : total), 0) ?? 0

  const modelLabel = viewChat?.model === 'deepseek-reasoner' ? tr('msg.model.think') : tr('msg.model')

  return createElement(
    'div',
    /*
     * `data-list-open` is the panel's only observable STATE attribute, and it
     * exists because the alternative is worse: without it, "is 会话列表 up?"
     * can only be answered by reaching for a CSS class, which the next styling
     * change is free to rename. It is read by the design sheet
     * (scripts/dialog-preview.mjs) and it is what made two silent failures
     * visible while this dialog was being built — a click that never landed,
     * and a shared localStorage that pre-opened the dialog in a screenshot
     * meant to show it closed. It paints nothing.
     */
    { className: 'dsh-dschat', 'data-dsh-plugin': 'dschat', 'data-list-open': railOpen ? '1' : '0' },

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
       * The header is the PRODUCT MARK and the STATE LAMP, and nothing else.
       *
       * The three window controls that used to sit here (会话列表 / 搜索 /
       * 新建对话) moved into the action row directly above the composer, and the
       * 「在 Harness 中继续」 button went with them under its short label
       * 「DSH 迁移」。 Two reasons, and they point the same way: those four
       * actions are about the CONVERSATION — they read a list, search it,
       * replace it, or hand it off — so they belong beside the transcript and
       * the box that feeds it, not in a title bar that also carries the window's
       * drag region and its product identity. The header has no width to spare
       * for them at a narrow column, and it was the one strip whose emptiness
       * the window needed for dragging.
       *
       * The whale is now a plain mark rather than a button: it names the
       * product, and clicking a logo to "start the engine" was an affordance
       * nobody could guess. Everything that mark used to do lives on the lamp
       * beside it, whose tooltip says which state it is reporting.
       *
       * The 「···」 menu that once sat at the header's right end is back — at the
       * ACTION ROW's right end, next to the migration button (see `actions()`).
       * What it holds (运行状态 / 导出 markdown / 打开登录窗口 / 关闭浏览器) is
       * not header material either: it reads a transcript, writes one out, or
       * drives the page, and each of those is something the row beside the
       * conversation is already about.
       */
      createElement(
        'span',
        { className: 'dsh-dschat-brand' },
        createElement(WhaleMark, { size: 19 }),
        createElement('span', { className: 'dsh-dschat-brand-name' }, tr('brand.title')),
      ),
      /*
       * The lamp and its menu in ONE positioned box.
       *
       * The wrapper is not decoration: the menu panel is absolutely positioned,
       * and its containing block is the nearest positioned ancestor. Standing
       * the wrapper next to the lamp instead of around it made that ancestor a
       * zero-width sibling which the header's flex spacer had already pushed to
       * the far edge — so the 230px panel opened at the panel's right edge,
       * hundreds of pixels from the dot that opened it (measured: dot at x=148,
       * menu at x=1266, overflowing the window). Around the lamp, the wrapper is
       * exactly the trigger's own box, which is what "anchored to the lamp"
       * means.
       *
       * The state lamp: a 7px dot in one of four colours, and the header's only
       * remaining control.
       *
       * The colour is the whole point — the engine's condition is legible from
       * the corner of the eye without a row of text — and the sentence did not
       * disappear: it is this button's tooltip and accessible name (see
       * `whaleTitle`). Colour is never the only channel.
       *
       * Its second job is to answer "what does this colour mean" on demand:
       * pressing the lamp opens a panel whose whole content is the same status
       * sentence in full, which a tooltip cannot give until the reader already
       * hovers the thing they have not understood. The engine's COMMANDS are
       * not here — see {@link moreMenu}.
       */
      createElement(
        'div',
        { className: 'dsh-dschat-lamp-wrap' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-dschat-lamp',
            'data-tone': lampTone,
            'data-phase': engine.phase,
            title: whaleTitle,
            'aria-label': whaleTitle,
            'aria-haspopup': 'menu',
            'aria-expanded': lampOpen,
            onClick: () => setLampOpen(open => !open),
          },
          createElement('i', { 'aria-hidden': 'true' }),
        ),
        lampMenu(),
      ),
      /*
       * The header's run of empty space — the window's drag region, and the
       * only one. `aria-hidden` because it carries nothing: it exists so the
       * window can be moved by the title bar's blank strip, which is where a
       * reader reaches for it.
       */
      createElement('div', { className: 'dsh-dschat-spacer', 'data-window-drag': true, 'aria-hidden': 'true' }),
      /*
       * …and the engine menu at the far end of that run of space.
       *
       * 「···」 belongs to the TITLE BAR, not to the conversation: it holds
       * 运行状态 / 导出 markdown / 打开登录窗口 / 关闭浏览器, which are facts
       * about and controls over the PANEL and its browser — the same class of
       * thing as the window's own controls in that strip — while everything on
       * the action row below (list / search / new / hand-off) is about the
       * CONVERSATION. Putting it here also keeps it out of the way of the
       * reader who is writing a message, and gives the title bar's right end
       * the one control a reader checks for "what else can this thing do".
       *
       * It opens DOWNWARD for the same reason the lamp does: this is the top
       * strip, so there is no room above it (see the stylesheet's header rule).
       */
      moreMenu(),
    ),

    /* ---------------------------------------------------------- body */
    createElement(
      'div',
      { className: 'dsh-dschat-body' },
      createElement(
        'div',
        { className: 'dsh-dschat-chat' },
        /*
         * The visible transcript, as a BOX.
         *
         * The navigator and the 「↓ 最新」 pill are positioned against this
         * wrapper rather than against the chat column, because the chat column
         * also holds the composer: centring the ticks in it would drag them
         * down towards the input, and pinning the pill to its bottom would put
         * the pill on top of the composer. See the stylesheet's threadbox rule.
         */
        createElement(
          'div',
          { className: 'dsh-dschat-threadbox' },
          createElement(
            'div',
            {
              className: 'dsh-dschat-thread dsh-dschat-scroll',
              ref: listRef,
              onScroll: onThreadScroll,
              /*
               * The navigator needs a column of its own, and it must be a COLUMN
               * rather than an overlay: a 34px capsule floating over a 320px
               * panel sits on top of the text. The flag is on the scroller so
               * the padding lands on the inner reading column, where the
               * messages are — padding on the scroller itself would move the
               * scrollbar.
               */
              'data-nav': questions.length >= 2 && threadScrolls ? 'true' : undefined,
            },
            createElement('div', { className: 'dsh-dschat-thread-inner' }, thread()),
          ),
          questionNav(),
          latestPill(),
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

    /*
     * 「运行状态」, opened from the ··· menu.
     *
     * A modal of the panel's own rather than a page in the shell's Settings: it
     * is a diagnostic about THIS panel (see DSchatStatus), it is read while
     * looking at the conversation it describes, and the shell's Settings is
     * where the plugin's actual configuration lives — on the Plugins page, in
     * the form the shell renders from its Config schema.
     */
    statusOpen && createElement(
      'div',
      {
        className: 'dsh-dschat-modal',
        role: 'dialog',
        'aria-modal': true,
        'aria-label': tr('status.title'),
        // A click on the backdrop closes it; a click inside the card does not.
        onClick: (event: { target: unknown; currentTarget: unknown }) => {
          if (event.target === event.currentTarget) setStatusOpen(false)
        },
      },
      createElement(
        'div',
        { className: 'dsh-dschat-modal-card' },
        createElement('button', {
          type: 'button',
          className: 'dsh-dschat-modal-close',
          title: tr('item.rename.cancel'),
          'aria-label': tr('item.rename.cancel'),
          onClick: () => setStatusOpen(false),
        }, createElement(CloseIcon, { size: 12 })),
        createElement(DSchatStatus, { api, tt, t }),
      ),
    ),
  )

  /* ------------------------------------------------------------- sections */

  /**
   * 会话列表: the conversation list, as a panel above its own button.
   *
   * It used to be a 238px left column that took its width from the chat for as
   * long as the panel was open. Two things were wrong with that, and the reader
   * reported the second one as a feeling — the list was always there:
   *
   *   · the column was paid for on EVERY screen. At the panel's usual width the
   *     transcript got 382px of 620 (measured), so every message wrapped to make
   *     room for a list that is consulted for one second per session;
   *   · a list is a CHOICE, not a place. Nothing in this panel is done "in" the
   *     list — every row is a way to leave it — so giving it permanent floor
   *     space overstated what it is.
   *
   * A panel answers both: the transcript owns the full width, and the list is up
   * exactly while the reader is choosing a conversation.
   *
   * ANCHORED, not centred. The first version of this was a modal dialog in the
   * middle of the panel, and that was wrong for a reason worth writing down: a
   * list of conversations is not a task, it is a MENU. It hangs off the control
   * that opened it, so the reader keeps the connection between "the button I
   * pressed" and "the thing that appeared" — and the gesture that closes it (the
   * same button, or Escape, or picking a row) is the gesture that opened it.
   * 迁移 has always worked this way, and the two must not disagree: they are the
   * two controls on the same row, and one of them covering the screen while the
   * other hangs off a button would read as two different panels.
   *
   * It is therefore the SAME popover as 迁移: same 348px width, same surface
   * material, same upward direction, same wrapper (which the caller renders, so
   * that the wrapper is exactly the trigger's own box). Upward comes from where
   * the trigger is — the action row at the bottom of the panel — and the
   * stylesheet states that rule once for the whole row (see the note on
   * .dsh-dschat-pop).
   *
   * Returns the panel alone, NOT a wrapper around it: the caller owns the
   * wrapper (see actions), because there the wrapper has to contain the trigger
   * as well.
   */
  function sessionsPopover(): ReactNode {
    /*
     * Closed means ABSENT: the subtree is dropped rather than hidden, so the
     * rows' tab stops and the search box's focus ring cannot survive a close
     * inside a `display:none` box.
     */
    if (!railOpen) return null
    return createElement(
      'div',
      {
        /*
         * The same panel 迁移 opens: `.dsh-dschat-pop` (348px, the panel's own
         * surface material and elevation) plus `.dsh-dschat-pop-up`, which is
         * the row's shared upward rule. `.dsh-dschat-listpop` is what makes it
         * a LIST inside that material rather than a form — see the stylesheet.
         */
        className: 'dsh-dschat-pop dsh-dschat-pop-up dsh-dschat-listpop',
        role: 'dialog',
        /*
         * Not `aria-modal`: nothing here is modal. The transcript behind it
         * stays live, and a reader who tabs away from the list should reach
         * the rest of the panel rather than be trapped in a menu they can
         * already see the bottom of.
         */
        'aria-label': tr('action.sessions'),
        /* Escape is the keyboard's way out, matching the trigger's second
           press and "pick a row" as the pointer's. */
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          closeList()
        },
      },
        /*
         * The search box, at the TOP of the list.
         *
         * It filters the rows directly below it, and a filter that sits under
         * the thing it filters makes the reader look past the result to find
         * the control.
         */
        createElement(
          'div',
          { className: 'dsh-dschat-search' },
          createElement(SearchIcon, {}),
          createElement('input', {
            ref: searchRef,
            value: query,
            placeholder: tr('rail.search'),
            'aria-label': tr('rail.search'),
            /*
             * The ⌘K advertisement lives HERE.
             *
             * It used to be the action row's 搜索 button, whose tooltip carried
             * 「搜索会话内容（⌘K）」. That button is gone (it duplicated this box),
             * and a shortcut nobody advertises is a shortcut nobody uses — so
             * the sentence moved onto the box itself, which is where the feature
             * lives and where a reader who is about to type in it will hover.
             */
            title: tr('rail.search.hint'),
            onChange: (event: { target: { value: string } }) => setQuery(event.target.value),
            onKeyDown: (event: { key: string; preventDefault: () => void }) => {
              // Escape empties the box, so one key undoes the search without
              // also throwing the reader's place in the list away.
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
          { className: 'dsh-dschat-list dsh-dschat-listpop-list dsh-dschat-scroll' },
          filtered.length === 0
            ? createElement('div', { className: 'dsh-dschat-hint-empty' },
                chats.length === 0 ? tr('rail.empty') : tr('rail.noMatch'))
            : filtered.map(chat => (renamingId === chat.id ? renameRow(chat) : chatRow(chat))),
        ),
        createElement(
          'div',
          { className: 'dsh-dschat-listpop-foot' },
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
    /*
     * Picking a conversation closes the list.
     *
     * It has to be here, in the ONE function every row goes through, rather
     * than on the row's click handler: a row is opened by a click and by a
     * keyboard Enter, and a menu that stays up after the reader has chosen from
     * it reads as "that click did nothing" — the transcript behind it has
     * changed, but the thing they were looking at has not.
     *
     * This was a real defect rather than a nicety: the dismiss check
     * (scripts/list-dismiss-check.mjs) caught the list still open after a row
     * was picked, because the earlier sidebar version never had to close
     * anything — it was always there.
     */
    closeList()
  }

  /**
   * One sidebar row.
   *
   * Takes the VIEW (a summary, with whatever body has been fetched), not the
   * full transcript: the row is built from `state.chats`, and its label has to
   * report `messageCount` — the count the summary carries — because the body
   * may not be loaded yet and the row's job is to describe the conversation,
   * not to have fetched it.
   */
  function chatRow(chat: DSchatChatView): ReactNode {
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
          // `messageCount` from the summary: the body may not be loaded, and the
          // row's job is to describe the conversation, not to have fetched it.
          `${fmt(tr('chats.count'), { count: String(chat.messageCount) })} · ${relativeTime(chat.updatedAt, tr)}`),
      ),
      createElement(
        'div',
        { className: 'dsh-dschat-item-acts' },
        /*
         * 「从网页同步」, per row.
         *
         * The rail's own sync button only pulls in conversations the store has
         * never seen (that is what "missing" means to it), so without this the
         * incremental merge would be unreachable for a conversation that has
         * been synced once and then continued on the web — which is the normal
         * way a reader uses this panel. It only appears on rows that know their
         * web session id: a conversation with no id has no web counterpart to
         * read.
         */
        chat.webSessionId === undefined ? null : createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-dschat-mini',
            title: tr('item.sync'),
            'aria-label': tr('item.sync'),
            disabled: syncId !== undefined,
            onClick: () => { void syncChat(chat) },
          },
          syncId === chat.id ? createElement('span', { className: 'dsh-dschat-spin' }) : createElement(RefreshIcon, {}),
        ),
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

  /**
   * Why the page is not usable, in the conversation, with a retry.
   *
   * This is the panel's answer to "启动失败要有反馈" — and the reason it is HERE
   * rather than in a toast: it is about the message the reader was writing when
   * the start failed, it stays until the thing it reports is over, and the one
   * action that can fix it is on the card. Toasts are for events; this is a
   * state.
   *
   * It is rendered at the END of the thread (both in an empty conversation and
   * under the last message), which is where the next thing is about to happen.
   */
  /**
   * The states that stand between the reader and a reply, each with the action
   * that fixes it.
   *
   * This used to be ONE state: a failed launch. Everything else was a colour on
   * a 7px lamp with the explanation in its tooltip — so an engine that had
   * stopped, and a browser sitting on the sign-in page, both looked like a panel
   * that simply did nothing, with no way forward except guessing that the
   * composer was clickable. Each state now names itself and offers its action.
   *
   * The two "quiet" states (stopped, signed out) are shown only when the
   * conversation has messages: with an empty panel the composer's own invitation
   * and the empty state already say what to do, and a card on top of them would
   * be noise. A failure and an engine ERROR always show — those are never the
   * resting state.
   */
  function engineNoticeOf(): { key: string; title: string; body: string; actions: ReactNode } | undefined {
    const retry = createElement('button', {
      type: 'button',
      className: 'dsh-dschat-btn dsh-dschat-btn-primary',
      disabled: waking,
      onClick: () => { void retryEngine() },
    }, waking ? tr('engine.notice.retrying') : tr('engine.notice.retry'))
    const login = createElement('button', {
      type: 'button',
      className: 'dsh-dschat-btn dsh-dschat-btn-ghost',
      onClick: () => { void openLogin() },
    }, tr('action.openLogin'))
    const status = createElement('button', {
      type: 'button',
      className: 'dsh-dschat-btn dsh-dschat-btn-ghost',
      onClick: () => setStatusOpen(true),
    }, tr('status.title'))

    if (launchError !== undefined) {
      return { key: 'launch', title: tr('engine.notice.title'), body: launchError, actions: createElement(Fragment, null, retry, login) }
    }
    /*
     * Dispatched on the PHASE, not on `engineLive`.
     *
     * `engineLive` is false for the sign-in state as well as for a stopped
     * engine, so testing it first made "the browser is up and waiting for you to
     * sign in" render as "the web page is not running" — with a retry button
     * that cannot possibly help. The phase is the panel's own single derived
     * truth about the engine, and each of its values has exactly one cause.
     */
    switch (phase) {
      case 'error':
        return {
          key: 'error',
          title: tr('engine.notice.error.title'),
          body: state?.engineError ?? '',
          actions: createElement(Fragment, null, retry, status),
        }
      case 'need-login':
        return {
          key: 'login',
          title: tr('engine.notice.login.title'),
          body: tr('engine.notice.login.body'),
          actions: createElement(Fragment, null, login, retry),
        }
      case 'stopped': {
        // The resting state, and only worth a card when there is a conversation
        // to send into: an empty panel already invites the reader to type.
        if ((viewChat?.messages.length ?? 0) === 0) return undefined
        return { key: 'offline', title: tr('engine.notice.offline.title'), body: tr('engine.notice.offline.body'), actions: retry }
      }
      default:
        // launching / ready / thinking / streaming: nothing is in the way.
        return undefined
    }
  }

  function engineNotice(): ReactNode {
    const notice = engineNoticeOf()
    if (notice === undefined) return null
    return createElement(
      'div',
      { className: 'dsh-dschat-notice', key: `engine-notice-${notice.key}`, role: 'status' },
      createElement('span', { className: 'dsh-dschat-notice-mark' }, createElement(WarnIcon, {})),
      createElement(
        'div',
        { className: 'dsh-dschat-notice-body' },
        createElement('strong', null, notice.title),
        notice.body === '' ? null : createElement('p', null, notice.body),
        /*
         * The actions sit UNDER the sentence, in a row: the sentence is what the
         * reader has to read before choosing, and at panel widths a column of
         * buttons beside it squeezes both.
         */
        createElement('div', { className: 'dsh-dschat-notice-actions' }, notice.actions),
      ),
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
    /*
     * A conversation whose body is still on its way is NOT an empty one.
     *
     * `messages.length === 0` is true for both, which is why opening a chat with
     * history used to render 「在 DSH 里直接聊 DeepSeek 网页端」 for the length of
     * the round trip — the empty state IS the brand-new-conversation page, so a
     * click on a stored conversation looked like it had thrown the reader into a
     * fresh chat. `loaded` is exactly the flag that tells them apart (see
     * `DSchatChatView`): unloaded with a non-zero summary count and nothing on
     * screen yet is "coming"; unloaded with a zero count is genuinely new.
     *
     * Messages already on screen outrank the placeholder: a body the tail feed
     * has begun is real content, and covering it with a loading row would be the
     * same blink in a new costume.
     */
    if (viewChat !== undefined && viewChat.messages.length === 0
      && viewChat.loaded !== true && viewChat.messageCount > 0) {
      return createElement(
        Fragment,
        { key: 'loading' },
        createElement(
          'div',
          { className: 'dsh-dschat-empty dsh-dschat-loading' },
          createElement('div', { className: 'dsh-dschat-empty-mark' }, createElement(ChatIcon, { size: 22 })),
          createElement('h3', null, tr('thread.loading')),
        ),
        engineNotice(),
      )
    }
    if (viewChat === undefined || viewChat.messages.length === 0) {
      return createElement(
        Fragment,
        { key: 'empty' },
        createElement(
          'div',
          { className: 'dsh-dschat-empty' },
          createElement('div', { className: 'dsh-dschat-empty-mark' }, createElement(ChatIcon, { size: 22 })),
          createElement('h3', null, tr('empty.title')),
          createElement('p', null, tr('empty.body')),
          /*
           * 或者试试: three things the web page can actually be asked to do —
           * translate, summarise, polish a passage — and each one WRITES ITSELF.
           *
           * The page used to end on 「Enter 发送 / ⌘/ 聚焦」, which documents the
           * keyboard instead of inviting a question, and a new reader still had
           * no idea what this panel was for. A prompt chip is the shortest path
           * from an empty page to a first reply: the sentence lands in the
           * composer, focused, ready to edit or send — nothing is sent by the
           * click itself, so a chip can never spend a turn the reader did not
           * ask for.
           *
           * It also wakes the engine, exactly as clicking the field does, so the
           * page starts while the reader is still reading the sentence.
           */
          createElement(
            'div',
            { className: 'dsh-dschat-empty-try' },
            createElement('span', { className: 'dsh-dschat-empty-try-label' }, tr('empty.try')),
            createElement(
              'div',
              { className: 'dsh-dschat-empty-try-list' },
              ...(['empty.try.translate', 'empty.try.summarize', 'empty.try.polish'] as const).map(key =>
                createElement(
                  'button',
                  {
                    key,
                    type: 'button',
                    className: 'dsh-dschat-try',
                    onClick: () => {
                      setDraft(tr(key))
                      void ensureReady()
                      inputRef.current?.focus()
                    },
                  },
                  tr(key),
                )),
            ),
          ),
          createElement(
            'p',
            { className: 'dsh-dschat-empty-keys' },
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
        ),
        engineNotice(),
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
      engineNotice(),
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
    /**
     * Surface copy for every markdown surface in this message.
     *
     * The renderer is a pure function, so the strings a reader hovers — the
     * copy label, the reasoning body's collapse tooltip, the fallback summary
     * of a `<details>` block the web page wrote without one — come in as data.
     * A Chinese tooltip in the English UI was the leak this closes.
     */
    const markdownCopy = {
      copy: tr('msg.copy'),
      collapseHint: tr('msg.think.collapse'),
      details: tr('msg.details'),
      language: tr('msg.code.language'),
    }
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
      /*
       * What was attached to this message, as chips.
       *
       * The transcript stores PATHS only, so these are read back rather than
       * remembered: the `uuid__` prefix is stripped for the label, and the
       * extension decides whether the chip offers to show the image. Old
       * transcripts — whose files were written before the readable label
       * existed — show their bare UUID, which is all they have.
       */
      message.attachments !== undefined && message.attachments.length > 0 && createElement(
        'div',
        { className: 'dsh-dschat-imgs' },
        message.attachments.map(path => createElement('div', { key: path, className: 'dsh-dschat-chip', title: displayNameOf(path) },
          createElement(ClipIcon, { size: 12 }), createElement('span', null, displayNameOf(path)),
          attachmentKind(path) === 'image' && createElement('a', {
            className: 'dsh-dschat-chip-view',
            href: api.attachmentUrl(path),
            target: '_blank',
            rel: 'noreferrer',
            title: tr('attach.show'),
            'aria-label': tr('attach.show'),
          }, '↗'))),
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
              copy: markdownCopy,
              options: markdownOptions(),
            }),
            createElement(Markdown, {
              source: reply,
              copy: markdownCopy,
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

  /**
   * The right-edge question navigator.
   *
   * Collapsed it is a column of ticks — one per question, the current one
   * wider and in the accent colour; hovered (or focused) it becomes the whole
   * question list, one row per question, and a click jumps to it. That is
   * chat.deepseek.com's own interaction, measured off the live page: a 34px
   * fixed capsule, 8×2px 4px-radius ticks on a 30px pitch, and a 12px accent
   * tick marking where the reader is.
   *
   * It is ONE list in the DOM in both states. The stylesheet hides the number
   * and the text (and shrinks the rows to their tick) while collapsed, which
   * keeps the tab order, the hover targets and the labels identical whichever
   * shape it is in — a second, "tick-only" list would have to be kept in sync
   * with this one forever.
   *
   * The rows are buttons rather than a list of anchors: they scroll a box, they
   * do not navigate, and `aria-current` is what tells a screen reader which
   * question the reader is looking at.
   */
  function questionNav(): ReactNode {
    if (questions.length < 2 || !threadScrolls) return null
    return createElement(
      'div',
      { className: 'dsh-dschat-navwrap' },
      createElement(
        'nav',
        {
          className: 'dsh-dschat-nav',
          // The count lives here (and in the tooltip) rather than in a header
          // line: a header would push every row down the moment the pointer
          // arrived, which is exactly when it must not move. See the stylesheet.
          'aria-label': fmt(tr('qnav.title'), { count: String(questions.length) }),
          title: fmt(tr('qnav.title'), { count: String(questions.length) }),
          'data-open': navOpen ? 'true' : undefined,
          // Hover opens the list; leaving closes it. Both the panel and the
          // pointer are cheap here because the node only exists while there is
          // something to navigate.
          onMouseEnter: () => setNavOpen(true),
          onMouseLeave: () => setNavOpen(false),
          // Keyboard parity: focusing anything inside opens it (a keyboard user
          // cannot hover), and Escape closes it again.
          onFocus: () => setNavOpen(true),
          onBlur: (event: { currentTarget: EventTarget & Node; relatedTarget: EventTarget | null }) => {
            if (event.relatedTarget !== null && event.currentTarget.contains(event.relatedTarget as Node)) return
            setNavOpen(false)
          },
          onKeyDown: (event: { key: string }) => { if (event.key === 'Escape') setNavOpen(false) },
        },
        createElement(
          'div',
          { className: 'dsh-dschat-nav-list' },
          questions.map((question, index) => createElement(
            'button',
            {
              key: question.id,
              type: 'button',
              className: 'dsh-dschat-nav-item',
              'data-active': index === navIndex ? 'true' : undefined,
              'aria-current': index === navIndex ? 'true' : undefined,
              'aria-label': fmt(tr('qnav.item'), { index: String(index + 1), text: question.text }),
              title: question.text,
              onClick: () => jumpToQuestion(question.id),
            },
            createElement('span', { className: 'dsh-dschat-nav-idx', 'aria-hidden': 'true' }, String(index + 1)),
            createElement('span', { className: 'dsh-dschat-nav-text' }, question.text),
            createElement('i', { className: 'dsh-dschat-nav-tick', 'aria-hidden': 'true' }),
          )),
        ),
      ),
    )
  }

  /**
   * 「↓ 最新」: the way back to the end of the conversation.
   *
   * Anchoring a question to the top is what makes an answer readable from its
   * first line, and it is also what can leave a long answer's tail below the
   * fold with nothing on screen that goes back to it. This pill is that way
   * back, and it exists ONLY while the reader is not already at the end — an
   * offer, not permanent chrome.
   */
  function latestPill(): ReactNode {
    if (atBottom) return null
    return createElement(
      'div',
      { className: 'dsh-dschat-latestwrap' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-dschat-latest',
          title: tr('qnav.latest.hint'),
          onClick: jumpToLatest,
        },
        tr('qnav.latest'),
      ),
    )
  }

  function composer(): ReactNode {
    return createElement(
      'div',
      { className: 'dsh-dschat-composer' },
      createElement(
        'div',
        { className: 'dsh-dschat-composer-inner' },
        /*
         * The action row sits ABOVE the card and outside it: the card is the
         * message, and these four controls act on the conversation the card
         * belongs to. Keeping it out also means the card keeps its own shadow
         * and radius — a toolbar inside it would read as part of the message
         * the reader is still writing.
         */
        actions(),
        createElement(
          'div',
          {
            className: dragging ? 'dsh-dschat-card dsh-dschat-dragging' : 'dsh-dschat-card',
            /*
             * Whether the page behind this field is up. The stylesheet keys the
             * accent placeholder (and a faint wash) off it — the textarea itself
             * has no read-only state any more to carry that meaning, because it
             * is genuinely editable in every engine state.
             */
            'data-engine': loggedIn === true && engineLive ? 'on' : 'off',
            /*
             * The card is a shortcut to the textarea, nothing more. It is not a
             * "start me" button any more: the composer is an ordinary, always
             * editable field, and the page starts by itself when the reader
             * clicks or types in it (see the textarea's own handlers).
             *
             * Guarded on `target === currentTarget` so this never steals a click
             * from a chip, a pill or the attach button: only a click on the card
             * itself is forwarded to the input.
             */
            onClick: (event: { target: unknown; currentTarget: unknown }) => {
              if (event.target !== event.currentTarget) return
              inputRef.current?.focus()
              void ensureReady()
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
            /*
             * Two faces, decided by the file's own type.
             *
             * An IMAGE is shown as itself: a 56px thumbnail, which is the whole
             * point of attaching a picture — the reader checks they grabbed the
             * right screenshot without opening it. Anything else keeps the
             * paperclip chip, now carrying the reader's own file name instead
             * of the stored UUID (see {@link ComposerAttachment}).
             *
             * The thumbnail's `src` is the host's read-back route, so the bytes
             * are never held in the panel's state — and an old attachment whose
             * file has since been pruned fails that request, which is what the
             * chip fallback below is for.
             */
            images.map((item, index) => createElement(
              'span',
              {
                key: `${item.path}-${index}`,
                className: item.kind === 'image' ? 'dsh-dschat-thumb' : 'dsh-dschat-chip',
                title: item.name,
              },
              item.kind === 'image'
                ? createElement('img', { src: api.attachmentUrl(item.path), alt: item.name, loading: 'lazy' })
                : createElement(ClipIcon, { size: 12 }),
              item.kind !== 'image' && createElement('span', null, item.name),
              createElement('button', {
                type: 'button',
                title: tr('attach.remove.hint', { name: item.name }),
                'aria-label': tr('attach.remove.hint', { name: item.name }),
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
             * An ordinary, ALWAYS editable field.
             *
             * Neither `disabled` nor `readOnly` — the two ways this box used to
             * refuse the reader. `disabled` dropped every pointer event ("点击
             * 输入框无反应"); `readOnly` was better but still meant that with the
             * page down, or while a reply was streaming, the one control on
             * screen that looks like a text field could not hold text. Typing,
             * pasting a file and pressing Enter all work in every engine state
             * now, and what each of those *means* is decided by the handlers
             * below: the page starts in the background, and a message written
             * during a turn waits its turn in the outbox.
             */
            placeholder: (waking || state?.engine === 'launching')
              ? tr('composer.connecting')
              : loggedIn !== true
                ? (engineLive ? tr('composer.notLoggedIn') : tr('composer.offline'))
                : tr('composer.placeholder'),
            /*
             * A click in the box is a request to type, and typing needs the page:
             * start it, in the background, once — `ensureReady` reuses a live
             * page, joins a launch already in flight, and asks for the visible
             * login window only when the profile is genuinely signed out. The
             * field itself never waits for any of that.
             *
             * `onClick` as well as `onFocus`: clicking a box that is ALREADY
             * focused (the common second attempt after a failed start) fires no
             * focus event at all.
             */
            onFocus: () => { void ensureReady() },
            onClick: () => { void ensureReady() },
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
          /*
           * What is waiting for the running turn to end.
           *
           * Between the box and the tool row, because it is about the messages
           * above it — and because a queue the reader cannot see is a queue they
           * will re-type. Each row can be cancelled individually: the message
           * goes back to being theirs, not the panel's.
           */
          outbox.length > 0 && createElement(
            'div',
            { className: 'dsh-dschat-queue' },
            outbox.map(item => createElement(
              'div',
              { key: item.id, className: 'dsh-dschat-queue-item' },
              createElement('span', { className: 'dsh-dschat-queue-mark', 'aria-hidden': 'true' }, '⏳'),
              createElement('span', { className: 'dsh-dschat-queue-text', title: item.text }, item.text),
              item.images.length > 0 && createElement(
                'span',
                { className: 'dsh-dschat-queue-files' },
                fmt(tr('composer.queue.files'), { count: String(item.images.length) }),
              ),
              createElement('button', {
                type: 'button',
                title: tr('composer.queue.cancel'),
                'aria-label': tr('composer.queue.cancel'),
                onClick: () => dropQueued(item.id),
              }, '✕'),
            )),
            createElement('div', { className: 'dsh-dschat-queue-note' }, tr('composer.queue.note')),
          ),
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
                /*
                 * Attaching needs no engine: the bytes go to the host route,
                 * which writes them to disk and answers a path the page can be
                 * handed later. Disabling it while the page was down (or while a
                 * reply streamed) meant the reader could not prepare the message
                 * they were about to send with it.
                 */
                disabled: attachBusy,
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
            /*
             * 停止 and 发送 are BOTH here while a reply streams.
             *
             * They used to be the same slot (the send circle became 停止), which
             * is what the web page itself does — and it is why a second message
             * had nowhere to go: the control that sends had turned into the
             * control that stops. The reader can now do either, and the message
             * they send waits in the queue above (see composer.queue.note).
             */
            streaming && createElement(
              'button',
              { type: 'button', className: 'dsh-dschat-stop', onClick: () => { void stop() } },
              createElement('i', null),
              tr('action.stop'),
            ),
            createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-dschat-send',
                title: tr('action.send'),
                'aria-label': tr('action.send'),
                disabled: !canSend,
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

  /**
   * The action row: 会话列表 / 新对话 on the left, 「⇄ DSH 迁移」 at the right
   * end.
   *
   * 会话列表 lives here rather than in the title bar, and that is a decision
   * about WHERE ITS PANEL OPENS rather than about where the button looks best.
   * The list is a panel that hangs upward off its trigger, exactly like 迁移 —
   * so the trigger has to sit at the bottom of the panel, where there is a
   * transcript above it to open into. In the header there is 52px of window
   * chrome and nothing else, and the panel would have to open DOWNWARD over the
   * conversation it lists. The row is also where the reader is: these are the
   * conversation's verbs, and 「会话列表」 is one of them.
   *
   * All of them are the same thing to look at: a 28px quiet pill with a glyph
   * and a 13px label (`.dsh-dschat-tbtn`), which is the shape the input card's
   * own tool row speaks one line below. They used to be 34px glyph-only squares
   * — the web app's own header controls, moved down with their shape intact —
   * and that shape was the problem: a square with a glyph in it is a control
   * you have to already know, and this row is the ONE place a reader looks for
   * "a new chat" or "the list of chats". Naming them costs ~180px of a row that
   * has the space, and it means the panel's verbs are readable without hovering
   * anything.
   *
   * Grouping is unchanged: browsing on the left, handing the conversation off
   * at the right end, so the row still finishes on its terminal action. The
   * engine menu is NOT here — it lives at the title bar's right end (see
   * {@link moreMenu}), because those four entries are about the panel and its
   * browser rather than about this conversation.
   */
  function actions(): ReactNode {
    return createElement(
      'div',
      { className: 'dsh-dschat-actions', role: 'toolbar', 'aria-label': tr('composer.actions') },
      /*
       * 会话列表, and the panel it opens — ONE wrapper, exactly like 迁移.
       *
       * The wrapper is not decoration: `.dsh-dschat-pop` is absolutely
       * positioned, so its containing block is the nearest positioned ancestor,
       * and the wrapper is what makes that ancestor the trigger's own box
       * rather than the panel. Standing the panel next to the button instead of
       * around it is the bug the lamp's menu already paid for — see the note on
       * the lamp wrapper — where a 230px panel opened hundreds of pixels from
       * the dot that opened it.
       */
      createElement(
        'div',
        /*
         * `listWrapRef` is what the measurement effect and the outside-click
         * effect both hang off: it is the trigger's own box plus the popover, so
         * "where is this button" and "did the press land inside the menu" are
         * the same element.
         */
        { className: 'dsh-dschat-pop-wrap', ref: listWrapRef },
        /*
         * The trigger.
         *
         * The glyph is three rules now, not the panel-with-gutter the sidebar
         * version used: that glyph drew a SIDE COLUMN, so it promised a sidebar
         * while the click opened something that hangs over the transcript. See
         * MenuIcon.
         *
         * `dsh-dschat-tbtn-sessions` is a MARKER class the tests and the design
         * scripts select on, in the same spirit as `dsh-dschat-tbtn-transfer` —
         * it carries no styling of its own.
         */
        createElement(
          'button',
          {
            type: 'button',
            className: railOpen
              ? 'dsh-dschat-tbtn dsh-dschat-tbtn-on dsh-dschat-tbtn-sessions'
              : 'dsh-dschat-tbtn dsh-dschat-tbtn-sessions',
            title: railOpen ? tr('rail.hide') : tr('rail.show'),
            'aria-label': tr('action.sessions'),
            'aria-haspopup': 'dialog',
            'aria-expanded': railOpen,
            onClick: () => { toggleRail() },
          },
          createElement('span', { className: 'dsh-dschat-tbtn-glyph' }, createElement(MenuIcon, { size: 16 })),
          createElement('span', { className: 'dsh-dschat-tbtn-text' }, tr('action.sessions')),
        ),
        sessionsPopover(),
      ),
      /*
       * 搜索 is NOT a button here.
       *
       * It was one, and it only ever did two things: bring the list back if it
       * was closed, and put the cursor in the list's search box. With the list
       * open — the default — the box is already on screen, so the button was a
       * second, wordier copy of an input the reader can simply click. That is
       * why it did not earn its place: this row is the conversation's verbs, and
       * "search this conversation" is not a mode the way 会话列表 / 新对话 / 迁移
       * are.
       *
       * Its one unique offer — reaching search without opening the list first —
       * is ⌘K's job, and ⌘K routes through `openSearch()`, which opens the list
       * and puts the cursor in its box. Before ⌘K did that, the shortcut wrote
       * into a null ref while the list was closed and did nothing at all, which
       * is exactly why the button could not simply be deleted on its own.
       */
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-dschat-tbtn',
          title: tr('action.newChat.hint'),
          'aria-label': tr('action.newChat'),
          disabled: preparingNewChat,
          onClick: () => { void newChat() },
        },
        createElement('span', { className: 'dsh-dschat-tbtn-glyph' }, createElement(PlusIcon, { size: 16 })),
        createElement('span', { className: 'dsh-dschat-tbtn-text' }, tr('action.newChat')),
      ),
      createElement('div', { className: 'dsh-dschat-spacer' }),
      transferPopover(),
    )
  }

  /**
   * The engine menu: 运行状态 / 导出 markdown / 打开登录窗口 / 关闭浏览器.
   *
   * It has moved twice, and the two moves were about two different things.
   * v0.4 took it off the title bar and hung it on the state lamp, reasoning that
   * these entries describe the engine and the lamp is what reports the engine.
   * v0.4.1 put it back on the action row, because a 7px dot reads as a readout
   * rather than as a button and the menu therefore had no VISIBLE home — 导出
   * markdown is something a reader goes looking for.
   *
   * It now sits at the title bar's right end, which is where it started and
   * where it belongs: 运行状态 reads and 导出 markdown writes the PANEL's own
   * state, 打开登录窗口 and 关闭浏览器 drive its browser — none of the four is
   * about the conversation, and every one of them is the kind of thing a title
   * bar's 「···」 holds. The action row keeps the conversation's verbs, and the
   * reader who is writing a message never has to aim past them.
   *
   * The lamp keeps its own panel, now just the status sentence (see
   * {@link lampMenu}), and it opens downward from the same strip.
   */
  function moreMenu(): ReactNode {
    const open = moreOpen
    return createElement(
      'div',
      { className: 'dsh-dschat-pop-wrap', ref: morePopRef },
      createElement(
        'button',
        {
          type: 'button',
          className: open ? 'dsh-dschat-tbtn dsh-dschat-tbtn-on' : 'dsh-dschat-tbtn',
          title: tr('more.hint'),
          'aria-label': tr('more.hint'),
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: () => setMoreOpen(value => !value),
        },
        createElement(MoreIcon, { size: 16 }),
      ),
      open && createElement(
        'div',
        { className: 'dsh-dschat-pop dsh-dschat-pop-menu' },
        moreItem('status', tr('status.title'), () => setStatusOpen(true)),
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
          className: 'dsh-dschat-menu-item',
          onClick: () => { run(); setMoreOpen(false) },
        },
        label,
      )
    }
  }

  /**
   * The lamp's panel: the status sentence, and nothing else.
   *
   * It is also the lamp's tooltip, but a tooltip needs a hover to exist and this
   * is the one place the reader has explicitly ASKED what the colour means. The
   * engine's commands used to be listed under it; they are on the action row's
   * 「···」 now, so this panel is one line — which is the right size for the
   * question it answers.
   */
  function lampMenu(): ReactNode {
    /*
     * The wrapper this panel used to carry is gone: the caller renders it
     * AROUND the lamp, because the absolutely positioned panel needs the lamp's
     * own box as its containing block (see the header's note).
     */
    if (!lampOpen) return null
    return createElement(
      'div',
      { className: 'dsh-dschat-pop dsh-dschat-pop-status', ref: lampPopRef },
      createElement(
        'div',
        { className: 'dsh-dschat-lamp-status' },
        createElement('i', { className: 'dsh-dschat-lamp-dot', 'data-tone': lampTone, 'aria-hidden': 'true' }),
        createElement('span', null, whaleTitle),
      ),
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
          /*
           * `dsh-dschat-tbtn-transfer` is a MARKER, not a style: the two
           * labelled buttons on this row wear the identical treatment (that is
           * the point of the change), so nothing in the stylesheet keys off
           * this class. It exists so the verification script and future tests
           * can name the migration button without reaching for its text.
           */
          className: transferOpen
            ? 'dsh-dschat-tbtn dsh-dschat-tbtn-on dsh-dschat-tbtn-transfer'
            : 'dsh-dschat-tbtn dsh-dschat-tbtn-transfer',
          title: tr('transfer.short.hint'),
          'aria-label': tr('transfer.short.hint'),
          'aria-haspopup': 'menu',
          'aria-expanded': transferOpen,
          disabled: transferring || viewChat === undefined || viewChat.messages.length === 0,
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
            if (!transferOpen) {
              setTransferTarget('new')
              setTargetSessionId(undefined)
            }
            setTransferOpen(open => !open)
          },
        },
        /*
         * The swap glyph makes the button findable at the row's right end
         * without the words: it reads as "hand this over", which is what both
         * migration modes do. The two labels are separate spans so the row's
         * own `gap` spaces them evenly — a bare text node beside an icon has no
         * box to be spaced by.
         */
        createElement('span', { className: 'dsh-dschat-tbtn-glyph' }, createElement(SwapIcon, { size: 14 })),
        createElement('span', { className: 'dsh-dschat-tbtn-text' }, tr('transfer.short')),
        createElement('span', { className: 'dsh-dschat-tbtn-caret' }, createElement(CaretIcon, {})),
      ),
      transferOpen && createElement(
        'div',
        { className: 'dsh-dschat-pop dsh-dschat-pop-up' },
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
            createElement('option', { value: '__new__' }, tr('transfer.workspace.new')),
          ),
        ),

        /*
         * The hand-off preview: the exact first message, before it exists.
         *
         * Editable on purpose — the reader may want to trim a paragraph, add a
         * line of their own, or (seeing the fallback notice) switch to 原文迁移
         * knowingly rather than discovering afterwards that a 15k-character log
         * was written in place of a brief.
         */
        preview !== undefined && createElement('div', { className: 'dsh-dschat-field' },
          createElement('label', null, tr('transfer.preview')),
          createElement('p', {
            className: 'dsh-dschat-hintline dsh-dschat-preview-note',
            'data-tone': preview.distilled ? 'ok' : 'warn',
          }, preview.distilled ? tr('transfer.preview.distilled') : tr('transfer.preview.raw')),
          preview.fallback && preview.fallbackReason !== undefined
            ? createElement('p', {
              className: 'dsh-dschat-hintline dsh-dschat-preview-note',
              'data-tone': 'warn',
            }, preview.fallbackReason)
            : null,
          createElement('textarea', {
            className: 'dsh-dschat-input dsh-dschat-preview',
            value: previewDraft,
            spellCheck: false,
            'aria-label': tr('transfer.preview'),
            onChange: (event: { target: { value: string } }) => setPreviewDraft(event.target.value),
          }),
          createElement('p', { className: 'dsh-dschat-hintline dsh-dschat-preview-meta' },
            // Through `fmt`, like every other counted string in this panel: the
            // placeholder substitution is the panel's own, not the host's.
            fmt(tr('transfer.preview.chars'), { count: String(previewDraft.length) }),
            previewDraft.length !== preview.chars ? tr('transfer.preview.edited') : ''),
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
          preview === undefined
            ? createElement('button', {
              type: 'button',
              className: 'dsh-dschat-btn dsh-dschat-btn-primary',
              disabled: previewing || transferring || viewChat === undefined,
              onClick: () => { void loadTransferPreview() },
            }, previewing
              ? tr('transfer.preview.building')
              : (transferTarget === 'continue' ? tr('transfer.target.continue') : tr('action.startTransfer')))
            : createElement('button', {
              type: 'button',
              className: 'dsh-dschat-btn dsh-dschat-btn-primary',
              disabled: transferring || previewDraft.trim() === '',
              onClick: () => { void runTransfer() },
            }, tr('transfer.confirm')),
          // Rebuilding is the escape hatch for "the preview is stale but I have
          // not changed a setting" — the effect only clears one on a real change.
          preview !== undefined && createElement('button', {
            type: 'button',
            className: 'dsh-dschat-btn',
            disabled: transferring || previewing,
            onClick: () => { setPreview(undefined); setPreviewDraft(''); void loadTransferPreview() },
          }, tr('transfer.preview.rebuild')),
          createElement('span', { className: 'dsh-dschat-hintline', style: { margin: 0 } },
            preview === undefined ? note : tr('transfer.preview.note')),
        ),
      ),
    )
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
