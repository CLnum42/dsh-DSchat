# chat.deepseek.com 分享 (share) flow — the create path, established WITHOUT creating a share

Probe date **2026-10-14** (Asia/Shanghai). dsh-DSchat plugin host `0.9.0`, engine `ready`.
Follows on from `docs/probe-2026-10-14-reply-actions.md` (§6 introduced the selection mode).

**HARD RULE honoured: 「创建分享链接」 and 「创建并复制」 were never pressed.** No share was created, no
public URL was published, no account state was written. **No browser was launched at all** (the plugin's
profile was locked — `SingletonLock -> MacBook-Air-2.local-42507` — so the plugin's live Chrome was left
untouched: `engine: "ready"` before and after, lock file unchanged).

**Method (browser-free).** `https://chat.deepseek.com/` returns its app shell from the CLI fine; the
hashed bundles are served from a CDN that is not rate-limited:
`https://fe-static.deepseek.com/chat/static/main.a6bd2c6c8d.js` (1 555 103 B) and `main.cda7a62066.css`.
The shell's `<meta name="commit-id" content="f92f568b">` **matches the commit id inside the bundle**
(`commitId:"f92f568b"`), so this is exactly the JS the live SPA runs. Everything below is read out of
that file plus its stylesheet. `verify-bundle.mjs` re-downloads both and asserts **19/19** of the code
paths quoted here; `verify-bundle.json` is its output (`ALL PROBES PASS`).

---

## 0. TL;DR

| # | question | answer |
|---|---|---|
| 1 | selection mode | Confirmed as prior probe; a per-message 分享 is `enterSelection(sessionId,[messageId])`, default selection = **that answer + its paired question** (bar says 「已选择 1 组对话」), 全选 = `"all"` (whole conversation), 取消 = `exitSelection()`, **zero network on enter/leave** |
| 2 | 创建分享链接 | Opens a **modal** (`创建分享链接`, 408px) that only explains the privacy warning; its footer is the real action **「创建并复制」** → `POST /api/v0/share/create` → the link appears in the modal footer and is **auto-copied to the clipboard** |
| 3 | observability | Best: **read `share_id` from the `POST /api/v0/share/create` response** (plugin can inject a fetch hook) — exact & independent of DOM churn. Also good: the dialog's `.ds-copyable-text-line__text`. Worst: `navigator.clipboard` (permission focus), `share/list` (no url field, needs a guess) |
| 4 | public? | **Yes — anyone with the link, no login.** Route table marks it `public:!0` and the app's own copy says 「任何获得链接的人都可以查看你分享的对话」 |
| 5 | failure modes | Create disabled at 0 selected; while creating, Esc/mask close is disabled; leaving the bar open disables per-message toolbars; the mode is exited by 取消 only (Escape does not) |
| 6 | recommend? | **Yes, observable enough** — but only via the API response or the dialog field, never via the clipboard. **However**: creating publishes a real public URL, and a plugin cannot delete-and-forget reliably mid-flight; see §6 |

---

## 1. Selection mode — what it offers (question 1)

Entry point, per message (bundle offset ≈ 418 924), `probe-2026-10-14-reply-actions.md` §6's index-5 分享:

```js
d=()=>{ … tracker.info({name:"shareEntryClick",message:"分享入口点击",
      payload:{entryType:"message_actions",sessionId:t,messageId:n}}),
      s.enterSelection(t,[n])}
```

So 分享 on one message = `enterSelection(sessionId, [messageId])` — **that single message id**, no dialog,
no request. `i0.m` wraps it in a tooltip whose text is `share` (「分享」) when enabled and
`shareButtonDisabledTooltip` (「该消息不支持分享」) when not; the button is `disabled:!l` where
`l = selectable || status∈{INCOMPLETE,OK}`.

`enterSelection` resets then applies (offset ≈ 207 427):

```js
enterSelection(e,t){this.plainStore.enterSelection(e),            // currentSessionId=e, selectedMessages=[]
  "all"===t?this.toggleAllMessagesSelection():null==t||t.forEach(e=>{this.toggleMessageSelection(e)})}
```

`toggleMessageSelection` expands one id into its **pair** — `getMatchingMessage` on an assistant
message returns its parent user question:

```js
let n=this.plainChatStore.getMatchingMessage(t.currentSessionId,e); if(!n)return;
let r=UP(this.plainChatStore,t.currentSessionId),{selectedMessages:s}=t;
if("all"===s) setState({selectedMessages:t3.A(r,e,n.id)})
else { let t = s.includes(e) ? t3.A(s,e,n.id) : t9.A(s,[e,n.id]); setState(()=>({selectedMessages:
        r.length===t.length?"all":t})) }
```

That is why clicking 分享 on **one answer** yields the prior probe's 「已选择 1 组对话」 and injects
checkboxes into **two** items (the question and the answer) — `getMatchingMessageImpl`:
`return s.role===USER ? i(e,t,s.childIds[s.currentIndex]) : s.parentId ? i(e,t,s.parentId) : null`.

Bar count text (offset ≈ 811 400) is a **turn** count, which is what the user reads:

```js
d = useSelector(n => void 0===e||n.currentSessionId!==e ? 0
      : "all"===n.selectedMessages ? t.length : n.selectedMessages.length)
h = Math.floor(d/2)
… children: c ? l.sharePanelNoShareable : 1===h ? l.shareSingularMessageSelected(h)
                                                 : l.sharePluralMessageSelected(h)
```

`shareSingularMessageSelected` and `sharePluralMessageSelected` are **the same string**,
`"已选择 ".concat(e," 组对话")` (both defined identically, offsets 136 174/136 199) — so 1 vs N never differs
in wording, only in the number. `sharePanelNoShareable` = 「暂无可分享的消息」 replaces it when the
session has no shareable message.

全选 handler `g` (offset ≈ 811 900):

```js
g=()=>{ n&&(i.current||u||(tracker.info({name:"clickSelectAll",message:"点击全选checkbox",…}),
      i.current=!0), s.toggleAllMessagesSelection()) }
toggleAllMessagesSelection(){ … setState({selectedMessages: "all"===x ? [] : "all"}) }
```

全选 is a **toggle on the `"all"` sentinel**, not a loop: `"all"` → `[]` (deselect everything), anything
else → `"all"`. The checkbox is `checked:u` where `u = ("all"===selectedMessages) && d>0`; its
`disabled` is `c = 0===n$(n).length` (nothing shareable in the session).

取消 handler `f` (same region): `f=()=>{ tracker.info({name:"clickCancelShareSelect",message:"点击取消分享"}), s.exitSelection() }`, and

```js
exitSelection:()=>{ e(e=>{ e.currentSessionId=void 0, e.selectedMessages=[] }) }
```

**Nothing in enterSelection / toggleAll / exitSelection is async and none of them touches HTTP** — this is
why the prior probe measured no request entering or leaving the mode. I re-confirm it structurally: the
only fetches in `class nK` are `createShare`, `fetchShareContent`, `listShares`, `deleteShare`, `forkShare`,
and none is called from those three methods. **A single 取消 (`exitSelection`) is the complete restore** —
there is no second state to unwind and no `beforeunload`/`popstate` listener in the mode.

**Not re-measured live:** the exact rendered markup of the bar (hashed classes `div._43d222b` etc.). The
prior probe has that DOM verbatim (`08-share-bar.json`); I did not re-enter it because the profile lock
would have meant killing the plugin's browser, which was forbidden. The **behaviour** above is read from
the code that renders that bar, so the prior probe's markup and this code agree.

---

## 2. What 创建分享链接 does (question 2) — NOT pressed

### 2a. 「创建分享链接」 is not the action — it opens a dialog

Bar handler (offset ≈ 811 950):

```js
v=async()=>{ n&&d>0&&(tracker.info({name:"clickCreateShareLink",message:"点击创建分享链接",
      payload:{sessionId:n,selectedCount:d}}), o(!0)) }
…
(0,j.jsx)(tB.$,{onClick:v,disabled:0===d,icon:…,children:l.shareCreateLink}),   // 创建分享链接
(0,j.jsx)(Sm,{show:a,onConfirm:C,onFinish:s.exitSelection,onCancel:()=>o(!1)})
```

`v` only opens `Sm`. The primary button is **`disabled:0===d`** — with nothing selected it cannot be
pressed (and the bar has the 0-selected state anyway). `Sm` is the dialog (offset ≈ 810 300):

```js
let Sm=e=>{ let{show:t,onFinish:n,onCancel:r,onConfirm:s}=e, … [l,d]=useState() /* the link */, …
  return jsx(ud.a,{appear:!0,show:t,closeOnEscapeKeydown:!o,closeOnMaskClick:!o,onShowChange:f,
    children: jsx(uc.$m,{variant:"dialog",style:{width:"408px"},title:c.shareCreateLink,onClose:f,
      footer: l ? jsx(Sp,{autoCopy:!0,text:l,copied:u,copyLabel:c.shareCreateLinkCopy,
                         copiedLabel:c.shareCreateLinkCopied,onCopy:m})
                : jsx(tB.$,{size:"xl",onClick:g,loading:o,disabled:o,block:!0,
                            children:c.shareCreateLinkButton}),
      children: jsx("div",{children:c.shareCreateLinkInform})})})}
```

Note the dialog **is titled 创建分享链接** and its body is only the warning; the actual action button is
**「创建并复制」** (`shareCreateLinkButton`). `onShowChange:f` means: if a link exists, closing calls
`onFinish` (= `exitSelection`, leaving the mode); if not, `onCancel` (just hides the dialog, stays in the
mode). So **the flow is: bar → dialog → 创建并复制 → same dialog turns into a link display**.

### 2b. Confirm = create then render + auto-copy the link

```js
C=async()=>{ if(!(n&&d>0))throw Error(); try{
    tracker.info({name:"clickConfirmCreateAndCopy",message:"点击创建并复制",…}),
    let e=s.getSelectedMessages(n), t=await s.createShare(n,e), r=(0,eQ.g6)(t);
    tracker.info({name:"createShareOk",message:"创建分享链接",payload:{shareId:t,messageCount:d}});
    return r }catch(e){ tracker.error({name:"createShareError",…}); throw e } }
g=async()=>{ i(!0); try{ let e=await s(); d(e) }catch{} finally{ i(!1) } }   // store link → render
```

So a successful create **does not navigate, does not toast-and-vanish**: the same modal swaps its footer
to the link field. The field is the `Sp` component (`ds-copyable-text-line`, offset ≈ 809 250):

```js
function Sp(e){ … [autoCopy:i,onCopy:l]=e …
  (0,eS.useEffect)(()=>{ i&&g(t,"auto") },[i,g,t])          // ← AUTO COPY on mount
  … jsx("div",{className:"…ds-copyable-text-line…",children:[
       jsx("div",{className:"…__scroll",…,children: jsx("span",{className:"…__text",children:t})}),
       jsx("div",{className:"…__action",…, jsx(tB.$,{shape:"capsule",disabled:s,
            onClick:()=>g(t,"click"), …})) ]}) }
```

The link **is rendered as text** (`…__text` span, `text-wrap:nowrap`, horizontally scrollable) with a
separate capsule copy button (`disabled:s` = disabled once copied). CSS confirms both class names exist
in the live stylesheet (`.ds-copyable-text-line__text`, `.ds-copyable-text-line__scroll`,
`.ds-copyable-text-line__action`).

**Auto-copy, verbatim** (offset ≈ 810 470):

```js
m=async(e,t)=>{ try{ await new Promise((t,n)=>setTimeout(()=>navigator.clipboard.writeText(e).then(t,n),0)),
    h(!0), p(), tracker.info({name:"copyShareLinkSuccess",message:"链接复制成功",payload:{from:t}})
  }catch(e){ tracker.error({name:"copyShareLinkError",message:"复制分享链接失败",…}),
    a.warning({node:c.shareCreateLinkCopyFailed,description:"复制分享链接失败"}) } }
```

`from` is `"auto"` on the `useEffect` path and `"click"` on the button path — so **yes, the app copies the
link to the clipboard by itself**, right when the create promise resolves. The button then shows 已复制
and a 「分享链接已复制」 toast; a clipboard failure toasts 「复制失败」 (and the plugin must assume a
headless/denied clipboard *will* fail — see §6).

### 2c. What the strings say (zh-CN, verbatim)

| key | string |
|---|---|
| `shareCreateLink` (bar + dialog title) | 创建分享链接 |
| `shareCreateLinkButton` (dialog action) | **创建并复制** |
| `shareCreateLinkInform` | **任何获得链接的人都可以查看你分享的对话，请检查是否包含敏感或隐私内容。你可以随时在系统设置 - 数据管理中管理被分享的链接。** |
| `shareCreateLinkCopy` / `shareCreateLinkCopied` | 复制 / 已复制 |
| `shareCreateLinkCopiedToast` | 分享链接已复制 |
| `shareCreateLinkCopyFailed` | 复制失败 |
| `shareLinksManageCopy` / `shareLinksManageSharedAt` / `shareLinksManageDescription` | 复制链接 / 共享于 / 我共享的链接 |
| `shareLinksManageDelete` / `…DeleteConfirmTitle` / `…DeleteConfirmDesc` | 删除 / 确认删除吗？ / 删除链接后，任何人无法通过该链接访问你分享的对话。 |
| `shareCreateLinkExceedLimitToast` | 当前对话生成链接数达到上限 |
| `shareCreateLinkFailedToast` | 生成链接失败 |
| `shareSelectLimitExceededToast` | 选择的消息过多，请减少选择后再试 |
| `operationTooFastToast` | 操作过于频繁，请稍后再试 |
| `shareContentWarning` (viewer side) | 该对话来自分享，由 AI 生成，请仔细甄别。 |

**There is no 有效期 / expiry string anywhere in the bundle.** No TTL field, no expiry picker, no
"公开/私有" toggle: the flow is one-shot public-link creation. (Grep for 有效 found only unrelated
`shareInvalid` 「你访问的链接已失效」 = *the link you visited is no longer valid*, i.e. deletion, not time.)

### 2d. The request (the thing the plugin could call instead)

```js
async createShare(e,t){ try{ return (await function(e){let{chatSessionId:t,messageIds:n}=e;
   return Ax().http.http.post("/api/v0/share/create",{json:{chat_session_id:t,message_ids:n}})
     .then(e=>{ let{context:t,json:n}=e;
       if(n.data.biz_code!==CreateShareErrorCode.OK) throw{code:n.data.biz_code};
       return{data:{shareId:n.data.biz_data.share_id},context:t} }) }({chatSessionId:e,messageIds:t})
   ).data.shareId } catch(e){ … } }
```

**Request**: `POST /api/v0/share/create`, JSON `{chat_session_id, message_ids}`.
**Response**: `{data:{biz_code, biz_data:{share_id}}}` — i.e. the caller gets a bare **`share_id` string**.
The exported URL builder (offset ≈ 41 070) turns it into the link:

```js
function C(e){ return new URL((0,s.tW)(i.a$.SHARE,{shareId:e}), window.location.href).href }
// i.a$.SHARE = "/share/:shareId"
```

So `g6(shareId)` = `<origin>/share/<shareId>`. Because it resolves against `window.location.href`, the
plugin can reproduce it byte-for-byte from the page context — it does **not** need the dialog to know the
URL once it has `share_id`.

`CreateShareErrorCode` (offset ≈ 1 265 641) enumerates exactly what can go wrong — useful for a driver:

```
OK=0 INVALID_CHAT_SESSION=1 FAILED_TO_GET_ACCOUNT_INFO=2 BANNED_USER_CANNOT_CREATE_SHARES=3
USER_IS_MUTED=4 SOME_MESSAGES_CANNOT_BE_SHARED=5 MESSAGES_MUST_APPEAR_IN_PAIRS=6
TOO_MANY_SHARES_FOR_THIS_SESSION=7 FAILED_TO_GENERATE_UNIQUE_SHARE_ID=8 RATE_LIMIT_REACHED=9
DUPLICATE_REQUEST=10 TOO_MANY_MESSAGES_TO_SHARE=11
```

Two of these are structural for a driver: **`MESSAGES_MUST_APPEAR_IN_PAIRS`** (hence the pair expansion in
§1) and **`TOO_MANY_SHARES_FOR_THIS_SESSION`** shown to the user as 「当前对话生成链接数达到上限」 — a
per-conversation cap, so **repeated create attempts on one chat will eventually hard-fail**.
`DeleteShareErrorCode` (OK=0, SHARE_NOT_FOUND=1, MULTIPLE_SHARES_DELETED=2) means cleanup is possible but
can fail on a stale id.

---

## 3. Observability of the resulting link (question 3)

| # | channel | how | reliability |
|---|---|---|---|
| **(c)** | **`POST /api/v0/share/create` response** | field is `biz_data.share_id`; URL = `new URL('/share/'+id, location.href).href` | **Best.** Exact, immediate, no DOM, no clipboard. Needs the plugin to observe the response: Playwright `page.on('response')`, or an `addInitScript` fetch/XHR hook installed *before* the click. The engine already owns the `page`, and its `logRequests` helper shows the pattern. |
| (a) | dialog DOM text | `document.querySelector('.ds-copyable-text-line__text').textContent` after the create resolves; the modal is `[role=dialog]` titled 创建分享链接 | Good and stable-ish (`.ds-copyable-text-line*` are semantic names present in the live CSS, not hashed like `_43d222b`). Must wait for the swap from button-footer → link-footer (state `l` set in `d(e)`), and must not confuse it with the earlier 反馈 modal. |
| (d) | route / history | **No.** `g6()` builds a string; nothing calls `navigate()` on create, so `/share/...` never enters history. It would only appear if the plugin itself navigated there. |
| (b) | `navigator.clipboard` | App auto-writes it (`autoCopy`), so it *should* hold the URL | **Weakest.** Needs clipboard read permission + focus/gesture; `writeText` is *explicitly* allowed to fail (`复制失败` toast is a designed state). Also races: the write is deferred with `setTimeout(…,0)` behind the create promise. Fine as a corroboration, not as the source of truth. |
| — | `GET /api/v0/share/list?count&lte_date` | returns newest-first-ish `shares[]`; client reads **only** `share_id, created_at, chat_session_id, hint` | Works as a **fallback/recovery**: the app's own manager does `listShares(20, lastCreatedAt)` and appends. **No `url`/`link` field** — you still build the URL from `share_id`. Needs a heuristic ("the newest entry that wasn't there before"), and `hint` may be a non-URL label in the UI (`children: e.hint || g6(e.shareId)`). |

**Most robust: (c) response body → `share_id` → build the URL.** It is the same value the app itself uses
(`createShare` returns exactly `n.data.biz_data.share_id`), it is available at the exact moment of success,
and it survives any DOM redesign. (a) is an acceptable second source; (b) is a nicety.

**What could not be established without creating one:** the real `shareId` format/length, whether the
create response is idempotent for a repeated identical request (`DUPLICATE_REQUEST=10` suggests not), and
the per-conversation cap value (`TOO_MANY_SHARES_FOR_THIS_SESSION` — the message says "reached the limit"
but never a number). None of these blocks a decision.

---

## 4. Is the link public? (question 4)

**Yes — viewable by anyone holding the link, with no login.** Three independent pieces of evidence:

1. The route table marks it public (offset ≈ 24 176):
   ```js
   "…","/a/:agentId":{isLogoutOnly:!1},"/a/:agentId/s/:sessionId":{isLogoutOnly:!1},
   "/mobile_verification":{isLogoutOnly:!0},"/share/:shareId":{isLogoutOnly:!1,public:!0},
   "/share/missing":{isLogoutOnly:!1,public:!0},"/share/invalid":{isLogoutOnly:!1,public:!0},"/":{isLogoutOnly:!1}
   ```
   `public:!0` is exactly the flag the session routes **do not** have.
2. The create dialog's own warning, `shareCreateLinkInform`:
   「**任何获得链接的人都可以查看你分享的对话**，请检查是否包含敏感或隐私内容。」
3. The viewer renders a **fake local session** from the share id, i.e. it does not need the account's own
   session list: `fetchShareContent` builds `fakeSession` with `id: (0,nh.aw)(t)`, `isHidden:!0`, and the
   viewer-only banner `shareContentWarning` 「该对话来自分享，由 AI 生成，请仔细甄别。」.

`GetShareContentErrorCode` shows the failure surface: `SHARE_DOES_NOT_EXIST=1`,
`SHARE_IS_DELETED_OR_BANNED=2`, `ORIGINAL_SESSION_DELETED=3` — i.e. a share dies when **deleted** or when
**its source chat is deleted**; there is no expiry error code (consistent with §2c: no 有效期 anywhere).

---

## 5. Cancellation and failure modes a driver must handle (question 5)

* **Entering the mode breaks per-message toolbars.** Confirmed by the prior probe (`07-diagnose.json`:
  clicks landed on the item, not a button) and structurally: while `selectedMessages` is active the row
  renders the checkbox wrapper `uN` instead of the action buttons. **Any control click must first assert
  the bar is gone** — the cheap test is `document.body.innerText.includes('创建分享链接')` (or the
  absence of `[role=button]` labelled 创建分享链接), as the prior probe's §10 recommends.
* **Escape does NOT exit the mode; 取消 does.** Confirmed by the prior probe. In the code the only exits
  are `exitSelection()` (the 取消 button, and `onFinish` of the dialog when a link exists) and
  `switchSession` (switching conversations also calls `exitSelection()`). A driver should press 取消 by
  *text*, not coordinate, and then re-verify.
* **Do not leave the bar open**: it is not a transient overlay — it persists across scrolling and
  virtualizer remounts, and it swallows the action row. This is the one state that will silently break
  every later engine step.
* **Create disabled without a selection**: `disabled:0===d` on 创建分享链接; and the confirm handler
  itself guards `if(!(n&&d>0))throw Error()`. Selection count `d` is messages, not groups — **the bar's
  own number is `Math.floor(d/2)`**, so parity matters: create always sends the pair-expanded id list.
* **While the create request is in flight** `o(loading)` is true and the dialog sets
  `closeOnEscapeKeydown:!o, closeOnMaskClick:!o` — a driver **cannot** cancel the dialog at that moment
  (the 创建并复制 button is `disabled:o`, `loading:o`). So create is effectively commit-on-click: after
  the click there is a window in which the only way out is to let it finish. Another reason to treat
  create as an irreversible action and to install the response listener **before** clicking.
* **Failure toasts are non-DOM-blocking** (`nC(...)` = a notification): 生成链接失败, 当前对话生成链接数达到上限,
  选择的消息过多…, 操作过于频繁…, 该消息不支持分享. A driver that watches only for the link field will hang on these;
  it must race "link present" against "error toast present" against a timeout.
* **Getting back to a clean page in every case:**
  1. bar open, no dialog → click 取消 (text) → assert bar gone and ≥6 action buttons resolvable again;
  2. dialog open, no link → `onCancel` (Esc/X/mask is *allowed* here because `o` is false) → back to the bar → then 取消;
  3. create succeeded, link shown → closing the dialog calls `onFinish` = `exitSelection()`, i.e. **closing the link dialog is itself the exit**;
  4. request in flight → wait it out; then case 2 or 3;
  5. anything unresolved → `page.reload()` is the last resort, and is safe: the mode lives only in the
     in-memory zustand store (`enterSelection`/`exitSelection` above), so a reload drops it with no
     server-side trace.
* **Recovery of a created-but-lost link.** If the driver clicks create and then loses the response, the
  id is recoverable without publishing anything new: `GET /api/v0/share/list` (newest entry) or
  「我共享的链接」, then `POST /api/v0/share/delete {share_id}` to undo. `DeleteShareErrorCode`
  `MULTIPLE_SHARES_DELETED=2` / `SHARE_NOT_FOUND=1` are the two "it was already gone" outcomes — both
  mean the cleanup is done.

---

## 6. Recommendation and cost estimate (question 6)

**Can a plugin drive 「select this one answer → create link → read it → cancel the mode」? Yes, and the
"read the link" step is NOT the weak part** — which is the opposite of what the question feared. The weak
part is **the side effect itself and its blast radius**, not observability.

* **Feasibility.** Each step is a small, deterministic DOM/API action, and the link is available from a
  machine-readable source (`biz_data.share_id`) plus a semantic-classed DOM field
  (`.ds-copyable-text-line__text`). No step needs coordinates or timing guesses. Cost: **~1–2 days** for a
  careful implementation (click by text/tooltip → assert bar → click 创建分享链接 → click 创建并复制 →
  read response/DOM → click the footer/取消 to exit → verify clean), of which most is the guard rails in §5.
  That is *cheaper* than the "copy the text" behaviour it would replace in terms of code, but *far* more
  expensive in consequence.
* **The real objection — and it is not technical.** 创建分享链接 **publishes a public, no-login URL for the
  user's private conversation to a real account** (`TOO_MANY_SHARES_FOR_THIS_SESSION` = it even accumulates).
  A plugin that does this behind one click, silently, is a privacy action, not a formatting convenience.
  The app's own warning is unambiguous: 「任何获得链接的人都可以查看你分享的对话，请检查是否包含敏感或隐私内容。」
  A DSH plugin has no business making that call implicitly; if implemented at all it needs an explicit,
  separate, clearly-labelled affordance (never a drop-in for 复制), and the URL should be shown to the user
  before/after with a delete path.
* **Two design notes if it proceeds.** (1) Prefer the **API response** over the clipboard or the DOM —
  install the listener before clicking; both `shareCreateLinkCopiedToast` and the designed 「复制失败」
  failure prove the clipboard is not a contract. (2) Treat every create as "one public URL exists"; never
  retry blindly (`DUPLICATE_REQUEST=10` suggests a duplicate guard, but the per-chat cap is real), and
  offer the `share/delete` cleanup for the ids you created. (3) Note the pair rule: selecting one answer
  shares the question too (`MESSAGES_MUST_APPEAR_IN_PAIRS`) — that is DeepSeek's model, and a plugin cannot
  share "just the answer".
* **What would change the answer:** not readability. If the goal is only "give me this answer's text",
  clipboard/复制 already does it with **zero** side effects; share only makes sense when the *public URL*
  is the desired product. So the decision is a product/privacy decision, not an engine-capability one.

---

## 7. What could NOT be established (without creating a share)

* The real `shareId` format/length — would require actually creating one.
* The exact `biz_data` response envelope beyond `share_id` (does it also return a `url`? the client only
  reads `share_id`, so any extra field is unproven and must not be relied on).
* The numeric cap behind `TOO_MANY_SHARES_FOR_THIS_SESSION` and the exact toast used for it.
* Whether `share/list` is strictly newest-first (the manager appends and dedupes by id with
  `(0,_8.A)(n,d,e=>e.shareId)`, which implies an ordered feed, but the ordering key is `created_at` and I
  did not observe a live response).
* The live rendered markup of the selection bar and of the link-dialog footer in **this** build
  (`_43d222b` etc.) — that came from the prior probe's build; I read the current build's code instead. The
  prior probe's DOM files remain the only live markup evidence.
* Anything about the viewer page (`/share/:id`) rendered live — I only read its route flags and strings.

## 8. Evidence files (all in `.tmp-probe-share/`)

| file | what it holds |
|---|---|
| `verify-bundle.mjs` | the reproducible, read-only prober: downloads the app shell, derives the current bundle names, downloads `main.*.js` + `main.*.css`, asserts all 19 code paths quoted above. Prints `ALL PROBES PASS`, exits non-zero otherwise |
| `verify-bundle.json` | its output: `commitId: f92f568b`, `mainJs: main.a6bd2c6c8d.js`, `bundleSha256: 6546b132…`, `missingI18nKeys: []`, 19/19 probes true |
| `main.a6bd2c6c8d.js` | the live bundle (1 555 103 B) all quotes are from — line numbers in this doc are **byte offsets** into it |
| `main.cda7a62066.css` | live stylesheet; confirms `.ds-copyable-text-line__text/__scroll/__action` |
| `default-vendors.3473f64207.js` | second bundle from the same commit, downloaded and searched (no share code) |
| `FINDINGS.md` | this file |

**Side effects: none.** No share created, no button pressed, no browser launched (plugin's `SingletonLock`
untouched, `engine: "ready"` before and after), nothing written outside `.tmp-probe-share/`. Only public
static assets and the app shell were fetched, over the CLI, with a browser UA; no cookies/tokens/auth
headers were used or recorded.
