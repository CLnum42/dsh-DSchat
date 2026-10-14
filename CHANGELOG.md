# Changelog

All notable changes to dsh-DSchat are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Versioning note: `0.5.1` and `0.6.0` are the first two releases cut from a
committed tree — everything before them shipped as `0.4.2` and earlier.

`0.8.0` was installed on one machine through a `link:` install only: it was never
committed and never published on its own. Its contents ship with `0.8.1`, and its
section below is kept as written on the day it was built.

## [0.12.0] — 2026-10-14

三条装机后的反馈：发出提问后视图的走法、导出 markdown 要能选路径并记住、以及接力（原「DSH 迁移」）按钮
的文字与图标。第一条反馈在装机后又追了一轮（「第二条 prompt 没有跳到最顶端」），那一轮改的是同一个功能的
另一面，写在「借来的底部空间」里。

### Changed

- **提问置顶（anchor）现在对「新会话的第一条」也生效。** 之前只有「在已有会话里继续问」才会把提问顶到
  视图最上面；一条会话如果还不存在（全新装机、清空之后、或 host 因为这次发送才建会话），面板会先切到那个
  新会话 —— 而切换分支会把「这一发还没落地、请把它顶到最上面」的标记一起清掉，于是视图退回「跟随最新」，
  每个 token 都把视图往下拽：这既是「提问没到顶端」，也是「答案还在生成、视图自己一直滚」的同一个原因。
  现在这个标记带上它所属的会话（`pendingAnchorChatRef`，由发送的返回值盖章），于是能分清两种切换：
  **这次发送自己造成的切换**（保留标记，接着就取锚点）与**读者中途点开了别的会话**（标记作废、丢弃）。
  同时 `anchorFloorRef` 在切换时归零 —— 上一个会话的提问条数对刚打开的这个没有任何意义，带过去会让新会话
  的第一条对不上账（1 条新行 vs 门槛 4）。
- **借来的底部空间：提问到不了顶端时，先向底部借一屏，答案长进来再还回去。** 这是装机后那一轮反馈的真正
  原因，也是「一问一答之后，第二条 prompt 只是接在下面」的根子：锚点其实**取到了也应用了**，但滚动位置在
  `scrollHeight - clientHeight` 处被夹住 —— 提问下面只有两段回答，不够一屏，浏览器只能把提问停在离顶边
  190px 的地方；随后每个 token 让内容长高，`max` 跟着长，视图也就一路跟着答案滚下去。
  现在滚动区末尾多了一个高度由面板**命令式**写入的空块（`.dsh-dschat-thread-spacer`，见 `spacerRef` /
  `spacerFor`）：它恰好等于「提问顶边到视图底边还差多少」，于是 `scrollHeight` 恒等于
  `clientHeight + 提问的 contentTop`，提问稳稳落在顶边；答案每长高一点，它就缩掉同样多 —— `scrollHeight`
  不变，`scrollTop` 也就不变，视图**一帧都不动**；答案长满一屏后它归零，回答继续在折叠线以下增长。
  写过 CSS 的人会想到 `min-height: 100%`：那只能救「整段对话比一屏还短」的情况，这里救不了。
  空间与锚点是**两条命**：`clearAnchor()` 只交还控制权，空间留给每个 tick 的规则决定（`roomRowRef`）——
  只要读者还停在这块借来的空间里（撤掉它会夹住读者刚做的那次滚动），就继续按原来那一行重新量、继续缩；
  等读者滚回内容里（他的位置不再依赖这块空间），立刻归还，且不会跳。
- **置顶是瞬间的，而且真的在最顶端。** `ANCHOR_TOP_GAP` 从 12px 改成 0：定位目标就是「提问那一行的上边缘
  贴在滚动区顶边」，它下面整块都是这一轮的回答。发送路径本来就走 `behavior: 'auto'`（瞬移，不做平滑滚动），
  并且每次流式 tick 只重算同一个位置，所以答案长多高视图都不动 —— 读者读完当前这一屏，自己往下滚。
- **滚动区上的任何一次手势都立刻把视口交还给读者。** 原先只在位置偏移超过 32px 容差时才认定「是读者在滚」，
  于是 20px 这种小幅拖动会被下一个 token 拉回去。现在 `onWheel` / `onTouchStart` 一响就撤销锚点（这两个
  事件我们自己的 `scrollTo` 都不会触发，所以不会误伤）：读者哪怕只挪一个像素，也是他赢了，直到他自己按
  「↓ 最新」、点导航条、或者再发一条。
- **「是读者在滚吗」现在有两个信号，并且是在重新置顶之前问的。** 位置对不上一个信号不够：滚动事件按帧合并、
  只报最后的位置，读者的一次拖动如果和面板自己那次 `scrollTo` 落在同一帧，处理器看到的就是「还在我们放
  的地方」，于是这次拖动被无声地撤销；反过来，导航栏出现导致正文列变窄、整段重排时，浏览器的滚动锚定会
  把 `scrollTop` 调整同样的距离，那又会被误判成读者滚了 200px。现在这一判断（`readerMovedViewport`）同时
  比较**视口位置**（`list.scrollTop` vs 我们上次落点）与**提问行自身的位置**（`contentTop` 是否跟着动）：
  只有「位置动了、行没动」才是读者，而且这一步放在锚点分支里、重排之前问 —— 抢在移动之前问，就没有竞态。
- **导出 markdown 可以在对话框里选路径，并且记住。** 「导出到」一行在问答列表上方：输入框里是 host 解析
  出的绝对路径，右边「选择文件夹」走系统目录选择窗口；选过或改过之后，**后面的导出默认就是它**，直到读者
  再改一次。选择记在 host 侧（`TranscriptStore` 的 `prefs.exportDir`，跟着 `transcripts.json` 原子落盘），
  所以重启、刷新、换窗口都还在。解析顺序变成：**读者选过的目录 > 配置里的 `exportDir` > `$DSH_EXPORT_DIR`
  > `~/Downloads`**（配置项是「部署给的默认值」，读者在对话框里说的是「最后一次明确答复」，后者优先）。
  新路由 `POST /api/dsh-dschat/export-dir` 记住这个选择并回传解析后的路径，`/export` 的既有围栏**跟着
  一起移动**：现在只允许写进「读者选的那个目录」之内，旧目录反过来被挡在外面。
- **「DSH 迁移」改名「接力」，并去掉右边的展开/收起箭头。** 「迁移」说的是机制（插件把对话搬进 harness
  会话），按钮要的是结果（交出去，后面由谁接着做）；英文从 `Migrate to DSH` 改成 `Hand off`。右侧那个
  caret 是给**行内折叠**用的标记，而它开的是一个向上弹出的菜单 —— 它让按钮看起来有展开/收起两种状态，
  实际并没有；`aria-expanded` 和菜单本身已经把这件事说清楚了。左边的 `SwapIcon`（两个交错的箭头）保留。

### Fixed

- **「发出去了却看不到自己刚问的那句」在全新会话里不再出现**：见上面第一条。
- **「第二条 prompt 没有跳到最顶端、只是接在下面」不再出现**：见上面「借来的底部空间」。这条是装机后第二轮
  反馈，测试用的是**面板打开时就已经在屏幕上的会话**（前面三次问答先摆好，再发第四条）—— 之前的用例都是
  「第一条发送顺便把会话建出来」，所以它们全绿，真机却不行。
- **导出的失败不再含糊**：路径建不出来时，对话框不关闭、也不写文件，toast 报出真实原因；如果 host 半还是
  旧版本（面板刷新即更新，host 只在重启时更新），报的是「需要重启 Harness」而不是一个 404。
- **「回答还没生成完，操作栏就已经挂在那儿了」不再出现**：复制 · 重新生成 · 喜欢 · 不喜欢 · 分享（以及
  「复制思考过程」「引用到输入框」）现在等这条回答**停下来**才出现，流式期间整排不渲染 —— 半句话上的
  「复制」、网页端还没有这一轮的「分享」、以及一个只能显示「正在生成，稍后再试」的「重新生成」，本来就不该
  点得到。判断用的是**这条消息自己的 `streaming`**，不是面板级的 `busy`/`streaming`：后者在整个一轮生成期间
  都是真，拿它做门槛会连旧回答的操作栏一起收走。整排是**不渲染**而非 CSS 藏起来 —— 藏起来的按钮照样能被
  Tab 聚焦、照样会被读屏念出来。手动「停止」和失败留下的部分回答都写入 `streaming: false`，所以按停的那一
  瞬间按钮就回来（部分回答是有内容的，它已经不再变化了）。

### Verified

- **六条浏览器用例**（`test/scroll-follow.test.ts`，真 Chrome + 真面板 + 桩 API）：
  - 面板不认识的会话（发送创建它）里，第一条提问落在视口顶部（修前量到 **-146px**，已在视口上方；修后
    ≤ 4px）；
  - **已经在屏幕上的会话里**，第四条提问落在视口顶部：修前量到 **194px**（正是读者截图里的样子 —— 锚点取到
    了、被 `scrollHeight - clientHeight` 夹住），修后 ≤ 4px；并且借来的空间**恰好**等于缺口（用例里按同一
    公式复算），随答案增长单调缩小，20 段之后归零；
  - 答案从 12 段长到 40 段、56 段… 的过程中 `scrollTop` 逐次相等（视图一动不动），提问始终在首行；
  - 读者手动向上滚 200px 之后，后续 token 一次都没有把视图拽回去；
  - **只滚 20px**（在原先 32px 漂移容差之内）也一样：wheel 事件一响锚点就让位，视图停在读者放下的地方。
    这条用例做过反向验证 —— 把 `onWheel`/`onTouchStart` 去掉，它立刻失败；
  - 读者停在借来的空间里滚动时**不跳**（空间不许被撤掉），等他滚回内容里再归还，位置一分不动；把
    `spacerFor` 改成恒返回 0 做反向验证，上面那条 194px 的用例立刻失败。
- **导出路径**：`test/export-path.test.ts`（真浏览器）量到对话框打开时输入框就是 host 给的目录、点「选择
  文件夹」只发一次 `setExportDir`、点导出发出的参数是 `exportFile(chatId, null, ids)`（不带 cwd，由 host
  决定落点）；`test/export-dir.test.ts` 覆盖解析优先级、空值/非法值、以及「重启后还记得」；`host-smoke`
  新增一条路由用例，量到选过之后 `/context` 报新目录、文件真的落在那里、旧目录已被围栏挡住。
- **按钮**：`scripts/ui-shot.mjs` 的 action row 读数从 `["会话列表","新对话","DSH 迁移","导出"]` 变为
  `["会话列表","新对话","接力","导出"]`，`caretFlipped` 为 `null`（按钮上已无 caret）；导出的选择器新增
  一张 `01f-export-picker` 截图，「导出到」输入框与按钮都在卡片内。
- **回答还没生成完就没有操作栏**：`test/answer-arrival.test.ts`（真 Chrome + 真面板 + 桩 API）量到**流式中的
  那条**回答 `querySelector('.dsh-dschat-msg-acts')` 为 `null`（一个按钮都没有），**同一屏里已答完的那条**
  仍然有整排控件且顺序不变，只是「重新生成」带着「正在生成回复，等这一轮结束再重新生成」被置灰 —— 这一条
  正是「拿 `busy` 当门槛」会踩的坑（那会把旧回答的整排也收走）；随后把这一轮结束掉（host 写
  `streaming: false` 的那一次 tail），**同一条消息**立刻长出完整一排、没有一个是置灰的。反向验证：把面板那行
  改成 `arriving: false`，第一条用例立刻失败（量到 6 个按钮）。
- **同一件事的静态渲染**：`test/client-render.test.ts` 新增两条 —— 流式中的消息 `renderToStaticMarkup` 出来是
  **空字符串**（不是「一排藏起来的按钮」：藏起来的按钮照样能被 Tab 聚焦、照样会被读屏念出来），回答停下后同一
  份 props 渲染出完整的七个控件；另一条钉住面板传的是 `message.streaming` 而不是 `busy`（反向验证：把它改成
  `busy`，这条立刻失败）。
- **`scripts/ui-shot.mjs`** 的读数新增 `rowsByMessage`（每条消息有没有操作栏），`--synthetic` 渲染里流式样例
  `d-a3` 的 `hasRow` 为 **false**、其余四条为 true；改前同一次渲染是五条全 true（`.tmp-ui-arrival-before/`
  与 `.tmp-ui-arrival/` 的 `report.json`、`09-live-thinking.png` 各一份，后者另存了一张上下对照图）。
- 全量 `node --test test/*.test.ts`：**234 条、233 通过、1 失败** —— 失败的是 `test/new-chat-body.test.ts` 的
  浏览器用例（等 `.dsh-dschat-empty` 的 15s 超时，全量跑时是「a stored conversation does not render as a
  brand-new one while its body loads」、单独跑时是「a conversation created while /state is in flight still
  loads its body」，哪一条随负荷变化）。**与本变更无关**：把面板那行改回 `arriving: false`（等于旧行为）单独
  跑这个文件，同一条用例一样超时；`test/scroll-anchor.test.ts` 也在两次全量跑里各抖过一次、单独跑通过。本次
  改动自己的四条用例（两条静态渲染 + 两条浏览器）全绿，`tsc --noEmit` 干净。

## [0.11.0] — 2026-10-14

三条装机后的反馈：分享要能**挑问答**（像官网那样），导出 markdown 要挪到对话下面那排按钮的最后并且也
能挑问答，思考区的展开/收起要更像样。

### Changed

- **「分享」变成网页端那个选择模式，不再是「一条问答」。** 0.10 的分享是单条的：点分享 → 确认 → 发布这一组。
  可网页端的分享本来就是选择模式（`enterSelection(sessionId, [messageId])`，bar 上写「已选择 N 组对话」，
  可以继续勾、可以全选），0.10 的实现只是把它的第一步省掉了。现在面板是同一个模型：
  - 点「分享」打开**问答选择器**（一个居中卡片，正文仍是官方那句公开警告）。**默认只勾中你点的那一组** ——
    这正是网页端 `enterSelection(sessionId, [messageId])` 的行为；可以继续勾别的组，也可以「全选」。
  - **问答是绑定的**：一组 = 一个提问 + 它的回答，点任何一半都是整组开关，没有「只选了问题」这种状态。
  - 引擎按网页端自己的路子走：先点第一条的「分享」进选择模式，再逐条点网页端给每条消息**注入的勾选框**
    （`pressCheckbox` 走完整的 pointer/mouse 序列，React 的 onClick 与监听 pointerdown 的控件都能收到，
    且只触发一次 click），最后「创建分享链接 → 创建并复制」。
  - **数量守卫：创建之前先对账。** 网页端 bar 上的「已选择 N 组对话」必须等于面板选的组数，不一致就按「取消」
    退出、**什么都不发**。分享是发布公开链接，宁可不发也不能发错一组。为此新增三条失败文案
    （`selection:a/b`、`checkbox:*`、`not-found:N`），并且都明确写了「没有创建链接」。
  - 页面里不再有「这条回答的分享」这种一次性入口：`shareMessage` 保留为 `shareMessages([id])` 的薄封装。
- **「导出 markdown」搬到对话下面那排按钮的最后**，标签「导出」，图标是「下载」（箭头落入托盘，新增
  `DownloadIcon`）。顶部 `···` 菜单里那一条**已经删掉** —— 同一个动作用两个入口正是这次要消灭的重复。
- **导出也能选问答。** 点「导出」打开的是同一个选择器，**默认全选**；取消某一组时问题和回答一起取消。
  路由与渲染层跟着改：`/export` 接 `messageIds`，`exportTranscriptFile` 只渲染所选消息（顺序按对话本身，
  不按请求顺序），只导一部分时文件名带 `-选中N条`，不会覆盖整篇导出的那份。
- **思考区的展开/收起做成 200ms 的折叠动画。** 原来是两个面直接互换，现在是两行 grid 轨道
  （`grid-template-rows: 1fr 0fr` ⇄ `0fr 1fr`）在动，配一个四态机（closed/opening/open/closing）：
  动画在跑的时候两面都在 DOM 里，落定之后藏起来的那面立刻卸载 —— 一条长对话里每条消息的推理都常驻
  DOM 会让面板每次渲染都解析整段思考。收起仍然只有 340px 高（超出可滚），行高、留白、字形颜色、hover
  与 live 呼吸边框一起调了；`prefers-reduced-motion` 下三处动画全部关掉，状态照旧。

### Fixed

- **折叠态落定成 0 高。** 两行 grid 的隐式排布有个坑：展开落定后摘要行已经不渲染了，正文成了 grid 的
  第一个子元素，于是被放进 `0fr` 那一行 —— 动画过程中看着正常，落定后思考内容整段消失（渲染检查量到
  `grid-template-rows: 0px 0px`）。改成显式 `grid-row: 1` / `grid-row: 2`，布局与「当前挂着哪几个面」无关。

### Verified

- **离线渲染检查**（`node scripts/ui-shot.mjs .tmp-ui-qa --synthetic`，真 Chrome + 真面板 + 桩 API）：
  - 分享：点回答下的「分享」→ 出现选择器，标题/官方警告/按钮齐全，**share 调用数为 0**；默认勾中 1 组、
    两半 `aria-checked` 一致（绑定）、「全选」为未选中；再点第二组的**回答**那一行 → 该组两半一起变选中、
    「全选」自动变选中、计数变「已选择 2 组对话」；确认后真正发出去的参数是
    `["chat-ui-demo", ["d-a1","d-a2"]]` —— **一组只发一个回答 id**（网页端自己会补上提问，
    `MESSAGES_MUST_APPEAR_IN_PAIRS` 是服务端强制的），toast「已创建公开链接，链接已复制」。
  - 导出：`···` 菜单里只剩「运行状态 / 关闭浏览器」（没有导出）；按钮在那排按钮的**最后**（会话列表 ·
    新对话 · DSH 迁移 · 导出），打开的选择器**默认全选**（5 行全勾、计数 2 组），确认后发出的参数带上了
    所选消息 id，toast 是「已导出到 /Users/demo/Downloads/dschat-demo-ab12cd.md」。
  - 思考区：collapsed 40px / `grid-template-rows: 38.08px 0px` / phase=closed / 只有摘要行；点击后
    **70ms 时**读到 phase=opening、`26.63px 39.09px`（动画确实在中途）；260ms 后 phase=open、摘要行已卸载、
    `0px 65.72px`；再点正文 → closing → 回到 closed。收起过程中被动画带着的两个面 `tabindex=-1` +
    `aria-hidden`，只有当前那一面可聚焦。
- **真机验证（这是会对外发布的功能，所以真的创建了一条链接，随后删除）：**
  `.tmp-probe-share/verify-multi-select.mjs` 跑的是**真正的 `DeepSeekWebEngine.shareMessages`**（不是复制品），
  用**两份回答**（两组问答）在真实网页端创建链接：返回
  `{"ok":true,"url":"https://chat.deepseek.com/share/<id>","created":true}`，说明数量守卫读到的
  「已选择 2 组对话」与面板选的 2 组一致、注入勾选框的点击确实生效；随后用网页端自己的
  `POST /api/v0/share/delete` 删除（分享列表 2 → 1，不再包含该 id），并用一个没有 cookie 的浏览器打开该链接，
  页面显示「你访问的链接已失效」。退出后选择模式已收起（`创建分享链接` 不在页面上）。
  该账号分享列表里剩下的一条不是本次测试创建的，未做处理。
- 新增测试：`test/qa-picker.test.ts` 6 条（分组、预览行、绑定、导出取全部/分享只取一个回答、兜底文本）；
  `test/share.test.ts` 补三条新失败码；`test/client-render.test.ts` 补渲染断言（选择器两半同态、计数、
  分享模式不提供未完成的问答）与「导出在按钮排最后、`···` 里没有」的源码断言；`test/host-smoke.test.ts`
  补部分导出（只含所选、按对话顺序、文件名带 `-选中N条`）。全套 **215 条通过**。

### 注意

- **需要重启 DSH**：宿主半区变了（`/share` 改成收 `messageIds`、`/export` 新增该字段），宿主只在重启时换版本。
  重启前的新面板点「分享」会被旧宿主按「缺少字段」拒绝 —— 面板对这种情况会直接提示「宿主半区还没更新，
  重启 Harness 后可用」，不会静默失败。

## [0.10.0] — 2026-10-14

「分享」以前只是「复制」的加长版 —— 复制一段带标题和引用的 markdown。这一版把它做成**官方那个东西**：在网页端
创建一条**公开链接**。

### Added

- **分享 = 创建公开链接。** 网页端的「分享」不是复制：它是
  `POST /api/v0/share/create {chat_session_id, message_ids}`，产出的是
  `https://chat.deepseek.com/share/<id>` —— 官方自己的文案是
  `shareCreateLink: "Create public link"`，路由表也把 `/share/:shareId` 标成 `public`，
  也就是**任何拿到链接的人都能打开**（不需要登录）。
  实现按网页端自己的三步走：
  1. 定位这条回答（**按内容比对**，和点赞/点踩同一套走法：网页端是虚拟列表，按序号点会有评错/分享错的风险）；
  2. 点这条回答的「分享」（第 6 个控件）→ 网页端进入**选择模式**（它会把这条回答连同上面的提问作为一组选中）；
  3. 点「创建分享链接」→ 网页端弹确认框（正文就是它的公开警告）→ 点「**创建并复制**」→ 链接被创建并复制。
  链接地址从**响应体里的 `share_id`** 读（最可靠，官方自己就是这么拼 URL 的），弹窗里的链接字段是第二来源。
- **面板先行确认。** 点「分享」不再直接发布，而是弹一个确认层，正文就是网页端那句警告的等价文案
  （「任何拿到链接的人都能查看这段对话（无需登录）……可以随时在网页端「设置 → 数据管理」里删除」）。
  这一步不是客套：网页端自己也为同一件事加了确认框，而插件是在**后台无头浏览器**里操作，读者看不到那个框。
- **失败的三种结局分得清。** 尤其是「创建并复制」是**点了就提交**（网页端在请求飞行中会禁用 Esc/点遮罩取消）：
  - 还没发布就失败 → 说清楚哪一步，并给一个「改为复制文本」的兜底动作（文本摘录仍然可用，只是不再是「分享」的含义）；
  - 已经点了创建但没读到链接 → **明说链接可能已经创建**，并指路「设置 → 数据管理」去删除（不这么说，读者会
    在不知情的情况下留下一条公开链接）；
  - 随便哪种失败，选择模式都会被收掉 —— 它一开着，网页端每条消息的操作栏都点不动。

### Changed

- `answerMatchExpectation`（内容比对）从「点赞」升为共用：分享与评价走**同一套定位**，两条路径不会各自漂移。
- 行内弹层的槽位从「反馈专用」改成通用的 `overlay`，两个表单（反馈 / 分享）共用同一套定位、同一套按钮样式
  （`.dsh-dschat-pop-actions`），并且仍然只挂在它所属那一行下面。

### Verified

- **真机验证（这是唯一会对外发布东西的功能，所以真的创建了一条链接，然后删掉）：**
  - `DeepSeekWebEngine.shareMessage` 对着真实网页端跑通：返回
    `{"ok":true,"url":"https://chat.deepseek.com/share/<id>","created":true}`；
  - 清理：用网页端自己的 `POST /api/v0/share/delete`（它需要应用自己的 bearer token，仅 cookie 会答
    `Missing Token`）删除，随后 `/api/v0/share/list` 从 1 条变 0 条，**并用一个没有 cookie 的浏览器打开该链接，
    页面显示「你访问的链接已失效」**。测试前该账号分享列表为空，测试后也为空。
  - 验证脚本：`.tmp-probe-share/verify-engine.mjs`（跑的是真正的引擎方法，不是复制品）、
    `delete-share.mjs`（删除并证明链接失效）。
- 新增测试 4 条（`test/share.test.ts`）：`shareUrlFrom` 用页面 origin 拼链接、`answerMatchExpectation` 只比答案
  且拒绝猜（短答案整串比、长答案取 24 字前缀、仍在思考的回复没有可比内容）、以及两套失败句子 —— 其中一条专门
  断言**非发布型失败都不许声称链接已创建**。全套 **207 条通过**。
- 离线渲染检查新增分享确认层的探针：点「分享」后表单出现且 `share` 调用数为 **0**（没发布），正文含官方警告，
  点「创建链接」后调用一次、表单关闭、toast 为「已创建公开链接，链接已复制」。

### 注意

- **需要重启 DSH**：新路由 `/api/dsh-dschat/share` 在宿主半区，宿主只在重启时换版本。
- 网页端对每个会话创建链接有上限（`TOO_MANY_SHARES_FOR_THIS_SESSION`），并且**分享是按「提问 + 回答」成对**
  的（`MESSAGES_MUST_APPEAR_IN_PAIRS`）—— 所以一次分享出去的是一组对话，不是一个孤立的回答。

## [0.9.1] — 2026-10-14

0.9.0 装机后逐条看的反馈：反馈弹窗的提交按钮不对、用户气泡的按钮位置与回答不一致、回答下面那排按钮要理一理、
分享图标要跟官方一致。四条都在这一版。

### Fixed

- **反馈弹窗的「提交」被切掉了一半。** 根因不是宽度，是**层叠**：那排按钮的控件规则写的是后代选择器
  `.dsh-dschat-msg-acts button`（0-1-1），而反馈面板正是那排按钮的子元素 —— 于是它的 `取消` / `提交` 也被
  当成 28×28 的图标按钮，文字被裁到只剩「提交」（渲染检查里量到两个按钮都是 28px 宽）。改成子选择器
  `>` 后，那排按钮的几何只作用于它**自己**的控件；同时把原因药丸与说明框上为了压过这条规则而加的
  `.dsh-dschat-feedback` 前缀全部去掉 —— 它们本来就不该需要。
- **提交按钮的文案与位置。** 标签从「提交评价」改成「**提交**」（与网页端那个弹窗一致），两个按钮统一
  30px 高、`0 14px` 内边距，右对齐在面板自己的 12px 内边距里（实测按钮右沿距面板边界 13px）。
- **用户气泡的复制 / 重新编辑搬到了气泡下面。** 以前它悬停在气泡**左侧**，和回答那排（在下方）是两套位置；
  现在两种角色的行都是「内容 → 它的操作」，位置由消息自己的对齐方式决定（用户右对齐、回答左对齐）。
  顺带删掉了只为给那排当定位块而存在的 `.dsh-dschat-msg-line` 包装层，气泡的 78% 宽度上限移到气泡自己身上。
- **分享图标换成网页端那一个。** 从探针在真实页面上抄下来的 16 格路径**原样**使用（一个向右的分享箭头，
  `fill=currentColor`，与 `ClipIcon` / `DeepThinkIcon` / `WebSearchIcon` 同样的「从官方页面取图」做法）。
  之前那个「一个点连两个叶子」的自绘图形，正是读者说「跟官方不一样」的那个。

### Changed

- **回答下面那排按钮理了分组。** 逐个核对过：七个控件作用的对象各不相同（回答 / 网页端这一轮 / 账号上的
  评价 / 整段问答 / 思考过程 / 输入框），**没有真正重复的**，所以一个都没有删 —— 缺的是「哪几个是网页端的、
  哪几个是本插件的」这层信息。现在在官方那五个（复制 · 重新生成 · 喜欢 · 不喜欢 · 分享）之后加一条 1px
  竖线，本插件自己的两个（复制思考过程 · 引用到输入框）排在它后面；竖线是 `aria-hidden` 的列表项，
  不是控件，不参与键盘与读屏。

### Verified

- 离线渲染检查新增：两排按钮的归属与位置（`belowBody` 均为 2px，即都在内容下方）、分组竖线的实测几何
  （1×14px）、反馈面板的按钮几何（`取消` 58×30、`提交` 58×30，右沿在面板内边距之内）、以及新增的
  `01d-rows` 一图（用户行与回答行并排）。同时修好了这个脚本自己的一个坑：为截图创建的整窗克隆层
  （`z-index: 9999`）没有拆除，挡住了后续所有点击 —— 表现为「思考过程」那一步点不动、以及反馈面板在截图里
  凭空消失。
- 更新了两条会因此失败的测试：浮动表层那条现在断言**两排都不是浮动表层**（都是 `position: relative` 的流内
  行，且不画背景/边框/阴影），按钮顺序那条把分组竖线算进去。全套 **203 条通过**。

## [0.9.0] — 2026-10-14

三件事：点开侧栏的「聊天」就应该把网页端带起来、每条回答下面要有官方那一排按钮、以及评测一次要真的落到
网页端账号上。

### Added

- **打开面板即启动网页端。** 侧栏那个「聊天」按钮是这个插件的正门，可之前点了它只会打开一个**没有引擎**的
  面板：网页端要靠输入框里的一次点击/按键/发送才启动，失败时面板上那句「重试启动」就是唯一入口。现在面板
  挂载后（拿到第一份快照、确认引擎还没起来）自动唤醒一次，不再要求读者先点一次输入框。
  去重与克制都在代码里写明了：一次挂载只试一次（`autoStartedRef`）、两次自动启动之间隔 30 s
  （`AUTO_START_INTERVAL_MS`，所以来回切面板不会变成反复拉起浏览器，也不会把读者刚在「···」里关掉的浏览器
  再打开）、失败不重试（提示与按钮已经在屏幕上）、显式的「重试启动」不受这 30 s 限制。
- **每条回答下面的一排按钮，按官方网页端的样子排。** 顺序与位置对齐 chat.deepseek.com：
  **复制 · 重新生成 · 喜欢 · 不喜欢 · 分享**，第 0/2/3/5 位与网页端一一对应（第 4 位「朗读」本插件不做 ——
  面板没有音频出口，一个按下去不出声的按钮比没有按钮更糟）。位置也从「悬停在消息右上角」改成
  **答案正下方、常驻可见**，和网页端一致；读者自己的气泡仍保留悬停行。
  这排按钮的**顺序就是与网页端的协议**：网页端的按钮没有可匹配的标签（只有「朗读」有 `aria-label`），引擎
  只能按序号点，所以顺序不是审美问题。这条约束写在 `answer-actions.tsx` 里，并有测试钉住。
- **重新生成**（`/api/dsh-dschat/regenerate`）：把这条回答对应的**问题**重新发给网页端，并在网页端接下这一轮
  之后删掉被替换的那条回答 —— 问题复用不重发（否则转录里会出现同一个问题两遍），删除只在网页端确认接下
  之后（提交没送到就删，等于把一次失败的点击变成数据丢失）。忙时按钮禁用，原因写在 tooltip 里。
- **点赞 / 点踩**（`/api/dsh-dschat/feedback`）：评价是**网页端账号上的状态**，所以现场按网页端那条回答自己的
  按钮。定位靠**内容**而不是序号：网页端是虚拟列表，本地说到底也可能和网页端不同（在别处删过、旧历史没收
  进来），点错一条是读者看不见也撤不回的。找不到就什么都不点并说明原因。
  网页端的「不喜欢」不是请求，而是弹出一个**反馈弹窗**（四个必选原因 + 可填说明 + 取消/提交），只点按钮什么
  都不会提交，所以本插件先弹出自己的原因面板（有害不安全 / 虚假信息 / 没有帮助 / 其他 + 一句可选说明），
  再让宿主把原因与说明填进网页端那个弹窗并提交。评价结果按本次会话回显在按钮上（网页端不暴露已选状态）。
  首次点击要滚动定位，所以会慢一点（最长 45 s 预算），并且有「不是六个按钮就取消」这样的防点错检查。
- **分享**：把这段问答复制成 markdown（标题 + 引用的提问 + 回答），不生成公开链接 —— 网页端的分享是它自己的
  选择模式 + 创建分享链接流程，引擎驱动它会在页面上留下一条挡着所有操作栏的选择栏。

### Fixed

- **剪贴板失败不再谎报成功。** `copyText` 以前在 `catch` 里也弹「已复制」：权限被拒、文档失焦、非安全上下文
  下剪贴板其实没写进去，读者贴出来的是上一次的内容。现在两条路都试（`navigator.clipboard` → 
  `document.execCommand`），都失败就说失败并告诉读者怎么办。
- **「点踩」图标位置。** 原来用 `rotate(180 8 8)` 把点赞图形转过来，而图形画在 16 格的上半边，于是整个图形
  下移了 16px，在那一排里明显偏低（渲染检查里看出来的）。改为真正的镜像（`translate(0 16) scale(1 -1)`）。
- **反馈面板的定位。** 反馈面板是回答那排按钮的子元素、向上展开，而那排按钮原来是 `static`：面板于是相对
  **整条消息**（`.dsh-dschat-msg{position:relative}`）算偏移，实测 `rect.top = -421`（那一排按钮在 144），
  整个面板跑到面板外面去了。现在回答那排按钮自己就是定位上下文。同一条规则修好了原因药丸的样式：它们落在
  `.dsh-dschat-msg-acts button`（0-1-1）的作用范围内，没有先前的背景/边框/内边距，四个词挤成一行。

### Verified

- 离线渲染检查（`node scripts/ui-shot.mjs --synthetic`，真实组件 + 真实 Chrome + harness 主题表）新增三项探针：
  每排按钮的可访问名与顺序、反馈面板的内容（四个原因、说明框、取消/提交）、以及「Escape 关闭」。实测：
  回答那排为 `复制回复 · 重新生成 · 喜欢 · 不喜欢 · 分享 · 复制思考过程 · 引用到输入框`，`data-mod="answer"`
  且行顶在答案正文之下 2px；反馈面板与那一排按钮左对齐（偏移 0）、向上展开、在屏幕内，Escape 关闭有效。
- 新增测试 4 条：按钮顺序与可访问名（`answer-actions` 的纯函数）、`shareText` 的形状、`deleteMessage` 的
  边界（只删指定的那条、删掉流式行会清 `streaming`）、以及「回答那排按钮是自身弹层的定位上下文」这条 CSS
  断言。全套 **203 条通过**。

### Not verified (needs a Harness restart)

- 两个新路由（`/regenerate`、`/feedback`）只活在**宿主**进程里，而宿主只在 DSH 重启时换模块代：
  安装后必须重启 DSH，`/regenerate` 与真实网页端的点赞/点踩才可用。面板一半（按钮、面板布局、分享、复制）
  刷新页面即可生效。

## [0.8.1] — 2026-10-12

0.8.0 装机后回报的三件事：列表顺序不对、同步没带置顶、以及要验证发消息后是否记下网页 session id。

### Fixed

- **列表顺序不是「最近使用在上」。** `importTranscript` 每导入一条就 `unshift`，而批量同步是按网页端顺序
  （新→旧）走的，于是整批**倒过来**：账号里最旧的会话排在最上面。实测 504 条已导入记录里 **494 条**的顺序
  与网页端相反。现在 `TranscriptStore.list()` 真的按顺序返回（不是「碰巧」）：**置顶在前（最近钉的在前），
  其余按会话自己的时间从新到旧**，时间相同的保持数组顺序（`createChat` / `importTranscript` 都是前插，
  所以等于「新建的在前」，`Array.prototype.sort` 的稳定性就是这条的保证）。
- **同步进来（以及 0.8.0 之前同步过）的会话，时间全是「同步那一刻」。** 批量同步给每条都盖上同一个
  `Date.now()`，会话的 `updatedAt` 因此是同步运行的时钟，列表既没法按它排序，`· X 前` 也全是「刚刚」。
  现在导入用网页端自己的 `chat_session.updated_at` / `inserted_at`（历史接口里就有，epoch 秒），新建记录
  用它当 `createdAt` / `updatedAt`，已存在的记录也按网页端时间校正。
- **「从网页同步」不同步置顶状态。** 0.8.0 只在**新建**本地记录时继承网页端的 `pinned`，而读者在浏览器里
  钉住的那两条早就导入过了 —— `missing` 里没有它们，同步永远不会再看它们一眼（实测本机 0 条置顶、网页端
  2 条）。现在同步分两步：
  1. `/api/dsh-dschat/sync-pins`：只读一次会话列表，把**整账号**的 `pinned` 与实时时间写回**已存在**的本地
     记录（不读任何会话内容，几百条一次搞定）；`pinned` 是双向镜像 —— 网页上钉了就钉上，网页上没钉就取消。
  2. 原来的增量导入，逐条补没收过的会话。
  取消置顶后会同步回来的行为是**故意**的：置顶状态在网页账号上，这一步是镜像它。
- **`/recover` 的 `pinned` 现在是有无都有效的布尔值**：`false` 是「网页端没有钉」这条指令，不是「缺失」；
  只有整个字段缺席才表示「调用方不知道」，此时不动本地排列。
- **0.8.0 写的「重复会话会被合并」其实到不了。** 那条修复挂在「同步某条会话」上，而 0.8.0 之前就已经导入过
  的会话永远不会再被同步一次（`missing` 不含它），所以读者那 59 对重复记录一条都没少。现在
  `sync-pins` 那一步顺带做**纯本地**的去重：两条记录按**逐条消息**比对（同一角色、同一条消息，一侧是另一侧
  的前缀），恰好一个候选才合并 —— 保留读者自己那条（他的 id、标题、本地时间），删掉同步生成的那条，并
  汇报 `folded`。
  - 这里**没有**沿用 `mergeHistory`：它是给「网页副本并入本地」用的，两边文本不同时取**传入方**，用在两个
    本地副本上会把幸存者那一侧的长文本换成短的那份。实测（在读者真实的 574 条库上跑）第一版确实把消息
    改短了；现在用的是专门的 `unionPrefixCopies`：**不动幸存者自己的文本**，只有另一侧是同一消息的更长版本
    （即幸存者那份被截断）时才补全。
  - 实测结果：574 行 → 556 行（合并 18 对），**幸存者的消息 0 条被改写、0 条丢失**，没有重复 id/重复会话。
    剩下 8 条「只在被删副本里出现过」的文本是同一条回复的**另一种思考渲染**（面板版列的是「浏览 N 个页面」，
    网页版列的是「搜索到 N 个网页」），同一条回复的另一种呈现，随被删副本一起消失 —— 这一条如实写在这里，
    因为它不是零成本的。
  - 合并只会发生在**手动点同步**时，且候选不唯一就什么都不做（合并无法从界面撤销）。

### Verified

- **发消息后写入网页 session id（`stampWebSessionId`）已真机验证**：新建对话 → 发一条消息 → 本地记录立刻
  带上 `webSessionId=53d7abdd-…`，与引擎页面 URL `/a/chat/s/53d7abdd-…` 一致；随后对同一会话做一次同步，
  `created:false`、记录总数不变 —— 合并回同一条，没有第二条。
- 新增测试：列表顺序（含批量导入不倒序）、`applyWebListState` 双向镜像与去重幂等、已存在记录的时间校正、
  `/sync-pins` 路由、重复会话的合并与其「证据不特定就不合并」的拒绝分支。页内回调不变式那条测试也修好了
  误报：它把**注释里**提到的宿主名字当成了引用，现在扫描前会剥掉注释与字符串字面量。
- **在没有改动的真实数据上预演过 0.8.1**：把读者真实的 `transcripts.json` 拷一份，用**线上**取到的会话列表
  跑 `foldDuplicateConversations` + `applyWebListState` —— 置顶 0 → 2（正是网页端钉住的那两条）、504 条
  记录的时间被校正、导入块的顺序与网页端一致（503 匹配 / 0 逆序，改前是 9 / 494）。

## [0.8.0] — 2026-10-12

「从网页同步」不再对着网页端的侧栏 DOM 读会话，也不再让同一条对话在本地出现两次；导出 markdown 只留
用户的问题与 DeepSeek 的回答；会话列表新增置顶。

### Added

- **置顶（会话列表）**。每条会话右侧多了一个图钉：钉住的会话排到列表最上面，单独一组「置顶」，跟网页端
  侧栏同一套逻辑。`pinned` / `pinnedAt` 存进本地会话记录（可选字段，老文件照读），`pinnedAt` 用来在置顶
  组内按「最近钉的在前」排序。钉住**不**改 `updatedAt` —— 排列不是活动，否则取消置顶后那条会话会赖在最近
  列表顶上，像刚刚用过一样。钉住的行在指针不悬停时也显示图钉（动作列平时是 hover-only），否则一条置顶
  会话看上去和普通行没区别。
- **同步时继承网页端的置顶状态**，但只在**新建**本地记录时继承一次：之后在面板里取消置顶，不会被下次同步
  改回去。
- `/api/dsh-dschat/pin` 路由（`{ chatId, pinned }`），`/state` 的会话摘要带上 `pinned` / `pinnedAt`。

### Fixed

- **同步会话时同一条对话会在本地出现两条。** 面板里聊出来的会话从来没有网页 session id，而同步只能按标题
  找 —— 面板用的标题是用户的第一句提问，网页端用的是自动生成的摘要，两者永远不相等，于是同步**又写了一条**。
  实测本机 203 条已同步会话里有 59 条存在这样的双胞胎（标题、消息数各不相同）。两处修复：
  - 面板发出的一轮被网页接受后，引擎立刻从页面 URL 读出 `/a/chat/s/<id>` 记到该会话上
    （`stampWebSessionId`）—— 之后同步按 id 命中同一条记录并合并。
  - `TranscriptStore` 增加按「用户问过什么」的同一性判断（`looksLikeSameConversation`：首问必须一致，本地
    的每一问都要在网页副本里按序出现）。没有 id 也没有同名标题时用它认领那条老记录；如果 id 命中的记录和
    这条老记录同时存在，就把两者合并成一条 —— **保留用户自己那条**（他的标题、他的 id），删掉同步生成的那条，
    消息取并集后由网页副本补齐，并回报 `merged: 1`。
- **同步读的是渲染出来的侧栏，只能看到第一屏。** 侧栏是无限滚动：实测一次加载后 DOM 里有 100 行，滚到底
  会涨到 595 行。现在改读网页端自己的会话列表接口
  `GET /api/v0/chat_session/fetch_page`，带 `lte_cursor.pinned=false&lte_cursor.updated_at=<秒>` 翻页，
  **整账号都在**，而且拿得到 DOM 里没有的两样东西：账号自己的 `pinned` 标记、以及真实的 `updated_at`
  （侧栏的「今天 / 昨天」分组就是按它分的）。带 `x-client-*` 请求头不是可选项 —— 实测少了它们，服务端
  忽略游标、每次都回第一页，翻页等于没翻。接口没答上来时仍回退到原来的 DOM 读法。
- **同步回来的消息时间全是「同步那一刻」。** `scrapedToMessages` 给每条消息都写 `Date.now()`，于是一段
  20 轮的对话在本地是同 1 毫秒写下的，会话的 `updatedAt` 也成了同步运行的时钟。现在用网页端的
  `inserted_at`（epoch 秒，转成毫秒）；只有 DOM 抓取没有时间可用，那时仍退回当前时间，但按消息递增，
  至少保证单调。
- **限流被当成「接口没有内容」。** 网页端对连续的历史读取会回 `code 40029 TOO_MANY_REQUESTS`（HTTP 200
  带错误体）。实测 203 条连着读，大约第 100 条开始被限流；旧代码把它当作「端点没答」，于是转去打开每一个
  会话再抓 DOM —— 一次被拒绝的读取要花掉几分钟导航。现在它是一种独立结果（`rateLimited`），`/recover`
  回 429，批量同步收到就停下并如实报告「这次同步了 N/M 条，等一两分钟再点一次」。

### Changed

- **导出 markdown 只导出用户的问题与 DeepSeek 的回答。** 它以前是唯一保留 `[citation:N]` 标记、`参考来源`
  脚注与 R1 思考块的渲染路径（理由是「文件是给人看的，人能点开来源」）。现在它和迁移路径一样：
  `参考来源` 脚注、正文里的引用标记、思考块里的搜索/浏览记录、思考块本身都不再出现。
  `renderMessagesMarkdown(messages, { sources: true })` 作为渲染原语仍然可用，只是插件里已经没有任何调用方。
- 同步读会话列表时不再依赖侧栏是否滚到过那一条；`WebChatSummary` 增加 `pinned` / `updatedAt`。
  （`fetch_page` 的一行只有 `id / title / title_type / pinned / model_type / updated_at` 六个字段，
  所以会话的创建时间并不在这个接口里，没有取。）

## [0.7.0] — 2026-10-11

会话列表不再是左侧常驻栏，而是在「会话列表」按钮上方弹出的浮层；输入框从一行高到三行高。
浮层的宽度、锚定与关闭方式都跟「⇄ DSH 迁移」那一套对齐，同一行上的两个控件因此是同一个形状。
本版同时带上原本写给 `0.6.4` 的调色板与示例问题改动——它从未单独发布过，所以内容保留在
下一节，编号并入本版。

### Changed

- **会话列表变成贴着按钮向上弹出的浮层。** 它原来是 238px 的左侧常驻栏，只要面板开着就一直
  占着对话区的宽度（实测：620px 的面板里对话区只剩 382px）。现在它是弹出层：宽 348px
  （与「DSH 迁移」同宽）、**左沿与按钮对齐**（默认的右对齐会让它从按钮右沿向左伸出 220px 到
  面板外，实测被窗口裁掉、最后几行点不到）、并从标题栏下沿一直铺到按钮上方 8px 处。
- **浮层高度按实测距离铺满。** 面板量出「按钮顶部 → 标题栏下方那一列（`.dsh-dschat-body`）
  顶部」的距离，减去 8px（样式表里 `bottom: calc(100% + 8px)` 已经占掉的按钮间距），写成
  wrapper 上的 `--dschat-list-avail` / `--dschat-list-h`，浮层用它当高度。每次打开都重测，
  面板尺寸变化时用 `ResizeObserver` 重测——队列、附件条、阶段行都会把这一行顶来顶去。
  实测三档：560px 面板 → 288px 高（顶在 y=52）；780 → 508px（y=52）；1000 → 640px 封顶
  （y=140）。`popTop == headerBottom` 恒成立，贴着标题栏但不越界。
- **输入框 `min-height` 46px → 84px**（1.3 行 → 3 行）。46px 是 12px 上内边距 + 1 行 22.4px +
  4px 下内边距，第二行的下沿会被滚动条切掉——写一段话等于隔着一条缝写。三行是能看见句子开头
  的最小行数，卡片整高 96px → 134px。上限随之 180px → 220px，否则加了地板会丢掉上面的生长区间。
- **触发按钮回到输入框上方那一行**，图标由「面板+竖线」换成三条横线。旧图标画的是一个侧栏，
  所以它承诺了侧栏，而点下去弹出来的东西浮在对话上——图标画错了屏幕的另一半。
- **关闭方式补齐**：`Esc`、再点一次按钮、**点浮层外部任意位置**（`pointerdown`，按下即关）、
  选中一行后关闭。最后一条是这次新加的：选中对话后浮层不关（侧栏版本从来不需要关，所以旧代码
  里根本没有这一行）。
- `rail.show` / `rail.hide` 文案改为「打开/关闭会话列表」；存储键 `dsh-dschat.rail.open` 的名字
  **保留**，老读者的偏好不会丢。

### Removed

- **拖拽调宽会话列表的全部机制**：拖拽句柄、方向键、宽度钳制、`dsh-dschat.rail.width` 存储键、
  `data-rail-drag` 标记。浮层没有可存的宽度。

### Fixed

- **选中对话后浮层不关**（见上）。
- **浮层高度算短了一段**：最初只减了 10px（8px 按钮间距 + 2px 余量），其中那 2px 是把已经算过的
  间距又算一遍，白白吃掉一截列表，还让浮层顶入侵标题栏 4px（实测 `popTop - headerBottom = -4`）。
- **`min()` 嵌套写成无效 CSS**：`min(min(a, b), 640px)` 会被浏览器整条丢弃、高度静默退回 `auto`。
  改成单层 `min()`。
- **`styles.ts` 面板顶部注释里那个孤零零的反引号**：它会提前终止 `PANEL_CSS` 模板字符串，症状是
  几百行之后某条无辜规则报解析错。文件顶部已写明这条规矩，现在文件里正好两个反引号。

### Note

- `0.6.3` / `0.6.4` 没有 tag：这两版的 tag 从未打过，而 `0.6.2` 的 tag 仍指向发布前的 HEAD。
  本版把 tag 补到 `v0.7.0`。

## [0.6.4] — 2026-10-11

The palette is now the DeepSeek web app's own, read out of its stylesheet
instead of approximated from the harness's copy of the same design system, and
the new-session page's three example questions are ones the page can actually be
asked. Nothing functional changes.

### Changed

- **One blue, and it is chat.deepseek.com's.** The panel painted
  `--dschat-accent` from `--dsw-static-deepseek-500/400`, and the harness ships
  that ramp with two steps repainted: its 500 is `#4176e6` and its 400
  `#7aaaff`, where the web app paints `#3964fe` and `#679efe` at the same two
  names — so the deeper of the two blues the last pass collapsed into one was
  still the wrong blue. Read out of the web app's own sheet
  (`fe-static.deepseek.com/chat/static/main.*.css`, the `body` and
  `body[data-ds-dark-theme]` token blocks), the panel's palette is now: accent
  `#3964fe` light / `#5686fe` dark — the web's `brand-primary`, the colour of
  its send disc — with white ink on it in BOTH themes (its
  `label-primary-foreground`), and a lit-control triplet
  (`--dschat-tint` / `--dschat-tint-line` / `--dschat-on-accent-tint`) that is
  literally the web's 深度思考 pill: deepseek-50 on deepseek-300 in
  deepseek-500, deepseek-900 on deepseek-600 in deepseek-400.
- **The reader's own turn is the web's bubble** — `#edf3fe` in light,
  bluish-850 in dark, no hairline. It was a grey card with a border, which made
  it the one large neutral object in an otherwise blue palette; the light-theme
  pill labels were near-black navy (`#283142`) where the web uses the accent
  itself.
- **Hover and pressed are the web's washes** (`--dsw-alias-interactive-bg-*`): a
  blue-tinted alpha in light, a white one in dark, instead of opaque
  bluish-75/100 fills that greyed whatever surface they landed on.
- **The three example questions** are translation, summarisation and polishing
  now (「把英文翻译为通顺的中文」「总结这份文档的主要内容」「润色这段文字」, with
  matching English), and the locale keys were renamed to say what they hold
  (`empty.try.translate` / `.summarize` / `.polish`).
- The README screenshots were re-rendered against the new palette.

### Removed

- **The last `body[data-ds-dark-theme]` rule that was not a token override.**
  The disabled send disc needed its own dark branch only because its ink was
  near-black there; with white ink it dims correctly in both themes. One dark
  block and the menu hairline remain.

### Note

- Two guard tests were rewritten to the new contract rather than deleted: no
  rule in the sheet may read `--dsw-static-deepseek-*` at all (the harness's
  ramp is no longer a source of truth), and the primary button, the toolbar's
  pressed state and both pills must draw from the tint triplet.

## [0.6.3] — 2026-10-10

The panel gets one palette and a quieter first page. Nothing functional is added
or removed: every control, state and shortcut behaves exactly as before.

### Changed
- **One accent, one neutral ramp, four surfaces.** The panel used to spell the
  same "on / current / primary" state four different ways — the send circle in
  `state-business-primary`, a lit pill's border in `static-deepseek-600`, its
  label in `static-deepseek-400`, its fill in `static-deepseek-50` — while the
  empty page's mark used `brand-primary`, the one element that *inverted* with
  the theme (near-black in light, near-white in dark) instead of deepening with
  it. They are all `--dschat-accent` now, and every surface, hover, hairline and
  quiet label is cut from one `static-neutral-bluish-*` ramp; the cold navy
  mixes and the single warm grey are gone. In the light theme this also restores
  a ladder the panel never had: `bg-base`, `bg-layer-1`, `bg-layer-2` and
  `overlay` all resolve to `#fff`, so the transcript, the reasoning row, the
  sources row, the citation chips and the composer card were five white boxes on
  a white page. See the palette contract at the top of
  `src/client/panel/styles.ts`.
- **`styles.ts` is one sheet again.** The seven `body[data-ds-dark-theme]`
  branches that existed only because a hand-picked static needed re-stating are
  gone; two remain, both structural (the accent flips, and the ink that sits on
  it flips with it), plus the menu hairline.
- **The new-session page says less and invites more.** Title 「直接和 DeepSeek
  对话」, a 33-character body (was 47), and three example questions under
  「或者试试」 that write themselves into the composer — a click fills the field
  and focuses it, and never sends. The key reference stays, demoted below them.
- **Composer placeholder copy** no longer explains the transport: 「给 DeepSeek
  发消息，回车发送」, 「登录后即可发送 · 先输入也行」, 「直接输入，会自动在后台
  打开」, 「正在打开 · 可以先输入」 (zh and en).
- **The README screenshots** were re-rendered against the new palette.

### Fixed
- **The send arrow was never painted in the accent ink.** The sheet opens with
  `.dsh-dschat button { color: inherit }` at (0,1,1), which outranks a
  single-class `.dsh-dschat-send` — so the glyph inherited the panel's ink and
  was drawn near-black on a `#4176e6` disc (4.46:1, reported as 「与蓝色背景的
  反差不够，看起来有点暗淡」). The rule now names its element
  (`button.dsh-dschat-send`) and takes `--dschat-on-accent`, which is white in
  the light theme and near-black in the dark one — measured 4.4:1 and 15.6:1.
- **The disabled send button fades the disc, not the arrow.** `opacity: .4`
  dimmed the glyph together with the fill, which reads as a broken control
  rather than a waiting one. The disc is now mixed toward the card surface; the
  dark theme lifts it toward white instead, because dark ink on a *darkened*
  bright blue measures 1.1:1.

## [0.6.2] — 2026-10-10

A conformance pass against the official plugin contract: the repository's first
typecheck (which found real defects), the tool abort signal, the data-dir
resolution, and the manifest's dependency metadata. Restart the host to load it
(a `link:` install picks up new `lib/` only on a profile restart).

### Fixed
- **`dataDir`/`profileDir` resolved to a second `.dsh` whenever `DSH_HOME` was
  exported.** `DSH_HOME` already IS the harness home (`~/.dsh` by default; the
  machine-level config layer is `$DSH_HOME/cordis.patch.yml`), but the plugin
  appended `.dsh` again — `$DSH_HOME/.dsh/dsh-dschat`. On a host that exports the
  variable (the documented way to relocate the harness home, or to launch a
  headless profile) that split the transcript store in two and made the
  `dsh-webchat` browser profile invisible, which reads as a lost login. Both
  copies (`index.ts`, `store.ts`) now follow the official
  `@deepseek-ai/dsh-home-paths` `resolveDshHome` precedence, including its
  "a blank override is unset" rule. Regression test: `test/data-dir.test.ts`.
- **The six agent tools now honour `exec.signal`.** `dschat_send` could hold a
  call open for `replyTimeoutMs` (180 s by default) with no way to cancel it, and
  `dschat_transfer` distils a whole conversation through several sequential model
  calls. A cancel now performs the engine's own cooperative stop, so the partial
  reply is still reported (`stopped: true`) instead of an empty one, and the
  distillation path aborts between chunks and between calls.
- **The `session/title` event is written only where the deployment declares it.**
  The type belongs to `@deepseek-ai/dsh-session-title`, not to the core, and
  `SessionEventMap` members are required-on-read: on a deployment that does not
  mount that package, a transferred session carrying the event would refuse to
  open. The write is now gated on `ctx.get('sessionTitle')` — the service that
  owns the type and its projection.
- **`dsh.client.inject` named a package that does not exist**
  (`@deepseek-ai/dsh-client-runtime`). It now names the rows this plugin
  registers into: the renderer (which declares `ctx.slots`), the layout and
  sidebar packages (which DECLARE the `main` and `sidebar.panellist` slots), and
  the locale package.
- **The client half waited on a `layout` service it never read** — a hard
  dependency whose absence would have made the whole panel silently fail to
  mount. Removed from `inject`.
- **Config values are now validated, not just typed.** `browserChannel` and
  `browserProxy` were bare strings whose doc comments claimed an enum, and
  `replyTimeoutMs` accepted a negative number; a typo was therefore accepted at
  load time and surfaced minutes later as a failed browser launch. The schema now
  carries the constraints, so a bad value fails loud at startup.
- **The panel has its own crash fence.** A throwing render used to blank the
  `main` entry with nothing to distinguish "broken" from "nothing to show"; the
  panel is now wrapped in an error boundary that renders one localized sentence
  plus the error, keyed off the new `panel.crashed` locale string.
- Unbounded growth in the transfer preview cache: entries expired by TTL were
  never evicted, so an unconfirmed preview (a whole distilled brief) lived until
  the plugin unloaded. Expired entries are now pruned, with a hard cap.
- Stale or inaccurate comments: the file header listed five of the six tools, the
  guidance doc pointed at a function that no longer exists, and the stylesheet
  claimed every colour was a token.

### Added
- **`tsconfig.json` + `npm run typecheck`.** No command had ever run `tsc`, so
  several of the defects above (and the whole client half's slot typing) were
  invisible to the compiler while the code claimed types caught them. `src/`
  typechecks clean under `strict`; `test/` is validated by execution.
- `test/data-dir.test.ts` (3 cases) and a case pinning the `session/title` guard
  (no title event is written where the type is unknown).
- `peerDependencies`/`devDependencies` for every harness package the plugin
  imports, with the officially published compatibility range rather than `*`;
  `dsh.manifestVersion`; `@types/react`, `@types/react-dom`, `typescript`, the
  client type packages, and the slot-declaring packages that typechecking needs.

### Changed
- `engines.node` is `^22.19.0 || >=24.0.0` (the `test` script needs Node's type
  stripping; `>=22` promised support for versions where it fails).
- `files` lists `lib` instead of `lib/**/*.js`; `exports` also exposes `./icon`.
- `dsh.client.immediately` dropped: it forced a 304 KB browser bundle into the
  boot barrier for a panel the shell does not need in order to render.
- Removed the undocumented top-level `meta` field (display metadata comes from
  `locale/*.json`; the fallback order is `meta.title` → `package.json.name`).
- `apply` no longer hand-copies the schema defaults into a second table, and the
  dead teardown-and-re-register path (`sync`, called exactly once) is gone.
- Full-round radii in the panel stylesheet are now paired with
  `corner-shape: round`, as the harness radius standard requires.

## [0.6.1] — 2026-10-10

Three defects reported against 0.6.0, and one prompt-cost decision. The panel
fixes need a page refresh; the prompt change takes effect on restart (the host
half assembles the prompt).

### Changed
- **The plugin no longer writes 786 characters into every system prompt.**
  `announceToAgent` defaulted to true, so every session — and every subagent, and
  every session in unrelated workspaces — carried a prose catalogue of the six
  `dschat_*` tools. Measured against the schemas the model already receives
  (4,626 characters), that was +17% of pure duplication: the tool inventory is
  the tools' own descriptions, the trigger words («网页端», «deepseek web»,
  «转移到 harness») are each tool's `Triggers:` line, and the login requirement,
  the "no API billing" note and the transfer's preview-then-confirm semantics are
  all already in the description of the tool they belong to. The harness's own
  guidance is explicit — say each fact once, do not repeat the tool definition in
  a system-prompt section — and no other installed plugin announces itself:
  `dsh-better-sidebar` contributes context per action via `agent.inject()`, and
  the rest contribute none. Default is now `false`; the opt-in text is one line,
  derived from tool visibility (`ctx.tools.get('dschat_status', scope)` returning
  `''` for an agent that cannot see the tools, which the assembler drops
  entirely). The one fact no schema carried — that the sidebar 「Chat」 panel is
  this plugin — moved into `dschat_status`'s description, where it costs nothing
  extra and disappears with the tool.

### Fixed
- **A new conversation's first exchange showed the answer and not the question.**
  `/state` carries summaries and `/chat?id=` carries one conversation's body, so
  selecting a conversation is two requests in flight at once. `refreshState` is
  what INTRODUCES a conversation the panel has never seen (「新对话」, a recover,
  another window) and the body request is answered first routinely — measured on
  a 222-conversation store, `/chat` answers in ~0.8 ms against `/state`'s
  ~3 ms. Applying that body to a list that did not carry the chat yet was a
  silent `chats.map` no-op, so nothing marked the conversation loaded, and every
  later poll replaced its messages with `[]` again. Only the /tail feed could put
  anything in it, and the tail carries the ANSWER: the transcript showed a reply
  with no question above it. Bodies now go through a count-checked cache, so a
  body that arrives before its summary is applied the moment the summary lands,
  and a conversation with no authoritative body is fetched when it is the one on
  screen.
- **A conversation with history rendered as a brand-new one.** The same empty
  body made the transcript fall into the empty branch — which IS the
  new-conversation page — once per poll, between the answer and the blank state.
  That blink was the reported 「一闪一闪」 and the 「突然回到新对话」. A
  conversation whose body is still on its way now says so (「正在载入这段对话…」)
  instead of offering to start a conversation, and a body already on screen is
  never replaced by that placeholder.
- **Searching inside a conversation never worked.** `DSCHAT_API` carried the key
  `search` twice — once for `GET /search-conversations`, once for the web-search
  TOGGLE — and a later key silently wins in an object literal, so the constant
  resolved to the toggle: every message search was a GET against a write-guarded
  route, a 405 the filter swallowed. The keys are now `searchConversations` and
  `search`, and `route-surface.test.ts` fails when two endpoints share a name or
  when a constant points at a path the host does not register.

### Added
- `test/new-chat-body.test.ts` — the snapshot/body race, driven with the real
  ordering and a MutationObserver, so "the page blinks" is measured rather than
  sampled.
- `test/route-surface.test.ts` — the route table against the host's registered
  paths, plus a source-level duplicate-key check (a repeated key is gone by the
  time the object exists, which is why the type system never saw it).
- `test/prompt-footprint.test.ts` — the DEFAULT configuration contributes no
  prompt text; the opt-in is capped at 200 characters so the catalogue cannot
  creep back unnoticed; and it renders empty for an agent the tools are hidden
  from. `host-smoke`'s "one section by default" assertion became "none".

## [0.6.0] — 2026-10-10

The release the review called "the road to shippable": the data plane, the
failure surface and the scraper's fidelity. Nothing here adds a feature the
reader asks for; all of it removes a way to lose work or to be misled.

### Fixed
- **The DOM fallback no longer loses text.** The HTML parser recognised a
  self-closing tag only by a literal `/>`, which standard HTML never writes for
  `<br>`, `<img>`, `<hr>` or `<input>`: each became an OPEN tag that collected
  every following sibling, and the markdown converter then discarded those
  children. The root cause was larger than the report — the parser compared each
  close tag against a synthetic node whose `tagName` was always `undefined`, so
  **no close tag ever matched** and every element swallowed the rest of the
  fragment. On the DOM-fallback paths `<pre>`/`<code>` bodies are read from
  `textContent`, which parsed nodes do not carry, so one code block took the code
  AND everything after it. Fixed all of it: close-tag matching, the void-element
  set, value-less attributes (`checked` was stored as `undefined`, so every
  scraped checkbox rendered unchecked), a `rawText` fallback for `code`/`pre`/
  `math`, and the code-fence language (`attributes.class`, not just `className`).
- **The store can no longer lose a whole history to a power cut.** Writes are
  `tmp → fsync(file) → rename → fsync(directory)`; the temp name carries the pid
  so two writers cannot share one intermediate file, and a failed write removes
  its own.
- **Two harness instances can no longer overwrite each other.** A single-writer
  lock (`transcripts.json.lock`, holding a pid) is decided by LIVENESS — a lock
  left by a crash is taken over, one held by a live process makes this instance
  read-only, with the reason reported in the status card.
- **A file written by a newer version is refused rather than reduced.** The
  `version` field was written and never read: a future format would have been
  loaded as this one's, losing every unrecognised field and then overwriting the
  original.
- **A local page can no longer clear the history.** Every mutating route is
  POST-only and requires a same-origin `Origin`/`Sec-Fetch-Site` plus a per-run
  CSRF token; the loopback check is fail-closed (`remoteAddress === undefined` is
  no longer treated as local).
- **A file outside the plugin's directories can no longer be uploaded or
  written.** `/send` requires attachment paths inside `<dataDir>/attachments`,
  `/export` writes only inside the configured export directory, and `/restore`
  validates the message shape instead of persisting whatever it is handed.
- **Stopping actually stops.** The stop button no longer queues behind the turn
  it interrupts, a timeout stops the page instead of leaving it generating, and
  the submit check is bound to the turn it belongs to.
- **A sync no longer overwrites local-only turns.** An equal-length stretch is
  settled in place only when every USER message in it is recognisably the same
  message.
- English interfaces no longer print the host's Chinese error strings: every
  route failure carries a structured code the panel renders through its own
  dictionary.

### Changed
- **`/state` answers with summaries.** It used to ship every transcript —
  5.75 MiB on a 220-conversation store, polled every 1.5 s (~3.8 MiB/s). The
  bodies now travel on `GET /chat?id=`, and message search moved to the host
  (`GET /search-conversations?q=`) because a client-side scan only ever saw the
  conversations it happened to have fetched. Measured on the real store:
  **5.75 MiB → 48.1 KiB per poll (122×)**.
- **Hand-offs are previewed before they are written.** `/transfer-preview` builds
  the exact first message, the panel shows it and lets it be edited, and the
  confirmed bytes are what gets written. A hand-off that had to fall back to the
  raw log says so instead of reporting the same success as a distilled brief. The
  agent tool previews by default and writes on `confirm: true`.
- Transfers to the panel now resolve their destination before doing the expensive
  distillation, so a bad workspace or a live target session costs nothing.

### Added
- `dschat_stop` — the tool the BUSY hint had always named without it existing.
- **Copy diagnostics** in the status card: version, build time, phase, engine
  error, page URL, last error with its code, store warning, resolved paths and
  the live `probe-page` output, in one click. It reports whether the copy worked
  instead of claiming success regardless.
- The status card shows the **running bundle's version and build time** (injected
  at build time) — `package.json`, the git tag, the newest tarball and the linked
  working tree are four different answers, and this is the one that is always
  right.
- The offline, signed-out and engine-error states each name themselves in the
  conversation and offer their own action, instead of living only in a 7px lamp's
  tooltip.

### Tests
146 → 169 cases. The new ones are the interesting part: a real-Chrome
end-to-end test that scrapes a page whose reply contains `<br>`, an image, a code
block and checkboxes and asserts what lands in the transcript; a falsification
run of the parser suite (all 10 cases fail without the fix); durability tests
driven against a **copy** of the real 5.72 MiB store; and a locale test that
every structured code has a sentence in both dictionaries and that the English
one carries no CJK.

## [0.5.1] — 2026-10-10

### Fixed
- The five P0 defects from the review: the route family's trust fence (method,
  origin, CSRF, fail-closed loopback), path convergence for `/send` `/export`
  `/restore`, transfer previews with a visible distillation fallback, a stop that
  works while an agent's send holds the engine, and a sync that no longer
  overwrites local-only content.
- The README's installation section, which claimed `link:` could not work. The
  2026-10-01 startup failure was a missing `dsh.client.platform`, not a symlink —
  quoted from the crash log now, along with a "when Harness will not start"
  section.
- `NOTICE` and the client entry's comment claimed a `settings.section` page and a
  Config form the shell renders. Neither exists.

[0.6.0]: https://github.com/CLnum42/dsh-DSchat/releases/tag/v0.6.0
[0.5.1]: https://github.com/CLnum42/dsh-DSchat/releases/tag/v0.5.1
