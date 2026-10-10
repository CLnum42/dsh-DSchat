# dsh-DSchat 界面优化提案（会话列表浮层 + 输入框高度）

> 效果图见 `docs/proposal-v0.8-ui/`（4 张，浅色/深色各一对）。
> **两侧都是同一份真实组件**：左边是当前树（改动前的 `src/client`），右边是改完的树。
> 渲染脚本 `scripts/dialog-preview.mjs` 把两棵树各打一个 bundle、并排放进同一张图，
> 所以图里的差别就是代码的差别，不是手绘稿。文末是实测数值（脚本 `report.json`）。

---

## 一、你提的两件事

### 1. 输入框太小 → 46px 提到 84px（1 行 → 3 行）

现状是**量出来的小**，不是感觉：

| | 计算 | 实测 |
|---|---|---|
| 现在 | `padding 12 + 1×行高 22.4 + padding 4` | `min-height: 46px` → **1.3 行** |
| 提案 | `padding 12 + 3×行高 22.4 + padding 4 = 83.2` | `min-height: 84px` → **3 行** |

`1.3 行` 的意思是：第二行的下半截（字母下沿）被滚动条切掉——不是「一行」，
是「一行加一点点，读者永远在滚动自己的草稿」。3 行是能**看见句子开头**的最小行数，
同时它还是输入框、不是文档：卡片整高 96px → 134px，在 620px 宽的栏里占约 1/5。

`max-height` 一起 180 → 220，否则加了地板会丢掉上面的生长区间（
两处必须同时改：`styles.ts` 里的是浏览器执行的上限，`COMPOSER_MAX_HEIGHT` 是面板测量用的）。

### 2. 会话列表 → 贴着「会话列表」按钮向上弹出的浮层（和「DSH 迁移」同一套）

| | 现在 | 提案 |
|---|---|---|
| 形态 | 左侧常驻 238px 栏 | **浮层**，锚在按钮上方 8px |
| 位置 | 占布局左侧 | **按钮左对齐**（x 与按钮左沿一致），向上展开 |
| 宽度 | 238px 可拖 | **348px**（= 「DSH 迁移」浮层的宽度） |
| 高度 | 固定满高 | **铺满可用高度**（从标题栏下沿一直到按钮上方 8px），窗口越矮它越矮 |
| 搜索框 | 栏内最上方 | **浮层内最上方**（你要的） |
| 对话区宽度 | 382px / 620px | **620px 全宽** |
| 图标 | 面板+竖线 | **三横线** |

**触发按钮留在输入框上方那一行**（没有搬到标题栏）。这不是审美选择，是位置决定的：
浮层向上弹，所以按钮必须在面板**底部**，上面才有对话区可以弹进去。放到标题栏，
它上面只有 52px 窗口栏，浮层只能**向下**盖住它列出的那段对话。
按钮上是三横线 + 「会话列表」文字（和「＋ 新对话」「⇄ DSH 迁移」同一个 28px 胶囊）。

**图标为什么换**：旧图标画的是一个**侧栏**（矩形+竖线），所以它承诺了侧栏，
而点下去弹出来的东西是浮在对话上的——图标画错了屏幕的另一半，比没有图标更糟。
三横线只说「后面有个列表」，正好是实情。

**锚定方向**：`.dsh-dschat-pop` 默认 `right: 0`（适合右端的「迁移」）。
「会话列表」在左端，右对齐会让 348px 的浮层从按钮右沿向左伸出 220px 到面板外——
实测被窗口裁掉，最后三行点不到。所以它改成**左沿对齐**：
`348 + 26px 内边距` 在任何宽度的面板里都放得下，因此不需要窄宽度逃生规则。

**高度：铺满可用空间（实测距离，不是视口常数）**：面板把**按钮顶部到 body 顶部的实测距离**
（body = 标题栏下方那一列）减去 8px（浮层与按钮之间的间距，样式表里 `bottom: calc(100% + 8px)`
已经占掉的）写进 wrapper 上的 `--dschat-list-avail`（上限用）和 `--dschat-list-h`（高度用），
浮层就用这个高度**从标题栏下沿一直铺到按钮上方**。每次打开都重新测量，
面板尺寸变化时用 `ResizeObserver` 重测（队列、附件条、阶段行都会把这一行顶来顶去）。

实测三档窗口（20 行对话）：

| 面板高 | 实测可用高度 | 浮层实际高度 | 浮层顶部 y | 标题栏下沿 | 列表 |
|---|---|---|---|---|---|
| 560 | 288px | 288px | 52 | 52 | 内部滚动 |
| 780 | 508px | 508px | 52 | 52 | 内部滚动 |
| 1000 | 728px | **640px 封顶** | 140 | 52 | 内部滚动 |

顶部 y 恒等于标题栏下沿，也就是**贴着标题栏**但绝不越界。640px 是唯一的封顶，
只为了让特别高的窗口里它别变成第二页。

> 三个量错过的版本，都留了记录，因为它们各自是一类错误：
> ① 量"按钮到**面板**顶部"——560px 窗口下浮层顶部落到 y=2，钻进标题栏底下；
> ② 减了 10px（8px 间距 + 2px 余量）——2px 是把已经算过的间距又算一遍，白白吃掉一行，
>    这就是你看到的"有点矮"；浮层顶还因此**入侵标题栏 4px**（实测 `popTop - headerBottom = -4`）；
> ③ 只设上限、不设高度——5 行对话时卡片只有 381px，浮在 179px 处，顶部还是显得远。
> 现在：只减那 8px，加上"铺满"的高度，于是 `popTop == headerBottom` 恒成立（有断言钉着）。

**关闭方式**：`Esc`；再点一次按钮；**点浮层外部任意位置**（`pointerdown`，按下即关，
和系统菜单一致——不用等抬起）；选中一行后关闭（这一条是这次新加的：测试发现选完对话浮层不关，
侧栏版本从来不需要关，所以旧代码里根本没有这行）。

**保留的交互**：`⌘K` 打开并聚焦搜索框；「从网页同步」/「清空全部」两个按钮在浮层底部；
重命名行、悬停删除、时间戳都不变。

---

## 二、实测（浏览器里读回来，非估算）

| | 现在 | 提案 |
|---|---|---|
| 输入框 `min-height` | 46px | **84px** |
| 空输入框显示行数 | 1.3 | **3.0** |
| 输入卡片高 | 96px | 134px |
| 对话区宽度 | 382px（有栏时） | **620px** |
| 浮层宽 | — | **348px**（与迁移浮层同宽） |
| 浮层高（5 行，780 面板） | — | **508px**（铺满可用高度），顶部 y=52 |
| 浮层高（20 行，780 面板） | — | **508px**（同上），顶部 y=52 |
| 浮层位置 | — | x 26–374，y 52–560；按钮 y 568 → 间距 **8px**；标题栏下沿 y=52 |
| 浮层内搜索框 | — | 322×30，浮层内 y=192 |
| 20 行列表滚动 | — | 可视 397px / 内容 1071px，可滚动；一行 52px，浮层自身占 111px |
| 触发图标 | `rect 2.1,3.1 + 竖线` | `M2.6 4.4h10.8 M2.6 8h10.8 M2.6 11.6h10.8`（三条横线） |

关闭行为由 `scripts/list-dismiss-check.mjs` 用真实鼠标事件验证（全过）：

```
ok   initial: open=false
ok   after pressing the trigger: open=true
ok   the popover stays below the header: popTop=52, headerBottom=52   ← 贴顶但不越界
ok   after pressing the header (outside): open=false                  ← 点外部关闭
ok   after pressing the trigger again: open=true
ok   after typing in the popover search box: open=true                ← 浮层内输入不会误关
ok   after picking a conversation: open=false
```

---

## 三、改动清单（尚未提交）

- `src/client/panel/DSchatPanel.tsx`：`rail()` → `sessionsPopover()`（浮层，含搜索框 / 行 / 底部按钮）；
  动作行恢复「会话列表」按钮 + 浮层同包在一个 `.dsh-dschat-pop-wrap` 里；
  新增测量 effect（`useLayoutEffect` + `ResizeObserver`，量到 body 顶部，只减 8px 的按钮间距，
  写出 `--dschat-list-avail` 与 `--dschat-list-h`）；
  新增点外部关闭 effect（`document` 上的 `pointerdown` + `contains` 守卫）；
  `openChat()` 补上 `closeList()`；删掉拖拽调宽的全部代码；`COMPOSER_MAX_HEIGHT` 220；
  新增 `initialListOpen()`（含 `?dschat-list=open|close` 覆盖，供沙箱 iframe 里的脚本用）；
  根节点保留 `data-list-open` 观测属性。
- `src/client/panel/styles.ts`：删 `.dsh-dschat-rail*`、`[data-rail-drag]`、`.dsh-dschat-hbtn*`、`.dsh-dschat-dialog*`；
  新增 `.dsh-dschat-listpop*`；`.dsh-dschat-pop` 加 `max-height: min(60vh, 520px)`（其他浮层的兜底）与 `overflow: hidden`，
  列表浮层用 `height: min(var(--dschat-list-h, 100vh), 640px)` + `max-height` 覆盖，即**铺满可用高度**；
  `.dsh-dschat-input` min/max-height。
- `src/client/icons.tsx`：`HistoryIcon` → `MenuIcon`（三横线）。
- `src/client/locales.ts`：`rail.show/hide` 文案改为「打开/关闭会话列表」，删 `rail.resize`（zh + en）。
- `scripts/dialog-preview.mjs`：两棵树并排出图的渲染脚本（`--list-size` / `--height` / `--open-sessions` 等）。
- `scripts/list-dismiss-check.mjs`：关闭行为的真实鼠标回归检查，并带上"浮层不越界标题栏"的几何断言。
- `test/client-render.test.ts`：把检查 `.dsh-dschat-rail` / `rail-resize` / `rail.width` / 拖拽的断言换成新实现——
  初始屏断言浮层与触发按钮；"关闭即不在 DOM 里"改为断言 `.dsh-dschat-listpop` / 搜索框 / 行都不存在；
  拖拽调宽那条整条换成"实测高度"契约（量 body 而非面板、只减 `TRIGGER_GAP = 8`、
  且断言**没有第二个** `POPOVER_GAP`、`ResizeObserver` 重测、
  样式表用 `height: min(var(--dschat-list-h, 100vh), 640px)`、点外关闭、选行关闭）。
- `test/ime-enter.test.ts`：空输入框高度断言 46px → 84px，上限 180px → 220px（真实浏览器里量的）。
- `src/client/locales.ts`：顺手修掉我上一版写进英文词典的 CJK 括号（`rail.empty`），
  那条断言本来就该拦住它——`the English dictionary carries no CJK` 现在过了。
- 存储键 `dsh-dschat.rail.open` 的名字保留：老读者的偏好因此不会丢。
  宽度键 `dsh-dschat.rail.width` 废弃（浮层没有可存的宽度）。

**验证状态**：`node --test test/` **180/180 通过**；`node scripts/list-dismiss-check.mjs` 4 条关闭路径全过；
`node scripts/build.mjs` 干净（`lib/` 已重建）。尚未在真实 DSH 窗口里验证——见下。
