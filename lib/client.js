window.__ModuleLoader__.load({
	id: "dsh-dschat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/protocol.ts
function phaseOf(state) {
  if (state.engine === "error") return "error";
  if (state.engine === "launching") return "launching";
  if (state.engine === "stopped") return state.loggedIn === false ? "need-login" : "stopped";
  if (state.loggedIn === false) return "need-login";
  if (state.busy) return state.chats.some((chat) => chat.streaming) ? "streaming" : "thinking";
  return "ready";
}
function sourcesOf(input) {
  if (input === void 0 || input.length === 0) return void 0;
  let end = input.length;
  while (end > 0 && (input[end - 1]?.url ?? "") === "") end--;
  if (end === 0) return void 0;
  return input.slice(0, end).map((source) => source?.title === void 0 ? { url: source?.url ?? "" } : { url: source.url, title: source.title });
}
function sameSources(left, right) {
  if (left === right) return true;
  if (left === void 0 || right === void 0) return false;
  if (left.length !== right.length) return false;
  return left.every((source, index) => source.url === right[index]?.url && source.title === right[index]?.title);
}
function mergeTail(state, tail) {
  const status = {
    busy: tail.busy,
    busySince: tail.busySince,
    activeChatId: tail.activeChatId ?? state.activeChatId
  };
  const statusChanged = state.busy !== status.busy || state.busySince !== status.busySince || state.activeChatId !== status.activeChatId;
  const chatId = tail.chatId;
  const chatIndex = chatId === void 0 ? -1 : state.chats.findIndex((chat2) => chat2.id === chatId);
  const message = tail.message ?? null;
  if (chatIndex < 0 || message === null) return statusChanged ? { ...state, ...status } : state;
  const chat = state.chats[chatIndex];
  const position = chat.messages.findIndex((item) => item.id === message.id);
  const existing = position < 0 ? void 0 : chat.messages[position];
  const content = (existing?.content ?? "").slice(0, message.head) + message.tail;
  const sources = sourcesOf(message.sources) ?? existing?.sources;
  const sourcesChanged = !sameSources(existing?.sources, sources);
  const thinkingMs = message.thinkingMs ?? existing?.thinkingMs;
  const messageChanged = existing === void 0 || existing.content !== content || existing.streaming !== message.streaming || existing.error !== message.error || existing.thinkingMs !== thinkingMs || sourcesChanged;
  const chatChanged = chat.streaming !== tail.streaming || tail.updatedAt !== void 0 && chat.updatedAt !== tail.updatedAt;
  if (!messageChanged && !chatChanged && !statusChanged) return state;
  const merged = {
    ...existing ?? {},
    id: message.id,
    role: message.role,
    content,
    ts: message.ts,
    streaming: message.streaming,
    error: message.error,
    ...thinkingMs === void 0 ? {} : { thinkingMs },
    ...sources === void 0 ? {} : { sources }
  };
  return {
    ...state,
    ...status,
    chats: state.chats.map((item, i) => i === chatIndex ? {
      ...item,
      streaming: tail.streaming,
      updatedAt: tail.updatedAt ?? item.updatedAt,
      messages: position < 0 ? [...item.messages, merged] : item.messages.map((candidate, j) => j === position ? merged : candidate)
    } : item)
  };
}
var DSCHAT_API = {
  state: "/api/dsh-dschat/state",
  /**
   * Cheap streaming feed: one message, as a delta. Polled fast while a reply is
   * in flight; `/state` stays the slow, authoritative, whole-store snapshot.
   */
  tail: "/api/dsh-dschat/tail",
  context: "/api/dsh-dschat/context",
  /**
   * Start the web engine for someone who wants to type, in the right mode.
   *
   * Split from `openLogin` because they are different requests: this one means
   * "I want to chat" (reuse the persisted session, stay out of the way), while
   * `openLogin` means "give me the visible window" and is the escalation taken
   * only when the wake reports a sign-in page.
   */
  wake: "/api/dsh-dschat/wake",
  openLogin: "/api/dsh-dschat/open-login",
  closeBrowser: "/api/dsh-dschat/close-browser",
  newChat: "/api/dsh-dschat/new-chat",
  restore: "/api/dsh-dschat/restore",
  attach: "/api/dsh-dschat/attach",
  send: "/api/dsh-dschat/send",
  stop: "/api/dsh-dschat/stop",
  deepThink: "/api/dsh-dschat/deep-think",
  search: "/api/dsh-dschat/search",
  transfer: "/api/dsh-dschat/transfer",
  exportFile: "/api/dsh-dschat/export",
  renameChat: "/api/dsh-dschat/rename",
  deleteChat: "/api/dsh-dschat/delete",
  clearChats: "/api/dsh-dschat/clear",
  webChats: "/api/dsh-dschat/web-chats",
  recover: "/api/dsh-dschat/recover",
  /**
   * Read-only diagnostics for the page scrapers. Exists because a failed
   * recover used to report only "读取网页会话历史失败（页面可能已改版）", which
   * cannot be acted on; this reports what the page actually contains.
   */
  probePage: "/api/dsh-dschat/probe-page"
};

// src/client/api.ts
var REQUEST_TIMEOUT_MS = 3e4;
var TIMEOUT = {
  /** Cheap status reads — the polls the feed hangs off. */
  poll: 15e3,
  /** Submitting may launch a browser first (45 s goto + typing). */
  send: 12e4,
  /** Opening/relaunching the visible login window. */
  login: 18e4,
  /** Reading the web sidebar; a cold launch can precede it. */
  webList: 12e4,
  /** Distilling a transcript is several sequential model calls. */
  transfer: 3e5,
  /** Up to 24 MiB of base64 over the loopback socket. */
  attach: 6e4
};
async function request(path, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: body === void 0 ? "GET" : "POST",
      headers: body === void 0 ? void 0 : { "content-type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && payload.ok !== true) {
      return { ...payload, ok: false, error: payload.error ?? `HTTP ${response.status}` };
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: `\u8BF7\u6C42\u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)} \u79D2\uFF09\uFF1A${path}` };
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
var DSchatApi = class {
  state() {
    return request(DSCHAT_API.state, void 0, TIMEOUT.poll);
  }
  /**
   * Streaming tail for one chat: the last reply as `local.slice(0, head) + tail`.
   *
   * `at` is the length of the copy the panel already holds, which is all the
   * host needs to decide between a delta and a full resend. Polled ~10×/s while
   * a turn is in flight — never call `/state` at that rate, it answers with the
   * entire transcript store.
   */
  tail(chatId, at) {
    const query = new URLSearchParams();
    if (chatId !== void 0) query.set("chat", chatId);
    query.set("at", String(at));
    return request(`${DSCHAT_API.tail}?${query.toString()}`, void 0, TIMEOUT.poll);
  }
  openLogin() {
    return request(DSCHAT_API.openLogin, void 0, TIMEOUT.login);
  }
  /**
   * "I want to type": start the web page in the mode that suits an existing
   * session, without assuming the visible login window is wanted.
   *
   * See `WakeResult`: `loginWindow` means a visible window is already open, so
   * the caller must not ask for one again.
   */
  wake() {
    return request(DSCHAT_API.wake, void 0, TIMEOUT.login);
  }
  closeBrowser() {
    return request(DSCHAT_API.closeBrowser, void 0, TIMEOUT.login);
  }
  newChat() {
    return request(DSCHAT_API.newChat, {}, TIMEOUT.login);
  }
  /** Host facts: workspace list + the most recent session cwd. */
  context() {
    return request(DSCHAT_API.context, void 0, TIMEOUT.poll);
  }
  /** Persist pasted/dropped image bytes and get back a real path for the engine. */
  attach(input) {
    return request(DSCHAT_API.attach, input, TIMEOUT.attach);
  }
  /**
   * Undo a delete by re-importing the transcript the panel still holds.
   *
   * `webSessionId` travels with it so the host can match the original web
   * conversation by id; title matching (the fallback) is ambiguous, because
   * every chat starts out titled 「新的对话」.
   */
  restore(chat) {
    return request(DSCHAT_API.restore, chat);
  }
  /**
   * Submit one message. `stored` on a failure means the user message DID reach
   * the transcript and only the reply never started — see SendResult.stored.
   */
  send(text, images) {
    return request(DSCHAT_API.send, { text, images }, TIMEOUT.send);
  }
  stop() {
    return request(DSCHAT_API.stop, {});
  }
  setDeepThink(enabled) {
    return request(DSCHAT_API.deepThink, { enabled });
  }
  setSearch(enabled) {
    return request(DSCHAT_API.search, { enabled });
  }
  transfer(chatId, cwd, mode, workspaceId, targetSessionId) {
    return request(DSCHAT_API.transfer, { chatId, cwd, mode, workspaceId, targetSessionId }, TIMEOUT.transfer);
  }
  /**
   * Export one conversation to markdown.
   *
   * `cwd` is deliberately omitted by the panel: the host writes into its
   * configured export directory (the OS download folder by default) and reports
   * both the file name and the directory it landed in. The parameter stays for
   * callers that do want a specific target — a script, or a future 「导出到…」.
   */
  exportFile(chatId, cwd) {
    return request(DSCHAT_API.exportFile, { chatId, cwd });
  }
  renameChat(chatId, title) {
    return request(DSCHAT_API.renameChat, { chatId, title });
  }
  deleteChat(chatId) {
    return request(DSCHAT_API.deleteChat, { chatId });
  }
  clearChats() {
    return request(DSCHAT_API.clearChats, {});
  }
  /** Web-side conversations plus the ones missing from local storage. */
  webChats() {
    return request(DSCHAT_API.webChats, void 0, TIMEOUT.webList);
  }
  /**
   * Recover one web conversation. `sessionId` is preferred (titles repeat and
   * `hasText` matching is a substring match); `title` stays for links that
   * predate it.
   */
  recover(chat) {
    return request(DSCHAT_API.recover, chat, TIMEOUT.webList);
  }
};

// src/client/icons.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var STROKE = 1.25;
function svg(size, children, extra) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      viewBox: "0 0 16 16",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: STROKE,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      ...extra,
      children
    }
  );
}
function ChatIcon({ size = 16 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.1 3.6h9.8a1.3 1.3 0 0 1 1.3 1.3v5.3a1.3 1.3 0 0 1-1.3 1.3H7.5l-3.1 2.6v-2.6H3.1a1.3 1.3 0 0 1-1.3-1.3V4.9a1.3 1.3 0 0 1 1.3-1.3Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.5 6.6h5.4M5.5 9h3.2" })
  ] }));
}
var WHALE_PATH = "M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z";
var WHALE_VIEWBOX = { width: 23.16, height: 17.04 };
function whaleHeight(width) {
  return Math.round(width * WHALE_VIEWBOX.height / WHALE_VIEWBOX.width * 100) / 100;
}
function WhaleMark({ size = 19 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      viewBox: `0 0 ${WHALE_VIEWBOX.width} ${WHALE_VIEWBOX.height}`,
      width: size,
      height: whaleHeight(size),
      fill: "none",
      stroke: "none",
      "aria-hidden": "true",
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: WHALE_PATH, fill: "currentColor" })
    }
  );
}
function SearchIcon({ size = 13 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "7", cy: "7", r: "4.2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10.2 10.2L13.5 13.5" })
  ] }));
}
function HistoryIcon({ size = 16 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "2.1", y: "3.1", width: "11.8", height: "9.8", rx: "2.6" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.2 3.1v9.8" })
  ] }));
}
function PlusIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 3.2v9.6M3.2 8h9.6" }), { strokeWidth: 1.5 });
}
function RefreshIcon({ size = 13 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M13.2 8a5.2 5.2 0 1 1-1.6-3.7" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M13.4 2.2v3.1h-3.1" })
  ] }));
}
function PencilIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M11.3 2.4l2.3 2.3L5.4 12.9H3.1v-2.3z" }));
}
function TrashIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2.8 4.2h10.4M6.6 4.2V2.8h2.8v1.4M4.2 4.2l.6 9h6.4l.6-9" }) }));
}
function CheckIcon({ size = 10 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3 8.6L6.3 12 13 4.6" }), { strokeWidth: 1.8 });
}
function WarnIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 2.6l5.6 10.2H2.4z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 6.4v3.1M8 11.4v.1" })
  ] }));
}
function CloseIcon({ size = 10 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 4l8 8M12 4l-8 8" }), { strokeWidth: 1.7 });
}
function CopyIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "5.6", y: "2.6", width: "7.8", height: "9.2", rx: "1.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10.4 13.4H4.2a1.6 1.6 0 0 1-1.6-1.6V5.2" })
  ] }));
}
function QuoteIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 3.5v9M8.5 5.2h4.5M8.5 8h4.5M8.5 10.8h3" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.2 6.6L4 4.4 6.2 2.2" })
  ] }));
}
function ThinkIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M13.4 9.6a1.4 1.4 0 0 1-1.4 1.4H6.2L3 13.4V3.4A1.4 1.4 0 0 1 4.4 2h7.6a1.4 1.4 0 0 1 1.4 1.4z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.4 7.6c1.1-1.9 2.1-1.9 3.2 0" })
  ] }));
}
function DeepThinkIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "1.23", fill: "currentColor", stroke: "none" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10.51 10.51C7.3 13.71 3.58 15.19 2.2 13.8 0.81 12.42 2.29 8.7 5.49 5.49 8.7 2.29 12.42 0.81 13.8 2.2 15.19 3.58 13.71 7.3 10.51 10.51Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10.73 5.27C13.94 8.47 15.31 12.29 13.8 13.8 12.29 15.31 8.48 13.94 5.27 10.73 2.07 7.53 0.69 3.71 2.2 2.2 3.71 0.69 7.53 2.06 10.73 5.27Z" })
  ] }));
}
function WebSearchIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 14.85C9.6 14.85 10.89 11.78 10.89 8 10.89 4.22 9.6 1.15 8 1.15" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 14.85C6.4 14.85 5.11 11.78 5.11 8 5.11 4.22 6.4 1.15 8 1.15" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "6.85" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M1.64 8h12.72" })
  ] }));
}
function ClipIcon({ size = 15 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "path",
    {
      fill: "currentColor",
      stroke: "none",
      d: "M5.55 9.75V5h1.4v4.75a1.05 1.05 0 0 0 2.1 0V4.5a2.8 2.8 0 1 0-5.6 0v5.25a4.55 4.55 0 0 0 9.1 0V4h1.4v5.75a5.95 5.95 0 0 1-11.9 0V4.5a4.2 4.2 0 1 1 8.4 0v5.25a2.45 2.45 0 0 1-4.9 0Z"
    }
  ));
}
function SendIcon({ size = 16 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "path",
    {
      fill: "currentColor",
      stroke: "none",
      d: "M8.31 0.98a2.5 2.5 0 0 1 0.95 0.45c0.22 0.18 0.47 0.43 0.72 0.68l4.73 4.72-1.42 1.42L9 3.96v11.08H7V3.96L2.71 8.25 1.29 6.83l4.73-4.72c0.25-0.25 0.5-0.5 0.72-0.68a2.5 2.5 0 0 1 0.95-0.45 2.3 2.3 0 0 1 0.62 0Z"
    }
  ), { fill: "currentColor" });
}
function CaretIcon({ size = 11 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3 4.8L6 7.8l3-3" }), { strokeWidth: 1.5 });
}
function MoreIcon({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 16 16", width: size, height: size, fill: "currentColor", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "3.6", cy: "8", r: "1.15" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "1.15" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12.4", cy: "8", r: "1.15" })
  ] });
}

// src/client/locales.ts
var zh = {
  "nav.label": "DSchat",
  "panel.title": "DSchat",
  "settings.title": "DSchat",
  "settings.description": "DeepSeek \u7F51\u9875\u7AEF\u804A\u5929\u4E0E harness \u8FC1\u79FB\u8BBE\u7F6E",
  "settings.status": "\u72B6\u6001",
  "settings.phase": "\u5F15\u64CE",
  "settings.login": "\u7F51\u9875\u767B\u5F55",
  "settings.login.yes": "\u5DF2\u767B\u5F55",
  "settings.login.no": "\u672A\u767B\u5F55",
  "settings.login.unknown": "\u672A\u77E5",
  "settings.page": "\u5F53\u524D\u9875\u9762",
  "settings.lastError": "\u6700\u8FD1\u9519\u8BEF",
  "settings.runtime": "\u8FD0\u884C\u53C2\u6570",
  "settings.channel": "\u6D4F\u89C8\u5668\u6E20\u9053",
  "settings.headless": "\u804A\u5929\u65F6\u65E0\u5934",
  "settings.proxy": "\u4EE3\u7406",
  "settings.timeout": "\u56DE\u590D\u7B49\u5F85\u4E0A\u9650",
  "settings.executable": "\u6D4F\u89C8\u5668\u53EF\u6267\u884C\u6587\u4EF6",
  "settings.dataDir": "\u6570\u636E\u76EE\u5F55",
  "settings.profileDir": "\u6D4F\u89C8\u5668 profile\uFF08\u767B\u5F55\u6001\uFF09",
  "settings.exportDir": "markdown \u5BFC\u51FA\u76EE\u5F55",
  "settings.distill": "\u8FC1\u79FB\u65F6\u84B8\u998F\u7B80\u62A5",
  "settings.distillModel": "\u84B8\u998F\u6A21\u578B",
  "settings.announce": "\u5411 agent \u516C\u544A\u672C\u63D2\u4EF6",
  "settings.actions": "\u64CD\u4F5C",
  "settings.where": "\u4EE5\u4E0A\u53C2\u6570\u5728\u300C\u63D2\u4EF6\u300D\u9875\u7684 dsh-DSchat \u884C\u91CC\u7F16\u8F91\uFF0C\u6539\u5B8C\u5373\u65F6\u751F\u6548\u3002\u6D4F\u89C8\u5668 profile \u9ED8\u8BA4\u590D\u7528 dsh-webchat \u7684\u76EE\u5F55\uFF0C\u6240\u4EE5\u5207\u6362\u63D2\u4EF6\u4E0D\u9700\u8981\u91CD\u65B0\u767B\u5F55\u3002",
  "settings.loading": "\u6B63\u5728\u8BFB\u53D6\u8FD0\u884C\u53C2\u6570\u2026",
  "settings.auto": "\u81EA\u52A8",
  "status.stopped": "\u672A\u542F\u52A8",
  "status.launching": "\u6B63\u5728\u542F\u52A8\u6D4F\u89C8\u5668",
  "status.needLogin": "\u672A\u767B\u5F55",
  "status.ready": "\u5DF2\u5C31\u7EEA",
  "status.thinking": "\u6B63\u5728\u601D\u8003",
  "status.streaming": "\u6B63\u5728\u8F93\u51FA",
  "status.error": "\u5F15\u64CE\u9519\u8BEF",
  "action.openLogin": "\u6253\u5F00\u767B\u5F55\u7A97\u53E3",
  "action.closeBrowser": "\u5173\u95ED\u6D4F\u89C8\u5668",
  "action.newChat": "\u65B0\u5BF9\u8BDD",
  "action.newChat.hint": "\u65B0\u5BF9\u8BDD\uFF08\u2318\u21E7O\uFF09",
  "action.recover": "\u4ECE\u7F51\u9875\u6062\u590D",
  "action.recover.hint": "\u628A\u7F51\u9875\u7AEF\u5DF2\u6709\u4F46\u672C\u5730\u672A\u6536\u5F55\u7684\u4F1A\u8BDD\u62C9\u56DE\u6765\uFF1B\u672C\u5730\u5DF2\u6536\u5F55\u4F46\u5185\u5BB9\u4E0D\u5168\u7684\u4F1A\u5C31\u5730\u8865\u5168",
  "action.stop": "\u505C\u6B62",
  "action.send": "\u53D1\u9001",
  "action.startTransfer": "\u5F00\u59CB\u8FC1\u79FB",
  "action.exportFile": "\u5BFC\u51FA markdown",
  "rail.search": "\u641C\u7D22\u4F1A\u8BDD\u2026",
  "rail.search.hint": "\u641C\u7D22\u4F1A\u8BDD\u5185\u5BB9\uFF08\u2318K\uFF09",
  "rail.search.clear": "\u6E05\u7A7A\u641C\u7D22",
  "rail.show": "\u663E\u793A\u4F1A\u8BDD\u5217\u8868",
  "rail.hide": "\u6536\u8D77\u4F1A\u8BDD\u5217\u8868",
  "rail.empty": "\u8FD8\u6CA1\u6709\u5BF9\u8BDD\uFF0C\u70B9\u6807\u9898\u680F\u7684\u300C\uFF0B\u300D\u5F00\u59CB",
  "rail.noMatch": "\u6CA1\u6709\u5339\u914D\u7684\u4F1A\u8BDD",
  "rail.clear": "\u6E05\u7A7A\u5168\u90E8",
  "rail.clearConfirm": "\u786E\u8BA4\u6E05\u7A7A\uFF1F",
  "rail.resize": "\u62D6\u52A8\u8C03\u6574\u4F1A\u8BDD\u5217\u8868\u5BBD\u5EA6\uFF08\u53CC\u51FB\u6062\u590D\u9ED8\u8BA4\uFF09",
  "item.rename": "\u91CD\u547D\u540D",
  "item.rename.placeholder": "\u4F1A\u8BDD\u6807\u9898",
  "item.delete": "\u5220\u9664\uFF08\u53EF\u64A4\u9500\uFF09",
  "item.rename.ok": "\u786E\u8BA4\u91CD\u547D\u540D",
  "item.rename.cancel": "\u53D6\u6D88",
  "chats.count": "{count} \u6761",
  "time.justNow": "\u521A\u521A",
  "time.minutes": "{count} \u5206\u949F\u524D",
  "time.hours": "{count} \u5C0F\u65F6\u524D",
  "time.days": "{count} \u5929\u524D",
  "settings.yes": "\u662F",
  "settings.no": "\u5426",
  "empty.title": "\u5728 DSH \u91CC\u76F4\u63A5\u804A DeepSeek \u7F51\u9875\u7AEF",
  "empty.body": "\u590D\u7528\u4F60\u7684\u7F51\u9875\u767B\u5F55\u4F1A\u8BDD\uFF0C\u4E0D\u6D88\u8017 API \u989D\u5EA6\u3002\u804A\u5B8C\u53EF\u4EE5\u4E00\u952E\u84B8\u998F\u6210\u4EFB\u52A1\u7B80\u62A5\uFF0C\u5728 harness \u91CC\u7EE7\u7EED\u5F00\u53D1\u3002",
  "composer.placeholder": "\u7ED9 DeepSeek \u7F51\u9875\u7AEF\u53D1\u6D88\u606F\u2026",
  "composer.busy": "\u7B49\u5F85\u7F51\u9875\u7AEF\u56DE\u590D\u2026",
  "composer.notLoggedIn": "\u8BF7\u5148\u5B8C\u6210 DeepSeek \u7F51\u9875\u767B\u5F55",
  "composer.offline": "\u7F51\u9875\u7AEF\u672A\u542F\u52A8 \xB7 \u70B9\u8FD9\u91CC\u542F\u52A8",
  "composer.connecting": "\u6B63\u5728\u542F\u52A8\u7F51\u9875\u7AEF\u2026",
  "composer.attach.drop": "\u677E\u5F00\u5373\u53EF\u6DFB\u52A0\u6587\u4EF6",
  "composer.upload": "\u4E0A\u4F20\u6587\u4EF6",
  "composer.upload.hint": "\u6253\u5F00 Finder \u9009\u62E9\u6587\u4EF6\uFF0C\u4E0A\u4F20\u5230 DeepSeek \u7F51\u9875\u7AEF\uFF08\u56FE\u7247\u3001PDF\u3001Word\u3001Excel\u3001PPT\u3001txt \u7B49\uFF09",
  "composer.upload.busy": "\u4E0A\u4F20\u4E2D\u2026",
  "composer.hint.focus": "\u805A\u7126",
  "composer.hint.stop": "\u505C\u6B62",
  "toggle.deepThink": "\u6DF1\u5EA6\u601D\u8003",
  "toggle.search": "\u667A\u80FD\u641C\u7D22",
  "toggle.deepThink.hint": "\u8BA9\u7F51\u9875\u7AEF\u5148\u505A\u4E00\u8F6E\u63A8\u7406\u518D\u56DE\u7B54\uFF08DeepSeek \u7684 R1 \u6DF1\u5EA6\u601D\u8003\u6A21\u5F0F\uFF09\u3002\u5F00\u542F\u540E\u56DE\u590D\u66F4\u6162\uFF0C\u4F46\u590D\u6742\u95EE\u9898\u66F4\u7A33\u3002",
  "toggle.search.hint": "\u667A\u80FD\u641C\u7D22\uFF1A\u8BA9\u7F51\u9875\u7AEF\u81EA\u5DF1\u5224\u65AD\u662F\u5426\u9700\u8981\u68C0\u7D22\u4E92\u8054\u7F51\uFF0C\u5E76\u5728\u56DE\u7B54\u91CC\u9644\u4E0A\u53C2\u8003\u6765\u6E90\u3002\u5173\u95ED\u65F6\u53EA\u7528\u6A21\u578B\u81EA\u8EAB\u7684\u77E5\u8BC6\u56DE\u7B54\u3002",
  "composer.preparing": "\u6B63\u5728\u65B0\u5EFA\u5BF9\u8BDD\u2026",
  "msg.you": "\u4F60",
  "msg.model": "DeepSeek",
  "msg.model.think": "DeepSeek \xB7 \u6DF1\u5EA6\u601D\u8003",
  "msg.copy": "\u590D\u5236\u56DE\u590D",
  "msg.copyThinking": "\u590D\u5236\u601D\u8003\u8FC7\u7A0B",
  "msg.regenerate": "\u91CD\u65B0\u751F\u6210",
  "msg.edit": "\u7F16\u8F91\u91CD\u53D1",
  "msg.quote": "\u5F15\u7528\u5230\u8F93\u5165\u6846",
  "msg.retry": "\u91CD\u8BD5",
  "msg.sources.count": "\u53C2\u8003\u6765\u6E90\uFF08{count}\uFF09",
  "msg.thought": "\u5DF2\u601D\u8003",
  "msg.thought.running": "\u601D\u8003\u4E2D\u2026",
  "msg.thought.prefix": "\u601D\u8003\u4E2D\uFF1A",
  "msg.thought.seconds": "\u5DF2\u601D\u8003\uFF08\u7528\u65F6 {seconds} \u79D2\uFF09",
  "msg.thought.minutes": "\u5DF2\u601D\u8003\uFF08\u7528\u65F6 {minutes} \u5206 {seconds} \u79D2\uFF09",
  "phase.idle": "\u5C31\u7EEA",
  "phase.busy": "\u5904\u7406\u4E2D",
  "phase.elapsed": "\u5DF2\u7528\u65F6 {time}",
  "phase.chars": "\u672C\u8F6E\u5DF2\u8F93\u51FA {count} \u5B57",
  "phase.loggedIn": "\u7F51\u9875\u4F1A\u8BDD \u5DF2\u767B\u5F55",
  "phase.notLoggedIn": "\u7F51\u9875\u4F1A\u8BDD \u672A\u767B\u5F55",
  "phase.turns": "\u672C\u4F1A\u8BDD {count} \u6761\u6D88\u606F",
  "phase.replyPartial": "\u56DE\u590D\u53EF\u80FD\u4E0D\u5B8C\u6574",
  "transfer.title": "\u5728 Harness \u4E2D\u7EE7\u7EED",
  "transfer.sub": "\u628A\u8FD9\u6BB5\u7F51\u9875\u5BF9\u8BDD\u5E26\u8FDB\u4E00\u4E2A harness \u4F1A\u8BDD",
  "transfer.mode": "\u8FC1\u79FB\u65B9\u5F0F",
  "transfer.mode.distill": "\u84B8\u998F\u6210\u4EFB\u52A1\u7B80\u62A5",
  "transfer.mode.raw": "\u539F\u6587\u5B8C\u6574\u8FC1\u79FB",
  "transfer.mode.distill.hint": "\u538B\u7F29\u6210\u53EF\u6267\u884C\u7B80\u62A5\uFF1A\u76EE\u6807\u3001\u7EA6\u675F\u3001\u5DF2\u5B8C\u6210\u3001\u5F85\u529E",
  "transfer.mode.raw.hint": "\u5B8C\u6574\u4FDD\u7559\u9010\u5B57\u8BB0\u5F55\uFF0C\u4F5C\u4E3A\u4E0A\u4E0B\u6587\u9644\u5728\u9996\u6761\u6D88\u606F",
  "transfer.target": "\u76EE\u6807",
  "transfer.target.new": "\u65B0\u5EFA\u4F1A\u8BDD",
  "transfer.target.continue": "\u8FFD\u52A0\u5230\u5DF2\u6709\u4F1A\u8BDD",
  "transfer.continueTo": "\u7EE7\u7EED\u5230",
  "transfer.continue.empty": "\u6CA1\u6709\u53EF\u8FFD\u52A0\u7684\u4F1A\u8BDD\uFF1A\u5DF2\u6253\u5F00\u6216\u8FD0\u884C\u4E2D\u7684\u4F1A\u8BDD\u4E0D\u80FD\u8FFD\u52A0\uFF0C\u5176\u65E5\u5FD7\u7531\u81EA\u5DF1\u7684\u4F1A\u8BDD\u6301\u6709",
  "transfer.workspace": "\u5DE5\u4F5C\u533A",
  "transfer.ungrouped": "\u672A\u5206\u7EC4",
  "transfer.workspace.new": "\u65B0\u5EFA\u5DE5\u4F5C\u533A",
  "transfer.note.new": "\u8FC1\u79FB\u540E\u81EA\u52A8\u6253\u5F00\u65B0\u4F1A\u8BDD",
  "transfer.note.continue": "\u8FFD\u52A0\u4E3A\u5DF2\u6709\u4F1A\u8BDD\u7684\u65B0\u6D88\u606F",
  "transfer.step.distill": "\u84B8\u998F\u5BF9\u8BDD\u4E3A\u4EFB\u52A1\u7B80\u62A5",
  "transfer.step.session": "\u521B\u5EFA harness \u4F1A\u8BDD",
  "transfer.step.open": "\u6253\u5F00\u4F1A\u8BDD",
  "toast.copied": "\u5DF2\u590D\u5236",
  "toast.send.failed": "\u53D1\u9001\u5931\u8D25\uFF1A{error}",
  "toast.wake.failed": "\u542F\u52A8\u7F51\u9875\u7AEF\u5931\u8D25\uFF1A{error}",
  "toast.send.needLogin": "\u8FD8\u6CA1\u6709\u767B\u5F55 DeepSeek \u7F51\u9875\u7AEF\uFF1A\u5728\u5F39\u51FA\u7684\u7A97\u53E3\u91CC\u5B8C\u6210\u767B\u5F55\u540E\uFF0C\u6D88\u606F\u5C31\u80FD\u53D1\u51FA\u53BB\u4E86\uFF08\u5185\u5BB9\u5DF2\u4FDD\u7559\uFF09\u3002",
  "toast.thinkingCopied": "\u5DF2\u590D\u5236\u601D\u8003\u8FC7\u7A0B",
  "toast.codeCopied": "\u5DF2\u590D\u5236\u4EE3\u7801\u5757",
  "toast.attach.failed": "\u6DFB\u52A0\u6587\u4EF6\u5931\u8D25\uFF1A{error}",
  "toast.attach.tooBig": "\u300C{name}\u300D\u8D85\u8FC7 {limit}\uFF0C\u6CA1\u6709\u6DFB\u52A0",
  "toast.attach.tooMany": "\u4E00\u6B21\u6700\u591A\u6DFB\u52A0 {limit} \u4E2A\u6587\u4EF6\uFF0C\u591A\u4F59\u7684\u6CA1\u6709\u6DFB\u52A0",
  "toast.rename.done": "\u5DF2\u91CD\u547D\u540D",
  "toast.rename.failed": "\u91CD\u547D\u540D\u5931\u8D25\uFF1A{error}",
  "toast.delete.done": "\u5DF2\u5220\u9664\u300C{title}\u300D",
  "toast.delete.failed": "\u5220\u9664\u5931\u8D25\uFF1A{error}",
  "toast.undo": "\u64A4\u9500",
  "toast.restored": "\u5DF2\u6062\u590D",
  "toast.clear.done": "\u5DF2\u6E05\u7A7A\u5168\u90E8\u5BF9\u8BDD",
  "toast.clear.failed": "\u6E05\u7A7A\u5931\u8D25\uFF1A{error}",
  "toast.export.done": "\u5DF2\u5BFC\u51FA\u5230 {file}",
  "toast.export.failed": "\u5BFC\u51FA\u5931\u8D25\uFF1A{error}",
  "toast.transfer.done": "\u5DF2\u521B\u5EFA\u4F1A\u8BDD\u5E76\u6253\u5F00",
  "toast.transfer.continued": "\u5DF2\u8FFD\u52A0\u5230\u4F1A\u8BDD",
  "toast.transfer.failed": "\u8FC1\u79FB\u5931\u8D25\uFF1A{error}",
  "toast.transfer.duplicate": "\u8FD9\u4EFD\u7B80\u62A5\u5DF2\u7ECF\u5728\u76EE\u6807\u4F1A\u8BDD\u91CC\uFF0C\u6CA1\u6709\u91CD\u590D\u8FFD\u52A0",
  "toast.transfer.retry": "\u91CD\u8BD5",
  "toast.recover.empty": "\u7F51\u9875\u7AEF\u6CA1\u6709\u672A\u540C\u6B65\u7684\u4F1A\u8BDD",
  "toast.recover.progress": "\u6B63\u5728\u6062\u590D {done}/{total}\uFF1A{title}",
  "toast.recover.summary": "\u5DF2\u4ECE\u7F51\u9875\u6062\u590D {count}/{total} \u4E2A\u4F1A\u8BDD\uFF0C\u5171 {messages} \u6761\u6D88\u606F\uFF08\u5176\u4E2D {refreshed} \u4E2A\u8865\u5168\u4E86\u539F\u5148\u4E0D\u5B8C\u6574\u7684\u8BB0\u5F55\uFF09",
  "toast.recover.failed": "\u90E8\u5206\u4F1A\u8BDD\u6062\u590D\u5931\u8D25\uFF1A{list}",
  "toast.open": "\u6253\u5F00",
  "toast.open.failed": "\u4F1A\u8BDD\u5DF2\u521B\u5EFA\uFF0C\u4F46\u672C\u9875\u8FD8\u6CA1\u6536\u5230\u5B83\u2014\u2014\u8BF7\u5728\u5DE6\u4FA7\u4F1A\u8BDD\u5217\u8868\u4E2D\u70B9\u5F00",
  "toast.workspace.created": "\u5DF2\u521B\u5EFA\u5DE5\u4F5C\u533A\u300C{title}\u300D",
  "toast.workspace.failed": "\u521B\u5EFA\u5DE5\u4F5C\u533A\u5931\u8D25\uFF1A{error}",
  "error.NEED_LOGIN": "\u9700\u8981\u5148\u5B8C\u6210 DeepSeek \u7F51\u9875\u767B\u5F55",
  "error.PAGE_CHANGED": "\u7F51\u9875\u7AEF\u9875\u9762\u7ED3\u6784\u7591\u4F3C\u6539\u7248\uFF0C\u8BF7\u5347\u7EA7\u63D2\u4EF6",
  "error.TIMEOUT": "\u751F\u6210\u8D85\u65F6\uFF0C\u53EF\u91CD\u8BD5",
  "error.NETWORK": "\u7F51\u7EDC\u6216\u6D4F\u89C8\u5668\u9519\u8BEF\uFF0C\u8BF7\u68C0\u67E5\u540E\u91CD\u8BD5"
};
var en = {
  "nav.label": "DSchat",
  "panel.title": "DSchat",
  "settings.title": "DSchat",
  "settings.description": "DeepSeek web chat and harness handoff settings",
  "settings.status": "Status",
  "settings.phase": "Engine",
  "settings.login": "Web sign-in",
  "settings.login.yes": "Signed in",
  "settings.login.no": "Signed out",
  "settings.login.unknown": "Unknown",
  "settings.page": "Current page",
  "settings.lastError": "Last error",
  "settings.runtime": "Runtime",
  "settings.channel": "Browser channel",
  "settings.headless": "Headless while chatting",
  "settings.proxy": "Proxy",
  "settings.timeout": "Reply timeout",
  "settings.executable": "Browser executable",
  "settings.dataDir": "Data directory",
  "settings.profileDir": "Browser profile (sign-in)",
  "settings.exportDir": "Markdown export folder",
  "settings.distill": "Distill on hand-off",
  "settings.distillModel": "Distillation model",
  "settings.announce": "Announce to the agent",
  "settings.actions": "Actions",
  "settings.where": "These values are edited on the Plugins page under the dsh-DSchat row and apply immediately. The browser profile defaults to the dsh-webchat one, so switching plugins needs no second sign-in.",
  "settings.loading": "Reading runtime settings\u2026",
  "settings.auto": "auto",
  "status.stopped": "Not started",
  "status.launching": "Starting browser",
  "status.needLogin": "Not signed in",
  "status.ready": "Ready",
  "status.thinking": "Thinking",
  "status.streaming": "Streaming",
  "status.error": "Engine error",
  "action.openLogin": "Open login window",
  "action.closeBrowser": "Close browser",
  "action.newChat": "New chat",
  "action.newChat.hint": "New chat (\u2318\u21E7O)",
  "action.recover": "Recover from web",
  "action.recover.hint": "Pull in conversations that exist on the web but not locally; short local copies are filled in place",
  "action.stop": "Stop",
  "action.send": "Send",
  "action.startTransfer": "Start transfer",
  "action.exportFile": "Export markdown",
  "rail.search": "Search conversations\u2026",
  "rail.search.hint": "Search conversation text (\u2318K)",
  "rail.search.clear": "Clear search",
  "rail.show": "Show conversation list",
  "rail.hide": "Hide conversation list",
  "rail.empty": "No conversations yet \u2014 start a new chat",
  "rail.noMatch": "No matching conversation",
  "rail.clear": "Clear all",
  "rail.clearConfirm": "Clear all?",
  "rail.resize": "Drag to resize the conversation list (double-click to reset)",
  "item.rename": "Rename",
  "item.rename.placeholder": "Conversation title",
  "item.delete": "Delete (undoable)",
  "item.rename.ok": "Confirm rename",
  "item.rename.cancel": "Cancel",
  "chats.count": "{count} messages",
  "time.justNow": "just now",
  "time.minutes": "{count}m ago",
  "time.hours": "{count}h ago",
  "time.days": "{count}d ago",
  "settings.yes": "yes",
  "settings.no": "no",
  "empty.title": "Talk to DeepSeek web right inside DSH",
  "empty.body": "Reuses your web sign-in instead of API billing. When you are done, distill the chat into a task brief and keep going in a harness session.",
  "composer.placeholder": "Message DeepSeek web\u2026",
  "composer.busy": "Waiting for the web reply\u2026",
  "composer.notLoggedIn": "Sign in to DeepSeek web first",
  "composer.offline": "Web engine is off \xB7 click to start",
  "composer.connecting": "Starting the web engine\u2026",
  "composer.attach.drop": "Drop to attach",
  "composer.upload": "Upload file",
  "composer.upload.hint": "Open Finder and upload a file to the DeepSeek web page (images, PDF, Word, Excel, PPT, txt \u2026)",
  "composer.upload.busy": "Uploading\u2026",
  "composer.hint.focus": "focus",
  "composer.hint.stop": "stop",
  "toggle.deepThink": "Deep think",
  "toggle.search": "Smart search",
  "toggle.deepThink.hint": "Have the web model run a reasoning pass before answering (DeepSeek R1 deep-think mode). Slower, but steadier on hard questions.",
  "toggle.search.hint": "Smart search: let the web model decide whether to search the internet and cite its sources. Off, it answers from its own knowledge only.",
  "composer.preparing": "Starting a new conversation\u2026",
  "msg.you": "You",
  "msg.model": "DeepSeek",
  "msg.model.think": "DeepSeek \xB7 deep think",
  "msg.copy": "Copy reply",
  "msg.copyThinking": "Copy thinking process",
  "msg.regenerate": "Regenerate",
  "msg.edit": "Edit and resend",
  "msg.quote": "Quote into composer",
  "msg.retry": "Retry",
  "msg.sources.count": "Sources ({count})",
  "msg.thought": "Thought",
  "msg.thought.running": "Thinking\u2026",
  "msg.thought.prefix": "Thinking: ",
  "msg.thought.seconds": "Thought for {seconds}s",
  "msg.thought.minutes": "Thought for {minutes}m {seconds}s",
  "phase.idle": "Ready",
  "phase.busy": "Working",
  "phase.elapsed": "elapsed {time}",
  "phase.chars": "{count} characters this turn",
  "phase.loggedIn": "Web session signed in",
  "phase.notLoggedIn": "Web session signed out",
  "phase.turns": "{count} messages in this chat",
  "phase.replyPartial": "Reply may be incomplete",
  "transfer.title": "Continue in Harness",
  "transfer.sub": "Carry this web conversation into a harness session",
  "transfer.mode": "Hand-off",
  "transfer.mode.distill": "Distill to brief",
  "transfer.mode.raw": "Replay transcript",
  "transfer.mode.distill.hint": "Condenses into goal, constraints, done, and next steps",
  "transfer.mode.raw.hint": "Keeps every message verbatim as context",
  "transfer.target": "Target",
  "transfer.target.new": "New session",
  "transfer.target.continue": "Existing session",
  "transfer.continueTo": "Continue into",
  "transfer.continue.empty": "No session can receive an append: an open or running session holds its own log",
  "transfer.workspace": "Workspace",
  "transfer.ungrouped": "Ungrouped",
  "transfer.workspace.new": "New workspace",
  "transfer.note.new": "Opens the new session when done",
  "transfer.note.continue": "Appends as a new message in that session",
  "transfer.step.distill": "Distilling the conversation",
  "transfer.step.session": "Creating the harness session",
  "transfer.step.open": "Opening the session",
  "toast.copied": "Copied",
  "toast.send.failed": "Could not send: {error}",
  "toast.wake.failed": "Could not start the web engine: {error}",
  "toast.send.needLogin": "Not signed in to DeepSeek web yet: finish signing in in the window that just opened and the message can go out (your text is kept).",
  "toast.thinkingCopied": "Thinking process copied",
  "toast.codeCopied": "Code copied",
  "toast.attach.failed": "Could not attach the file: {error}",
  "toast.attach.tooBig": '"{name}" is over {limit} and was not added',
  "toast.attach.tooMany": "At most {limit} files at a time; the extras were not added",
  "toast.rename.done": "Renamed",
  "toast.rename.failed": "Rename failed: {error}",
  "toast.delete.done": 'Deleted "{title}"',
  "toast.delete.failed": "Delete failed: {error}",
  "toast.undo": "Undo",
  "toast.restored": "Restored",
  "toast.clear.done": "Cleared all conversations",
  "toast.clear.failed": "Clear failed: {error}",
  "toast.export.done": "Exported to {file}",
  "toast.export.failed": "Export failed: {error}",
  "toast.transfer.done": "Session created and opened",
  "toast.transfer.continued": "Appended to the session",
  "toast.transfer.failed": "Transfer failed: {error}",
  "toast.transfer.duplicate": "That brief is already in the target session; nothing was appended",
  "toast.transfer.retry": "Retry",
  "toast.recover.empty": "No unsynced web conversations",
  "toast.recover.progress": "Recovering {done}/{total}: {title}",
  "toast.recover.summary": "Recovered {count}/{total} conversations ({messages} messages); {refreshed} of them replaced a shorter local copy",
  "toast.recover.failed": "Some conversations could not be recovered: {list}",
  "toast.open": "Open",
  "toast.open.failed": "The session was created, but this page has not received it yet \u2014 open it from the session list",
  "toast.workspace.created": 'Workspace "{title}" created',
  "toast.workspace.failed": "Could not create workspace: {error}",
  "error.NEED_LOGIN": "Sign in to DeepSeek web first",
  "error.PAGE_CHANGED": "The web page structure changed \u2014 upgrade this plugin",
  "error.TIMEOUT": "Generation timed out \u2014 try again",
  "error.NETWORK": "Network or browser error \u2014 check and retry"
};

// src/client/panel/DSchatPanel.tsx
var import_react3 = require("react");

// src/client/status.ts
var import_react = require("react");
var UNKNOWN = { phase: "stopped", detail: "", loggedIn: null, canOpenLogin: false };
var current = UNKNOWN;
var listeners = /* @__PURE__ */ new Set();
var translate;
function statusDetail(phase, engineError) {
  const tr = (key, fallback) => translate?.(key) ?? fallback;
  switch (phase) {
    case "launching":
      return tr("status.launching", "\u6B63\u5728\u542F\u52A8\u6D4F\u89C8\u5668");
    case "need-login":
      return tr("status.needLogin", "\u672A\u767B\u5F55");
    case "error": {
      const head = tr("status.error", "\u5F15\u64CE\u9519\u8BEF");
      return engineError === void 0 ? head : `${head}\uFF1A${engineError}`;
    }
    case "thinking":
      return tr("status.thinking", "\u6B63\u5728\u601D\u8003");
    case "streaming":
      return tr("status.streaming", "\u6B63\u5728\u8F93\u51FA");
    case "ready":
      return tr("status.ready", "\u5DF2\u5C31\u7EEA");
    default:
      return tr("status.stopped", "\u672A\u542F\u52A8");
  }
}
function modelOf(state) {
  const active = state.chats.find((chat) => chat.id === state.activeChatId) ?? state.chats[0];
  return active?.model ?? "deepseek-chat";
}
function touchEngineStatus(state) {
  const phase = phaseOf({
    engine: state.engine,
    loggedIn: state.loggedIn,
    busy: state.busy,
    chats: state.chats
  });
  const text = statusDetail(phase, state.engineError);
  set({
    phase,
    detail: phase === "ready" && state.loggedIn === true ? `${text} \xB7 ${modelOf(state)}` : text,
    loggedIn: state.loggedIn,
    canOpenLogin: state.loggedIn !== true
  });
}
function set(next) {
  if (next.phase === current.phase && next.detail === current.detail && next.loggedIn === current.loggedIn && next.canOpenLogin === current.canOpenLogin) return;
  current = next;
  for (const listener of listeners) listener();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
var snapshot = () => current;
function useEngineStatus(translateFn) {
  if (translateFn !== void 0) translate = translateFn;
  const store = import_react.useSyncExternalStore;
  return store === void 0 ? current : store(subscribe, snapshot, snapshot);
}

// src/client/panel/Markdown.tsx
var import_react2 = require("react");
function esc(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function linkClick(href, options) {
  return (event) => {
    if (href === void 0 || options.onOpenLink === void 0) return;
    if (event.button !== void 0 && event.button !== 0) return;
    if (event.metaKey === true || event.ctrlKey === true || event.shiftKey === true || event.altKey === true) return;
    if (options.onOpenLink(href) === false) return;
    event.preventDefault();
  };
}
function citationNumbers(body) {
  const numbers = [];
  const push = (value) => {
    if (!Number.isInteger(value) || value < 1 || value > 9999) return;
    if (!numbers.includes(value)) numbers.push(value);
  };
  for (const token of body.split(/[,，、;；\s]+/)) {
    if (token === "") continue;
    const range = /^(\d+)\s*[-–~至]\s*(\d+)$/.exec(token);
    if (range !== null) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = end >= start ? 1 : -1;
      for (let value = start; value !== end + step && Math.abs(value - start) <= 20; value += step) push(value);
      continue;
    }
    const single = /^\[?(\d+)\]?$/.exec(token);
    if (single !== null) push(Number(single[1]));
  }
  return numbers.slice(0, 20);
}
function sourceLabel(source) {
  const title = source.title?.trim();
  if (title !== void 0 && title !== "") return title;
  try {
    const parsed = new URL(source.url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return source.url;
  }
}
function citation(marker, key, options) {
  const body = marker.slice("[citation:".length, -1).trim();
  const numbers = citationNumbers(body);
  const sources = options.sources;
  if (numbers.length === 0) {
    return (0, import_react2.createElement)(
      "sup",
      { key: `${key}-cite`, className: "dsh-dschat-cite" },
      (0, import_react2.createElement)("span", { className: "dsh-dschat-citation" }, body)
    );
  }
  return (0, import_react2.createElement)(
    "sup",
    { key: `${key}-cite`, className: "dsh-dschat-cite" },
    numbers.map((number) => {
      const source = sources?.[number - 1];
      const url = source?.url ?? "";
      if (url === "") {
        return (0, import_react2.createElement)("span", { key: `${key}-c${number}`, className: "dsh-dschat-citation" }, String(number));
      }
      const label = sourceLabel(source ?? { url });
      return (0, import_react2.createElement)(
        "a",
        {
          key: `${key}-c${number}`,
          className: "dsh-dschat-citation",
          href: url,
          target: "_blank",
          rel: "noopener noreferrer",
          title: `${label} \xB7 ${url}`,
          "aria-label": `${label} \xB7 ${url}`,
          onClick: linkClick(url, options)
        },
        String(number)
      );
    })
  );
}
function inline(text, keyBase = "i", options = {}) {
  const nodes = [];
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\[citation:[^\]]+\])|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let index = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(esc(text.slice(last, match.index)));
    const key = `${keyBase}-${index}`;
    if (match[1] !== void 0) {
      nodes.push((0, import_react2.createElement)("code", { key: `${key}-code` }, match[1].slice(1, -1)));
    } else if (match[2] !== void 0) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(match[2]);
      const href = link?.[2];
      nodes.push((0, import_react2.createElement)(
        "a",
        { key: `${key}-a`, href, target: "_blank", rel: "noopener noreferrer", onClick: linkClick(href, options) },
        link?.[1]
      ));
    } else if (match[3] !== void 0) {
      nodes.push(citation(match[3], key, options));
    } else if (match[4] !== void 0) {
      const inner = match[4].slice(2, -2);
      nodes.push((0, import_react2.createElement)("strong", { key: `${key}-b` }, ...inline(inner, `${key}-b`, options)));
    } else if (match[5] !== void 0) {
      const inner = match[5].slice(1, -1);
      nodes.push((0, import_react2.createElement)("em", { key: `${key}-i` }, ...inline(inner, `${key}-i`, options)));
    }
    last = re.lastIndex;
    index++;
  }
  if (last < text.length) nodes.push(esc(text.slice(last)));
  return nodes;
}
function codeBlock(language, body, key, options, copyLabel) {
  return (0, import_react2.createElement)(
    "div",
    { key, className: "dsh-dschat-code" },
    (0, import_react2.createElement)(
      "div",
      { className: "dsh-dschat-code-bar" },
      (0, import_react2.createElement)("span", null, language === "" ? "text" : language),
      (0, import_react2.createElement)("span", { className: "dsh-dschat-spacer" }),
      (0, import_react2.createElement)(
        "button",
        {
          type: "button",
          className: "dsh-dschat-code-copy",
          title: copyLabel,
          onClick: () => {
            options.onCopyCode?.(body);
          }
        },
        copyLabel
      )
    ),
    (0, import_react2.createElement)("pre", null, (0, import_react2.createElement)("code", null, body))
  );
}
function splitCells(line) {
  const cells = [];
  let current2 = "";
  let escaped = false;
  for (const ch of line) {
    if (escaped) {
      current2 += ch;
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === "|") {
      cells.push(current2);
      current2 = "";
    } else {
      current2 += ch;
    }
  }
  cells.push(current2);
  let start = 0;
  let end = cells.length;
  while (start < end && cells[start].trim() === "") start++;
  while (end > start && cells[end - 1].trim() === "") end--;
  return cells.slice(start, end).map((cell) => cell.trim());
}
function isDelimiterRow(line) {
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
function renderMarkdown(source, options = {}, copyLabel = "copy") {
  const raw = source.replace(/\r\n/g, "\n").trim();
  if (raw === "") return [];
  const blocks = [];
  const lines = raw.split("\n");
  let index = 0;
  let blockIndex = 0;
  const push = (node) => {
    blocks.push((0, import_react2.createElement)("div", { key: `b${blockIndex++}` }, node));
  };
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const fence = /^```([\w+-]*)\s*$/.exec(trimmed);
    if (fence !== null) {
      const language = fence[1] ?? "";
      const body = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        body.push(lines[index]);
        index++;
      }
      index++;
      push(codeBlock(language, body.join("\n"), `code${blockIndex}`, options, copyLabel));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      const level = heading[1].length;
      push((0, import_react2.createElement)(`h${level}`, null, ...inline(heading[2], `h${blockIndex}`, options)));
      index++;
      continue;
    }
    if (line.includes("|") && lines[index + 1] !== void 0 && isDelimiterRow(lines[index + 1])) {
      const header = splitCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length) {
        const row = lines[index];
        if (row.trim() === "" || !row.includes("|")) break;
        rows.push(splitCells(row));
        index++;
      }
      const width = Math.max(header.length, ...rows.map((row) => row.length));
      const rowNode = (cells, rowIndex) => (0, import_react2.createElement)("tr", { key: rowIndex }, Array.from({ length: width }, (_, col) => (0, import_react2.createElement)("td", { key: col }, ...inline(cells[col] ?? "", `t${blockIndex}-${rowIndex}-${col}`, options))));
      blocks.push((0, import_react2.createElement)(
        "div",
        { key: `tw${blockIndex}`, className: "dsh-dschat-table-wrap" },
        (0, import_react2.createElement)(
          "table",
          { className: "dsh-dschat-table", key: `t${blockIndex}` },
          (0, import_react2.createElement)("thead", null, (0, import_react2.createElement)("tr", null, header.map((cell, col) => (0, import_react2.createElement)("th", { key: col }, ...inline(cell, `th${blockIndex}-${col}`, options))))),
          (0, import_react2.createElement)("tbody", null, rows.map(rowNode))
        )
      ));
      blockIndex++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      push((0, import_react2.createElement)("hr", { key: `hr${blockIndex}` }));
      index++;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index++;
      }
      push((0, import_react2.createElement)("blockquote", { key: `q${blockIndex}` }, ...renderMarkdown(quote.join("\n"), options, copyLabel)));
      continue;
    }
    if (/^<details>/.test(trimmed)) {
      const body = [];
      let summary = /^<details>\s*<summary>\s*([\s\S]*?)\s*<\/summary>/.exec(trimmed)?.[1];
      index++;
      while (index < lines.length && !/^<\/details>/.test(lines[index].trim())) {
        const line2 = lines[index];
        if (summary === void 0) {
          const own = /^<summary>\s*([\s\S]*?)\s*<\/summary>/.exec(line2.trim());
          if (own !== null) {
            summary = own[1];
            index++;
            continue;
          }
        }
        body.push(line2);
        index++;
      }
      index++;
      blocks.push((0, import_react2.createElement)(
        "div",
        { key: `d${blockIndex++}` },
        (0, import_react2.createElement)(Thinking, {
          source: body.join("\n"),
          label: summary ?? "details",
          options,
          ...copyLabel === void 0 ? {} : { copyLabel }
        })
      ));
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*+]\s+/, ""));
        index++;
      }
      push((0, import_react2.createElement)("ul", { key: `ul${blockIndex}` }, items.map((item, itemIndex) => (0, import_react2.createElement)("li", { key: itemIndex }, ...inline(item, `uli${blockIndex}-${itemIndex}`, options)))));
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ""));
        index++;
      }
      push((0, import_react2.createElement)("ol", { key: `ol${blockIndex}` }, items.map((item, itemIndex) => (0, import_react2.createElement)("li", { key: itemIndex }, ...inline(item, `oli${blockIndex}-${itemIndex}`, options)))));
      continue;
    }
    const paragraph = [];
    while (index < lines.length) {
      const current2 = lines[index].trim();
      if (current2 === "") break;
      if (/^(```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|<\/?(details|table)>)/.test(current2)) break;
      if (current2.includes("|") && lines[index + 1] !== void 0 && isDelimiterRow(lines[index + 1])) break;
      paragraph.push(current2);
      index++;
    }
    if (paragraph.length === 0) {
      index++;
      continue;
    }
    push((0, import_react2.createElement)("p", { key: `p${blockIndex}` }, ...inline(paragraph.join("\n"), `p${blockIndex}`, options)));
  }
  return blocks;
}
function ThinkingLive({ text, prefix }) {
  const tailRef = (0, import_react2.useRef)(null);
  useBrowserLayoutEffect(() => {
    const element = tailRef.current;
    if (element === null) return;
    const line = element.parentElement;
    const shift = () => {
      const overflow = element.scrollWidth - (line?.clientWidth ?? 0);
      element.style.transform = overflow > 0 ? `translateX(${-overflow}px)` : "";
    };
    shift();
    if (typeof ResizeObserver === "undefined" || line === null) return;
    const observer = new ResizeObserver(shift);
    observer.observe(line);
    return () => observer.disconnect();
  }, [text]);
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  return (0, import_react2.createElement)(
    "span",
    { className: "dsh-dschat-think-live" },
    (0, import_react2.createElement)("span", { className: "dsh-dschat-think-live-prefix" }, prefix),
    (0, import_react2.createElement)(
      "span",
      { className: "dsh-dschat-think-live-clip" },
      (0, import_react2.createElement)("span", { className: "dsh-dschat-think-live-tail", ref: tailRef }, flat)
    )
  );
}
var useBrowserLayoutEffect = typeof window === "undefined" ? import_react2.useEffect : import_react2.useLayoutEffect;
function thinkingIsLive(thinkingMs, streaming) {
  return thinkingMs === void 0 && streaming === true;
}
var COLLAPSE_HINT = "\u70B9\u51FB\u6536\u8D77\u601D\u8003\u8FC7\u7A0B";
function collapseFromBodyClick(target) {
  if (target instanceof Element && target.closest("a, button") !== null) return false;
  if (typeof window === "undefined") return true;
  const selection = window.getSelection();
  if (selection !== null && selection.isCollapsed === false && selection.toString() !== "") return false;
  return true;
}
function Thinking({ source, label, options = {}, copyLabel, thinkingMs, streaming, liveLabel }) {
  const live = thinkingIsLive(thinkingMs, streaming);
  const [open, setOpen] = (0, import_react2.useState)(live);
  const bodyRef = (0, import_react2.useRef)(null);
  const wasLive = (0, import_react2.useRef)(live);
  (0, import_react2.useEffect)(() => {
    if (live) {
      wasLive.current = true;
      setOpen(true);
      return;
    }
    if (wasLive.current) {
      wasLive.current = false;
      setOpen(false);
    }
  }, [live]);
  (0, import_react2.useEffect)(() => {
    if (!open || !live) return;
    const element = bodyRef.current;
    if (element === null) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance < 48) element.scrollTop = element.scrollHeight;
  }, [open, live, source]);
  return (0, import_react2.createElement)(
    "div",
    { className: "dsh-dschat-think", "data-open": open ? "true" : void 0, "data-live": live ? "true" : void 0 },
    open ? (0, import_react2.createElement)(
      "div",
      {
        className: "dsh-dschat-think-body dsh-dschat-scroll",
        ref: bodyRef,
        /*
         * The expanded face is its own collapse control: the summary line is
         * not on screen, so the body has to be clickable. Announced as a
         * button (it IS one) with an always-true `aria-expanded`, so the
         * state is readable without seeing the missing line.
         */
        role: "button",
        tabIndex: 0,
        title: COLLAPSE_HINT,
        "aria-expanded": true,
        onClick: (event) => {
          if (collapseFromBodyClick(event.target)) setOpen(false);
        },
        onKeyDown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          if (collapseFromBodyClick(event.target) === false) return;
          event.preventDefault?.();
          setOpen(false);
        }
      },
      ...renderMarkdown(source, options, copyLabel ?? "copy")
    ) : (0, import_react2.createElement)(
      "button",
      {
        type: "button",
        className: "dsh-dschat-think-head",
        "aria-expanded": false,
        onClick: () => setOpen(true)
      },
      (0, import_react2.createElement)(ThinkIcon, { size: 13 }),
      live && liveLabel !== void 0 ? (0, import_react2.createElement)(ThinkingLive, { text: source, prefix: liveLabel }) : (0, import_react2.createElement)("span", { className: "dsh-dschat-think-label" }, label),
      (0, import_react2.createElement)(CaretIcon, { size: 11 })
    )
  );
}
function sourceRows(sources, options = {}) {
  return sources.map((source, index) => {
    const text = sourceLabel(source);
    return (0, import_react2.createElement)(
      "li",
      { key: `${source.url}-${index}` },
      (0, import_react2.createElement)("span", { className: "dsh-dschat-source-no" }, String(index + 1)),
      /*
       * A source the page named no URL for keeps its NUMBER (positions are the
       * contract) but is not a link — dropping the row would renumber every
       * source after it, which is exactly the wrong-page bug this table exists
       * to prevent.
       */
      source.url === "" ? (0, import_react2.createElement)("span", { className: "dsh-dschat-source-plain" }, text) : (0, import_react2.createElement)(
        "a",
        {
          href: source.url,
          target: "_blank",
          rel: "noopener noreferrer",
          title: `${text} \xB7 ${source.url}`,
          onClick: linkClick(source.url, options)
        },
        text
      )
    );
  });
}
function SourceList({ sources, heading, options = {} }) {
  const [open, setOpen] = (0, import_react2.useState)(false);
  return (0, import_react2.createElement)(
    "div",
    { className: "dsh-dschat-sources", "data-open": open ? "true" : void 0 },
    (0, import_react2.createElement)(
      "button",
      {
        type: "button",
        className: "dsh-dschat-sources-head",
        "aria-expanded": open,
        onClick: () => setOpen((value) => !value)
      },
      (0, import_react2.createElement)("span", null, heading),
      (0, import_react2.createElement)(CaretIcon, { size: 11 })
    ),
    open && (0, import_react2.createElement)("ol", null, ...sourceRows(sources, options))
  );
}
function Markdown({ source, onCopyCode, onOpenLink, sources, sourcesLabel, copyLabel }) {
  const options = {};
  if (onCopyCode !== void 0) options.onCopyCode = onCopyCode;
  if (onOpenLink !== void 0) options.onOpenLink = onOpenLink;
  const table = sourcesOf(sources);
  if (table !== void 0) options.sources = table;
  return (0, import_react2.createElement)(
    "div",
    null,
    ...renderMarkdown(source, options, copyLabel ?? "copy"),
    table === void 0 || sourcesLabel === void 0 ? null : (0, import_react2.createElement)(SourceList, { sources: table, heading: sourcesLabel, options })
  );
}

// src/client/panel/reply.ts
var THINKING_BLOCK = /^<details>\s*<summary>[^<]*<\/summary>([\s\S]*?)<\/details>/;
function opensWithThinking(content) {
  return content.trimStart().startsWith("<details>");
}
function replyBody(content) {
  const text = content.trimStart();
  if (!opensWithThinking(text)) return content.trim();
  const closed = THINKING_BLOCK.exec(text);
  if (closed === null) return "";
  return text.slice(closed[0].length).trim();
}
function thinkingBody(content) {
  const text = content.trimStart();
  if (!opensWithThinking(text)) return "";
  const closed = THINKING_BLOCK.exec(text);
  if (closed !== null) return (closed[1] ?? "").trim();
  const opener = text.indexOf("</summary>");
  return opener < 0 ? "" : text.slice(opener + "</summary>".length).trim();
}
function firstLine(content) {
  return replyBody(content).split("\n")[0]?.trim() ?? "";
}

// src/client/panel/DSchatPanel.tsx
function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}
function isAttachableFile(file) {
  return file.size > 0;
}
var MAX_ATTACH_BYTES = 24 * 1024 * 1024;
var MAX_ATTACH_COUNT = 10;
var MAX_ATTACH_LABEL = "24 MB";
function genericMediaType(file) {
  if (file.type !== "") return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 32768;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return { mediaType: genericMediaType(file), data: btoa(binary) };
}
var POLL_IDLE_MS = 1500;
var POLL_TAIL_MS = 100;
var POLL_TAIL_IDLE_MS = 150;
function openExternalLink(href) {
  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  try {
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}
function submitsOnEnter(event) {
  if (event.key !== "Enter" || event.shiftKey === true) return false;
  if (event.isComposing === true || event.nativeEvent?.isComposing === true) return false;
  return true;
}
var RAIL_WIDTH_DEFAULT = 238;
var RAIL_WIDTH_MIN = 170;
var RAIL_WIDTH_MAX = 460;
var RAIL_STORE = "dsh-dschat.rail.width";
var RAIL_OPEN_STORE = "dsh-dschat.rail.open";
function readStored(key) {
  try {
    return window.localStorage.getItem(key) ?? void 0;
  } catch {
    return void 0;
  }
}
function writeStored(key, value) {
  try {
    if (value === void 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
  }
}
function clampRailWidth(value) {
  if (!Number.isFinite(value)) return RAIL_WIDTH_DEFAULT;
  return Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, Math.round(value)));
}
function storedRailWidth() {
  const stored = readStored(RAIL_STORE);
  if (stored === void 0 || stored === "") return RAIL_WIDTH_DEFAULT;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampRailWidth(parsed) : RAIL_WIDTH_DEFAULT;
}
function thoughtLabel(thinkingMs, streaming, tr) {
  if (thinkingMs === void 0) return streaming ? tr("msg.thought.running") : tr("msg.thought");
  const seconds = Math.max(1, Math.round(thinkingMs / 1e3));
  if (seconds < 60) return fmt(tr("msg.thought.seconds"), { seconds: String(seconds) });
  return fmt(tr("msg.thought.minutes"), {
    minutes: String(Math.floor(seconds / 60)),
    seconds: String(seconds % 60)
  });
}
var TAIL_AFTER_SEND_MS = 8e3;
function threadKeys(messages) {
  const used = /* @__PURE__ */ new Set();
  return messages.map((message) => {
    let key = message.id;
    let suffix = 2;
    while (used.has(key)) {
      key = `${message.id}#${suffix}`;
      suffix += 1;
    }
    used.add(key);
    return key;
  });
}
function DSchatPanel(props) {
  const { api, tt, t, openSession, pickDirectory, createWorkspace, useSessions } = props;
  const tr = (0, import_react3.useCallback)(
    (key, values) => {
      const template = (t ?? tt)(key);
      return values === void 0 ? template : fmt(template, values);
    },
    [t, tt]
  );
  const [state, setState] = (0, import_react3.useState)(null);
  const [viewChatId, setViewChatId] = (0, import_react3.useState)(void 0);
  const [draft, setDraft] = (0, import_react3.useState)("");
  const [images, setImages] = (0, import_react3.useState)([]);
  const [attachBusy, setAttachBusy] = (0, import_react3.useState)(false);
  const [waking, setWaking] = (0, import_react3.useState)(false);
  const [dragging, setDragging] = (0, import_react3.useState)(false);
  const [railWidth, setRailWidth] = (0, import_react3.useState)(() => storedRailWidth());
  const [railDragging, setRailDragging] = (0, import_react3.useState)(false);
  const [railOpen, setRailOpen] = (0, import_react3.useState)(() => readStored(RAIL_OPEN_STORE) !== "0");
  const [toasts, setToasts] = (0, import_react3.useState)([]);
  const [renamingId, setRenamingId] = (0, import_react3.useState)(void 0);
  const [renameDraft, setRenameDraft] = (0, import_react3.useState)("");
  const [clearArmed, setClearArmed] = (0, import_react3.useState)(false);
  const [query, setQuery] = (0, import_react3.useState)("");
  const [searchFocus, setSearchFocus] = (0, import_react3.useState)(false);
  const [jumpId, setJumpId] = (0, import_react3.useState)(void 0);
  const [flashId, setFlashId] = (0, import_react3.useState)(void 0);
  const [deepThink, setDeepThink] = (0, import_react3.useState)(false);
  const [search, setSearch] = (0, import_react3.useState)(false);
  const [now, setNow] = (0, import_react3.useState)(() => Date.now());
  const [popOpen, setPopOpen] = (0, import_react3.useState)(false);
  const [moreOpen, setMoreOpen] = (0, import_react3.useState)(false);
  const [transferMode, setTransferMode] = (0, import_react3.useState)("distill");
  const [transferTarget, setTransferTarget] = (0, import_react3.useState)("new");
  const [targetWorkspaceId, setTargetWorkspaceId] = (0, import_react3.useState)(void 0);
  const [targetSessionId, setTargetSessionId] = (0, import_react3.useState)(void 0);
  const [stage, setStage] = (0, import_react3.useState)(0);
  const [transferring, setTransferring] = (0, import_react3.useState)(false);
  const [workspaces, setWorkspaces] = (0, import_react3.useState)([]);
  const [cwd, setCwd] = (0, import_react3.useState)(void 0);
  const listRef = (0, import_react3.useRef)(null);
  const inputRef = (0, import_react3.useRef)(null);
  const uploadRef = (0, import_react3.useRef)(null);
  const searchRef = (0, import_react3.useRef)(null);
  const transferPopRef = (0, import_react3.useRef)(null);
  const morePopRef = (0, import_react3.useRef)(null);
  const pinnedRef = (0, import_react3.useRef)(true);
  const prevChatRef = (0, import_react3.useRef)(void 0);
  const toastSeq = (0, import_react3.useRef)(0);
  const deletedRef = (0, import_react3.useRef)(/* @__PURE__ */ new Map());
  const imagesRef = (0, import_react3.useRef)([]);
  (0, import_react3.useEffect)(() => {
    imagesRef.current = images;
  }, [images]);
  const railWidthRef = (0, import_react3.useRef)(railWidth);
  const stateRef = (0, import_react3.useRef)(null);
  const tailChatRef = (0, import_react3.useRef)(void 0);
  const tailUntilRef = (0, import_react3.useRef)(0);
  const turnSeenRef = (0, import_react3.useRef)(false);
  const lastReconcileRef = (0, import_react3.useRef)(0);
  const toast = (0, import_react3.useCallback)((text, options) => {
    const id = ++toastSeq.current;
    const ttl = options?.ttl ?? (options?.action === void 0 ? 3200 : 6500);
    setToasts((list) => [...list, { id, text, error: options?.error, action: options?.action, ttl }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), ttl);
  }, []);
  (0, import_react3.useEffect)(() => {
    stateRef.current = state;
  }, [state]);
  const storeWarningShownRef = (0, import_react3.useRef)(false);
  (0, import_react3.useEffect)(() => {
    const warning = state?.storeWarning;
    if (warning === void 0 || storeWarningShownRef.current) return;
    storeWarningShownRef.current = true;
    toast(warning, { error: true, ttl: 15e3 });
  }, [state?.storeWarning, toast]);
  const refreshState = (0, import_react3.useCallback)(async () => {
    try {
      const snapshot2 = await api.state();
      if (snapshot2.ok !== true) return;
      const next = snapshot2;
      setState(next);
      setViewChatId((previous) => {
        if (previous !== void 0 && next.chats.some((chat) => chat.id === previous)) return previous;
        return next.activeChatId ?? next.chats[0]?.id;
      });
    } catch {
    }
  }, [api]);
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    let timer;
    const poll = async () => {
      if (cancelled) return;
      await refreshState();
      if (cancelled) return;
      timer = window.setTimeout(() => {
        void poll();
      }, POLL_IDLE_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refreshState]);
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    let timer;
    const wanted = () => stateRef.current?.busy === true || stateRef.current?.chats.some((chat) => chat.streaming === true) === true || Date.now() < tailUntilRef.current;
    const localAt = (chatId) => {
      const chat = stateRef.current?.chats.find((candidate) => candidate.id === chatId);
      const last = [...chat?.messages ?? []].reverse().find((item) => item.role === "assistant");
      return last?.content.length ?? 0;
    };
    const advance = (tail) => {
      setState((previous) => previous === null ? previous : mergeTail(previous, tail));
    };
    const poll = async () => {
      if (cancelled) return;
      if (wanted()) {
        const chatId = tailChatRef.current;
        if (chatId !== void 0 && stateRef.current?.chats.some((chat) => chat.id === chatId) !== true) {
          if (Date.now() - lastReconcileRef.current >= POLL_IDLE_MS) {
            lastReconcileRef.current = Date.now();
            void refreshState();
          }
        } else {
          try {
            const response = await api.tail(chatId, localAt(chatId));
            if (cancelled) return;
            if (response.ok === true) {
              const tail = response;
              advance(tail);
              if (tail.busy === true || tail.streaming === true) turnSeenRef.current = true;
              else if (turnSeenRef.current) {
                turnSeenRef.current = false;
                tailUntilRef.current = 0;
                void refreshState();
              }
            }
          } catch {
          }
        }
      }
      timer = window.setTimeout(() => {
        void poll();
      }, wanted() ? POLL_TAIL_MS : POLL_TAIL_IDLE_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, refreshState]);
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const context = await api.context();
        if (cancelled || context.ok !== true) return;
        setWorkspaces(context.workspaces ?? []);
        setCwd(context.cwd);
      } catch {
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [api]);
  (0, import_react3.useEffect)(() => {
    if (state === null) return;
    setDeepThink(state.deepThink);
    setSearch(state.search);
  }, [state?.deepThink, state?.search]);
  const busy = state?.busy ?? false;
  const preparingNewChat = state?.preparingNewChat ?? false;
  (0, import_react3.useEffect)(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [busy]);
  const startRailDrag = (0, import_react3.useCallback)((event) => {
    if (event.button !== void 0 && event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = railWidthRef.current;
    let width = startWidth;
    setRailDragging(true);
    const move = (moveEvent) => {
      width = clampRailWidth(startWidth + (moveEvent.clientX - startX));
      railWidthRef.current = width;
      setRailWidth(width);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setRailDragging(false);
      writeStored(RAIL_STORE, String(width));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, []);
  const nudgeRail = (0, import_react3.useCallback)((event) => {
    const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
    if (step === 0 && event.key !== "Home") return;
    event.preventDefault();
    const width = event.key === "Home" ? RAIL_WIDTH_DEFAULT : clampRailWidth(railWidthRef.current + step);
    railWidthRef.current = width;
    setRailWidth(width);
    writeStored(RAIL_STORE, String(width));
  }, []);
  const toggleRail = (0, import_react3.useCallback)(() => {
    setRailOpen((previous) => {
      const next = !previous;
      writeStored(RAIL_OPEN_STORE, next ? "1" : "0");
      return next;
    });
  }, []);
  const openSearch = (0, import_react3.useCallback)(() => {
    if (railOpen) {
      setSearchFocus(true);
      return;
    }
    setRailOpen(true);
    writeStored(RAIL_OPEN_STORE, "1");
    setSearchFocus(true);
  }, [railOpen]);
  (0, import_react3.useEffect)(() => {
    if (!searchFocus || !railOpen) return;
    const element = searchRef.current;
    if (element === null) return;
    element.focus();
    element.select();
    setSearchFocus(false);
  }, [searchFocus, railOpen]);
  const searchOpen = query !== "" || searchFocus;
  const COMPOSER_MAX_HEIGHT = 180;
  const resizeComposer = (0, import_react3.useCallback)(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, []);
  (0, import_react3.useEffect)(() => {
    resizeComposer();
  }, [draft, resizeComposer]);
  const chats = state?.chats ?? [];
  const viewChat = chats.find((chat) => chat.id === viewChatId) ?? chats[0];
  const phase = state === null ? "stopped" : phaseOf({ engine: state.engine, loggedIn: state.loggedIn, busy: state.busy, chats: state.chats });
  const loggedIn = state?.loggedIn ?? null;
  (0, import_react3.useEffect)(() => {
    if (state !== null) touchEngineStatus(state);
  }, [state]);
  const engine = useEngineStatus(tr);
  const engineLive = phase === "ready" || phase === "thinking" || phase === "streaming" || phase === "launching";
  const streaming = viewChat?.streaming ?? false;
  const canSend = loggedIn === true && !busy;
  const filtered = (0, import_react3.useMemo)(() => {
    if (query.trim() === "") return chats;
    const needle = query.trim().toLowerCase();
    return chats.filter((chat) => chat.title.toLowerCase().includes(needle) || chat.messages.some((message) => message.content.toLowerCase().includes(needle)));
  }, [chats, query]);
  const harnessList = useSessions === void 0 ? void 0 : useSessions((state2) => state2);
  const continuationTargets = (0, import_react3.useMemo)(() => {
    const byId = harnessList?.byId ?? {};
    return Object.values(byId).filter((row) => row !== void 0 && row.agentAvailable !== true).sort((left, right) => right.updatedAt - left.updatedAt).map((row) => ({ id: row.sessionId, title: row.title ?? row.cwd ?? row.sessionId }));
  }, [harnessList]);
  const continueTargetId = continuationTargets.some((target) => target.id === targetSessionId) ? targetSessionId : continuationTargets[0]?.id;
  (0, import_react3.useEffect)(() => {
    tailChatRef.current = viewChat?.id;
  }, [viewChat?.id]);
  (0, import_react3.useEffect)(() => {
    const list = listRef.current;
    if (list === null) return;
    if (jumpId !== void 0) {
      const target = list.querySelector(`[data-message-id="${jumpId}"]`);
      if (target !== null) {
        pinnedRef.current = false;
        target.scrollIntoView({ block: "center" });
        setFlashId(jumpId);
      }
      setJumpId(void 0);
      return;
    }
    const switched = prevChatRef.current !== viewChatId;
    prevChatRef.current = viewChatId;
    if (switched || pinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [state, viewChatId, jumpId]);
  const onThreadScroll = (0, import_react3.useCallback)(() => {
    const list = listRef.current;
    if (list === null) return;
    pinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 96;
  }, []);
  (0, import_react3.useEffect)(() => {
    if (flashId === void 0) return;
    const timer = window.setTimeout(() => setFlashId(void 0), 1800);
    return () => window.clearTimeout(timer);
  }, [flashId]);
  const wakeRef = (0, import_react3.useRef)(null);
  const ensureReady = (0, import_react3.useCallback)(async () => {
    if (wakeRef.current !== null) return await wakeRef.current;
    const task = (async () => {
      setWaking(true);
      try {
        const woken = await api.wake().catch(() => void 0);
        if (woken === void 0) return false;
        if (woken.ok !== true) {
          if (/HTTP 404/.test(woken.error ?? "")) {
            await api.openLogin().catch(() => void 0);
            return false;
          }
          toast(woken.error ?? tr("toast.wake.failed"), { error: true });
          return false;
        }
        if (woken.loggedIn === true) return true;
        if (woken.loginWindow !== true) {
          const opened = await api.openLogin().catch(() => void 0);
          if (opened !== void 0 && opened.ok !== true && opened.error !== void 0) {
            toast(opened.error, { error: true });
            return false;
          }
        }
        return false;
      } finally {
        setWaking(false);
        void refreshState();
      }
    })();
    wakeRef.current = task;
    try {
      return await task;
    } finally {
      wakeRef.current = null;
    }
  }, [api, toast, tr, refreshState]);
  const retry = (0, import_react3.useCallback)(async () => {
    const chat = chats.find((item) => item.id === viewChatId) ?? chats[0];
    if (chat === void 0 || busy) return;
    const lastUser = [...chat.messages].reverse().find((message) => message.role === "user");
    if (lastUser === void 0) return;
    pinnedRef.current = true;
    tailUntilRef.current = Date.now() + TAIL_AFTER_SEND_MS;
    const result = await api.send(lastUser.content, lastUser.attachments).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) toast(result.error ?? "", { error: true });
    else void refreshState();
  }, [chats, viewChatId, busy, api, toast, refreshState]);
  const send = (0, import_react3.useCallback)(async () => {
    const text = draft.trim();
    if (text === "" && images.length === 0) return;
    if (busy) return;
    if (loggedIn !== true && !await ensureReady()) {
      toast(tr("toast.send.needLogin"), { error: true });
      return;
    }
    setDraft("");
    const sentImages = images;
    setImages([]);
    pinnedRef.current = true;
    tailUntilRef.current = Date.now() + TAIL_AFTER_SEND_MS;
    try {
      const result = await api.send(text, sentImages.length > 0 ? sentImages : void 0);
      if (result.ok !== true) {
        if (result.stored === true) {
          toast(result.error ?? tr("toast.send.failed"), {
            error: true,
            action: { label: tr("msg.retry"), run: () => {
              void retry();
            } }
          });
        } else {
          setDraft((current2) => current2 === "" ? text : current2);
          if (sentImages.length > 0) setImages((current2) => current2.length === 0 ? sentImages : current2);
          toast(result.error ?? tr("toast.send.failed"), { error: true });
        }
      } else if (result.chatId !== void 0) {
        setViewChatId(result.chatId);
      }
      void refreshState();
    } catch (error) {
      setDraft((current2) => current2 === "" ? text : current2);
      if (sentImages.length > 0) setImages((current2) => current2.length === 0 ? sentImages : current2);
      toast(String(error), { error: true });
    }
  }, [draft, images, busy, loggedIn, api, toast, tr, refreshState, retry, ensureReady]);
  const stop = (0, import_react3.useCallback)(async () => {
    await api.stop().catch(() => void 0);
  }, [api]);
  const newChat = (0, import_react3.useCallback)(async () => {
    try {
      const result = await api.newChat();
      if (result.ok === true && result.chatId !== void 0) {
        setViewChatId(result.chatId);
        pinnedRef.current = true;
        void refreshState();
      } else toast(result.error ?? "new chat failed", { error: true });
    } catch (error) {
      toast(String(error), { error: true });
    }
  }, [api, toast, refreshState]);
  const toggleDeepThink = (0, import_react3.useCallback)(async () => {
    const next = !deepThink;
    setDeepThink(next);
    const result = await api.setDeepThink(next).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) {
      setDeepThink(!next);
      toast(result.error ?? "toggle failed", { error: true });
    }
  }, [deepThink, api, toast]);
  const toggleSearch = (0, import_react3.useCallback)(async () => {
    const next = !search;
    setSearch(next);
    const result = await api.setSearch(next).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) {
      setSearch(!next);
      toast(result.error ?? "toggle failed", { error: true });
    }
  }, [search, api, toast]);
  const openLogin = (0, import_react3.useCallback)(async () => {
    const result = await api.openLogin().catch(() => void 0);
    if (result !== void 0 && result.ok !== true) toast(result.error ?? "open login failed", { error: true });
  }, [api, toast]);
  const copyText = (0, import_react3.useCallback)(async (text, message) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      toast(message);
    }
  }, [toast]);
  const removeChat = (0, import_react3.useCallback)(async (chat) => {
    const index = chats.findIndex((item) => item.id === chat.id);
    const result = await api.deleteChat(chat.id).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) {
      toast(tr("toast.delete.failed", { error: result.error ?? "" }), { error: true });
      return;
    }
    deletedRef.current.set(chat.id, { chat, index });
    toast(tr("toast.delete.done", { title: chat.title }), {
      action: {
        label: tr("toast.undo"),
        run: () => {
          const entry = deletedRef.current.get(chat.id);
          if (entry === void 0) return;
          deletedRef.current.delete(chat.id);
          void api.restore({
            title: entry.chat.title,
            model: entry.chat.model,
            // Carried through so the restored transcript re-attaches to the
            // same web conversation: without it the host can only match on the
            // title, and two conversations can share one (every new chat is
            // 「新的对话」 until its first exchange).
            ...entry.chat.webSessionId === void 0 ? {} : { webSessionId: entry.chat.webSessionId },
            messages: entry.chat.messages
          }).then((restored) => {
            if (restored.ok !== true) {
              deletedRef.current.set(chat.id, entry);
              toast(tr("toast.delete.failed", { error: restored.error ?? "" }), { error: true });
              return;
            }
            toast(tr("toast.restored"));
            if (restored.chatId !== void 0) setViewChatId(restored.chatId);
            void refreshState();
          });
        }
      }
    });
  }, [api, chats, toast, tr, refreshState]);
  const clearAll = (0, import_react3.useCallback)(async () => {
    if (!clearArmed) {
      setClearArmed(true);
      window.setTimeout(() => setClearArmed(false), 3e3);
      return;
    }
    setClearArmed(false);
    const result = await api.clearChats().catch(() => void 0);
    if (result !== void 0 && result.ok !== true) toast(tr("toast.clear.failed", { error: result.error ?? "" }), { error: true });
    else toast(tr("toast.clear.done"));
  }, [clearArmed, api, toast, tr]);
  const recover = (0, import_react3.useCallback)(async () => {
    const listed = await api.webChats().catch(() => void 0);
    if (listed === void 0 || listed.ok !== true) {
      toast(listed?.error ?? "recover failed", { error: true });
      return;
    }
    if (listed.missing.length === 0) {
      toast(tr("toast.recover.empty"));
      return;
    }
    const total = listed.missing.length;
    let done = 0;
    let recovered = 0;
    let refreshed = 0;
    let messages = 0;
    let lastProgressAt = 0;
    const failures = [];
    for (const item of listed.missing) {
      done += 1;
      const now2 = Date.now();
      if (done === total || now2 - lastProgressAt >= 900) {
        lastProgressAt = now2;
        toast(tr("toast.recover.progress", { done: String(done), total: String(total), title: item.title }), { ttl: 2600 });
      }
      const result = await api.recover({
        title: item.title,
        ...item.sessionId === void 0 ? {} : { sessionId: item.sessionId }
      }).catch(() => void 0);
      if (result === void 0 || result.ok !== true) {
        failures.push(`${item.title}\uFF1A${result?.error ?? "\u672A\u77E5\u9519\u8BEF"}`);
        continue;
      }
      recovered += 1;
      if (result.updated === true) refreshed += 1;
      messages += result.messageCount ?? 0;
    }
    toast(tr("toast.recover.summary", {
      count: String(recovered),
      total: String(total),
      messages: String(messages),
      refreshed: String(refreshed)
    }));
    if (failures.length > 0) {
      toast(tr("toast.recover.failed", { list: failures.slice(0, 3).join("\uFF1B") }), { error: true, ttl: 12e3 });
    }
  }, [api, toast, tr]);
  const commitRename = (0, import_react3.useCallback)(async (chat) => {
    const title = renameDraft.trim().replace(/\s+/g, " ");
    setRenamingId(void 0);
    if (title === "" || title === chat.title) return;
    const result = await api.renameChat(chat.id, title).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) toast(tr("toast.rename.failed", { error: result.error ?? "" }), { error: true });
    else toast(tr("toast.rename.done"));
  }, [renameDraft, api, toast, tr]);
  const exportFile = (0, import_react3.useCallback)(async () => {
    if (viewChat === void 0) return;
    const result = await api.exportFile(viewChat.id).catch(() => void 0);
    if (result === void 0 || result.ok !== true || result.filePath === void 0) {
      toast(tr("toast.export.failed", { error: result?.error ?? "" }), { error: true });
      return;
    }
    toast(tr("toast.export.done", {
      file: result.dir === void 0 ? result.filePath : `${result.dir}/${result.filePath}`
    }));
  }, [viewChat, api, toast, tr]);
  const runTransfer = (0, import_react3.useCallback)(async () => {
    if (viewChat === void 0 || transferring) return;
    setTransferring(true);
    setStage(1);
    try {
      const result = await api.transfer(
        viewChat.id,
        cwd,
        transferMode,
        transferTarget === "new" ? targetWorkspaceId : void 0,
        transferTarget === "continue" ? continueTargetId : void 0
      );
      if (result.ok !== true || result.sessionId === void 0) {
        setStage(0);
        toast(tr("toast.transfer.failed", { error: result.error ?? "" }), {
          error: true,
          action: { label: tr("toast.transfer.retry"), run: () => {
            void runTransfer();
          } }
        });
        return;
      }
      const sessionId = result.sessionId;
      setStage(result.continued === true ? 2 : 3);
      if (result.duplicate === true) toast(tr("toast.transfer.duplicate"));
      else if (result.continued === true) toast(tr("toast.transfer.continued"));
      else toast(tr("toast.transfer.done"), { action: { label: tr("toast.open"), run: () => {
        void openSession(sessionId);
      } } });
      void (async () => {
        const opened = await Promise.resolve(openSession(sessionId)).catch(() => false);
        if (opened === false) toast(tr("toast.open.failed"), { error: true });
      })();
      window.setTimeout(() => {
        setPopOpen(false);
        setStage(0);
      }, 600);
    } catch (error) {
      setStage(0);
      toast(tr("toast.transfer.failed", { error: String(error) }), { error: true });
    } finally {
      setTransferring(false);
    }
  }, [viewChat, transferring, api, cwd, transferMode, transferTarget, targetWorkspaceId, continueTargetId, openSession, toast, tr]);
  const createTargetWorkspace = (0, import_react3.useCallback)(async () => {
    try {
      const path = await pickDirectory();
      if (path === null || path === "") return;
      const created = await createWorkspace(path);
      setTargetWorkspaceId(created.workspaceId);
      setWorkspaces((list) => [...list, { id: created.workspaceId, path, title: created.title }]);
      toast(tr("toast.workspace.created", { title: created.title }));
    } catch (error) {
      toast(tr("toast.workspace.failed", { error: String(error) }), { error: true });
    }
  }, [pickDirectory, createWorkspace, toast, tr]);
  (0, import_react3.useEffect)(() => {
    if (!popOpen && !moreOpen) return;
    const onDown = (event) => {
      const target = event.target;
      if (popOpen && transferPopRef.current?.contains(target) !== true) setPopOpen(false);
      if (moreOpen && morePopRef.current?.contains(target) !== true) setMoreOpen(false);
    };
    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      if (popOpen) setPopOpen(false);
      if (moreOpen) setMoreOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onEscape);
    };
  }, [popOpen, moreOpen]);
  (0, import_react3.useEffect)(() => {
    const onKey = (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (meta && event.key === "/") {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && state?.busy === true) void stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state?.busy, stop]);
  const uploadFiles = (0, import_react3.useCallback)(async (files) => {
    if (files.length === 0) return;
    const room = Math.max(0, MAX_ATTACH_COUNT - imagesRef.current.length);
    if (room === 0) {
      toast(tr("toast.attach.tooMany", { limit: String(MAX_ATTACH_COUNT) }), { error: true });
      return;
    }
    let batch = files;
    if (files.length > room) {
      toast(tr("toast.attach.tooMany", { limit: String(MAX_ATTACH_COUNT) }), { error: true });
      batch = files.slice(0, room);
    }
    setAttachBusy(true);
    try {
      for (const file of batch) {
        if (file.size > MAX_ATTACH_BYTES) {
          toast(tr("toast.attach.tooBig", { name: file.name === "" ? "file" : file.name, limit: MAX_ATTACH_LABEL }), { error: true });
          continue;
        }
        const payload = await fileToBase64(file);
        const result = await api.attach({
          name: file.name === "" ? "pasted-file" : file.name,
          mediaType: payload.mediaType,
          data: payload.data
        });
        if (result.ok !== true || result.path === void 0) {
          toast(tr("toast.attach.failed", { error: result.error ?? "" }), { error: true });
          continue;
        }
        const path = result.path;
        setImages((list) => [...list, path]);
      }
    } catch (error) {
      toast(tr("toast.attach.failed", { error: String(error) }), { error: true });
    } finally {
      setAttachBusy(false);
    }
  }, [api, imagesRef, toast, tr]);
  const whaleTitle = state?.lastError ?? (engine.detail === "" ? tr("status.stopped") : engine.detail);
  const elapsed = busy && state?.busySince !== void 0 ? `${Math.max(0, (now - state.busySince) / 1e3).toFixed(1)}s` : void 0;
  const streamedChars = viewChat?.messages.reduce(
    (total, message) => message.role === "assistant" && message.streaming === true ? message.content.length : total,
    0
  ) ?? 0;
  const modelLabel = viewChat?.model === "deepseek-reasoner" ? tr("msg.model.think") : tr("msg.model");
  return (0, import_react3.createElement)(
    "div",
    { className: "dsh-dschat", "data-rail-drag": railDragging ? "true" : void 0, "data-dsh-plugin": "dschat" },
    /* ---------------------------------------------------------- header */
    /*
     * `data-window-drag` is the desktop shell's OWN drag-region hook: on darwin
     * an element carrying it becomes `-webkit-app-region: drag`, which is what
     * lets the window be moved — and double-clicked to maximise — from any blank
     * spot inside it. The shell marks its own chrome, but this panel is a
     * full-width seat at the top of the window, so its 52px header covered the
     * strip the user was aiming at: the title bar looked empty and stayed dead.
     *
     * Every control inside is already excluded by the shell's blanket rule
     * (`:is(button,a,input,select,textarea,…){-webkit-app-region:no-drag}`), so
     * the buttons keep working; only the empty space between them becomes
     * draggable. The attribute is inert everywhere else (`data-platform` is not
     * darwin on Web/Windows, and nothing else styles it), so this needs no
     * platform branch.
     *
     * The drag region is an EXPLICIT element rather than the header box, because
     * the header's left end is now the whale: an empty element cannot lie about
     * what it covers, while a mark that has stopped covering a strip (a name
     * removed, a control moved) silently takes the window's drag area with it.
     */
    (0, import_react3.createElement)(
      "header",
      { className: "dsh-dschat-header", "data-window-drag": true },
      /*
       * The whale leads the header: identity first, controls after — the order
       * the web app itself uses, where the mark sits at the top of its sidebar
       * and the window controls follow.
       *
       * It replaced two things that stood here and both earned their removal:
       * the panel's NAME (`DSchat`, already the sidebar row and the document
       * title — the one place it was redundant) and a status chip that rendered
       * 「● 已就绪 · deepseek-reasoner」 at the window controls' own height, in
       * their own radius, so it read as a fourth button that did nothing when
       * clicked.
       *
       * The colour is the whole point: the mark IS the state lamp, so the
       * engine's condition is legible from the corner of the eye without a row
       * of text. The sentence did not disappear — it became this control's
       * tooltip, where it costs the header no width (see `whaleTitle`). Colour
       * is never the ONLY channel: the button's accessible name carries the
       * phase, so a reader who cannot see the difference still hears it.
       */
      (0, import_react3.createElement)(
        "button",
        {
          type: "button",
          className: "dsh-dschat-whale",
          "data-phase": engine.phase,
          title: whaleTitle,
          "aria-label": whaleTitle,
          /*
           * The mark is also the panel's "bring it up" button, and it means the
           * same thing here as a click in the composer: start the web engine.
           * It used to call `openLogin` — a headed relaunch — which is wrong for
           * the common case it actually faces, a page that is merely down while
           * the persisted session is perfectly good. The explicit
           * 「打开登录窗口」 entries (the banner, the ··· menu, the settings page)
           * are where a visible window is asked for by name.
           */
          onClick: () => {
            if (loggedIn !== true || !engineLive) void ensureReady();
          }
        },
        (0, import_react3.createElement)(WhaleMark, { size: 19 })
      ),
      /*
       * The three window controls: reopen the conversation list, search it,
       * start a new chat. They are the only affordances for the three things
       * this panel can do before a message exists, so they sit next to the mark
       * that names the product they act on.
       */
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-hbtns" },
        (0, import_react3.createElement)(
          "button",
          {
            type: "button",
            className: railOpen ? "dsh-dschat-hbtn dsh-dschat-hbtn-on" : "dsh-dschat-hbtn",
            title: railOpen ? tr("rail.hide") : tr("rail.show"),
            "aria-label": railOpen ? tr("rail.hide") : tr("rail.show"),
            "aria-pressed": railOpen,
            onClick: () => {
              toggleRail();
            }
          },
          (0, import_react3.createElement)(HistoryIcon, { size: 16 })
        ),
        (0, import_react3.createElement)(
          "button",
          {
            type: "button",
            className: searchOpen ? "dsh-dschat-hbtn dsh-dschat-hbtn-on" : "dsh-dschat-hbtn",
            title: tr("rail.search.hint"),
            "aria-label": tr("rail.search.hint"),
            "aria-pressed": searchOpen,
            onClick: () => {
              openSearch();
            }
          },
          (0, import_react3.createElement)(SearchIcon, { size: 16 })
        ),
        (0, import_react3.createElement)(
          "button",
          {
            type: "button",
            className: "dsh-dschat-hbtn",
            title: tr("action.newChat.hint"),
            "aria-label": tr("action.newChat"),
            disabled: preparingNewChat,
            onClick: () => {
              void newChat();
            }
          },
          (0, import_react3.createElement)(PlusIcon, { size: 16 })
        )
      ),
      /*
       * The header's run of empty space — still a drag region, now the only
       * one. `aria-hidden` because it carries nothing: it exists so the window
       * can be moved by the title bar's blank strip, which is where a reader
       * reaches for it.
       */
      (0, import_react3.createElement)("div", { className: "dsh-dschat-spacer", "data-window-drag": true, "aria-hidden": "true" }),
      transferPopover(),
      moreMenu()
    ),
    /* ---------------------------------------------------------- body */
    (0, import_react3.createElement)(
      "div",
      { className: "dsh-dschat-body" },
      rail(),
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-chat" },
        (0, import_react3.createElement)(
          "div",
          { className: "dsh-dschat-thread dsh-dschat-scroll", ref: listRef, onScroll: onThreadScroll },
          (0, import_react3.createElement)("div", { className: "dsh-dschat-thread-inner" }, thread())
        ),
        composer(),
        phaseRail()
      )
    ),
    toasts.length > 0 && (0, import_react3.createElement)(
      "div",
      { className: "dsh-dschat-toasts" },
      toasts.map((item) => (0, import_react3.createElement)(
        "div",
        { key: item.id, className: "dsh-dschat-toast", "data-error": item.error === true ? "true" : void 0 },
        (0, import_react3.createElement)(
          "span",
          { className: item.error === true ? "dsh-dschat-bad" : "dsh-dschat-ok" },
          item.error === true ? (0, import_react3.createElement)(WarnIcon, {}) : (0, import_react3.createElement)(CheckIcon, {})
        ),
        (0, import_react3.createElement)("span", null, item.text),
        item.action !== void 0 && (0, import_react3.createElement)(
          "button",
          { type: "button", onClick: () => {
            item.action?.run();
          } },
          item.action.label
        )
      ))
    )
  );
  function rail() {
    if (!railOpen) return null;
    return (0, import_react3.createElement)(
      "aside",
      {
        className: "dsh-dschat-rail",
        style: { width: `${railWidth}px` },
        "data-resizing": railDragging ? "true" : void 0
      },
      /*
       * The resize handle. A 6px strip straddling the rail's border, so the
       * pointer does not have to find a 1px line; it is a real separator for
       * assistive tech and takes arrow keys, because a width that can only be
       * set by dragging is a width half the readers cannot set at all.
       */
      (0, import_react3.createElement)("div", {
        className: "dsh-dschat-rail-resize",
        role: "separator",
        "aria-orientation": "vertical",
        "aria-label": tr("rail.resize"),
        "aria-valuenow": railWidth,
        "aria-valuemin": RAIL_WIDTH_MIN,
        "aria-valuemax": RAIL_WIDTH_MAX,
        tabIndex: 0,
        title: tr("rail.resize"),
        onPointerDown: startRailDrag,
        onKeyDown: nudgeRail,
        onDoubleClick: () => {
          railWidthRef.current = RAIL_WIDTH_DEFAULT;
          setRailWidth(RAIL_WIDTH_DEFAULT);
          writeStored(RAIL_STORE, String(RAIL_WIDTH_DEFAULT));
        }
      }),
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-search" },
        (0, import_react3.createElement)(SearchIcon, {}),
        (0, import_react3.createElement)("input", {
          ref: searchRef,
          value: query,
          placeholder: tr("rail.search"),
          "aria-label": tr("rail.search"),
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key !== "Escape" || query === "") return;
            event.preventDefault();
            setQuery("");
          }
        }),
        query !== "" && (0, import_react3.createElement)(
          "button",
          {
            type: "button",
            className: "dsh-dschat-search-clear",
            title: tr("rail.search.clear"),
            "aria-label": tr("rail.search.clear"),
            onClick: () => {
              setQuery("");
              searchRef.current?.focus();
            }
          },
          (0, import_react3.createElement)(CloseIcon, { size: 10 })
        )
      ),
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-list dsh-dschat-scroll" },
        filtered.length === 0 ? (0, import_react3.createElement)(
          "div",
          { className: "dsh-dschat-hint-empty" },
          chats.length === 0 ? tr("rail.empty") : tr("rail.noMatch")
        ) : filtered.map((chat) => renamingId === chat.id ? renameRow(chat) : chatRow(chat))
      ),
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-rail-foot" },
        (0, import_react3.createElement)(
          "button",
          {
            type: "button",
            className: "dsh-dschat-btn dsh-dschat-btn-ghost",
            style: { flex: 1, justifyContent: "center" },
            disabled: loggedIn !== true,
            title: tr("action.recover.hint"),
            onClick: () => {
              void recover();
            }
          },
          (0, import_react3.createElement)(RefreshIcon, {}),
          tr("action.recover")
        ),
        (0, import_react3.createElement)(
          "button",
          {
            type: "button",
            className: clearArmed ? "dsh-dschat-btn dsh-dschat-btn-ghost" : "dsh-dschat-btn",
            disabled: chats.length === 0,
            title: tr("rail.clear"),
            onClick: () => {
              void clearAll();
            }
          },
          clearArmed ? tr("rail.clearConfirm") : (0, import_react3.createElement)(TrashIcon, {})
        )
      )
    );
  }
  function matchedMessageIds(chat) {
    const needle = query.trim().toLowerCase();
    if (chat === void 0 || needle === "") return [];
    return chat.messages.filter((message) => message.content.toLowerCase().includes(needle)).map((message) => message.id);
  }
  function openChat(chat) {
    setViewChatId(chat.id);
    setJumpId(matchedMessageIds(chat)[0]);
  }
  function chatRow(chat) {
    return (0, import_react3.createElement)(
      "div",
      {
        key: chat.id,
        className: "dsh-dschat-item",
        "data-active": chat.id === viewChat?.id ? "true" : void 0
      },
      (0, import_react3.createElement)(
        "div",
        {
          className: "dsh-dschat-item-main",
          onClick: () => {
            openChat(chat);
          }
        },
        (0, import_react3.createElement)("div", { className: "dsh-dschat-item-title", title: chat.title }, chat.title),
        (0, import_react3.createElement)(
          "div",
          { className: "dsh-dschat-item-meta" },
          `${fmt(tr("chats.count"), { count: String(chat.messages.length) })} \xB7 ${relativeTime(chat.updatedAt, tr)}`
        )
      ),
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-item-acts" },
        (0, import_react3.createElement)(
          "button",
          {
            type: "button",
            className: "dsh-dschat-mini",
            title: tr("item.rename"),
            onClick: () => {
              setRenameDraft(chat.title);
              setRenamingId(chat.id);
            }
          },
          (0, import_react3.createElement)(PencilIcon, {})
        ),
        (0, import_react3.createElement)(
          "button",
          {
            type: "button",
            className: "dsh-dschat-mini dsh-dschat-mini-danger",
            title: tr("item.delete"),
            onClick: () => {
              void removeChat(chat);
            }
          },
          (0, import_react3.createElement)(TrashIcon, {})
        )
      )
    );
  }
  function renameRow(chat) {
    return (0, import_react3.createElement)(
      "div",
      { key: chat.id, className: "dsh-dschat-item", "data-active": chat.id === viewChat?.id ? "true" : void 0 },
      (0, import_react3.createElement)("input", {
        className: "dsh-dschat-select",
        autoFocus: true,
        value: renameDraft,
        placeholder: tr("item.rename.placeholder"),
        "aria-label": tr("item.rename"),
        onChange: (event) => setRenameDraft(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commitRename(chat);
          } else if (event.key === "Escape") setRenamingId(void 0);
        },
        onBlur: () => {
          void commitRename(chat);
        }
      })
    );
  }
  function thread() {
    if (viewChat === void 0 || viewChat.messages.length === 0) {
      return (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-empty", key: "empty" },
        (0, import_react3.createElement)("div", { className: "dsh-dschat-empty-mark" }, (0, import_react3.createElement)(ChatIcon, { size: 22 })),
        (0, import_react3.createElement)("h3", null, tr("empty.title")),
        (0, import_react3.createElement)("p", null, tr("empty.body")),
        (0, import_react3.createElement)(
          "p",
          { style: { marginTop: "8px", display: "flex", gap: "6px", alignItems: "center", justifyContent: "center" } },
          (0, import_react3.createElement)("span", { className: "dsh-dschat-kbd" }, "Enter"),
          (0, import_react3.createElement)("span", null, tr("action.send")),
          (0, import_react3.createElement)("span", { className: "dsh-dschat-kbd" }, "\u2318/"),
          (0, import_react3.createElement)("span", null, tr("composer.hint.focus"))
        ),
        loggedIn !== true && (0, import_react3.createElement)(
          "button",
          { type: "button", className: "dsh-dschat-btn dsh-dschat-btn-primary", onClick: () => {
            void openLogin();
          } },
          tr("action.openLogin")
        )
      );
    }
    const keys = threadKeys(viewChat.messages);
    return (0, import_react3.createElement)(
      "div",
      { style: { display: "contents" }, key: "thread" },
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-day", key: "day" },
        new Date(viewChat.messages[0]?.ts ?? Date.now()).toLocaleDateString()
      ),
      ...viewChat.messages.map((message, index) => messageNode(message, keys[index] ?? message.id, index))
    );
  }
  function messageNode(message, key, index) {
    const isUser = message.role === "user";
    const who = isUser ? tr("msg.you") : modelLabel;
    const reply = isUser ? message.content : replyBody(message.content);
    const thinking = isUser ? "" : thinkingBody(message.content);
    const sources = isUser ? void 0 : sourcesOf(message.sources);
    const markdownOptions = () => ({
      onCopyCode: (code) => {
        void copyText(code, tr("toast.codeCopied"));
      },
      onOpenLink: openExternalLink
    });
    const quoted = isUser ? (message.content.split("\n")[0] ?? "").trim() : firstLine(message.content);
    const actions = isUser ? [
      { key: "copy", title: tr("msg.copy"), icon: (0, import_react3.createElement)(CopyIcon, {}), run: () => {
        void copyText(reply, tr("toast.copied"));
      } },
      { key: "edit", title: tr("msg.edit"), icon: (0, import_react3.createElement)(PencilIcon, {}), run: () => {
        setDraft(message.content);
        inputRef.current?.focus();
      } }
    ] : [
      { key: "copy", title: tr("msg.copy"), icon: (0, import_react3.createElement)(CopyIcon, {}), run: () => {
        void copyText(reply, tr("toast.copied"));
      } },
      ...thinking === "" ? [] : [{
        key: "copy-thinking",
        title: tr("msg.copyThinking"),
        icon: (0, import_react3.createElement)(ThinkIcon, {}),
        run: () => {
          void copyText(thinking, tr("toast.thinkingCopied"));
        }
      }],
      ...quoted === "" ? [] : [{
        key: "quote",
        title: tr("msg.quote"),
        icon: (0, import_react3.createElement)(QuoteIcon, {}),
        run: () => {
          setDraft(`> ${quoted}

`);
          inputRef.current?.focus();
        }
      }]
    ];
    const body = (0, import_react3.createElement)(
      "div",
      { className: "dsh-dschat-msg-body" },
      message.attachments !== void 0 && message.attachments.length > 0 && (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-imgs" },
        message.attachments.map((path) => (0, import_react3.createElement)(
          "div",
          { key: path, className: "dsh-dschat-chip", title: path },
          (0, import_react3.createElement)(ClipIcon, { size: 12 }),
          (0, import_react3.createElement)("span", null, path.split("/").pop() ?? path)
        ))
      ),
      isUser ? (0, import_react3.createElement)("p", null, message.content) : (0, import_react3.createElement)(
        import_react3.Fragment,
        null,
        /*
         * The reasoning, as its own disclosure. The message stores reasoning
         * and answer in ONE string (the engine wraps the reasoning in a
         * `<details>` block), and the panel splits it back apart here:
         *
         *   - the reasoning becomes a button whose summary line carries the
         *     turn's real duration 「已思考（用时 …）」, measured by the engine
         *     while it streamed (see `thoughtLabel`);
         *   - the answer renders as ordinary prose, NOT inside a collapsed
         *     box, so a long reply is readable without a click.
         *
         * Splitting it also keeps `<details>` out of the DOM entirely, which
         * is what lets the row follow the panel's theme tokens.
         */
        thinking !== "" && (0, import_react3.createElement)(Thinking, {
          source: thinking,
          label: thoughtLabel(message.thinkingMs, message.streaming === true, tr),
          /*
           * The live-line inputs. `thinkingMs` is undefined exactly while
           * the model is still reasoning (the engine measures the interval
           * and writes it once the answer starts), and `streaming` is true
           * for the whole turn — together they are the panel's own test for
           * 「思考中」 rather than a separate phase flag that could disagree
           * with the message it describes.
           */
          ...message.thinkingMs === void 0 ? {} : { thinkingMs: message.thinkingMs },
          ...message.streaming === void 0 ? {} : { streaming: message.streaming },
          liveLabel: tr("msg.thought.prefix"),
          copyLabel: tr("msg.copy"),
          options: markdownOptions()
        }),
        (0, import_react3.createElement)(Markdown, {
          source: reply,
          copyLabel: tr("msg.copy"),
          ...markdownOptions(),
          /*
           * The citation table goes over on EVERY tick, streaming or not:
           * it is what turns `[citation:N]` from a dead number into a link
           * to the page the answer cites, and the chips are on screen from
           * the first moment the web numbers its sources.
           */
          ...sources === void 0 ? {} : { sources },
          /*
           * The source LIST waits for the reply to finish. The web numbers
           * its sources as soon as the search step returns — before a single
           * token of the answer exists — so a list rendered during the
           * stream appeared FIRST, at the top of an empty message, and was
           * then pushed down by the answer growing above it: the reader saw
           * sources, then content. Withholding the heading alone is what
           * orders the transcript the way the page itself ends up (answer,
           * then sources) while keeping the citation chips live.
           */
          ...sources === void 0 || message.streaming === true ? {} : { sourcesLabel: tr("msg.sources.count", { count: String(sources.length) }) }
        })
      ),
      message.streaming === true && (0, import_react3.createElement)("span", { className: "dsh-dschat-caret" }),
      message.error !== void 0 && (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-err" },
        (0, import_react3.createElement)(WarnIcon, {}),
        (0, import_react3.createElement)("span", null, message.content === "" ? message.error : tr("phase.replyPartial")),
        (0, import_react3.createElement)("span", { className: "dsh-dschat-spacer" }),
        (0, import_react3.createElement)(
          "button",
          { type: "button", className: "dsh-dschat-btn dsh-dschat-btn-ghost", onClick: () => {
            void retry();
          } },
          tr("msg.retry")
        )
      )
    );
    const acts = (0, import_react3.createElement)(
      "div",
      { className: "dsh-dschat-msg-acts" },
      actions.map((action) => (0, import_react3.createElement)(
        "button",
        { key: action.key, type: "button", title: action.title, "aria-label": action.title, onClick: action.run },
        action.icon
      ))
    );
    return (0, import_react3.createElement)(
      "div",
      {
        key,
        /*
         * `data-message-id` is the search jump's landing mark: the rail filter
         * matches on message CONTENT, so "which row do I scroll to" has to be
         * answerable from the DOM by the id the match reported. `data-index` is
         * the existing order hook and stays as it was.
         */
        className: message.id === flashId ? "dsh-dschat-msg dsh-dschat-msg-jump" : "dsh-dschat-msg",
        "data-message-id": message.id,
        "data-role": message.role,
        "data-index": index
      },
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-msg-head" },
        (0, import_react3.createElement)("span", { className: "dsh-dschat-msg-who" }, who),
        (0, import_react3.createElement)("span", null, new Date(message.ts).toLocaleTimeString())
      ),
      /*
       * Placement differs by role because the CONTENT does.
       *
       * An assistant message is full-width prose, so its row rides the head line
       * at the message's right edge. A user message is a narrow right-aligned
       * bubble: anchoring its row to the message box parked it at the far LEFT,
       * hundreds of pixels from the bubble. Wrapping the bubble makes the row's
       * containing block the bubble itself, so `right: 100%` puts it just outside
       * the bubble at any width.
       */
      isUser ? (0, import_react3.createElement)("div", { className: "dsh-dschat-msg-line" }, body, acts) : (0, import_react3.createElement)(import_react3.Fragment, null, body, acts)
    );
  }
  function composer() {
    return (0, import_react3.createElement)(
      "div",
      { className: "dsh-dschat-composer" },
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-composer-inner" },
        (0, import_react3.createElement)(
          "div",
          {
            className: dragging ? "dsh-dschat-card dsh-dschat-dragging" : "dsh-dschat-card",
            /*
             * The whole card is the "start me" affordance the offline
             * placeholder advertises — it wears the accent wash and the pointer
             * cursor — but only the textarea inside it took focus, so a click on
             * the padding did nothing. Guarded on `target === currentTarget` so
             * this never steals a click from a chip, a pill or the attach
             * button: only a click on the card itself is forwarded to the input.
             */
            onClick: (event) => {
              if (event.target !== event.currentTarget) return;
              inputRef.current?.focus();
              if (loggedIn !== true && !busy) void ensureReady();
            },
            // Paste and drop both end at the same place: bytes to the host,
            // path back, chip in the composer. `isAttachableFile` only rules out
            // empty entries — the page's own file input is the authority on
            // which TYPES it takes (see the note on that helper).
            onPaste: (event) => {
              const files = Array.from(event.clipboardData?.files ?? []).filter(isAttachableFile);
              if (files.length === 0) return;
              event.preventDefault();
              void uploadFiles(files);
            },
            onDragOver: (event) => {
              event.preventDefault();
              if (event.dataTransfer !== void 0) event.dataTransfer.dropEffect = "copy";
              setDragging(true);
            },
            /*
             * `dragleave` fires for every child the pointer crosses, so a plain
             * `setDragging(false)` made the drop hint strobe on and off as the
             * pointer moved from the card to the textarea inside it. Only a
             * leave whose `relatedTarget` is outside the card is a real leave
             * (a null one means the pointer left the window entirely).
             */
            onDragLeave: (event) => {
              const next = event.relatedTarget;
              if (next !== null && next !== void 0 && event.currentTarget?.contains(next) === true) return;
              setDragging(false);
            },
            onDrop: (event) => {
              event.preventDefault();
              setDragging(false);
              const files = Array.from(event.dataTransfer?.files ?? []).filter(isAttachableFile);
              if (files.length > 0) void uploadFiles(files);
            }
          },
          images.length > 0 && (0, import_react3.createElement)(
            "div",
            { className: "dsh-dschat-attachments" },
            images.map((path, index) => (0, import_react3.createElement)(
              "span",
              { key: `${path}-${index}`, className: "dsh-dschat-chip", title: path },
              (0, import_react3.createElement)(ClipIcon, { size: 12 }),
              (0, import_react3.createElement)("span", null, path.split("/").pop() ?? path),
              (0, import_react3.createElement)("button", {
                type: "button",
                title: tr("item.rename.cancel"),
                onClick: () => setImages((list) => list.filter((_, i) => i !== index))
              }, "\u2715")
            ))
          ),
          (0, import_react3.createElement)("textarea", {
            ref: inputRef,
            className: "dsh-dschat-input",
            rows: 1,
            value: draft,
            /*
             * readOnly, NOT disabled, while the engine is down.
             *
             * `disabled` removes the element from the tab order and drops every
             * pointer event, so clicking the composer did nothing at all — no
             * cursor, no focus, no feedback — which is exactly the reported
             * "点击输入框无反应". readOnly keeps it focusable and hovering, and
             * the focus/click handler below turns "I want to type" into "start
             * the engine", which is the action the click was asking for.
             */
            readOnly: busy || loggedIn !== true,
            placeholder: busy ? tr("composer.busy") : waking || state?.engine === "launching" ? tr("composer.connecting") : loggedIn !== true ? engineLive ? tr("composer.notLoggedIn") : tr("composer.offline") : tr("composer.placeholder"),
            onFocus: () => {
              if (busy) return;
              if (loggedIn === true && !waking) return;
              void ensureReady();
            },
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (!submitsOnEnter(event)) return;
              event.preventDefault();
              void send();
            }
          }),
          dragging && (0, import_react3.createElement)("div", { className: "dsh-dschat-dropline" }, tr("composer.attach.drop")),
          (0, import_react3.createElement)(
            "div",
            { className: "dsh-dschat-tools" },
            /*
             * 深度思考 / 智能搜索 sit BELOW the input, in the composer's own tool row
             * — the web app's layout, where they read as properties of the
             * message you are about to send. In the header they were chrome that
             * applied to nothing in particular, and they crowded the panel title
             * on a narrow column.
             *
             * The pills, their icons and their two states are the web app's own
             * (34px tall, 18px radius, and the same blue when on — see the
             * `.dsh-dschat-toggle` rules), so a reader who knows the page
             * recognises the switches instead of re-learning them.
             *
             * The row reads left to right as two groups: the pills on the left
             * ("what should this message ask for"), then the spacer, then 附件
             * and the send circle on the right ("act on this message now") —
             * the page's own grouping, with the paperclip immediately left of
             * the send button.
             */
            (0, import_react3.createElement)(
              "button",
              {
                type: "button",
                className: deepThink ? "dsh-dschat-toggle dsh-dschat-toggle-on" : "dsh-dschat-toggle",
                disabled: busy || loggedIn !== true,
                title: tr("toggle.deepThink.hint"),
                "aria-pressed": deepThink,
                onClick: () => {
                  void toggleDeepThink();
                }
              },
              (0, import_react3.createElement)(DeepThinkIcon, { size: 14 }),
              (0, import_react3.createElement)("span", { className: "dsh-dschat-toggle-text" }, tr("toggle.deepThink"))
            ),
            (0, import_react3.createElement)(
              "button",
              {
                type: "button",
                className: search ? "dsh-dschat-toggle dsh-dschat-toggle-on" : "dsh-dschat-toggle",
                disabled: busy || loggedIn !== true,
                title: tr("toggle.search.hint"),
                "aria-pressed": search,
                onClick: () => {
                  void toggleSearch();
                }
              },
              (0, import_react3.createElement)(WebSearchIcon, { size: 14 }),
              (0, import_react3.createElement)("span", { className: "dsh-dschat-toggle-text" }, tr("toggle.search"))
            ),
            /*
             * 附件 is NOT here any more.
             *
             * It sat at the end of the pill group — 34px further left than the
             * page puts it — because the row "had to hold two pills AND the send
             * circle". But the spacer between them is the one part of the row
             * that carries no meaning, and the page's own composer (and the
             * harness's) groups the paperclip with the send control, on the
             * right: both are "act on this message now", while the pills are
             * "what should this message ask for". It now lives there — see the
             * block below the spacer.
             */
            (0, import_react3.createElement)("div", { className: "dsh-dschat-spacer" }),
            preparingNewChat && (0, import_react3.createElement)(
              "span",
              { className: "dsh-dschat-hintline", style: { margin: 0 } },
              (0, import_react3.createElement)("span", { className: "dsh-dschat-spin" }),
              tr("composer.preparing")
            ),
            /*
             * 附件: the OS file dialog, and the ONLY way files are attached
             * from the panel's own chrome — immediately left of the send
             * control, where chat.deepseek.com and the harness's own composer
             * both put it.
             *
             * A hidden `<input type="file">` clicked from here is the only way
             * to reach Finder — the packaged app has no file-picking API at all
             * (its one native dialog is the directory chooser), and this is
             * exactly what the shell's own composer does for its paperclip. The
             * chosen bytes go to the host (`/attach`), which answers a real path
             * the engine can hand the page's file input.
             *
             * It is a glyph, not a labelled button, because that is what the
             * page shows and because the row has to hold two pills AND the send
             * circle at 320px. The label the button lost is not lost information:
             * the tooltip carries it, and the count of files already attached is
             * on screen as chips above.
             *
             * The in-app browser that used to sit next to it is gone: two ways
             * to attach (by path in a dialog of our own, by bytes through
             * Finder) were one way too many, and the reader who wants a file
             * from their disk wants Finder. Dropping and pasting files still
             * work — those are gestures, not a second button.
             */
            (0, import_react3.createElement)("input", {
              ref: uploadRef,
              type: "file",
              multiple: true,
              className: "dsh-dschat-fileinput",
              tabIndex: -1,
              "aria-hidden": true,
              onChange: (event) => {
                const picked = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (picked.length > 0) void uploadFiles(picked);
              }
            }),
            (0, import_react3.createElement)(
              "button",
              {
                type: "button",
                className: "dsh-dschat-attach",
                /*
                 * The visible label is gone (the official row is a bare
                 * paperclip), so the tooltip and the accessible name carry the
                 * words. The hint — which names the kinds of file the page
                 * accepts — is the tooltip; the short label is the name screen
                 * readers announce.
                 */
                title: attachBusy ? tr("composer.upload.busy") : tr("composer.upload.hint"),
                "aria-label": attachBusy ? tr("composer.upload.busy") : tr("composer.upload"),
                disabled: busy || loggedIn !== true || attachBusy,
                onClick: () => uploadRef.current?.click()
              },
              attachBusy ? (0, import_react3.createElement)("span", { className: "dsh-dschat-spin" }) : (0, import_react3.createElement)(ClipIcon, { size: 16 })
            ),
            /*
             * The 「⌘K 搜索」 hint that used to sit here is GONE.
             *
             * It documented the rail's search shortcut from inside the composer,
             * in the one strip this row has to spare — between the paperclip and
             * the send circle — where a keycap plus a label reads as a second,
             * dead button. The shortcut itself is untouched (⌘K still opens the
             * search box); it is the advertisement that was redundant, because
             * the thing it advertises is on screen in the header.
             */
            streaming ? (0, import_react3.createElement)(
              "button",
              { type: "button", className: "dsh-dschat-stop", onClick: () => {
                void stop();
              } },
              (0, import_react3.createElement)("i", null),
              tr("action.stop")
            ) : (0, import_react3.createElement)(
              "button",
              {
                type: "button",
                className: "dsh-dschat-send",
                title: tr("action.send"),
                "aria-label": tr("action.send"),
                disabled: !canSend || draft.trim() === "" && images.length === 0,
                onClick: () => {
                  void send();
                }
              },
              (0, import_react3.createElement)(SendIcon, {})
            )
          )
        )
      )
    );
  }
  function phaseRail() {
    return (0, import_react3.createElement)(
      "div",
      { className: "dsh-dschat-phase" },
      busy && (0, import_react3.createElement)("span", { className: "dsh-dschat-spin" }),
      (0, import_react3.createElement)("span", null, busy ? tr("phase.busy") : tr("phase.idle")),
      (0, import_react3.createElement)("span", { className: "dsh-dschat-sep" }, "|"),
      (0, import_react3.createElement)("span", null, loggedIn === true ? tr("phase.loggedIn") : tr("phase.notLoggedIn")),
      busy && elapsed !== void 0 && (0, import_react3.createElement)("span", null, fmt(tr("phase.elapsed"), { time: elapsed })),
      busy && (0, import_react3.createElement)("span", null, fmt(tr("phase.chars"), { count: String(streamedChars) })),
      !busy && viewChat !== void 0 && (0, import_react3.createElement)("span", { className: "dsh-dschat-sep" }, "|"),
      !busy && viewChat !== void 0 && (0, import_react3.createElement)(
        "span",
        null,
        fmt(tr("phase.turns"), { count: String(viewChat.messages.length) })
      ),
      state?.lastError !== void 0 && (0, import_react3.createElement)("span", null, `\xB7 ${state.lastError}`)
    );
  }
  function transferPopover() {
    const note = transferTarget === "continue" ? tr("transfer.note.continue") : tr("transfer.note.new");
    return (0, import_react3.createElement)(
      "div",
      { className: "dsh-dschat-pop-wrap", ref: transferPopRef },
      (0, import_react3.createElement)(
        "button",
        {
          type: "button",
          className: "dsh-dschat-btn dsh-dschat-btn-primary",
          disabled: viewChat === void 0 || viewChat.messages.length === 0,
          onClick: () => {
            if (!popOpen) {
              setTransferTarget("new");
              setTargetSessionId(void 0);
            }
            setPopOpen((open) => !open);
          }
        },
        tr("transfer.title"),
        (0, import_react3.createElement)(CaretIcon, {})
      ),
      popOpen && (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-pop" },
        (0, import_react3.createElement)("h4", null, tr("transfer.title")),
        (0, import_react3.createElement)("p", { className: "dsh-dschat-sub" }, tr("transfer.sub")),
        (0, import_react3.createElement)(
          "div",
          { className: "dsh-dschat-field" },
          (0, import_react3.createElement)("label", null, tr("transfer.mode")),
          (0, import_react3.createElement)(
            "div",
            { className: "dsh-dschat-seg" },
            (0, import_react3.createElement)("button", {
              type: "button",
              "data-on": transferMode === "distill" ? "true" : void 0,
              onClick: () => setTransferMode("distill")
            }, tr("transfer.mode.distill")),
            (0, import_react3.createElement)("button", {
              type: "button",
              "data-on": transferMode === "raw" ? "true" : void 0,
              onClick: () => setTransferMode("raw")
            }, tr("transfer.mode.raw"))
          )
        ),
        (0, import_react3.createElement)(
          "p",
          { className: "dsh-dschat-hintline" },
          (0, import_react3.createElement)(CheckIcon, {}),
          transferMode === "distill" ? tr("transfer.mode.distill.hint") : tr("transfer.mode.raw.hint")
        ),
        (0, import_react3.createElement)(
          "div",
          { className: "dsh-dschat-field" },
          (0, import_react3.createElement)("label", null, tr("transfer.target")),
          (0, import_react3.createElement)(
            "div",
            { className: "dsh-dschat-seg" },
            (0, import_react3.createElement)("button", {
              type: "button",
              "data-on": transferTarget === "new" ? "true" : void 0,
              onClick: () => setTransferTarget("new")
            }, tr("transfer.target.new")),
            (0, import_react3.createElement)("button", {
              type: "button",
              "data-on": transferTarget === "continue" ? "true" : void 0,
              disabled: continuationTargets.length === 0,
              onClick: () => setTransferTarget("continue")
            }, tr("transfer.target.continue"))
          )
        ),
        transferTarget === "continue" && (0, import_react3.createElement)(
          "div",
          { className: "dsh-dschat-field" },
          (0, import_react3.createElement)("label", null, tr("transfer.continueTo")),
          continuationTargets.length === 0 ? (0, import_react3.createElement)("p", { className: "dsh-dschat-hintline" }, tr("transfer.continue.empty")) : (0, import_react3.createElement)("select", {
            className: "dsh-dschat-select",
            value: continueTargetId ?? "",
            onChange: (event) => setTargetSessionId(event.target.value)
          }, continuationTargets.map((target) => (0, import_react3.createElement)("option", { key: target.id, value: target.id }, target.title)))
        ),
        transferTarget === "new" && (0, import_react3.createElement)(
          "div",
          { className: "dsh-dschat-field" },
          (0, import_react3.createElement)("label", null, tr("transfer.workspace")),
          (0, import_react3.createElement)(
            "select",
            {
              className: "dsh-dschat-select",
              value: targetWorkspaceId ?? "",
              onChange: (event) => {
                const value = event.target.value;
                if (value === "__new__") {
                  void createTargetWorkspace();
                  return;
                }
                setTargetWorkspaceId(value === "" ? void 0 : value);
              }
            },
            (0, import_react3.createElement)("option", { value: "" }, tr("transfer.ungrouped")),
            workspaces.map((workspace) => (0, import_react3.createElement)(
              "option",
              { key: workspace.id, value: workspace.id },
              `${workspace.title} \u2014 ${workspace.path}`
            )),
            (0, import_react3.createElement)("option", { value: "__new__" }, `\uFF0B ${tr("transfer.workspace.new")}`)
          )
        ),
        stage > 0 && (0, import_react3.createElement)(
          "div",
          { className: "dsh-dschat-steps" },
          (0, import_react3.createElement)(
            "div",
            { className: "dsh-dschat-prog" },
            (0, import_react3.createElement)("i", { style: { width: `${Math.min(stage, 3) / 3 * 100}%` } })
          ),
          [1, 2, 3].map((step) => (0, import_react3.createElement)(
            "div",
            { key: step, className: "dsh-dschat-step", "data-done": step < stage ? "true" : void 0 },
            step < stage ? (0, import_react3.createElement)("span", { className: "dsh-dschat-tick" }, (0, import_react3.createElement)(CheckIcon, {})) : (0, import_react3.createElement)("span", { className: "dsh-dschat-spin" }),
            (0, import_react3.createElement)(
              "span",
              null,
              step === 1 ? transferMode === "distill" ? tr("transfer.step.distill") : tr("transfer.mode.raw") : step === 2 ? tr("transfer.step.session") : tr("transfer.step.open")
            )
          ))
        ),
        (0, import_react3.createElement)(
          "div",
          { className: "dsh-dschat-pop-foot" },
          (0, import_react3.createElement)("button", {
            type: "button",
            className: "dsh-dschat-btn dsh-dschat-btn-primary",
            disabled: transferring,
            onClick: () => {
              void runTransfer();
            }
          }, transferTarget === "continue" ? tr("transfer.target.continue") : tr("action.startTransfer")),
          (0, import_react3.createElement)("span", { className: "dsh-dschat-hintline", style: { margin: 0 } }, note)
        )
      )
    );
  }
  function moreMenu() {
    return (0, import_react3.createElement)(
      "div",
      { className: "dsh-dschat-pop-wrap", ref: morePopRef },
      (0, import_react3.createElement)(
        "button",
        {
          type: "button",
          className: "dsh-dschat-btn dsh-dschat-btn-icon",
          title: "\xB7\xB7\xB7",
          "aria-label": "\xB7\xB7\xB7",
          onClick: () => setMoreOpen((value) => !value)
        },
        (0, import_react3.createElement)(MoreIcon, {})
      ),
      moreOpen && (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-pop", style: { width: "230px" } },
        moreItem("export", tr("action.exportFile"), () => {
          void exportFile();
        }),
        moreItem("login", tr("action.openLogin"), () => {
          void openLogin();
        }, loggedIn === true),
        moreItem("close", tr("action.closeBrowser"), () => {
          void api.closeBrowser().catch(() => void 0);
        }, (state?.engine ?? "stopped") === "stopped")
      )
    );
    function moreItem(key, label, run, hidden = false) {
      if (hidden) return null;
      return (0, import_react3.createElement)(
        "button",
        {
          key,
          type: "button",
          className: "dsh-dschat-btn",
          style: { width: "100%", justifyContent: "flex-start" },
          onClick: () => {
            run();
            setMoreOpen(false);
          }
        },
        label
      );
    }
  }
}
function relativeTime(ts, tr) {
  const delta = Date.now() - ts;
  const minutes = Math.floor(delta / 6e4);
  if (minutes < 1) return tr("time.justNow");
  if (minutes < 60) return fmt(tr("time.minutes"), { count: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fmt(tr("time.hours"), { count: String(hours) });
  const days = Math.floor(hours / 24);
  if (days < 7) return fmt(tr("time.days"), { count: String(days) });
  return new Date(ts).toLocaleDateString();
}

// src/client/panel/DSchatSettings.tsx
var import_react4 = require("react");
function DSchatSettings(props) {
  const { api, tt, t } = props;
  const tr = (0, import_react4.useCallback)((key) => (t ?? tt)(key), [t, tt]);
  const [state, setState] = (0, import_react4.useState)(null);
  const [settings, setSettings] = (0, import_react4.useState)(null);
  const [failed, setFailed] = (0, import_react4.useState)(void 0);
  const refresh = (0, import_react4.useCallback)(async () => {
    try {
      const [snapshot2, context] = await Promise.all([api.state(), api.context()]);
      if (snapshot2.ok === true) setState(snapshot2);
      if (context.ok === true && context.settings !== void 0) setSettings(context.settings);
      setFailed(void 0);
    } catch (error) {
      setFailed(String(error));
    }
  }, [api]);
  (0, import_react4.useEffect)(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refresh();
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 3e3);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);
  const openLogin = (0, import_react4.useCallback)(() => {
    void api.openLogin().catch(() => void 0);
  }, [api]);
  const closeBrowser = (0, import_react4.useCallback)(() => {
    void api.closeBrowser().catch(() => void 0);
  }, [api]);
  const phase = state === null ? "stopped" : phaseOf({ engine: state.engine, loggedIn: state.loggedIn, busy: state.busy, chats: state.chats });
  const loggedIn = state?.loggedIn ?? null;
  const statusText = (() => {
    switch (phase) {
      case "launching":
        return tr("status.launching");
      case "need-login":
        return tr("status.needLogin");
      case "error":
        return `${tr("status.error")}${state?.engineError !== void 0 ? `\uFF1A${state.engineError}` : ""}`;
      case "thinking":
        return tr("status.thinking");
      case "streaming":
        return tr("status.streaming");
      case "ready":
        return tr("status.ready");
      default:
        return tr("status.stopped");
    }
  })();
  const row = (label, value, mono = false) => (0, import_react4.createElement)(
    "div",
    { className: "dsh-dschat-setrow", key: label },
    (0, import_react4.createElement)("span", { className: "dsh-dschat-setlabel" }, label),
    (0, import_react4.createElement)("span", {
      className: mono ? "dsh-dschat-setvalue dsh-dschat-mono" : "dsh-dschat-setvalue",
      title: typeof value === "string" ? value : void 0
    }, value)
  );
  const yesNo = (value) => value === true ? (0, import_react4.createElement)("span", { className: "dsh-dschat-on" }, (0, import_react4.createElement)(CheckIcon, {}), tr("settings.yes")) : (0, import_react4.createElement)("span", { className: "dsh-dschat-off" }, (0, import_react4.createElement)(CloseIcon, { size: 10 }), tr("settings.no"));
  return (0, import_react4.createElement)(
    "div",
    { className: "dsh-dschat dsh-dschat-settings" },
    (0, import_react4.createElement)(
      "header",
      { className: "dsh-dschat-sethead" },
      (0, import_react4.createElement)("h1", null, tr("settings.title")),
      (0, import_react4.createElement)("p", null, tr("settings.description"))
    ),
    (0, import_react4.createElement)(
      "section",
      { className: "dsh-dschat-setcard" },
      (0, import_react4.createElement)("h2", null, tr("settings.status")),
      row(tr("settings.phase"), statusText),
      row(
        tr("settings.login"),
        loggedIn === true ? tr("settings.login.yes") : loggedIn === false ? tr("settings.login.no") : tr("settings.login.unknown")
      ),
      row(tr("settings.page"), state?.pageUrl ?? "\u2014", true),
      state?.lastError !== void 0 ? row(tr("settings.lastError"), state.lastError) : null
    ),
    (0, import_react4.createElement)(
      "section",
      { className: "dsh-dschat-setcard" },
      (0, import_react4.createElement)("h2", null, tr("settings.runtime")),
      settings === null ? (0, import_react4.createElement)("p", { className: "dsh-dschat-hintline" }, failed ?? tr("settings.loading")) : (0, import_react4.createElement)(
        "div",
        null,
        row(tr("settings.channel"), settings.browserChannel === "" ? "auto" : settings.browserChannel),
        row(tr("settings.headless"), yesNo(settings.browserHeadless)),
        row(tr("settings.proxy"), settings.browserProxy === "" ? "direct" : settings.browserProxy),
        row(tr("settings.timeout"), `${Math.round(settings.replyTimeoutMs / 1e3)}s`),
        row(tr("settings.executable"), settings.browserExecutablePath === "" ? tr("settings.auto") : settings.browserExecutablePath, true),
        row(tr("settings.dataDir"), settings.dataDir, true),
        row(tr("settings.profileDir"), settings.profileDir, true),
        row(tr("settings.exportDir"), settings.exportDir, true),
        row(tr("settings.distill"), yesNo(settings.transferDistill)),
        row(
          tr("settings.distillModel"),
          settings.transferModel === "" ? tr("settings.auto") : `${settings.transferProvider === "" ? tr("settings.auto") : settings.transferProvider} / ${settings.transferModel}`,
          true
        ),
        row(tr("settings.announce"), yesNo(settings.announceToAgent))
      )
    ),
    (0, import_react4.createElement)(
      "section",
      { className: "dsh-dschat-setcard" },
      (0, import_react4.createElement)("h2", null, tr("settings.actions")),
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-setactions" },
        (0, import_react4.createElement)("button", {
          type: "button",
          className: "dsh-dschat-btn dsh-dschat-btn-primary",
          onClick: openLogin
        }, tr("action.openLogin")),
        (0, import_react4.createElement)("button", {
          type: "button",
          className: "dsh-dschat-btn dsh-dschat-btn-ghost",
          disabled: (state?.engine ?? "stopped") === "stopped",
          onClick: closeBrowser
        }, tr("action.closeBrowser"))
      ),
      (0, import_react4.createElement)("p", { className: "dsh-dschat-sethint" }, tr("settings.where"))
    )
  );
}

// src/client/panel/styles.ts
var PANEL_CSS = `
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
   * became a light grey slab on the dark panel \u2014 the reported "\u592A\u767D\u4E86".
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
 * Collapse the sidebar and that column goes to 0px \u2014 the panel starts at the
 * window edge and its rail toggle, brand mark and brand name were painted
 * underneath the traffic lights; the shell's own window-chrome controls (the
 * shell.leading seat: \u6253\u5F00\u4FA7\u8FB9\u680F + \u65B0\u5EFA\u4F1A\u8BDD, 88px..152px at y=11..39) landed on
 * the brand name as well. That is the reported "\u4FA7\u8FB9\u680F\u6536\u8D77\u540E\u6309\u94AE\u4E0D\u517C\u5BB9".
 *
 * The shell reserves the band with --dsh-frame-leading-clearance, set on the
 * frame ONLY while [data-sidebar-collapsed] is on (160px, 84px in fullscreen,
 * undefined on Windows/Web where a real title bar owns that space). Its own
 * Conversation header consumes it as max(0px, clearance - 20px) on a row that
 * already carries a 20px inline padding, i.e. its content starts exactly at the
 * clearance edge. Reading the same variable puts this header on that same edge
 * in every window state, including fullscreen, and the 0px fallback keeps the
 * original 14px whenever the shell sets no chrome band at all \u2014 so nothing
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
 * Without it this panel \u2014 a full-width seat at the very top of the window \u2014
 * covered the only strip the user could grab, so the title bar looked blank and
 * double-clicking it did not maximise the window. NO CSS FOR THIS BELONGS HERE:
 * the rule must stay in the shell's sheet, because a plugin sheet that wins the
 * cascade would put drag on the header's buttons too. The shell's blanket
 * rule \u2014 every button, a, input, select and textarea is no-drag \u2014 is what keeps
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
 * actions off the edge. The spacer \u2014 the run of empty, draggable space \u2014 gives
 * up its width first, and it is the only thing that can: everything else in the
 * row is a control the reader needs. The status sentence that used to ellipsize
 * here is a tooltip now, so there is nothing left to truncate.
 */
/*
 * The header's product mark, and the panel's state lamp.
 *
 * It replaced the panel name and a status chip. The NAME was redundant \u2014 the
 * sidebar row and the document title already say DSchat, and this was the third
 * copy. The CHIP was worse than redundant: \u300C\u25CF \u5DF2\u5C31\u7EEA \xB7 deepseek-reasoner\u300D was
 * drawn at the window controls' own height and radius, one gap away from them,
 * so it read as a fourth button in that row and did nothing when clicked.
 *
 * The colour is therefore not decoration, it is the whole readout:
 *
 *   grey   nothing is running (or the browser is up but nobody is signed in)
 *   blue   the web engine is usable \u2014 \u300C\u5DF2\u5C31\u7EEA\u300D
 *   amber \u2192 red while it settles into a usable/unusable state
 *   red    the engine reported an error, which must NOT look like a plain stop
 *
 * The stale chip's sentence survives as this button's tooltip, and as its
 * accessible name, so the state is never carried by colour alone.
 *
 * A fixed box in every state \u2014 same width, same height, same glyph \u2014 so the
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
 * Opacity only \u2014 an animated transform on the mark would resize the toolbar row
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
 * The header's window controls: \u4F1A\u8BDD\u5217\u8868 / \u641C\u7D22 / \u65B0\u5EFA\u5BF9\u8BDD.
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
 * The primary button speaks the SAME colour scheme as the \u6DF1\u5EA6\u601D\u8003 / \u8054\u7F51
 * toggles, on purpose: in the composer these sit side by side, and the toggle
 * pair is the visual language of "this panel's accent".
 *
 * button-primary-fill resolves to brand-primary, which flips per theme:
 * near-white #f9fafb in dark mode, near-black in light mode. In dark mode that
 * made the button \u2014 and the menu it opens \u2014 the brightest thing on the panel,
 * the reported "\u592A\u767D\u4E86". Both ends of that family are inverted relative to the
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
 * Specificity note \u2014 .dsh-dschat-btn:disabled (0,2,0) beats both the variant
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
 * RAIL_WIDTH_DEFAULT), so this rule carries only the fallback \u2014 a panel whose
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
 * the resize cursor and the text-selection block belong to the whole panel \u2014
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
 * outside the content, and the animation fades it without a second state \u2014 the
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
 * the reader wants there is not the engine's \u300C\u601D\u8003\u8FC7\u7A0B\u300D but the panel's own
 * \u300C\u5DF2\u601D\u8003\uFF08\u7528\u65F6 1 \u5206 12 \u79D2\uFF09\u300D. The engine still STORES the reasoning inside a
 * details wrapper (that is the transcript format); the panel splits it off
 * and renders it here, so no details element ever reaches the DOM.
 *
 * While the thought is LIVE ('[data-live="true"]') the row is the running
 * commentary instead of a summary: the accent tint marks it as in-progress, and
 * the header swaps its label for the {@link ThinkingLive} line. The accent is
 * 'label-deep-diving', the harness's own token for "a model is reasoning right
 * now" \u2014 the same colour the shell paints its own thinking indicator with.
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
 * The live line: \u300C\u601D\u8003\u4E2D\uFF1A\u300D + the newest characters of the reasoning, on ONE line.
 *
 * Three boxes, and each one is load-bearing:
 *
 *   .dsh-dschat-think-live       the flex row that owns the free width
 *   .dsh-dschat-think-live-prefix  the fixed \u300C\u601D\u8003\u4E2D\uFF1A\u300D, never scrolled, never cut
 *   .dsh-dschat-think-live-clip  the clip window (overflow hidden, one line)
 *   .dsh-dschat-think-live-tail  the text itself, translated left past the clip
 *
 * The panel sets the translate (see ThinkingLive): it measures the overflow and
 * moves the tail by exactly that much, so the newest characters are always the
 * ones on screen. 'min-width: 0' on the clip is what lets a flex child shrink
 * below its content width at all \u2014 without it the row would push the caret off
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
 * clicked asked for the thought, and a header row saying \u300C\u601D\u8003\u4E2D\u2026\u300D over a page
 * of reasoning was the reported bug. So this element is the whole block, and it
 * has to be the collapse control itself \u2014 hence a pointer on its content, which
 * is the only thing that says "click me to put that line back".
 *
 * Where the pointer goes, and where it does not. This is a scroll box: a
 * pointer over a scrollbar is a lie, and a pointer over a paragraph a reader is
 * trying to SELECT is worse. So the pointer is scoped to the markdown wrapper
 * (a real child element, so the box's own padding and scrollbar stay on the
 * default cursor) and the things that are NOT a collapse \u2014 a link, or any
 * control the renderer put inside the reasoning \u2014 take it back. A press
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
 * The source list under a cited reply (the panel's answer to the web's \u53C2\u8003\u6765\u6E90).
 *
 * Collapsed by default \u2014 a searched reply can cite twenty pages, and a full
 * list under every answer turns the transcript into a link dump. The head is
 * the control and carries the count (\u300C\u53C2\u8003\u6765\u6E90\uFF088\uFF09\u300D), so a collapsed list still
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
 * An assistant message spans the full column and its head (name \xB7 time) sits at
 * the LEFT, so the row rides the head line at the right edge. A user message is
 * a right-aligned bubble: anchoring its row to the message box parked it at the
 * far left, hundreds of pixels from the bubble. The bubble is therefore wrapped
 * in the .dsh-dschat-msg-line wrapper, which shrink-wraps it, and becomes the row's
 * containing block \u2014 so right:100% sits just outside the bubble at any width,
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
 * and a two-part shadow that is almost nothing \u2014 rgba(0,0,0,.02) 0 4px 12px plus
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
 * 'bg-layer-1' \u2014 the token the harness raises its own cards with, and one step
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
 * here are therefore load-bearing \u2014 min-height is what an empty box measures,
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
 * navy over a #232324 card is not a wash \u2014 it is a bruise: the card went muddy
 * grey-blue and the accent it was supposed to advertise disappeared into it.
 * Dark mode therefore mixes the accent into the card's own layer at the same 5%
 * and then LIFTS the result toward white, so the tint survives the dark base
 * instead of being swallowed by it. The border does the advertising in the dark
 * branch anyway \u2014 an accent hairline is legible where a 5% fill is not.
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
 * off deliberately \u2014 the row's contents are fixed (two pills, a paperclip, the
 * send circle) and wrapping the send button onto a second line on a narrow panel
 * would be worse than letting the spacer collapse.
 */
.dsh-dschat-tools { display: flex; align-items: center; gap: 4px; padding: 12px; }
/* The Finder input is clicked from the tool row; it must never take layout. */
.dsh-dschat-fileinput { display: none; }
/*
 * \u9644\u4EF6: a 34px glyph button, exactly like the pills beside it.
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
 * The composer's \u6DF1\u5EA6\u601D\u8003 / \u667A\u80FD\u641C\u7D22 pills.
 *
 * Measured on the live page rather than guessed: 34px tall, 18px radius, 10px
 * of side padding, a 4px gap between the glyph and the label, '13px/500' text,
 * and \u2014 the part that makes them recognisable \u2014 a NEUTRAL outline when off and
 * the accent wash when on:
 *
 *   off  fill rgba(45,53,70,.8) / border rgba(78,109,181,.8) / label #f9fafb
 *   on   fill #283142           / border #4868b2                / label #679efe
 *
 * Those are the page's dark-mode values; on the panel they are expressed in the
 * harness's own tokens, which resolve per theme for the same effect \u2014 the fill
 * is a neutral layer, and the "on" wash is the deepseek-static blue family that
 * DSH ships for exactly this purpose (with a color-mix fallback if a future
 * theme drops the statics). The "on" state deliberately sits inside the same
 * recipe the transfer button uses, so the accent still reads as one family.
 *
 * DARK MODE: the OFF pill must be a hole, not a window.
 *
 * 'bg-layer-2' is the right neutral on paper \u2014 one step off the card \u2014 but in
 * the dark ramp the two steps run the WRONG WAY for this pair: layer-1 is
 * #232324 and layer-2 is #2c2c2e, so the pill came out DARKER and warmer than
 * the card it sits on. Two misaligned greys inside one 24px-radius card is what
 * made the dark composer look assembled rather than designed. The dark branch
 * therefore drops the fill and lets the border describe the pill, keeping the
 * hover wash to say it is still a control. The "on" pill keeps its fill \u2014
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
 * belt-and-braces \u2014 it is a specificity requirement.
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
 * written out \u2014 keyed off the shell's own 'data-ds-dark-theme', which is a user
 * setting rather than the OS's, and matched to the selector shape the popover
 * rules below already use.
 *
 * The compound class is repeated for the same reason it is above: the blanket
 * button rule outranks a single class, so a dark pill written the short way
 * would keep the light-mode accent. Measured at (0,2,1) versus (0,1,1).
 *
 * AND THE LABEL MUST BE NAMED HERE TOO \u2014 that is the reported bug.
 *
 * The light branch above is ONE rule with TWO selectors, and it sets the label's
 * colour through the second one: (0,2,1), which beats '.dsh-dschat-toggle-text'
 * at (0,1,0). This branch used to name only the pill, at (0,3,0) \u2014 which beats
 * the pill's (0,2,1) but equals the LABEL selector's (0,2,1) and therefore
 * LOSES to it on document order. The result, measured on a real render and not
 * guessed: in dark mode the lit pill painted its fill and border from the dark
 * branch while the words \u300C\u6DF1\u5EA6\u601D\u8003\u300D stayed #edf3fe \u2014 a near-white label with a
 * cold blue fill, which is the "\u989C\u8272\u4ECD\u7136\u4E0D\u5BF9" the reader saw. The glyph was
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
 * background can never be re-declared by the light branch \u2014 a text span with
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
 * decide between them \u2014 and the "on" branch must win, because a lit pill that
 * loses its fill to the off branch looks like a broken switch. Written here,
 * after it, the off rule covers what it should (both plain states) and yields
 * on every class the on rule names. The earlier draft of this file had them the
 * other way round, which silently flattened the lit pill back to transparent.
 *
 * Why a hole instead of a fill: 'bg-layer-2' is one step DARKER than the card's
 * 'bg-layer-1' in the dark ramp (#2c2c2e over #232324) \u2014 the opposite direction
 * from light mode \u2014 so the off pill read as a slightly different, warmer grey
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
 * \u53D1\u9001: the page's 34px filled circle.
 *
 * The fill is the accent itself \u2014 'state-business-primary', the token whose
 * light value is the page's #4176e6 \u2014 rather than 'button-primary-fill', which
 * resolves to brand-primary and flips to near-white in dark mode (the "\u592A\u767D\u4E86"
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
 * The composer's right-hand keyboard hint (\u300C\u2318K \u641C\u7D22\u300D) is GONE, and so is the
 * rule that used to hide its text below 620px.
 *
 * It documented a shortcut for a control that is already on screen, in the row's
 * most valuable space \u2014 the strip between the paperclip and the send circle. At
 * a glance it read as a second, disabled send button with a stray label beside
 * it. \u2318K still opens the rail's search box; it just no longer advertises itself
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
`;

// src/client/index.ts
var NS = "dsh-dschat";
var PANEL_ID = "dschat";
var inject = ["slots", "locale", "layout"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-dschat: dictionaries");
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = NS;
    tag.textContent = PANEL_CSS;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, "dsh-dschat: styles");
  const api = new DSchatApi();
  const tt = ctx.locale.bind(NS);
  const readService = (key) => ctx.get(key);
  const OPEN_SESSION_ATTEMPTS = 50;
  const OPEN_SESSION_RETRY_MS = 60;
  const openSession = async (sessionId) => {
    const sessions = readService("sessions");
    try {
      await sessions?.refreshProjections?.(sessionId)?.catch(() => void 0);
    } catch {
    }
    return await new Promise((resolve) => {
      let attempt = 0;
      const navigate = () => {
        const uiWorkspace = readService("uiWorkspace");
        if (uiWorkspace === void 0) {
          console.warn("[dsh-dschat] openSession: the uiWorkspace service is unavailable");
          resolve(false);
          return;
        }
        try {
          uiWorkspace.openSession(sessionId);
          resolve(true);
        } catch (error) {
          if (++attempt < OPEN_SESSION_ATTEMPTS) {
            window.setTimeout(navigate, OPEN_SESSION_RETRY_MS);
            return;
          }
          console.warn("[dsh-dschat] openSession failed:", error);
          resolve(false);
        }
      };
      navigate();
    });
  };
  const pickDirectory = async () => {
    try {
      return await readService("uiWorkspace")?.pickDirectory() ?? null;
    } catch {
      return null;
    }
  };
  const createWorkspace = async (path) => {
    const workspaces = readService("workspaces");
    if (workspaces === void 0) throw new Error("workspaces service unavailable");
    const created = await workspaces.create({ path });
    return { workspaceId: created.workspaceId, title: created.title };
  };
  const disposers = [];
  try {
    disposers.push(ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
      { name: "sidebar.panellist", id: PANEL_ID, order: 20, label: () => tt("nav.label"), locale: NS },
      ChatIcon
    )));
    disposers.push(ctx.slots.inject("main", () => ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ api, tt, openSession, pickDirectory, createWorkspace })
      },
      DSchatPanel
    )));
    disposers.push(ctx.slots.inject("settings.section", () => ctx.slots.register(
      {
        name: "settings.section",
        id: PANEL_ID,
        order: 50,
        label: () => tt("settings.title"),
        locale: NS,
        inject: () => ({ api, tt })
      },
      DSchatSettings
    )));
  } catch (error) {
    console.warn("[dsh-dschat] slot registration failed:", error);
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose();
  }, "dsh-dschat: slots");
}

		if (module.exports.apply === undefined && typeof apply === 'function') module.exports.apply = apply;
		if (module.exports.inject === undefined && typeof inject !== 'undefined') module.exports.inject = inject;
		return module.exports;
	}
});
