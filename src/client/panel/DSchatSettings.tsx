/**
 * The DSchat settings page — registered into the shell's `settings.section`
 * slot, so it is a first-class page beside General / Models / Plugins rather
 * than a modal of our own.
 *
 * The page is read-only by design: the plugin's tunables live in its `Config`
 * (validated, patched by the profile layer), and the shell already renders that
 * form on the Plugins page. What a user actually needs here is the resolved
 * value of each knob plus the two actions that get them unstuck — sign in, and
 * shut the browser down.
 */

import { createElement, useCallback, useEffect, useState, type ReactNode } from 'react'
import { phaseOf, type DSchatState } from '../../protocol.ts'
import type { DSchatApi } from '../api.ts'
import { CheckIcon, CloseIcon } from '../icons.tsx'

/** Resolved host settings as the context route reports them. */
interface SettingsView {
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

export interface DSchatSettingsProps {
  api: DSchatApi
  /** Locale accessor bound to this plugin's namespace. */
  tt: (key: string) => string
  /** Locale accessor the slot system provides when `locale` is declared. */
  t?: (key: string) => string
  /** Shell affordance: close the settings panel. */
  close?: () => void
}

export function DSchatSettings(props: DSchatSettingsProps): ReactNode {
  const { api, tt, t } = props
  const tr = useCallback((key: string): string => (t ?? tt)(key), [t, tt])

  const [state, setState] = useState<DSchatState | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [failed, setFailed] = useState<string | undefined>(undefined)

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
    // Slow poll: the page shows engine status, and a settings page is not a
    // live view — 3s is enough to notice a login finishing.
    const timer = window.setInterval(() => { void tick() }, 3_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [refresh])

  const openLogin = useCallback((): void => { void api.openLogin().catch(() => undefined) }, [api])
  const closeBrowser = useCallback((): void => { void api.closeBrowser().catch(() => undefined) }, [api])

  const phase = state === null
    ? 'stopped'
    : phaseOf({ engine: state.engine, loggedIn: state.loggedIn, busy: state.busy, chats: state.chats })
  const loggedIn = state?.loggedIn ?? null

  const statusText = ((): string => {
    switch (phase) {
      case 'launching': return tr('status.launching')
      case 'need-login': return tr('status.needLogin')
      case 'error': return `${tr('status.error')}${state?.engineError !== undefined ? `：${state.engineError}` : ''}`
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
   * These were hard-coded 「是」/「否」, so the English dictionary shipped a page
   * that answered in Chinese. The glyphs stay: a tick/cross reads faster than a
   * word in either language.
   */
  const yesNo = (value: boolean | undefined): ReactNode => value === true
    ? createElement('span', { className: 'dsh-dschat-on' }, createElement(CheckIcon, {}), tr('settings.yes'))
    : createElement('span', { className: 'dsh-dschat-off' }, createElement(CloseIcon, { size: 10 }), tr('settings.no'))

  return createElement(
    'div',
    { className: 'dsh-dschat dsh-dschat-settings' },
    createElement('header', { className: 'dsh-dschat-sethead' },
      createElement('h1', null, tr('settings.title')),
      createElement('p', null, tr('settings.description')),
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
      createElement('h2', null, tr('settings.runtime')),
      settings === null
        ? createElement('p', { className: 'dsh-dschat-hintline' }, failed ?? tr('settings.loading'))
        : createElement('div', null,
            row(tr('settings.channel'), settings.browserChannel === '' ? 'auto' : settings.browserChannel),
            row(tr('settings.headless'), yesNo(settings.browserHeadless)),
            row(tr('settings.proxy'), settings.browserProxy === '' ? 'direct' : settings.browserProxy),
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
      ),
      createElement('p', { className: 'dsh-dschat-sethint' }, tr('settings.where')),
    ),
  )
}
