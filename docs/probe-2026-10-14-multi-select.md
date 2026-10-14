# 分享的选择模式：逐条勾选（多组问答）—— 真机事实与守卫

Probe date **2026-10-14** (Asia/Shanghai). dsh-DSchat `0.11.0`.
续 `docs/probe-2026-10-14-share-flow.md`（那份从 bundle 里读出了网页端的选择模式与创建请求，但没有创建过链接）。

这一份记的是**插件自己驱动这套流程时**新用到的三件事，都是真机量到的：注入勾选框怎么点、「已选择 N 组对话」
怎么读、以及数量守卫为什么是必需的。

## 0. TL;DR

| # | 事实 | 依据 |
|---|---|---|
| 1 | 选择模式里，每条消息的 item 里会被注入一个勾选框：`div.ds-checkbox-align-wrapper` 下的 `div.ds-checkbox`（`全选` 在 bar 里，不在 item 里） | 真机运行 `shareMessages` 两组问答成功 |
| 2 | 用完整 pointer/mouse 序列 + 一次 `click()` 点击勾选框生效，bar 上的计数从 1 变 2 | 同上（守卫读到的计数必须等于 2，否则不会创建） |
| 3 | bar 上「已选择 N 组对话」是**唯一可信**的选中状态：item 上的勾选框没有可读的选中态（探针里选中/未选中的 class 相同） | 前一份探针 §1 + 本次守卫实测 |
| 4 | **创建之前必须先对账**：计数 ≠ 面板选的组数就按「取消」退出，什么都不发 | 本次实现；分享是发布公开链接，宁可不发也不能发错 |
| 5 | 创建成功后，弹窗自己关掉（onFinish = exitSelection），选择模式随之退出；`创建分享链接` 不再出现在页面上 | 本次实测 |
| 6 | 走完整流程创建链接 → 用网页端自己的 `/api/v0/share/delete` 删除 → 无 cookie 浏览器打开显示「你访问的链接已失效」 | 本次实测（见下） |

## 1. 注入的勾选框（新增的两条选择器）

探针 `08-share-bar.json` 记下的结构：

```
item[data-virtual-list-item-key]
└─ div.ds-checkbox-align-wrapper
   └─ div.ds-checkbox.ds-checkbox--l.ds-checkbox--active.ds-checkbox--none
bar
└─ div.ds-checkbox-wrapper.ds-checkbox-wrapper--l._692accd > div.ds-checkbox-label   "全选"
```

`--active` / `--none` **不能**当作「已选中」来读：探针快照里一个选中项和一个未选中项带的是同一组修饰类。
所以引擎只在 item 范围里找 `.ds-checkbox`（bar 里的全选不在 item 内，不会误点），点了之后**用 bar 的计数验证**。

点击用完整手势而不是裸 `click()`：勾选框是 `div`，页面完全可能监听 `pointerdown`/`mousedown`；而单纯
`dispatchEvent('click')` + `click()` 会触发两次。引擎的 `pressCheckbox` 是
`pointerdown → mousedown → pointerup → mouseup → click()`，React 的 `onClick` 与指针监听各收到一次。

## 2. 计数怎么读

```js
const nearby = /(\d+)\s*(?:组|conversations?|messages?)/i.exec(bar.textContent)
const loose  = nearby ?? /(\d+)/.exec(bar.textContent)
```

「已选择 1 组对话」→ 1；英文构建换了措辞也还能落在 `conversations` 上；一个数字都没有（页面改版）时返回
`null`，**不猜 0** —— 页面对同一个会话还有「暂无可分享的消息」这种没有数字的状态。

计数是**组数**（`Math.floor(selectedMessages.length / 2)`），所以引擎按「面板选了几组」来对账，
不按消息条数。

## 3. 数量守卫为什么是必需的

创建请求 `POST /api/v0/share/create {chat_session_id, message_ids}` 一点即成（请求飞行中网页端会禁用
Esc 与点遮罩取消，见前一份探针 §5），而它发布的是**公开链接**。选择模式本身没有任何「对账」环节：
点错一个勾选框，读者在确认框里看到的仍然只是「已选择 N 组对话」。所以插件在点「创建分享链接」之前，
把 bar 上的 N 与读者所选的组数比一次；不一致就按「取消」退出，并回一条明确说「没有创建链接」的句子
（`selection:a/b`、`checkbox:<key>`、`not-found:N`）。

## 4. 本次真机验证（`verify-multi-select.mjs`）

```bash
curl -X POST "$DSH/api/dsh-dschat/close-browser" -H "x-dschat-token: $TOKEN" -H "Origin: $DSH" -d '{}'
node .tmp-probe-share/verify-multi-select.mjs
```

- 用**拷贝的** transcript store（`$TMPDIR/dschat-verify-multi-*/transcripts.json`），从不写读者的数据；
- 取最近一条带 `webSessionId` 且有两个含正文回答的会话，用**两组问答**调真正的
  `engine.shareMessages(chatId, [answerA, answerB])`：
  `{"ok":true,"url":"https://chat.deepseek.com/share/<id>","created":true}`；
- 随后删掉这条链接：`share/list` 2 → 1（不再包含该 id），无 cookie 浏览器打开显示「你访问的链接已失效」；
- 页面退出后不再处于选择模式（`创建分享链接` 不在页面上）；
- 账号里剩下的那一条分享不是本次测试创建的，未做处理。

**副作用**：测试期间该账号上真的存在一条公开链接（约数秒），已删除并验证失效。这是本插件唯一对外发布的
功能，所以这条路径的真机验证是必要的。

## 5. 离线可做的部分

`node scripts/ui-shot.mjs <dir> --synthetic` 在真 Chrome 里挂真面板 + 桩 API，逐个断言：
默认勾中「点的那一组」、一组的两半 `aria-checked` 一致（绑定）、点第二组的**回答**那一行后整组一起变、
计数跟着变、确认前 `share` 调用数为 0、确认后发出的 `messageIds` 是**一组一个回答 id**。
导出侧同样：按钮在那排按钮的最后、`···` 菜单里没有导出、选择器默认全选、确认后参数带上所选消息 id。
