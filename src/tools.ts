/**
 * Agent tools: the DSH-native counterpart of the web-chat panel. The harness
 * agent can chat through the DeepSeek web session (dschat_send), inspect
 * stored transcripts (dschat_status / dschat_import), and hand a web
 * conversation into a new harness session (dschat_transfer) — mirroring how
 * Codex's chatgpt mode lets the agent itself use the web subscription.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { DeepSeekWebEngine } from './engine/engine.ts'
import type { TranscriptStore } from './store.ts'
import { previewHarnessTransfer, renderTranscriptMarkdown, transferToHarnessSession } from './transfer.ts'
import type { DistillConfig } from './transfer.ts'
import type { DSchatErrorCode } from './protocol.ts'

/** Actionable hint for a structured engine error code (surfaced to the agent). */
function errorCodeHint(code: DSchatErrorCode | undefined): string {
  switch (code) {
    case 'NEED_LOGIN': return '需要先登录：请在插件面板点击「打开登录窗口」完成 DeepSeek 网页登录。'
    case 'PAGE_CHANGED': return '页面/协议疑似改版：请升级 dsh-dschat 插件。'
    case 'TIMEOUT': return '生成超时：可稍后重试。'
    case 'NETWORK': return '网络/浏览器错误：请检查网络或浏览器是否可用。'
    // Names a tool that EXISTS: the old text told the agent to "先调用 dschat 停止",
    // which is not a tool name, so a stuck agent called something that was never
    // there and failed on top of being stuck.
    case 'BUSY': return '上一条回复仍在生成：请等待它结束，或调用 dschat_stop 停止后再重试。'
    default: return ''
  }
}

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Minimal workspace projection surfaced to the agent (id/path/title only). */
export interface WorkspaceRef {
  id: string
  path: string
  title: string
}

/** Render the chat list compactly. */
function renderChats(store: TranscriptStore): string {
  const chats = store.list()
  if (chats.length === 0) return '还没有任何网页端对话记录'
  return chats.map(chat => {
    const messages = chat.messages.length
    const last = chat.messages.at(-1)
    const preview = last === undefined ? '' : ` · 最后: ${last.content.replace(/\s+/g, ' ').slice(0, 60)}`
    return `${chat.id} | ${chat.title} | ${chat.model} | ${messages} 条消息 | ${new Date(chat.updatedAt).toLocaleString()}${preview}`
  }).join('\n')
}

/** The engine-status tool. */
export function dschatStatusTool(engine: DeepSeekWebEngine, store: TranscriptStore, listWorkspaces?: () => WorkspaceRef[] | undefined) {
  return defineTool({
    name: 'dschat_status',
    description: 'Report the DeepSeek 网页端 (chat.deepseek.com) web-chat state: engine status, login state, active chat, stored transcripts, and the harness workspaces available as dschat_transfer targets. Triggers: webchat, deepseek 网页端, 网页聊天. Use before dschat_send to confirm login.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          report: { type: 'string', required: true },
        },
      },
      render: (_args, value: { report?: string }) => text(value.report ?? ''),
    },
    async execute(): Promise<{ report: string }> {
      const status = await engine.status()
      const active = store.activeChat()
      const lines = [
        `engine: ${status.engine}${status.engineError !== undefined ? ` (${status.engineError})` : ''}`,
        `loggedIn: ${String(status.loggedIn)}`,
        `pageUrl: ${status.pageUrl ?? '-'}`,
        `deepThink: ${String(status.deepThink)}`,
        `search: ${String(status.search)}`,
        `busy: ${String(status.busy)}`,
        `activeChat: ${active === undefined ? '-' : `${active.id} (${active.title})`}`,
        `chats:\n${renderChats(store)}`,
      ]
      const web = await engine.listWebConversations().catch(() => [] as Array<{ title: string; sessionId?: string }>)
      if (web.length > 0) {
        // Missing is by session id, not title: recovered transcripts carry the
        // id, and a title-only check could never notice that an old import was
        // truncated (which is how "recovered content is too short" stayed
        // invisible).
        const imported = store.webSessionIds()
        const missing = web.filter(item => item.sessionId === undefined || !imported.has(item.sessionId))
        lines.push(`dschats:\n${web.map(item => `  - ${item.title}${item.sessionId === undefined ? '' : ` [${item.sessionId}]`}`).join('\n')}`)
        if (missing.length > 0) {
          lines.push(`dschatsNotImported (use dschat_recover):\n${missing.map(item => `  - ${item.title}`).join('\n')}`)
        }
      }
      const workspaces = listWorkspaces?.()
      if (workspaces !== undefined) {
        lines.push('workspaces:')
        if (workspaces.length === 0) lines.push('  (none)')
        else for (const ws of workspaces) lines.push(`  ${ws.id} | ${ws.title} | ${ws.path}`)
      }
      return { report: lines.join('\n') }
    },
  })
}

/** The send-via-web tool. */
export function dschatSendTool(engine: DeepSeekWebEngine) {
  return defineTool({
    name: 'dschat_send',
    description: 'Send one message through the DeepSeek 网页端 (chat.deepseek.com) using the web model — your web session, no API billing. The assistant reply streams until complete and returns as markdown. Optionally attach local image files (absolute paths) for multimodal prompts. Requires the user to have logged into the web chat once (dschat_status → loggedIn true). Best for asking the web model to explain/design/review; do not use for file operations. Triggers: 网页端提问, deepseek web, chatgpt mode.',
    parameters: {
      text: { type: 'string', required: true, description: 'The message to send to deepseek-chat on the web.' },
      images: { type: 'array', items: { type: 'string' }, description: 'Optional local absolute paths of image files to attach (multimodal prompt).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reply: { type: 'string', required: true },
          error: { type: 'string' },
          code: { type: 'string' },
          partial: { type: 'boolean' },
          stopped: { type: 'boolean' },
        },
      },
      render: (_args, value: { reply?: string; error?: string; code?: string; partial?: boolean; stopped?: boolean }) => {
        const partial = value.partial === true
        const stopped = value.stopped === true
        const hint = errorCodeHint(value.code as DSchatErrorCode | undefined)
        return text([
          `dschat_send: 已通过 DeepSeek 网页端发送并收到回复${stopped ? '（本次生成已被停止，下面是停止前的内容）' : partial ? '（生成可能不完整）' : ''}`,
          value.error !== undefined ? `（注意：${value.error}）` : '',
          hint !== '' ? `（${hint}）` : '',
          '',
          '--- 网页端回复 ---',
          (value.reply ?? '').trim() === '' ? '（空回复）' : (value.reply ?? '').trim(),
          '--- 回复结束 ---',
          '',
          '会话已保存，可用 dschat_transfer 将整段对话转移到 harness 会话。',
        ].join('\n'))
      },
    },
    async execute(args: { text?: string; images?: unknown }): Promise<{ reply: string; error?: string; code?: string; partial: boolean; stopped?: boolean }> {
      const textValue = typeof args?.text === 'string' ? args.text.trim() : ''
      if (textValue === '') return { reply: '', error: '缺少 text 参数', partial: false }
      const images = Array.isArray(args?.images)
        ? args.images.filter(value => typeof value === 'string').map(value => value as string)
        : undefined
      // wait=true so the tool returns the completed reply (the GUI path is fire-and-forget).
      const result = await engine.send(textValue, true, images)
      return {
        reply: result.reply ?? '',
        partial: result.error !== undefined,
        // Omit the absent fields: `undefined` own properties make the value
        // non-lossless-JSON, so the harness would reject the result of every
        // SUCCESSFUL send with "value is not lossless JSON".
        ...(result.error === undefined ? {} : { error: result.error }),
        ...(result.code === undefined ? {} : { code: result.code }),
        ...(result.stopped === true ? { stopped: true } : {}),
      }
    },
  })
}

/**
 * The stop tool.
 *
 * Exists because the agent had no way to end a turn it had started:
 * `dschat_send` with `wait: true` holds the engine for up to the reply
 * timeout, and the BUSY hint told the agent to "先调用 dschat 停止" — a tool
 * that was never registered. A stuck agent could only wait, or fail.
 */
export function dschatStopTool(engine: DeepSeekWebEngine) {
  return defineTool({
    name: 'dschat_stop',
    description: 'Stop the reply currently being generated on the DeepSeek 网页端 (chat.deepseek.com). Use when dschat_send reported BUSY, when the web model is stuck or producing something unwanted, or when the user asks to stop. Takes effect within about a second and the partial reply stays in the transcript. Triggers: 停止生成, 停下网页端, stop webchat.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { report: { type: 'string', required: true } },
      },
      render: (_args, value: { report?: string }) => text(value.report ?? ''),
    },
    async execute(): Promise<{ report: string }> {
      // Sampled BEFORE the click: by the time `stop()` has run, `busy` is on its
      // way to false and the report would claim there was nothing to stop.
      const wasBusy = engine.getBusy()
      await engine.stop()
      return {
        report: wasBusy
          ? 'dschat_stop: 已请求停止生成。停止前已生成的内容保留在该会话中；需要完整回答可重新发送这条提问。'
          : 'dschat_stop: 当前没有正在生成的回复（已向页面发送停止请求，以防面板状态落后）。',
      }
    },
  })
}

/** The web-conversation sync tool (web sidebar → local store). */
export function dschatRecoverTool(engine: DeepSeekWebEngine) {
  return defineTool({
    name: 'dschat_recover',
    description: 'Sync a DeepSeek 网页端 conversation into the local store so it can be imported/transferred. Reads the conversation\'s own history (whole transcript, including reasoning, in one request) and MERGES it into an existing local transcript: messages already stored keep their ids and timestamps, only the missing ones are appended and a truncated copy is completed in place. With no title or sessionId, lists the web-side conversations. Triggers: 同步网页会话, 从网页同步, 恢复网页对话, sync webchat.',
    parameters: {
      title: { type: 'string', description: 'Conversation title (from the web sidebar or dschat_status dschats list). Omit to list web conversations.' },
      sessionId: { type: 'string', description: 'Web session id from dschat_status (the [id] after a title). Preferred over title: titles repeat, ids do not.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
      render: (_args, value: { report?: string }) => text(value.report ?? ''),
    },
    async execute(args: { title?: string; sessionId?: string }): Promise<{ report: string }> {
      const title = typeof args?.title === 'string' ? args.title.trim() : ''
      const sessionId = typeof args?.sessionId === 'string' ? args.sessionId.trim() : ''
      if (title !== '' || sessionId !== '') {
        const result = await engine.recoverWebConversation({
          ...(title === '' ? {} : { title }),
          ...(sessionId === '' ? {} : { sessionId }),
        })
        if (!result.ok) return { report: `dschat_recover: 同步失败 — ${result.error ?? ''}` }
        const action = result.created === true
          ? '已同步为新对话'
          : (result.updated === true ? '已增量更新' : '本地已是最新')
        /*
         * The counters are what makes an incremental sync verifiable: 「新增 2
         * 条 · 补全 1 条」 says both that the merge found the two new turns AND
         * that it did not rewrite the other thirty.
         */
        const detail = [
          (result.added ?? 0) > 0 ? `新增 ${String(result.added)} 条` : '',
          (result.completed ?? 0) > 0 ? `补全 ${String(result.completed)} 条` : '',
          (result.replaced ?? 0) > 0 ? `更新 ${String(result.replaced)} 条` : '',
          (result.kept ?? 0) > 0 ? `本地保留 ${String(result.kept)} 条` : '',
        ].filter(part => part !== '')
        return {
          report:
            `dschat_recover: ${action}「${result.title ?? title}」为本地对话 ${result.chatId ?? ''}` +
            `，共 ${String(result.messageCount ?? 0)} 条消息（来源：${result.source ?? '-'}）` +
            `${detail.length === 0 ? '' : `，${detail.join('，')}`}` +
            `${result.sessionId === undefined ? '' : `，sessionId ${result.sessionId}`}。可用 dschat_transfer 转移。`,
        }
      }
      const web = await engine.listWebConversations().catch(() => [] as Array<{ title: string; sessionId?: string }>)
      if (web.length === 0) return { report: 'dschat_recover: 未在网页端读到会话（可能未登录或页面已改版）' }
      return { report: web.map(item => `- ${item.title}${item.sessionId === undefined ? '' : ` [${item.sessionId}]`}`).join('\n') }
    },
  })
}

/** The transcript import tool. */
export function dschatImportTool(store: TranscriptStore) {
  return defineTool({
    name: 'dschat_import',
    description: 'Import one stored DeepSeek 网页端 transcript as markdown so the agent can continue the discussion itself. Triggers: 读取网页对话, import webchat, 把网页聊天作为上下文. Use dschat_status to list chat ids first.',
    parameters: {
      chatId: { type: 'string', description: 'Transcript id (from dschat_status). Omit for the active chat.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          transcript: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { transcript?: string; error?: string }) => {
        if (value.error !== undefined) return text(value.error)
        return text(value.transcript ?? '')
      },
    },
    async execute(args: { chatId?: string }): Promise<{ transcript: string; error?: string }> {
      const chat = typeof args?.chatId === 'string' ? store.getChat(args.chatId) : store.activeChat()
      if (chat === undefined) return { transcript: '', error: 'dschat_import: 找不到对话记录（用 dschat_status 查看列表）' }
      return { transcript: renderTranscriptMarkdown(chat) }
    },
  })
}

/**
 * How long a preview stays usable for a later `confirm: true`.
 *
 * Distillation is several sequential model calls, so confirming must not pay
 * for it a second time; but the brief describes the conversation at a moment in
 * time, and a stale one must not be written silently. Fifteen minutes covers a
 * human reading the brief and answering, and expires well before the web
 * conversation could have moved on unnoticed.
 */
const PREVIEW_TTL_MS = 15 * 60 * 1000

/** The transfer tool (closes over the host context so it can create sessions). */
export function dschatTransferTool(hostCtx: Context, store: TranscriptStore, distill: DistillConfig) {
  /** Last preview per destination, so `confirm` reuses the text it showed. */
  const previews = new Map<string, { at: number; markdown: string; distilled: boolean }>()
  return defineTool({
    name: 'dschat_transfer',
    description: 'Transfer a stored DeepSeek 网页端 transcript into harness mode. By DEFAULT this only builds a PREVIEW: it distills (or replays) the conversation and returns the exact text that would become the new session\'s first message, writing nothing — show it to the user, then call again with confirm: true to write it (the preview is reused for 15 minutes, so the second call does not re-distill). With confirm: true it creates a NEW harness session seeded with that brief (not the raw chat log), OR appends it as a fresh user message to an EXISTING session via targetSessionId (continue the same task). Optionally target a workspace (workspaceId from dschat_status workspaces list) so the new session is grouped under it. Triggers: 转移到 harness, 转成开发会话, transfer webchat.',
    parameters: {
      chatId: { type: 'string', description: 'Transcript id (from dschat_status). Omit for the active chat.' },
      confirm: { type: 'boolean', description: 'Set true to actually write the hand-off. Omit (or false) to only preview it — nothing is created or appended either way in that case.' },
      targetSessionId: { type: 'string', description: 'Optional existing harness session id to CONTINUE (append the brief as a new user message) instead of creating a new session. Omit to create a new session.' },
      workspaceId: { type: 'string', description: 'Optional target workspace id (from the workspaces list in dschat_status). Omit to leave the new session ungrouped. Ignored when targetSessionId is given.' },
      cwd: { type: 'string', description: 'Optional absolute working directory for the new session; ignored when workspaceId or targetSessionId is given.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string' },
          distilled: { type: 'boolean' },
          attached: { type: 'boolean' },
          continued: { type: 'boolean' },
          workspaceId: { type: 'string' },
          /** Present on a preview-only call: the exact text a confirm would write. */
          preview: { type: 'string' },
          /** True when distillation was asked for but fell back to the raw log. */
          fallback: { type: 'boolean' },
          fallbackReason: { type: 'string' },
          duplicate: { type: 'boolean' },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { sessionId?: string; distilled?: boolean; continued?: boolean; workspaceId?: string; preview?: string; fallback?: boolean; fallbackReason?: string; error?: string }) => {
        if (value.error !== undefined) return text(value.error)
        if (value.preview !== undefined) {
          const note = value.distilled === true ? '（已蒸馏为任务简报）' : '（蒸馏不可用，回退为原始对话记录）'
          return text([
            `dschat_transfer: 预览${note}。以下内容将作为新会话的首条消息，尚未写入任何会话。`,
            value.fallback === true && value.fallbackReason !== undefined ? `注意：${value.fallbackReason}` : '',
            '请把要点告诉用户；用户确认后，用 confirm: true 再调用一次即可写入（15 分钟内不会重复蒸馏）。',
            '',
            '--- 首条消息预览 ---',
            value.preview,
            '--- 预览结束 ---',
          ].filter(line => line !== '').join('\n'))
        }
        const note = value.distilled === true ? '（已蒸馏为任务简报）' : '（蒸馏不可用，已回退为原始对话记录）'
        if (value.continued === true) {
          return text(`dschat_transfer: 已把网页对话作为新的用户消息延续到 harness 会话 ${value.sessionId ?? ''}${note}。请告知用户打开该会话继续开发。`)
        }
        const where = value.workspaceId !== undefined ? `已归入工作区 ${value.workspaceId}` : '未分组'
        return text(`dschat_transfer: 已创建新 harness 会话 ${value.sessionId ?? ''}${note}（${where}）。请告知用户从侧边栏打开该会话继续开发。`)
      },
    },
    async execute(args: { chatId?: string; confirm?: boolean; targetSessionId?: string; workspaceId?: string; cwd?: string }): Promise<{ sessionId?: string; distilled?: boolean; attached?: boolean; continued?: boolean; workspaceId?: string; preview?: string; fallback?: boolean; fallbackReason?: string; duplicate?: boolean; error?: string }> {
      const chat = typeof args?.chatId === 'string' ? store.getChat(args.chatId) : store.activeChat()
      if (chat === undefined) return { error: 'dschat_transfer: 找不到对话记录（用 dschat_status 查看列表）' }
      const targetSessionId = typeof args?.targetSessionId === 'string' && args.targetSessionId !== '' ? args.targetSessionId : undefined
      const workspace = targetSessionId === undefined && typeof args?.workspaceId === 'string' && args.workspaceId !== '' ? { workspaceId: args.workspaceId } : undefined
      const key = `${chat.id}|${targetSessionId ?? ''}|${args?.workspaceId ?? ''}|${args?.cwd ?? ''}`
      /*
       * Preview by default: distillation is LOSSY (it drops the reasoning and
       * every source link) and its failure mode is to silently replay the raw
       * log instead, so "which of the two am I about to write?" is not something
       * the agent — or the human it is acting for — should have to infer from a
       * success message afterwards.
       */
      if (args?.confirm !== true) {
        try {
          const draft = await previewHarnessTransfer(hostCtx, { transcript: chat, cwd: args?.cwd, workspace, targetSessionId }, distill)
          previews.set(key, { at: Date.now(), markdown: draft.markdown, distilled: draft.distilled })
          return {
            distilled: draft.distilled,
            preview: draft.markdown,
            ...(draft.fallback ? { fallback: true } : {}),
            ...(draft.fallbackReason === undefined ? {} : { fallbackReason: draft.fallbackReason }),
          }
        } catch (error) {
          return { error: `dschat_transfer: 无法生成预览 — ${String(error)}` }
        }
      }
      const cached = previews.get(key)
      const reusable = cached !== undefined && Date.now() - cached.at < PREVIEW_TTL_MS ? cached : undefined
      if (reusable !== undefined) previews.delete(key)
      try {
        const { sessionId, distilled, attached, workspaceId, duplicate } = await transferToHarnessSession(hostCtx, {
          transcript: chat,
          cwd: args?.cwd,
          workspace,
          targetSessionId,
          // The confirmed text, when it is still fresh. Absent means no preview
          // was shown (or it expired), so the transfer builds its own.
          ...(reusable === undefined ? {} : { seedMarkdown: reusable.markdown, seedDistilled: reusable.distilled }),
        }, distill)
        return {
          sessionId,
          distilled,
          attached,
          continued: targetSessionId !== undefined,
          // Omit rather than set `undefined`: an own property holding undefined
          // is not lossless JSON, and the harness rejects the ENTIRE tool result
          // ("value is not lossless JSON") even though the transfer succeeded.
          // The continue-an-existing-session branch never has a workspace.
          ...(workspaceId === undefined ? {} : { workspaceId }),
          // True when this brief was already in the target session and nothing
          // was written — a retry, not a second round.
          ...(duplicate === undefined ? {} : { duplicate }),
        }
      } catch (error) {
        return { continued: targetSessionId !== undefined, error: `dschat_transfer: 转移失败 — ${String(error)}` }
      }
    },
  })
}
