/**
 * dsh-DSchat — host half.
 *
 * Mounts the DeepSeek web engine (a real browser at chat.deepseek.com driven
 * through its own page, persistent login profile), the /api/dsh-dschat route
 * family, the agent tools (dschat_status / dschat_send / dschat_recover /
 * dschat_import / dschat_transfer), the harness transfer (seed a new session
 * with a web transcript) and a system-prompt announcement.
 *
 * The browser half (./client) registers a NATIVE panel through the shell's own
 * slots — `sidebar.panellist` for the nav entry and `main` for the center
 * column — so nothing is injected into the DOM and the conversation column is
 * never covered.
 *
 * Derived from the Apache-2.0 licensed dsh-webchat plugin (same engine, same
 * transfer machinery); the surfaces above are renamed to the dsh-dschat
 * namespace so both plugins can be installed side by side.
 *
 * All transport rides the official NPM SDK packages — no dsh source changes.
 */

import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { DeepSeekWebEngine } from './engine/engine.ts'
import { resolveExportDir } from './export-dir.ts'
import { makeRoutes } from './routes.ts'
import type { HostContextView } from './routes.ts'
import { TranscriptStore } from './store.ts'
import { dschatImportTool, dschatRecoverTool, dschatSendTool, dschatStatusTool, dschatStopTool, dschatTransferTool } from './tools.ts'
import type { WorkspaceRef } from './tools.ts'
import type { DistillConfig } from './transfer.ts'

/**
 * The version and build time of the bundle that is RUNNING.
 *
 * "Which version am I on?" had four answers on this machine — `package.json`,
 * the git tag, the newest tarball, and whatever uncommitted tree the profile had
 * linked — and none of them described the loaded code. These are substituted by
 * `scripts/build.mjs` (`define`), so the status card can report the one answer
 * that is always right.
 *
 * `typeof`, not a bare read: the test harness bundles this entry WITHOUT those
 * defines, and reading an undeclared identifier would throw at import time
 * there. `typeof` on an undeclared name is defined to answer 'undefined', so a
 * raw bundle reports an empty version instead of failing to load.
 */
declare const __DSCHAT_VERSION__: string | undefined
declare const __DSCHAT_BUILD__: string | undefined
const BUILD = {
  version: typeof __DSCHAT_VERSION__ === 'string' ? __DSCHAT_VERSION__ : '',
  build: typeof __DSCHAT_BUILD__ === 'string' ? __DSCHAT_BUILD__ : '',
}

/** Stable cordis plugin name. */
export const name = 'dschat'

/** Services required before the DSchat surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt', 'sessions']

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** When true (default), a system-prompt section announces the plugin to every agent. */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled?: boolean
  /** Browser channel hint ('chrome' | 'msedge' | 'chromium' | 'auto'). */
  browserChannel?: string
  /** Explicit browser executable path. */
  browserExecutablePath?: string
  /** Proxy mode: 'direct' | 'system' | 'http://host:port'. */
  browserProxy?: string
  /**
   * Run the chat browser headless (invisible). Default true: only the one-time
   * login window is visible, and it auto-closes once logged in. Set false to
   * keep a visible browser window during chatting too.
   */
  browserHeadless?: boolean
  /** Max ms to wait for a web reply. */
  replyTimeoutMs?: number
  /** Data directory override (transcripts live here). */
  dataDir?: string
  /**
   * Browser profile directory. Defaults to the profile the previous
   * dsh-webchat install already logged into, so switching plugins does not
   * require logging into chat.deepseek.com again.
   */
  profileDir?: string
  /**
   * Where 「导出 markdown」 writes. Empty (the default) means the OS download
   * folder, `~/Downloads`. A relative path resolves against the home directory.
   */
  exportDir?: string
  /** When true (default), distill the transcript into an executable task brief before transfer. */
  transferDistill?: boolean
  /** Provider route for the transfer distillation call (empty = auto-detect). */
  transferProvider?: string
  /** Model id for the transfer distillation call (empty = auto-detect). */
  transferModel?: string
  /** Output-token cap for the final distillation brief (default 4096). */
  transferMaxTokens?: number
  /** Output-token cap per chunk summary in long-conversation map-reduce (default 1024). */
  transferChunkTokens?: number
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
  browserChannel: z.string().default('auto'),
  browserExecutablePath: z.string().default(''),
  browserProxy: z.string().default('direct'),
  browserHeadless: z.boolean().default(true),
  replyTimeoutMs: z.number().default(180_000),
  dataDir: z.string().default(''),
  profileDir: z.string().default(''),
  exportDir: z.string().default(''),
  transferDistill: z.boolean().default(true),
  transferProvider: z.string().default(''),
  transferModel: z.string().default(''),
  transferMaxTokens: z.number().default(4096),
  transferChunkTokens: z.number().default(1024),
})

/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 155

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const DSCHAT_GUIDANCE = '本机已安装 dsh-DSchat 插件（DeepSeek 网页端聊天 + 迁移到 harness）：在侧边栏「Chat」面板入口打开原生中心面板（不再是 DOM 注入的浮层）。它通过真实浏览器驱动 chat.deepseek.com，用网页登录会话与 DeepSeek 网页模型对话，无需 API 额度；支持深度思考/智能搜索开关、图片附件（拖拽或粘贴）、会话搜索与消息级操作。能力：dschat_status 查看登录/引擎/会话状态、dschat_send 通过网页端发送消息并流式获取回复（可附带本地图片路径做多模态提问）、dschat_stop 停止正在生成的回复（dschat_send 返回 BUSY 或用户要求停下时用它）、dschat_recover 把网页端会话增量同步到本地（已有的只补缺失的部分，不整体覆盖）、dschat_import 把存储的网页对话导入为 markdown 上下文、dschat_transfer 把网页对话蒸馏成可执行任务简报并迁移成 harness 会话：默认只返回预览（首条消息的完整文本，不创建任何会话），用户确认后带 confirm: true 再调用一次才真正写入，或经 targetSessionId 追加到已有会话延续同一任务。面板头部「在 Harness 中继续」提供同样的迁移（可选蒸馏简报 / 原文迁移、目标工作区、追加到已有会话），并在写入前展示可编辑的预览；蒸馏不可用时会明确提示已回退为原文。限制：首次使用需用户在弹出的浏览器窗口完成 DeepSeek 网页登录；网页端受 DeepSeek 官方风控，操作失败或页面改版时返回错误而非崩溃。用户提到「DSchat / 网页聊天 / 网页端 / ChatGPT 模式 / deepseek web / 转移到 harness」时即指本插件，请据此协作。'

/** Resolve `$DSH_HOME` (falling back to `$HOME`) without importing the host kit. */
function dshHome(): string {
  return process.env.DSH_HOME ?? process.env.HOME ?? '.'
}

/** Default plugin data dir (transcripts). */
function defaultDataDirOf(): string {
  return `${dshHome()}/.dsh/dsh-dschat`
}

/**
 * Default browser profile dir. The previous dsh-webchat plugin kept its login
 * session here; reusing it means the user stays logged into chat.deepseek.com
 * across the switch. Falls back to the plugin's own data dir when absent.
 */
function defaultProfileDirOf(dataDir: string): string {
  const legacy = `${dshHome()}/.dsh/dsh-webchat/browser-profile`
  return existsSync(legacy) ? legacy : `${dataDir}/browser-profile`
}

/** Convert resolved config to engine config. */
function engineConfigOf(resolve: () => Config): ConstructorParameters<typeof DeepSeekWebEngine>[1] {
  const value = resolve()
  const dataDir = value.dataDir?.trim() !== '' && value.dataDir !== undefined ? value.dataDir.trim() : defaultDataDirOf()
  const configuredProfile = value.profileDir?.trim() ?? ''
  return {
    dataDir,
    profileDir: configuredProfile !== '' ? configuredProfile : defaultProfileDirOf(dataDir),
    channel: value.browserChannel === 'auto' ? undefined : (value.browserChannel || undefined),
    executablePath: value.browserExecutablePath !== '' ? value.browserExecutablePath : undefined,
    proxy: value.browserProxy,
    headless: value.browserHeadless,
    replyTimeoutMs: value.replyTimeoutMs,
  }
}

/**
 * Mount the engine, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  const current = (): Config => config ?? {}
  const resolve = (): Config => ({
    announceToAgent: current().announceToAgent ?? DEFAULT_ANNOUNCE,
    enabled: current().enabled ?? true,
    browserChannel: current().browserChannel ?? 'auto',
    browserExecutablePath: current().browserExecutablePath ?? '',
    browserProxy: current().browserProxy ?? 'direct',
    browserHeadless: current().browserHeadless ?? true,
    replyTimeoutMs: current().replyTimeoutMs ?? 180_000,
    dataDir: current().dataDir ?? '',
    profileDir: current().profileDir ?? '',
    exportDir: current().exportDir ?? '',
    transferDistill: current().transferDistill ?? true,
    transferProvider: current().transferProvider ?? '',
    transferModel: current().transferModel ?? '',
    transferMaxTokens: current().transferMaxTokens ?? 4_096,
    transferChunkTokens: current().transferChunkTokens ?? 1_024,
  })

  const distillConfigOf = (value: Config): DistillConfig => ({
    distill: value.transferDistill ?? true,
    provider: (value.transferProvider ?? '').trim(),
    model: (value.transferModel ?? '').trim(),
    maxTokens: value.transferMaxTokens ?? 4_096,
    chunkTokens: value.transferChunkTokens ?? 1_024,
  })

  const dataDir = resolve().dataDir?.trim() !== '' && resolve().dataDir !== undefined
    ? resolve().dataDir.trim()
    : defaultDataDirOf()
  const store = new TranscriptStore({ dataDir })
  const engine = new DeepSeekWebEngine(store, engineConfigOf(resolve))
  ctx.effect(() => () => {
    // Transcript writes are coalesced (see `PERSIST_DEBOUNCE_MS`), so a disposal
    // is the last chance to land whatever the debounce is still holding. Closing
    // the browser does not imply a flush, and the process may be gone before the
    // timer would have fired. `dispose()` also hands back the single-writer lock
    // (see `TranscriptStore.acquireLock`), so a clean shutdown leaves nothing for
    // the next start to reason about.
    store.dispose()
    void engine.disposeBrowser()
  }, 'dsh-dschat: engine')

  const listWorkspaces = (): WorkspaceRef[] | undefined => {
    const registry = ctx.get('workspaceRegistry') as { list(): Array<{ id: string; path: string; title: string }> } | undefined
    if (registry === undefined) return undefined
    return registry.list().map(ws => ({ id: ws.id, path: ws.path, title: ws.title }))
  }

  /**
   * Host facts the browser panel needs: the workspace list, the recent session
   * cwd (transfer/export targets), and the resolved settings for the native
   * settings page. The panel never has to guess a Client service shape for
   * these.
   */
  const hostContext = (): HostContextView => {
    const value = resolve()
    const dataDir = value.dataDir?.trim() !== '' && value.dataDir !== undefined ? value.dataDir.trim() : defaultDataDirOf()
    const settings = {
      browserChannel: value.browserChannel ?? 'auto',
      browserExecutablePath: value.browserExecutablePath ?? '',
      browserProxy: value.browserProxy ?? 'direct',
      browserHeadless: value.browserHeadless ?? true,
      replyTimeoutMs: value.replyTimeoutMs ?? 180_000,
      dataDir,
      profileDir: engineConfigOf(resolve).profileDir ?? '',
      /*
       * The export target as a RESOLVED path, not the raw setting: the settings
       * page has to show where a file actually went, and the panel's toast says
       * the same thing. An empty setting resolves to ~/Downloads here rather
       * than in two places.
       */
      exportDir: resolveExportDir(value.exportDir),
      transferDistill: value.transferDistill ?? true,
      transferProvider: (value.transferProvider ?? '').trim(),
      transferModel: (value.transferModel ?? '').trim(),
      announceToAgent: value.announceToAgent ?? DEFAULT_ANNOUNCE,
    }
    const live = (ctx.get('sessions') as { list(): Array<{ header: { cwd?: string } }> } | undefined)
      ?.list() ?? []
    for (let i = live.length - 1; i >= 0; i--) {
      const cwd = live[i]?.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') return { workspaces: listWorkspaces() ?? [], cwd, settings }
    }
    return { workspaces: listWorkspaces() ?? [], settings }
  }

  const routes = makeRoutes({
    ctx,
    engine,
    store,
    build: BUILD,
    distill: distillConfigOf(resolve()),
    exportDir: () => resolveExportDir(resolve().exportDir),
    hostContext,
  })

  const tools = [
    dschatStatusTool(engine, store, listWorkspaces),
    dschatSendTool(engine),
    // The counterpart the BUSY hint has always pointed at; without it a stuck
    // agent could only wait for the reply timeout.
    dschatStopTool(engine),
    dschatRecoverTool(engine),
    dschatImportTool(store),
    dschatTransferTool(ctx, store, distillConfigOf(resolve())),
  ]

  let disposeSection: (() => void) | undefined
  let disposeRoutes: (() => void) | undefined
  let disposeTools: (() => void) | undefined

  // Register (or drop) every surface to match the current source. Each group
  // is kept under one disposer: re-registering first tears the old one down
  // so duplicate-name registrations never throw.
  const sync = (): void => {
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    const value = resolve()
    if (!value.enabled) return
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-dschat',
        order: SECTION_ORDER,
        text: DSCHAT_GUIDANCE,
      })
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map(route => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-dschat: routes',
    )
    disposeTools = ctx.effect(
      () => {
        const disposers = tools.map(tool => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-dschat: tools',
    )
  }

  // Register every surface from the composed config. The loader re-runs apply()
  // with fresh config when the plugin row is reloaded, so a settings edit is
  // picked up by re-entry rather than by a live source hook.
  sync()
}
