# chat.deepseek.com — per-answer action row: live DOM probe

Probe date **2026-10-14** (Asia/Shanghai). Plugin **dsh-DSchat 0.8.1** (build 2026-10-12T10:38:22Z), `playwright-core` **1.64.0**, Node **v26.8.2**, browser **channel `chrome`**.

**How it was driven:** a standalone script (`probe-*.mjs`, this folder) launched
`chromium.launchPersistentContext('/Users/chenlin/.dsh/dsh-webchat/browser-profile', { channel: 'chrome', headless: true, viewport: null })`
— the same profile the plugin uses (`defaultProfileDirOf` prefers the legacy `~/.dsh/dsh-webchat/browser-profile`; data dir `~/.dsh/dsh-dschat`). There was **no SingletonLock** while the plugin engine was `stopped`, so the profile was free. **The plugin's own routes were not used**: `/wake` and `/close-browser` were never called, no DSH panel state was changed, and `GET /api/dsh-dschat/state` still reports `engine: "stopped", loggedIn: null` after the probe. Every browser context was closed by the script.

**Side effects on the account:** one 喜欢 on the newest answer (toggled off), one 喜欢 on an old answer (toggled off), one 不喜欢 (modal opened, then 取消), one 分享 (selection mode entered, then 取消). A final reload of both conversations showed **no like/dislike left set** (`11-verify-clean.json` → `CLEAN`). No message sent, none deleted/renamed. `重新生成`, `创建分享链接` and `提交` were **never pressed**. Only request **URL + method** were recorded; no request/response bodies, cookies, tokens or auth headers exist in any evidence file (verified by a secret-pattern scan).

---

## 0. TL;DR for the engine

* Controls are `div[role="button"].ds-button` — the site has **zero `<button>` elements**.
* They are **inside the per-message item** `[data-virtual-list-item-key]`, always in the DOM, hidden only by the row wrapper's **`opacity: 0`** (pointer-events stay `auto`).
* `data-virtual-list-item-key` is the **1-based ordinal of the message** in the open conversation (1,2,3…N) — resolve the control from the item with the intended key, never "the last row you find".
* Assistant row order is fixed: **0 复制 · 1 重新生成 · 2 喜欢 · 3 不喜欢 · 4 朗读 · 5 分享**.
* Only **朗读** has an `aria-label`; only **重新生成** has `aria-disabled`. Everything else is distinguishable only by position, the SVG path fingerprint, or a hover tooltip.
* Filter out buttons under `.ds-markdown` (code-block copy buttons are `div[role=button]` too and **shift the indices**).

---

## 1. DOM structure and per-control selectors

### Assistant item (one answer)

```html
<div data-virtual-list-item-key="6" class="_4f9bf79 d7dc56a8 _43c05b5">   <!-- 3 hashed classes, churn -->
  <div class="ds-message _63c77b1">
    <div class="ds-markdown ds-assistant-message-main-content"> …answer… </div>
  </div>
  <div class="ds-flex _0a3d93b" style="align-items: center; gap: 10px; flex-wrap: wrap-reverse;">
    <div class="ds-flex _965abe9 _54866f7" style="align-items: center; gap: 10px;">   <!-- THE ACTION ROW -->
      <div role="button" class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-l db183363" tabindex="0"> … </div>
      … 5 more, identical attributes …
    </div>
    <div></div>   <!-- empty, height 0 -->
  </div>
</div>
```

Each control, identical class list for all six (so classes are **not** a discriminator):

```html
<div role="button" class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-l db183363" tabindex="0">
  <div class="ds-button__background"></div>                        <!-- hover/pressed wash -->
  <div class="ds-button__icon ds-button__icon--last-child">
    <div class="ds-cross-fade">                                    <!-- present on some buttons only -->
      <div class="ds-icon" style="font-size: inherit;">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="…" fill="currentColor"></path></svg>
      </div>
    </div>
  </div>
</div>
```

* **Clickable wrapper = the outer `div[role="button"].ds-button`.** The `<svg>` is inside it; clicking the SVG bubbles to the wrapper (verified by a capture-phase click tracer: target was `svg`, action still fired).
* **No `data-*` attributes** on any control. **No `title`.** `aria-label` only on 朗读.
* `db183363` and the leading `_…`/`d7dc56a8` hashes churn per deploy; `ds-button*`, `ds-markdown`, `ds-message`, `role`, `tabindex`, `data-virtual-list-item-key` are the durable parts.

### The six controls (established by hover tooltips in 3 different conversations)

| idx | name (hover tooltip) | `role` | `aria-label` | `title` | `data-*` | `aria-disabled` | SVG paths (`d` length each — fingerprint) |
|---|---|---|---|---|---|---|---|
| 0 | 复制 | button | — | — | none | — | 1 × 2772 |
| 1 | 重新生成 | button | — | — | none | **`"false"`** (only control that has it) | 1 × 582 |
| 2 | 喜欢 | button | — | — | none | — | 1 × 2858 (outline) → after like **2 × 785,196** |
| 3 | 不喜欢 | button | — | — | none | — | 1 × 2854 |
| 4 | 朗读 | button | **朗读** | — | none | — | 3 × 1986,145,144 |
| 5 | 分享 | button | — | — | none | — | 1 × 894 |

Fingerprints reproduced identically in three conversations (6, 24 and 190 messages) → see `05-scan.json`.

### How the names were established

Hovering a control mounts a tooltip portal:

```html
<div class="ds-tooltip ds-tooltip--s ds-tooltip--tooltip ds-elevated ds-theme">复制</div>
```

inside `div.ds-floating-container` / `div.ds-floating-position-wrapper` (fixed, page-level). Selector `.ds-tooltip` (also matched by `[class*="tooltip"]`); `[role="tooltip"]` is **not** set on it. Text is the control name. The six names came out in the fixed order above in every conversation tested (`02-tooltips.json`, `05-scan.json`, `04-tooltips.json`).

### User row (for contrast — do not confuse the two)

```html
<div data-virtual-list-item-key="5" class="_9663006">                 <!-- different classes -->
  <div class="d29f3d7d ds-message _63c77b1"> …question… </div>
  <div class="_11d6b3a"><div class="_425ea0b">
    <div class="ds-flex _78e0558 _0bbda35">                            <!-- row (2 buttons) -->
      <div role="button" class="ds-button …">复制</div>                 <!-- 1 × 2772 -->
      <div role="button" class="ds-button …">修改</div>                 <!-- 1 × 1531 -->
    </div>
  </div></div>
</div>
```

`复制` / `修改` confirmed by tooltip (`13-user-tooltip.json`). The user "shown" modifier is `_0bbda35`; the assistant one is `_54866f7`.

---

## 2. Hover-only or always present?

**Always in the DOM while the item is mounted**; the gate is the row wrapper's **`opacity`** — not `display:none`, not `visibility:hidden`.

Measured on an old answer (`10-hover.json`):

| mouse | row `opacity` | row `class` | item `:hover` |
|---|---|---|---|
| parked at (1,1) | **0** | `ds-flex _965abe9` | false |
| over the answer body | **1** | `ds-flex _965abe9` (unchanged) | true |
| parked again | **0** | `ds-flex _965abe9` | false |

The **newest** turn's row is `opacity: 1` even with the mouse parked, and it additionally carries `_54866f7`:

```
key=24  opacity=1  class="ds-flex _965abe9 _54866f7"   ← newest answer, parked
key=4   opacity=0  class="ds-flex _965abe9"            ← old answer, parked
```

Other computed facts: `display:flex`, `visibility:visible`, `pointer-events:auto` on the row **and** on every button, in both states; each button's own `opacity` is always `1`. So the 0→1 is a pure CSS `:hover` effect on the item (same class list — no class swap). `opacity:0` does **not** block hit-testing: a raw coordinate click on an old answer's 喜欢 button at row-opacity 0 succeeded (`09-old-message.json`), and Playwright's `hover()`/`click()` turns the row visible on the way in.

**Location:** inside the item (`item.contains(button) === true`); there is no shared page-level toolbar for per-answer actions. Each mounted message row has its own toolbar. Checkboxes from share mode are the only thing injected per item later.

---

## 3. Identifying which message a control belongs to

* The item element itself carries **`data-virtual-list-item-key` = 1-based message ordinal** in the open conversation (6-message chat → keys 1..6; 24-message chat → 1..24; 190-message chat → up to 190). It is not a hash, and it is the only stable per-message identity in the DOM.
* The answer body and the toolbar are **not siblings of the row**: the body is `item > div.ds-message > div.ds-markdown.ds-assistant-message-main-content`, the row is `item > div.ds-flex._0a3d93b > div.ds-flex._965abe9`.
* Smallest reliable relative path (CSS, class-churn tolerant):
  `[data-virtual-list-item-key="<N>"] > div:last-child [role="button"]` → exactly **6** for an assistant item, **2** for a user item.
* Most robust, in-page (what the probe used):

```js
const item = document.querySelector(`[data-virtual-list-item-key="${key}"]`)
const btns = [...item.querySelectorAll('[role="button"]')].filter(b => !b.closest('.ds-markdown'))
// assistant: btns.length === 6 → [0]复制 [1]重新生成 [2]喜欢 [3]不喜欢 [4]朗读 [5]分享
```

* **Trap that shifts indices:** code blocks render copy buttons that are also `div[role="button"].ds-button` (class `ds-button--borderlessNeutral ds-button--borderless ds-button--capsule`) **inside `.ds-markdown`**. A reasoner answer with two code blocks had **4** of them, so a naive `item.querySelectorAll('[role="button"]')` returned **10** buttons with the code-copy buttons first. Always exclude `.ds-markdown` descendants (or use the `:scope > div:last-child` path above).
* Reasoning blocks do **not** break the order: `.ds-think-content` (class `e1675d8b ds-think-content`, parent `_74c0879`, **not** inside `.ds-markdown`) contained **0** clickable descendants, and its answer still exposed exactly the 6 controls in the same order (`05-scan.json`).

---

## 4. 喜欢 / 不喜欢 specifics (clicked, measured, undone)

**State signal is the icon only.** No `aria-pressed`, no `aria-checked`, no selected class, no `data-*`; the `class` attribute is byte-identical before and after. The like icon goes **1 path (2858) → 2 paths (785,196)** = outline → filled.

| action | request | DOM change |
|---|---|---|
| click **喜欢** (row[2]) | `POST https://chat.deepseek.com/api/v0/chat/message_feedback` | icon → 2 paths (filled) |
| click **喜欢** again | same `POST /api/v0/chat/message_feedback` | icon → 1 path (outline) — **yes, a toggle that clears it** |
| click **不喜欢** (row[3]) | **none** | opens the 反馈 modal; dislike icon unchanged (2854) |
| click **不喜欢** again | none | nothing — the second click hits the open modal's overlay; **not** a toggle |
| 取消 in the modal | none | modal closes, no row change |

* The `ds-button__background` colour difference I first saw (`rgba(0,0,0,0)` → `rgba(38,49,72,0.06)`) was **hover**, not state: with the mouse parked it is not a marker. Use the icon shape.
* **Per-message isolation proven** (`09-old-message.json`): with the mouse parked and row-opacity 0, clicking 喜欢 on **old key=4** produced the POST and changed **only key=4** (`2858 → 785,196`); keys 6, 8, 10, 12 stayed `2858`, and the newest answer (key=24) stayed `2858`. Clicking again returned key=4 to `2858`.
* **Persistence check:** after the like → unlike, a fresh page load showed the outline icon, and a final sweep of every mounted row in both touched conversations found **zero** filled like/dislike icons → the account was left clean.

### 不喜欢 opens a reason form (did open; 提交 never pressed)

```
div.ds-modal-overlay
└─ div.ds-theme.ds-modal-wrapper
   └─ div.ds-modal > div.ds-modal-focus-lock
      └─ div.ds-modal-content.ds-elevated.ds-modal-content--dialog[role="dialog"]      "反馈"
         ├─ div.ds-modal-content__header-wrapper > div.ds-modal-content__title           "反馈"
         ├─ div.ds-modal-content__main > div._74d6322
         │  ├─ div.ds-radio-button-group.ds-radio-button-group--bordered1[role="radiogroup"]
         │  │  └─ label.ds-radio-button ×4
         │  │       └─ input.ds-radio-button__input[type="radio"]   (no aria-checked / checked attr)
         │  │       options: 有害/不安全 · 虚假信息 · 没有帮助 · 其他
         │  └─ div.ds-textarea.ds-textarea--bordered…
         │       └─ textarea.ds-textarea__textarea
         │            placeholder="我们想知道你对此回答不满意的原因，你认为更好的回答是什么？"
         └─ div.ds-modal-content__footer > div.ds-modal-content__button-group
            ├─ div[role="button"].ds-button.ds-button--outlinedNeutral…  "取消"
            └─ div[role="button"].ds-button.ds-button--primary…          "提交"
```

* Opening the modal, selecting a radio (没有帮助) and pressing 取消 all produced **no network request**.
* 取消 closed the modal and left the row untouched (icon still `2854`).
* **提交 was deliberately not pressed**, so the dislike-side request is unconfirmed (the like side proves `/api/v0/chat/message_feedback` exists; `08-summary.json`, `08-dislike-modal.json`).

---

## 5. 重新生成 — NOT PRESSED

I did **not** click 重新生成 on any real conversation (per the constraint). What is established:

* Identity: row index **1**, hover tooltip **重新生成**, and it is the **only** control carrying `aria-disabled` (value `"false"`, i.e. enabled) on this page version.

Consequently **not measured**: in-place vs append, the request it issues, whether `data-virtual-list-item-key` changes, and whether the old answer stays mounted.

Secondary evidence only (plugin source, i.e. the author's own observation of the web app — **not** my measurement):

* `docs/design-v0.5-ui.md` merge table: “网页端重新生成过某条回答 → 整体替换 → 原地换成网页的文本，id 仍是本地的，不会出现两条”.
* `src/store.ts` (`mergeHistory` comment): a regenerated reply is “the question is unchanged and is therefore an anchor of its own, leaving a stretch of ASSISTANT messages that share nothing”, settled “in place”; “a regenerated answer does not appear twice”.
* `src/engine/engine.ts` (`streamCaptureInit`): the page reads replies from `POST /api/v0/chat/completion` (SSE), so a regeneration most likely reuses that endpoint — unverified.

Treat "in place" as *likely but not proven by this probe*.

---

## 6. 分享 — it is a selection mode, not a menu

**Clicked once, then cancelled. `创建分享链接` was never pressed.**

* It does **not** open a menu, does **not** open a dialog, does **not** copy anything. It puts the page into a message-selection ("share") mode. **No network request** on entry.
* A bottom bar appears:

```
div._43d222b                                        ← the bar (found by text 创建分享链接)
  └─ (ancestors: div._765a5cd > div._7780f2e, height 513)
     div._9f86274
       ├─ div.ds-checkbox-wrapper.ds-checkbox-wrapper--l._692accd > div.ds-checkbox-label   "全选"
       ├─ span.dcaa34cd                                                                     "已选择 1 组对话"
       └─ div.fab07e97
          ├─ div[role=button].ds-button.ds-button--outlinedNeutral.ds-button--outline       "取消"
          └─ div[role=button].ds-button.ds-button--primary.ds-button--filled                "创建分享链接"
```

* Clicking an answer's 分享 auto-selects **1 组对话** (one answered turn). Per-message checkboxes are injected **inside each mounted item**: `div.ds-checkbox-align-wrapper > div.ds-checkbox.ds-checkbox--l.ds-checkbox--active.ds-checkbox--none` (the `--none`/selected modifier did not change between the two items in the snapshot; the bar's `已选择 N 组对话` text is the reliable count).
* **Escape does not exit** this mode (bar still present afterwards); the bar's **取消** does. After 取消 the bar is gone and **no request had been made**.
* **While this mode is active the per-message toolbars are gone/unclickable** — my later clicks landed on the item element instead of a button. Any engine that clicks controls must first ensure this bar is absent (`08-share-mode.png`, `07-diagnose.json`).
* **Link shape** (read from the page's own JS bundle, read-only, no link created): share API endpoints found → `/api/v0/share/create`, `/api/v0/share/content`, `/api/v0/share/list`, `/api/v0/share/delete`, `/api/v0/share/fork`; SPA route templates found → `"/share/:shareId"`, `"/share/missing"`, `"/share/invalid"`. So a share link is **`https://chat.deepseek.com/share/<shareId>`** — *not* the `/a/chat/s/<uuid>` conversation URL. The exact id format was not confirmed because I did not create a share.

---

## 7. Virtualization and reaching an OLD answer's control row

* The scroller is the **only** element on the page with `overflow-y: auto` and `scrollHeight > clientHeight`:
  `div.ds-virtual-list.ds-virtual-list--printable.ds-scroll-area.ds-scroll-area--show-on-focus-within.ds-scroll-area--enabled._2bd7b35`
  → `document.querySelector('.ds-virtual-list')` (the trailing class is hashed). Its client height was 453px in the headless window.
* Only rows near the scroll position are mounted:
  * 190-message chat, at the bottom: **2** mounted rows (keys 189, 190).
  * after `scrollTop = 0`: **10** mounted rows (keys 1..10) and `scrollHeight` grew 27853 → 41547 as older pages loaded.
  * 24-message chat: 2 → 10 rows, `scrollHeight` 5469 → 16490.
* This matches the existing walker comment in `src/engine/engine.ts` (~line 2405: “only the rows near the viewport exist in the DOM … a 16-message conversation had exactly 2 rows mounted”) and its top-down `harvestConversation` walk (top anchor pages in the oldest messages, then walk downward). **Implication for clicking:** the control row exists **only while its item is mounted**, so the engine must bring the target message into the mounted window before querying. `scrollIntoViewIfNeeded()` on the control (or the item) reliably re-mounts it — verified: the old item was not in view, the handle resolved `null`→`scrollIntoViewIfNeeded()`→item mounted→button found and clicked.
* Never click “the row you happen to find”: resolve the row from the item that carries the intended `data-virtual-list-item-key`, after ensuring it is mounted. Absolute-coordinate clicking without resolving the item is unsafe because the mounted window shifts with scroll.

---

## 8. What could NOT be established

* 重新生成 behaviour (in-place vs append, its request, virtualizer key change) — **not pressed** (see §5).
* The real share link / `shareId` — `创建分享链接` **not pressed** (creates a real share).
* The dislike-side request — `提交` **not pressed** (writes feedback to the account).
* 复制 semantics (which text lands on the clipboard) — not clicked; identified conclusively by hover tooltip instead.
* 朗读 behaviour — not clicked.
* Server-side feedback field names/values — request **bodies were never read or stored**.
* The literal hover CSS rule: stylesheet access returned nothing usable (cross-origin/hashed), so the 0↔1 opacity behaviour is established from computed styles, not from a rule text.

---

## 9. Evidence files (all in `.tmp-probe-actions/`)

| file | what it holds |
|---|---|
| `probe-lib.mjs` | shared launch/redaction/request-logger/collector helpers |
| `probe-1-recon.mjs`, `01-recon.json`, `01-assistant-item.html` | first full dump: rows, controls, parent groups, DOM tree; full `outerHTML` of one assistant item |
| `probe-2-identify.mjs`, `02-buttons.json`, `02-tooltips.json`, `02-visibility.json`, `02-row-hover.png`, `02-row-nohover.png`, `02-page.png` | per-button attribute/SVG dump; the hover tooltips that name all six controls; row visibility chain |
| `probe-3-structure.mjs`, `03-parked.json`, `03-hovered-body.json`, `03-aria-after-hover.json`, `03-scrolled-up.json`, `03-scrolled-up.png` | parked vs hovered vs scrolled-up row state; proves hover does not add ARIA |
| `probe-4-semantics.mjs`, `04-semantics.json`, `04-tooltips.json`, `04-css-rules.json`, `04-final.png` | first like/unlike + dislike modal + blocked share click; request log |
| `probe-5-scan.mjs`, `05-scan.json`, `05-scan.log` | cross-conversation scan (6/24/190 msgs): button counts, fingerprints, think block, markdown buttons, virtualization |
| `probe-6-share.mjs`, `06-fresh-state.json`, `06-share.json`, `06-dislike-modal.json`, `06-semantics.json`, `06-final.png` | proof the earlier like was cleared on fresh load; the run where share mode silently blocked later clicks |
| `probe-7-diagnose.mjs`, `07-diagnose.json`, `07-share-after-*.png`, `07-dislike-after-mouse-click.png` | click-event tracer that proved clicks landed on the item, not the button |
| `probe-8-share-mode.mjs`, `08-share-bar.json`, `08-dislike-modal.json`, `08-summary.json`, `08-share-mode.png`, `08-dislike-modal.png`, `08-dislike-reason.png` | full share-mode bar + checkboxes; full 反馈 modal outline; bundle endpoint/route discovery |
| `probe-9-old-message.mjs`, `09-old-message.json` | like/unlike on an OLD answer while the newest stays untouched (per-message isolation) |
| `probe-10-hover.mjs`, `10-hover.json` | parked 0 → hover 1 → parked 0; newest always 1 |
| `probe-11-verify-clean.mjs`, `11-verify-clean.json` | final sweep: no like/dislike left set |
| `probe-12-user-row.mjs`, `12-user-row.json`, `12-row-sample.json` | item children overview; row `outerHTML` with `path d` collapsed |
| `probe-13-user-tooltip.mjs`, `13-user-tooltip.json`, `13-user-row.png` | user row = 复制 / 修改 |

---

## 10. Concrete guidance for the click implementation

```js
// 1) ensure the target message is mounted (scroll the single virtual list)
const scroller = await page.$('.ds-virtual-list')
// resolve the item; if null, scroll toward its ordinal and retry

// 2) read the action row OUT of that item, excluding markdown-inner buttons
const buttons = await page.evaluateHandle(key => {
  const item = document.querySelector(`[data-virtual-list-item-key="${key}"]`)
  if (!item) return null
  const btns = [...item.querySelectorAll('[role="button"]')].filter(b => !b.closest('.ds-markdown'))
  return btns.length === 6 ? btns : null        // assistant row only
}, key)

// 3) hover then click the exact element (hover also raises row opacity 0 -> 1)
const el = buttons.asElement()
await el.hover()          // or page.mouse.move to its box
await el.click()
```

Guard rails that cost nothing and prevent the failure modes seen in this probe:

* Assert the resolved row has **6** buttons before index mapping; if 6 does not hold, fall back to matching the SVG fingerprint (path-count + `d` lengths) or hover for the tooltip text.
* If 重新生成 must be identified without pressing it: it is the row member with an `aria-disabled` attribute, or the one whose hover tooltip is 重新生成.
* **Never act while the share bar is present** (`div._43d222b` containing 创建分享链接; check `document.body.innerText.includes('创建分享链接')`): per-message toolbars are unavailable then; press the bar's 取消 first.
* Expect `div[role="button"]`, never `<button>` (0 `<button>` on the page).
* Do not key off hashed classes (`_965abe9`, `_54866f7`, `_0a3d93b`, `db183363`, `d7dc56a8` …) or hashed item classes; use `role`, `ds-*` semantic classes, `.ds-markdown`, `data-virtual-list-item-key` and structural paths.
