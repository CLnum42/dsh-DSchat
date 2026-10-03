/**
 * Browser-half entry for dsh-DSchat.
 *
 * Runs inside the harness Web page and registers THREE things, all through the
 * shell's own slot system — nothing is injected into the DOM:
 *
 *   sidebar.panellist  (id: dschat)  the sidebar nav entry; the shell owns the
 *                                    button and reads the label from metadata
 *   main               (key: dschat) the whole center-column panel
 *   settings.section   (id: dschat)  a native settings page for the plugin
 *
 * Failure policy: a mount problem is logged, never thrown — the shell fails the
 * whole boot when a plugin apply throws, and an external plugin must not take
 * the GUI down.
 *
 * Export discipline: the /client surface carries what cordis loading needs.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { DSchatApi } from './api.ts'
import { ChatIcon } from './icons.tsx'
import { en, zh, type DSchatDict } from './locales.ts'
import { DSchatPanel } from './panel/DSchatPanel.tsx'
import { DSchatSettings } from './panel/DSchatSettings.tsx'
import { PANEL_CSS } from './panel/styles.ts'

/** Locale + settings namespace this plugin owns. */
const NS = 'dsh-dschat'

/** The `main` slot key and the `sidebar.panellist` id — the same value binds them. */
const PANEL_ID = 'dschat'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-DSchat surface copy. */
    'dsh-dschat': keyof DSchatDict
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale', 'layout']

/**
 * Mount the DSchat surfaces.
 * @param ctx - client root context (slots + locale services).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-dschat: dictionaries')

  // Styles live as a plugin-owned <style> element, registered as an effect so
  // unloading the plugin removes them with everything else it owns.
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = NS
    tag.textContent = PANEL_CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-dschat: styles')

  const api = new DSchatApi()
  const tt = ctx.locale.bind(NS)

  /**
   * Resolve a Client service at CALL time.
   *
   * `uiWorkspace` and `workspaces` belong to other Client plugins and are
   * deliberately not declared in this plugin's `inject` list, so that a
   * deployment without the workspace UI still gets the DSchat panel. Reading
   * them ONCE during `apply` and caching the result is what broke "在 Harness 中
   * 继续": when this plugin happened to apply before the workspace UI was
   * mounted, the cached value was `undefined` forever, so the transfer created
   * its session and then silently never navigated anywhere (the optional call
   * swallowed the whole action). Reading through `ctx.get` per call uses
   * whatever is registered now, which is also the service the shell is using.
   */
  const readService = <T,>(key: string): T | undefined =>
    (ctx as unknown as { get(name: string): T | undefined }).get(key)

  /** The navigation half of the workspace UI, borrowed per call. */
  interface UiWorkspaceFace {
    openSession(target: unknown): void
    pickDirectory(): Promise<string | null>
  }

  /**
   * How many 60 ms ticks to wait for the Host's `api-session/added` row to
   * reach this page. The transfer response and that event travel different
   * sockets, so the response can land first; ~3 s covers a busy tab without
   * leaving a timer running forever.
   */
  const OPEN_SESSION_ATTEMPTS = 50
  const OPEN_SESSION_RETRY_MS = 60

  /**
   * Navigate to a session, retrying while the Client list catches up.
   *
   * Resolves `true` once the shell took the navigation, `false` when it never
   * could. The boolean matters: the FAILURE used to be invisible — the renderer
   * threw `sessions.retain: unknown session <id>` inside a try/catch and the
   * click simply did nothing, leaving the reader looking at whichever session
   * happened to be on screen (a freshly transferred session's predecessor is
   * exactly the case that was reported). The panel now surfaces `false`.
   *
   * @param sessionId - the Host-created session to open.
   */
  const openSession = async (sessionId: string): Promise<boolean> => {
    // A Host-created session's title lives in its `session/title` event, and the
    // sidebar reads the `title` projection. Warm it now so the row is not blank
    // when it appears (best-effort: the history opening would load it too).
    const sessions = readService<{ refreshProjections?(id: string): Promise<void> }>('sessions')
    try {
      await sessions?.refreshProjections?.(sessionId)?.catch(() => undefined)
    } catch {
      // A projection warm-up failure must not block the navigation.
    }

    return await new Promise<boolean>(resolve => {
      let attempt = 0
      const navigate = (): void => {
        const uiWorkspace = readService<UiWorkspaceFace>('uiWorkspace')
        if (uiWorkspace === undefined) {
          console.warn('[dsh-dschat] openSession: the uiWorkspace service is unavailable')
          resolve(false)
          return
        }
        try {
          // Throws `sessions.retain: unknown session <id>` while the Client list
          // has not learned the session yet — see OPEN_SESSION_ATTEMPTS.
          uiWorkspace.openSession(sessionId)
          resolve(true)
        } catch (error) {
          if (++attempt < OPEN_SESSION_ATTEMPTS) {
            window.setTimeout(navigate, OPEN_SESSION_RETRY_MS)
            return
          }
          console.warn('[dsh-dschat] openSession failed:', error)
          resolve(false)
        }
      }
      navigate()
    })
  }

  const pickDirectory = async (): Promise<string | null> => {
    try {
      return (await readService<UiWorkspaceFace>('uiWorkspace')?.pickDirectory()) ?? null
    } catch {
      return null
    }
  }

  const createWorkspace = async (path: string): Promise<{ workspaceId: string; title: string }> => {
    const workspaces = readService<{ create(input: { path: string }): Promise<{ workspaceId: string; title: string }> }>('workspaces')
    if (workspaces === undefined) throw new Error('workspaces service unavailable')
    const created = await workspaces.create({ path })
    return { workspaceId: created.workspaceId, title: created.title }
  }

  const disposers: Array<() => void> = []
  try {
    // Sidebar nav entry. The shell renders the button and reads `label` on
    // every projection, so a locale switch updates the row without re-register.
    disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => tt('nav.label'), locale: NS },
      ChatIcon as never,
    )))

    // The center-column panel, keyed by the same id the sidebar row dispatches.
    disposers.push(ctx.slots.inject('main', () => ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ api, tt, openSession, pickDirectory, createWorkspace }),
      },
      DSchatPanel as never,
    )))

    // A native settings page. Registering into a slot declared by another
    // subtree must go through slots.inject: a bare register() races the
    // sidebar.settings entry and is silently dropped. `label` is a thunk, so
    // the shell re-reads it on every projection and a locale switch needs no
    // re-registration. The settings page needs only the API client and the locale.
    disposers.push(ctx.slots.inject('settings.section', () => ctx.slots.register(
      {
        name: 'settings.section',
        id: PANEL_ID,
        order: 50,
        label: () => tt('settings.title'),
        locale: NS,
        inject: () => ({ api, tt }),
      },
      DSchatSettings as never,
    )))
  } catch (error) {
    console.warn('[dsh-dschat] slot registration failed:', error)
  }

  ctx.effect(() => () => { for (const dispose of disposers.splice(0)) dispose() }, 'dsh-dschat: slots')
}
