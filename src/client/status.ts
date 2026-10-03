/**
 * Live engine status for the panel header's whale mark.
 *
 * The header mark carries a state through its COLOUR (blue = the web engine is
 * usable, grey = it is not), and the two places that know that state do not
 * render at the same time:
 *
 *   · the PANEL polls `/state` and knows the phase exactly, but it is unmounted
 *     whenever the reader is looking at another panel;
 *   · the SIDEBAR ICON is always mounted, but has no API of its own.
 *
 * So the state lives here, in one module-level store that both read. The panel
 * publishes by calling {@link touchEngineStatus} with the snapshot it just
 * polled; the mark reads with {@link useEngineStatus} and re-renders through
 * `useSyncExternalStore`.
 */
import { useSyncExternalStore } from 'react'
import { phaseOf, type DSchatPhase, type DSchatState } from '../protocol.ts'

/** What the header mark (and anything else) renders from. */
export interface EngineStatus {
  /** The fine-grained phase, also the `data-phase` the stylesheet colours off. */
  readonly phase: DSchatPhase
  /** Full status sentence for the tooltip: "已就绪 · deepseek-reasoner". */
  readonly detail: string
  /** Three-valued login state: null while unknown. */
  readonly loggedIn: boolean | null
  /** True when the phase has a login window to offer (drives the click). */
  readonly canOpenLogin: boolean
}

/** Before the first poll: nothing is known, so nothing is claimed. */
const UNKNOWN: EngineStatus = { phase: 'stopped', detail: '', loggedIn: null, canOpenLogin: false }

let current: EngineStatus = UNKNOWN
const listeners = new Set<() => void>()

/** Localized copy for the status sentence, injected once by the panel. */
let translate: ((key: string) => string) | undefined

/**
 * Compose the tooltip sentence for a phase.
 *
 * This is the ONE place the removed status chip's text still exists. It was
 * deliberately kept after the chip itself was deleted: the colour alone cannot
 * tell a reader WHICH model is answering, or that an engine error happened
 * rather than a plain stop, and a tooltip costs the header no width.
 *
 * @param phase - the derived panel phase.
 * @param engineError - the engine's own message, when it reported one.
 */
export function statusDetail(phase: DSchatPhase, engineError?: string): string {
  const tr = (key: string, fallback: string): string => translate?.(key) ?? fallback
  switch (phase) {
    case 'launching': return tr('status.launching', '正在启动浏览器')
    case 'need-login': return tr('status.needLogin', '未登录')
    case 'error': {
      const head = tr('status.error', '引擎错误')
      return engineError === undefined ? head : `${head}：${engineError}`
    }
    case 'thinking': return tr('status.thinking', '正在思考')
    case 'streaming': return tr('status.streaming', '正在输出')
    case 'ready': return tr('status.ready', '已就绪')
    default: return tr('status.stopped', '未启动')
  }
}

/**
 * The model the mark's tooltip names, read off the live transcript.
 *
 * Taken from the active conversation rather than a constant: the web switches
 * deepseek-chat / deepseek-reasoner per conversation, and this string is the
 * only place left that reports which one answered.
 *
 * @param state - the snapshot the panel just polled.
 */
function modelOf(state: DSchatState): string {
  const active = state.chats.find(chat => chat.id === state.activeChatId) ?? state.chats[0]
  return active?.model ?? 'deepseek-chat'
}

/**
 * Fold a freshly polled snapshot into the store and notify subscribers.
 *
 * Called on EVERY poll rather than only on a phase change: the tooltip also
 * names the model, which can change under a steady `ready` phase.
 *
 * @param state - the snapshot the panel just polled.
 */
export function touchEngineStatus(state: DSchatState): void {
  const phase = phaseOf({
    engine: state.engine,
    loggedIn: state.loggedIn,
    busy: state.busy,
    chats: state.chats,
  })
  const text = statusDetail(phase, state.engineError)
  set({
    phase,
    detail: phase === 'ready' && state.loggedIn === true ? `${text} · ${modelOf(state)}` : text,
    loggedIn: state.loggedIn,
    canOpenLogin: state.loggedIn !== true,
  })
}

/** Store one status; identical statuses notify nobody (React bails out on identity). */
function set(next: EngineStatus): void {
  if (
    next.phase === current.phase
    && next.detail === current.detail
    && next.loggedIn === current.loggedIn
    && next.canOpenLogin === current.canOpenLogin
  ) return
  current = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const snapshot = (): EngineStatus => current

/**
 * Read the live engine status.
 *
 * `useSyncExternalStore` is reached through the React namespace rather than a
 * named import: the browser half resolves React from the harness module table,
 * and pinning this file to one export name is a boot-time failure if that table
 * ever changes shape. Without it the mark still renders — it just stops
 * following a panel that is not on screen, which is a degradation rather than a
 * blanked slot.
 *
 * @param translateFn - the panel's translator, so the copy follows the locale.
 */
export function useEngineStatus(translateFn?: (key: string) => string): EngineStatus {
  if (translateFn !== undefined) translate = translateFn
  type Store = (
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => EngineStatus,
    getServerSnapshot: () => EngineStatus,
  ) => EngineStatus
  const store = useSyncExternalStore as unknown as undefined | Store
  /*
   * The SAME getter serves both sides, which is the point: the panel is rendered
   * to static markup by its own smoke test, and a missing server getter is a
   * throw rather than a fallback. Identity is also what React compares, so the
   * cached object has to be returned as-is instead of rebuilt per call.
   */
  return store === undefined ? current : store(subscribe, snapshot, snapshot)
}
