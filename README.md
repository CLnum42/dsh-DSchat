# dsh-DSchat

## 中文

在 DeepSeek Harness 的**原生面板**里聊 DeepSeek 网页端（chat.deepseek.com），聊完把整段对话迁移成 harness
会话继续开发。复用你的网页登录，不消耗 API 额度。

包名 `dsh-dschat`（npm 强制小写），界面上显示为 **dsh-DSchat**；面板文案跟随 Harness 的界面语言，在中文与
英文之间自动切换。

| 浅色 | 深色 |
|---|---|
| ![dsh-DSchat 面板（浅色）](docs/screenshots/panel-light.webp) | ![dsh-DSchat 面板（深色）](docs/screenshots/panel-dark.webp) |

思考用时、正文里的 `[citation:N]` 芯片、默认收起的参考来源：

![思考用时 / 引用芯片 / 参考来源](docs/screenshots/sources-and-thinking.webp)

> 图是**真实组件**在真实浏览器 + DSH 自己的主题表里渲染出来的（`node scripts/ui-shot.mjs --synthetic`），
> 会话内容是合成样例，公开的图里不会出现任何人的真实对话。

### 能做什么

- **网页聊天**：真实浏览器驱动 chat.deepseek.com，流式回复，可切「深度思考」与「智能搜索」。
- **提问导航**：消息区右缘一列刻度，一条提问一道；悬停展开成提问清单，点一下跳到那一条。
- **新提问置顶**：发出去的问题被顶到消息区顶端，回答在下面长出来，不用滚就能从第一行读起。答案还短于视口时
  浏览器顶不到顶，面板就让它停在能停的位置，不去和滚动较劲；手动滚动、切换会话或从导航跳走都会解除锚点。
  不在底部时右下浮出「↓ 最新」。
- **附件**：📎 走 macOS 原生文件对话框，也支持拖拽与粘贴；图片显示缩略图（单文件 ≤ 24 MB，单条 ≤ 10 个）。
- **排队而不是被拒**：回复还在生成时输入的消息会排队，上一轮结束自动发出。
- **迁移到 harness**：「DSH 迁移」把这段网页对话**蒸馏成任务简报**（或按原文迁移），新建 harness 会话或追加
  到已有会话，可指定工作区。迁移过去的上下文只有用户⇄模型的对话：R1 思考块被丢掉，`[citation:N]` /
  `[reference:N]` 标记被清掉，「参考来源」列表不跟着走；唯一的例外是「导出 markdown」——导出文件是给人看的，
  仍然保留来源链接。
- **从网页同步**：把网页端的对话增量收进本地，成为可搜索、可迁移的记录 —— 已有的消息保留本地的 id、时间与
  思考用时，只补缺失的那些，被截断的回复就地补全。
- **导出 markdown**：整段对话导出到 `~/Downloads`（可配置）。
- **运行状态**：`···` 菜单里的诊断卡，看引擎、登录、浏览器与错误原因。

### 安装

用 DSH 自带的插件安装器（不要手改 profile，也不要在 profile 里跑 pnpm）。两种装法都能用，区别只在于谁
来准备插件自己的依赖：

**方式一 · tarball（交付、给别人装）**

```bash
npm pack --pack-destination ~/.dsh/dschat-dist    # 打成 tarball
plugin_manager action=install_bundle target=file:<tarball 绝对路径>
```

pnpm 会把插件自己的依赖（`playwright-core`）装进 profile 的 `node_modules`，这条路径不需要你先做什么。

**方式二 · `link:`（开发；本机 desktop profile 现在就是这么装的）**

```bash
cd <插件源码目录> && npm install --ignore-scripts   # 先在插件目录装好依赖
plugin_manager action=install_bundle target=link:<插件源码目录绝对路径>
```

`link:` 能正常工作的前提只有一个：**插件目录自己有一份 `node_modules`**。插件是按真实路径解析第三方
依赖的，`playwright-core` 从这一份里取，`@deepseek-ai/*` 由宿主提供；少了它才会出现
`1 required plugin did not activate`。

> 早先这里写的是「必须用 tarball，符号链接解析不到依赖」，**那个结论是错的**。2026-10-01 那次起不来的
> 真实原因写在崩溃日志里：`client-modules: dsh-dschat dsh.client.platform must be a string` ——
> `package.json` 的 `dsh.client.platform` 缺失，跟 `link:` 没有关系，现在已修。

**确认装上了**：重启 DSH 后面板能打开，或者

```bash
curl -s http://127.0.0.1:57531/api/dsh-dschat/state | head -c 120
```

返回以 `{"ok":true` 开头就是装载成功。

### 起不来怎么办

插件是声明式装载的：任何一个插件在 `apply()` 里抛异常，整个 profile 都可能装不起来。真遇到时按顺序做：

1. **看日志**：`~/Library/Logs/DeepSeek Harness/` 里最新的一份，搜 `dsh-dschat`。
   `1 required plugin did not activate` 这类消息后面通常紧跟真正的原因。
2. **先停用、别急着删**：在插件管理器里把 `dsh-DSchat` 停用，或把它在 profile composition 里的那一段
   （`- id: dschat` / `name: 'dsh-dschat'`）注释掉，让 DSH 先起来。
3. **数据是安全的**：对话记录在 `~/.dsh/dsh-dschat/transcripts.json`，附件在同目录的 `attachments/`，
   都与插件能否装载无关；读不出来时插件会把原文件改名备份成 `transcripts.json.corrupt-<时间戳>`，
   不会覆盖它。

### 使用

1. 侧边栏点「聊天」打开面板；第一次发消息时会在弹出的浏览器窗口里完成一次 DeepSeek 网页登录。
2. 直接输入即可（Enter 发送，Shift+Enter 换行）；输入框在引擎没起来时也能打字，点它就会在后台把网页端拉起来。
3. 聊完点输入框上方的「DSH 迁移」→ 选方式与目标 → **先看预览再写入**：预览框里是即将成为新会话首条消息的
   完整文本，可以直接改；确认后才创建会话，并自动打开它。如果蒸馏不可用（没有可用的模型），预览会明确写出
   「本次为原文完整迁移」，不会再和成功蒸馏弹出同一句提示。
4. 左侧「会话列表」是本机记录；左下「从网页同步」把网页端还没同步的会话收进来，某一条想单独补全就点它右侧的
   同步按钮；agent 侧同样可以 `dschat_recover`。其余工具：`dschat_status` / `dschat_send` / `dschat_stop` /
   `dschat_import` / `dschat_transfer`（默认也只返回预览，用户确认后带 `confirm: true` 再调用一次才写入）。
5. 出问题时打开 `···` → 「运行状态」 → **复制诊断**：一次带上运行版本与构建时间、引擎与登录状态、最后的
   错误（含错误码）、数据/配置目录，以及网页端的实时探测结果，直接贴进反馈即可。网页端没起来、没登录或
   出错时，会话末尾也会出现对应的提示卡，每张卡带一个能真正解决问题的按钮（重试启动 / 打开登录窗口）。

### 配置

这一版**没有自带设置表单**：插件不注册 `plugins.row.config` 页面，插件页里不会为它渲染任何表单。配置来自
profile 的 `cordis.patch.yml` —— 在 `dschat` 那一行（`name: 'dsh-dschat'`）下面加 `config:` 块，重启生效：

```yaml
- id: dschat
  config: { browserHeadless: false, exportDir: ~/Notes }
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 插件总开关 |
| `announceToAgent` | `true` | 是否在 system prompt 里公告可用工具 |
| `browserChannel` | `auto` | `chrome` / `msedge` / `chromium` / `auto` |
| `browserExecutablePath` | 空 | 自备 Chromium 时可执行文件路径 |
| `browserProxy` | `direct` | `direct` 或代理地址 |
| `browserHeadless` | `true` | 登录窗口不受它影响，始终可见 |
| `replyTimeoutMs` | `180000` | 单次回复超时（毫秒） |
| `dataDir` | 空 | 数据目录（对话记录），空则 `~/.dsh/dsh-dschat` |
| `profileDir` | 空 | 浏览器 profile（登录态），空则复用 dsh-webchat 的目录 |
| `exportDir` | 空 | 导出目录，空则 `~/Downloads`；相对路径按家目录解析 |
| `transferDistill` | `true` | 迁移默认蒸馏成简报，`false` 为按原文迁移 |
| `transferProvider` / `transferModel` | 空 | 蒸馏用的模型，空则自动挑（优先名带 deepseek 的 provider 与带 chat 的模型） |
| `transferMaxTokens` / `transferChunkTokens` | `4096` / `1024` | 蒸馏的输出与分块上限 |

### 已知限制

- 依赖**本机浏览器 + 网页登录态**，没有 API Key 就不能工作；官网风控、改版或登录失效时会明确报错，而不是静默失败。
- 网页端一次只回答一个问题，所以第二条消息只能排队。
- 浏览器 profile 默认复用 `~/.dsh/dsh-webchat/browser-profile` —— 从 dsh-webchat 切过来不用重新登录；
  两个插件同时开着会争同一份 profile。
- 网页端解析在 DOM 层，官网大改结构时可能读不到内容（此时会报解析失败）。
- 本地 HTTP 接口只接受**回环地址 + POST + 同源 + 每次运行生成的 CSRF 令牌**（面板会自动带上）。所以面板
  之外的脚本要调用它，得先 `GET /api/dsh-dschat/state` 取 `csrfToken`，再在后续请求里带
  `x-dschat-token` 头；这是为了挡住本机其他网页用一张 `<img>` 就把记录清掉。
- 附件只接受图片、文档与文本（有扩展名白名单），单个上限 24 MB、一次最多 10 个、单次总量 48 MB；
  `/send` 还要求路径落在插件自己的 `attachments/` 目录内（agent 的 `dschat_send` 不受目录限制，但同样
  受类型与大小规则约束）。
- 同一份会话记录**同时只允许一个实例写入**：第一个 DSH 还开着时再开一个，第二个会转为只读并在「运行状态」
  里说明原因与处置办法（否则两个实例会互相整份覆盖）。崩溃留下的锁会被自动接管，正常退出会交还。
- 面板的 1.5 秒轮询只取会话**摘要**（标题/时间/条数），正文按需从 `GET /api/dsh-dschat/chat?id=` 取
  —— 这是把轮询流量从 MiB 级降到 KB 级的原因。脚本要搜会话请用
  `GET /api/dsh-dschat/search-conversations?q=`，它返回会话 id，不返回正文。

### 相关

引擎、网页端解析、蒸馏与迁移机制沿用 Apache-2.0 的 dsh-webchat；界面已重写为 DSH 原生面板（`main` 与
`sidebar.panellist` 两个槽位），命名空间独立成 `dsh-dschat`，两个插件可以共存。许可：Apache-2.0。

## English

Chat with DeepSeek's web app (chat.deepseek.com) inside a **native DeepSeek Harness panel**, then hand the whole
conversation off to a harness session and keep building on it. It reuses your browser sign-in, so no API credit
is spent.

The npm package is `dsh-dschat` (npm forces lowercase); the product appears as **dsh-DSchat**. Every string in
the panel follows the Harness UI language and switches between Chinese and English on its own.

| Light | Dark |
|---|---|
| ![The dsh-DSchat panel, light theme](docs/screenshots/panel-light.webp) | ![The dsh-DSchat panel, dark theme](docs/screenshots/panel-dark.webp) |

Thinking time, the `[citation:N]` chips in the body, and the source list (collapsed by default):

![Thinking time / citation chips / sources](docs/screenshots/sources-and-thinking.webp)

> These are **real components** rendered in a real browser with DSH's own theme tokens
> (`node scripts/ui-shot.mjs --synthetic`). The conversations shown are synthetic samples; no real user
> conversation appears in any published screenshot.

### What it does

- **Web chat**: a real browser drives chat.deepseek.com with streaming replies, plus the **Deep think** and
  **Smart search** toggles.
- **Question navigator**: a tick rail down the right edge of the message area, one tick per question; hover to
  expand the list of questions, click to jump to one.
- **New questions anchor to the top**: after a send, the question you just asked is placed at the top of the
  message area and the answer grows below it, so reading starts at line one without scrolling. When the answer
  below is still shorter than the viewport the browser cannot lift the question all the way up, and the panel
  deliberately does not fight that. Scrolling by hand, switching conversations, or jumping away releases the
  anchor. A **Latest** pill floats up whenever you are not at the bottom.
- **Attachments**: 📎 opens the native macOS file dialog; drag-and-drop and paste work too, and images render as
  thumbnails (≤ 24 MB per file, ≤ 10 per message).
- **Queue instead of refusal**: messages typed while a reply is still generating wait in a queue and go out when
  the previous turn ends.
- **Migrate to DSH**: the **Migrate to DSH** menu distills the web conversation into a **task brief** (or replays
  it verbatim) and either starts a new harness session or appends to an existing one, optionally inside a
  workspace you pick. What crosses over is only the user⇄model conversation: the R1 reasoning block is dropped,
  `[citation:N]` / `[reference:N]` markers are removed, and the search-source list is not transferred. One
  exception: **Export markdown** keeps those source links, because that file is written for a person to read.
- **Sync from web**: pulls web conversations into the local store incrementally, so they become searchable and
  transferable. Messages already stored keep their local ids, timestamps and thinking time; only what was missing
  is appended, and a truncated reply is completed in place.
- **Export markdown**: writes the whole conversation to `~/Downloads` (configurable).
- **Runtime status**: a diagnostic card in the `···` menu covering the engine, the sign-in, the browser, and the
  last error.

### Installation

Use DSH's own plugin installer (do not hand-edit the profile, and do not run pnpm inside it). Both install forms
work; the only difference is who prepares the plugin's own dependencies.

**Option 1 — tarball (shipping it to someone else)**

```bash
npm pack --pack-destination ~/.dsh/dschat-dist    # build a tarball
plugin_manager action=install_bundle target=file:<absolute tarball path>
```

pnpm installs the plugin's own dependency (`playwright-core`) into the profile's `node_modules`, so nothing has
to be prepared first.

**Option 2 — `link:` (development; what this machine's desktop profile uses today)**

```bash
cd <plugin checkout> && npm install --ignore-scripts   # install the plugin's deps first
plugin_manager action=install_bundle target=link:<absolute plugin checkout path>
```

A `link:` install works as long as **the plugin directory has its own `node_modules`**: third-party imports
resolve from the real path, so `playwright-core` comes from there while `@deepseek-ai/*` comes from the host.
Without it the symptom is `1 required plugin did not activate`.

> This section used to say "install from the tarball, never with `link:`, because a symlink cannot resolve its
> dependencies" — **that was wrong**. The 2026-10-01 startup failure says what it really was, in the crash log:
> `client-modules: dsh-dschat dsh.client.platform must be a string` — a missing `dsh.client.platform` in
> `package.json`, nothing to do with `link:`. It is fixed.

**Confirm it loaded**: restart DSH and open the panel, or

```bash
curl -s http://127.0.0.1:57531/api/dsh-dschat/state | head -c 120
```

An answer starting with `{"ok":true` means it mounted.

### When Harness will not start

Loading is declarative: a plugin that throws inside `apply()` can take the whole profile down with it. In order:

1. **Read the log**: the newest file under `~/Library/Logs/DeepSeek Harness/`, searching for `dsh-dschat`.
   `1 required plugin did not activate` is usually followed by the real cause.
2. **Disable it rather than deleting it**: turn `dsh-DSchat` off in the plugin manager, or comment out its entry
   (`- id: dschat` / `name: 'dsh-dschat'`) in the profile composition, so Harness starts again.
3. **Your data is safe**: transcripts live in `~/.dsh/dsh-dschat/transcripts.json` and attachments in
   `attachments/` beside it, independent of whether the plugin loads. An unreadable store is renamed to
   `transcripts.json.corrupt-<timestamp>` rather than overwritten.

### Usage

1. Click **Chat** in the sidebar to open the panel. The first message starts a browser window where you sign in to
   DeepSeek web once.
2. Just type (Enter sends, Shift+Enter inserts a newline). The composer accepts text even while the engine is
   down — clicking it brings the web app up in the background.
3. When you are done, click **Migrate to DSH** above the composer, pick a mode and a target, then **read the
   preview before writing**: it shows the exact first message the new session will get, and you can edit it.
   The session is created only when you confirm, and it opens by itself afterwards. If distillation was
   unavailable, the preview says so plainly ("the raw conversation") instead of arriving as the same success
   message a real brief produces.
4. The conversation list on the left is the local record; **Sync from web** at its foot pulls in web conversations
   that are not here yet, and the sync button on a row completes that one alone. Agents can do the same through
   `dschat_recover`; the other tools are `dschat_status`, `dschat_send`, `dschat_stop`, `dschat_import` and
   `dschat_transfer` (which also previews by default and writes only on a second call with `confirm: true`).
5. When something goes wrong, open `···` → Status → **Copy diagnostics**: one click carrying the running version and
   build time, the engine and sign-in state, the last error with its code, the data and configuration paths, and a
   live probe of the web page — ready to paste into a report. A web page that is down, signed out or broken also
   names itself at the end of the conversation, with the button that fixes it (retry / open the sign-in window).

### Configuration

This build ships **no settings form**: the plugin registers no `plugins.row.config` page, so the Plugins page
renders no form for it. Configuration lives in the profile's `cordis.patch.yml` — add a `config:` block under the
`dschat` row (the one with `name: 'dsh-dschat'`) and restart Harness:

```yaml
- id: dschat
  config: { browserHeadless: false, exportDir: ~/Notes }
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch for the plugin |
| `announceToAgent` | `true` | Announce the available tools in the system prompt |
| `browserChannel` | `auto` | `chrome` / `msedge` / `chromium` / `auto` |
| `browserExecutablePath` | empty | Path to your own Chromium build |
| `browserProxy` | `direct` | `direct` or a proxy URL |
| `browserHeadless` | `true` | The sign-in window ignores it and stays visible |
| `replyTimeoutMs` | `180000` | Timeout for a single reply (ms) |
| `dataDir` | empty | Transcript directory; defaults to `~/.dsh/dsh-dschat` |
| `profileDir` | empty | Browser profile (sign-in); defaults to the dsh-webchat one |
| `exportDir` | empty | Export folder; `~/Downloads` when empty, relative paths resolve against home |
| `transferDistill` | `true` | Hand-offs distill by default; `false` replays the transcript |
| `transferProvider` / `transferModel` | empty | Distillation model; empty auto-picks (a deepseek provider, a chat model) |
| `transferMaxTokens` / `transferChunkTokens` | `4096` / `1024` | Output and per-chunk token caps |

### Known limits

- It needs a **local browser plus a web sign-in**; without one it cannot work at all. Vendor rate-limiting, a page
  redesign, or an expired session produce an explicit error rather than a silent failure.
- The web app answers one question at a time, so a second message can only queue.
- The browser profile defaults to `~/.dsh/dsh-webchat/browser-profile`, so switching over from dsh-webchat needs no
  second sign-in; running both plugins at once makes them share it.
- Parsing happens at the DOM layer, so a major redesign of the site can leave nothing to read (reported as a parse
  failure).
- The local HTTP routes accept **loopback + POST + same origin + a per-run CSRF token** only (the panel sends it
  automatically). A script outside the panel must read `csrfToken` from `GET /api/dsh-dschat/state` and send it
  back in `x-dschat-token`; that is what stops another page on this machine from clearing your history with one
  `<img>` tag.
- Attachments are limited to images, documents and text (an extension allow-list): 24 MB each, 10 per message,
  48 MB per turn. `/send` additionally requires the path to be inside the plugin's own `attachments/` directory;
  the agent's `dschat_send` is not confined to that directory but obeys the same type and size rules.
- Only ONE instance may write a transcript store at a time: start a second Harness while the first is running and it
  turns read-only, saying why in the status card (two writers would each overwrite the other's whole history). A lock
  left by a crash is taken over automatically, and a clean shutdown hands it back.
- The 1.5 s poll carries conversation SUMMARIES only (title, times, counts); a body is fetched on demand from
  `GET /api/dsh-dschat/chat?id=` — which is what took the poll from megabytes to kilobytes. Scripts that want to
  search conversations should use `GET /api/dsh-dschat/search-conversations?q=`, which answers ids, not bodies.

### Related

The engine, the web-page parsing, and the distillation/hand-off machinery come from the Apache-2.0 `dsh-webchat`
plugin. The UI is rewritten as a native DSH panel (the `main` and `sidebar.panellist` slots) under the independent
`dsh-dschat` namespace, so both plugins can be installed side by side. License: Apache-2.0.
