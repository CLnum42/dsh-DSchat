# Changelog

All notable changes to dsh-DSchat are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Versioning note: `0.5.1` and `0.6.0` are the first two releases cut from a
committed tree — everything before them shipped as `0.4.2` and earlier.

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
