/**
 * 「运行状态」 — the engine's live state, the resolved runtime settings, and the
 * two actions that get a stuck engine unstuck.
 *
 * This used to be a page of its own in the shell's Settings, registered into
 * `settings.section`. It is not a setting: nothing on it can be edited (the
 * plugin's knobs live in its Config and are rendered by the shell on the
 * Plugins page), and a reader who wants to know why the web page is not
 * answering is looking at the DSchat panel, not in Settings. So it moved here —
 * one card, opened from the panel's own 「···」 menu, next to the two actions it
 * shares with that menu.
 *
 * Read-only by design, and it polls while it is open: the phase is the thing
 * that changes under the reader's eyes (a launch finishing, a login landing).
 */

import { createElement, useCallback, useEffect, useState, type ReactNode } from 'react'
import { phaseOf, type DSchatState } from '../../protocol.ts'
import type { DSchatApi } from '../api.ts'
import { CheckIcon, CloseIcon } from '../icons.tsx'

/** Resolved host settings as the context route reports them. */
export interface SettingsView {
  browserChannel: string
  browserExecutablePath: string
  browserProxy: string
  browserHeadless: boolean
  replyTimeoutMs: number
  dataDir: string
  profileDir: string
  /** Resolved destination of 「导出 markdown」 (the download folder by default). */
  exportDir: string
  transferDistill: boolean
  transferProvider: string
  transferModel: string
  announceToAgent: boolean
}

export interface DSchatStatusProps {
  api: DSchatApi
  /** Locale accessor bound to this plugin's namespace. */
  tt: (key: string) => string
  /** Locale accessor the slot system provides when `locale` is declared. */
  t?: (key: string) => string
}

export function DSchatStatus(props: DSchatStatusProps): ReactNode {
  const { api, tt, t } = props
  const tr = useCallback((key: string): string => (t ?? tt)(key), [t, tt])

  const [state, setState] = useState<DSchatState | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  /** The outcome of the last 「复制诊断」, shown under the button. */
  const [diag, setDiag] = useState<'idle' | 'copied' | 'failed'>('idle')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [snapshot, context] = await Promise.all([api.state(), api.context()])
      if (snapshot.ok === true) setState(snapshot as unknown as DSchatState)
      if (context.ok === true && context.settings !== undefined) setSettings(context.settings)
      setFailed(undefined)
    } catch (error) {
      setFailed(String(error))
    }
  }, [api])

  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      if (cancelled) return
      await refresh()
    }
    void tick()
    // Slow poll: this card is a diagnostic, and 3 s is enough to notice a launch
    // finishing or a login landing without competing with the panel's own feed.
    const timer = window.setInterval(() => { void tick() }, 3_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [refresh])

  const openLogin = useCallback((): void => { void api.openLogin().catch(() => undefined) }, [api])
  const closeBrowser = useCallback((): void => { void api.closeBrowser().catch(() => undefined) }, [api])


  const phase = state === null
    ? 'stopped'
    : phaseOf({ engine: state.engine, loggedIn: state.loggedIn, busy: state.busy, chats: state.chats })
  const loggedIn = state?.loggedIn ?? null

  /**
   * The report the 「复制诊断」 button copies, assembled at click time.
   *
   * Thin wrapper over {@link buildDiagnosticReport} so the text itself stays a
   * pure function — it is the deliverable of this card, and a deliverable that
   * can only be produced by clicking is one that cannot be checked.
   */
  const diagnosticText = useCallback(async (): Promise<string> => {
    const probe = await api.probePage().catch(error => ({ ok: false, error: String(error) }))
    return buildDiagnosticReport({
      version: state?.version,
      build: state?.build,
      phase,
      engine: state?.engine,
      engineError: state?.engineError,
      loggedIn: state?.loggedIn ?? null,
      busy: state?.busy,
      deepThink: state?.deepThink,
      search: state?.search,
      pageUrl: state?.pageUrl,
      lastError: state?.lastError,
      lastErrorCode: state?.lastErrorCode,
      storeWarning: state?.storeWarning,
      chats: state?.chats.length ?? 0,
      settings,
      probe,
      userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    })
  }, [api, state, settings, phase])

  /**
   * Copy the diagnostics, and SAY whether it worked.
   *
   * The panel's other copy actions report 「已复制」 whatever happens, which is
   * how a reader ends up pasting an empty clipboard into an issue. `writeText`
   * rejects when the document is not focused or the permission is denied, so the
   * outcome is checked, and a failure still leaves the text in the console
   * rather than losing it.
   */
  const copyDiagnostics = useCallback((): void => {
    void (async () => {
      const text = await diagnosticText()
      try {
        await navigator.clipboard.writeText(text)
        setDiag('copied')
      } catch {
        console.log(text)
        setDiag('failed')
      }
      window.setTimeout(() => { setDiag('idle') }, 4_000)
    })()
  }, [diagnosticText])

  const statusText = ((): string => {
    switch (phase) {
      case 'launching': return tr('status.launching')
      case 'need-login': return tr('status.needLogin')
      case 'error': return `${tr('status.error')}${state?.engineError !== undefined ? `${tr('send.join')}${state.engineError}` : ''}`
      case 'thinking': return tr('status.thinking')
      case 'streaming': return tr('status.streaming')
      case 'ready': return tr('status.ready')
      default: return tr('status.stopped')
    }
  })()

  const row = (label: string, value: ReactNode, mono = false): ReactNode => createElement(
    'div',
    { className: 'dsh-dschat-setrow', key: label },
    createElement('span', { className: 'dsh-dschat-setlabel' }, label),
    createElement('span', {
      className: mono ? 'dsh-dschat-setvalue dsh-dschat-mono' : 'dsh-dschat-setvalue',
      title: typeof value === 'string' ? value : undefined,
    }, value),
  )

  /**
   * A boolean setting, in the reader's language.
   *
   * These were hard-coded 「是」/「否」, so the English dictionary shipped a card
   * that answered in Chinese. The glyphs stay: a tick/cross reads faster than a
   * word in either language.
   */
  const yesNo = (value: boolean | undefined): ReactNode => value === true
    ? createElement('span', { className: 'dsh-dschat-on' }, createElement(CheckIcon, {}), tr('settings.yes'))
    : createElement('span', { className: 'dsh-dschat-off' }, createElement(CloseIcon, { size: 10 }), tr('settings.no'))

  return createElement(
    'div',
    { className: 'dsh-dschat dsh-dschat-status' },
    createElement('header', { className: 'dsh-dschat-sethead' },
      createElement('h1', null, tr('status.title')),
      createElement('p', null, tr('status.description')),
    ),

    createElement('section', { className: 'dsh-dschat-setcard' },
      createElement('h2', null, tr('settings.status')),
      row(tr('settings.phase'), statusText),
      row(tr('settings.login'),
        loggedIn === true ? tr('settings.login.yes') : loggedIn === false ? tr('settings.login.no') : tr('settings.login.unknown')),
      row(tr('settings.page'), state?.pageUrl ?? '—', true),
      state?.lastError !== undefined ? row(tr('settings.lastError'), state.lastError) : null,
    ),

    createElement('section', { className: 'dsh-dschat-setcard' },
      createElement('h2', null, tr('settings.build')),
      row(tr('settings.version'),
        state?.version === undefined || state.version === '' ? tr('settings.unknown') : state.version, true),
      row(tr('settings.built'), state?.build === undefined || state.build === '' ? tr('settings.unknown') : state.build, true),
    ),

    createElement('section', { className: 'dsh-dschat-setcard' },
      createElement('h2', null, tr('settings.runtime')),
      settings === null
        ? createElement('p', { className: 'dsh-dschat-hintline' }, failed ?? tr('settings.loading'))
        : createElement('div', null,
            row(tr('settings.channel'), settings.browserChannel === '' ? tr('settings.auto') : settings.browserChannel),
            row(tr('settings.headless'), yesNo(settings.browserHeadless)),
            row(tr('settings.proxy'), settings.browserProxy === '' ? tr('settings.direct') : settings.browserProxy),
            row(tr('settings.timeout'), `${Math.round(settings.replyTimeoutMs / 1000)}s`),
            row(tr('settings.executable'), settings.browserExecutablePath === '' ? tr('settings.auto') : settings.browserExecutablePath, true),
            row(tr('settings.dataDir'), settings.dataDir, true),
            row(tr('settings.profileDir'), settings.profileDir, true),
            row(tr('settings.exportDir'), settings.exportDir, true),
            row(tr('settings.distill'), yesNo(settings.transferDistill)),
            row(tr('settings.distillModel'),
              settings.transferModel === '' ? tr('settings.auto') : `${settings.transferProvider === '' ? tr('settings.auto') : settings.transferProvider} / ${settings.transferModel}`, true),
            row(tr('settings.announce'), yesNo(settings.announceToAgent)),
          ),
    ),

    createElement('section', { className: 'dsh-dschat-setcard' },
      createElement('h2', null, tr('settings.actions')),
      createElement('div', { className: 'dsh-dschat-setactions' },
        createElement('button', {
          type: 'button',
          className: 'dsh-dschat-btn dsh-dschat-btn-primary',
          onClick: openLogin,
        }, tr('action.openLogin')),
        createElement('button', {
          type: 'button',
          className: 'dsh-dschat-btn dsh-dschat-btn-ghost',
          disabled: (state?.engine ?? 'stopped') === 'stopped',
          onClick: closeBrowser,
        }, tr('action.closeBrowser')),
        /*
         * 「复制诊断」 — the reader's one-click answer to "what do I send you?".
         *
         * It includes the live `probe-page` output, which is the difference
         * between a report someone can act on and one that says the page might
         * have changed.
         */
        createElement('button', {
          type: 'button',
          className: 'dsh-dschat-btn dsh-dschat-btn-ghost',
          onClick: copyDiagnostics,
        }, tr('status.diag.copy')),
      ),
      createElement('p', { className: 'dsh-dschat-sethint' },
        diag === 'copied' ? tr('status.diag.copied')
          : diag === 'failed' ? tr('status.diag.failed')
            : tr('status.where')),
    ),
  )
}

/** The fields {@link buildDiagnosticReport} reads, all optional but the phase. */
export interface DiagnosticInput {
  version?: string | undefined
  build?: string | undefined
  phase: string
  engine?: string | undefined
  engineError?: string | undefined
  loggedIn: boolean | null
  busy?: boolean | undefined
  deepThink?: boolean | undefined
  search?: boolean | undefined
  pageUrl?: string | undefined
  lastError?: string | undefined
  lastErrorCode?: string | undefined
  storeWarning?: string | undefined
  chats: number
  settings: SettingsView | null
  /** The `/probe-page` answer, verbatim (an object, or an error object). */
  probe: unknown
  userAgent?: string | undefined
}

/**
 * The diagnostic report, as plain text.
 *
 * Plain text rather than JSON because it is read by a human first and pasted
 * into an issue second; every line is `label: value`, and nothing is omitted for
 * looking unimportant — the whole point is that one copy-paste carries enough
 * state for someone else to reason about a failure they cannot reproduce.
 */
export function buildDiagnosticReport(input: DiagnosticInput): string {
  const dash = (value: string | undefined): string => (value === undefined || value === '' ? '-' : value)
  return [
    `dsh-DSchat ${dash(input.version)}`,
    `build: ${dash(input.build)}`,
    `phase: ${input.phase}${input.engineError === undefined ? '' : ` — ${input.engineError}`}`,
    `engine: ${dash(input.engine)} | loggedIn: ${String(input.loggedIn)} | busy: ${String(input.busy ?? false)}`,
    `deepThink: ${String(input.deepThink ?? false)} | search: ${String(input.search ?? false)}`,
    `pageUrl: ${dash(input.pageUrl)}`,
    `lastError: ${dash(input.lastError)}${input.lastErrorCode === undefined ? '' : ` [${input.lastErrorCode}]`}`,
    `storeWarning: ${dash(input.storeWarning)}`,
    `chats: ${String(input.chats)}`,
    `host: ${dash(input.userAgent)}`,
    input.settings === null
      ? 'settings: (not loaded)'
      : [
          `dataDir: ${input.settings.dataDir}`,
          `profileDir: ${input.settings.profileDir}`,
          `exportDir: ${input.settings.exportDir}`,
          `channel: ${input.settings.browserChannel} | headless: ${String(input.settings.browserHeadless)} | proxy: ${input.settings.browserProxy}`,
          `replyTimeoutMs: ${String(input.settings.replyTimeoutMs)} | distill: ${String(input.settings.transferDistill)} (${input.settings.transferProvider || 'auto'}/${input.settings.transferModel || 'auto'})`,
          `announceToAgent: ${String(input.settings.announceToAgent)}`,
        ].join('\n'),
    `probe: ${JSON.stringify(input.probe)}`,
  ].join('\n')
}
