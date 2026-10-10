/**
 * dsh-DSchat surface copy. zh is the key source; en mirrors every key. The key
 * union (not an object shape) is what the locale machinery wants —
 * `LocaleKeysOf<N>` intersects the namespace with `string`, so the namespace
 * value must itself be the key union (same pattern as the shipped plugins).
 */

/** Every user-visible string the DSchat panel renders. */
export interface DSchatDict {
  'nav.label': string
  'panel.title': string
  'panel.crashed': string

  'settings.title': string
  'settings.description': string
  'settings.status': string
  'settings.phase': string
  'settings.login': string
  'settings.login.yes': string
  'settings.login.no': string
  'settings.login.unknown': string
  'settings.page': string
  'settings.lastError': string
  'settings.runtime': string
  'settings.build': string
  'settings.version': string
  'settings.built': string
  'settings.unknown': string
  'settings.channel': string
  'settings.headless': string
  'settings.proxy': string
  'settings.timeout': string
  'settings.executable': string
  'settings.dataDir': string
  'settings.profileDir': string
  'settings.exportDir': string
  'settings.distill': string
  'settings.distillModel': string
  'settings.announce': string
  'settings.actions': string
  'settings.where': string
  'settings.loading': string
  'settings.auto': string
  'settings.direct': string

  'status.title': string
  'status.description': string
  'status.where': string
  'status.diag.copy': string
  'status.diag.copied': string
  'status.diag.failed': string
  'status.stopped': string
  'status.launching': string
  'status.needLogin': string
  'status.ready': string
  'status.thinking': string
  'status.streaming': string
  'status.error': string

  'action.openLogin': string
  'action.closeBrowser': string
  'action.newChat': string
  'action.newChat.hint': string
  /*
   * The name of 会话列表, used in three places now: the header button's
   * accessible name, the dialog's own heading, and the tests that pin both.
   * The button itself shows no text (see the header note in styles.ts), so this
   * string is the whole of what a screen reader hears for the control.
   */
  'action.sessions': string
  'action.recover': string
  'action.recover.hint': string
  'action.stop': string
  'action.send': string
  'action.startTransfer': string
  'action.exportFile': string

  'brand.title': string
  'lamp.green': string
  'lamp.red': string
  'lamp.grey': string
  'lamp.amber': string

  'composer.actions': string
  'more.hint': string
  'attach.show': string
  'attach.remove': string
  'attach.remove.hint': string
  'transfer.short': string
  'transfer.short.hint': string

  /*
   * 会话列表's popover. The keys keep the `rail.` prefix for the reason the
   * storage key keeps its own (see RAIL_OPEN_STORE in the panel): they are read
   * from the same places, and a rename would be churn in ten locales' worth of
   * call sites for a word the reader never sees.
   *
   * `rail.show` / `rail.hide` are the trigger's tooltip AND its accessible name
   * — the button carries the visible noun (action.sessions) and the tooltip
   * carries the sentence, which is what a reader hovering it needs to know:
   * whether the press opens or closes.
   */
  'rail.search': string
  'rail.search.hint': string
  'rail.search.clear': string
  'rail.show': string
  'rail.hide': string
  'rail.empty': string
  'rail.noMatch': string
  'rail.clear': string
  'rail.clearConfirm': string

  /*
   * The right-edge question navigator: the tick rail that expands into the
   * conversation's questions. Prefixed `qnav.` because `nav.label` above is
   * already the SIDEBAR row's name — a different "nav" entirely.
   */
  'qnav.label': string
  'qnav.title': string
  'qnav.item': string
  'qnav.attachment': string
  'qnav.latest': string
  'qnav.latest.hint': string

  'item.rename': string
  'item.rename.placeholder': string
  'item.delete': string
  'item.sync': string
  'item.rename.ok': string
  'item.rename.cancel': string

  'chats.count': string
  'time.justNow': string
  'time.minutes': string
  'time.hours': string
  'time.days': string
  'settings.yes': string
  'settings.no': string

  'empty.title': string
  'empty.body': string
  /**
   * The invitation to start: a label over three example asks.
   *
   * The empty page used to end on 「Enter 发送 / ⌘/ 聚焦」 — a key reference,
   * which is documentation rather than an invitation, and it says nothing about
   * WHAT this panel is good for. Three real questions the web model answers
   * well say it in one glance, and each one is a sentence the reader can send
   * as-is.
   */
  'empty.try': string
  'empty.try.translate': string
  'empty.try.summarize': string
  'empty.try.polish': string
  /**
   * Shown for a conversation whose body is still on its way, so a chat WITH
   * history never renders as the empty state (see `thread()`).
   */
  'thread.loading': string

  'engine.notice.title': string
  'engine.notice.error.title': string
  'engine.notice.offline.title': string
  'engine.notice.offline.body': string
  'engine.notice.login.title': string
  'engine.notice.login.body': string
  'engine.notice.retry': string
  'engine.notice.retrying': string
  'engine.notice.unreachable': string
  'engine.notice.staleHost': string
  'engine.notice.needLogin': string
  'engine.notice.queued': string

  'composer.placeholder': string
  'composer.notLoggedIn': string
  'composer.offline': string
  'composer.connecting': string
  'composer.attach.drop': string
  'composer.queue.note': string
  'composer.queue.files': string
  'composer.queue.cancel': string
  'composer.upload': string
  'composer.upload.hint': string
  'composer.upload.busy': string
  'composer.hint.focus': string
  'composer.hint.stop': string

  'toggle.deepThink': string
  'toggle.search': string
  'toggle.deepThink.hint': string
  'toggle.search.hint': string
  'composer.preparing': string

  'msg.you': string
  'msg.model': string
  'msg.model.think': string
  'msg.copy': string
  'msg.think.collapse': string
  'msg.details': string
  'msg.code.language': string
  'msg.copyThinking': string
  'msg.regenerate': string
  'msg.edit': string
  'msg.quote': string
  'msg.retry': string
  'msg.sources.count': string
  'msg.thought': string
  'msg.thought.running': string
  'msg.thought.prefix': string
  'msg.thought.seconds': string
  'msg.thought.minutes': string

  'phase.idle': string
  'phase.busy': string
  'phase.elapsed': string
  'phase.chars': string
  'phase.loggedIn': string
  'phase.notLoggedIn': string
  'phase.turns': string
  'phase.replyPartial': string

  'transfer.title': string
  'transfer.sub': string
  'transfer.mode': string
  'transfer.mode.distill': string
  'transfer.mode.raw': string
  'transfer.mode.distill.hint': string
  'transfer.mode.raw.hint': string
  'transfer.target': string
  'transfer.target.new': string
  'transfer.target.continue': string
  'transfer.continueTo': string
  'transfer.continue.empty': string
  'transfer.workspace': string
  'transfer.ungrouped': string
  'transfer.workspace.new': string
  'transfer.note.new': string
  'transfer.note.continue': string
  'transfer.step.distill': string
  'transfer.step.session': string
  'transfer.step.open': string
  'transfer.preview': string
  'transfer.preview.distilled': string
  'transfer.preview.raw': string
  'transfer.preview.chars': string
  'transfer.preview.edited': string
  'transfer.preview.building': string
  'transfer.preview.rebuild': string
  'transfer.preview.note': string
  'transfer.confirm': string

  'toast.copied': string
  'toast.thinkingCopied': string
  'toast.codeCopied': string
  'toast.send.failed': string
  'toast.wake.failed': string
  'toast.send.needLogin': string
  'toast.send.queued': string
  'toast.attach.failed': string
  'toast.attach.tooBig': string
  'toast.attach.tooMany': string
  'toast.rename.done': string
  'toast.rename.failed': string
  'toast.delete.done': string
  'toast.delete.failed': string
  'toast.undo': string
  'toast.restored': string
  'toast.clear.done': string
  'toast.clear.failed': string
  'toast.export.done': string
  'toast.export.failed': string
  'toast.transfer.done': string
  'toast.transfer.continued': string
  'toast.transfer.failed': string
  'toast.transfer.duplicate': string
  'toast.transfer.fallback': string
  'toast.transfer.retry': string
  'toast.recover.empty': string
  'toast.recover.progress': string
  'toast.recover.summary': string
  /*
   * What one sync actually changed. Four separate keys rather than one sentence
   * with four holes: a sync that only appended two turns must not print
   * 「补全 0 条 · 本地保留 0 条」, and the panel drops the parts that are zero.
   */
  'toast.recover.added': string
  'toast.recover.completed': string
  'toast.recover.replaced': string
  'toast.recover.kept': string
  'toast.sync.done': string
  'toast.sync.uptodate': string
  'toast.recover.failed': string
  'toast.open': string
  'toast.open.failed': string
  'toast.workspace.created': string
  'toast.workspace.failed': string

  'attach.name.unnamed': string
  'attach.name.pasted': string

  'send.newChat': string
  'send.toggle': string
  'send.openLogin': string
  'send.recover': string
  'send.recoverList': string
  'send.unknown': string
  'send.join': string

  'error.NEED_LOGIN': string
  'error.PAGE_CHANGED': string
  'error.TIMEOUT': string
  'error.NETWORK': string
  'error.BUSY': string
  'error.LOOPBACK': string
  'error.METHOD': string
  'error.ORIGIN': string
  'error.CSRF': string
  'error.PATH': string
  'error.BAD_REQUEST': string
  'error.TOO_LARGE': string
  'error.NOT_FOUND': string
  'error.INTERNAL': string
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: DSchatDict = {
  'nav.label': '聊天',
  'panel.title': '聊天',
  'panel.crashed': '面板渲染出错，页面其余部分不受影响。重新载入页面即可恢复；若反复出现请把下面的信息反馈给维护者。',
  'settings.title': 'DSchat',
  'settings.description': 'DeepSeek 网页端聊天与 harness 迁移设置',
  'settings.status': '状态',
  'settings.phase': '引擎',
  'settings.login': '网页登录',
  'settings.login.yes': '已登录',
  'settings.login.no': '未登录',
  'settings.login.unknown': '未知',
  'settings.page': '当前页面',
  'settings.lastError': '最近错误',
  'settings.runtime': '运行参数',
  'settings.build': '构建',
  'settings.version': '版本',
  'settings.built': '构建时间',
  'settings.unknown': '未知',
  'settings.channel': '浏览器渠道',
  'settings.headless': '聊天时无头',
  'settings.proxy': '代理',
  'settings.timeout': '回复等待上限',
  'settings.executable': '浏览器可执行文件',
  'settings.dataDir': '数据目录',
  'settings.profileDir': '浏览器 profile（登录态）',
  'settings.exportDir': 'markdown 导出目录',
  'settings.distill': '迁移时蒸馏简报',
  'settings.distillModel': '蒸馏模型',
  'settings.announce': '在 system prompt 里说明这组工具',
  'settings.actions': '操作',
  'settings.where': '以上参数来自 profile 的 cordis.patch.yml：在 dsh-dschat 那一行下面加 config: 块，重启 Harness 生效（这一版插件没有自带设置表单）。浏览器 profile 默认复用 dsh-webchat 的目录，所以切换插件不需要重新登录。',
  'settings.loading': '正在读取运行参数…',
  'settings.auto': '自动',
  'settings.direct': '直连',

  'status.title': '运行状态',
  'status.description': 'DeepSeek 网页端引擎的实时状态与解析后的运行参数（只读）。',
  'status.where': '以上参数来自 profile 的 cordis.patch.yml：在 dsh-dschat 那一行下面加 config: 块，重启 Harness 生效（这一版插件没有自带设置表单）。浏览器 profile 默认复用 dsh-webchat 的目录，所以切换插件不需要重新登录。',
  'status.diag.copy': '复制诊断',
  'status.diag.copied': '已复制到剪贴板，直接贴进问题反馈即可',
  'status.diag.failed': '复制失败（剪贴板不可用）：诊断内容已打印到控制台，可从那里复制',
  'status.stopped': '未启动',
  'status.launching': '正在启动浏览器',
  'status.needLogin': '未登录',
  'status.ready': '已就绪',
  'status.thinking': '正在思考',
  'status.streaming': '正在输出',
  'status.error': '引擎错误',

  'action.openLogin': '打开登录窗口',
  'action.closeBrowser': '关闭浏览器',
  'action.newChat': '新对话',
  'action.newChat.hint': '新对话（⌘⇧O）',
  'action.sessions': '会话列表',
  'action.recover': '从网页同步',
  'action.recover.hint': '把网页端的会话同步到本地：没有的收进来，已有的只补缺失的那部分（保留本地的消息 id、时间与思考用时）',
  'action.stop': '停止',
  'action.send': '发送',
  'action.startTransfer': '开始迁移',
  'action.exportFile': '导出 markdown',

  /*
   * Header: the product mark, and the status lamp that replaced the three
   * window controls there (those moved above the composer).
   *
   * The lamp's four sentences are also its accessible names: colour is the
   * whole signal on screen, so a reader who cannot see the difference still has
   * to hear which of the four states the engine is in.
   */
  'brand.title': 'DeepSeek Chat',
  'lamp.green': '正常运行',
  'lamp.red': '故障',
  'lamp.grey': '未启动',
  'lamp.amber': '正在启动或未登录',

  /* The action row above the input card. */
  'composer.actions': '会话与迁移操作',
  /*
   * The 「···」 at the row's right end. It names WHAT the menu holds rather than
   * saying "更多" — the four entries are exactly what a reader goes looking for
   * by name (导出 markdown, 运行状态), so the tooltip and the accessible name
   * carry those words instead of a shrug.
   */
  'more.hint': '更多：运行状态 / 导出 markdown / 登录窗口 / 关闭浏览器',
  'attach.show': '查看附件',
  'attach.remove': '移除附件',
  'attach.remove.hint': '移除附件 {name}',
  'transfer.short': 'DSH 迁移',
  'transfer.short.hint': '在 Harness 中继续：把这次网页对话蒸馏成简报，或按原文迁移成 harness 会话',

  'rail.search': '搜索会话…',
  'rail.search.hint': '搜索会话内容（⌘K）',
  'rail.search.clear': '清空搜索',
  'rail.show': '打开会话列表',
  'rail.hide': '关闭会话列表',
  'rail.empty': '还没有对话，点输入框上方的「＋ 新对话」开始',
  'rail.noMatch': '没有匹配的会话',
  'rail.clear': '清空全部',
  'rail.clearConfirm': '确认清空？',

  'qnav.label': '提问导航',
  'qnav.title': '本会话提问 · {count} 条',
  'qnav.item': '第 {index} 条提问：{text}',
  'qnav.attachment': '（附件）',
  'qnav.latest': '↓ 最新',
  'qnav.latest.hint': '回到最新消息',

  'item.rename': '重命名',
  'item.rename.placeholder': '会话标题',
  'item.delete': '删除（可撤销）',
  'item.sync': '从网页同步这条（只补缺失的部分）',
  'item.rename.ok': '确认重命名',
  'item.rename.cancel': '取消',

  'chats.count': '{count} 条',
  'time.justNow': '刚刚',
  'time.minutes': '{count} 分钟前',
  'time.hours': '{count} 小时前',
  'time.days': '{count} 天前',
  'settings.yes': '是',
  'settings.no': '否',

  'engine.notice.title': '网页端没有就绪',
  'engine.notice.error.title': '网页端连接出错',
  'engine.notice.offline.title': '网页端还没连上',
  'engine.notice.offline.body': '发消息前需要在后台把 chat.deepseek.com 拉起来（会复用已登录的浏览器 profile，通常几秒）。',
  'engine.notice.login.title': '还没有登录 DeepSeek 网页端',
  'engine.notice.login.body': '登录窗口会复用已保存的 profile；登录一次之后就不再需要。',
  'engine.notice.retry': '重试启动网页端',
  'engine.notice.retrying': '正在启动…',
  'engine.notice.unreachable': '本机引擎没有响应启动请求（/wake 无应答），消息没有发出去。请检查网络后重试。',
  'engine.notice.staleHost': '宿主半区还是旧版本（/wake 返回 404），已改为打开登录窗口。重启 Harness 后自动启动即可用。',
  'engine.notice.needLogin': '网页端需要登录：请在弹出的浏览器窗口里完成登录，登录成功后这条提示会自动消失。',
  'engine.notice.queued': '待发消息暂时发不出去（网页端没起来）。消息还在队列里，启动成功后会自动发出。',

  'empty.title': '直接和 DeepSeek 对话',
  'empty.body': '沿用你的网页登录，不消耗 API 额度。聊完一键蒸馏成任务简报。',
  'empty.try': '或者试试',
  'empty.try.translate': '把英文翻译为通顺的中文',
  'empty.try.summarize': '总结这份文档的主要内容',
  'empty.try.polish': '润色这段文字',

  'thread.loading': '正在载入这段对话…',

  'composer.placeholder': '给 DeepSeek 发消息，回车发送',
  'composer.notLoggedIn': '登录后即可发送 · 先输入也行',
  'composer.offline': '直接输入，会自动在后台打开',
  'composer.connecting': '正在打开 · 可以先输入',
  'composer.attach.drop': '松开即可添加文件',
  'composer.queue.note': '上一条回复还在生成，以上消息会在它结束后依次发出',
  'composer.queue.files': '附件 {count}',
  'composer.queue.cancel': '取消这条待发消息',
  'composer.upload': '上传文件',
  'composer.upload.hint': '打开 Finder 选择文件，上传到 DeepSeek 网页端（图片、PDF、Word、Excel、PPT、txt 等）',
  'composer.upload.busy': '上传中…',
  'composer.hint.focus': '聚焦',
  'composer.hint.stop': '停止',

  'toggle.deepThink': '深度思考',
  'toggle.search': '智能搜索',
  'toggle.deepThink.hint': '让网页端先做一轮推理再回答（DeepSeek 的 R1 深度思考模式）。开启后回复更慢，但复杂问题更稳。',
  'toggle.search.hint': '智能搜索：让网页端自己判断是否需要检索互联网，并在回答里附上参考来源。关闭时只用模型自身的知识回答。',
  'composer.preparing': '正在新建对话…',

  'msg.you': '你',
  'msg.model': 'DeepSeek',
  'msg.model.think': 'DeepSeek · 深度思考',
  'msg.copy': '复制回复',
  'msg.think.collapse': '点击收起思考过程',
  'msg.details': '详情',
  'msg.code.language': '文本',
  'msg.copyThinking': '复制思考过程',
  'msg.regenerate': '重新生成',
  'msg.edit': '编辑重发',
  'msg.quote': '引用到输入框',
  'msg.retry': '重试',
  'msg.sources.count': '参考来源（{count}）',
  'msg.thought': '已思考',
  'msg.thought.running': '思考中…',
  'msg.thought.prefix': '思考中：',
  'msg.thought.seconds': '已思考（用时 {seconds} 秒）',
  'msg.thought.minutes': '已思考（用时 {minutes} 分 {seconds} 秒）',

  'phase.idle': '就绪',
  'phase.busy': '处理中',
  'phase.elapsed': '已用时 {time}',
  'phase.chars': '本轮已输出 {count} 字',
  'phase.loggedIn': '网页会话 已登录',
  'phase.notLoggedIn': '网页会话 未登录',
  'phase.turns': '本会话 {count} 条消息',
  'phase.replyPartial': '回复可能不完整',

  'transfer.title': '在 Harness 中继续',
  'transfer.sub': '把这段网页对话带进一个 harness 会话',
  'transfer.mode': '迁移方式',
  'transfer.mode.distill': '蒸馏成任务简报',
  'transfer.mode.raw': '原文完整迁移',
  'transfer.mode.distill.hint': '压缩成可执行简报：目标、约束、已完成、待办',
  'transfer.mode.raw.hint': '完整保留逐字记录，作为上下文附在首条消息',
  'transfer.target': '目标',
  'transfer.target.new': '新建会话',
  'transfer.target.continue': '追加到已有会话',
  'transfer.continueTo': '继续到',
  'transfer.continue.empty': '没有可追加的会话：已打开或运行中的会话不能追加，其日志由自己的会话持有',
  'transfer.workspace': '工作区',
  'transfer.ungrouped': '未分组',
  'transfer.workspace.new': '新建工作区',
  'transfer.note.new': '迁移后自动打开新会话',
  'transfer.note.continue': '追加为已有会话的新消息',
  'transfer.step.distill': '蒸馏对话为任务简报',
  'transfer.step.session': '创建 harness 会话',
  'transfer.step.open': '打开会话',
  'transfer.preview': '首条消息预览（可编辑）',
  'transfer.preview.distilled': '已蒸馏为任务简报，下面是即将写入的完整内容',
  'transfer.preview.raw': '蒸馏不可用，本次为原文完整迁移，下面是即将写入的完整内容',
  'transfer.preview.chars': '{count} 字',
  'transfer.preview.edited': '· 已手动修改',
  'transfer.preview.building': '生成预览中…',
  'transfer.preview.rebuild': '重新生成预览',
  'transfer.preview.note': '确认后才会创建会话',
  'transfer.confirm': '确认写入',

  'toast.copied': '已复制',
  'toast.send.failed': '发送失败：{error}',
  'toast.wake.failed': '启动网页端失败：{error}',
  'toast.send.needLogin': '还没有登录 DeepSeek 网页端：在弹出的窗口里完成登录后，消息就能发出去了（内容已保留）。',
  'toast.send.queued': '已排队：上一条回复结束后自动发送',
  'toast.thinkingCopied': '已复制思考过程',
  'toast.codeCopied': '已复制代码块',
  'toast.attach.failed': '添加文件失败：{error}',
  'toast.attach.tooBig': '「{name}」超过 {limit}，没有添加',
  'toast.attach.tooMany': '一次最多添加 {limit} 个文件，多余的没有添加',
  'toast.rename.done': '已重命名',
  'toast.rename.failed': '重命名失败：{error}',
  'toast.delete.done': '已删除「{title}」',
  'toast.delete.failed': '删除失败：{error}',
  'toast.undo': '撤销',
  'toast.restored': '已恢复',
  'toast.clear.done': '已清空全部对话',
  'toast.clear.failed': '清空失败：{error}',
  'toast.export.done': '已导出到 {file}',
  'toast.export.failed': '导出失败：{error}',
  'toast.transfer.done': '已创建会话并打开',
  'toast.transfer.continued': '已追加到会话',
  'toast.transfer.failed': '迁移失败：{error}',
  'toast.transfer.duplicate': '这份简报已经在目标会话里，没有重复追加',
  'toast.transfer.fallback': '已创建会话：蒸馏不可用，写入的是原文完整记录（不是任务简报）',
  'toast.transfer.retry': '重试',
  'toast.recover.empty': '网页端没有未同步的会话',
  'toast.recover.progress': '正在同步 {done}/{total}：{title}',
  'toast.recover.summary': '已从网页同步 {count}/{total} 个会话，共 {messages} 条消息',
  'toast.recover.added': '新增 {count} 条',
  'toast.recover.completed': '补全 {count} 条',
  'toast.recover.replaced': '更新 {count} 条',
  'toast.recover.kept': '本地保留 {count} 条',
  'toast.sync.done': '已同步「{title}」',
  'toast.sync.uptodate': '「{title}」本地已是最新',
  'toast.recover.failed': '部分会话同步失败：{list}',
  'toast.open': '打开',
  'toast.open.failed': '会话已创建，但本页还没收到它——请在左侧会话列表中点开',
  'toast.workspace.created': '已创建工作区「{title}」',
  'toast.workspace.failed': '创建工作区失败：{error}',

  'attach.name.unnamed': '未命名文件',
  'attach.name.pasted': '粘贴的文件',

  'send.newChat': '新对话创建失败',
  'send.toggle': '切换开关失败',
  'send.openLogin': '打开登录窗口失败',
  'send.recover': '同步失败',
  'send.recoverList': '读取网页端会话列表失败',
  'send.unknown': '未知错误',
  'send.join': '；',

  'error.NEED_LOGIN': '需要先完成 DeepSeek 网页登录',
  'error.PAGE_CHANGED': '网页端页面结构疑似改版，请升级插件',
  'error.TIMEOUT': '生成超时，可重试',
  'error.NETWORK': '网络或浏览器错误，请检查后重试',
  'error.BUSY': '上一条回复还在生成，请等它结束或点「停止」后再试',
  'error.LOOPBACK': '面板没有连上本机插件服务（请求不是从本机发出的）',
  'error.METHOD': '请求方式不对：属插件内部错误，请刷新面板后重试',
  'error.ORIGIN': '请求来源不被信任，已被拒绝（跨站请求）',
  'error.CSRF': '安全令牌已失效，请刷新面板后重试',
  'error.PATH': '这个路径不在插件允许的目录内（附件目录或配置的导出目录）',
  'error.BAD_REQUEST': '请求缺少必要字段或格式不对',
  'error.TOO_LARGE': '数据太大，超出上限',
  'error.NOT_FOUND': '找不到对应的记录（可能已被删除）',
  'error.INTERNAL': '插件内部错误，详情见「运行状态」里的诊断',
}

/** English dictionary, checked complete against the zh key set. */
export const en: DSchatDict = {
  'nav.label': 'Chat',
  'panel.title': 'Chat',
  'panel.crashed': 'The panel failed to render. The rest of the page is unaffected; reloading recovers it. If it keeps happening, please report the details below.',
  'settings.title': 'DSchat',
  'settings.description': 'DeepSeek web chat and harness handoff settings',
  'settings.status': 'Status',
  'settings.phase': 'Engine',
  'settings.login': 'Web sign-in',
  'settings.login.yes': 'Signed in',
  'settings.login.no': 'Signed out',
  'settings.login.unknown': 'Unknown',
  'settings.page': 'Current page',
  'settings.lastError': 'Last error',
  'settings.runtime': 'Runtime',
  'settings.build': 'Build',
  'settings.version': 'Version',
  'settings.built': 'Built at',
  'settings.unknown': 'unknown',
  'settings.channel': 'Browser channel',
  'settings.headless': 'Headless while chatting',
  'settings.proxy': 'Proxy',
  'settings.timeout': 'Reply timeout',
  'settings.executable': 'Browser executable',
  'settings.dataDir': 'Data directory',
  'settings.profileDir': 'Browser profile (sign-in)',
  'settings.exportDir': 'Markdown export folder',
  'settings.distill': 'Distill on hand-off',
  'settings.distillModel': 'Distillation model',
  'settings.announce': 'Note these tools in the system prompt',
  'settings.actions': 'Actions',
  'settings.where': 'These values come from the profile\'s cordis.patch.yml: add a config: block under the dsh-dschat row, then restart Harness. This build ships no settings form of its own. The browser profile defaults to the dsh-webchat one, so switching plugins needs no second sign-in.',
  'settings.loading': 'Reading runtime settings…',
  'settings.auto': 'auto',
  'settings.direct': 'direct',

  'status.title': 'Runtime status',
  'status.description': 'Live state of the DeepSeek web engine plus the resolved runtime settings (read-only).',
  'status.where': 'These values come from the profile\'s cordis.patch.yml: add a config: block under the dsh-dschat row, then restart Harness. This build ships no settings form of its own. The browser profile defaults to the dsh-webchat one, so switching plugins needs no second sign-in.',
  'status.diag.copy': 'Copy diagnostics',
  'status.diag.copied': 'Copied — paste it into the issue as it is',
  'status.diag.failed': 'Copy failed (clipboard unavailable): the diagnostics were logged to the console instead',
  'status.stopped': 'Not started',
  'status.launching': 'Starting browser',
  'status.needLogin': 'Not signed in',
  'status.ready': 'Ready',
  'status.thinking': 'Thinking',
  'status.streaming': 'Streaming',
  'status.error': 'Engine error',

  'action.openLogin': 'Open login window',
  'action.closeBrowser': 'Close browser',
  'action.newChat': 'New chat',
  'action.newChat.hint': 'New chat (⌘⇧O)',
  'action.sessions': 'Chats',
  'action.recover': 'Sync from web',
  'action.recover.hint': 'Sync web conversations into the local store: new ones are pulled in, existing ones only gain what they were missing (local message ids, timestamps and thinking time are kept)',
  'action.stop': 'Stop',
  'action.send': 'Send',
  'action.startTransfer': 'Start transfer',
  'action.exportFile': 'Export markdown',

  'brand.title': 'DeepSeek Chat',
  'lamp.green': 'Running normally',
  'lamp.red': 'Failed',
  'lamp.grey': 'Not started',
  'lamp.amber': 'Starting or signed out',

  'composer.actions': 'Conversation and transfer actions',
  'more.hint': 'More: runtime status / export markdown / login window / close browser',
  'attach.show': 'View attachment',
  'attach.remove': 'Remove attachment',
  'attach.remove.hint': 'Remove attachment {name}',
  'transfer.short': 'Migrate to DSH',
  'transfer.short.hint': 'Continue in Harness: distill this web conversation into a brief, or migrate it verbatim into a harness session',

  'rail.search': 'Search conversations…',
  'rail.search.hint': 'Search conversation text (⌘K)',
  'rail.search.clear': 'Clear search',
  'rail.show': 'Open the conversation list',
  'rail.hide': 'Close the conversation list',
  'rail.empty': 'No conversations yet — start one with the New chat button above the input',
  'rail.noMatch': 'No matching conversation',
  'rail.clear': 'Clear all',
  'rail.clearConfirm': 'Clear all?',

  'qnav.label': 'Question navigator',
  'qnav.title': 'Questions · {count}',
  'qnav.item': 'Question {index}: {text}',
  'qnav.attachment': '(attachment)',
  'qnav.latest': '↓ Latest',
  'qnav.latest.hint': 'Jump to the newest message',

  'item.rename': 'Rename',
  'item.rename.placeholder': 'Conversation title',
  'item.delete': 'Delete (undoable)',
  'item.sync': 'Sync this one from the web (adds only what is missing)',
  'item.rename.ok': 'Confirm rename',
  'item.rename.cancel': 'Cancel',

  'chats.count': '{count} messages',
  'time.justNow': 'just now',
  'time.minutes': '{count}m ago',
  'time.hours': '{count}h ago',
  'time.days': '{count}d ago',
  'settings.yes': 'yes',
  'settings.no': 'no',

  'engine.notice.title': 'The web engine is not ready',
  'engine.notice.error.title': 'The web engine reported an error',
  'engine.notice.offline.title': 'The web page is not running',
  'engine.notice.offline.body': 'Sending a message starts chat.deepseek.com in the background first, reusing the signed-in browser profile. It usually takes a few seconds.',
  'engine.notice.login.title': 'Not signed in to DeepSeek web',
  'engine.notice.login.body': 'The sign-in window reuses the saved browser profile, so this is needed only once.',
  'engine.notice.retry': 'Retry starting the web engine',
  'engine.notice.retrying': 'Starting…',
  'engine.notice.unreachable': 'The local engine did not answer the start request (/wake), so the message was not sent. Check your connection and retry.',
  'engine.notice.staleHost': 'The host half is an older build (/wake answered 404); the login window was opened instead. Restart Harness and automatic start will work.',
  'engine.notice.needLogin': 'DeepSeek web needs a sign-in: finish it in the browser window that just opened — this notice disappears on its own once you are in.',
  'engine.notice.queued': 'Queued messages cannot go out while the web engine is down. They stay in the queue and leave automatically once it starts.',

  'empty.title': 'Chat with DeepSeek, right here',
  'empty.body': 'Your web sign-in, not API billing. Distill the chat into a task brief when you are done.',
  'empty.try': 'Or try',
  'empty.try.translate': 'Translate this English into natural Chinese',
  'empty.try.summarize': 'Summarize what this document is about',
  'empty.try.polish': 'Polish this passage of text',

  'thread.loading': 'Loading this conversation…',

  'composer.placeholder': 'Message DeepSeek — Enter to send',
  'composer.notLoggedIn': 'Sends once you sign in · typing now is fine',
  'composer.offline': 'Just type — it opens in the background',
  'composer.connecting': 'Opening · type ahead',
  'composer.attach.drop': 'Drop to attach',
  'composer.queue.note': 'The previous reply is still generating; these go out one by one when it ends',
  'composer.queue.files': '{count} file(s)',
  'composer.queue.cancel': 'Remove this queued message',
  'composer.upload': 'Upload file',
  'composer.upload.hint': 'Open Finder and upload a file to the DeepSeek web page (images, PDF, Word, Excel, PPT, txt …)',
  'composer.upload.busy': 'Uploading…',
  'composer.hint.focus': 'focus',
  'composer.hint.stop': 'stop',

  'toggle.deepThink': 'Deep think',
  'toggle.search': 'Smart search',
  'toggle.deepThink.hint': 'Have the web model run a reasoning pass before answering (DeepSeek R1 deep-think mode). Slower, but steadier on hard questions.',
  'toggle.search.hint': 'Smart search: let the web model decide whether to search the internet and cite its sources. Off, it answers from its own knowledge only.',
  'composer.preparing': 'Starting a new conversation…',

  'msg.you': 'You',
  'msg.model': 'DeepSeek',
  'msg.model.think': 'DeepSeek · deep think',
  'msg.copy': 'Copy reply',
  'msg.think.collapse': 'Click to collapse the reasoning',
  'msg.details': 'details',
  'msg.code.language': 'text',
  'msg.copyThinking': 'Copy thinking process',
  'msg.regenerate': 'Regenerate',
  'msg.edit': 'Edit and resend',
  'msg.quote': 'Quote into composer',
  'msg.retry': 'Retry',
  'msg.sources.count': 'Sources ({count})',
  'msg.thought': 'Thought',
  'msg.thought.running': 'Thinking…',
  'msg.thought.prefix': 'Thinking: ',
  'msg.thought.seconds': 'Thought for {seconds}s',
  'msg.thought.minutes': 'Thought for {minutes}m {seconds}s',

  'phase.idle': 'Ready',
  'phase.busy': 'Working',
  'phase.elapsed': 'elapsed {time}',
  'phase.chars': '{count} characters this turn',
  'phase.loggedIn': 'Web session signed in',
  'phase.notLoggedIn': 'Web session signed out',
  'phase.turns': '{count} messages in this chat',
  'phase.replyPartial': 'Reply may be incomplete',

  'transfer.title': 'Continue in Harness',
  'transfer.sub': 'Carry this web conversation into a harness session',
  'transfer.mode': 'Hand-off',
  'transfer.mode.distill': 'Distill to brief',
  'transfer.mode.raw': 'Replay transcript',
  'transfer.mode.distill.hint': 'Condenses into goal, constraints, done, and next steps',
  'transfer.mode.raw.hint': 'Keeps every message verbatim as context',
  'transfer.target': 'Target',
  'transfer.target.new': 'New session',
  'transfer.target.continue': 'Existing session',
  'transfer.continueTo': 'Continue into',
  'transfer.continue.empty': 'No session can receive an append: an open or running session holds its own log',
  'transfer.workspace': 'Workspace',
  'transfer.ungrouped': 'Ungrouped',
  'transfer.workspace.new': 'New workspace',
  'transfer.note.new': 'Opens the new session when done',
  'transfer.note.continue': 'Appends as a new message in that session',
  'transfer.step.distill': 'Distilling the conversation',
  'transfer.step.session': 'Creating the harness session',
  'transfer.step.open': 'Opening the session',
  'transfer.preview': 'First message preview (editable)',
  'transfer.preview.distilled': 'Distilled into a task brief — this is exactly what will be written',
  'transfer.preview.raw': 'Distillation was unavailable, so this is the raw conversation — exactly what will be written',
  'transfer.preview.chars': '{count} characters',
  'transfer.preview.edited': '· edited',
  'transfer.preview.building': 'Building preview…',
  'transfer.preview.rebuild': 'Rebuild preview',
  'transfer.preview.note': 'The session is created only after you confirm',
  'transfer.confirm': 'Write it',

  'toast.copied': 'Copied',
  'toast.send.failed': 'Could not send: {error}',
  'toast.wake.failed': 'Could not start the web engine: {error}',
  'toast.send.needLogin': 'Not signed in to DeepSeek web yet: finish signing in in the window that just opened and the message can go out (your text is kept).',
  'toast.send.queued': 'Queued: it goes out as soon as the current reply finishes',
  'toast.thinkingCopied': 'Thinking process copied',
  'toast.codeCopied': 'Code copied',
  'toast.attach.failed': 'Could not attach the file: {error}',
  'toast.attach.tooBig': '"{name}" is over {limit} and was not added',
  'toast.attach.tooMany': 'At most {limit} files at a time; the extras were not added',
  'toast.rename.done': 'Renamed',
  'toast.rename.failed': 'Rename failed: {error}',
  'toast.delete.done': 'Deleted "{title}"',
  'toast.delete.failed': 'Delete failed: {error}',
  'toast.undo': 'Undo',
  'toast.restored': 'Restored',
  'toast.clear.done': 'Cleared all conversations',
  'toast.clear.failed': 'Clear failed: {error}',
  'toast.export.done': 'Exported to {file}',
  'toast.export.failed': 'Export failed: {error}',
  'toast.transfer.done': 'Session created and opened',
  'toast.transfer.continued': 'Appended to the session',
  'toast.transfer.failed': 'Transfer failed: {error}',
  'toast.transfer.duplicate': 'That brief is already in the target session; nothing was appended',
  'toast.transfer.fallback': 'Session created, but distillation was unavailable: the raw conversation was written instead of a brief',
  'toast.transfer.retry': 'Retry',
  'toast.recover.empty': 'No unsynced web conversations',
  'toast.recover.progress': 'Syncing {done}/{total}: {title}',
  'toast.recover.summary': 'Synced {count}/{total} conversations ({messages} messages)',
  'toast.recover.added': '{count} new',
  'toast.recover.completed': '{count} completed',
  'toast.recover.replaced': '{count} updated',
  'toast.recover.kept': '{count} kept locally',
  'toast.sync.done': 'Synced “{title}”',
  'toast.sync.uptodate': '“{title}” is already up to date',
  'toast.recover.failed': 'Some conversations could not be synced: {list}',
  'toast.open': 'Open',
  'toast.open.failed': 'The session was created, but this page has not received it yet — open it from the session list',
  'toast.workspace.created': 'Workspace "{title}" created',
  'toast.workspace.failed': 'Could not create workspace: {error}',

  'attach.name.unnamed': 'unnamed file',
  'attach.name.pasted': 'pasted file',

  'send.newChat': 'Could not start a new chat',
  'send.toggle': 'Could not flip that switch',
  'send.openLogin': 'Could not open the login window',
  'send.recover': 'Sync failed',
  'send.recoverList': 'Could not read the web conversation list',
  'send.unknown': 'unknown error',
  'send.join': '; ',

  'error.NEED_LOGIN': 'Sign in to DeepSeek web first',
  'error.PAGE_CHANGED': 'The web page structure changed — upgrade this plugin',
  'error.TIMEOUT': 'Generation timed out — try again',
  'error.NETWORK': 'Network or browser error — check and retry',
  'error.BUSY': 'The previous reply is still generating — wait for it or press Stop',
  'error.LOOPBACK': 'The panel could not reach the local plugin service: the request did not come from this machine',
  'error.METHOD': 'Wrong request method — an internal plugin error; reload the panel and retry',
  'error.ORIGIN': 'The request came from an untrusted origin and was refused',
  'error.CSRF': 'The security token expired — reload the panel and retry',
  'error.PATH': 'That path is outside the directories this plugin may write to',
  'error.BAD_REQUEST': 'The request was missing a required field or was malformed',
  'error.TOO_LARGE': 'The data was larger than the allowed limit',
  'error.NOT_FOUND': 'No such record — it may have been deleted',
  'error.INTERNAL': 'Internal plugin error — open the diagnostics in the status card for the detail',
}
