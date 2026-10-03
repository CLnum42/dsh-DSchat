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
import { renderTranscriptMarkdown, transferToHarnessSession } from './transfer.ts'
import type { DistillConfig } from './transfer.ts'
import type { DSchatErrorCode } from './protocol.ts'

/** Actionable hint for a structured engine error code (surfaced to the agent). */
function errorCodeHint(code: DSchatErrorCode | undefined): string {
  switch (code) {
    case 'NEED_LOGIN': return '需要先登录：请在插件面板点击「打开登录窗口」完成 DeepSeek 网页登录。'
    case 'PAGE_CHANGED': return '页面/协议疑似改版：请升级 dsh-dschat 插件。'
    case 'TIMEOUT': return '生成超时：可稍后重试。'
    case 'NETWORK': return '网络/浏览器错误：请检查网络或浏览器是否可用。'
    case 'BUSY': return '上一条回复仍在生成：请等待它结束或先调用 dschat 停止，再重试。'
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
        },
      },
      render: (_args, value: { reply?: string; error?: string; code?: string; partial?: boolean }) => {
        const partial = value.partial === true
        const hint = errorCodeHint(value.code as DSchatErrorCode | undefined)
        return text([
          `dschat_send: 已通过 DeepSeek 网页端发送并收到回复${partial ? '（生成可能不完整）' : ''}`,
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
    async execute(args: { text?: string; images?: unknown }): Promise<{ reply: string; error?: string; code?: string; partial: boolean }> {
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
      }
    },
  })
}

/** The web-conversation recover tool (sync web sidebar → local store). */
export function dschatRecoverTool(engine: DeepSeekWebEngine) {
  return defineTool({
    name: 'dschat_recover',
    description: 'Recover a DeepSeek 网页端 conversation into the local store so it can be imported/transferred. Reads the conversation\'s own history (whole transcript, including reasoning, in one request) and refreshes an existing local transcript when the recovered history is fuller. With no title or sessionId, lists the web-side conversations. Triggers: 同步网页会话, 恢复网页对话, sync webchat.',
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
        if (!result.ok) return { report: `dschat_recover: 恢复失败 — ${result.error ?? ''}` }
        const action = result.created === true ? '已恢复' : (result.updated === true ? '已刷新（原记录不完整）' : '本地已是最新')
        return {
          report:
            `dschat_recover: ${action}「${result.title ?? title}」为本地对话 ${result.chatId ?? ''}` +
            `，共 ${String(result.messageCount ?? 0)} 条消息（来源：${result.source ?? '-'}）` +
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

/** The transfer tool (closes over the host context so it can create sessions). */
export function dschatTransferTool(hostCtx: Context, store: TranscriptStore, distill: DistillConfig) {
  return defineTool({
    name: 'dschat_transfer',
    description: 'Transfer a stored DeepSeek 网页端 transcript into harness mode: distills the web conversation into an executable task brief (goal, established context, current state, next steps) and creates a NEW harness session whose first message is that brief (not the raw chat log), OR appends it as a fresh user message to an EXISTING session via targetSessionId (continue the same task). Optionally target a workspace (workspaceId from dschat_status workspaces list) so the new session is grouped under it. Returns the (new or target) session id. Triggers: 转移到 harness, 转成开发会话, transfer webchat.',
    parameters: {
      chatId: { type: 'string', description: 'Transcript id (from dschat_status). Omit for the active chat.' },
      targetSessionId: { type: 'string', description: 'Optional existing harness session id to CONTINUE (append the brief as a new user message) instead of creating a new session. Omit to create a new session.' },
      workspaceId: { type: 'string', description: 'Optional target workspace id (from the workspaces list in dschat_status). Omit to leave the new session ungrouped. Ignored when targetSessionId is given.' },
      cwd: { type: 'string', description: 'Optional absolute working directory for the new session; ignored when workspaceId or targetSessionId is given.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true },
          distilled: { type: 'boolean' },
          attached: { type: 'boolean' },
          continued: { type: 'boolean' },
          workspaceId: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { sessionId?: string; distilled?: boolean; attached?: boolean; continued?: boolean; workspaceId?: string; error?: string }) => {
        if (value.error !== undefined) return text(value.error)
        const note = value.distilled === true ? '（已蒸馏为任务简报）' : '（蒸馏不可用，已回退为原始对话记录）'
        if (value.continued === true) {
          return text(`dschat_transfer: 已把网页对话作为新的用户消息延续到 harness 会话 ${value.sessionId ?? ''}${note}。请告知用户打开该会话继续开发。`)
        }
        const where = value.workspaceId !== undefined ? `已归入工作区 ${value.workspaceId}` : '未分组'
        return text(`dschat_transfer: 已创建新 harness 会话 ${value.sessionId ?? ''}${note}（${where}）。请告知用户从侧边栏打开该会话继续开发。`)
      },
    },
    async execute(args: { chatId?: string; targetSessionId?: string; workspaceId?: string; cwd?: string }): Promise<{ sessionId: string; distilled: boolean; attached: boolean; continued?: boolean; workspaceId?: string; error?: string }> {
      const chat = typeof args?.chatId === 'string' ? store.getChat(args.chatId) : store.activeChat()
      if (chat === undefined) return { sessionId: '', distilled: false, attached: false, error: 'dschat_transfer: 找不到对话记录（用 dschat_status 查看列表）' }
      const targetSessionId = typeof args?.targetSessionId === 'string' && args.targetSessionId !== '' ? args.targetSessionId : undefined
      const workspace = targetSessionId === undefined && typeof args?.workspaceId === 'string' && args.workspaceId !== '' ? { workspaceId: args.workspaceId } : undefined
      try {
        const { sessionId, distilled, attached, workspaceId, duplicate } = await transferToHarnessSession(hostCtx, { transcript: chat, cwd: args?.cwd, workspace, targetSessionId }, distill)
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
        return { sessionId: '', distilled: false, attached: false, continued: targetSessionId !== undefined, error: `dschat_transfer: 转移失败 — ${String(error)}` }
      }
    },
  })
}
