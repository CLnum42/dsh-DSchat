/**
 * dsh-DSchat panel stylesheet.
 *
 * Every colour is a harness theme token (`--dsw-*`) so the panel follows the
 * active light/dark palette and skins; the only literal colours are the
 * artwork gradients. Class names are prefixed `dsh-dschat` and scoped under
 * the panel root, so nothing here can reach the rest of the UI.
 *
 * The layout follows the host's own page composition: a 52px header row with a
 * hairline, a left list column, a centered readable message column, and a
 * composer card with the radius scale from the host's base sheet.
 */

export const PANEL_CSS = `
.dsh-dschat {
  --dschat-radius-sm: var(--dsw-radius-sm, 8px);
  --dschat-radius-md: var(--dsw-radius-md, 12px);
  --dschat-radius-lg: var(--dsw-radius-lg, 16px);
  --dschat-radius-xl: var(--dsw-radius-xl, 20px);
  --dschat-mono: var(--dsw-font-family-code, ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace);
  /*
   * Material for every floating surface (menus, hover toolbars, toasts).
   *
   * alias-bg-overlay is NOT a floating-surface token: it is opaque #e9ecf2
   * in light mode but opaque #61666b in dark mode, so a menu painted with it
   * became a light grey slab on the dark panel — the reported "太白了".
   * specific-menu is the token the host itself paints menus with, and it
   * already carries the platform branch (darwin: near-opaque #f8f9faf0 /
   * #303136f0). The fallbacks apply only if that token is missing.
   */
  --dschat-surface: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2));
  --dschat-surface-border: var(--dsw-alias-border-l1);
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font-size: 14px;
  line-height: 1.6;
}

.dsh-dschat *, .dsh-dschat *::before, .dsh-dschat *::after { box-sizing: border-box; }
.dsh-dschat button { font: inherit; color: inherit; }

/* ---------- scrollbars ---------- */
.dsh-dschat-scroll { scrollbar-gutter: stable; }
.dsh-dschat-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.dsh-dschat-scroll::-webkit-scrollbar-track { background: transparent; }
.dsh-dschat-scroll::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2); border-radius: 99px;
  border: 2px solid transparent; background-clip: padding-box;
}
.dsh-dschat-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2); background-clip: padding-box;
}

/* ---------- header ---------- */
/*
 * Leading clearance.
 *
 * The macOS desktop window is titleBarStyle "hiddenInset" with the traffic
 * lights at x=16: they float OVER the page, in the top-left corner. While the
 * sidebar is expanded the shell's own 280px column happens to push every center
 * panel clear of them, so a plugin header with a flat 14px inset looked right.
 * Collapse the sidebar and that column goes to 0px — the panel starts at the
 * window edge and its rail toggle, brand mark and brand name were painted
 * underneath the traffic lights; the shell's own window-chrome controls (the
 * shell.leading seat: 打开侧边栏 + 新建会话, 88px..152px at y=11..39) landed on
 * the brand name as well. That is the reported "侧边栏收起后按钮不兼容".
 *
 * The shell reserves the band with --dsh-frame-leading-clearance, set on the
 * frame ONLY while [data-sidebar-collapsed] is on (160px, 84px in fullscreen,
 * undefined on Windows/Web where a real title bar owns that space). Its own
 * Conversation header consumes it as max(0px, clearance - 20px) on a row that
 * already carries a 20px inline padding, i.e. its content starts exactly at the
 * clearance edge. Reading the same variable puts this header on that same edge
 * in every window state, including fullscreen, and the 0px fallback keeps the
 * original 14px whenever the shell sets no chrome band at all — so nothing
 * changes on Web, Windows, or an expanded macOS sidebar. Measured on the live
 * GUI with the sidebar collapsed: header padding-inline-start 14px -> 160px,
 * first control at x=160, clearing the light strip (ends ~80px) and the
 * shell's leading seat (ends 152px). Expanded stays 14px, collapsed fullscreen
 * resolves to the shell's own 84px.
 *
 * Drag region. The header and the brand block carry the shell's own
 * data-window-drag hook, which its stylesheet turns into
 * '-webkit-app-region: drag' on darwin
 * (html[data-platform=darwin] [data-window-drag]{-webkit-app-region:drag}).
 * Without it this panel — a full-width seat at the very top of the window —
 * covered the only strip the user could grab, so the title bar looked blank and
 * double-clicking it did not maximise the window. NO CSS FOR THIS BELONGS HERE:
 * the rule must stay in the shell's sheet, because a plugin sheet that wins the
 * cascade would put drag on the header's buttons too. The shell's blanket
 * rule — every button, a, input, select and textarea is no-drag — is what keeps
 * the controls clickable, and it only exists in the shell's sheet.
 */
.dsh-dschat-header {
  flex: none; height: 52px; display: flex; align-items: center; gap: 8px;
  padding-block: 0;
  padding-inline: max(14px, var(--dsh-frame-leading-clearance, 0px)) 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
/*
 * The header is one nowrap row with no wrap point, so a window too narrow for
 * it must take the space from somewhere instead of pushing the right-hand
 * actions off the edge. The spacer — the run of empty, draggable space — gives
 * up its width first, and it is the only thing that can: everything else in the
 * row is a control the reader needs. The status sentence that used to ellipsize
 * here is a tooltip now, so there is nothing left to truncate.
 */
/*
 * The header's product mark, and the panel's state lamp.
 *
 * It replaced the panel name and a status chip. The NAME was redundant — the
 * sidebar row and the document title already say DSchat, and this was the third
 * copy. The CHIP was worse than redundant: 「● 已就绪 · deepseek-reasoner」 was
 * drawn at the window controls' own height and radius, one gap away from them,
 * so it read as a fourth button in that row and did nothing when clicked.
 *
 * The colour is therefore not decoration, it is the whole readout:
 *
 *   grey   nothing is running (or the browser is up but nobody is signed in)
 *   blue   the web engine is usable — 「已就绪」
 *   amber → red while it settles into a usable/unusable state
 *   red    the engine reported an error, which must NOT look like a plain stop
 *
 * The stale chip's sentence survives as this button's tooltip, and as its
 * accessible name, so the state is never carried by colour alone.
 *
 * A fixed box in every state — same width, same height, same glyph — so the
 * three controls beside it never shift by a pixel when the engine changes
 * state. That was the one real hazard of putting a live indicator in a toolbar.
 */
.dsh-dschat-whale {
  width: 30px; height: 30px; flex: none; display: grid; place-items: center;
  border: none; border-radius: 8px; background: transparent; cursor: pointer;
  color: var(--dsw-alias-state-idle-primary);
}
.dsh-dschat-whale:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-dschat-whale[data-phase="ready"] { color: var(--dsw-alias-state-business-primary); }
.dsh-dschat-whale[data-phase="launching"] { color: var(--dsw-alias-state-warn-primary); }
.dsh-dschat-whale[data-phase="need-login"] { color: var(--dsw-alias-state-warn-primary); }
.dsh-dschat-whale[data-phase="error"] { color: var(--dsw-alias-state-error-primary); }
/*
 * Busy states breathe instead of changing colour: "working" is motion, not a
 * different condition, and a third blue would be indistinguishable from ready.
 * Opacity only — an animated transform on the mark would resize the toolbar row
 * every frame while a reply streams.
 */
.dsh-dschat-whale[data-phase="thinking"],
.dsh-dschat-whale[data-phase="streaming"] { color: var(--dsw-alias-state-business-primary); }
.dsh-dschat-whale[data-phase="thinking"] svg,
.dsh-dschat-whale[data-phase="streaming"] svg { animation: dsh-dschat-breathe 1.6s ease-in-out infinite; }
@keyframes dsh-dschat-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) {
  .dsh-dschat-whale svg { animation: none !important; }
}
.dsh-dschat-spacer { flex: 1; min-width: 8px; }

/*
 * The header's window controls: 会话列表 / 搜索 / 新建对话.
 *
 * The web app's own header buttons, measured on the live page: a 34px square,
 * a 16px glyph, a secondary/tertiary grey label, and a hover wash that is the
 * only thing marking it as a button until you touch it. Same shape here, so the
 * three controls read as top-level chrome rather than as three more entries in
 * the panel's button family (which is what a 28px labelled button would have
 * said).
 *
 * The pressed state ('.dsh-dschat-hbtn-on') is the web app's own "selected"
 * tint: a light accent wash with an accent glyph, NOT the raised-fill
 * treatment, so it stays legible in both themes.
 */
.dsh-dschat-hbtns { display: flex; align-items: center; gap: 2px; flex: none; }
/*
 * The hairline that used to sit between the window controls and the panel's
 * status chrome is GONE with the chrome: it existed to stop the three glyph
 * buttons blending into the status pill that trailed them, and that pill is now
 * a tooltip on the whale. A divider with nothing on the far side separates
 * nothing.
 */
.dsh-dschat-hbtn {
  width: 34px; height: 34px; flex: none; display: grid; place-items: center;
  border: none; border-radius: 8px; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-hbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-dschat-hbtn:disabled { opacity: .5; cursor: not-allowed; background: transparent; }
.dsh-dschat-hbtn-on {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 13%, transparent);
  color: var(--dsw-alias-state-business-primary);
}
.dsh-dschat-hbtn-on:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent);
  color: var(--dsw-alias-state-business-primary);
}
/* ---------- buttons ---------- */
.dsh-dschat-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
  border-radius: var(--dschat-radius-sm); cursor: pointer; white-space: nowrap; font-size: 13px;
  border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
/*
 * One dimming rule for every variant. 0.5 rather than 0.4 because most of
 * these buttons also carry a tinted fill, and the measure in a real browser
 * put the label at 2.5:1 when the tint and the dimming were stacked; at 0.5
 * the label lands near 3:1 and still reads as clearly inactive.
 */
.dsh-dschat-btn:disabled { opacity: .5; cursor: not-allowed; background: transparent; }
.dsh-dschat-btn-icon { width: 28px; padding: 0; justify-content: center; }
/*
 * The primary button speaks the SAME colour scheme as the 深度思考 / 联网
 * toggles, on purpose: in the composer these sit side by side, and the toggle
 * pair is the visual language of "this panel's accent".
 *
 * button-primary-fill resolves to brand-primary, which flips per theme:
 * near-white #f9fafb in dark mode, near-black in light mode. In dark mode that
 * made the button — and the menu it opens — the brightest thing on the panel,
 * the reported "太白了". Both ends of that family are inverted relative to the
 * accent, so no pairing of primary-fill / primary-hover / primary-dimmed with
 * label-primary-foreground can stay on the blue accent in both themes.
 * state-business-primary IS the accent (#4176e6 light, #7aaaff dark): tinting
 * it over whatever is behind it is one rule that is correct in both themes.
 */
.dsh-dschat-btn-primary {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 13%, transparent);
  color: var(--dsw-alias-label-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent);
  font-weight: 500; height: 30px; padding: 0 12px; border-radius: var(--dschat-radius-md);
}
.dsh-dschat-btn-primary:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent);
  color: var(--dsw-alias-label-primary);
}
/*
 * Disabled keeps the hue (a faint wash, so the button still reads as "the
 * transfer button") and dims the label. It must NOT use
 * button-primary-dimmed: that token is a light grey in light mode and a dark
 * grey in dark mode, i.e. the same inverted family as the fill above.
 *
 * Specificity note — .dsh-dschat-btn:disabled (0,2,0) beats both the variant
 * class (0,1,0) and the blanket .dsh-dschat button rule (0,1,1), so the dimmed
 * label really does win here.
 */
.dsh-dschat-btn-primary:disabled {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent);
  cursor: not-allowed;
}
.dsh-dschat-btn-ghost { border-color: var(--dsw-alias-border-l2); }
/* ---------- body: rail + chat ---------- */
.dsh-dschat-body { flex: 1; min-height: 0; display: flex; position: relative; }
/*
 * The conversation list.
 *
 * Its width is a user setting, applied inline by the panel (238px default, see
 * RAIL_WIDTH_DEFAULT), so this rule carries only the fallback — a panel whose
 * width state somehow never arrives still lays out.
 *
 * Collapsed is not a state of this element: the panel drops the subtree
 * entirely (see 'rail()'), because a zero-width column would keep its resize
 * strip and its tab stops on screen. So there is nothing here to animate, and
 * nothing here to hide.
 */
.dsh-dschat-rail {
  position: relative; width: 238px; min-width: 0; flex: none; min-height: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--dsw-alias-border-l1); padding: 10px 8px 8px;
}
/*
 * The drag handle. A 7px strip straddling the border, because a 1px target is
 * not a target; it is invisible until the pointer is on it, so the panel keeps
 * the hairline it had. touch-action:none is what makes a pointer drag work
 * on a trackpad/touch surface instead of being read as a scroll.
 */
.dsh-dschat-rail-resize {
  position: absolute; top: 0; bottom: 0; right: -4px; width: 7px; z-index: 5;
  cursor: col-resize; touch-action: none; background: transparent;
  transition: background .12s ease;
}
.dsh-dschat-rail-resize:hover,
.dsh-dschat-rail-resize:focus-visible,
.dsh-dschat-rail[data-resizing="true"] .dsh-dschat-rail-resize {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent);
  outline: none;
}
/*
 * While a drag is in flight the pointer is somewhere over the transcript, so
 * the resize cursor and the text-selection block belong to the whole panel —
 * otherwise the drag selects the conversation titles it passes over.
 */
.dsh-dschat[data-rail-drag="true"] { cursor: col-resize; user-select: none; }
.dsh-dschat-search { position: relative; margin: 0 2px 8px; }
.dsh-dschat-search input {
  width: 100%; height: 30px; padding: 0 30px 0 28px; font: inherit; font-size: 13px; outline: none;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dschat-radius-sm);
}
.dsh-dschat-search input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dsh-dschat-search input:focus { border-color: var(--dsw-alias-border-l3); }
.dsh-dschat-search > svg { position: absolute; left: 8px; top: 8px; opacity: .5; pointer-events: none; }
/*
 * The clear affordance, shown only while there is something to clear. It sits
 * on the input's own right padding (30px, above) so the text never runs under
 * it, and it is a real button rather than a click handler on the box: clearing a
 * filter is an action, and it has to be reachable from the keyboard.
 */
.dsh-dschat-search-clear {
  position: absolute; right: 4px; top: 4px; width: 22px; height: 22px;
  display: grid; place-items: center; border: none; border-radius: 6px;
  background: transparent; cursor: pointer; color: var(--dsw-alias-label-tertiary);
}
.dsh-dschat-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-dschat-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 1px; padding: 2px; }
.dsh-dschat-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 8px;
  border-radius: var(--dschat-radius-sm); cursor: pointer;
}
.dsh-dschat-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-dschat-item[data-active] { background: var(--dsw-alias-interactive-bg-active); }
.dsh-dschat-item-main { min-width: 0; flex: 1; }
.dsh-dschat-item-title {
  font-size: 13px; color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-dschat-item[data-active] .dsh-dschat-item-title { font-weight: 600; }
.dsh-dschat-item-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dsh-dschat-item-acts { display: none; gap: 2px; flex: none; }
.dsh-dschat-item:hover .dsh-dschat-item-acts { display: flex; }
.dsh-dschat-mini {
  width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; cursor: pointer;
  border: none; background: transparent; color: var(--dsw-alias-label-tertiary);
}
.dsh-dschat-mini:hover { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
.dsh-dschat-mini-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.dsh-dschat-rail-foot {
  flex: none; display: flex; padding: 6px 2px 0; margin-top: 6px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-dschat-hint-empty { padding: 14px 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }

/* ---------- chat column ---------- */
.dsh-dschat-chat { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.dsh-dschat-thread { flex: 1; min-height: 0; overflow: auto; padding: 22px 0 8px; }
.dsh-dschat-thread-inner {
  max-width: 760px; margin: 0 auto; padding: 0 26px;
  display: flex; flex-direction: column; gap: 20px;
}
.dsh-dschat-day { text-align: center; font-size: 11px; color: var(--dsw-alias-label-tertiary); }

.dsh-dschat-msg { display: flex; flex-direction: column; gap: 6px; position: relative; }
/*
 * The search-landing mark.
 *
 * A negative-margin ring rather than a background, because the row's own block
 * is full-bleed: several messages sit inside full-width containers, so painting
 * the row's background would draw a bar across the whole transcript instead of
 * around the one message that matched. The inset and radius keep the ring just
 * outside the content, and the animation fades it without a second state — the
 * panel removes the class on a timer, so this only has to look right on its way
 * out.
 */
.dsh-dschat-msg-jump {
  border-radius: var(--dschat-radius-md);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);
  animation: dsh-dschat-jump 1.8s ease-out forwards;
}
@keyframes dsh-dschat-jump {
  0% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent); }
  100% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-business-primary) 0%, transparent); }
}
.dsh-dschat-msg[data-role="user"] { align-items: flex-end; }
.dsh-dschat-msg-head { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-dschat-msg[data-role="user"] .dsh-dschat-msg-head { flex-direction: row-reverse; }
.dsh-dschat-msg-who { font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-dschat-msg-body { font-size: 14px; line-height: 1.72; min-width: 0; }
/* The bubble's width cap lives on the wrapper, so it is a share of the MESSAGE
   width rather than of a shrink-to-fit parent (which would be circular). */
.dsh-dschat-msg[data-role="user"] .dsh-dschat-msg-line { max-width: 78%; }
.dsh-dschat-msg[data-role="user"] .dsh-dschat-msg-body {
  max-width: 100%; padding: 10px 14px; border-radius: var(--dschat-radius-lg);
  border-bottom-right-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover); border: 1px solid var(--dsw-alias-border-l1);
}
.dsh-dschat-msg-body > div > *:first-child { margin-top: 0; }
.dsh-dschat-msg-body > div > *:last-child { margin-bottom: 0; }
.dsh-dschat-msg-body p { margin: 0 0 10px; }
.dsh-dschat-msg-body ul, .dsh-dschat-msg-body ol { margin: 0 0 10px; padding-left: 22px; }
.dsh-dschat-msg-body li { margin: 3px 0; }
.dsh-dschat-msg-body li::marker { color: var(--dsw-alias-label-tertiary); }
.dsh-dschat-msg-body strong { font-weight: 600; }
.dsh-dschat-msg-body em { font-style: italic; }
.dsh-dschat-msg-body code {
  font-family: var(--dschat-mono); font-size: .875em; padding: 1px 5px; border-radius: 6px;
  background: var(--dsw-alias-markdown-inline-code);
}
.dsh-dschat-msg-body a { color: var(--dsw-alias-link); text-decoration: none; }
.dsh-dschat-msg-body a:hover { text-decoration: underline; }
.dsh-dschat-msg-body blockquote {
  margin: 0 0 10px; padding: 2px 0 2px 12px; color: var(--dsw-alias-label-secondary);
  border-left: 2px solid var(--dsw-alias-border-l3);
}
.dsh-dschat-msg-body h1, .dsh-dschat-msg-body h2, .dsh-dschat-msg-body h3,
.dsh-dschat-msg-body h4, .dsh-dschat-msg-body h5, .dsh-dschat-msg-body h6 {
  margin: 14px 0 8px; font-weight: 600; line-height: 1.4;
}
.dsh-dschat-msg-body h1 { font-size: 18px; } .dsh-dschat-msg-body h2 { font-size: 16px; }
.dsh-dschat-msg-body h3 { font-size: 15px; } .dsh-dschat-msg-body h4,
.dsh-dschat-msg-body h5, .dsh-dschat-msg-body h6 { font-size: 14px; }
.dsh-dschat-msg-body hr { border: none; border-top: 1px solid var(--dsw-alias-border-l1); margin: 14px 0; }
/*
 * The reasoning disclosure.
 *
 * A button-and-body pair rather than a details/summary element: the browser's own
 * marker, type scale and open/close animation are not themeable, and the line
 * the reader wants there is not the engine's 「思考过程」 but the panel's own
 * 「已思考（用时 1 分 12 秒）」. The engine still STORES the reasoning inside a
 * details wrapper (that is the transcript format); the panel splits it off
 * and renders it here, so no details element ever reaches the DOM.
 *
 * While the thought is LIVE ('[data-live="true"]') the row is the running
 * commentary instead of a summary: the accent tint marks it as in-progress, and
 * the header swaps its label for the {@link ThinkingLive} line. The accent is
 * 'label-deep-diving', the harness's own token for "a model is reasoning right
 * now" — the same colour the shell paints its own thinking indicator with.
 */
.dsh-dschat-think {
  margin: 0 0 10px; border-radius: var(--dschat-radius-md); overflow: hidden;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
}
.dsh-dschat-think[data-live="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-2));
}
.dsh-dschat-think-head {
  display: flex; align-items: center; gap: 7px; width: 100%; padding: 7px 10px;
  border: none; background: transparent; cursor: pointer; text-align: left; font-size: 12.5px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-think-head:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-dschat-think-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/*
 * The live line: 「思考中：」 + the newest characters of the reasoning, on ONE line.
 *
 * Three boxes, and each one is load-bearing:
 *
 *   .dsh-dschat-think-live       the flex row that owns the free width
 *   .dsh-dschat-think-live-prefix  the fixed 「思考中：」, never scrolled, never cut
 *   .dsh-dschat-think-live-clip  the clip window (overflow hidden, one line)
 *   .dsh-dschat-think-live-tail  the text itself, translated left past the clip
 *
 * The panel sets the translate (see ThinkingLive): it measures the overflow and
 * moves the tail by exactly that much, so the newest characters are always the
 * ones on screen. 'min-width: 0' on the clip is what lets a flex child shrink
 * below its content width at all — without it the row would push the caret off
 * the panel instead of clipping.
 */
.dsh-dschat-think-live { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; }
.dsh-dschat-think-live-prefix {
  flex: none; font-weight: 500;
  color: var(--dsw-alias-label-deep-diving, var(--dsw-alias-state-business-primary));
  background-image: linear-gradient(90deg,
    var(--dsw-alias-label-deep-diving-shimmer, var(--dsw-alias-state-business-primary)),
    var(--dsw-alias-label-deep-diving, var(--dsw-alias-state-business-primary)),
    var(--dsw-alias-label-deep-diving-shimmer, var(--dsw-alias-state-business-primary)));
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: dsh-dschat-shimmer 2.2s linear infinite;
}
@keyframes dsh-dschat-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
.dsh-dschat-think-live-clip { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.dsh-dschat-think-live-tail {
  display: inline-block; white-space: nowrap; will-change: transform;
  color: var(--dsw-alias-label-secondary);
}
/*
 * A live row's hover keeps the accent rather than flipping to label-primary:
 * the reader is watching a thought, and the row should not stop saying so
 * because the pointer crossed it.
 */
.dsh-dschat-think[data-live="true"] .dsh-dschat-think-head:hover { color: inherit; }
/*
 * The expanded face: the reasoning, and nothing else.
 *
 * The summary line is NOT rendered above this (see Thinking): the reader who
 * clicked asked for the thought, and a header row saying 「思考中…」 over a page
 * of reasoning was the reported bug. So this element is the whole block, and it
 * has to be the collapse control itself — hence a pointer on its content, which
 * is the only thing that says "click me to put that line back".
 *
 * Where the pointer goes, and where it does not. This is a scroll box: a
 * pointer over a scrollbar is a lie, and a pointer over a paragraph a reader is
 * trying to SELECT is worse. So the pointer is scoped to the markdown wrapper
 * (a real child element, so the box's own padding and scrollbar stay on the
 * default cursor) and the things that are NOT a collapse — a link, or any
 * control the renderer put inside the reasoning — take it back. A press
 * anywhere in the box still collapses; this is about what the pointer promises,
 * not about what the click does.
 */
.dsh-dschat-think-body {
  max-height: 360px; overflow: auto; padding: 8px 12px 10px;
  font-size: 13px; line-height: 1.68; color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-think-body > div { cursor: pointer; }
.dsh-dschat-think-body > div > *:first-child { margin-top: 0; }
.dsh-dschat-think-body > div > *:last-child { margin-bottom: 0; }
.dsh-dschat-think-body > div :is(a, button, input, textarea, select) { cursor: auto; }
/*
 * One caret rule for both disclosures: the right-pointing glyph while closed,
 * straight down while open. :last-child addresses the chevron without a
 * second class, and it is the LAST child in both headers by construction.
 *
 * Only the sources rule can still fire: the reasoning row renders its header in
 * the COLLAPSED face alone, so there is never an expanded state left to point
 * the caret down in. The '[data-open]' branch above the sources rule used to
 * carry that case and is gone with it.
 */
.dsh-dschat-think-head > svg:last-child,
.dsh-dschat-sources-head > svg:last-child { transform: rotate(-90deg); transition: transform .12s ease; }
.dsh-dschat-sources[data-open] > .dsh-dschat-sources-head > svg:last-child { transform: none; }
/*
 * Citation chips. The wrapper is the sup element (so the chips ride the text
 * baseline as one unit whether a marker holds one number or several), and each
 * chip is its own element: an anchor when the reply's source table knows the
 * URL, a span when it does not. Both look identical at rest, so a
 * partly-resolved reply does not read as broken; only the link reacts to the
 * pointer. (No backticks in this file: the sheet is a template literal.)
 */
.dsh-dschat-msg-body sup.dsh-dschat-cite {
  display: inline-flex; align-items: center; gap: 2px; margin: 0 2px; vertical-align: super;
}
.dsh-dschat-msg-body .dsh-dschat-citation {
  display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px;
  padding: 0 4px; border-radius: 5px; border: 1px solid transparent; font-size: 10px; font-weight: 600;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  text-decoration: none; cursor: default;
}
.dsh-dschat-msg-body a.dsh-dschat-citation { cursor: pointer; }
.dsh-dschat-msg-body a.dsh-dschat-citation:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent);
  color: var(--dsw-alias-label-primary);
}
/*
 * The source list under a cited reply (the panel's answer to the web's 参考来源).
 *
 * Collapsed by default — a searched reply can cite twenty pages, and a full
 * list under every answer turns the transcript into a link dump. The head is
 * the control and carries the count (「参考来源（8）」), so a collapsed list still
 * says how much is behind it.
 */
.dsh-dschat-sources {
  margin: 0 0 10px; border-radius: var(--dschat-radius-md); overflow: hidden;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
}
.dsh-dschat-sources-head {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 10px;
  border: none; background: transparent; cursor: pointer; text-align: left;
  font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-sources-head:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-dschat-sources[data-open] .dsh-dschat-sources-head { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-dschat-sources ol {
  margin: 0; padding: 8px 10px; list-style: none;
  display: flex; flex-direction: column; gap: 4px;
}
.dsh-dschat-sources li { display: flex; align-items: baseline; gap: 6px; font-size: 12px; line-height: 1.5; }
.dsh-dschat-source-no {
  flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px;
  padding: 0 4px; border-radius: 5px; font-size: 10px; font-weight: 600;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-sources a { color: var(--dsw-alias-link); text-decoration: none; }
.dsh-dschat-sources a:hover { text-decoration: underline; }
.dsh-dschat-table-wrap { margin: 0 0 10px; overflow-x: auto; }
.dsh-dschat-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dsh-dschat-table th, .dsh-dschat-table td {
  border: 1px solid var(--dsw-alias-border-l1); padding: 6px 10px; text-align: left;
}
.dsh-dschat-table th { background: var(--dsw-alias-bg-layer-2); font-weight: 600; }

/* code block with its own banner + copy action */
.dsh-dschat-code {
  margin: 0 0 10px; border-radius: var(--dschat-radius-md); overflow: hidden;
  border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
}
.dsh-dschat-code-bar {
  display: flex; align-items: center; gap: 8px; padding: 5px 10px;
  background: var(--dsw-alias-markdown-code-block-banner);
  font-family: var(--dschat-mono); font-size: 11px; color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-code-copy {
  display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 6px;
  border-radius: 5px; border: none; background: transparent; cursor: pointer; font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-code-copy:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-dschat-code pre { margin: 0; padding: 12px 14px; overflow: auto; font-family: var(--dschat-mono); font-size: 12.5px; line-height: 1.6; }

/* images */
.dsh-dschat-imgs { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 10px; }

/* streaming caret + errors */
.dsh-dschat-caret {
  display: inline-block; width: 7px; height: 15px; margin-left: 2px; vertical-align: -2px;
  background: var(--dsw-alias-label-primary); animation: dsh-dschat-blink 1s steps(1) infinite;
}
@keyframes dsh-dschat-blink { 50% { opacity: 0; } }
.dsh-dschat-spin {
  width: 12px; height: 12px; border-radius: 50%; flex: none;
  border: 1.6px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent);
  border-top-color: var(--dsw-alias-state-business-primary);
  animation: dsh-dschat-rot .7s linear infinite;
}
@keyframes dsh-dschat-rot { to { transform: rotate(360deg); } }
.dsh-dschat-err {
  display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 10px;
  border-radius: var(--dschat-radius-sm); font-size: 13px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-state-error-primary);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 25%, transparent);
}

/* message hover actions */
/*
 * Hover actions hug the content they act on.
 *
 * An assistant message spans the full column and its head (name · time) sits at
 * the LEFT, so the row rides the head line at the right edge. A user message is
 * a right-aligned bubble: anchoring its row to the message box parked it at the
 * far left, hundreds of pixels from the bubble. The bubble is therefore wrapped
 * in the .dsh-dschat-msg-line wrapper, which shrink-wraps it, and becomes the row's
 * containing block — so right:100% sits just outside the bubble at any width,
 * vertically centred, the classic chat placement.
 */
.dsh-dschat-msg-acts {
  display: flex; gap: 2px; opacity: 0; transition: opacity .12s ease;
  position: absolute; top: -8px; right: 0; padding: 2px;
  border-radius: var(--dschat-radius-sm); background: var(--dschat-surface);
  border: 1px solid var(--dschat-surface-border); box-shadow: 0 4px 16px #00000014;
}
.dsh-dschat-msg-line { position: relative; display: flex; justify-content: flex-end; max-width: 100%; min-width: 0; }
.dsh-dschat-msg[data-role="user"] .dsh-dschat-msg-acts {
  top: 50%; right: 100%; transform: translateY(-50%); margin-right: 6px;
}
.dsh-dschat-msg:hover .dsh-dschat-msg-acts,
.dsh-dschat-msg-acts:focus-within { opacity: 1; }
.dsh-dschat-msg-acts button {
  width: 26px; height: 26px; display: grid; place-items: center; border: none; border-radius: 6px;
  background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-msg-acts button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

/* empty state */
.dsh-dschat-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; text-align: center; padding: 56px 32px;
}
.dsh-dschat-empty-mark {
  width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; margin-bottom: 2px;
  background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground);
}
.dsh-dschat-empty h3 { margin: 0; font-size: 17px; font-weight: 600; }
.dsh-dschat-empty p { margin: 0; max-width: 400px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dsh-dschat-kbd {
  display: inline-flex; align-items: center; height: 19px; padding: 0 5px; border-radius: 5px;
  font-family: var(--dschat-mono); font-size: 11px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
}

/* composer */
.dsh-dschat-composer { flex: none; padding: 8px 26px 4px; }
.dsh-dschat-composer-inner { max-width: 760px; margin: 0 auto; }
/*
 * The input card, measured off the live page: 24px radius, '#0000001a' hairline,
 * and a two-part shadow that is almost nothing — rgba(0,0,0,.02) 0 4px 12px plus
 * a hint of blue underneath. The panel's own scale tops out at 20px
 * ('--dschat-radius-xl'), so the radius is written out rather than clamped: at
 * this size the difference between 20 and 24 is visible on a card this wide, and
 * matching the page is the whole point of the exercise.
 */
.dsh-dschat-card {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 24px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 4px 12px #00000005, 0 2px 4px #4868b203;
  transition: border-color .12s ease, background-color .12s ease;
}
/*
 * Dark mode, where the card needs a boundary of its own.
 *
 * Both figures above are LIGHT-mode figures, and both quietly stop working in a
 * dark theme: #00000005 of shadow on a #151517 page is invisible, so the card
 * lost the edge that separates it from the panel and the composer read as a
 * floating row of pills rather than a field you type into. The dark branch
 * therefore promotes the hairline one step (border-l2 is #ffffff1f against the
 * page's #ffffff0f) and drops the useless shadow. The surface itself stays
 * 'bg-layer-1' — the token the harness raises its own cards with, and one step
 * off the page in dark exactly as it is in light.
 */
body[data-ds-dark-theme] .dsh-dschat-card {
  border-color: var(--dsw-alias-border-l3);
  box-shadow: none;
}
.dsh-dschat-card:focus-within { border-color: var(--dsw-alias-border-l3); }
.dsh-dschat-card.dsh-dschat-dragging {
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
}
.dsh-dschat-dropline {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 10px 0; font-size: 12px; color: var(--dsw-alias-state-business-primary);
}
.dsh-dschat-attachments { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 10px 0; }
.dsh-dschat-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 4px 0 8px;
  border-radius: var(--dschat-radius-sm); font-size: 12px;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
  max-width: 260px;
}
.dsh-dschat-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-dschat-chip button {
  width: 18px; height: 18px; display: grid; place-items: center; border: none; border-radius: 4px;
  background: transparent; cursor: pointer; color: var(--dsw-alias-label-tertiary); flex: none;
}
.dsh-dschat-chip button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
/*
 * The composer's height is driven by the panel (see resizeComposer): it is set
 * to the content's own height, clamped to the max-height below. Both numbers
 * here are therefore load-bearing — min-height is what an empty box measures,
 * max-height is where the panel stops growing it and the textarea starts
 * scrolling instead. An explicit overflow-y makes that second half intentional
 * rather than a UA default.
 */
.dsh-dschat-input {
  display: block; width: 100%; resize: none; border: none; outline: none; background: transparent;
  font: inherit; font-size: 14px; line-height: 1.6; color: var(--dsw-alias-label-primary);
  padding: 12px 14px 4px; min-height: 52px; max-height: 180px; overflow-y: auto;
}
.dsh-dschat-input::placeholder { color: var(--dsw-alias-label-tertiary); }
/*
 * The composer is readOnly (not disabled) while the engine is down, so that
 * focusing it can start the engine. Read-only must therefore LOOK inviting:
 * a pointer cursor and an accent-tinted placeholder so it reads as an
 * affordance rather than as broken input, plus a faint wash on the card.
 */
.dsh-dschat-input:read-only { cursor: pointer; }
.dsh-dschat-input:read-only::placeholder { color: var(--dsw-alias-link); }
/*
 * The read-only "start me" wash.
 *
 * It was a 5% mix of the accent over the card in both themes, and 5% of a dark
 * navy over a #232324 card is not a wash — it is a bruise: the card went muddy
 * grey-blue and the accent it was supposed to advertise disappeared into it.
 * Dark mode therefore mixes the accent into the card's own layer at the same 5%
 * and then LIFTS the result toward white, so the tint survives the dark base
 * instead of being swallowed by it. The border does the advertising in the dark
 * branch anyway — an accent hairline is legible where a 5% fill is not.
 */
.dsh-dschat-card:has(.dsh-dschat-input:read-only) {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, var(--dsw-alias-bg-layer-1));
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, var(--dsw-alias-border-l1));
}
body[data-ds-dark-theme] .dsh-dschat-card:has(.dsh-dschat-input:read-only) {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, var(--dsw-alias-bg-layer-1));
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, var(--dsw-alias-border-l3));
}
/*
 * The composer's tool row, on the page's own metrics: 12px of padding on every
 * side, a 4px gap between controls, and 34px-tall controls in it. 'flex-wrap' is
 * off deliberately — the row's contents are fixed (two pills, a paperclip, the
 * send circle) and wrapping the send button onto a second line on a narrow panel
 * would be worse than letting the spacer collapse.
 */
.dsh-dschat-tools { display: flex; align-items: center; gap: 4px; padding: 12px; }
/* The Finder input is clicked from the tool row; it must never take layout. */
.dsh-dschat-fileinput { display: none; }
/*
 * 附件: a 34px glyph button, exactly like the pills beside it.
 *
 * No label. The web app's own attach control is a bare paperclip in this row,
 * and at panel widths the two pills plus a labelled upload button plus the send
 * circle do not fit; the tooltip and the chips above carry the words.
 */
.dsh-dschat-attach {
  width: 34px; height: 34px; flex: none; display: grid; place-items: center;
  border: none; border-radius: 50%; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-attach:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-dschat-attach:disabled { opacity: .5; cursor: not-allowed; background: transparent; }
/*
 * The composer's 深度思考 / 智能搜索 pills.
 *
 * Measured on the live page rather than guessed: 34px tall, 18px radius, 10px
 * of side padding, a 4px gap between the glyph and the label, '13px/500' text,
 * and — the part that makes them recognisable — a NEUTRAL outline when off and
 * the accent wash when on:
 *
 *   off  fill rgba(45,53,70,.8) / border rgba(78,109,181,.8) / label #f9fafb
 *   on   fill #283142           / border #4868b2                / label #679efe
 *
 * Those are the page's dark-mode values; on the panel they are expressed in the
 * harness's own tokens, which resolve per theme for the same effect — the fill
 * is a neutral layer, and the "on" wash is the deepseek-static blue family that
 * DSH ships for exactly this purpose (with a color-mix fallback if a future
 * theme drops the statics). The "on" state deliberately sits inside the same
 * recipe the transfer button uses, so the accent still reads as one family.
 *
 * DARK MODE: the OFF pill must be a hole, not a window.
 *
 * 'bg-layer-2' is the right neutral on paper — one step off the card — but in
 * the dark ramp the two steps run the WRONG WAY for this pair: layer-1 is
 * #232324 and layer-2 is #2c2c2e, so the pill came out DARKER and warmer than
 * the card it sits on. Two misaligned greys inside one 24px-radius card is what
 * made the dark composer look assembled rather than designed. The dark branch
 * therefore drops the fill and lets the border describe the pill, keeping the
 * hover wash to say it is still a control. The "on" pill keeps its fill —
 * that one is meant to be a raised, tinted object.
 */
.dsh-dschat-toggle {
  display: inline-flex; align-items: center; gap: 4px; height: 34px; padding: 0 10px;
  border-radius: 18px; cursor: pointer; white-space: nowrap; font-size: 13px; font-weight: 500;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-dschat-toggle-text { line-height: 1; color: inherit; }
.dsh-dschat-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-dschat-toggle:disabled { opacity: .5; cursor: not-allowed; }
/*
 * Naming the label AND repeating the pill is deliberate, and it is not
 * belt-and-braces — it is a specificity requirement.
 *
 * The blanket '.dsh-dschat button { color: inherit }' at the top of this sheet
 * is (0,1,1); a single-class '.dsh-dschat-toggle-on' is (0,1,0) and LOSES, so
 * the "on" pill's colour was silently replaced by the inherited one: the label
 * stayed blue (the descendant rule won for the span) while the glyph went
 * neutral, which is exactly the half-painted pill that took a computed-style
 * probe to see. The compound selector below ties on specificity and wins on
 * order. Measured after the fix: pill and label both rgb(65,118,230).
 */
.dsh-dschat-toggle.dsh-dschat-toggle-on,
.dsh-dschat-toggle.dsh-dschat-toggle-on > .dsh-dschat-toggle-text {
  background: var(--dsw-static-deepseek-50, color-mix(in srgb, var(--dsw-alias-state-business-primary) 13%, transparent));
  color: var(--dsw-static-deepseek-500, var(--dsw-alias-state-business-primary));
  border-color: var(--dsw-static-deepseek-300, color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent));
}
.dsh-dschat-toggle.dsh-dschat-toggle-on:hover {
  background: var(--dsw-static-deepseek-100, color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent));
}
/*
 * Dark mode needs the other end of the same static ramp: the light-mode tint
 * (#edf3fe) is nearly the panel's own fill in a dark theme, so the pill would
 * lose its "on" state entirely. The static ramp does NOT flip with the theme
 * (those tokens are theme-independent by design), so the branch has to be
 * written out — keyed off the shell's own 'data-ds-dark-theme', which is a user
 * setting rather than the OS's, and matched to the selector shape the popover
 * rules below already use.
 *
 * The compound class is repeated for the same reason it is above: the blanket
 * button rule outranks a single class, so a dark pill written the short way
 * would keep the light-mode accent. Measured at (0,2,1) versus (0,1,1).
 *
 * AND THE LABEL MUST BE NAMED HERE TOO — that is the reported bug.
 *
 * The light branch above is ONE rule with TWO selectors, and it sets the label's
 * colour through the second one: (0,2,1), which beats '.dsh-dschat-toggle-text'
 * at (0,1,0). This branch used to name only the pill, at (0,3,0) — which beats
 * the pill's (0,2,1) but equals the LABEL selector's (0,2,1) and therefore
 * LOSES to it on document order. The result, measured on a real render and not
 * guessed: in dark mode the lit pill painted its fill and border from the dark
 * branch while the words 「深度思考」 stayed #edf3fe — a near-white label with a
 * cold blue fill, which is the "颜色仍然不对" the reader saw. The glyph was
 * fine (it inherits from the button), so only half the pill was wrong.
 *
 * The selector list below is the same two-part shape the light rule uses, and
 * it is ordered so the label's colour is decided HERE in both branches.
 */
body[data-ds-dark-theme] .dsh-dschat-toggle.dsh-dschat-toggle-on,
body[data-ds-dark-theme] .dsh-dschat-toggle.dsh-dschat-toggle-on > .dsh-dschat-toggle-text {
  background: var(--dsw-static-deepseek-800, #34415b);
  color: var(--dsw-static-deepseek-400, var(--dsw-alias-state-business-primary));
  border-color: var(--dsw-static-deepseek-600, #4868b2);
}
/*
 * The fill belongs to the pill alone: repeated for the span so the label's
 * background can never be re-declared by the light branch — a text span with
 * the light-mode #edf3fe behind it is the "highlighted word" look the screenshot
 * shows, and 'background: transparent' in the light rule is what the two
 * branches have to agree on.
 */
body[data-ds-dark-theme] .dsh-dschat-toggle.dsh-dschat-toggle-on > .dsh-dschat-toggle-text {
  background: transparent;
}
body[data-ds-dark-theme] .dsh-dschat-toggle.dsh-dschat-toggle-on:hover {
  background: color-mix(in srgb, var(--dsw-static-deepseek-800, #34415b), white 6%);
}
body[data-ds-dark-theme] .dsh-dschat-toggle.dsh-dschat-toggle-on:hover > .dsh-dschat-toggle-text {
  background: transparent;
}
/*
 * The dark branch for the OFF pill.
 *
 * ORDER IS THE MECHANISM, not decoration: this selector and the "on" branch
 * directly above have the SAME specificity (0,3,0), so only document order can
 * decide between them — and the "on" branch must win, because a lit pill that
 * loses its fill to the off branch looks like a broken switch. Written here,
 * after it, the off rule covers what it should (both plain states) and yields
 * on every class the on rule names. The earlier draft of this file had them the
 * other way round, which silently flattened the lit pill back to transparent.
 *
 * Why a hole instead of a fill: 'bg-layer-2' is one step DARKER than the card's
 * 'bg-layer-1' in the dark ramp (#2c2c2e over #232324) — the opposite direction
 * from light mode — so the off pill read as a slightly different, warmer grey
 * glued onto the card. Two misaligned greys inside one card is what made the
 * dark composer look assembled rather than designed. The border describes the
 * pill instead, and the hover wash keeps it reading as a control.
 */
body[data-ds-dark-theme] .dsh-dschat-toggle {
  background: transparent;
  border-color: var(--dsw-alias-border-l3);
}
body[data-ds-dark-theme] .dsh-dschat-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
/*
 * 发送: the page's 34px filled circle.
 *
 * The fill is the accent itself — 'state-business-primary', the token whose
 * light value is the page's #4176e6 — rather than 'button-primary-fill', which
 * resolves to brand-primary and flips to near-white in dark mode (the "太白了"
 * bug this file already documents twice). Disabled is that same circle at 40%
 * opacity, exactly how the page dims an empty composer, so the button keeps its
 * identity instead of turning into a grey disc.
 *
 * Dark mode needs MORE of that identity, not less: 40% of #7aaaff composited
 * onto a #232324 card is a muddy desaturated disc that reads as a disabled
 * PLACEHOLDER rather than as the send button waiting for text. The dark branch
 * raises it to 45% and rings it with a hairline of its own colour, so the circle
 * keeps its edge in the one theme where a dimmed accent has nothing to sit on.
 */
.dsh-dschat-send {
  width: 34px; height: 34px; flex: none; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
  border: none; background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
.dsh-dschat-send:hover { filter: brightness(1.06); }
.dsh-dschat-send:disabled {
  opacity: .4;
  cursor: not-allowed;
  filter: none;
}
body[data-ds-dark-theme] .dsh-dschat-send:disabled {
  opacity: .45;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, transparent);
}
.dsh-dschat-stop {
  display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px;
  border-radius: 999px; cursor: pointer; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1);
}
.dsh-dschat-stop:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-dschat-stop i { width: 9px; height: 9px; border-radius: 2px; background: var(--dsw-alias-state-error-primary); }
/*
 * The composer's right-hand keyboard hint (「⌘K 搜索」) is GONE, and so is the
 * rule that used to hide its text below 620px.
 *
 * It documented a shortcut for a control that is already on screen, in the row's
 * most valuable space — the strip between the paperclip and the send circle. At
 * a glance it read as a second, disabled send button with a stray label beside
 * it. ⌘K still opens the rail's search box; it just no longer advertises itself
 * in the composer.
 */

/* phase rail under the composer */
.dsh-dschat-phase {
  display: flex; align-items: center; gap: 10px; justify-content: center; flex-wrap: wrap;
  padding: 6px 26px 12px; font-size: 11.5px; color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.dsh-dschat-phase .dsh-dschat-sep { opacity: .4; }
.dsh-dschat-phase b { font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-dschat-phase .dsh-dschat-spin { width: 11px; height: 11px; }

/* transfer popover */
.dsh-dschat-pop-wrap { position: relative; }
.dsh-dschat-pop {
  position: absolute; top: 36px; right: 0; width: 348px; z-index: 40; padding: 12px;
  border-radius: var(--dschat-radius-lg);
  background: var(--dschat-surface); backdrop-filter: var(--dsw-menu-backdrop-filter, blur(28px) saturate(160%));
  border: 1px solid var(--dschat-surface-border);
  box-shadow: var(--dsw-elevation-prominent, 0 16px 40px #00000024, 0 2px 8px #00000014);
}
/*
 * Host rule for menus: light menus keep the border-l1 hairline, dark menus
 * use the stronger border-l3 stroke (a 1px #ffffff0f hairline disappears on a
 * dark translucent fill).
 */
body[data-ds-dark-theme] .dsh-dschat-pop,
body[data-ds-dark-theme] .dsh-dschat-msg-acts { border-color: var(--dsw-alias-border-l3); }
.dsh-dschat-pop h4 { margin: 0 0 2px; font-size: 13px; font-weight: 600; }
.dsh-dschat-pop .dsh-dschat-sub { margin: 0 0 10px; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.dsh-dschat-field { margin-bottom: 10px; }
.dsh-dschat-field > label { display: block; font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 4px; }
.dsh-dschat-seg { display: flex; gap: 3px; padding: 2px; border-radius: var(--dschat-radius-sm); background: var(--dsw-alias-bg-layer-2); }
.dsh-dschat-seg button {
  flex: 1; height: 26px; border-radius: 6px; border: none; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--dsw-alias-label-secondary);
}
.dsh-dschat-seg button[data-on] {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-weight: 500; box-shadow: 0 1px 2px #00000012;
}
.dsh-dschat-select {
  width: 100%; height: 30px; padding: 0 8px; font: inherit; font-size: 12.5px; cursor: pointer;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dschat-radius-sm);
}
.dsh-dschat-hintline {
  display: flex; align-items: center; gap: 6px; font-size: 11px;
  color: var(--dsw-alias-label-tertiary); margin: -2px 0 10px;
}
.dsh-dschat-pop-foot { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.dsh-dschat-steps { display: flex; flex-direction: column; gap: 7px; padding: 4px 0 8px; }
.dsh-dschat-step { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dsh-dschat-step[data-done] { color: var(--dsw-alias-label-primary); }
.dsh-dschat-tick {
  width: 16px; height: 16px; border-radius: 50%; flex: none; display: grid; place-items: center;
  border: 1.5px solid var(--dsw-alias-border-l3);
}
.dsh-dschat-step[data-done] .dsh-dschat-tick {
  background: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary); color: #fff;
}
.dsh-dschat-step .dsh-dschat-spin { width: 14px; height: 14px; border-width: 1.8px; }
.dsh-dschat-prog { height: 3px; border-radius: 99px; background: var(--dsw-alias-bg-skeleton); overflow: hidden; margin: 2px 0 4px; }
.dsh-dschat-prog > i { display: block; height: 100%; width: 0; background: var(--dsw-alias-state-business-primary); transition: width .3s ease; }

/* ---------- settings page (settings.section slot) ---------- */
.dsh-dschat-settings {
  height: 100%; overflow: auto; padding: 28px clamp(24px, 4vw, 48px) 48px;
  display: block;
}
.dsh-dschat-sethead h1 { margin: 0 0 4px; font-size: 20px; font-weight: 500; line-height: 28px; }
.dsh-dschat-sethead p { margin: 0 0 20px; font-size: 13px; color: var(--dsw-alias-label-secondary); max-width: 640px; }
.dsh-dschat-setcard {
  max-width: 720px; margin: 0 0 16px; padding: 14px 16px;
  border-radius: var(--dschat-radius-lg);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l2));
}
.dsh-dschat-setcard h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.dsh-dschat-setrow {
  display: flex; align-items: baseline; gap: 16px; padding: 5px 0;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-dschat-setrow:first-of-type { border-top: none; }
.dsh-dschat-setlabel { flex: none; width: 190px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dsh-dschat-setvalue {
  flex: 1; min-width: 0; font-size: 12.5px; color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-dschat-mono { font-family: var(--dschat-mono); font-size: 11.5px; }
.dsh-dschat-on, .dsh-dschat-off { display: inline-flex; align-items: center; gap: 5px; }
.dsh-dschat-on { color: var(--dsw-alias-state-success-primary); }
.dsh-dschat-off { color: var(--dsw-alias-label-tertiary); }
.dsh-dschat-setactions { display: flex; gap: 8px; }
.dsh-dschat-sethint { margin: 10px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); max-width: 620px; }

/* ---------- toasts ---------- */
.dsh-dschat-toasts {
  position: absolute; top: 62px; right: 18px; z-index: 60;
  display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
}
.dsh-dschat-toast {
  display: flex; align-items: center; gap: 10px; min-height: 38px; max-width: 420px;
  padding: 8px 8px 8px 12px; border-radius: var(--dschat-radius-md);
  background: var(--dsw-alias-toast-bg); color: var(--dsw-alias-toast-label);
  font-size: 13px; box-shadow: 0 8px 24px #00000029;
}
.dsh-dschat-toast button {
  height: 24px; padding: 0 9px; border-radius: 6px; cursor: pointer; font-size: 12px;
  border: none; background: #ffffff24; color: inherit;
}
.dsh-dschat-toast button:hover { background: #ffffff3d; }
.dsh-dschat-toast .dsh-dschat-ok { color: #6ee7a8; }
.dsh-dschat-toast .dsh-dschat-bad { color: #ff9b9b; }
`
