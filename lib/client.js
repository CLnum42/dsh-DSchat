window.__ModuleLoader__.load({
	id: "dsh-dschat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
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
var THINKING_BLOCK = /^<details>\s*<summary>[^<]*<\/summary>([\s\S]*?)<\/details>/;
function answerBody(content) {
  const text = content.trimStart();
  if (!text.startsWith("<details>")) return content.trim();
  const closed = THINKING_BLOCK.exec(text);
  if (closed === null) return "";
  return text.slice(closed[0].length).trim();
}
function thinkingBody(content) {
  const text = content.trimStart();
  if (!text.startsWith("<details>")) return "";
  const closed = THINKING_BLOCK.exec(text);
  if (closed !== null) return (closed[1] ?? "").trim();
  const opener = text.indexOf("</summary>");
  return opener < 0 ? "" : text.slice(opener + "</summary>".length).trim();
}
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
  const position = (chat.messages ?? []).findIndex((item) => item.id === message.id);
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
      /*
       * The count follows the body. A tail that APPENDS a message is the one
       * case where the sidebar would otherwise understate a conversation
       * until the next `/state` — and it is the visible case, because the
       * reply the reader is watching is the message being counted.
       */
      messageCount: position < 0 ? item.messageCount + 1 : item.messageCount,
      messages: position < 0 ? [...item.messages, merged] : item.messages.map((candidate, j) => j === position ? merged : candidate)
    } : item)
  };
}
var DSCHAT_API = {
  state: "/api/dsh-dschat/state",
  /**
   * The per-run CSRF token on its own, for a client that must re-arm after a
   * host restart without paying for a whole `/state` snapshot.
   */
  token: "/api/dsh-dschat/token",
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
  /**
   * One conversation WITH its messages.
   *
   * The counterpart of the summarized `/state`: the panel asks for the body of
   * the conversation it is about to render, and of the one a reply is streaming
   * into. `id` omitted means the active conversation.
   */
  chat: "/api/dsh-dschat/chat",
  /**
   * Which conversations contain a string, answered by the HOST.
   *
   * The panel used to filter the list by scanning every message it held, which
   * only worked because `/state` carried the whole store. With summaries there
   * is nothing local to scan, and fetching 215 bodies to answer one keystroke is
   * worse than the problem being solved — so the scan happens where the data is.
   *
   * NAMED APART FROM `search` ON PURPOSE: that key is the WEB-SEARCH toggle
   * (`/search`, a POST with `{ enabled }`), and an earlier revision gave this
   * route the same key. A later key silently wins in an object literal, so
   * `DSCHAT_API.search` resolved to the toggle and this route became
   * unreachable: every message search was a POST-less GET to a write-guarded
   * route, i.e. a 405 the panel reported to nobody. `route-surface.test.ts`
   * now fails when two endpoints share a key.
   */
  searchConversations: "/api/dsh-dschat/search-conversations",
  wake: "/api/dsh-dschat/wake",
  openLogin: "/api/dsh-dschat/open-login",
  closeBrowser: "/api/dsh-dschat/close-browser",
  newChat: "/api/dsh-dschat/new-chat",
  restore: "/api/dsh-dschat/restore",
  attach: "/api/dsh-dschat/attach",
  /**
   * Read one stored attachment's bytes back, for the composer's thumbnails.
   *
   * A GET carrying the absolute path of a file `attach` already wrote. The host
   * answers 404 when that path is outside the attachment directory, has been
   * pruned, or is not a file — the composer then falls back to a name-only chip
   * rather than showing a broken image.
   */
  attachment: "/api/dsh-dschat/attachment",
  send: "/api/dsh-dschat/send",
  stop: "/api/dsh-dschat/stop",
  deepThink: "/api/dsh-dschat/deep-think",
  /** The WEB-SEARCH toggle (a POST with `{ enabled }`) — not conversation search. */
  search: "/api/dsh-dschat/search",
  transfer: "/api/dsh-dschat/transfer",
  /**
   * Build the hand-off text without writing it, so the reader can see (and
   * edit) what a transfer would put in the new session's first message.
   */
  transferPreview: "/api/dsh-dschat/transfer-preview",
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
var csrfToken = "";
var CSRF_HEADER = "x-dschat-token";
function rememberToken(payload) {
  const value = payload?.csrfToken;
  if (typeof value === "string" && value !== "") csrfToken = value;
}
var tokenInFlight;
async function loadToken() {
  if (tokenInFlight !== void 0) return tokenInFlight;
  tokenInFlight = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15e3);
    try {
      const response = await fetch(DSCHAT_API.token, { method: "GET", signal: controller.signal });
      rememberToken(await response.json().catch(() => void 0));
    } catch {
    } finally {
      window.clearTimeout(timer);
      tokenInFlight = void 0;
    }
  })();
  return tokenInFlight;
}
async function request(path, body, timeoutMs = REQUEST_TIMEOUT_MS, retried = false) {
  const mutating = body !== void 0;
  if (mutating && csrfToken === "") await loadToken();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (mutating) {
      headers["content-type"] = "application/json";
      if (csrfToken !== "") headers[CSRF_HEADER] = csrfToken;
    }
    const response = await fetch(path, {
      method: mutating ? "POST" : "GET",
      headers: mutating ? headers : void 0,
      body: mutating ? JSON.stringify(body) : void 0,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!retried && response.status === 403 && payload.code === "CSRF") {
      csrfToken = "";
      await loadToken();
      window.clearTimeout(timer);
      return request(path, body, timeoutMs, true);
    }
    rememberToken(payload);
    if (!response.ok && payload.ok !== true) {
      return { ...payload, ok: false, error: payload.error ?? `HTTP ${response.status}` };
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: `timeout after ${Math.round(timeoutMs / 1e3)}s: ${path}` };
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
  /*
   * These three drive the browser, so they are POSTs now. They used to be GETs
   * with no body, which made them reachable by a plain `<img src=...>` from any
   * other page on this machine — opening a login window, waking a browser or
   * killing the user's session — with no line of the panel involved.
   */
  openLogin() {
    return request(DSCHAT_API.openLogin, {}, TIMEOUT.login);
  }
  /**
   * "I want to type": start the web page in the mode that suits an existing
   * session, without assuming the visible login window is wanted.
   *
   * See `WakeResult`: `loginWindow` means a visible window is already open, so
   * the caller must not ask for one again.
   */
  wake() {
    return request(DSCHAT_API.wake, {}, TIMEOUT.login);
  }
  closeBrowser() {
    return request(DSCHAT_API.closeBrowser, {}, TIMEOUT.login);
  }
  newChat() {
    return request(DSCHAT_API.newChat, {}, TIMEOUT.login);
  }
  /**
   * One conversation with its messages (`id` omitted = the active one).
   *
   * `/state` reports summaries only, so this is how a body is obtained: the
   * panel asks for the conversation it is rendering, and for the one a reply is
   * streaming into.
   */
  chat(id) {
    const query = id === void 0 ? "" : `?id=${encodeURIComponent(id)}`;
    return request(`${DSCHAT_API.chat}${query}`, void 0, TIMEOUT.poll);
  }
  /**
   * Which conversations contain `q`, answered by the host.
   *
   * Deferred to the host because the text lives there: with `/state` summarized,
   * a client-side scan would only ever search the bodies it happened to have
   * fetched, which is a search that silently stops working.
   */
  searchConversations(q) {
    return request(
      `${DSCHAT_API.searchConversations}?q=${encodeURIComponent(q)}`,
      void 0,
      TIMEOUT.poll
    );
  }
  /** Host facts: workspace list + the most recent session cwd. */
  context() {
    return request(DSCHAT_API.context, void 0, TIMEOUT.poll);
  }
  /**
   * Persist pasted/dropped bytes and get back a real path for the engine.
   *
   * `name` comes back as well, and that is not redundant: `path` is the stored
   * `${uuid}__${name}${ext}`, whose last segment is what the composer used to
   * print as the label. The bare name is what the chip shows.
   */
  attach(input) {
    return request(DSCHAT_API.attach, input, TIMEOUT.attach);
  }
  /**
   * The URL an attachment's bytes are served from.
   *
   * A plain string rather than a fetch, because it is the `src` of an `<img>`:
   * the browser's own image cache then does the work (the same thumbnail is not
   * re-read on every poll), and a missing file simply fails to load, which is
   * what `onError` would answer anyway.
   *
   * @param path - the absolute path `/attach` answered with.
   */
  attachmentUrl(path) {
    return `${DSCHAT_API.attachment}?path=${encodeURIComponent(path)}`;
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
   *
   * `code` is carried through because `BUSY` is not an error the reader should
   * see: it means the previous turn was still running when this one arrived
   * (the panel's own snapshot lags the engine by up to a poll), and the panel
   * answers it by queueing the message instead of refusing it.
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
  /**
   * Ask what a transfer WOULD write, without writing anything.
   *
   * The whole point of the hand-off preview: distillation drops the reasoning
   * and every source link, and it can fail into a raw replay without saying so,
   * so the reader gets to see (and edit) the first message before a session
   * exists.
   */
  transferPreview(chatId, cwd, mode, workspaceId, targetSessionId) {
    return request(DSCHAT_API.transferPreview, { chatId, cwd, mode, workspaceId, targetSessionId }, TIMEOUT.transfer);
  }
  /**
   * Write the hand-off.
   *
   * `seed` carries the text the reader confirmed (and possibly edited) together
   * with whether it came from a distillation, so the host writes those exact
   * bytes instead of distilling a second time.
   */
  transfer(chatId, cwd, mode, workspaceId, targetSessionId, seed) {
    return request(DSCHAT_API.transfer, {
      chatId,
      cwd,
      mode,
      workspaceId,
      targetSessionId,
      ...seed === void 0 ? {} : { markdown: seed.markdown, distilled: seed.distilled }
    }, TIMEOUT.transfer);
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
  /**
   * What the live page actually contains, for a failed recover.
   *
   * The route has existed since the first release and was reachable only with
   * curl: a failed sync reported "页面可能已改版" and left the reader with nothing
   * to act on. It backs the status card's 「复制诊断」, which is where someone
   * reporting a problem can get the evidence in one click.
   */
  probePage() {
    return request(DSCHAT_API.probePage, void 0, TIMEOUT.webList);
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
function MenuIcon({ size = 16 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h10.8" }));
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
function SwapIcon({ size = 14 }) {
  return svg(size, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2.6 5.4h9.1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9.4 3.1l2.3 2.3-2.3 2.3" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M13.4 10.6H4.3" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.6 8.3l-2.3 2.3 2.3 2.3" })
  ] }));
}

// src/client/locales.ts
var zh = {
  "nav.label": "\u804A\u5929",
  "panel.title": "\u804A\u5929",
  "panel.crashed": "\u9762\u677F\u6E32\u67D3\u51FA\u9519\uFF0C\u9875\u9762\u5176\u4F59\u90E8\u5206\u4E0D\u53D7\u5F71\u54CD\u3002\u91CD\u65B0\u8F7D\u5165\u9875\u9762\u5373\u53EF\u6062\u590D\uFF1B\u82E5\u53CD\u590D\u51FA\u73B0\u8BF7\u628A\u4E0B\u9762\u7684\u4FE1\u606F\u53CD\u9988\u7ED9\u7EF4\u62A4\u8005\u3002",
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
  "settings.build": "\u6784\u5EFA",
  "settings.version": "\u7248\u672C",
  "settings.built": "\u6784\u5EFA\u65F6\u95F4",
  "settings.unknown": "\u672A\u77E5",
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
  "settings.announce": "\u5728 system prompt \u91CC\u8BF4\u660E\u8FD9\u7EC4\u5DE5\u5177",
  "settings.actions": "\u64CD\u4F5C",
  "settings.where": "\u4EE5\u4E0A\u53C2\u6570\u6765\u81EA profile \u7684 cordis.patch.yml\uFF1A\u5728 dsh-dschat \u90A3\u4E00\u884C\u4E0B\u9762\u52A0 config: \u5757\uFF0C\u91CD\u542F Harness \u751F\u6548\uFF08\u8FD9\u4E00\u7248\u63D2\u4EF6\u6CA1\u6709\u81EA\u5E26\u8BBE\u7F6E\u8868\u5355\uFF09\u3002\u6D4F\u89C8\u5668 profile \u9ED8\u8BA4\u590D\u7528 dsh-webchat \u7684\u76EE\u5F55\uFF0C\u6240\u4EE5\u5207\u6362\u63D2\u4EF6\u4E0D\u9700\u8981\u91CD\u65B0\u767B\u5F55\u3002",
  "settings.loading": "\u6B63\u5728\u8BFB\u53D6\u8FD0\u884C\u53C2\u6570\u2026",
  "settings.auto": "\u81EA\u52A8",
  "settings.direct": "\u76F4\u8FDE",
  "status.title": "\u8FD0\u884C\u72B6\u6001",
  "status.description": "DeepSeek \u7F51\u9875\u7AEF\u5F15\u64CE\u7684\u5B9E\u65F6\u72B6\u6001\u4E0E\u89E3\u6790\u540E\u7684\u8FD0\u884C\u53C2\u6570\uFF08\u53EA\u8BFB\uFF09\u3002",
  "status.where": "\u4EE5\u4E0A\u53C2\u6570\u6765\u81EA profile \u7684 cordis.patch.yml\uFF1A\u5728 dsh-dschat \u90A3\u4E00\u884C\u4E0B\u9762\u52A0 config: \u5757\uFF0C\u91CD\u542F Harness \u751F\u6548\uFF08\u8FD9\u4E00\u7248\u63D2\u4EF6\u6CA1\u6709\u81EA\u5E26\u8BBE\u7F6E\u8868\u5355\uFF09\u3002\u6D4F\u89C8\u5668 profile \u9ED8\u8BA4\u590D\u7528 dsh-webchat \u7684\u76EE\u5F55\uFF0C\u6240\u4EE5\u5207\u6362\u63D2\u4EF6\u4E0D\u9700\u8981\u91CD\u65B0\u767B\u5F55\u3002",
  "status.diag.copy": "\u590D\u5236\u8BCA\u65AD",
  "status.diag.copied": "\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F\uFF0C\u76F4\u63A5\u8D34\u8FDB\u95EE\u9898\u53CD\u9988\u5373\u53EF",
  "status.diag.failed": "\u590D\u5236\u5931\u8D25\uFF08\u526A\u8D34\u677F\u4E0D\u53EF\u7528\uFF09\uFF1A\u8BCA\u65AD\u5185\u5BB9\u5DF2\u6253\u5370\u5230\u63A7\u5236\u53F0\uFF0C\u53EF\u4ECE\u90A3\u91CC\u590D\u5236",
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
  "action.sessions": "\u4F1A\u8BDD\u5217\u8868",
  "action.recover": "\u4ECE\u7F51\u9875\u540C\u6B65",
  "action.recover.hint": "\u628A\u7F51\u9875\u7AEF\u7684\u4F1A\u8BDD\u540C\u6B65\u5230\u672C\u5730\uFF1A\u6CA1\u6709\u7684\u6536\u8FDB\u6765\uFF0C\u5DF2\u6709\u7684\u53EA\u8865\u7F3A\u5931\u7684\u90A3\u90E8\u5206\uFF08\u4FDD\u7559\u672C\u5730\u7684\u6D88\u606F id\u3001\u65F6\u95F4\u4E0E\u601D\u8003\u7528\u65F6\uFF09",
  "action.stop": "\u505C\u6B62",
  "action.send": "\u53D1\u9001",
  "action.startTransfer": "\u5F00\u59CB\u8FC1\u79FB",
  "action.exportFile": "\u5BFC\u51FA markdown",
  /*
   * Header: the product mark, and the status lamp that replaced the three
   * window controls there (those moved above the composer).
   *
   * The lamp's four sentences are also its accessible names: colour is the
   * whole signal on screen, so a reader who cannot see the difference still has
   * to hear which of the four states the engine is in.
   */
  "brand.title": "DeepSeek Chat",
  "lamp.green": "\u6B63\u5E38\u8FD0\u884C",
  "lamp.red": "\u6545\u969C",
  "lamp.grey": "\u672A\u542F\u52A8",
  "lamp.amber": "\u6B63\u5728\u542F\u52A8\u6216\u672A\u767B\u5F55",
  /* The action row above the input card. */
  "composer.actions": "\u4F1A\u8BDD\u4E0E\u8FC1\u79FB\u64CD\u4F5C",
  /*
   * The 「···」 at the row's right end. It names WHAT the menu holds rather than
   * saying "更多" — the four entries are exactly what a reader goes looking for
   * by name (导出 markdown, 运行状态), so the tooltip and the accessible name
   * carry those words instead of a shrug.
   */
  "more.hint": "\u66F4\u591A\uFF1A\u8FD0\u884C\u72B6\u6001 / \u5BFC\u51FA markdown / \u767B\u5F55\u7A97\u53E3 / \u5173\u95ED\u6D4F\u89C8\u5668",
  "attach.show": "\u67E5\u770B\u9644\u4EF6",
  "attach.remove": "\u79FB\u9664\u9644\u4EF6",
  "attach.remove.hint": "\u79FB\u9664\u9644\u4EF6 {name}",
  "transfer.short": "DSH \u8FC1\u79FB",
  "transfer.short.hint": "\u5728 Harness \u4E2D\u7EE7\u7EED\uFF1A\u628A\u8FD9\u6B21\u7F51\u9875\u5BF9\u8BDD\u84B8\u998F\u6210\u7B80\u62A5\uFF0C\u6216\u6309\u539F\u6587\u8FC1\u79FB\u6210 harness \u4F1A\u8BDD",
  "rail.search": "\u641C\u7D22\u4F1A\u8BDD\u2026",
  "rail.search.hint": "\u641C\u7D22\u4F1A\u8BDD\u5185\u5BB9\uFF08\u2318K\uFF09",
  "rail.search.clear": "\u6E05\u7A7A\u641C\u7D22",
  "rail.show": "\u6253\u5F00\u4F1A\u8BDD\u5217\u8868",
  "rail.hide": "\u5173\u95ED\u4F1A\u8BDD\u5217\u8868",
  "rail.empty": "\u8FD8\u6CA1\u6709\u5BF9\u8BDD\uFF0C\u70B9\u8F93\u5165\u6846\u4E0A\u65B9\u7684\u300C\uFF0B \u65B0\u5BF9\u8BDD\u300D\u5F00\u59CB",
  "rail.noMatch": "\u6CA1\u6709\u5339\u914D\u7684\u4F1A\u8BDD",
  "rail.clear": "\u6E05\u7A7A\u5168\u90E8",
  "rail.clearConfirm": "\u786E\u8BA4\u6E05\u7A7A\uFF1F",
  "qnav.label": "\u63D0\u95EE\u5BFC\u822A",
  "qnav.title": "\u672C\u4F1A\u8BDD\u63D0\u95EE \xB7 {count} \u6761",
  "qnav.item": "\u7B2C {index} \u6761\u63D0\u95EE\uFF1A{text}",
  "qnav.attachment": "\uFF08\u9644\u4EF6\uFF09",
  "qnav.latest": "\u2193 \u6700\u65B0",
  "qnav.latest.hint": "\u56DE\u5230\u6700\u65B0\u6D88\u606F",
  "item.rename": "\u91CD\u547D\u540D",
  "item.rename.placeholder": "\u4F1A\u8BDD\u6807\u9898",
  "item.delete": "\u5220\u9664\uFF08\u53EF\u64A4\u9500\uFF09",
  "item.sync": "\u4ECE\u7F51\u9875\u540C\u6B65\u8FD9\u6761\uFF08\u53EA\u8865\u7F3A\u5931\u7684\u90E8\u5206\uFF09",
  "item.rename.ok": "\u786E\u8BA4\u91CD\u547D\u540D",
  "item.rename.cancel": "\u53D6\u6D88",
  "chats.count": "{count} \u6761",
  "time.justNow": "\u521A\u521A",
  "time.minutes": "{count} \u5206\u949F\u524D",
  "time.hours": "{count} \u5C0F\u65F6\u524D",
  "time.days": "{count} \u5929\u524D",
  "settings.yes": "\u662F",
  "settings.no": "\u5426",
  "engine.notice.title": "\u7F51\u9875\u7AEF\u6CA1\u6709\u5C31\u7EEA",
  "engine.notice.error.title": "\u7F51\u9875\u7AEF\u8FDE\u63A5\u51FA\u9519",
  "engine.notice.offline.title": "\u7F51\u9875\u7AEF\u8FD8\u6CA1\u8FDE\u4E0A",
  "engine.notice.offline.body": "\u53D1\u6D88\u606F\u524D\u9700\u8981\u5728\u540E\u53F0\u628A chat.deepseek.com \u62C9\u8D77\u6765\uFF08\u4F1A\u590D\u7528\u5DF2\u767B\u5F55\u7684\u6D4F\u89C8\u5668 profile\uFF0C\u901A\u5E38\u51E0\u79D2\uFF09\u3002",
  "engine.notice.login.title": "\u8FD8\u6CA1\u6709\u767B\u5F55 DeepSeek \u7F51\u9875\u7AEF",
  "engine.notice.login.body": "\u767B\u5F55\u7A97\u53E3\u4F1A\u590D\u7528\u5DF2\u4FDD\u5B58\u7684 profile\uFF1B\u767B\u5F55\u4E00\u6B21\u4E4B\u540E\u5C31\u4E0D\u518D\u9700\u8981\u3002",
  "engine.notice.retry": "\u91CD\u8BD5\u542F\u52A8\u7F51\u9875\u7AEF",
  "engine.notice.retrying": "\u6B63\u5728\u542F\u52A8\u2026",
  "engine.notice.unreachable": "\u672C\u673A\u5F15\u64CE\u6CA1\u6709\u54CD\u5E94\u542F\u52A8\u8BF7\u6C42\uFF08/wake \u65E0\u5E94\u7B54\uFF09\uFF0C\u6D88\u606F\u6CA1\u6709\u53D1\u51FA\u53BB\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002",
  "engine.notice.staleHost": "\u5BBF\u4E3B\u534A\u533A\u8FD8\u662F\u65E7\u7248\u672C\uFF08/wake \u8FD4\u56DE 404\uFF09\uFF0C\u5DF2\u6539\u4E3A\u6253\u5F00\u767B\u5F55\u7A97\u53E3\u3002\u91CD\u542F Harness \u540E\u81EA\u52A8\u542F\u52A8\u5373\u53EF\u7528\u3002",
  "engine.notice.needLogin": "\u7F51\u9875\u7AEF\u9700\u8981\u767B\u5F55\uFF1A\u8BF7\u5728\u5F39\u51FA\u7684\u6D4F\u89C8\u5668\u7A97\u53E3\u91CC\u5B8C\u6210\u767B\u5F55\uFF0C\u767B\u5F55\u6210\u529F\u540E\u8FD9\u6761\u63D0\u793A\u4F1A\u81EA\u52A8\u6D88\u5931\u3002",
  "engine.notice.queued": "\u5F85\u53D1\u6D88\u606F\u6682\u65F6\u53D1\u4E0D\u51FA\u53BB\uFF08\u7F51\u9875\u7AEF\u6CA1\u8D77\u6765\uFF09\u3002\u6D88\u606F\u8FD8\u5728\u961F\u5217\u91CC\uFF0C\u542F\u52A8\u6210\u529F\u540E\u4F1A\u81EA\u52A8\u53D1\u51FA\u3002",
  "empty.title": "\u76F4\u63A5\u548C DeepSeek \u5BF9\u8BDD",
  "empty.body": "\u6CBF\u7528\u4F60\u7684\u7F51\u9875\u767B\u5F55\uFF0C\u4E0D\u6D88\u8017 API \u989D\u5EA6\u3002\u804A\u5B8C\u4E00\u952E\u84B8\u998F\u6210\u4EFB\u52A1\u7B80\u62A5\u3002",
  "empty.try": "\u6216\u8005\u8BD5\u8BD5",
  "empty.try.translate": "\u628A\u82F1\u6587\u7FFB\u8BD1\u4E3A\u901A\u987A\u7684\u4E2D\u6587",
  "empty.try.summarize": "\u603B\u7ED3\u8FD9\u4EFD\u6587\u6863\u7684\u4E3B\u8981\u5185\u5BB9",
  "empty.try.polish": "\u6DA6\u8272\u8FD9\u6BB5\u6587\u5B57",
  "thread.loading": "\u6B63\u5728\u8F7D\u5165\u8FD9\u6BB5\u5BF9\u8BDD\u2026",
  "composer.placeholder": "\u7ED9 DeepSeek \u53D1\u6D88\u606F\uFF0C\u56DE\u8F66\u53D1\u9001",
  "composer.notLoggedIn": "\u767B\u5F55\u540E\u5373\u53EF\u53D1\u9001 \xB7 \u5148\u8F93\u5165\u4E5F\u884C",
  "composer.offline": "\u76F4\u63A5\u8F93\u5165\uFF0C\u4F1A\u81EA\u52A8\u5728\u540E\u53F0\u6253\u5F00",
  "composer.connecting": "\u6B63\u5728\u6253\u5F00 \xB7 \u53EF\u4EE5\u5148\u8F93\u5165",
  "composer.attach.drop": "\u677E\u5F00\u5373\u53EF\u6DFB\u52A0\u6587\u4EF6",
  "composer.queue.note": "\u4E0A\u4E00\u6761\u56DE\u590D\u8FD8\u5728\u751F\u6210\uFF0C\u4EE5\u4E0A\u6D88\u606F\u4F1A\u5728\u5B83\u7ED3\u675F\u540E\u4F9D\u6B21\u53D1\u51FA",
  "composer.queue.files": "\u9644\u4EF6 {count}",
  "composer.queue.cancel": "\u53D6\u6D88\u8FD9\u6761\u5F85\u53D1\u6D88\u606F",
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
  "msg.think.collapse": "\u70B9\u51FB\u6536\u8D77\u601D\u8003\u8FC7\u7A0B",
  "msg.details": "\u8BE6\u60C5",
  "msg.code.language": "\u6587\u672C",
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
  "transfer.preview": "\u9996\u6761\u6D88\u606F\u9884\u89C8\uFF08\u53EF\u7F16\u8F91\uFF09",
  "transfer.preview.distilled": "\u5DF2\u84B8\u998F\u4E3A\u4EFB\u52A1\u7B80\u62A5\uFF0C\u4E0B\u9762\u662F\u5373\u5C06\u5199\u5165\u7684\u5B8C\u6574\u5185\u5BB9",
  "transfer.preview.raw": "\u84B8\u998F\u4E0D\u53EF\u7528\uFF0C\u672C\u6B21\u4E3A\u539F\u6587\u5B8C\u6574\u8FC1\u79FB\uFF0C\u4E0B\u9762\u662F\u5373\u5C06\u5199\u5165\u7684\u5B8C\u6574\u5185\u5BB9",
  "transfer.preview.chars": "{count} \u5B57",
  "transfer.preview.edited": "\xB7 \u5DF2\u624B\u52A8\u4FEE\u6539",
  "transfer.preview.building": "\u751F\u6210\u9884\u89C8\u4E2D\u2026",
  "transfer.preview.rebuild": "\u91CD\u65B0\u751F\u6210\u9884\u89C8",
  "transfer.preview.note": "\u786E\u8BA4\u540E\u624D\u4F1A\u521B\u5EFA\u4F1A\u8BDD",
  "transfer.confirm": "\u786E\u8BA4\u5199\u5165",
  "toast.copied": "\u5DF2\u590D\u5236",
  "toast.send.failed": "\u53D1\u9001\u5931\u8D25\uFF1A{error}",
  "toast.wake.failed": "\u542F\u52A8\u7F51\u9875\u7AEF\u5931\u8D25\uFF1A{error}",
  "toast.send.needLogin": "\u8FD8\u6CA1\u6709\u767B\u5F55 DeepSeek \u7F51\u9875\u7AEF\uFF1A\u5728\u5F39\u51FA\u7684\u7A97\u53E3\u91CC\u5B8C\u6210\u767B\u5F55\u540E\uFF0C\u6D88\u606F\u5C31\u80FD\u53D1\u51FA\u53BB\u4E86\uFF08\u5185\u5BB9\u5DF2\u4FDD\u7559\uFF09\u3002",
  "toast.send.queued": "\u5DF2\u6392\u961F\uFF1A\u4E0A\u4E00\u6761\u56DE\u590D\u7ED3\u675F\u540E\u81EA\u52A8\u53D1\u9001",
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
  "toast.transfer.fallback": "\u5DF2\u521B\u5EFA\u4F1A\u8BDD\uFF1A\u84B8\u998F\u4E0D\u53EF\u7528\uFF0C\u5199\u5165\u7684\u662F\u539F\u6587\u5B8C\u6574\u8BB0\u5F55\uFF08\u4E0D\u662F\u4EFB\u52A1\u7B80\u62A5\uFF09",
  "toast.transfer.retry": "\u91CD\u8BD5",
  "toast.recover.empty": "\u7F51\u9875\u7AEF\u6CA1\u6709\u672A\u540C\u6B65\u7684\u4F1A\u8BDD",
  "toast.recover.progress": "\u6B63\u5728\u540C\u6B65 {done}/{total}\uFF1A{title}",
  "toast.recover.summary": "\u5DF2\u4ECE\u7F51\u9875\u540C\u6B65 {count}/{total} \u4E2A\u4F1A\u8BDD\uFF0C\u5171 {messages} \u6761\u6D88\u606F",
  "toast.recover.added": "\u65B0\u589E {count} \u6761",
  "toast.recover.completed": "\u8865\u5168 {count} \u6761",
  "toast.recover.replaced": "\u66F4\u65B0 {count} \u6761",
  "toast.recover.kept": "\u672C\u5730\u4FDD\u7559 {count} \u6761",
  "toast.sync.done": "\u5DF2\u540C\u6B65\u300C{title}\u300D",
  "toast.sync.uptodate": "\u300C{title}\u300D\u672C\u5730\u5DF2\u662F\u6700\u65B0",
  "toast.recover.failed": "\u90E8\u5206\u4F1A\u8BDD\u540C\u6B65\u5931\u8D25\uFF1A{list}",
  "toast.open": "\u6253\u5F00",
  "toast.open.failed": "\u4F1A\u8BDD\u5DF2\u521B\u5EFA\uFF0C\u4F46\u672C\u9875\u8FD8\u6CA1\u6536\u5230\u5B83\u2014\u2014\u8BF7\u5728\u5DE6\u4FA7\u4F1A\u8BDD\u5217\u8868\u4E2D\u70B9\u5F00",
  "toast.workspace.created": "\u5DF2\u521B\u5EFA\u5DE5\u4F5C\u533A\u300C{title}\u300D",
  "toast.workspace.failed": "\u521B\u5EFA\u5DE5\u4F5C\u533A\u5931\u8D25\uFF1A{error}",
  "attach.name.unnamed": "\u672A\u547D\u540D\u6587\u4EF6",
  "attach.name.pasted": "\u7C98\u8D34\u7684\u6587\u4EF6",
  "send.newChat": "\u65B0\u5BF9\u8BDD\u521B\u5EFA\u5931\u8D25",
  "send.toggle": "\u5207\u6362\u5F00\u5173\u5931\u8D25",
  "send.openLogin": "\u6253\u5F00\u767B\u5F55\u7A97\u53E3\u5931\u8D25",
  "send.recover": "\u540C\u6B65\u5931\u8D25",
  "send.recoverList": "\u8BFB\u53D6\u7F51\u9875\u7AEF\u4F1A\u8BDD\u5217\u8868\u5931\u8D25",
  "send.unknown": "\u672A\u77E5\u9519\u8BEF",
  "send.join": "\uFF1B",
  "error.NEED_LOGIN": "\u9700\u8981\u5148\u5B8C\u6210 DeepSeek \u7F51\u9875\u767B\u5F55",
  "error.PAGE_CHANGED": "\u7F51\u9875\u7AEF\u9875\u9762\u7ED3\u6784\u7591\u4F3C\u6539\u7248\uFF0C\u8BF7\u5347\u7EA7\u63D2\u4EF6",
  "error.TIMEOUT": "\u751F\u6210\u8D85\u65F6\uFF0C\u53EF\u91CD\u8BD5",
  "error.NETWORK": "\u7F51\u7EDC\u6216\u6D4F\u89C8\u5668\u9519\u8BEF\uFF0C\u8BF7\u68C0\u67E5\u540E\u91CD\u8BD5",
  "error.BUSY": "\u4E0A\u4E00\u6761\u56DE\u590D\u8FD8\u5728\u751F\u6210\uFF0C\u8BF7\u7B49\u5B83\u7ED3\u675F\u6216\u70B9\u300C\u505C\u6B62\u300D\u540E\u518D\u8BD5",
  "error.LOOPBACK": "\u9762\u677F\u6CA1\u6709\u8FDE\u4E0A\u672C\u673A\u63D2\u4EF6\u670D\u52A1\uFF08\u8BF7\u6C42\u4E0D\u662F\u4ECE\u672C\u673A\u53D1\u51FA\u7684\uFF09",
  "error.METHOD": "\u8BF7\u6C42\u65B9\u5F0F\u4E0D\u5BF9\uFF1A\u5C5E\u63D2\u4EF6\u5185\u90E8\u9519\u8BEF\uFF0C\u8BF7\u5237\u65B0\u9762\u677F\u540E\u91CD\u8BD5",
  "error.ORIGIN": "\u8BF7\u6C42\u6765\u6E90\u4E0D\u88AB\u4FE1\u4EFB\uFF0C\u5DF2\u88AB\u62D2\u7EDD\uFF08\u8DE8\u7AD9\u8BF7\u6C42\uFF09",
  "error.CSRF": "\u5B89\u5168\u4EE4\u724C\u5DF2\u5931\u6548\uFF0C\u8BF7\u5237\u65B0\u9762\u677F\u540E\u91CD\u8BD5",
  "error.PATH": "\u8FD9\u4E2A\u8DEF\u5F84\u4E0D\u5728\u63D2\u4EF6\u5141\u8BB8\u7684\u76EE\u5F55\u5185\uFF08\u9644\u4EF6\u76EE\u5F55\u6216\u914D\u7F6E\u7684\u5BFC\u51FA\u76EE\u5F55\uFF09",
  "error.BAD_REQUEST": "\u8BF7\u6C42\u7F3A\u5C11\u5FC5\u8981\u5B57\u6BB5\u6216\u683C\u5F0F\u4E0D\u5BF9",
  "error.TOO_LARGE": "\u6570\u636E\u592A\u5927\uFF0C\u8D85\u51FA\u4E0A\u9650",
  "error.NOT_FOUND": "\u627E\u4E0D\u5230\u5BF9\u5E94\u7684\u8BB0\u5F55\uFF08\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\uFF09",
  "error.INTERNAL": "\u63D2\u4EF6\u5185\u90E8\u9519\u8BEF\uFF0C\u8BE6\u60C5\u89C1\u300C\u8FD0\u884C\u72B6\u6001\u300D\u91CC\u7684\u8BCA\u65AD"
};
var en = {
  "nav.label": "Chat",
  "panel.title": "Chat",
  "panel.crashed": "The panel failed to render. The rest of the page is unaffected; reloading recovers it. If it keeps happening, please report the details below.",
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
  "settings.build": "Build",
  "settings.version": "Version",
  "settings.built": "Built at",
  "settings.unknown": "unknown",
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
  "settings.announce": "Note these tools in the system prompt",
  "settings.actions": "Actions",
  "settings.where": "These values come from the profile's cordis.patch.yml: add a config: block under the dsh-dschat row, then restart Harness. This build ships no settings form of its own. The browser profile defaults to the dsh-webchat one, so switching plugins needs no second sign-in.",
  "settings.loading": "Reading runtime settings\u2026",
  "settings.auto": "auto",
  "settings.direct": "direct",
  "status.title": "Runtime status",
  "status.description": "Live state of the DeepSeek web engine plus the resolved runtime settings (read-only).",
  "status.where": "These values come from the profile's cordis.patch.yml: add a config: block under the dsh-dschat row, then restart Harness. This build ships no settings form of its own. The browser profile defaults to the dsh-webchat one, so switching plugins needs no second sign-in.",
  "status.diag.copy": "Copy diagnostics",
  "status.diag.copied": "Copied \u2014 paste it into the issue as it is",
  "status.diag.failed": "Copy failed (clipboard unavailable): the diagnostics were logged to the console instead",
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
  "action.sessions": "Chats",
  "action.recover": "Sync from web",
  "action.recover.hint": "Sync web conversations into the local store: new ones are pulled in, existing ones only gain what they were missing (local message ids, timestamps and thinking time are kept)",
  "action.stop": "Stop",
  "action.send": "Send",
  "action.startTransfer": "Start transfer",
  "action.exportFile": "Export markdown",
  "brand.title": "DeepSeek Chat",
  "lamp.green": "Running normally",
  "lamp.red": "Failed",
  "lamp.grey": "Not started",
  "lamp.amber": "Starting or signed out",
  "composer.actions": "Conversation and transfer actions",
  "more.hint": "More: runtime status / export markdown / login window / close browser",
  "attach.show": "View attachment",
  "attach.remove": "Remove attachment",
  "attach.remove.hint": "Remove attachment {name}",
  "transfer.short": "Migrate to DSH",
  "transfer.short.hint": "Continue in Harness: distill this web conversation into a brief, or migrate it verbatim into a harness session",
  "rail.search": "Search conversations\u2026",
  "rail.search.hint": "Search conversation text (\u2318K)",
  "rail.search.clear": "Clear search",
  "rail.show": "Open the conversation list",
  "rail.hide": "Close the conversation list",
  "rail.empty": "No conversations yet \u2014 start one with the New chat button above the input",
  "rail.noMatch": "No matching conversation",
  "rail.clear": "Clear all",
  "rail.clearConfirm": "Clear all?",
  "qnav.label": "Question navigator",
  "qnav.title": "Questions \xB7 {count}",
  "qnav.item": "Question {index}: {text}",
  "qnav.attachment": "(attachment)",
  "qnav.latest": "\u2193 Latest",
  "qnav.latest.hint": "Jump to the newest message",
  "item.rename": "Rename",
  "item.rename.placeholder": "Conversation title",
  "item.delete": "Delete (undoable)",
  "item.sync": "Sync this one from the web (adds only what is missing)",
  "item.rename.ok": "Confirm rename",
  "item.rename.cancel": "Cancel",
  "chats.count": "{count} messages",
  "time.justNow": "just now",
  "time.minutes": "{count}m ago",
  "time.hours": "{count}h ago",
  "time.days": "{count}d ago",
  "settings.yes": "yes",
  "settings.no": "no",
  "engine.notice.title": "The web engine is not ready",
  "engine.notice.error.title": "The web engine reported an error",
  "engine.notice.offline.title": "The web page is not running",
  "engine.notice.offline.body": "Sending a message starts chat.deepseek.com in the background first, reusing the signed-in browser profile. It usually takes a few seconds.",
  "engine.notice.login.title": "Not signed in to DeepSeek web",
  "engine.notice.login.body": "The sign-in window reuses the saved browser profile, so this is needed only once.",
  "engine.notice.retry": "Retry starting the web engine",
  "engine.notice.retrying": "Starting\u2026",
  "engine.notice.unreachable": "The local engine did not answer the start request (/wake), so the message was not sent. Check your connection and retry.",
  "engine.notice.staleHost": "The host half is an older build (/wake answered 404); the login window was opened instead. Restart Harness and automatic start will work.",
  "engine.notice.needLogin": "DeepSeek web needs a sign-in: finish it in the browser window that just opened \u2014 this notice disappears on its own once you are in.",
  "engine.notice.queued": "Queued messages cannot go out while the web engine is down. They stay in the queue and leave automatically once it starts.",
  "empty.title": "Chat with DeepSeek, right here",
  "empty.body": "Your web sign-in, not API billing. Distill the chat into a task brief when you are done.",
  "empty.try": "Or try",
  "empty.try.translate": "Translate this English into natural Chinese",
  "empty.try.summarize": "Summarize what this document is about",
  "empty.try.polish": "Polish this passage of text",
  "thread.loading": "Loading this conversation\u2026",
  "composer.placeholder": "Message DeepSeek \u2014 Enter to send",
  "composer.notLoggedIn": "Sends once you sign in \xB7 typing now is fine",
  "composer.offline": "Just type \u2014 it opens in the background",
  "composer.connecting": "Opening \xB7 type ahead",
  "composer.attach.drop": "Drop to attach",
  "composer.queue.note": "The previous reply is still generating; these go out one by one when it ends",
  "composer.queue.files": "{count} file(s)",
  "composer.queue.cancel": "Remove this queued message",
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
  "msg.think.collapse": "Click to collapse the reasoning",
  "msg.details": "details",
  "msg.code.language": "text",
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
  "transfer.preview": "First message preview (editable)",
  "transfer.preview.distilled": "Distilled into a task brief \u2014 this is exactly what will be written",
  "transfer.preview.raw": "Distillation was unavailable, so this is the raw conversation \u2014 exactly what will be written",
  "transfer.preview.chars": "{count} characters",
  "transfer.preview.edited": "\xB7 edited",
  "transfer.preview.building": "Building preview\u2026",
  "transfer.preview.rebuild": "Rebuild preview",
  "transfer.preview.note": "The session is created only after you confirm",
  "transfer.confirm": "Write it",
  "toast.copied": "Copied",
  "toast.send.failed": "Could not send: {error}",
  "toast.wake.failed": "Could not start the web engine: {error}",
  "toast.send.needLogin": "Not signed in to DeepSeek web yet: finish signing in in the window that just opened and the message can go out (your text is kept).",
  "toast.send.queued": "Queued: it goes out as soon as the current reply finishes",
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
  "toast.transfer.fallback": "Session created, but distillation was unavailable: the raw conversation was written instead of a brief",
  "toast.transfer.retry": "Retry",
  "toast.recover.empty": "No unsynced web conversations",
  "toast.recover.progress": "Syncing {done}/{total}: {title}",
  "toast.recover.summary": "Synced {count}/{total} conversations ({messages} messages)",
  "toast.recover.added": "{count} new",
  "toast.recover.completed": "{count} completed",
  "toast.recover.replaced": "{count} updated",
  "toast.recover.kept": "{count} kept locally",
  "toast.sync.done": "Synced \u201C{title}\u201D",
  "toast.sync.uptodate": "\u201C{title}\u201D is already up to date",
  "toast.recover.failed": "Some conversations could not be synced: {list}",
  "toast.open": "Open",
  "toast.open.failed": "The session was created, but this page has not received it yet \u2014 open it from the session list",
  "toast.workspace.created": 'Workspace "{title}" created',
  "toast.workspace.failed": "Could not create workspace: {error}",
  "attach.name.unnamed": "unnamed file",
  "attach.name.pasted": "pasted file",
  "send.newChat": "Could not start a new chat",
  "send.toggle": "Could not flip that switch",
  "send.openLogin": "Could not open the login window",
  "send.recover": "Sync failed",
  "send.recoverList": "Could not read the web conversation list",
  "send.unknown": "unknown error",
  "send.join": "; ",
  "error.NEED_LOGIN": "Sign in to DeepSeek web first",
  "error.PAGE_CHANGED": "The web page structure changed \u2014 upgrade this plugin",
  "error.TIMEOUT": "Generation timed out \u2014 try again",
  "error.NETWORK": "Network or browser error \u2014 check and retry",
  "error.BUSY": "The previous reply is still generating \u2014 wait for it or press Stop",
  "error.LOOPBACK": "The panel could not reach the local plugin service: the request did not come from this machine",
  "error.METHOD": "Wrong request method \u2014 an internal plugin error; reload the panel and retry",
  "error.ORIGIN": "The request came from an untrusted origin and was refused",
  "error.CSRF": "The security token expired \u2014 reload the panel and retry",
  "error.PATH": "That path is outside the directories this plugin may write to",
  "error.BAD_REQUEST": "The request was missing a required field or was malformed",
  "error.TOO_LARGE": "The data was larger than the allowed limit",
  "error.NOT_FOUND": "No such record \u2014 it may have been deleted",
  "error.INTERNAL": "Internal plugin error \u2014 open the diagnostics in the status card for the detail"
};

// src/client/panel/slot.tsx
var import_react5 = require("react");

// src/client/panel/DSchatPanel.tsx
var import_react4 = require("react");

// src/client/status.ts
var import_react = require("react");
var UNKNOWN = { phase: "stopped", detail: "", loggedIn: null, canOpenLogin: false };
var current = UNKNOWN;
var listeners = /* @__PURE__ */ new Set();
var translate;
function statusDetail(phase, engineError) {
  const tr = (key, fallback) => translate?.(key) ?? fallback;
  const separator = translate?.("send.join") ?? "; ";
  switch (phase) {
    case "launching":
      return tr("status.launching", "Starting browser");
    case "need-login":
      return tr("status.needLogin", "Not signed in");
    case "error": {
      const head = tr("status.error", "Engine error");
      return engineError === void 0 ? head : `${head}${separator}${engineError}`;
    }
    case "thinking":
      return tr("status.thinking", "Thinking");
    case "streaming":
      return tr("status.streaming", "Streaming");
    case "ready":
      return tr("status.ready", "Ready");
    default:
      return tr("status.stopped", "Not started");
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
function surfaceCopy(copy) {
  const given = typeof copy === "string" ? { copy } : copy ?? {};
  return {
    copy: given.copy ?? "copy",
    collapseHint: given.collapseHint ?? "Click to collapse the reasoning",
    details: given.details ?? "details",
    language: given.language ?? "text"
  };
}
function codeBlock(language, body, key, options, copy) {
  return (0, import_react2.createElement)(
    "div",
    { key, className: "dsh-dschat-code" },
    (0, import_react2.createElement)(
      "div",
      { className: "dsh-dschat-code-bar" },
      (0, import_react2.createElement)("span", null, language === "" ? copy.language : language),
      (0, import_react2.createElement)("span", { className: "dsh-dschat-spacer" }),
      (0, import_react2.createElement)(
        "button",
        {
          type: "button",
          className: "dsh-dschat-code-copy",
          title: copy.copy,
          onClick: () => {
            options.onCopyCode?.(body);
          }
        },
        copy.copy
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
function renderMarkdown(source, options = {}, copy) {
  const surface = surfaceCopy(copy);
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
      push(codeBlock(language, body.join("\n"), `code${blockIndex}`, options, surface));
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
      push((0, import_react2.createElement)("blockquote", { key: `q${blockIndex}` }, ...renderMarkdown(quote.join("\n"), options, surface)));
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
          label: summary ?? surface.details,
          options,
          copy: surface
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
function collapseFromBodyClick(target) {
  if (target instanceof Element && target.closest("a, button") !== null) return false;
  if (typeof window === "undefined") return true;
  const selection = window.getSelection();
  if (selection !== null && selection.isCollapsed === false && selection.toString() !== "") return false;
  return true;
}
function Thinking({ source, label, options = {}, copy, thinkingMs, streaming, liveLabel, defaultOpen = false }) {
  const surface = surfaceCopy(copy);
  const live = thinkingIsLive(thinkingMs, streaming);
  const [open, setOpen] = (0, import_react2.useState)(defaultOpen);
  const bodyRef = (0, import_react2.useRef)(null);
  const openedWhileLive = (0, import_react2.useRef)(false);
  (0, import_react2.useEffect)(() => {
    if (live) return;
    if (!openedWhileLive.current) return;
    openedWhileLive.current = false;
    setOpen(false);
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
        title: surface.collapseHint,
        "aria-expanded": true,
        onClick: (event) => {
          if (collapseFromBodyClick(event.target)) setOpen(false);
        },
        // The event is declared as the minimum this handler reads: React
        // passes a full KeyboardEvent (so `preventDefault` is present and
        // the call is real — it stops Space from scrolling the panel), but
        // the handler is written against these fields so it also works when
        // the attribute is replayed over a hand-built event.
        onKeyDown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          if (collapseFromBodyClick(event.target) === false) return;
          event.preventDefault?.();
          setOpen(false);
        }
      },
      ...renderMarkdown(source, options, copy)
    ) : (0, import_react2.createElement)(
      "button",
      {
        type: "button",
        className: "dsh-dschat-think-head",
        "aria-expanded": false,
        onClick: () => {
          if (live) openedWhileLive.current = true;
          setOpen(true);
        }
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
function Markdown({ source, onCopyCode, onOpenLink, sources, sourcesLabel, copy }) {
  const options = {};
  if (onCopyCode !== void 0) options.onCopyCode = onCopyCode;
  if (onOpenLink !== void 0) options.onOpenLink = onOpenLink;
  const table = sourcesOf(sources);
  if (table !== void 0) options.sources = table;
  return (0, import_react2.createElement)(
    "div",
    null,
    ...renderMarkdown(source, options, copy),
    table === void 0 || sourcesLabel === void 0 ? null : (0, import_react2.createElement)(SourceList, { sources: table, heading: sourcesLabel, options })
  );
}

// src/client/panel/DSchatStatus.tsx
var import_react3 = require("react");
function DSchatStatus(props) {
  const { api, tt, t } = props;
  const tr = (0, import_react3.useCallback)((key) => (t ?? tt)(key), [t, tt]);
  const [state, setState] = (0, import_react3.useState)(null);
  const [settings, setSettings] = (0, import_react3.useState)(null);
  const [failed, setFailed] = (0, import_react3.useState)(void 0);
  const [diag, setDiag] = (0, import_react3.useState)("idle");
  const refresh = (0, import_react3.useCallback)(async () => {
    try {
      const [snapshot2, context] = await Promise.all([api.state(), api.context()]);
      if (snapshot2.ok === true) setState(snapshot2);
      if (context.ok === true && context.settings !== void 0) setSettings(context.settings);
      setFailed(void 0);
    } catch (error) {
      setFailed(String(error));
    }
  }, [api]);
  (0, import_react3.useEffect)(() => {
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
  const openLogin = (0, import_react3.useCallback)(() => {
    void api.openLogin().catch(() => void 0);
  }, [api]);
  const closeBrowser = (0, import_react3.useCallback)(() => {
    void api.closeBrowser().catch(() => void 0);
  }, [api]);
  const phase = state === null ? "stopped" : phaseOf({ engine: state.engine, loggedIn: state.loggedIn, busy: state.busy, chats: state.chats });
  const loggedIn = state?.loggedIn ?? null;
  const diagnosticText = (0, import_react3.useCallback)(async () => {
    const probe = await api.probePage().catch((error) => ({ ok: false, error: String(error) }));
    return buildDiagnosticReport({
      version: state?.version,
      build: state?.build,
      phase,
      engine: state?.engine,
      engineError: state?.engineError,
      loggedIn: state?.loggedIn ?? null,
      busy: state?.busy,
      deepThink: state?.deepThink,
      search: state?.search,
      pageUrl: state?.pageUrl,
      lastError: state?.lastError,
      lastErrorCode: state?.lastErrorCode,
      storeWarning: state?.storeWarning,
      chats: state?.chats.length ?? 0,
      settings,
      probe,
      userAgent: typeof navigator === "undefined" ? void 0 : navigator.userAgent
    });
  }, [api, state, settings, phase]);
  const copyDiagnostics = (0, import_react3.useCallback)(() => {
    void (async () => {
      const text = await diagnosticText();
      try {
        await navigator.clipboard.writeText(text);
        setDiag("copied");
      } catch {
        console.log(text);
        setDiag("failed");
      }
      window.setTimeout(() => {
        setDiag("idle");
      }, 4e3);
    })();
  }, [diagnosticText]);
  const statusText = (() => {
    switch (phase) {
      case "launching":
        return tr("status.launching");
      case "need-login":
        return tr("status.needLogin");
      case "error":
        return `${tr("status.error")}${state?.engineError !== void 0 ? `${tr("send.join")}${state.engineError}` : ""}`;
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
  const row = (label, value, mono = false) => (0, import_react3.createElement)(
    "div",
    { className: "dsh-dschat-setrow", key: label },
    (0, import_react3.createElement)("span", { className: "dsh-dschat-setlabel" }, label),
    (0, import_react3.createElement)("span", {
      className: mono ? "dsh-dschat-setvalue dsh-dschat-mono" : "dsh-dschat-setvalue",
      title: typeof value === "string" ? value : void 0
    }, value)
  );
  const yesNo = (value) => value === true ? (0, import_react3.createElement)("span", { className: "dsh-dschat-on" }, (0, import_react3.createElement)(CheckIcon, {}), tr("settings.yes")) : (0, import_react3.createElement)("span", { className: "dsh-dschat-off" }, (0, import_react3.createElement)(CloseIcon, { size: 10 }), tr("settings.no"));
  return (0, import_react3.createElement)(
    "div",
    { className: "dsh-dschat dsh-dschat-status" },
    (0, import_react3.createElement)(
      "header",
      { className: "dsh-dschat-sethead" },
      (0, import_react3.createElement)("h1", null, tr("status.title")),
      (0, import_react3.createElement)("p", null, tr("status.description"))
    ),
    (0, import_react3.createElement)(
      "section",
      { className: "dsh-dschat-setcard" },
      (0, import_react3.createElement)("h2", null, tr("settings.status")),
      row(tr("settings.phase"), statusText),
      row(
        tr("settings.login"),
        loggedIn === true ? tr("settings.login.yes") : loggedIn === false ? tr("settings.login.no") : tr("settings.login.unknown")
      ),
      row(tr("settings.page"), state?.pageUrl ?? "\u2014", true),
      state?.lastError !== void 0 ? row(tr("settings.lastError"), state.lastError) : null
    ),
    (0, import_react3.createElement)(
      "section",
      { className: "dsh-dschat-setcard" },
      (0, import_react3.createElement)("h2", null, tr("settings.build")),
      row(
        tr("settings.version"),
        state?.version === void 0 || state.version === "" ? tr("settings.unknown") : state.version,
        true
      ),
      row(tr("settings.built"), state?.build === void 0 || state.build === "" ? tr("settings.unknown") : state.build, true)
    ),
    (0, import_react3.createElement)(
      "section",
      { className: "dsh-dschat-setcard" },
      (0, import_react3.createElement)("h2", null, tr("settings.runtime")),
      settings === null ? (0, import_react3.createElement)("p", { className: "dsh-dschat-hintline" }, failed ?? tr("settings.loading")) : (0, import_react3.createElement)(
        "div",
        null,
        row(tr("settings.channel"), settings.browserChannel === "" ? tr("settings.auto") : settings.browserChannel),
        row(tr("settings.headless"), yesNo(settings.browserHeadless)),
        row(tr("settings.proxy"), settings.browserProxy === "" ? tr("settings.direct") : settings.browserProxy),
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
    (0, import_react3.createElement)(
      "section",
      { className: "dsh-dschat-setcard" },
      (0, import_react3.createElement)("h2", null, tr("settings.actions")),
      (0, import_react3.createElement)(
        "div",
        { className: "dsh-dschat-setactions" },
        (0, import_react3.createElement)("button", {
          type: "button",
          className: "dsh-dschat-btn dsh-dschat-btn-primary",
          onClick: openLogin
        }, tr("action.openLogin")),
        (0, import_react3.createElement)("button", {
          type: "button",
          className: "dsh-dschat-btn dsh-dschat-btn-ghost",
          disabled: (state?.engine ?? "stopped") === "stopped",
          onClick: closeBrowser
        }, tr("action.closeBrowser")),
        /*
         * 「复制诊断」 — the reader's one-click answer to "what do I send you?".
         *
         * It includes the live `probe-page` output, which is the difference
         * between a report someone can act on and one that says the page might
         * have changed.
         */
        (0, import_react3.createElement)("button", {
          type: "button",
          className: "dsh-dschat-btn dsh-dschat-btn-ghost",
          onClick: copyDiagnostics
        }, tr("status.diag.copy"))
      ),
      (0, import_react3.createElement)(
        "p",
        { className: "dsh-dschat-sethint" },
        diag === "copied" ? tr("status.diag.copied") : diag === "failed" ? tr("status.diag.failed") : tr("status.where")
      )
    )
  );
}
function buildDiagnosticReport(input) {
  const dash = (value) => value === void 0 || value === "" ? "-" : value;
  return [
    `dsh-DSchat ${dash(input.version)}`,
    `build: ${dash(input.build)}`,
    `phase: ${input.phase}${input.engineError === void 0 ? "" : ` \u2014 ${input.engineError}`}`,
    `engine: ${dash(input.engine)} | loggedIn: ${String(input.loggedIn)} | busy: ${String(input.busy ?? false)}`,
    `deepThink: ${String(input.deepThink ?? false)} | search: ${String(input.search ?? false)}`,
    `pageUrl: ${dash(input.pageUrl)}`,
    `lastError: ${dash(input.lastError)}${input.lastErrorCode === void 0 ? "" : ` [${input.lastErrorCode}]`}`,
    `storeWarning: ${dash(input.storeWarning)}`,
    `chats: ${String(input.chats)}`,
    `host: ${dash(input.userAgent)}`,
    input.settings === null ? "settings: (not loaded)" : [
      `dataDir: ${input.settings.dataDir}`,
      `profileDir: ${input.settings.profileDir}`,
      `exportDir: ${input.settings.exportDir}`,
      `channel: ${input.settings.browserChannel} | headless: ${String(input.settings.browserHeadless)} | proxy: ${input.settings.browserProxy}`,
      `replyTimeoutMs: ${String(input.settings.replyTimeoutMs)} | distill: ${String(input.settings.transferDistill)} (${input.settings.transferProvider || "auto"}/${input.settings.transferModel || "auto"})`,
      `announceToAgent: ${String(input.settings.announceToAgent)}`
    ].join("\n"),
    `probe: ${JSON.stringify(input.probe)}`
  ].join("\n");
}

// src/client/panel/reply.ts
var replyBody = answerBody;
function firstLine(content) {
  return replyBody(content).split("\n")[0]?.trim() ?? "";
}

// src/client/panel/DSchatPanel.tsx
function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}
function explain(result, fallback, tr) {
  switch (result?.code) {
    case "NEED_LOGIN":
      return tr("error.NEED_LOGIN");
    case "PAGE_CHANGED":
      return tr("error.PAGE_CHANGED");
    case "TIMEOUT":
      return tr("error.TIMEOUT");
    case "NETWORK":
      return tr("error.NETWORK");
    case "BUSY":
      return tr("error.BUSY");
    case "LOOPBACK":
      return tr("error.LOOPBACK");
    case "METHOD":
      return tr("error.METHOD");
    case "ORIGIN":
      return tr("error.ORIGIN");
    case "CSRF":
      return tr("error.CSRF");
    case "PATH":
      return tr("error.PATH");
    case "BAD_REQUEST":
      return tr("error.BAD_REQUEST");
    case "TOO_LARGE":
      return tr("error.TOO_LARGE");
    case "NOT_FOUND":
      return tr("error.NOT_FOUND");
    case "INTERNAL":
      return tr("error.INTERNAL");
    default: {
      const detail = result?.error;
      return detail !== void 0 && detail !== "" ? detail : fallback;
    }
  }
}
function isAttachableFile(file) {
  return file.size > 0;
}
var MAX_ATTACH_BYTES = 24 * 1024 * 1024;
var MAX_ATTACH_COUNT = 10;
var MAX_ATTACH_LABEL = "24 MB";
var IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|avif)$/i;
function displayNameOf(path) {
  const file = path.split("/").pop() ?? path;
  const at = file.indexOf("__");
  return at === -1 ? file : file.slice(at + 2);
}
function attachmentKind(path) {
  return IMAGE_EXTENSION.test(path) ? "image" : "file";
}
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
var SEARCH_DEBOUNCE_MS = 180;
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
var RAIL_OPEN_STORE = "dsh-dschat.rail.open";
function readStored(key, fallback) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function initialListOpen() {
  try {
    const forced = new URLSearchParams(window.location.search).get("dschat-list");
    if (forced === "open") return true;
    if (forced === "closed") return false;
  } catch {
  }
  return readStored(RAIL_OPEN_STORE, "1") !== "0";
}
function writeStored(key, value) {
  try {
    if (value === void 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
  }
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
var ANCHOR_TOP_GAP = 12;
var ANCHOR_DRIFT_PX = 32;
var JUMP_SETTLE_MS = 900;
var WAKE_RETRY_COOLDOWN_MS = 1e4;
var WAKE_FRESH_MS = 2e3;
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
  const tr = (0, import_react4.useCallback)(
    (key, values) => {
      const template = (t ?? tt)(key);
      return values === void 0 ? template : fmt(template, values);
    },
    [t, tt]
  );
  const [state, setState] = (0, import_react4.useState)(null);
  const [viewChatId, setViewChatId] = (0, import_react4.useState)(void 0);
  const [draft, setDraft] = (0, import_react4.useState)("");
  const [images, setImages] = (0, import_react4.useState)([]);
  const [attachBusy, setAttachBusy] = (0, import_react4.useState)(false);
  const [waking, setWaking] = (0, import_react4.useState)(false);
  const [launchError, setLaunchError] = (0, import_react4.useState)(void 0);
  const [outbox, setOutbox] = (0, import_react4.useState)([]);
  const [statusOpen, setStatusOpen] = (0, import_react4.useState)(false);
  const [dragging, setDragging] = (0, import_react4.useState)(false);
  const [railOpen, setRailOpen] = (0, import_react4.useState)(initialListOpen);
  const [toasts, setToasts] = (0, import_react4.useState)([]);
  const [renamingId, setRenamingId] = (0, import_react4.useState)(void 0);
  const [renameDraft, setRenameDraft] = (0, import_react4.useState)("");
  const [clearArmed, setClearArmed] = (0, import_react4.useState)(false);
  const [query, setQuery] = (0, import_react4.useState)("");
  const [searchFocus, setSearchFocus] = (0, import_react4.useState)(false);
  const [jumpId, setJumpId] = (0, import_react4.useState)(void 0);
  const [flashId, setFlashId] = (0, import_react4.useState)(void 0);
  const [atBottom, setAtBottom] = (0, import_react4.useState)(true);
  const [threadScrolls, setThreadScrolls] = (0, import_react4.useState)(false);
  const [navIndex, setNavIndex] = (0, import_react4.useState)(0);
  const [navOpen, setNavOpen] = (0, import_react4.useState)(false);
  const [syncId, setSyncId] = (0, import_react4.useState)(void 0);
  const [deepThink, setDeepThink] = (0, import_react4.useState)(false);
  const [search, setSearch] = (0, import_react4.useState)(false);
  const [now, setNow] = (0, import_react4.useState)(() => Date.now());
  const [transferOpen, setTransferOpen] = (0, import_react4.useState)(false);
  const [lampOpen, setLampOpen] = (0, import_react4.useState)(false);
  const [moreOpen, setMoreOpen] = (0, import_react4.useState)(false);
  const [transferMode, setTransferMode] = (0, import_react4.useState)("distill");
  const [transferTarget, setTransferTarget] = (0, import_react4.useState)("new");
  const [targetWorkspaceId, setTargetWorkspaceId] = (0, import_react4.useState)(void 0);
  const [targetSessionId, setTargetSessionId] = (0, import_react4.useState)(void 0);
  const [stage, setStage] = (0, import_react4.useState)(0);
  const [transferring, setTransferring] = (0, import_react4.useState)(false);
  const [preview, setPreview] = (0, import_react4.useState)(void 0);
  const [previewDraft, setPreviewDraft] = (0, import_react4.useState)("");
  const [previewing, setPreviewing] = (0, import_react4.useState)(false);
  const [workspaces, setWorkspaces] = (0, import_react4.useState)([]);
  const [cwd, setCwd] = (0, import_react4.useState)(void 0);
  const listRef = (0, import_react4.useRef)(null);
  const inputRef = (0, import_react4.useRef)(null);
  const uploadRef = (0, import_react4.useRef)(null);
  const searchRef = (0, import_react4.useRef)(null);
  const transferPopRef = (0, import_react4.useRef)(null);
  const lampPopRef = (0, import_react4.useRef)(null);
  const morePopRef = (0, import_react4.useRef)(null);
  const pinnedRef = (0, import_react4.useRef)(true);
  const anchorIdRef = (0, import_react4.useRef)(void 0);
  const anchorAppliedTopRef = (0, import_react4.useRef)(void 0);
  const pendingAnchorRef = (0, import_react4.useRef)(void 0);
  const anchorFloorRef = (0, import_react4.useRef)(0);
  const jumpUntilRef = (0, import_react4.useRef)(0);
  const jumpTargetRef = (0, import_react4.useRef)(void 0);
  const prevChatRef = (0, import_react4.useRef)(void 0);
  const toastSeq = (0, import_react4.useRef)(0);
  const deletedRef = (0, import_react4.useRef)(/* @__PURE__ */ new Map());
  const imagesRef = (0, import_react4.useRef)([]);
  (0, import_react4.useEffect)(() => {
    imagesRef.current = images;
  }, [images]);
  const outboxRef = (0, import_react4.useRef)([]);
  (0, import_react4.useEffect)(() => {
    outboxRef.current = outbox;
  }, [outbox]);
  const queueSeq = (0, import_react4.useRef)(0);
  const flushingRef = (0, import_react4.useRef)(false);
  const wakeFailedAtRef = (0, import_react4.useRef)(0);
  const loggedInRef = (0, import_react4.useRef)(null);
  (0, import_react4.useEffect)(() => {
    loggedInRef.current = state?.loggedIn ?? null;
  }, [state?.loggedIn]);
  const stateRef = (0, import_react4.useRef)(null);
  const tailChatRef = (0, import_react4.useRef)(void 0);
  const tailUntilRef = (0, import_react4.useRef)(0);
  const turnSeenRef = (0, import_react4.useRef)(false);
  const lastReconcileRef = (0, import_react4.useRef)(0);
  const toast = (0, import_react4.useCallback)((text, options) => {
    const id = ++toastSeq.current;
    const ttl = options?.ttl ?? (options?.action === void 0 ? 3200 : 6500);
    setToasts((list) => [...list, { id, text, error: options?.error, action: options?.action, ttl }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), ttl);
  }, []);
  (0, import_react4.useEffect)(() => {
    stateRef.current = state;
  }, [state]);
  const storeWarningShownRef = (0, import_react4.useRef)(false);
  (0, import_react4.useEffect)(() => {
    const warning = state?.storeWarning;
    if (warning === void 0 || storeWarningShownRef.current) return;
    storeWarningShownRef.current = true;
    toast(warning, { error: true, ttl: 15e3 });
  }, [state?.storeWarning, toast]);
  const bodiesRef = (0, import_react4.useRef)(/* @__PURE__ */ new Map());
  const viewChatIdRef = (0, import_react4.useRef)(void 0);
  (0, import_react4.useEffect)(() => {
    viewChatIdRef.current = viewChatId;
  }, [viewChatId]);
  const refreshState = (0, import_react4.useCallback)(async () => {
    try {
      const snapshot2 = await api.state();
      if (snapshot2.ok !== true) return;
      const next = snapshot2;
      const current2 = viewChatIdRef.current;
      const viewId = current2 !== void 0 && next.chats.some((chat) => chat.id === current2) ? current2 : next.activeChatId ?? next.chats[0]?.id;
      const pending = [];
      const held = stateRef.current;
      const bodies = bodiesRef.current;
      for (const chat of next.chats) {
        const previous = held?.chats.find((candidate) => candidate.id === chat.id);
        const live = previous?.loaded === true ? previous.messages : void 0;
        const cached = bodies.get(chat.id);
        const body = live ?? (cached !== void 0 && cached.count === chat.messageCount ? cached.messages : void 0);
        if (body !== void 0 && body.length !== chat.messageCount) pending.push(chat.id);
        else if (body === void 0 && chat.id === viewId && chat.messageCount > 0) pending.push(chat.id);
      }
      setState((previousView) => ({
        ...next,
        chats: next.chats.map((chat) => {
          const previous = previousView?.chats.find((candidate) => candidate.id === chat.id);
          const live = previous?.loaded === true ? previous.messages : void 0;
          const cached = bodies.get(chat.id);
          const body = live ?? (cached !== void 0 && cached.count === chat.messageCount ? cached.messages : void 0);
          if (body !== void 0) return { ...chat, messages: body, loaded: true };
          if (previous !== void 0 && previous.messages.length > 0) {
            return { ...chat, messages: previous.messages, loaded: false };
          }
          return { ...chat, messages: [] };
        })
      }));
      for (const id of pending) void ensureBody(id, true);
      setViewChatId(viewId);
    } catch {
    }
  }, [api]);
  const bodyRequests = (0, import_react4.useRef)(/* @__PURE__ */ new Map());
  const ensureBody = (0, import_react4.useCallback)(async (chatId, force = false) => {
    if (chatId === void 0) return;
    const current2 = stateRef.current?.chats.find((chat) => chat.id === chatId);
    if (!force && current2?.loaded === true) return;
    if (bodyRequests.current.has(chatId)) return bodyRequests.current.get(chatId);
    const request2 = (async () => {
      try {
        const answer = await api.chat(chatId);
        if (answer.ok !== true || answer.chat === void 0) return;
        const messages = answer.chat.messages;
        bodiesRef.current.set(chatId, { messages, count: messages.length });
        setState((previous) => previous === null ? previous : {
          ...previous,
          chats: previous.chats.map((chat) => chat.id === chatId ? { ...chat, messages, messageCount: messages.length, loaded: true } : chat)
        });
      } catch {
      } finally {
        bodyRequests.current.delete(chatId);
      }
    })();
    bodyRequests.current.set(chatId, request2);
    return request2;
  }, [api]);
  (0, import_react4.useEffect)(() => {
    void ensureBody(viewChatId);
  }, [viewChatId, ensureBody]);
  (0, import_react4.useEffect)(() => {
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
  (0, import_react4.useEffect)(() => {
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
  (0, import_react4.useEffect)(() => {
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
  (0, import_react4.useEffect)(() => {
    if (state === null) return;
    setDeepThink(state.deepThink);
    setSearch(state.search);
  }, [state?.deepThink, state?.search]);
  const busy = state?.busy ?? false;
  const preparingNewChat = state?.preparingNewChat ?? false;
  (0, import_react4.useEffect)(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [busy]);
  const toggleRail = (0, import_react4.useCallback)(() => {
    setRailOpen((previous) => {
      const next = !previous;
      writeStored(RAIL_OPEN_STORE, next ? "1" : "0");
      if (next) setRenamingId(void 0);
      return next;
    });
  }, []);
  const closeList = (0, import_react4.useCallback)(() => {
    setRailOpen(false);
    writeStored(RAIL_OPEN_STORE, "0");
    setRenamingId(void 0);
  }, []);
  const listWrapRef = (0, import_react4.useRef)(null);
  (0, import_react4.useLayoutEffect)(() => {
    const wrapper = listWrapRef.current;
    const body = wrapper?.closest(".dsh-dschat-body");
    if (!wrapper || !(body instanceof HTMLElement)) return;
    const TRIGGER_GAP = 8;
    const MIN_ROOM = 120;
    const measure = () => {
      const wrapTop = wrapper.getBoundingClientRect().top - body.getBoundingClientRect().top;
      const room = Math.max(MIN_ROOM, Math.round(wrapTop - TRIGGER_GAP));
      wrapper.style.setProperty("--dschat-list-avail", `${room}px`);
      wrapper.style.setProperty("--dschat-list-h", `${room}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => {
      observer.disconnect();
    };
  }, [railOpen]);
  (0, import_react4.useEffect)(() => {
    if (!railOpen) return;
    const onPointerDown = (event) => {
      const target = event.target;
      if (target instanceof Node && listWrapRef.current?.contains(target) === true) return;
      closeList();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [railOpen, closeList]);
  const openSearch = (0, import_react4.useCallback)(() => {
    if (railOpen) {
      setSearchFocus(true);
      return;
    }
    setRailOpen(true);
    writeStored(RAIL_OPEN_STORE, "1");
    setSearchFocus(true);
  }, [railOpen]);
  (0, import_react4.useEffect)(() => {
    if (!searchFocus || !railOpen) return;
    const element = searchRef.current;
    if (element === null) return;
    element.focus();
    element.select();
    setSearchFocus(false);
  }, [searchFocus, railOpen]);
  const COMPOSER_MAX_HEIGHT = 220;
  const resizeComposer = (0, import_react4.useCallback)(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, []);
  (0, import_react4.useEffect)(() => {
    resizeComposer();
  }, [draft, resizeComposer]);
  const chats = state?.chats ?? [];
  const viewChat = chats.find((chat) => chat.id === viewChatId) ?? chats[0];
  const phase = state === null ? "stopped" : phaseOf({ engine: state.engine, loggedIn: state.loggedIn, busy: state.busy, chats: state.chats });
  const loggedIn = state?.loggedIn ?? null;
  (0, import_react4.useEffect)(() => {
    if (state !== null) touchEngineStatus(state);
  }, [state]);
  const engine = useEngineStatus(tr);
  const engineLive = phase === "ready" || phase === "thinking" || phase === "streaming" || phase === "launching";
  const streaming = viewChat?.streaming ?? false;
  const canSend = draft.trim() !== "" || images.length > 0;
  const questions = (0, import_react4.useMemo)(
    () => (viewChat?.messages ?? []).filter((message) => message.role === "user").map((message) => ({
      id: message.id,
      text: message.content.trim() === "" ? tr("qnav.attachment") : message.content
    })),
    [viewChat, tr]
  );
  const [messageHits, setMessageHits] = (0, import_react4.useState)(() => /* @__PURE__ */ new Set());
  (0, import_react4.useEffect)(() => {
    const needle = query.trim();
    if (needle === "") {
      setMessageHits(/* @__PURE__ */ new Set());
      return void 0;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.searchConversations(needle).then((answer) => {
        if (cancelled || answer.ok !== true) return;
        setMessageHits(new Set(answer.ids ?? []));
      }).catch(() => void 0);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, query]);
  const filtered = (0, import_react4.useMemo)(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return chats;
    return chats.filter((chat) => chat.title.toLowerCase().includes(needle) || messageHits.has(chat.id));
  }, [chats, query, messageHits]);
  const harnessList = useSessions === void 0 ? void 0 : useSessions((state2) => state2);
  const continuationTargets = (0, import_react4.useMemo)(() => {
    const byId = harnessList?.byId ?? {};
    return Object.values(byId).filter((row) => row !== void 0 && row.agentAvailable !== true).sort((left, right) => right.updatedAt - left.updatedAt).map((row) => ({ id: row.sessionId, title: row.title ?? row.cwd ?? row.sessionId }));
  }, [harnessList]);
  const continueTargetId = continuationTargets.some((target) => target.id === targetSessionId) ? targetSessionId : continuationTargets[0]?.id;
  (0, import_react4.useEffect)(() => {
    tailChatRef.current = viewChat?.id;
  }, [viewChat?.id]);
  const contentTop = (0, import_react4.useCallback)((list, element) => {
    return element.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  }, []);
  const alignQuestion = (0, import_react4.useCallback)((id, behavior = "auto") => {
    const list = listRef.current;
    if (list === null) return false;
    const target = list.querySelector(`[data-message-id="${id}"]`);
    if (target === null) return false;
    const top = Math.max(0, contentTop(list, target) - ANCHOR_TOP_GAP);
    if (behavior === "smooth") jumpTargetRef.current = top;
    list.scrollTo({ top, behavior });
    if (behavior === "auto") {
      anchorAppliedTopRef.current = Math.min(top, Math.max(0, list.scrollHeight - list.clientHeight));
    }
    return true;
  }, [contentTop]);
  (0, import_react4.useEffect)(() => {
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
    if (switched) {
      anchorIdRef.current = void 0;
      anchorAppliedTopRef.current = void 0;
      pendingAnchorRef.current = void 0;
    }
    const pendingAnchor = pendingAnchorRef.current;
    if (pendingAnchor !== void 0) {
      const users = list.querySelectorAll('[data-role="user"]');
      const last = users[users.length - 1];
      const isNew = last !== void 0 && (pendingAnchor === true || users.length > Math.max(pendingAnchor, anchorFloorRef.current));
      if (isNew) {
        pendingAnchorRef.current = void 0;
        anchorIdRef.current = last.getAttribute("data-message-id") ?? void 0;
        anchorFloorRef.current = users.length;
      }
    }
    if (anchorIdRef.current !== void 0) {
      if (alignQuestion(anchorIdRef.current)) return;
      anchorIdRef.current = void 0;
      anchorAppliedTopRef.current = void 0;
    }
    if (switched || pinnedRef.current && Date.now() >= jumpUntilRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [state, viewChatId, jumpId, launchError, alignQuestion]);
  const onThreadScroll = (0, import_react4.useCallback)(() => {
    const list = listRef.current;
    if (list === null) return;
    const gap = list.scrollHeight - list.scrollTop - list.clientHeight;
    const target = jumpTargetRef.current;
    if (target !== void 0 && Math.abs(list.scrollTop - target) <= 2) {
      jumpTargetRef.current = void 0;
      jumpUntilRef.current = 0;
    }
    const pinned = gap < 96 && Date.now() >= jumpUntilRef.current;
    pinnedRef.current = pinned;
    setAtBottom((current2) => current2 === pinned ? current2 : pinned);
    const scrolls = list.scrollHeight > list.clientHeight + 24;
    setThreadScrolls((current2) => current2 === scrolls ? current2 : scrolls);
    const anchor = anchorIdRef.current;
    if (anchor !== void 0) {
      const applied = anchorAppliedTopRef.current;
      if (list.querySelector(`[data-message-id="${anchor}"]`) === null) {
        anchorIdRef.current = void 0;
        anchorAppliedTopRef.current = void 0;
      } else if (applied !== void 0 && Math.abs(list.scrollTop - applied) > ANCHOR_DRIFT_PX) {
        anchorIdRef.current = void 0;
        anchorAppliedTopRef.current = void 0;
      }
    }
    const rows = list.querySelectorAll('[data-role="user"]');
    if (rows.length > 0) {
      let index = 0;
      for (let i = 0; i < rows.length; i += 1) {
        if (contentTop(list, rows[i]) - list.scrollTop <= 24) index = i;
      }
      setNavIndex((current2) => current2 === index ? current2 : index);
    }
  }, [contentTop]);
  const jumpToLatest = (0, import_react4.useCallback)(() => {
    const list = listRef.current;
    if (list === null) return;
    anchorIdRef.current = void 0;
    anchorAppliedTopRef.current = void 0;
    pinnedRef.current = true;
    jumpUntilRef.current = Date.now() + JUMP_SETTLE_MS;
    jumpTargetRef.current = Math.max(0, list.scrollHeight - list.clientHeight);
    setAtBottom(true);
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, []);
  const jumpToQuestion = (0, import_react4.useCallback)((id) => {
    anchorIdRef.current = void 0;
    anchorAppliedTopRef.current = void 0;
    pinnedRef.current = false;
    jumpUntilRef.current = Date.now() + JUMP_SETTLE_MS;
    setAtBottom(false);
    if (alignQuestion(id, "smooth")) setFlashId(id);
    else setJumpId(id);
  }, [alignQuestion]);
  (0, import_react4.useEffect)(() => {
    const list = listRef.current;
    if (list === null) return;
    const scrolls = list.scrollHeight > list.clientHeight + 24;
    setThreadScrolls((current2) => current2 === scrolls ? current2 : scrolls);
  }, [state, viewChatId]);
  (0, import_react4.useEffect)(() => {
    if (flashId === void 0) return;
    const timer = window.setTimeout(() => setFlashId(void 0), 1800);
    return () => window.clearTimeout(timer);
  }, [flashId]);
  const wakeRef = (0, import_react4.useRef)(null);
  const wakeOkAtRef = (0, import_react4.useRef)(0);
  const ensureReady = (0, import_react4.useCallback)(async (options) => {
    if (wakeRef.current !== null) return await wakeRef.current;
    if (options?.force !== true && Date.now() < wakeFailedAtRef.current) return { ok: false, reason: "cooldown" };
    if (options?.force !== true && Date.now() - wakeOkAtRef.current < WAKE_FRESH_MS) return { ok: true };
    const task = (async () => {
      setWaking(true);
      try {
        const woken = await api.wake().catch(() => void 0);
        if (woken === void 0) {
          const message = tr("engine.notice.unreachable");
          wakeFailedAtRef.current = Date.now() + WAKE_RETRY_COOLDOWN_MS;
          setLaunchError(message);
          return { ok: false, reason: "failed" };
        }
        if (woken.ok !== true) {
          if (/HTTP 404/.test(woken.error ?? "")) {
            await api.openLogin().catch(() => void 0);
            wakeFailedAtRef.current = Date.now() + WAKE_RETRY_COOLDOWN_MS;
            setLaunchError(tr("engine.notice.staleHost"));
            return { ok: false, reason: "failed" };
          }
          wakeFailedAtRef.current = Date.now() + WAKE_RETRY_COOLDOWN_MS;
          setLaunchError(explain(woken, tr("toast.wake.failed"), tr));
          return { ok: false, reason: "failed" };
        }
        if (woken.loggedIn === true) {
          wakeFailedAtRef.current = 0;
          wakeOkAtRef.current = Date.now();
          setLaunchError(void 0);
          return { ok: true };
        }
        if (woken.loginWindow !== true) {
          const opened = await api.openLogin().catch(() => void 0);
          if (opened !== void 0 && opened.ok !== true && opened.error !== void 0) {
            wakeFailedAtRef.current = Date.now() + WAKE_RETRY_COOLDOWN_MS;
            setLaunchError(opened.error);
            return { ok: false, reason: "failed" };
          }
        }
        setLaunchError(tr("engine.notice.needLogin"));
        return { ok: false, reason: "login" };
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
  }, [api, tr, refreshState]);
  const retry = (0, import_react4.useCallback)(async () => {
    const chat = chats.find((item) => item.id === viewChatId) ?? chats[0];
    if (chat === void 0 || busy) return;
    const lastUser = [...chat.messages].reverse().find((message) => message.role === "user");
    if (lastUser === void 0) return;
    pinnedRef.current = true;
    pendingAnchorRef.current = true;
    tailUntilRef.current = Date.now() + TAIL_AFTER_SEND_MS;
    const result = await api.send(lastUser.content, lastUser.attachments).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) {
      pendingAnchorRef.current = void 0;
      toast(explain(result, "", tr), { error: true });
    } else void refreshState();
  }, [chats, viewChatId, busy, api, toast, refreshState]);
  const restoreComposer = (0, import_react4.useCallback)((text, sentImages) => {
    setDraft((current2) => current2 === "" ? text : current2);
    if (sentImages.length > 0) setImages((current2) => current2.length === 0 ? sentImages : current2);
  }, []);
  const enqueue = (0, import_react4.useCallback)((text, queuedImages) => {
    queueSeq.current += 1;
    setOutbox((list) => [...list, { id: `q-${queueSeq.current}`, text, images: queuedImages }]);
    toast(tr("toast.send.queued"));
  }, [toast, tr]);
  const dropQueued = (0, import_react4.useCallback)((id) => {
    setOutbox((list) => list.filter((item) => item.id !== id));
  }, []);
  const deliver = (0, import_react4.useCallback)(async (text, sentImages) => {
    if (loggedInRef.current !== true) {
      const ready = await ensureReady();
      if (ready.ok !== true) return "failed";
    }
    pinnedRef.current = true;
    pendingAnchorRef.current = listRef.current?.querySelectorAll('[data-role="user"]').length ?? 0;
    tailUntilRef.current = Date.now() + TAIL_AFTER_SEND_MS;
    const paths = sentImages.map((item) => item.path);
    let result;
    try {
      result = await api.send(text, paths.length > 0 ? paths : void 0);
    } catch (error) {
      pendingAnchorRef.current = void 0;
      toast(String(error), { error: true });
      return "failed";
    }
    if (result.ok === true) {
      if (result.chatId !== void 0) setViewChatId(result.chatId);
      void refreshState();
      return "sent";
    }
    if (result.code === "BUSY") {
      pendingAnchorRef.current = void 0;
      return "busy";
    }
    if (result.stored === true) {
      toast(explain(result, tr("toast.send.failed"), tr), {
        error: true,
        action: { label: tr("msg.retry"), run: () => {
          void retry();
        } }
      });
      return "stored";
    }
    pendingAnchorRef.current = void 0;
    toast(explain(result, tr("toast.send.failed"), tr), { error: true });
    return "failed";
  }, [api, ensureReady, refreshState, retry, toast, tr]);
  const drainOutbox = (0, import_react4.useCallback)(async () => {
    if (flushingRef.current) return;
    const next = outboxRef.current[0];
    if (next === void 0) return;
    flushingRef.current = true;
    try {
      const outcome = await deliver(next.text, next.images);
      if (outcome === "sent" || outcome === "stored") {
        setOutbox((list) => list.filter((item) => item.id !== next.id));
        return;
      }
      if (outcome === "busy") return;
      setLaunchError((previous) => previous ?? tr("engine.notice.queued"));
    } finally {
      flushingRef.current = false;
    }
  }, [deliver, tr]);
  (0, import_react4.useEffect)(() => {
    if (outbox.length === 0) return;
    if (busy || streaming) return;
    if (launchError !== void 0) return;
    void drainOutbox();
  }, [outbox, busy, streaming, launchError, drainOutbox]);
  (0, import_react4.useEffect)(() => {
    if (launchError === void 0) return;
    if (loggedIn === true && engineLive) {
      wakeFailedAtRef.current = 0;
      setLaunchError(void 0);
    }
  }, [launchError, loggedIn, engineLive]);
  const retryEngine = (0, import_react4.useCallback)(async () => {
    setLaunchError(void 0);
    await ensureReady({ force: true });
  }, [ensureReady]);
  const send = (0, import_react4.useCallback)(async () => {
    const text = draft.trim();
    const sentImages = images;
    if (text === "" && sentImages.length === 0) return;
    setDraft("");
    setImages([]);
    if (busy || streaming) {
      enqueue(text, sentImages);
      return;
    }
    const outcome = await deliver(text, sentImages);
    if (outcome === "busy") enqueue(text, sentImages);
    else if (outcome === "failed") restoreComposer(text, sentImages);
  }, [draft, images, busy, streaming, deliver, enqueue, restoreComposer]);
  const stop = (0, import_react4.useCallback)(async () => {
    await api.stop().catch(() => void 0);
  }, [api]);
  const newChat = (0, import_react4.useCallback)(async () => {
    try {
      const result = await api.newChat();
      if (result.ok === true && result.chatId !== void 0) {
        setViewChatId(result.chatId);
        pinnedRef.current = true;
        void refreshState();
      } else toast(explain(result, tr("send.newChat"), tr), { error: true });
    } catch (error) {
      toast(String(error), { error: true });
    }
  }, [api, toast, refreshState]);
  const toggleDeepThink = (0, import_react4.useCallback)(async () => {
    const next = !deepThink;
    setDeepThink(next);
    const result = await api.setDeepThink(next).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) {
      setDeepThink(!next);
      toast(explain(result, tr("send.toggle"), tr), { error: true });
    }
  }, [deepThink, api, toast]);
  const toggleSearch = (0, import_react4.useCallback)(async () => {
    const next = !search;
    setSearch(next);
    const result = await api.setSearch(next).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) {
      setSearch(!next);
      toast(explain(result, tr("send.toggle"), tr), { error: true });
    }
  }, [search, api, toast]);
  const openLogin = (0, import_react4.useCallback)(async () => {
    const result = await api.openLogin().catch(() => void 0);
    if (result !== void 0 && result.ok !== true) toast(explain(result, tr("send.openLogin"), tr), { error: true });
  }, [api, toast]);
  const copyText = (0, import_react4.useCallback)(async (text, message) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      toast(message);
    }
  }, [toast]);
  const removeChat = (0, import_react4.useCallback)(async (chat) => {
    const index = chats.findIndex((item) => item.id === chat.id);
    const result = await api.deleteChat(chat.id).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) {
      toast(tr("toast.delete.failed", { error: explain(result, "", tr) }), { error: true });
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
              toast(tr("toast.delete.failed", { error: explain(restored, "", tr) }), { error: true });
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
  const clearAll = (0, import_react4.useCallback)(async () => {
    if (!clearArmed) {
      setClearArmed(true);
      window.setTimeout(() => setClearArmed(false), 3e3);
      return;
    }
    setClearArmed(false);
    const result = await api.clearChats().catch(() => void 0);
    if (result !== void 0 && result.ok !== true) toast(tr("toast.clear.failed", { error: explain(result, "", tr) }), { error: true });
    else toast(tr("toast.clear.done"));
  }, [clearArmed, api, toast, tr]);
  const syncDetail = (0, import_react4.useCallback)((counts) => {
    return [
      (counts.added ?? 0) > 0 ? tr("toast.recover.added", { count: String(counts.added) }) : "",
      (counts.completed ?? 0) > 0 ? tr("toast.recover.completed", { count: String(counts.completed) }) : "",
      (counts.replaced ?? 0) > 0 ? tr("toast.recover.replaced", { count: String(counts.replaced) }) : "",
      (counts.kept ?? 0) > 0 ? tr("toast.recover.kept", { count: String(counts.kept) }) : ""
    ].filter((part) => part !== "").join(" \xB7 ");
  }, [tr]);
  const syncChat = (0, import_react4.useCallback)(async (chat) => {
    const sessionId = chat.webSessionId;
    if (sessionId === void 0) return;
    setSyncId(chat.id);
    try {
      const result = await api.recover({ title: chat.title, sessionId }).catch(() => void 0);
      if (result === void 0 || result.ok !== true) {
        toast(explain(result, tr("toast.recover.failed", { list: chat.title }), tr), { error: true });
        return;
      }
      void refreshState();
      const detail = syncDetail(result);
      toast(
        detail === "" ? tr("toast.sync.uptodate", { title: chat.title }) : `${tr("toast.sync.done", { title: chat.title })}${tr("send.join")}${detail}`,
        { ttl: 6e3 }
      );
    } finally {
      setSyncId(void 0);
    }
  }, [api, refreshState, syncDetail, toast, tr]);
  const recover = (0, import_react4.useCallback)(async () => {
    const listed = await api.webChats().catch(() => void 0);
    if (listed === void 0 || listed.ok !== true) {
      toast(explain(listed, tr("send.recoverList"), tr), { error: true });
      return;
    }
    if (listed.missing.length === 0) {
      toast(tr("toast.recover.empty"));
      return;
    }
    const total = listed.missing.length;
    let done = 0;
    let recovered = 0;
    let messages = 0;
    let added = 0;
    let completed = 0;
    let replaced = 0;
    let kept = 0;
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
        failures.push(`${item.title}${tr("send.join")}${explain(result, tr("send.unknown"), tr)}`);
        continue;
      }
      recovered += 1;
      messages += result.messageCount ?? 0;
      added += result.added ?? 0;
      completed += result.completed ?? 0;
      replaced += result.replaced ?? 0;
      kept += result.kept ?? 0;
    }
    toast(tr("toast.recover.summary", {
      count: String(recovered),
      total: String(total),
      messages: String(messages)
    }));
    const detail = syncDetail({ added, completed, replaced, kept });
    if (detail !== "") toast(detail, { ttl: 8e3 });
    if (failures.length > 0) {
      toast(tr("toast.recover.failed", { list: failures.slice(0, 3).join(tr("send.join")) }), { error: true, ttl: 12e3 });
    }
  }, [api, toast, tr, syncDetail]);
  const commitRename = (0, import_react4.useCallback)(async (chat) => {
    const title = renameDraft.trim().replace(/\s+/g, " ");
    setRenamingId(void 0);
    if (title === "" || title === chat.title) return;
    const result = await api.renameChat(chat.id, title).catch(() => void 0);
    if (result !== void 0 && result.ok !== true) toast(tr("toast.rename.failed", { error: explain(result, "", tr) }), { error: true });
    else toast(tr("toast.rename.done"));
  }, [renameDraft, api, toast, tr]);
  const exportFile = (0, import_react4.useCallback)(async () => {
    if (viewChat === void 0) return;
    const result = await api.exportFile(viewChat.id).catch(() => void 0);
    if (result === void 0 || result.ok !== true || result.filePath === void 0) {
      toast(tr("toast.export.failed", { error: explain(result, "", tr) }), { error: true });
      return;
    }
    toast(tr("toast.export.done", {
      file: result.dir === void 0 ? result.filePath : `${result.dir}/${result.filePath}`
    }));
  }, [viewChat, api, toast, tr]);
  const loadTransferPreview = (0, import_react4.useCallback)(async () => {
    if (viewChat === void 0 || previewing) return;
    setPreviewing(true);
    setStage(1);
    try {
      const result = await api.transferPreview(
        viewChat.id,
        cwd,
        transferMode,
        transferTarget === "new" ? targetWorkspaceId : void 0,
        transferTarget === "continue" ? continueTargetId : void 0
      );
      if (result.ok !== true || typeof result.markdown !== "string") {
        setStage(0);
        toast(tr("toast.transfer.failed", { error: explain(result, "", tr) }), {
          error: true,
          action: { label: tr("toast.transfer.retry"), run: () => {
            void loadTransferPreview();
          } }
        });
        return;
      }
      setPreview({
        distilled: result.distilled === true,
        fallback: result.fallback === true,
        ...result.fallbackReason === void 0 ? {} : { fallbackReason: result.fallbackReason },
        chars: result.markdown.length
      });
      setPreviewDraft(result.markdown);
      setStage(0);
    } catch (error) {
      setStage(0);
      toast(tr("toast.transfer.failed", { error: String(error) }), { error: true });
    } finally {
      setPreviewing(false);
    }
  }, [viewChat, previewing, api, cwd, transferMode, transferTarget, targetWorkspaceId, continueTargetId, toast, tr]);
  const runTransfer = (0, import_react4.useCallback)(async () => {
    if (viewChat === void 0 || transferring) return;
    setTransferring(true);
    setStage(2);
    try {
      const result = await api.transfer(
        viewChat.id,
        cwd,
        transferMode,
        transferTarget === "new" ? targetWorkspaceId : void 0,
        transferTarget === "continue" ? continueTargetId : void 0,
        { markdown: previewDraft, distilled: preview?.distilled === true }
      );
      if (result.ok !== true || result.sessionId === void 0) {
        setStage(0);
        toast(tr("toast.transfer.failed", { error: explain(result, "", tr) }), {
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
      else if (transferMode === "distill" && result.distilled !== true) toast(tr("toast.transfer.fallback"), { ttl: 12e3 });
      else toast(tr("toast.transfer.done"), { action: { label: tr("toast.open"), run: () => {
        void openSession(sessionId);
      } } });
      void (async () => {
        const opened = await Promise.resolve(openSession(sessionId)).catch(() => false);
        if (opened === false) toast(tr("toast.open.failed"), { error: true });
      })();
      window.setTimeout(() => {
        setTransferOpen(false);
        setStage(0);
        setPreview(void 0);
      }, 600);
    } catch (error) {
      setStage(0);
      toast(tr("toast.transfer.failed", { error: String(error) }), { error: true });
    } finally {
      setTransferring(false);
    }
  }, [viewChat, transferring, api, cwd, transferMode, transferTarget, targetWorkspaceId, continueTargetId, previewDraft, preview, openSession, toast, tr]);
  (0, import_react4.useEffect)(() => {
    setPreview(void 0);
    setPreviewDraft("");
  }, [viewChat?.id, transferMode, transferTarget, targetWorkspaceId, continueTargetId]);
  const createTargetWorkspace = (0, import_react4.useCallback)(async () => {
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
  const popovers = [
    [transferOpen, transferPopRef, setTransferOpen],
    [lampOpen, lampPopRef, setLampOpen],
    [moreOpen, morePopRef, setMoreOpen]
  ];
  const anyPopoverOpen = popovers.some(([open]) => open);
  (0, import_react4.useEffect)(() => {
    if (!anyPopoverOpen) return;
    const onDown = (event) => {
      const target = event.target;
      for (const [open, ref, close] of popovers) {
        if (open && ref.current?.contains(target) !== true) close(false);
      }
    };
    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      for (const [open, , close] of popovers) if (open) close(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onEscape);
    };
  }, [anyPopoverOpen, transferOpen, lampOpen, moreOpen]);
  (0, import_react4.useEffect)(() => {
    if (!statusOpen) return;
    const onKey = (event) => {
      if (event.key === "Escape") setStatusOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [statusOpen]);
  (0, import_react4.useEffect)(() => {
    const onKey = (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
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
  }, [state?.busy, stop, openSearch]);
  const uploadFiles = (0, import_react4.useCallback)(async (files) => {
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
          toast(tr("toast.attach.tooBig", { name: file.name === "" ? tr("attach.name.unnamed") : file.name, limit: MAX_ATTACH_LABEL }), { error: true });
          continue;
        }
        const payload = await fileToBase64(file);
        const sentName = file.name === "" ? tr("attach.name.pasted") : file.name;
        const result = await api.attach({
          name: sentName,
          mediaType: payload.mediaType,
          data: payload.data
        });
        if (result.ok !== true || result.path === void 0) {
          toast(tr("toast.attach.failed", { error: explain(result, "", tr) }), { error: true });
          continue;
        }
        const path = result.path;
        const name = result.name === void 0 || result.name === "" ? displayNameOf(path) : result.name;
        const kind = payload.mediaType.startsWith("image/") ? "image" : "file";
        setImages((list) => [...list, { path, name, mediaType: payload.mediaType, kind }]);
      }
    } catch (error) {
      toast(tr("toast.attach.failed", { error: String(error) }), { error: true });
    } finally {
      setAttachBusy(false);
    }
  }, [api, imagesRef, toast, tr]);
  const whaleTitle = state?.lastError ?? (engine.detail === "" ? tr("status.stopped") : engine.detail);
  const lampTone = engine.phase === "ready" || engine.phase === "thinking" || engine.phase === "streaming" ? "green" : engine.phase === "error" ? "red" : engine.phase === "launching" || engine.phase === "need-login" ? "amber" : "grey";
  const elapsed = busy && state?.busySince !== void 0 ? `${Math.max(0, (now - state.busySince) / 1e3).toFixed(1)}s` : void 0;
  const streamedChars = viewChat?.messages.reduce(
    (total, message) => message.role === "assistant" && message.streaming === true ? message.content.length : total,
    0
  ) ?? 0;
  const modelLabel = viewChat?.model === "deepseek-reasoner" ? tr("msg.model.think") : tr("msg.model");
  return (0, import_react4.createElement)(
    "div",
    /*
     * `data-list-open` is the panel's only observable STATE attribute, and it
     * exists because the alternative is worse: without it, "is 会话列表 up?"
     * can only be answered by reaching for a CSS class, which the next styling
     * change is free to rename. It is read by the design sheet
     * (scripts/dialog-preview.mjs) and it is what made two silent failures
     * visible while this dialog was being built — a click that never landed,
     * and a shared localStorage that pre-opened the dialog in a screenshot
     * meant to show it closed. It paints nothing.
     */
    { className: "dsh-dschat", "data-dsh-plugin": "dschat", "data-list-open": railOpen ? "1" : "0" },
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
    (0, import_react4.createElement)(
      "header",
      { className: "dsh-dschat-header", "data-window-drag": true },
      /*
       * The header is the PRODUCT MARK and the STATE LAMP, and nothing else.
       *
       * The three window controls that used to sit here (会话列表 / 搜索 /
       * 新建对话) moved into the action row directly above the composer, and the
       * 「在 Harness 中继续」 button went with them under its short label
       * 「DSH 迁移」。 Two reasons, and they point the same way: those four
       * actions are about the CONVERSATION — they read a list, search it,
       * replace it, or hand it off — so they belong beside the transcript and
       * the box that feeds it, not in a title bar that also carries the window's
       * drag region and its product identity. The header has no width to spare
       * for them at a narrow column, and it was the one strip whose emptiness
       * the window needed for dragging.
       *
       * The whale is now a plain mark rather than a button: it names the
       * product, and clicking a logo to "start the engine" was an affordance
       * nobody could guess. Everything that mark used to do lives on the lamp
       * beside it, whose tooltip says which state it is reporting.
       *
       * The 「···」 menu that once sat at the header's right end is back — at the
       * ACTION ROW's right end, next to the migration button (see `actions()`).
       * What it holds (运行状态 / 导出 markdown / 打开登录窗口 / 关闭浏览器) is
       * not header material either: it reads a transcript, writes one out, or
       * drives the page, and each of those is something the row beside the
       * conversation is already about.
       */
      (0, import_react4.createElement)(
        "span",
        { className: "dsh-dschat-brand" },
        (0, import_react4.createElement)(WhaleMark, { size: 19 }),
        (0, import_react4.createElement)("span", { className: "dsh-dschat-brand-name" }, tr("brand.title"))
      ),
      /*
       * The lamp and its menu in ONE positioned box.
       *
       * The wrapper is not decoration: the menu panel is absolutely positioned,
       * and its containing block is the nearest positioned ancestor. Standing
       * the wrapper next to the lamp instead of around it made that ancestor a
       * zero-width sibling which the header's flex spacer had already pushed to
       * the far edge — so the 230px panel opened at the panel's right edge,
       * hundreds of pixels from the dot that opened it (measured: dot at x=148,
       * menu at x=1266, overflowing the window). Around the lamp, the wrapper is
       * exactly the trigger's own box, which is what "anchored to the lamp"
       * means.
       *
       * The state lamp: a 7px dot in one of four colours, and the header's only
       * remaining control.
       *
       * The colour is the whole point — the engine's condition is legible from
       * the corner of the eye without a row of text — and the sentence did not
       * disappear: it is this button's tooltip and accessible name (see
       * `whaleTitle`). Colour is never the only channel.
       *
       * Its second job is to answer "what does this colour mean" on demand:
       * pressing the lamp opens a panel whose whole content is the same status
       * sentence in full, which a tooltip cannot give until the reader already
       * hovers the thing they have not understood. The engine's COMMANDS are
       * not here — see {@link moreMenu}.
       */
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-lamp-wrap" },
        (0, import_react4.createElement)(
          "button",
          {
            type: "button",
            className: "dsh-dschat-lamp",
            "data-tone": lampTone,
            "data-phase": engine.phase,
            title: whaleTitle,
            "aria-label": whaleTitle,
            "aria-haspopup": "menu",
            "aria-expanded": lampOpen,
            onClick: () => setLampOpen((open) => !open)
          },
          (0, import_react4.createElement)("i", { "aria-hidden": "true" })
        ),
        lampMenu()
      ),
      /*
       * The header's run of empty space — the window's drag region, and the
       * only one. `aria-hidden` because it carries nothing: it exists so the
       * window can be moved by the title bar's blank strip, which is where a
       * reader reaches for it.
       */
      (0, import_react4.createElement)("div", { className: "dsh-dschat-spacer", "data-window-drag": true, "aria-hidden": "true" }),
      /*
       * …and the engine menu at the far end of that run of space.
       *
       * 「···」 belongs to the TITLE BAR, not to the conversation: it holds
       * 运行状态 / 导出 markdown / 打开登录窗口 / 关闭浏览器, which are facts
       * about and controls over the PANEL and its browser — the same class of
       * thing as the window's own controls in that strip — while everything on
       * the action row below (list / search / new / hand-off) is about the
       * CONVERSATION. Putting it here also keeps it out of the way of the
       * reader who is writing a message, and gives the title bar's right end
       * the one control a reader checks for "what else can this thing do".
       *
       * It opens DOWNWARD for the same reason the lamp does: this is the top
       * strip, so there is no room above it (see the stylesheet's header rule).
       */
      moreMenu()
    ),
    /* ---------------------------------------------------------- body */
    (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-body" },
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-chat" },
        /*
         * The visible transcript, as a BOX.
         *
         * The navigator and the 「↓ 最新」 pill are positioned against this
         * wrapper rather than against the chat column, because the chat column
         * also holds the composer: centring the ticks in it would drag them
         * down towards the input, and pinning the pill to its bottom would put
         * the pill on top of the composer. See the stylesheet's threadbox rule.
         */
        (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-threadbox" },
          (0, import_react4.createElement)(
            "div",
            {
              className: "dsh-dschat-thread dsh-dschat-scroll",
              ref: listRef,
              onScroll: onThreadScroll,
              /*
               * The navigator needs a column of its own, and it must be a COLUMN
               * rather than an overlay: a 34px capsule floating over a 320px
               * panel sits on top of the text. The flag is on the scroller so
               * the padding lands on the inner reading column, where the
               * messages are — padding on the scroller itself would move the
               * scrollbar.
               */
              "data-nav": questions.length >= 2 && threadScrolls ? "true" : void 0
            },
            (0, import_react4.createElement)("div", { className: "dsh-dschat-thread-inner" }, thread())
          ),
          questionNav(),
          latestPill()
        ),
        composer(),
        phaseRail()
      )
    ),
    toasts.length > 0 && (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-toasts" },
      toasts.map((item) => (0, import_react4.createElement)(
        "div",
        { key: item.id, className: "dsh-dschat-toast", "data-error": item.error === true ? "true" : void 0 },
        (0, import_react4.createElement)(
          "span",
          { className: item.error === true ? "dsh-dschat-bad" : "dsh-dschat-ok" },
          item.error === true ? (0, import_react4.createElement)(WarnIcon, {}) : (0, import_react4.createElement)(CheckIcon, {})
        ),
        (0, import_react4.createElement)("span", null, item.text),
        item.action !== void 0 && (0, import_react4.createElement)(
          "button",
          { type: "button", onClick: () => {
            item.action?.run();
          } },
          item.action.label
        )
      ))
    ),
    /*
     * 「运行状态」, opened from the ··· menu.
     *
     * A modal of the panel's own rather than a page in the shell's Settings: it
     * is a diagnostic about THIS panel (see DSchatStatus), it is read while
     * looking at the conversation it describes, and the shell's Settings is
     * where the plugin's actual configuration lives — on the Plugins page, in
     * the form the shell renders from its Config schema.
     */
    statusOpen && (0, import_react4.createElement)(
      "div",
      {
        className: "dsh-dschat-modal",
        role: "dialog",
        "aria-modal": true,
        "aria-label": tr("status.title"),
        // A click on the backdrop closes it; a click inside the card does not.
        onClick: (event) => {
          if (event.target === event.currentTarget) setStatusOpen(false);
        }
      },
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-modal-card" },
        (0, import_react4.createElement)("button", {
          type: "button",
          className: "dsh-dschat-modal-close",
          title: tr("item.rename.cancel"),
          "aria-label": tr("item.rename.cancel"),
          onClick: () => setStatusOpen(false)
        }, (0, import_react4.createElement)(CloseIcon, { size: 12 })),
        (0, import_react4.createElement)(DSchatStatus, { api, tt, t })
      )
    )
  );
  function sessionsPopover() {
    if (!railOpen) return null;
    return (0, import_react4.createElement)(
      "div",
      {
        /*
         * The same panel 迁移 opens: `.dsh-dschat-pop` (348px, the panel's own
         * surface material and elevation) plus `.dsh-dschat-pop-up`, which is
         * the row's shared upward rule. `.dsh-dschat-listpop` is what makes it
         * a LIST inside that material rather than a form — see the stylesheet.
         */
        className: "dsh-dschat-pop dsh-dschat-pop-up dsh-dschat-listpop",
        role: "dialog",
        /*
         * Not `aria-modal`: nothing here is modal. The transcript behind it
         * stays live, and a reader who tabs away from the list should reach
         * the rest of the panel rather than be trapped in a menu they can
         * already see the bottom of.
         */
        "aria-label": tr("action.sessions"),
        /* Escape is the keyboard's way out, matching the trigger's second
           press and "pick a row" as the pointer's. */
        onKeyDown: (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          closeList();
        }
      },
      /*
       * The search box, at the TOP of the list.
       *
       * It filters the rows directly below it, and a filter that sits under
       * the thing it filters makes the reader look past the result to find
       * the control.
       */
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-search" },
        (0, import_react4.createElement)(SearchIcon, {}),
        (0, import_react4.createElement)("input", {
          ref: searchRef,
          value: query,
          placeholder: tr("rail.search"),
          "aria-label": tr("rail.search"),
          /*
           * The ⌘K advertisement lives HERE.
           *
           * It used to be the action row's 搜索 button, whose tooltip carried
           * 「搜索会话内容（⌘K）」. That button is gone (it duplicated this box),
           * and a shortcut nobody advertises is a shortcut nobody uses — so
           * the sentence moved onto the box itself, which is where the feature
           * lives and where a reader who is about to type in it will hover.
           */
          title: tr("rail.search.hint"),
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key !== "Escape" || query === "") return;
            event.preventDefault();
            setQuery("");
          }
        }),
        query !== "" && (0, import_react4.createElement)(
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
          (0, import_react4.createElement)(CloseIcon, { size: 10 })
        )
      ),
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-list dsh-dschat-listpop-list dsh-dschat-scroll" },
        filtered.length === 0 ? (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-hint-empty" },
          chats.length === 0 ? tr("rail.empty") : tr("rail.noMatch")
        ) : filtered.map((chat) => renamingId === chat.id ? renameRow(chat) : chatRow(chat))
      ),
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-listpop-foot" },
        (0, import_react4.createElement)(
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
          (0, import_react4.createElement)(RefreshIcon, {}),
          tr("action.recover")
        ),
        (0, import_react4.createElement)(
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
          clearArmed ? tr("rail.clearConfirm") : (0, import_react4.createElement)(TrashIcon, {})
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
    closeList();
  }
  function chatRow(chat) {
    return (0, import_react4.createElement)(
      "div",
      {
        key: chat.id,
        className: "dsh-dschat-item",
        "data-active": chat.id === viewChat?.id ? "true" : void 0
      },
      (0, import_react4.createElement)(
        "div",
        {
          className: "dsh-dschat-item-main",
          onClick: () => {
            openChat(chat);
          }
        },
        (0, import_react4.createElement)("div", { className: "dsh-dschat-item-title", title: chat.title }, chat.title),
        (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-item-meta" },
          // `messageCount` from the summary: the body may not be loaded, and the
          // row's job is to describe the conversation, not to have fetched it.
          `${fmt(tr("chats.count"), { count: String(chat.messageCount) })} \xB7 ${relativeTime(chat.updatedAt, tr)}`
        )
      ),
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-item-acts" },
        /*
         * 「从网页同步」, per row.
         *
         * The rail's own sync button only pulls in conversations the store has
         * never seen (that is what "missing" means to it), so without this the
         * incremental merge would be unreachable for a conversation that has
         * been synced once and then continued on the web — which is the normal
         * way a reader uses this panel. It only appears on rows that know their
         * web session id: a conversation with no id has no web counterpart to
         * read.
         */
        chat.webSessionId === void 0 ? null : (0, import_react4.createElement)(
          "button",
          {
            type: "button",
            className: "dsh-dschat-mini",
            title: tr("item.sync"),
            "aria-label": tr("item.sync"),
            disabled: syncId !== void 0,
            onClick: () => {
              void syncChat(chat);
            }
          },
          syncId === chat.id ? (0, import_react4.createElement)("span", { className: "dsh-dschat-spin" }) : (0, import_react4.createElement)(RefreshIcon, {})
        ),
        (0, import_react4.createElement)(
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
          (0, import_react4.createElement)(PencilIcon, {})
        ),
        (0, import_react4.createElement)(
          "button",
          {
            type: "button",
            className: "dsh-dschat-mini dsh-dschat-mini-danger",
            title: tr("item.delete"),
            onClick: () => {
              void removeChat(chat);
            }
          },
          (0, import_react4.createElement)(TrashIcon, {})
        )
      )
    );
  }
  function renameRow(chat) {
    return (0, import_react4.createElement)(
      "div",
      { key: chat.id, className: "dsh-dschat-item", "data-active": chat.id === viewChat?.id ? "true" : void 0 },
      (0, import_react4.createElement)("input", {
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
  function engineNoticeOf() {
    const retry2 = (0, import_react4.createElement)("button", {
      type: "button",
      className: "dsh-dschat-btn dsh-dschat-btn-primary",
      disabled: waking,
      onClick: () => {
        void retryEngine();
      }
    }, waking ? tr("engine.notice.retrying") : tr("engine.notice.retry"));
    const login = (0, import_react4.createElement)("button", {
      type: "button",
      className: "dsh-dschat-btn dsh-dschat-btn-ghost",
      onClick: () => {
        void openLogin();
      }
    }, tr("action.openLogin"));
    const status = (0, import_react4.createElement)("button", {
      type: "button",
      className: "dsh-dschat-btn dsh-dschat-btn-ghost",
      onClick: () => setStatusOpen(true)
    }, tr("status.title"));
    if (launchError !== void 0) {
      return { key: "launch", title: tr("engine.notice.title"), body: launchError, actions: (0, import_react4.createElement)(import_react4.Fragment, null, retry2, login) };
    }
    switch (phase) {
      case "error":
        return {
          key: "error",
          title: tr("engine.notice.error.title"),
          body: state?.engineError ?? "",
          actions: (0, import_react4.createElement)(import_react4.Fragment, null, retry2, status)
        };
      case "need-login":
        return {
          key: "login",
          title: tr("engine.notice.login.title"),
          body: tr("engine.notice.login.body"),
          actions: (0, import_react4.createElement)(import_react4.Fragment, null, login, retry2)
        };
      case "stopped": {
        if ((viewChat?.messages.length ?? 0) === 0) return void 0;
        return { key: "offline", title: tr("engine.notice.offline.title"), body: tr("engine.notice.offline.body"), actions: retry2 };
      }
      default:
        return void 0;
    }
  }
  function engineNotice() {
    const notice = engineNoticeOf();
    if (notice === void 0) return null;
    return (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-notice", key: `engine-notice-${notice.key}`, role: "status" },
      (0, import_react4.createElement)("span", { className: "dsh-dschat-notice-mark" }, (0, import_react4.createElement)(WarnIcon, {})),
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-notice-body" },
        (0, import_react4.createElement)("strong", null, notice.title),
        notice.body === "" ? null : (0, import_react4.createElement)("p", null, notice.body),
        /*
         * The actions sit UNDER the sentence, in a row: the sentence is what the
         * reader has to read before choosing, and at panel widths a column of
         * buttons beside it squeezes both.
         */
        (0, import_react4.createElement)("div", { className: "dsh-dschat-notice-actions" }, notice.actions)
      )
    );
  }
  function thread() {
    if (viewChat !== void 0 && viewChat.messages.length === 0 && viewChat.loaded !== true && viewChat.messageCount > 0) {
      return (0, import_react4.createElement)(
        import_react4.Fragment,
        { key: "loading" },
        (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-empty dsh-dschat-loading" },
          (0, import_react4.createElement)("div", { className: "dsh-dschat-empty-mark" }, (0, import_react4.createElement)(ChatIcon, { size: 22 })),
          (0, import_react4.createElement)("h3", null, tr("thread.loading"))
        ),
        engineNotice()
      );
    }
    if (viewChat === void 0 || viewChat.messages.length === 0) {
      return (0, import_react4.createElement)(
        import_react4.Fragment,
        { key: "empty" },
        (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-empty" },
          (0, import_react4.createElement)("div", { className: "dsh-dschat-empty-mark" }, (0, import_react4.createElement)(ChatIcon, { size: 22 })),
          (0, import_react4.createElement)("h3", null, tr("empty.title")),
          (0, import_react4.createElement)("p", null, tr("empty.body")),
          /*
           * 或者试试: three things the web page can actually be asked to do —
           * translate, summarise, polish a passage — and each one WRITES ITSELF.
           *
           * The page used to end on 「Enter 发送 / ⌘/ 聚焦」, which documents the
           * keyboard instead of inviting a question, and a new reader still had
           * no idea what this panel was for. A prompt chip is the shortest path
           * from an empty page to a first reply: the sentence lands in the
           * composer, focused, ready to edit or send — nothing is sent by the
           * click itself, so a chip can never spend a turn the reader did not
           * ask for.
           *
           * It also wakes the engine, exactly as clicking the field does, so the
           * page starts while the reader is still reading the sentence.
           */
          (0, import_react4.createElement)(
            "div",
            { className: "dsh-dschat-empty-try" },
            (0, import_react4.createElement)("span", { className: "dsh-dschat-empty-try-label" }, tr("empty.try")),
            (0, import_react4.createElement)(
              "div",
              { className: "dsh-dschat-empty-try-list" },
              ...["empty.try.translate", "empty.try.summarize", "empty.try.polish"].map((key) => (0, import_react4.createElement)(
                "button",
                {
                  key,
                  type: "button",
                  className: "dsh-dschat-try",
                  onClick: () => {
                    setDraft(tr(key));
                    void ensureReady();
                    inputRef.current?.focus();
                  }
                },
                tr(key)
              ))
            )
          ),
          (0, import_react4.createElement)(
            "p",
            { className: "dsh-dschat-empty-keys" },
            (0, import_react4.createElement)("span", { className: "dsh-dschat-kbd" }, "Enter"),
            (0, import_react4.createElement)("span", null, tr("action.send")),
            (0, import_react4.createElement)("span", { className: "dsh-dschat-kbd" }, "\u2318/"),
            (0, import_react4.createElement)("span", null, tr("composer.hint.focus"))
          ),
          loggedIn !== true && (0, import_react4.createElement)(
            "button",
            { type: "button", className: "dsh-dschat-btn dsh-dschat-btn-primary", onClick: () => {
              void openLogin();
            } },
            tr("action.openLogin")
          )
        ),
        engineNotice()
      );
    }
    const keys = threadKeys(viewChat.messages);
    return (0, import_react4.createElement)(
      "div",
      { style: { display: "contents" }, key: "thread" },
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-day", key: "day" },
        new Date(viewChat.messages[0]?.ts ?? Date.now()).toLocaleDateString()
      ),
      ...viewChat.messages.map((message, index) => messageNode(message, keys[index] ?? message.id, index)),
      engineNotice()
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
    const markdownCopy = {
      copy: tr("msg.copy"),
      collapseHint: tr("msg.think.collapse"),
      details: tr("msg.details"),
      language: tr("msg.code.language")
    };
    const quoted = isUser ? (message.content.split("\n")[0] ?? "").trim() : firstLine(message.content);
    const actions2 = isUser ? [
      { key: "copy", title: tr("msg.copy"), icon: (0, import_react4.createElement)(CopyIcon, {}), run: () => {
        void copyText(reply, tr("toast.copied"));
      } },
      { key: "edit", title: tr("msg.edit"), icon: (0, import_react4.createElement)(PencilIcon, {}), run: () => {
        setDraft(message.content);
        inputRef.current?.focus();
      } }
    ] : [
      { key: "copy", title: tr("msg.copy"), icon: (0, import_react4.createElement)(CopyIcon, {}), run: () => {
        void copyText(reply, tr("toast.copied"));
      } },
      ...thinking === "" ? [] : [{
        key: "copy-thinking",
        title: tr("msg.copyThinking"),
        icon: (0, import_react4.createElement)(ThinkIcon, {}),
        run: () => {
          void copyText(thinking, tr("toast.thinkingCopied"));
        }
      }],
      ...quoted === "" ? [] : [{
        key: "quote",
        title: tr("msg.quote"),
        icon: (0, import_react4.createElement)(QuoteIcon, {}),
        run: () => {
          setDraft(`> ${quoted}

`);
          inputRef.current?.focus();
        }
      }]
    ];
    const body = (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-msg-body" },
      /*
       * What was attached to this message, as chips.
       *
       * The transcript stores PATHS only, so these are read back rather than
       * remembered: the `uuid__` prefix is stripped for the label, and the
       * extension decides whether the chip offers to show the image. Old
       * transcripts — whose files were written before the readable label
       * existed — show their bare UUID, which is all they have.
       */
      message.attachments !== void 0 && message.attachments.length > 0 && (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-imgs" },
        message.attachments.map((path) => (0, import_react4.createElement)(
          "div",
          { key: path, className: "dsh-dschat-chip", title: displayNameOf(path) },
          (0, import_react4.createElement)(ClipIcon, { size: 12 }),
          (0, import_react4.createElement)("span", null, displayNameOf(path)),
          attachmentKind(path) === "image" && (0, import_react4.createElement)("a", {
            className: "dsh-dschat-chip-view",
            href: api.attachmentUrl(path),
            target: "_blank",
            rel: "noreferrer",
            title: tr("attach.show"),
            "aria-label": tr("attach.show")
          }, "\u2197")
        ))
      ),
      isUser ? (0, import_react4.createElement)("p", null, message.content) : (0, import_react4.createElement)(
        import_react4.Fragment,
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
        thinking !== "" && (0, import_react4.createElement)(Thinking, {
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
          copy: markdownCopy,
          options: markdownOptions()
        }),
        (0, import_react4.createElement)(Markdown, {
          source: reply,
          copy: markdownCopy,
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
      message.streaming === true && (0, import_react4.createElement)("span", { className: "dsh-dschat-caret" }),
      message.error !== void 0 && (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-err" },
        (0, import_react4.createElement)(WarnIcon, {}),
        (0, import_react4.createElement)("span", null, message.content === "" ? message.error : tr("phase.replyPartial")),
        (0, import_react4.createElement)("span", { className: "dsh-dschat-spacer" }),
        (0, import_react4.createElement)(
          "button",
          { type: "button", className: "dsh-dschat-btn dsh-dschat-btn-ghost", onClick: () => {
            void retry();
          } },
          tr("msg.retry")
        )
      )
    );
    const acts = (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-msg-acts" },
      actions2.map((action) => (0, import_react4.createElement)(
        "button",
        { key: action.key, type: "button", title: action.title, "aria-label": action.title, onClick: action.run },
        action.icon
      ))
    );
    return (0, import_react4.createElement)(
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
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-msg-head" },
        (0, import_react4.createElement)("span", { className: "dsh-dschat-msg-who" }, who),
        (0, import_react4.createElement)("span", null, new Date(message.ts).toLocaleTimeString())
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
      isUser ? (0, import_react4.createElement)("div", { className: "dsh-dschat-msg-line" }, body, acts) : (0, import_react4.createElement)(import_react4.Fragment, null, body, acts)
    );
  }
  function questionNav() {
    if (questions.length < 2 || !threadScrolls) return null;
    return (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-navwrap" },
      (0, import_react4.createElement)(
        "nav",
        {
          className: "dsh-dschat-nav",
          // The count lives here (and in the tooltip) rather than in a header
          // line: a header would push every row down the moment the pointer
          // arrived, which is exactly when it must not move. See the stylesheet.
          "aria-label": fmt(tr("qnav.title"), { count: String(questions.length) }),
          title: fmt(tr("qnav.title"), { count: String(questions.length) }),
          "data-open": navOpen ? "true" : void 0,
          // Hover opens the list; leaving closes it. Both the panel and the
          // pointer are cheap here because the node only exists while there is
          // something to navigate.
          onMouseEnter: () => setNavOpen(true),
          onMouseLeave: () => setNavOpen(false),
          // Keyboard parity: focusing anything inside opens it (a keyboard user
          // cannot hover), and Escape closes it again.
          onFocus: () => setNavOpen(true),
          onBlur: (event) => {
            if (event.relatedTarget !== null && event.currentTarget.contains(event.relatedTarget)) return;
            setNavOpen(false);
          },
          onKeyDown: (event) => {
            if (event.key === "Escape") setNavOpen(false);
          }
        },
        (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-nav-list" },
          questions.map((question, index) => (0, import_react4.createElement)(
            "button",
            {
              key: question.id,
              type: "button",
              className: "dsh-dschat-nav-item",
              "data-active": index === navIndex ? "true" : void 0,
              "aria-current": index === navIndex ? "true" : void 0,
              "aria-label": fmt(tr("qnav.item"), { index: String(index + 1), text: question.text }),
              title: question.text,
              onClick: () => jumpToQuestion(question.id)
            },
            (0, import_react4.createElement)("span", { className: "dsh-dschat-nav-idx", "aria-hidden": "true" }, String(index + 1)),
            (0, import_react4.createElement)("span", { className: "dsh-dschat-nav-text" }, question.text),
            (0, import_react4.createElement)("i", { className: "dsh-dschat-nav-tick", "aria-hidden": "true" })
          ))
        )
      )
    );
  }
  function latestPill() {
    if (atBottom) return null;
    return (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-latestwrap" },
      (0, import_react4.createElement)(
        "button",
        {
          type: "button",
          className: "dsh-dschat-latest",
          title: tr("qnav.latest.hint"),
          onClick: jumpToLatest
        },
        tr("qnav.latest")
      )
    );
  }
  function composer() {
    return (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-composer" },
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-composer-inner" },
        /*
         * The action row sits ABOVE the card and outside it: the card is the
         * message, and these four controls act on the conversation the card
         * belongs to. Keeping it out also means the card keeps its own shadow
         * and radius — a toolbar inside it would read as part of the message
         * the reader is still writing.
         */
        actions(),
        (0, import_react4.createElement)(
          "div",
          {
            className: dragging ? "dsh-dschat-card dsh-dschat-dragging" : "dsh-dschat-card",
            /*
             * Whether the page behind this field is up. The stylesheet keys the
             * accent placeholder (and a faint wash) off it — the textarea itself
             * has no read-only state any more to carry that meaning, because it
             * is genuinely editable in every engine state.
             */
            "data-engine": loggedIn === true && engineLive ? "on" : "off",
            /*
             * The card is a shortcut to the textarea, nothing more. It is not a
             * "start me" button any more: the composer is an ordinary, always
             * editable field, and the page starts by itself when the reader
             * clicks or types in it (see the textarea's own handlers).
             *
             * Guarded on `target === currentTarget` so this never steals a click
             * from a chip, a pill or the attach button: only a click on the card
             * itself is forwarded to the input.
             */
            onClick: (event) => {
              if (event.target !== event.currentTarget) return;
              inputRef.current?.focus();
              void ensureReady();
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
          images.length > 0 && (0, import_react4.createElement)(
            "div",
            { className: "dsh-dschat-attachments" },
            /*
             * Two faces, decided by the file's own type.
             *
             * An IMAGE is shown as itself: a 56px thumbnail, which is the whole
             * point of attaching a picture — the reader checks they grabbed the
             * right screenshot without opening it. Anything else keeps the
             * paperclip chip, now carrying the reader's own file name instead
             * of the stored UUID (see {@link ComposerAttachment}).
             *
             * The thumbnail's `src` is the host's read-back route, so the bytes
             * are never held in the panel's state — and an old attachment whose
             * file has since been pruned fails that request, which is what the
             * chip fallback below is for.
             */
            images.map((item, index) => (0, import_react4.createElement)(
              "span",
              {
                key: `${item.path}-${index}`,
                className: item.kind === "image" ? "dsh-dschat-thumb" : "dsh-dschat-chip",
                title: item.name
              },
              item.kind === "image" ? (0, import_react4.createElement)("img", { src: api.attachmentUrl(item.path), alt: item.name, loading: "lazy" }) : (0, import_react4.createElement)(ClipIcon, { size: 12 }),
              item.kind !== "image" && (0, import_react4.createElement)("span", null, item.name),
              (0, import_react4.createElement)("button", {
                type: "button",
                title: tr("attach.remove.hint", { name: item.name }),
                "aria-label": tr("attach.remove.hint", { name: item.name }),
                onClick: () => setImages((list) => list.filter((_, i) => i !== index))
              }, "\u2715")
            ))
          ),
          (0, import_react4.createElement)("textarea", {
            ref: inputRef,
            className: "dsh-dschat-input",
            rows: 1,
            value: draft,
            /*
             * An ordinary, ALWAYS editable field.
             *
             * Neither `disabled` nor `readOnly` — the two ways this box used to
             * refuse the reader. `disabled` dropped every pointer event ("点击
             * 输入框无反应"); `readOnly` was better but still meant that with the
             * page down, or while a reply was streaming, the one control on
             * screen that looks like a text field could not hold text. Typing,
             * pasting a file and pressing Enter all work in every engine state
             * now, and what each of those *means* is decided by the handlers
             * below: the page starts in the background, and a message written
             * during a turn waits its turn in the outbox.
             */
            placeholder: waking || state?.engine === "launching" ? tr("composer.connecting") : loggedIn !== true ? engineLive ? tr("composer.notLoggedIn") : tr("composer.offline") : tr("composer.placeholder"),
            /*
             * A click in the box is a request to type, and typing needs the page:
             * start it, in the background, once — `ensureReady` reuses a live
             * page, joins a launch already in flight, and asks for the visible
             * login window only when the profile is genuinely signed out. The
             * field itself never waits for any of that.
             *
             * `onClick` as well as `onFocus`: clicking a box that is ALREADY
             * focused (the common second attempt after a failed start) fires no
             * focus event at all.
             */
            onFocus: () => {
              void ensureReady();
            },
            onClick: () => {
              void ensureReady();
            },
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (!submitsOnEnter(event)) return;
              event.preventDefault();
              void send();
            }
          }),
          /*
           * What is waiting for the running turn to end.
           *
           * Between the box and the tool row, because it is about the messages
           * above it — and because a queue the reader cannot see is a queue they
           * will re-type. Each row can be cancelled individually: the message
           * goes back to being theirs, not the panel's.
           */
          outbox.length > 0 && (0, import_react4.createElement)(
            "div",
            { className: "dsh-dschat-queue" },
            outbox.map((item) => (0, import_react4.createElement)(
              "div",
              { key: item.id, className: "dsh-dschat-queue-item" },
              (0, import_react4.createElement)("span", { className: "dsh-dschat-queue-mark", "aria-hidden": "true" }, "\u23F3"),
              (0, import_react4.createElement)("span", { className: "dsh-dschat-queue-text", title: item.text }, item.text),
              item.images.length > 0 && (0, import_react4.createElement)(
                "span",
                { className: "dsh-dschat-queue-files" },
                fmt(tr("composer.queue.files"), { count: String(item.images.length) })
              ),
              (0, import_react4.createElement)("button", {
                type: "button",
                title: tr("composer.queue.cancel"),
                "aria-label": tr("composer.queue.cancel"),
                onClick: () => dropQueued(item.id)
              }, "\u2715")
            )),
            (0, import_react4.createElement)("div", { className: "dsh-dschat-queue-note" }, tr("composer.queue.note"))
          ),
          dragging && (0, import_react4.createElement)("div", { className: "dsh-dschat-dropline" }, tr("composer.attach.drop")),
          (0, import_react4.createElement)(
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
            (0, import_react4.createElement)(
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
              (0, import_react4.createElement)(DeepThinkIcon, { size: 14 }),
              (0, import_react4.createElement)("span", { className: "dsh-dschat-toggle-text" }, tr("toggle.deepThink"))
            ),
            (0, import_react4.createElement)(
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
              (0, import_react4.createElement)(WebSearchIcon, { size: 14 }),
              (0, import_react4.createElement)("span", { className: "dsh-dschat-toggle-text" }, tr("toggle.search"))
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
            (0, import_react4.createElement)("div", { className: "dsh-dschat-spacer" }),
            preparingNewChat && (0, import_react4.createElement)(
              "span",
              { className: "dsh-dschat-hintline", style: { margin: 0 } },
              (0, import_react4.createElement)("span", { className: "dsh-dschat-spin" }),
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
            (0, import_react4.createElement)("input", {
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
            (0, import_react4.createElement)(
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
                /*
                 * Attaching needs no engine: the bytes go to the host route,
                 * which writes them to disk and answers a path the page can be
                 * handed later. Disabling it while the page was down (or while a
                 * reply streamed) meant the reader could not prepare the message
                 * they were about to send with it.
                 */
                disabled: attachBusy,
                onClick: () => uploadRef.current?.click()
              },
              attachBusy ? (0, import_react4.createElement)("span", { className: "dsh-dschat-spin" }) : (0, import_react4.createElement)(ClipIcon, { size: 16 })
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
            /*
             * 停止 and 发送 are BOTH here while a reply streams.
             *
             * They used to be the same slot (the send circle became 停止), which
             * is what the web page itself does — and it is why a second message
             * had nowhere to go: the control that sends had turned into the
             * control that stops. The reader can now do either, and the message
             * they send waits in the queue above (see composer.queue.note).
             */
            streaming && (0, import_react4.createElement)(
              "button",
              { type: "button", className: "dsh-dschat-stop", onClick: () => {
                void stop();
              } },
              (0, import_react4.createElement)("i", null),
              tr("action.stop")
            ),
            (0, import_react4.createElement)(
              "button",
              {
                type: "button",
                className: "dsh-dschat-send",
                title: tr("action.send"),
                "aria-label": tr("action.send"),
                disabled: !canSend,
                onClick: () => {
                  void send();
                }
              },
              (0, import_react4.createElement)(SendIcon, {})
            )
          )
        )
      )
    );
  }
  function phaseRail() {
    return (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-phase" },
      busy && (0, import_react4.createElement)("span", { className: "dsh-dschat-spin" }),
      (0, import_react4.createElement)("span", null, busy ? tr("phase.busy") : tr("phase.idle")),
      (0, import_react4.createElement)("span", { className: "dsh-dschat-sep" }, "|"),
      (0, import_react4.createElement)("span", null, loggedIn === true ? tr("phase.loggedIn") : tr("phase.notLoggedIn")),
      busy && elapsed !== void 0 && (0, import_react4.createElement)("span", null, fmt(tr("phase.elapsed"), { time: elapsed })),
      busy && (0, import_react4.createElement)("span", null, fmt(tr("phase.chars"), { count: String(streamedChars) })),
      !busy && viewChat !== void 0 && (0, import_react4.createElement)("span", { className: "dsh-dschat-sep" }, "|"),
      !busy && viewChat !== void 0 && (0, import_react4.createElement)(
        "span",
        null,
        fmt(tr("phase.turns"), { count: String(viewChat.messages.length) })
      ),
      state?.lastError !== void 0 && (0, import_react4.createElement)("span", null, `\xB7 ${state.lastError}`)
    );
  }
  function actions() {
    return (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-actions", role: "toolbar", "aria-label": tr("composer.actions") },
      /*
       * 会话列表, and the panel it opens — ONE wrapper, exactly like 迁移.
       *
       * The wrapper is not decoration: `.dsh-dschat-pop` is absolutely
       * positioned, so its containing block is the nearest positioned ancestor,
       * and the wrapper is what makes that ancestor the trigger's own box
       * rather than the panel. Standing the panel next to the button instead of
       * around it is the bug the lamp's menu already paid for — see the note on
       * the lamp wrapper — where a 230px panel opened hundreds of pixels from
       * the dot that opened it.
       */
      (0, import_react4.createElement)(
        "div",
        /*
         * `listWrapRef` is what the measurement effect and the outside-click
         * effect both hang off: it is the trigger's own box plus the popover, so
         * "where is this button" and "did the press land inside the menu" are
         * the same element.
         */
        { className: "dsh-dschat-pop-wrap", ref: listWrapRef },
        /*
         * The trigger.
         *
         * The glyph is three rules now, not the panel-with-gutter the sidebar
         * version used: that glyph drew a SIDE COLUMN, so it promised a sidebar
         * while the click opened something that hangs over the transcript. See
         * MenuIcon.
         *
         * `dsh-dschat-tbtn-sessions` is a MARKER class the tests and the design
         * scripts select on, in the same spirit as `dsh-dschat-tbtn-transfer` —
         * it carries no styling of its own.
         */
        (0, import_react4.createElement)(
          "button",
          {
            type: "button",
            className: railOpen ? "dsh-dschat-tbtn dsh-dschat-tbtn-on dsh-dschat-tbtn-sessions" : "dsh-dschat-tbtn dsh-dschat-tbtn-sessions",
            title: railOpen ? tr("rail.hide") : tr("rail.show"),
            "aria-label": tr("action.sessions"),
            "aria-haspopup": "dialog",
            "aria-expanded": railOpen,
            onClick: () => {
              toggleRail();
            }
          },
          (0, import_react4.createElement)("span", { className: "dsh-dschat-tbtn-glyph" }, (0, import_react4.createElement)(MenuIcon, { size: 16 })),
          (0, import_react4.createElement)("span", { className: "dsh-dschat-tbtn-text" }, tr("action.sessions"))
        ),
        sessionsPopover()
      ),
      /*
       * 搜索 is NOT a button here.
       *
       * It was one, and it only ever did two things: bring the list back if it
       * was closed, and put the cursor in the list's search box. With the list
       * open — the default — the box is already on screen, so the button was a
       * second, wordier copy of an input the reader can simply click. That is
       * why it did not earn its place: this row is the conversation's verbs, and
       * "search this conversation" is not a mode the way 会话列表 / 新对话 / 迁移
       * are.
       *
       * Its one unique offer — reaching search without opening the list first —
       * is ⌘K's job, and ⌘K routes through `openSearch()`, which opens the list
       * and puts the cursor in its box. Before ⌘K did that, the shortcut wrote
       * into a null ref while the list was closed and did nothing at all, which
       * is exactly why the button could not simply be deleted on its own.
       */
      (0, import_react4.createElement)(
        "button",
        {
          type: "button",
          className: "dsh-dschat-tbtn",
          title: tr("action.newChat.hint"),
          "aria-label": tr("action.newChat"),
          disabled: preparingNewChat,
          onClick: () => {
            void newChat();
          }
        },
        (0, import_react4.createElement)("span", { className: "dsh-dschat-tbtn-glyph" }, (0, import_react4.createElement)(PlusIcon, { size: 16 })),
        (0, import_react4.createElement)("span", { className: "dsh-dschat-tbtn-text" }, tr("action.newChat"))
      ),
      (0, import_react4.createElement)("div", { className: "dsh-dschat-spacer" }),
      transferPopover()
    );
  }
  function moreMenu() {
    const open = moreOpen;
    return (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-pop-wrap", ref: morePopRef },
      (0, import_react4.createElement)(
        "button",
        {
          type: "button",
          className: open ? "dsh-dschat-tbtn dsh-dschat-tbtn-on" : "dsh-dschat-tbtn",
          title: tr("more.hint"),
          "aria-label": tr("more.hint"),
          "aria-haspopup": "menu",
          "aria-expanded": open,
          onClick: () => setMoreOpen((value) => !value)
        },
        (0, import_react4.createElement)(MoreIcon, { size: 16 })
      ),
      open && (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-pop dsh-dschat-pop-menu" },
        moreItem("status", tr("status.title"), () => setStatusOpen(true)),
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
      return (0, import_react4.createElement)(
        "button",
        {
          key,
          type: "button",
          className: "dsh-dschat-menu-item",
          onClick: () => {
            run();
            setMoreOpen(false);
          }
        },
        label
      );
    }
  }
  function lampMenu() {
    if (!lampOpen) return null;
    return (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-pop dsh-dschat-pop-status", ref: lampPopRef },
      (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-lamp-status" },
        (0, import_react4.createElement)("i", { className: "dsh-dschat-lamp-dot", "data-tone": lampTone, "aria-hidden": "true" }),
        (0, import_react4.createElement)("span", null, whaleTitle)
      )
    );
  }
  function transferPopover() {
    const note = transferTarget === "continue" ? tr("transfer.note.continue") : tr("transfer.note.new");
    return (0, import_react4.createElement)(
      "div",
      { className: "dsh-dschat-pop-wrap", ref: transferPopRef },
      (0, import_react4.createElement)(
        "button",
        {
          type: "button",
          /*
           * `dsh-dschat-tbtn-transfer` is a MARKER, not a style: the two
           * labelled buttons on this row wear the identical treatment (that is
           * the point of the change), so nothing in the stylesheet keys off
           * this class. It exists so the verification script and future tests
           * can name the migration button without reaching for its text.
           */
          className: transferOpen ? "dsh-dschat-tbtn dsh-dschat-tbtn-on dsh-dschat-tbtn-transfer" : "dsh-dschat-tbtn dsh-dschat-tbtn-transfer",
          title: tr("transfer.short.hint"),
          "aria-label": tr("transfer.short.hint"),
          "aria-haspopup": "menu",
          "aria-expanded": transferOpen,
          disabled: transferring || viewChat === void 0 || viewChat.messages.length === 0,
          onClick: () => {
            if (!transferOpen) {
              setTransferTarget("new");
              setTargetSessionId(void 0);
            }
            setTransferOpen((open) => !open);
          }
        },
        /*
         * The swap glyph makes the button findable at the row's right end
         * without the words: it reads as "hand this over", which is what both
         * migration modes do. The two labels are separate spans so the row's
         * own `gap` spaces them evenly — a bare text node beside an icon has no
         * box to be spaced by.
         */
        (0, import_react4.createElement)("span", { className: "dsh-dschat-tbtn-glyph" }, (0, import_react4.createElement)(SwapIcon, { size: 14 })),
        (0, import_react4.createElement)("span", { className: "dsh-dschat-tbtn-text" }, tr("transfer.short")),
        (0, import_react4.createElement)("span", { className: "dsh-dschat-tbtn-caret" }, (0, import_react4.createElement)(CaretIcon, {}))
      ),
      transferOpen && (0, import_react4.createElement)(
        "div",
        { className: "dsh-dschat-pop dsh-dschat-pop-up" },
        (0, import_react4.createElement)("h4", null, tr("transfer.title")),
        (0, import_react4.createElement)("p", { className: "dsh-dschat-sub" }, tr("transfer.sub")),
        (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-field" },
          (0, import_react4.createElement)("label", null, tr("transfer.mode")),
          (0, import_react4.createElement)(
            "div",
            { className: "dsh-dschat-seg" },
            (0, import_react4.createElement)("button", {
              type: "button",
              "data-on": transferMode === "distill" ? "true" : void 0,
              onClick: () => setTransferMode("distill")
            }, tr("transfer.mode.distill")),
            (0, import_react4.createElement)("button", {
              type: "button",
              "data-on": transferMode === "raw" ? "true" : void 0,
              onClick: () => setTransferMode("raw")
            }, tr("transfer.mode.raw"))
          )
        ),
        (0, import_react4.createElement)(
          "p",
          { className: "dsh-dschat-hintline" },
          (0, import_react4.createElement)(CheckIcon, {}),
          transferMode === "distill" ? tr("transfer.mode.distill.hint") : tr("transfer.mode.raw.hint")
        ),
        (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-field" },
          (0, import_react4.createElement)("label", null, tr("transfer.target")),
          (0, import_react4.createElement)(
            "div",
            { className: "dsh-dschat-seg" },
            (0, import_react4.createElement)("button", {
              type: "button",
              "data-on": transferTarget === "new" ? "true" : void 0,
              onClick: () => setTransferTarget("new")
            }, tr("transfer.target.new")),
            (0, import_react4.createElement)("button", {
              type: "button",
              "data-on": transferTarget === "continue" ? "true" : void 0,
              disabled: continuationTargets.length === 0,
              onClick: () => setTransferTarget("continue")
            }, tr("transfer.target.continue"))
          )
        ),
        transferTarget === "continue" && (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-field" },
          (0, import_react4.createElement)("label", null, tr("transfer.continueTo")),
          continuationTargets.length === 0 ? (0, import_react4.createElement)("p", { className: "dsh-dschat-hintline" }, tr("transfer.continue.empty")) : (0, import_react4.createElement)("select", {
            className: "dsh-dschat-select",
            value: continueTargetId ?? "",
            onChange: (event) => setTargetSessionId(event.target.value)
          }, continuationTargets.map((target) => (0, import_react4.createElement)("option", { key: target.id, value: target.id }, target.title)))
        ),
        transferTarget === "new" && (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-field" },
          (0, import_react4.createElement)("label", null, tr("transfer.workspace")),
          (0, import_react4.createElement)(
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
            (0, import_react4.createElement)("option", { value: "" }, tr("transfer.ungrouped")),
            workspaces.map((workspace) => (0, import_react4.createElement)(
              "option",
              { key: workspace.id, value: workspace.id },
              `${workspace.title} \u2014 ${workspace.path}`
            )),
            (0, import_react4.createElement)("option", { value: "__new__" }, tr("transfer.workspace.new"))
          )
        ),
        /*
         * The hand-off preview: the exact first message, before it exists.
         *
         * Editable on purpose — the reader may want to trim a paragraph, add a
         * line of their own, or (seeing the fallback notice) switch to 原文迁移
         * knowingly rather than discovering afterwards that a 15k-character log
         * was written in place of a brief.
         */
        preview !== void 0 && (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-field" },
          (0, import_react4.createElement)("label", null, tr("transfer.preview")),
          (0, import_react4.createElement)("p", {
            className: "dsh-dschat-hintline dsh-dschat-preview-note",
            "data-tone": preview.distilled ? "ok" : "warn"
          }, preview.distilled ? tr("transfer.preview.distilled") : tr("transfer.preview.raw")),
          preview.fallback && preview.fallbackReason !== void 0 ? (0, import_react4.createElement)("p", {
            className: "dsh-dschat-hintline dsh-dschat-preview-note",
            "data-tone": "warn"
          }, preview.fallbackReason) : null,
          (0, import_react4.createElement)("textarea", {
            className: "dsh-dschat-input dsh-dschat-preview",
            value: previewDraft,
            spellCheck: false,
            "aria-label": tr("transfer.preview"),
            onChange: (event) => setPreviewDraft(event.target.value)
          }),
          (0, import_react4.createElement)(
            "p",
            { className: "dsh-dschat-hintline dsh-dschat-preview-meta" },
            // Through `fmt`, like every other counted string in this panel: the
            // placeholder substitution is the panel's own, not the host's.
            fmt(tr("transfer.preview.chars"), { count: String(previewDraft.length) }),
            previewDraft.length !== preview.chars ? tr("transfer.preview.edited") : ""
          )
        ),
        stage > 0 && (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-steps" },
          (0, import_react4.createElement)(
            "div",
            { className: "dsh-dschat-prog" },
            (0, import_react4.createElement)("i", { style: { width: `${Math.min(stage, 3) / 3 * 100}%` } })
          ),
          [1, 2, 3].map((step) => (0, import_react4.createElement)(
            "div",
            { key: step, className: "dsh-dschat-step", "data-done": step < stage ? "true" : void 0 },
            step < stage ? (0, import_react4.createElement)("span", { className: "dsh-dschat-tick" }, (0, import_react4.createElement)(CheckIcon, {})) : (0, import_react4.createElement)("span", { className: "dsh-dschat-spin" }),
            (0, import_react4.createElement)(
              "span",
              null,
              step === 1 ? transferMode === "distill" ? tr("transfer.step.distill") : tr("transfer.mode.raw") : step === 2 ? tr("transfer.step.session") : tr("transfer.step.open")
            )
          ))
        ),
        (0, import_react4.createElement)(
          "div",
          { className: "dsh-dschat-pop-foot" },
          preview === void 0 ? (0, import_react4.createElement)("button", {
            type: "button",
            className: "dsh-dschat-btn dsh-dschat-btn-primary",
            disabled: previewing || transferring || viewChat === void 0,
            onClick: () => {
              void loadTransferPreview();
            }
          }, previewing ? tr("transfer.preview.building") : transferTarget === "continue" ? tr("transfer.target.continue") : tr("action.startTransfer")) : (0, import_react4.createElement)("button", {
            type: "button",
            className: "dsh-dschat-btn dsh-dschat-btn-primary",
            disabled: transferring || previewDraft.trim() === "",
            onClick: () => {
              void runTransfer();
            }
          }, tr("transfer.confirm")),
          // Rebuilding is the escape hatch for "the preview is stale but I have
          // not changed a setting" — the effect only clears one on a real change.
          preview !== void 0 && (0, import_react4.createElement)("button", {
            type: "button",
            className: "dsh-dschat-btn",
            disabled: transferring || previewing,
            onClick: () => {
              setPreview(void 0);
              setPreviewDraft("");
              void loadTransferPreview();
            }
          }, tr("transfer.preview.rebuild")),
          (0, import_react4.createElement)(
            "span",
            { className: "dsh-dschat-hintline", style: { margin: 0 } },
            preview === void 0 ? note : tr("transfer.preview.note")
          )
        )
      )
    );
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

// src/client/panel/slot.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var CrashFence = class extends import_react5.Component {
  state = {};
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[dsh-dschat] panel crashed:", error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (error === void 0) return this.props.children;
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-dschat-panel dsh-dschat-crash", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-dschat-crash-message", children: this.props.message }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: "dsh-dschat-crash-detail", children: error.message })
    ] });
  }
};
function DSchatSlot(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(CrashFence, { message: props.tt("panel.crashed"), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DSchatPanel, { ...props }) });
}

// src/client/panel/styles.ts
var PANEL_CSS = `
.dsh-dschat {
  /* Radius scale \u2014 artwork and wells only; controls are 999px pills. */
  --dschat-radius-sm: var(--dsw-radius-sm, 8px);
  --dschat-radius-md: var(--dsw-radius-md, 12px);
  --dschat-radius-lg: var(--dsw-radius-lg, 16px);
  --dschat-mono: var(--dsw-font-family-code, ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace);

  /*
   * THE accent: everything that means "on", "current", or "the primary action".
   *
   * These are the DeepSeek web app's OWN values, read out of its stylesheet
   * (fe-static.deepseek.com/chat/static/main.*.css, the two token blocks keyed
   * on body and body[data-ds-dark-theme]):
   *
   *   light  #3964fe  deepseek-500 \u2014 the web's brand-primary, its send disc
   *   dark   #5686fe  deepseek-450 \u2014 the same token one theme over
   *
   * They are literals rather than var(--dsw-static-deepseek-*) on purpose. The
   * harness ships the same ramp with two steps repainted \u2014 its 500 is #4176e6
   * and its 400 #7aaaff, which is what this panel used to paint with \u2014 so
   * reading the token back would keep exactly the deeper blue that sent the
   * reader to the web app for a reference. Only those two steps differ:
   * 50/100/200/300/450/600/800/900 are byte-identical in both sheets.
   */
  --dschat-accent: #3964fe;
  /*
   * The ink that sits ON the accent \u2014 the send arrow, the empty page's mark,
   * the citation chip.
   *
   * The web paints it label-primary-foreground, which is white in BOTH themes,
   * so this no longer flips with the accent and the dark-mode branch that used
   * to lift the disabled disc toward white is gone with it.
   */
  --dschat-on-accent: #fff;
  /*
   * The colour of WORDS on an accent TINT (lit pill, open toolbar button, the
   * primary button, citation chips): the web's brand-text, which is deepseek-500
   * in light and deepseek-400 in dark \u2014 the accent's own step in both.
   */
  --dschat-on-accent-tint: #3964fe;
  /*
   * The tint itself, and the hairline it is drawn with: the web's
   * button-ghost-active-fill and the border on its \u6DF1\u5EA6\u601D\u8003 pill \u2014
   * deepseek-50/-300 in light, deepseek-900/-600 in dark.
   *
   * Exact steps rather than "12% of the accent over whatever is behind it",
   * which was the old recipe and is not a theme: that mix darkened into every
   * grey surface it landed on, and doubled the web's own tint on white.
   */
  --dschat-tint: #edf3fe;
  --dschat-tint-line: #b7c8fe;
  /*
   * The reader's own message.
   *
   * The web paints it deepseek-50 \u2014 the palest step of the accent, not a
   * neutral grey \u2014 and leaves the assistant's turns on the bare page. In dark
   * both sheets land on bluish-850, the card layer, which is where the dark
   * block below takes it.
   */
  --dschat-bubble: #edf3fe;

  /* The four surfaces. */
  --dschat-ground: var(--dsw-static-neutral-bluish-00, #fff);
  --dschat-raised: var(--dsw-static-neutral-bluish-00, #fff);
  --dschat-filled: var(--dsw-static-neutral-bluish-75, #f1f3f5);
  --dschat-quiet: var(--dsw-static-neutral-bluish-100, #ebeef2);
  /* Hairlines, three weights: surface edge, control edge, content edge. */
  --dschat-line: var(--dsw-static-neutral-bluish-150, #e9ecf2);
  --dschat-line-2: var(--dsw-static-neutral-bluish-200, #e1e5ee);
  --dschat-line-3: var(--dsw-static-neutral-bluish-300, #cfd3d6);

  /* Three label weights, then the interaction washes. */
  --dschat-tx: var(--dsw-static-neutral-bluish-1000, #0f1115);
  --dschat-tx-2: var(--dsw-static-neutral-bluish-700, #61666b);
  /*
   * The quiet label \u2014 metadata, the placeholder, the empty rail.
   *
   * label-tertiary (#81858c), NOT the lighter bluish-500: the placeholder is
   * the first sentence a reader reads on the composer, and this step keeps the
   * 3.7:1 the panel already had where the lighter one measures 2.7:1. Nothing
   * in this sheet may make text harder to read in exchange for tidier numbers.
   */
  --dschat-tx-3: var(--dsw-static-neutral-bluish-600, #81858c);
  /*
   * The interaction washes, taken from the web's interactive-bg-* aliases: a
   * blue-tinted alpha in light (rgba(38,49,72,\xB7)) and a white alpha in dark.
   * They used to be opaque bluish-75/100 fills, which greyed every surface they
   * landed on instead of deepening it \u2014 the same "one recipe, two themes"
   * problem the tint above solves by naming both steps.
   */
  --dschat-hover: var(--dsw-alias-interactive-bg-hover, #2631480f);
  --dschat-active: var(--dsw-alias-interactive-bg-active, #2631481a);
  /* The one colour the panel borrows from the harness instead of owning. */
  --dschat-danger: var(--dsw-alias-state-error-primary, #ec1313);
  /*
   * The success tone, the second colour the panel shares with the harness (the
   * status card's \u300C\u5DF2\u767B\u5F55\u300D rows). It stays an alias rather than joining the
   * accent family: green means "working", not "primary".
   */
  --dschat-success: var(--dsw-alias-state-success-primary, #22c55e);

  /* The card's hairline shadow \u2014 the only shadow this sheet defines. */
  --dschat-card-shadow: 0 1px 2px #0f11150a, 0 6px 18px #0f11150d;

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
  color: var(--dschat-tx);
  background: var(--dschat-ground);
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
  background: var(--dsw-alias-scrollbar-bg-l2); border-radius: 99px; corner-shape: round;
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
  border-bottom: 1px solid var(--dschat-line);
}
/*
 * The header holds the product mark and the state lamp, and nothing else.
 *
 * The three window controls that used to live here \u2014 plus \u300C\u5728 Harness \u4E2D\u7EE7\u7EED\u300D
 * and \u300C\xB7\xB7\xB7\u300D \u2014 moved out: the first three into the action row above the
 * composer, and the menu onto the lamp. \u4F1A\u8BDD\u5217\u8868 briefly came back here while
 * the list was a centred dialog, and left again when it became a popover \u2014 a
 * popover opens UPWARD off its trigger, and this strip has 52px of window
 * chrome above it and a transcript below, so a button up here can only open a
 * panel DOWN over the conversation it lists. See the note on actions() in the
 * panel. What is left is a fixed 52px strip that carries the window's drag
 * region (see the panel's own note on the data-window-drag attribute) and the
 * two things a reader needs in every state: what this panel IS, and whether its
 * engine is up.
 */
.dsh-dschat-header {
  flex: none; height: 52px; display: flex; align-items: center; gap: 8px;
  padding-block: 0;
  padding-inline: max(14px, var(--dsh-frame-leading-clearance, 0px)) 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
/*
 * The product mark: the whale, then the name.
 *
 * Neither is a control. The whale used to be a button that started the engine,
 * which nobody could have guessed from a logo; the name was absent entirely
 * (the panel's own name was judged redundant against the sidebar row). With the
 * header reduced to identity + status, the name earns its place: it is the only
 * thing that says WHICH product this column is talking to, and the sidebar row
 * does not \u2014 it is called DSchat, and this header says DeepSeek Chat.
 */
.dsh-dschat-brand {
  display: flex; align-items: center; gap: 8px; flex: none;
  color: var(--dschat-accent);
}
.dsh-dschat-brand svg { display: block; }
.dsh-dschat-brand-name {
  font-size: 13.5px; font-weight: 500; line-height: 1;
  color: var(--dschat-tx); white-space: nowrap;
}

/*
 * The state lamp.
 *
 * A 7px dot in a 22px hit box \u2014 the dot is the readout, the box is the target,
 * and they are different sizes on purpose: a 7px click target would be a
 * misfire, and a 22px dot would be a button pretending to be a status light.
 *
 * FOUR COLOURS, and the mapping is chosen so that no two of them mean the same
 * thing to a reader deciding whether to wait (see lampTone in the panel):
 *
 *   green  running (ready, and breathing while thinking/streaming)
 *   amber  starting up, or up but signed out \u2014 "wait, or click me"
 *   red    the engine reported an error, which must not read as a plain stop
 *   grey   nothing is running
 *
 * The colour is never the only channel: the button's title and aria-label
 * carry the whole sentence (\u300C\u5DF2\u5C31\u7EEA \xB7 deepseek-reasoner\u300D, \u300C\u5F15\u64CE\u9519\u8BEF\uFF1A\u2026\u300D), and
 * the menu it opens repeats that sentence as its heading.
 *
 * data-tone is what the stylesheet reads, not data-phase: the five phases
 * collapse to four lamps in the panel, so the colour decision lives there and
 * the sheet only paints the result.
 */
.dsh-dschat-lamp {
  width: 22px; height: 22px; flex: none; display: grid; place-items: center;
  border: none; border-radius: 50%; corner-shape: round; background: transparent; cursor: pointer;
}
.dsh-dschat-lamp:hover { background: var(--dschat-hover); }
.dsh-dschat-lamp > i,
.dsh-dschat-lamp-dot {
  width: 7px; height: 7px; border-radius: 50%; corner-shape: round; display: block; flex: none;
  background: var(--dschat-line-3);
}
.dsh-dschat-lamp[data-tone="green"] > i,
.dsh-dschat-lamp-dot[data-tone="green"] { background: var(--dsw-alias-state-success-primary); }
.dsh-dschat-lamp[data-tone="amber"] > i,
.dsh-dschat-lamp-dot[data-tone="amber"] { background: var(--dsw-alias-state-warn-primary); }
.dsh-dschat-lamp[data-tone="red"] > i,
.dsh-dschat-lamp-dot[data-tone="red"] { background: var(--dsw-alias-state-error-primary); }
/*
 * Busy states breathe instead of changing hue: "working" is motion, not a
 * different condition, and a second green (or a blue) would be
 * indistinguishable from ready at 7px.
 */
.dsh-dschat-lamp[data-phase="thinking"] > i,
.dsh-dschat-lamp[data-phase="streaming"] > i { animation: dsh-dschat-breathe 1.6s ease-in-out infinite; }
@keyframes dsh-dschat-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) {
  .dsh-dschat-lamp > i { animation: none !important; }
}
.dsh-dschat-spacer { flex: 1; min-width: 8px; }

/*
 * The lamp's menu wrapper. The 230px panel overhangs its trigger to the LEFT \u2014
 * the lamp sits at the header's left edge, so a right-anchored panel would hang
 * off the window \u2014 with a narrow-column fallback that lets it out the other
 * side instead. Both anchor rules live in the popover block below, next to the
 * shared .dsh-dschat-pop they modify, rather than up here in the header.
 */
.dsh-dschat-lamp-wrap { position: relative; flex: none; }
/* The status sentence, repeated where the reader asked what the colour means. */
.dsh-dschat-lamp-status {
  display: flex; align-items: center; gap: 7px; margin: 0 0 4px; padding: 6px 8px 8px;
  border-bottom: 1px solid var(--dschat-line);
  font-size: 12.5px; color: var(--dschat-tx-2);
}
/*
 * THE DARK TOKEN BRANCH.
 *
 * The dark block is inserted here rather than welded into the base block above
 * because it is a THEME OVERRIDE: keeping it next to the token layer's base
 * declarations is what makes the two readable side by side.
 *
 * Every value below is the web app's own dark value for the same idea, so the
 * two sheets can be read against each other a line at a time. Note what is NOT
 * here any more: --dschat-on-accent (white in both themes now, the way the web
 * paints label-primary-foreground) and the hover/active washes (the harness's
 * interactive-bg-* aliases already carry the dark branch).
 */
body[data-ds-dark-theme] .dsh-dschat {
  --dschat-accent: #5686fe;
  --dschat-on-accent-tint: #679efe;
  --dschat-tint: #283142;
  --dschat-tint-line: #4868b2;
  --dschat-bubble: var(--dsw-static-neutral-bluish-850, #2c2c2e);

  --dschat-ground: var(--dsw-static-neutral-bluish-950, #151517);
  --dschat-raised: var(--dsw-static-neutral-bluish-875, #232324);
  --dschat-filled: var(--dsw-static-neutral-bluish-850, #2c2c2e);
  --dschat-quiet: var(--dsw-static-neutral-bluish-800, #353638);
  --dschat-line: #ffffff14;
  --dschat-line-2: #ffffff1f;
  --dschat-line-3: #ffffff29;

  --dschat-tx: var(--dsw-static-neutral-bluish-50, #f9fafb);
  --dschat-tx-2: var(--dsw-static-neutral-bluish-300, #cfd3d6);
  --dschat-tx-3: var(--dsw-static-neutral-bluish-400, #adb2b8);
  --dschat-card-shadow: 0 1px 0 #ffffff0a inset;
}


/*
 * The action row: \u4F1A\u8BDD\u5217\u8868 / \u641C\u7D22 / \u65B0\u5BF9\u8BDD on the left, \u300C\u21C4 DSH \u8FC1\u79FB\u300D at the
 * right end \u2014 directly above the composer's card, and outside it.
 *
 * All four wear the same treatment (see .dsh-dschat-tbtn below): the harness's
 * own composer buttons, whose language the input card one line down already
 * speaks. The three left buttons were 34px glyph-only squares \u2014 the web app's
 * own header controls \u2014 and that shape was the problem: a square with a glyph
 * in it is a control the reader has to already know, and this row is the ONE
 * place anyone looks for \u300C\u65B0\u5BF9\u8BDD\u300D or \u300C\u4F1A\u8BDD\u5217\u8868\u300D. Naming them costs about
 * 180px of a row that has the space.
 *
 * There is NO hairline on top of it any more. There used to be, to separate the
 * row from the transcript \u2014 but the card's own border sits eight pixels below,
 * so the pair read as two rules around nothing, and the row already acts on the
 * conversation above it through its own hover surfaces and its position. Space
 * separates them; a second line only made the composer look like two boxes.
 */
.dsh-dschat-actions {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 0 8px;
}
/*
 * The row's buttons \u2014 and the \u300C\xB7\xB7\xB7\u300D at the title bar's right end, which is the
 * same control in a different strip.
 *
 * This is the shape the row's neighbours speak: the input card directly below
 * carries \u6DF1\u5EA6\u601D\u8003 / \u667A\u80FD\u641C\u7D22 / \u9644\u4EF6 as quiet pills with a glyph and a label, and
 * the row above it should not speak a second language. So \u300CDSH \u8FC1\u79FB\u300D is no
 * longer a blue CHIP: a filled primary pill one line above a card whose own
 * primary action is a 16px accent circle was competing with the send button for
 * the reader's eye, and it was the widest, loudest thing in the row.
 *
 * Rest is therefore transparent, in label-secondary \u2014 the same as the harness's
 * own toolbar buttons \u2014 so the row reads as one strip. The accent comes back in
 * the two places it MEANS something: hover (this is a live control) and PRESSED
 * (this button owns the panel on screen now, or this toggle is on). Both are
 * tints of the accent token rather than members of the button-primary-* family,
 * which inverts with the theme and goes white in dark mode \u2014 see the note on
 * .dsh-dschat-btn-primary.
 */
.dsh-dschat-tbtn {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  height: 30px; padding: 0 11px; border-radius: 999px; corner-shape: round;
  border: 1px solid transparent; background: transparent; cursor: pointer;
  white-space: nowrap; font-size: 13px; color: var(--dschat-tx-2);
}
.dsh-dschat-tbtn:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
/*
 * PRESSED, and the pill's exact colour pair is the web's own \u6DF1\u5EA6\u601D\u8003 pill:
 * deepseek-50 on deepseek-300 in light, deepseek-900 on deepseek-600 in dark,
 * with the label on brand-text. The hover step is the label mixed back into the
 * tint, which deepens the same hue in both themes instead of darkening it in
 * one and lightening it in the other.
 */
.dsh-dschat-tbtn-on {
  background: var(--dschat-tint);
  border-color: var(--dschat-tint-line);
  color: var(--dschat-on-accent-tint);
}
.dsh-dschat-tbtn-on:hover {
  background: color-mix(in srgb, var(--dschat-on-accent-tint) 10%, var(--dschat-tint));
  color: var(--dschat-on-accent-tint);
}
/*
 * This button's own two marks: a glyph, and (on \u8FC1\u79FB) the disclosure caret.
 *
 * Both are spans rather than bare SVGs so the flex gap above can space them:
 * a bare text node beside an icon has no box to be spaced by. The caret box
 * exists to be ROTATED \u2014 it is a plain span wrapping the 11px glyph, and turning
 * it around while the panel is open is the standard "this opened upward" cue. A
 * CSS transform on an inline box does nothing, hence the display:grid.
 */
.dsh-dschat-tbtn-glyph { display: grid; place-items: center; flex: none; }
.dsh-dschat-tbtn-caret { display: grid; place-items: center; flex: none; color: var(--dschat-tx-3); }
.dsh-dschat-tbtn[aria-expanded='true'] .dsh-dschat-tbtn-caret { transform: rotate(180deg); }
@media (prefers-reduced-motion: no-preference) {
  .dsh-dschat-tbtn-caret { transition: transform .16s ease; }
}
/* A disabled toolbar button keeps its glyph and loses its colour. */
.dsh-dschat-tbtn:disabled { opacity: .5; cursor: not-allowed; background: transparent; border-color: transparent; }
/* ---------- buttons ---------- */
.dsh-dschat-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
  border-radius: var(--dschat-radius-sm); cursor: pointer; white-space: nowrap; font-size: 13px;
  border: 1px solid transparent; background: transparent; color: var(--dschat-tx-2);
}
.dsh-dschat-btn:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
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
 * button-primary-fill resolves to brand-primary, which the HARNESS repaints as
 * plain ink: near-white #f9fafb in dark mode, near-black in light mode. In dark
 * mode that made the button \u2014 and the menu it opens \u2014 the brightest thing on
 * the panel, the reported "\u592A\u767D\u4E86". Both ends of that family are inverted
 * relative to the accent, so no pairing of primary-fill / primary-hover /
 * primary-dimmed with label-primary-foreground can stay on the blue accent in
 * both themes. (The web app's own brand-primary is the blue, not the ink; the
 * harness is the one that deviates.) So this button takes the same tint pair
 * the lit \u6DF1\u5EA6\u601D\u8003 pill takes, which is correct in both themes by construction.
 */
.dsh-dschat-btn-primary {
  background: var(--dschat-tint);
  border-color: var(--dschat-tint-line);
  color: var(--dschat-on-accent-tint);
  font-weight: 500; height: 30px; padding: 0 12px; border-radius: var(--dschat-radius-md);
}
.dsh-dschat-btn-primary:hover {
  background: color-mix(in srgb, var(--dschat-on-accent-tint) 10%, var(--dschat-tint));
  color: var(--dschat-on-accent-tint);
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
  background: color-mix(in srgb, var(--dschat-tint) 55%, transparent);
  border-color: color-mix(in srgb, var(--dschat-tint-line) 55%, transparent);
  cursor: not-allowed;
}
.dsh-dschat-btn-ghost { border-color: var(--dschat-line-2); }
/* ---------- body: the transcript column ---------- */
/*
 * One column, the full width of the panel.
 *
 * It used to be two: a 238px rail and the chat beside it, which left the
 * transcript 382px of a 620px panel (measured) for as long as the panel was
 * open. The rail is gone \u2014 \u4F1A\u8BDD\u5217\u8868 is a popover over this column now (see
 * sessionsPopover in the panel) \u2014 so the transcript's width is the panel's
 * width, and the only thing that eats into it is the question navigator's own
 * 34px column, which appears only once the reader has asked two questions.
 */
.dsh-dschat-body { flex: 1; min-height: 0; display: flex; position: relative; }
/* ---------- \u4F1A\u8BDD\u5217\u8868, as a popover ---------- */
/*
 * The list panel: \u8FC1\u79FB's material with a LIST's proportions.
 *
 * Width and surface come from .dsh-dschat-pop above (348px, the shared
 * floating material, the shared elevation) and the direction from the row's own
 * .dsh-dschat-pop-up rule \u2014 this class only decides what the panel's INSIDE
 * is, which is the one thing the form-shaped \u8FC1\u79FB panel does not answer:
 *
 *   \xB7 a column, so the search box, the rows and the footer stack;
 *   \xB7 a CEILING and no height, so the panel is as tall as its list and no
 *     taller. A fixed-height panel was tried first and a three-row list left
 *     ~150px of dead surface under the last row (measured on the render). The
 *     ceiling is what the trigger's own position can afford: .dsh-dschat-pop
 *     already caps at 100% of the trigger's top edge, so a long list scrolls
 *     instead of opening off the top of the panel \u2014 which is the "adapts to the
 *     window" half of the same requirement.
 *   \xB7 hidden overflow, so the desktop shell's own scrollbar-gutter cannot give
 *     this panel a scrollbar of its own (see the sheet's first section).
 *
 * The padding is the popover's own 12px (declared in .dsh-dschat-pop), so
 * there is none here \u2014 adding a second one would inset this panel twice against
 * the \u8FC1\u79FB panel beside it.
 */
.dsh-dschat-listpop { display: flex; flex-direction: column; overflow: hidden; }
/*
 * Anchored to the LEADING edge of the trigger, unlike \u8FC1\u79FB.
 *
 * .dsh-dschat-pop defaults to right: 0, which is right for a trigger at the
 * right end of the row (\u8FC1\u79FB) and wrong at the left end: anchored right, this
 * 348px panel reached 128px right of the button and 220px PAST the panel's own
 * left edge \u2014 measured on the render, where it was clipped by the window and
 * three rows of the list were unreachable. Leading-edge anchoring puts it from
 * the button's left edge rightward instead, and 348 + 26px of inset fits inside
 * any column this panel can be, which is why this needs no narrow-width escape
 * hatch the way the right-anchored menus do.
 */
.dsh-dschat-pop-wrap > .dsh-dschat-listpop { right: auto; left: 0; }
/* The search box, first, full width \u2014 it filters the rows directly below it. */
.dsh-dschat-listpop .dsh-dschat-search { flex: none; margin: 0 0 8px; }
/*
 * The rows: the panel's only scrolling child.
 *
 * min-height: 0 overrides the flex default (a flex item's automatic minimum
 * size is its content), which is what lets a long list reach the ceiling and
 * scroll inside it instead of stretching the panel past the monitor. There is
 * deliberately NO floor: a fixed 96px one put an empty band under a two-row
 * list. The empty state has padding of its own (see .dsh-dschat-hint-empty).
 */
.dsh-dschat-listpop .dsh-dschat-list {
  flex: 1; min-height: 0; overflow: auto;
  display: flex; flex-direction: column; gap: 1px; padding: 2px;
}
/*
 * The footer: \u300C\u4ECE\u7F51\u9875\u540C\u6B65\u300D on the left, the destructive clear at the right end.
 *
 * A hairline separates it from the rows because it is not one of them \u2014 it acts
 * on the LIST rather than on a conversation in it \u2014 and it is flex: none so it
 * stays put while the rows scroll behind it.
 */
.dsh-dschat-listpop-foot {
  flex: none; display: flex; gap: 6px; padding: 10px 2px 0; margin-top: 8px;
  border-top: 1px solid var(--dschat-line);
}
/* ---------- search box (shared: the list popover owns the only one) ---------- */
.dsh-dschat-search { position: relative; margin: 0 2px 8px; }
.dsh-dschat-search input {
  width: 100%; height: 30px; padding: 0 30px 0 28px; font: inherit; font-size: 13px; outline: none;
  color: var(--dschat-tx); background: var(--dschat-filled);
  border: 1px solid transparent; border-radius: var(--dschat-radius-sm);
}
.dsh-dschat-search input::placeholder { color: var(--dschat-tx-3); }
.dsh-dschat-search input:focus {
  border-color: color-mix(in srgb, var(--dschat-accent) 46%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dschat-accent) 12%, transparent);
}
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
  background: transparent; cursor: pointer; color: var(--dschat-tx-3);
}
.dsh-dschat-search-clear:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
.dsh-dschat-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 1px; padding: 2px; }
.dsh-dschat-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 8px;
  border-radius: var(--dschat-radius-sm); cursor: pointer;
}
.dsh-dschat-item:hover { background: var(--dschat-hover); }
.dsh-dschat-item[data-active] { background: color-mix(in srgb, var(--dschat-accent) 10%, transparent); }
.dsh-dschat-item-main { min-width: 0; flex: 1; }
.dsh-dschat-item-title {
  font-size: 13px; color: var(--dschat-tx);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-dschat-item[data-active] .dsh-dschat-item-title { font-weight: 600; }
/*
 * One line, always. The row's action buttons appear on hover and take ~70px out
 * of the title column, and this line used to WRAP when that happened \u2014 the row
 * grew by a line every time the pointer crossed it, which moved every row below
 * it. Truncating is the same information in a stable box.
 */
.dsh-dschat-item-meta {
  font-size: 11px; color: var(--dschat-tx-3); font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-dschat-item-acts { display: none; gap: 2px; flex: none; }
.dsh-dschat-item:hover .dsh-dschat-item-acts { display: flex; }
.dsh-dschat-mini {
  width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; cursor: pointer;
  border: none; background: transparent; color: var(--dschat-tx-3);
}
.dsh-dschat-mini:hover { background: var(--dschat-active); color: var(--dschat-tx); }
.dsh-dschat-mini-danger:hover { background: color-mix(in srgb, var(--dschat-danger) 14%, transparent); color: var(--dschat-danger); }
.dsh-dschat-hint-empty { padding: 14px 8px; font-size: 12px; color: var(--dschat-tx-3); }

/* ---------- question navigator (right edge) ---------- */
/*
 * The column the transcript and its two floating pieces share.
 *
 * The navigator and the \u300C\u2193 \u6700\u65B0\u300D pill are positioned against THIS box rather
 * than against the chat column: the chat column also holds the composer and the
 * phase line, so centring the navigator in it would drag the ticks down towards
 * the input, and pinning the pill to its bottom would put the pill ON the
 * composer. An explicit wrapper makes "the visible transcript" a box that can be
 * measured, which is what both of them actually mean.
 */
.dsh-dschat-threadbox { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex; }
/*
 * \u63D0\u95EE\u5BFC\u822A: the conversation's questions, one tick each.
 *
 * Collapsed it is the page's own capsule \u2014 34px wide, 16px radius, a translucent
 * surface with a hairline, vertically centred against the transcript \u2014 because
 * that is the shape DeepSeek's own page uses for the same control and a reader
 * who knows the page should not have to learn a second one. Ticks are 8x2px with
 * a 4px radius on a 30px pitch, the current one 12x3px in the accent colour;
 * hovering a tick widens it, exactly as the page does.
 *
 * Expanded (data-open) the SAME list becomes a 268px card: the number and the
 * question text appear, and the ticks move to the right edge. One list in the
 * DOM, two layouts \u2014 a second tick-only list would have to be kept in sync with
 * this one forever, and would take the tab stops with it.
 *
 * The rows are 30px in BOTH states, and there is no header, and both of those
 * are load-bearing rather than stylistic. Growing the rows \u2014 or revealing a line
 * of chrome above them \u2014 moves every row down at the exact moment the pointer
 * arrives, so the row the reader aimed at slides out from under the cursor and
 * the click lands on whatever took its place. The page's own control has the
 * same property, measured: its ticks sit on the same 30px pitch before and after
 * it opens. So this list only ever grows SIDEWAYS, and the tick the pointer is
 * on stays exactly where it was. (The count moved to the nav element's aria-label and
 * its tooltip.)
 */
.dsh-dschat-navwrap { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 6; }
.dsh-dschat-nav {
  display: flex; flex-direction: column;
  width: 34px; padding: 14px 0; border-radius: 16px;
  border: 1px solid var(--dschat-line);
  background: var(--dschat-surface);
  backdrop-filter: blur(8px);
  transition: width .16s ease;
}
.dsh-dschat-nav-list { display: flex; flex-direction: column; }
.dsh-dschat-nav-item {
  display: flex; align-items: center; width: 100%; height: 30px; padding: 0;
  border: none; border-radius: 8px; background: transparent; cursor: pointer;
  font: inherit; font-size: 12px; color: var(--dschat-tx-3); text-align: left;
}
.dsh-dschat-nav-idx, .dsh-dschat-nav-text { display: none; }
.dsh-dschat-nav-tick {
  display: block; width: 8px; height: 2px; margin: 0 auto; border-radius: 4px;
  background: var(--dschat-line-3);
}
.dsh-dschat-nav-item:hover .dsh-dschat-nav-tick { width: 16px; background: var(--dschat-tx-2); }
.dsh-dschat-nav-item:focus-visible { outline: none; }
.dsh-dschat-nav-item:focus-visible .dsh-dschat-nav-tick { width: 16px; background: var(--dschat-tx); }
.dsh-dschat-nav-item[data-active='true'] .dsh-dschat-nav-tick {
  width: 12px; height: 3px; background: var(--dschat-accent);
}
/* The expanded card. */
.dsh-dschat-nav[data-open='true'] {
  width: 268px; padding: 6px;
  background: var(--dschat-surface);
  box-shadow: 0 10px 30px #0000002e, 0 2px 6px #00000014;
}
.dsh-dschat-nav[data-open='true'] .dsh-dschat-nav-item { padding: 0 8px; gap: 8px; }
.dsh-dschat-nav[data-open='true'] .dsh-dschat-nav-idx {
  display: block; flex: none; width: 14px; text-align: right;
  font-size: 10px; font-variant-numeric: tabular-nums;
}
.dsh-dschat-nav[data-open='true'] .dsh-dschat-nav-text {
  display: block; flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-dschat-nav[data-open='true'] .dsh-dschat-nav-tick { margin: 0; flex: none; }
.dsh-dschat-nav[data-open='true'] .dsh-dschat-nav-item:hover {
  background: var(--dschat-hover); color: var(--dschat-tx);
}
.dsh-dschat-nav[data-open='true'] .dsh-dschat-nav-item[data-active='true'] {
  color: var(--dschat-tx); font-weight: 500;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-dschat-nav { transition: none; }
}
/*
 * \u9884\u7559\u53F3\u4FA7\u7559\u767D: while the navigator is on screen the reading column keeps a
 * column-shaped hole on its right. Overlaying the ticks on the text was the
 * first draft and it is not survivable on a 400px-wide panel \u2014 the capsule sat
 * on the last three characters of every line.
 */
.dsh-dschat-thread[data-nav='true'] .dsh-dschat-thread-inner { padding-right: 58px; }
/*
 * \u300C\u2193 \u6700\u65B0\u300D: the way back to the end.
 *
 * Shown only while the reader is NOT at the end, and floating a little above the
 * composer so it never covers the control it sits next to.
 */
.dsh-dschat-latestwrap { position: absolute; right: 22px; bottom: 14px; z-index: 5; }
.dsh-dschat-latest {
  display: inline-flex; align-items: center; height: 30px; padding: 0 13px;
  border-radius: 999px; corner-shape: round; cursor: pointer; font: inherit; font-size: 12.5px;
  border: 1px solid var(--dschat-line-2);
  background: var(--dschat-surface); color: var(--dschat-tx-2);
  box-shadow: 0 4px 14px #00000024;
}
.dsh-dschat-latest:hover { color: var(--dschat-tx); background: var(--dschat-hover); }

/* ---------- chat column ---------- */
.dsh-dschat-chat { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.dsh-dschat-thread { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 22px 0 8px; }
.dsh-dschat-thread-inner {
  max-width: 760px; margin: 0 auto; padding: 0 26px;
  display: flex; flex-direction: column; gap: 20px;
}
.dsh-dschat-day { text-align: center; font-size: 11px; color: var(--dschat-tx-3); }

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
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--dschat-accent) 18%, transparent);
  animation: dsh-dschat-jump 1.8s ease-out forwards;
}
@keyframes dsh-dschat-jump {
  0% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--dschat-accent) 30%, transparent); }
  100% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--dschat-accent) 0%, transparent); }
}
.dsh-dschat-msg[data-role="user"] { align-items: flex-end; }
.dsh-dschat-msg-head { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dschat-tx-3); }
.dsh-dschat-msg[data-role="user"] .dsh-dschat-msg-head { flex-direction: row-reverse; }
.dsh-dschat-msg-who { font-weight: 600; color: var(--dschat-tx-2); }
.dsh-dschat-msg-body { font-size: 14px; line-height: 1.72; min-width: 0; color: var(--dschat-tx); }
/* The bubble's width cap lives on the wrapper, so it is a share of the MESSAGE
   width rather than of a shrink-to-fit parent (which would be circular). */
.dsh-dschat-msg[data-role="user"] .dsh-dschat-msg-line { max-width: 78%; }
/*
 * The reader's own turn, painted the way the web app paints it: the palest step
 * of the accent (deepseek-50 in light, bluish-850 in dark) with NO border, and
 * the assistant's turns left on the bare page. It used to be a grey card with a
 * hairline, which is a different idea \u2014 "a panel" rather than "you said this" \u2014
 * and it was the one large grey object in a palette that is otherwise blue.
 */
.dsh-dschat-msg[data-role="user"] .dsh-dschat-msg-body {
  max-width: 100%; padding: 10px 14px; border-radius: var(--dschat-radius-lg);
  border-bottom-right-radius: 6px;
  background: var(--dschat-bubble); border: none;
  color: var(--dschat-tx);
}
.dsh-dschat-msg-body > div > *:first-child { margin-top: 0; }
.dsh-dschat-msg-body > div > *:last-child { margin-bottom: 0; }
.dsh-dschat-msg-body p { margin: 0 0 10px; }
.dsh-dschat-msg-body ul, .dsh-dschat-msg-body ol { margin: 0 0 10px; padding-left: 22px; }
.dsh-dschat-msg-body li { margin: 3px 0; }
.dsh-dschat-msg-body li::marker { color: var(--dschat-tx-3); }
.dsh-dschat-msg-body strong { font-weight: 600; }
.dsh-dschat-msg-body em { font-style: italic; }
.dsh-dschat-msg-body code {
  font-family: var(--dschat-mono); font-size: .875em; padding: 1px 5px; border-radius: 6px;
  background: var(--dschat-filled); border: 1px solid var(--dschat-line);
}
.dsh-dschat-msg-body a { color: var(--dschat-accent); text-decoration: none; }
.dsh-dschat-msg-body a:hover { text-decoration: underline; }
.dsh-dschat-msg-body blockquote {
  margin: 0 0 10px; padding: 2px 0 2px 12px; color: var(--dschat-tx-2);
  border-left: 2px solid var(--dschat-line-3);
}
.dsh-dschat-msg-body h1, .dsh-dschat-msg-body h2, .dsh-dschat-msg-body h3,
.dsh-dschat-msg-body h4, .dsh-dschat-msg-body h5, .dsh-dschat-msg-body h6 {
  margin: 14px 0 8px; font-weight: 600; line-height: 1.4;
}
.dsh-dschat-msg-body h1 { font-size: 18px; } .dsh-dschat-msg-body h2 { font-size: 16px; }
.dsh-dschat-msg-body h3 { font-size: 15px; } .dsh-dschat-msg-body h4,
.dsh-dschat-msg-body h5, .dsh-dschat-msg-body h6 { font-size: 14px; }
.dsh-dschat-msg-body hr { border: none; border-top: 1px solid var(--dschat-line); margin: 14px 0; }
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
  background: var(--dschat-filled); border: 1px solid var(--dschat-line);
}
.dsh-dschat-think[data-live="true"] {
  border-color: color-mix(in srgb, var(--dschat-accent) 32%, transparent);
  background: color-mix(in srgb, var(--dschat-accent) 7%, var(--dschat-filled));
}
.dsh-dschat-think-head {
  display: flex; align-items: center; gap: 7px; width: 100%; padding: 7px 10px;
  border: none; background: transparent; cursor: pointer; text-align: left; font-size: 12.5px;
  color: var(--dschat-tx-2);
}
.dsh-dschat-think-head:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
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
  color: var(--dsw-alias-label-deep-diving, var(--dschat-accent));
  background-image: linear-gradient(90deg,
    var(--dsw-alias-label-deep-diving-shimmer, var(--dschat-accent)),
    var(--dsw-alias-label-deep-diving, var(--dschat-accent)),
    var(--dsw-alias-label-deep-diving-shimmer, var(--dschat-accent)));
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: dsh-dschat-shimmer 2.2s linear infinite;
}
@keyframes dsh-dschat-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
.dsh-dschat-think-live-clip { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.dsh-dschat-think-live-tail {
  display: inline-block; white-space: nowrap; will-change: transform;
  color: var(--dschat-tx-2);
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
  font-size: 13px; line-height: 1.68; color: var(--dschat-tx-2);
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
  padding: 0 4px; border-radius: 5px; border: 1px solid var(--dschat-tint-line); font-size: 10px; font-weight: 600;
  background: var(--dschat-tint); color: var(--dschat-on-accent-tint);
  text-decoration: none; cursor: default;
}
.dsh-dschat-msg-body a.dsh-dschat-citation { cursor: pointer; }
.dsh-dschat-msg-body a.dsh-dschat-citation:hover {
  background: color-mix(in srgb, var(--dschat-on-accent-tint) 10%, var(--dschat-tint));
  border-color: var(--dschat-on-accent-tint);
  color: var(--dschat-on-accent-tint);
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
  background: var(--dschat-filled); border: 1px solid var(--dschat-line);
}
.dsh-dschat-sources-head {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 10px;
  border: none; background: transparent; cursor: pointer; text-align: left;
  font-size: 12px; font-weight: 600; color: var(--dschat-tx-2);
}
.dsh-dschat-sources-head:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
.dsh-dschat-sources[data-open] .dsh-dschat-sources-head { border-bottom: 1px solid var(--dschat-line); }
.dsh-dschat-sources ol {
  margin: 0; padding: 8px 10px; list-style: none;
  display: flex; flex-direction: column; gap: 4px;
}
.dsh-dschat-sources li { display: flex; align-items: baseline; gap: 6px; font-size: 12px; line-height: 1.5; }
.dsh-dschat-source-no {
  flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px;
  padding: 0 4px; border-radius: 5px; font-size: 10px; font-weight: 600;
  background: var(--dschat-quiet); color: var(--dschat-tx-2);
}
.dsh-dschat-sources a { color: var(--dschat-accent); text-decoration: none; }
.dsh-dschat-sources a:hover { text-decoration: underline; }
.dsh-dschat-table-wrap { margin: 0 0 10px; overflow-x: auto; }
.dsh-dschat-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dsh-dschat-table th, .dsh-dschat-table td {
  border: 1px solid var(--dschat-line); padding: 6px 10px; text-align: left;
}
.dsh-dschat-table th { background: var(--dschat-filled); font-weight: 600; }

/* code block with its own banner + copy action */
.dsh-dschat-code {
  margin: 0 0 10px; border-radius: var(--dschat-radius-md); overflow: hidden;
  border: .5px solid var(--dschat-line); background: var(--dschat-filled);
}
.dsh-dschat-code-bar {
  display: flex; align-items: center; gap: 8px; padding: 5px 10px;
  background: var(--dschat-quiet);
  font-family: var(--dschat-mono); font-size: 11px; color: var(--dschat-tx-2);
}
.dsh-dschat-code-copy {
  display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 6px;
  border-radius: 5px; border: none; background: transparent; cursor: pointer; font-size: 11px;
  color: var(--dschat-tx-2);
}
.dsh-dschat-code-copy:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
.dsh-dschat-code pre { margin: 0; padding: 12px 14px; overflow: auto; font-family: var(--dschat-mono); font-size: 12.5px; line-height: 1.6; color: var(--dschat-tx); }

/* images */
.dsh-dschat-imgs { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 10px; }

/* streaming caret + errors */
.dsh-dschat-caret {
  display: inline-block; width: 7px; height: 15px; margin-left: 2px; vertical-align: -2px;
  background: var(--dschat-tx); animation: dsh-dschat-blink 1s steps(1) infinite;
}
@keyframes dsh-dschat-blink { 50% { opacity: 0; } }
.dsh-dschat-spin {
  width: 12px; height: 12px; border-radius: 50%; corner-shape: round; flex: none;
  border: 1.6px solid color-mix(in srgb, var(--dschat-accent) 30%, transparent);
  border-top-color: var(--dschat-accent);
  animation: dsh-dschat-rot .7s linear infinite;
}
@keyframes dsh-dschat-rot { to { transform: rotate(360deg); } }
.dsh-dschat-err {
  display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 10px;
  border-radius: var(--dschat-radius-sm); font-size: 13px;
  background: color-mix(in srgb, var(--dschat-danger) 8%, transparent);
  color: var(--dschat-danger);
  border: 1px solid color-mix(in srgb, var(--dschat-danger) 25%, transparent);
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
  background: transparent; cursor: pointer; color: var(--dschat-tx-2);
}
.dsh-dschat-msg-acts button:hover { background: var(--dschat-hover); color: var(--dschat-tx); }

/* empty state */
.dsh-dschat-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; text-align: center; padding: 56px 32px;
}
.dsh-dschat-empty-mark {
  width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; margin-bottom: 2px;
  background: var(--dschat-accent); color: var(--dschat-on-accent);
}
.dsh-dschat-empty h3 { margin: 0; font-size: 17px; font-weight: 600; color: var(--dschat-tx); }
.dsh-dschat-empty p { margin: 0; max-width: 400px; font-size: 13px; color: var(--dschat-tx-2); }
/*
 * The same block, worn by a conversation whose body is still in flight.
 *
 * It shares the layout and drops the volume: this is a status line for a
 * conversation that exists, not the invitation to start one, and the mark is
 * dimmed so the two cannot be mistaken for each other in a screenshot either.
 * See the thread() branch in the panel for which one is picked.
 */
.dsh-dschat-loading .dsh-dschat-empty-mark { opacity: .5; }
.dsh-dschat-loading h3 { font-size: 14px; font-weight: 500; color: var(--dschat-tx-2); }
.dsh-dschat-kbd {
  display: inline-flex; align-items: center; height: 19px; padding: 0 5px; border-radius: 5px;
  font-family: var(--dschat-mono); font-size: 11px; color: var(--dschat-tx-2);
  background: var(--dschat-filled); border: 1px solid var(--dschat-line);
}

/*
 * \u6216\u8005\u8BD5\u8BD5: the prompt chips under the invitation.
 *
 * Same 30px/999px shape as every other text control in the panel (see
 * .dsh-dschat-tbtn), so the empty page speaks the composer's language; the
 * difference is only WHERE the accent sits. These are quiet at rest \u2014 a
 * hairline and the secondary label \u2014 and take the accent on hover, which is the
 * moment they reveal themselves as things to press. Nothing here is a primary
 * action: the send circle is, and three blue pills above it would compete with
 * it for the reader's eye.
 *
 * The list is as wide as the column allows and centred, so the three sentences
 * read as one block rather than a left-aligned list of links, and it wraps to a
 * second line instead of overflowing on a narrow panel.
 */
.dsh-dschat-empty-try { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 6px; }
.dsh-dschat-empty-try-label { font-size: 11px; letter-spacing: .04em; color: var(--dschat-tx-3); }
.dsh-dschat-empty-try-list {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 460px;
}
.dsh-dschat-try {
  display: inline-flex; align-items: center; height: 30px; padding: 0 12px;
  border-radius: 999px; corner-shape: round; cursor: pointer; white-space: nowrap;
  font-size: 12.5px; color: var(--dschat-tx-2);
  background: transparent; border: 1px solid var(--dschat-line-2);
}
.dsh-dschat-try:hover {
  background: color-mix(in srgb, var(--dschat-accent) 8%, transparent);
  border-color: color-mix(in srgb, var(--dschat-accent) 32%, transparent);
  color: var(--dschat-tx);
}
/*
 * The key reference, demoted below the invitation it belongs to.
 *
 * It keeps the chips' own gap as its top margin, because that is the distance
 * between the two; the keycaps themselves are unchanged \u2014 a reader who wants
 * the shortcut scans for the boxes, and they should not change shape depending
 * on which state the page is in.
 */
.dsh-dschat-empty-keys {
  margin: 2px 0 0; display: flex; gap: 6px; align-items: center; justify-content: center; font-size: 12px;
}

/* composer */
.dsh-dschat-composer { flex: none; padding: 8px 26px 4px; }
.dsh-dschat-composer-inner { max-width: 760px; margin: 0 auto; }
/*
 * The input card: the panel's own radius scale, the page's hairline, and a
 * two-part shadow that is almost nothing \u2014 rgba(0,0,0,.02) 0 4px 12px plus a
 * hint of blue underneath.
 *
 * The radius used to be the page's 24px, written out because the panel's own
 * scale tops out at 20px ('--dschat-radius-xl'). That was the wrong trade for
 * THIS panel: the card is the one surface in the composer, and a radius no other
 * box on screen shares made it read as a widget borrowed from somewhere else \u2014
 * most visibly against the 8px conversation rows a few pixels to its left and
 * the action row directly above it, whose controls are pills. One radius family
 * is what "the same interface" looks like, so the card now sits ON the scale
 * rather than beside it.
 */
.dsh-dschat-card {
  border: 1px solid var(--dschat-line-2);
  border-radius: var(--dschat-radius-lg);
  background: var(--dschat-raised);
  box-shadow: var(--dschat-card-shadow);
  transition: border-color .12s ease, background-color .12s ease;
}

.dsh-dschat-card:focus-within {
  border-color: color-mix(in srgb, var(--dschat-accent) 52%, var(--dschat-line-2));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dschat-accent) 12%, transparent);
}
.dsh-dschat-card.dsh-dschat-dragging {
  border-color: var(--dschat-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dschat-accent) 16%, transparent);
}
.dsh-dschat-dropline {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 10px 0; font-size: 12px; color: var(--dschat-accent);
}
.dsh-dschat-attachments { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 10px 0; }
.dsh-dschat-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 4px 0 8px;
  border-radius: var(--dschat-radius-sm); font-size: 12px;
  background: var(--dschat-filled); border: 1px solid var(--dschat-line);
  max-width: 260px;
}
.dsh-dschat-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-dschat-chip button {
  width: 18px; height: 18px; display: grid; place-items: center; border: none; border-radius: 4px;
  background: transparent; cursor: pointer; color: var(--dschat-tx-3); flex: none;
}
.dsh-dschat-chip button:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
/*
 * The one control on a HISTORY message's attachment chip: an anchor to the
 * host's read-back route.
 *
 * Only images get it \u2014 a 24 MiB screenshot filed under a paperclip is a file
 * the reader cannot check without leaving the panel, and opening it is exactly
 * what they were about to do by hand with the path. Text and PDF chips keep
 * their name and nothing else, because opening one in a browser tab is not the
 * same gesture.
 */
.dsh-dschat-chip-view {
  width: 18px; height: 18px; display: grid; place-items: center; border-radius: 4px; flex: none;
  color: var(--dschat-tx-3); text-decoration: none; font-size: 11px; line-height: 1;
}
.dsh-dschat-chip-view:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
/*
 * \u56FE\u7247\u9644\u4EF6\uFF1Athe thumbnail in the composer.
 *
 * The picture IS the chip, so this box is sized rather than hugged: an image's
 * intrinsic size varies from a 12px favicon to a 6000px screenshot, and a row
 * of attachments that resized itself per file would push the textarea around on
 * every paste. object-fit: cover crops instead, which keeps the 56px square
 * meaningful as "what this is" rather than "all of it".
 *
 * The remove button floats over the top-right corner, so it does not take a
 * column of width from the picture. It gets a dark scrim because the corner it
 * sits on can be any colour the reader attached.
 */
.dsh-dschat-thumb {
  position: relative; width: 56px; height: 56px; flex: none;
  border-radius: var(--dschat-radius-sm); overflow: hidden;
  border: 1px solid var(--dschat-line);
  background: var(--dschat-filled);
}
.dsh-dschat-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dsh-dschat-thumb button {
  position: absolute; top: 2px; right: 2px; width: 17px; height: 17px; padding: 0;
  display: grid; place-items: center; border: none; border-radius: 50%; corner-shape: round; cursor: pointer;
  background: color-mix(in srgb, #000 58%, transparent); color: #fff;
  font-size: 10px; line-height: 1; opacity: 0;
}
/* Visible on hover, and on keyboard focus, so it is reachable without a mouse. */
.dsh-dschat-thumb:hover button,
.dsh-dschat-thumb button:focus-visible { opacity: 1; }
.dsh-dschat-thumb button:hover { background: color-mix(in srgb, #000 78%, transparent); }
/*
 * The composer's height is driven by the panel (see resizeComposer): it is set
 * to the content's own height, clamped to the max-height below. Both numbers
 * here are therefore load-bearing \u2014 min-height is what an EMPTY box measures
 * (nothing ever sets an inline height for it: scrollHeight of an empty
 * textarea is one line, and the panel would shrink the box back), max-height is
 * where the panel stops growing it and the textarea starts scrolling instead.
 * An explicit overflow-y makes that second half intentional rather than a UA
 * default.
 *
 * min-height was 46px, and 46 is the number that produced the complaint this
 * rule exists to answer: 12px of top padding + 22.4px of line + 4px of bottom
 * padding leaves exactly ONE line of text visible (measured: 1.3 lines, i.e.
 * the descenders of line two clipped by the scroll box). A reader writing a
 * paragraph did it through a slit, and every re-read of what they had written
 * was a scroll.
 *
 * 84px is THREE lines: 12 + 3\xD722.4 + 4 = 83.2, rounded up so the third line's
 * descenders are inside the box rather than at its edge. Three is the smallest
 * number that shows a sentence the reader can still see the start of, and it
 * keeps the composer a text field rather than a document: the card ends up
 * ~134px tall in a 620px-wide panel, roughly a fifth of it, and everything
 * above that (the transcript) keeps the rest.
 *
 * max-height moved with it, 180 \u2192 220, so the box keeps growing for about the
 * same number of lines before scrolling instead of gaining a floor and losing
 * the range above it. The two numbers live in two files on purpose \u2014 this cap
 * is what the browser enforces, COMPOSER_MAX_HEIGHT is what the panel measures
 * against \u2014 and they must be changed together.
 */
.dsh-dschat-input {
  display: block; width: 100%; resize: none; border: none; outline: none; background: transparent;
  font: inherit; font-size: 14px; line-height: 1.6; color: var(--dschat-tx);
  padding: 12px 14px 4px; min-height: 84px; max-height: 220px; overflow-y: auto;
}
.dsh-dschat-input::placeholder { color: var(--dschat-tx-3); }
/*
 * The engine is down: the field still TYPES, so it must not look broken \u2014 but
 * the reader should also know that what they write will start a browser.
 *
 * The marker is an attribute on the card (data-engine="off"), not a state of
 * the textarea. The textarea no longer has a read-only state to key off: it is
 * an ordinary editable field in every engine state (:read-only used to carry
 * this and no longer exists), and an accent-tinted PLACEHOLDER is the whole
 * affordance \u2014 no pointer cursor, because a text field's cursor is the text
 * cursor, and no "start me" wash on the card, because the card is not a button.
 *
 * The wash itself is kept at a whisper for the one thing it still says: the
 * accent hairline marks the field as "this will start the page for you".
 */
.dsh-dschat-card[data-engine="off"] .dsh-dschat-input::placeholder { color: color-mix(in srgb, var(--dschat-accent) 82%, var(--dschat-tx)); }
/*
 * It was a 5% mix of the accent over the card in both themes, and 5% of a dark
 * navy over a #232324 card is not a wash \u2014 it is a bruise: the card went muddy
 * grey-blue and the accent it was supposed to advertise disappeared into it.
 * Dark mode therefore mixes the accent into the card's own layer at the same 5%
 * and then LIFTS the result toward white, so the tint survives the dark base
 * instead of being swallowed by it. The border does the advertising in the dark
 * branch anyway \u2014 an accent hairline is legible where a 5% fill is not.
 */
.dsh-dschat-card[data-engine="off"] {
  background: color-mix(in srgb, var(--dschat-accent) 4%, var(--dschat-raised));
  border-color: color-mix(in srgb, var(--dschat-accent) 26%, var(--dschat-line-2));
}
/*
 * The queue: messages typed while the previous turn is still generating.
 *
 * Between the box and the tool row, one line each, dimmed \u2014 they are not part
 * of the conversation yet, and they must not look like they are. The row is
 * capped so a long paragraph does not push the tool row off screen; the whole
 * text is in the tooltip and back in the box the moment it is cancelled.
 */
.dsh-dschat-queue { display: flex; flex-direction: column; gap: 4px; padding: 0 14px 4px; }
.dsh-dschat-queue-item {
  display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 4px 0 8px;
  border-radius: var(--dschat-radius-sm); font-size: 12px;
  background: var(--dschat-filled); border: 1px dashed var(--dschat-line-2);
  color: var(--dschat-tx-2);
}
.dsh-dschat-queue-mark { flex: none; font-size: 11px; }
.dsh-dschat-queue-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-dschat-queue-files { flex: none; color: var(--dschat-tx-3); }
.dsh-dschat-queue-item button {
  width: 18px; height: 18px; flex: none; display: grid; place-items: center; border: none; border-radius: 4px;
  background: transparent; cursor: pointer; color: var(--dschat-tx-3);
}
.dsh-dschat-queue-item button:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
.dsh-dschat-queue-note { padding-left: 2px; font-size: 11.5px; color: var(--dschat-tx-3); }
/*
 * The composer's tool row: a 4px gap between controls and 30px-tall controls in
 * it \u2014 the SAME height and the same pill/circle shapes as the action row eight
 * pixels above, which is the whole point (the page's own 34px was a second
 * scale living inside one composer). The padding is 8/10/10 rather than a flat
 * 12 so the card, which no longer needs to look like a search bar, closes up
 * around its contents.
 *
 * 'flex-wrap' is off deliberately \u2014 the row's contents are fixed (two pills, a
 * paperclip, the send circle) and wrapping the send button onto a second line
 * on a narrow panel would be worse than letting the spacer collapse.
 */
.dsh-dschat-tools { display: flex; align-items: center; gap: 4px; padding: 8px 10px 10px; }
/* The Finder input is clicked from the tool row; it must never take layout. */
.dsh-dschat-fileinput { display: none; }
/*
 * \u9644\u4EF6: a 30px glyph circle, exactly as tall as the pills beside it.
 *
 * No label. The web app's own attach control is a bare paperclip in this row,
 * and at panel widths the two pills plus a labelled upload button plus the send
 * circle do not fit; the tooltip and the chips above carry the words.
 */
.dsh-dschat-attach {
  width: 30px; height: 30px; flex: none; display: grid; place-items: center;
  border: none; border-radius: 50%; corner-shape: round; background: transparent; cursor: pointer;
  color: var(--dschat-tx-2);
}
.dsh-dschat-attach:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
.dsh-dschat-attach:disabled { opacity: .5; cursor: not-allowed; background: transparent; }
/*
 * The composer's \u6DF1\u5EA6\u601D\u8003 / \u667A\u80FD\u641C\u7D22 pills.
 *
 * Measured on the live page rather than guessed \u2014 34px tall, 18px radius, 10px
 * of side padding, a 4px gap between the glyph and the label, '13px/500' text,
 * and, the part that makes them recognisable, a neutral outline when off and the
 * accent wash when on \u2014 and then moved onto THIS panel's baseline: 30px tall and
 * fully round, so the pills, the action row above them, the attach circle and
 * the send circle are one family of controls instead of three.
 *
 * The page's own colours, kept:
 * and \u2014 the part that makes them recognisable \u2014 a NEUTRAL outline when off and
 * the accent wash when on:
 *
 *   off  fill rgba(45,53,70,.8) / border rgba(78,109,181,.8) / label #f9fafb
 *   on   fill #283142           / border #4868b2                / label #679efe
 *
 * Those are the page's dark-mode values; on the panel the "on" pair is the
 * --dschat-tint / --dschat-tint-line / --dschat-on-accent-tint triplet, whose
 * two steps are exactly this line and its light-theme twin (#edf3fe on
 * #b7c8fe in #3964fe). The "off" pill is the harness's neutral: transparent
 * with a control-edge hairline. The "on" state deliberately sits on the same
 * triplet the transfer button and the toolbar's pressed state use, so the
 * accent still reads as one family.
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
  display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 11px;
  border-radius: 999px; corner-shape: round; cursor: pointer; white-space: nowrap; font-size: 13px; font-weight: 500;
  border: 1px solid var(--dschat-line-2);
  background: transparent;
  color: var(--dschat-tx-2);
}
.dsh-dschat-toggle-text { line-height: 1; color: inherit; }
.dsh-dschat-toggle:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
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
 * order. Measured after the fix: pill and label both rgb(57,100,254) \u2014 the
 * accent, and the same pair the web's own \u6DF1\u5EA6\u601D\u8003 pill carries.
 */
.dsh-dschat-toggle.dsh-dschat-toggle-on,
.dsh-dschat-toggle.dsh-dschat-toggle-on > .dsh-dschat-toggle-text {
  background: var(--dschat-tint);
  border-color: var(--dschat-tint-line);
  color: var(--dschat-on-accent-tint);
}
.dsh-dschat-toggle.dsh-dschat-toggle-on:hover {
  background: color-mix(in srgb, var(--dschat-on-accent-tint) 10%, var(--dschat-tint));
}

/*
 * \u53D1\u9001: the page's filled circle, in the page's own blue \u2014 the web paints this
 * disc with brand-primary and puts label-primary-foreground (white) on it, in
 * BOTH themes, which is what the two rules below now do.
 *
 * That replaced a rule pair: the disc used to be the harness's
 * 'state-business-primary' (#4176e6 / #7aaaff, and the deeper #4176e6 is one of
 * the two blues the reader asked to replace), and the dark theme needed its own
 * disabled branch because near-black ink on a lifted bright blue was the only
 * way to keep the arrow readable there. With white ink, "mix the accent toward
 * the card" dims the disc correctly in both themes, so that branch is gone:
 * light 2.4:1 and dark 6.2:1 for the disabled arrow, both read as "waiting".
 */
button.dsh-dschat-send {
  width: 30px; height: 30px; flex: none; border-radius: 50%; corner-shape: round; display: grid; place-items: center; cursor: pointer;
  border: none; background: var(--dschat-accent);
  color: var(--dschat-on-accent);
}
.dsh-dschat-send:hover { filter: brightness(1.06); }
button.dsh-dschat-send:disabled {
  opacity: 1;
  background: color-mix(in srgb, var(--dschat-accent) 60%, var(--dschat-raised));
  cursor: not-allowed;
}
.dsh-dschat-stop {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  border-radius: 999px; corner-shape: round; cursor: pointer; font-size: 13px;
  border: 1px solid var(--dschat-line-2); background: var(--dschat-raised);
}
.dsh-dschat-stop:hover { background: var(--dschat-hover); }
.dsh-dschat-stop i { width: 9px; height: 9px; border-radius: 2px; background: var(--dschat-danger); }
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
  padding: 6px 26px 12px; font-size: 11.5px; color: var(--dschat-tx-3);
  font-variant-numeric: tabular-nums;
}
.dsh-dschat-phase .dsh-dschat-sep { opacity: .4; }
.dsh-dschat-phase b { font-weight: 600; color: var(--dschat-tx-2); }
.dsh-dschat-phase .dsh-dschat-spin { width: 11px; height: 11px; }

/*
 * The wrapper AROUND each trigger: the panel's containing block, and therefore
 * its anchor.
 *
 * Two properties here are mechanisms, not tidying:
 *
 *   position:relative  makes the box the containing block at all. Standing the
 *                      wrapper BESIDE the trigger instead of around it is the
 *                      bug the lamp already paid for once (a zero-width sibling
 *                      that the header's flex spacer had pushed to the far edge
 *                      put a 230px panel at x=1266, hundreds of pixels from the
 *                      dot that opened it).
 *   align-self:center  keeps that box the size of the TRIGGER. As a flex item of
 *                      the action row it would otherwise STRETCH to the row's
 *                      height \u2014 36px, set by the 34px glyph buttons beside it \u2014
 *                      and the panel's bottom offset would then measure from 8px
 *                      below the button's own bottom rather than from its top,
 *                      opening at a gap that changes with the row. Measured:
 *                      stretched, the panel landed 36px above its trigger's top
 *                      instead of 8px.
 */
.dsh-dschat-pop-wrap { position: relative; display: flex; align-items: center; align-self: center; width: auto; }
/*
 * Panels open UPWARD, because the triggers are on the composer's action row \u2014
 * the bottom of the panel.
 *
 * They used to hang below (top: 36px), which was wrong twice over once the
 * action row moved here: the \u8FC1\u79FB panel covered the input card the reader was
 * about to type in (it grew down over the textarea and the tool row, i.e. the
 * thing the button exists to act on), and it had to fit in the space between
 * the card and the phase line, which it does not. Upward, it opens over the
 * TRANSCRIPT \u2014 the content the reader is looking at to decide what to migrate \u2014
 * and its height is limited by the thread above rather than by the composer
 * below.
 *
 * The calc(100% + 8px) bottom offset measures from the anchor's top edge \u2014 the
 * trigger's own top, since the wrapper is exactly its size \u2014 so the 8px gap is
 * between panel and button in every state. No top offset is declared at all:
 * with both offsets set, an absolutely positioned box with a height would
 * stretch between them.
 */
.dsh-dschat-pop {
  position: absolute; bottom: calc(100% + 8px); right: 0; width: 348px; z-index: 40; padding: 12px;
  border-radius: var(--dschat-radius-lg);
  background: var(--dschat-surface); backdrop-filter: var(--dsw-menu-backdrop-filter, blur(28px) saturate(160%));
  border: 1px solid var(--dschat-surface-border);
  box-shadow: var(--dsw-elevation-prominent, 0 16px 40px #00000024, 0 2px 8px #00000014);
  /*
   * A CEILING, in the caller's own default plus a measured override.
   *
   * It cannot be a percentage. The panel is absolutely positioned, so
   * max-height: 100% resolves against the containing block \u2014 the trigger's own
   * box, 30px tall \u2014 which is a 30px ceiling, not a useful one, and there is no
   * definite height anywhere above it to inherit instead. The measured result of
   * leaving it open was a twenty-conversation list rendering as a 1182px panel
   * whose top was at y=-622: most of it above the window, unreachable, with no
   * scrollbar to say so.
   *
   * The 60vh / 520px pair is the FALLBACK, for the surfaces that do not measure
   * themselves (the \u300C\xB7\xB7\xB7\u300D menu, the lamp's status line, \u8FC1\u79FB's form). The
   * conversation list does, and it overrides this below: see the
   * --dschat-list-avail rule.
   */
  max-height: min(60vh, 520px);
  /*
   * Clipping is what turns a panel that is taller than its ceiling into a
   * SCROLLING one: without it the children spill out of the box and the rows
   * simply hang below the panel's border. The same declaration appears on
   * .dsh-dschat-listpop for the flex column it needs; here it is the safety net
   * for every other panel on this sheet.
   */
  overflow: hidden;
}
/*
 * The measured ceiling, for \u4F1A\u8BDD\u5217\u8868 only.
 *
 * --dschat-list-avail is written onto the WRAPPER by the panel (see the
 * measurement effect in DSchatPanel): the distance from this button's top edge to
 * the body's top edge, less 4px of air under the header. It is a live number,
 * not a constant \u2014 the row sits below a transcript, a queue and an attachment
 * strip that all move it \u2014 so a tall window gives the list room to be a long menu
 * and a short one gives it exactly what is left, with the rows scrolling inside
 * it.
 *
 * The min() with the fallback is the belt-and-braces half: if the variable is
 * ever absent (a first paint before the effect, a document where layout never
 * settles) the popover still gets a real ceiling instead of none.
 *
 * 640px, not the 520px this started at: 520 put a hard floor under how many rows
 * a tall window could show even when there was room for twice as many, and the
 * result read as "\u6709\u70B9\u77EE" \u2014 a menu that stops short for no visible reason. The
 * number still has a job \u2014 a very tall window must not turn the list into a
 * second page \u2014 it is just set where it stops being the thing the reader hits
 * first. It is also the only ceiling left on this panel: \u8FC1\u79FB's form is short
 * enough that its own 60vh / 520px fallback never comes up.
 */
.dsh-dschat-pop-wrap > .dsh-dschat-listpop {
  max-height: min(var(--dschat-list-avail, 100vh), 640px);
  /*
   * And it FILLS that ceiling rather than shrinking to its rows.
   *
   * A ceiling alone leaves a short list floating: with five conversations in a
   * roomy window the card measured 381px of a possible 508 and sat 179px down
   * from the top \u2014 and the top edge is what the eye reads as "where the list
   * starts", so a dropdown that stops short of the room it was given still reads
   * as short, which is the same complaint the ceiling change was meant to answer.
   *
   * A dropdown hangs from the top of the space it opens into and runs to whatever
   * length it needs; that is the shape \u8FC1\u79FB has (its form is as tall as its
   * fields) and what a menu does everywhere else. So the card takes the room: the
   * ROWS still stop where the rows stop, and the area below them is the list's own
   * surface, with the search box at the top, the footer pinned at the bottom and
   * the rows scrolling in between when there are too many.
   *
   * The height arrives as a PIXEL value from the panel, not as a percentage: 100%
   * would resolve against the wrapper, a shrink-to-fit flex item with no definite
   * height, and collapse to auto. See the measurement effect, which writes
   * --dschat-list-h beside --dschat-list-avail \u2014 the two are the same
   * measurement, one clamped here by 640px and one not.
   *
   * Note the shape: MIN, not a nested one. min(min(a, b), c) is a min()
   * with a min() inside it, and the nested call makes the whole declaration
   * invalid \u2014 Chrome drops it, the height silently falls back to auto, and the
   * panel shrinks to its rows again with no error anywhere. The first version of
   * this rule did exactly that.
   */
  height: min(var(--dschat-list-h, 100vh), 640px);
}
/*
 * The \u300C\xB7\xB7\xB7\u300D menu: a short list, so 348px of form would be a slab. Right
 * anchored like everything else on this row; a column too narrow to hold it
 * lets it out from the other side.
 */
.dsh-dschat-pop-menu { width: 230px; padding: 6px; }
@media (max-width: 620px) {
  .dsh-dschat-pop-menu { right: auto; left: 0; }
}
/*
 * A menu row. A full-width left-aligned button rather than a .dsh-dschat-btn
 * with inline width/justify-content \u2014 the inline style was the only reason
 * these could not be styled as a list (they had no padding of their own, no
 * state colour, and no full-bleed hit area).
 */
.dsh-dschat-menu-item {
  display: flex; align-items: center; width: 100%; height: 30px; padding: 0 8px;
  border: none; border-radius: var(--dschat-radius-sm); background: transparent; cursor: pointer;
  font-size: 13px; color: var(--dschat-tx-2); text-align: left;
}
.dsh-dschat-menu-item:hover { background: var(--dschat-hover); color: var(--dschat-tx); }
/*
 * Everything anchored in the TITLE BAR opens DOWNWARD.
 *
 * Upward is a rule about the composer's row (see the note on .dsh-dschat-pop):
 * a trigger at the bottom of the panel must open into the transcript above it.
 * Both of the header's triggers \u2014 the state lamp and the \u300C\xB7\xB7\xB7\u300D \u2014 are at the TOP
 * instead, so that rule would open their panels 30px off the ceiling: measured,
 * the lamp's landed at y=-35, i.e. above the window. A trigger in the top strip
 * opens into the conversation below, which is the half of the screen with room
 * in it.
 *
 * Declaring it ONCE for the strip is deliberate: the rule belongs to the strip,
 * not to either button, and the next control added up here then cannot get it
 * wrong. The top:auto declaration is not decoration \u2014 the shared rule sets a bottom offset,
 * and a box with both offsets set is stretched between them rather than
 * positioned.
 */
.dsh-dschat-header .dsh-dschat-pop { bottom: auto; top: calc(100% + 8px); }
/*
 * The lamp's panel hangs to the LEFT of its trigger, which is the strip's
 * leftmost control \u2014 a right-anchored panel there would run off the window. A
 * column too narrow for the overhang lets it out the right side instead.
 */
.dsh-dschat-lamp-wrap { position: relative; flex: none; display: flex; align-items: center; }
.dsh-dschat-lamp-wrap > .dsh-dschat-pop { width: 230px; right: auto; left: 0; padding: 10px; }
/* A one-line panel: the sentence is the whole content, so its own margins go. */
.dsh-dschat-pop-status .dsh-dschat-lamp-status { margin: 0; padding: 0; border-bottom: none; }
@media (max-width: 620px) {
  .dsh-dschat-lamp-wrap > .dsh-dschat-pop { left: auto; right: 0; }
}

.dsh-dschat-pop h4 { margin: 0 0 2px; font-size: 13px; font-weight: 600; color: var(--dschat-tx); }
/*
 * Host rule for menus: light menus keep the hairline, dark menus use the
 * stronger stroke \u2014 a 1px #ffffff0f hairline disappears on a dark translucent
 * fill. One rule for both floating surfaces, because they are one material
 * (see --dschat-surface in the token block).
 */
body[data-ds-dark-theme] .dsh-dschat-pop,
body[data-ds-dark-theme] .dsh-dschat-msg-acts { border-color: var(--dschat-line-3); }
}
.dsh-dschat-pop .dsh-dschat-sub { margin: 0 0 10px; font-size: 11.5px; color: var(--dschat-tx-3); }
.dsh-dschat-field { margin-bottom: 10px; }
.dsh-dschat-field > label { display: block; font-size: 11px; color: var(--dschat-tx-3); margin-bottom: 4px; }
.dsh-dschat-seg { display: flex; gap: 3px; padding: 2px; border-radius: var(--dschat-radius-sm); background: var(--dschat-filled); }
.dsh-dschat-seg button {
  flex: 1; height: 26px; border-radius: 6px; border: none; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--dschat-tx-2);
}
.dsh-dschat-seg button[data-on] {
  background: var(--dschat-raised); color: var(--dschat-tx);
  font-weight: 500; box-shadow: var(--dschat-card-shadow);
}
.dsh-dschat-select {
  width: 100%; height: 30px; padding: 0 8px; font: inherit; font-size: 12.5px; cursor: pointer;
  color: var(--dschat-tx); background: var(--dschat-raised);
  border: 1px solid var(--dschat-line-2); border-radius: var(--dschat-radius-sm);
}
.dsh-dschat-hintline {
  display: flex; align-items: center; gap: 6px; font-size: 11px;
  color: var(--dschat-tx-3); margin: -2px 0 10px;
}
/*
 * A hint that is not decoration.
 *
 * The hand-off preview says which of two very different things is about to be
 * written \u2014 a distilled brief, or the whole raw conversation after a silent
 * fallback \u2014 and the second one has to be visible at a glance rather than read
 * as another grey footnote.
 */
.dsh-dschat-hintline[data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-secondary));
}
/*
 * The first message a transfer will write, shown (and editable) BEFORE any
 * session exists.
 *
 * A boxed, fixed-height scroller rather than the composer's own input style:
 * this text is routinely thousands of characters, and letting it grow would
 * push the confirmation button off the dialog.
 */
.dsh-dschat-preview {
  background: var(--dschat-filled);
  border: 1px solid var(--dschat-line);
  border-radius: var(--dschat-radius-sm);
  padding: 8px 10px; min-height: 96px; max-height: 220px; overflow-y: auto;
  font-size: 12px; line-height: 1.55; white-space: pre-wrap;
}
/*
 * The line under the preview box.
 *
 * The shared hint line tucks itself up against the field above it (-2px), which
 * is right for a label-over-input pair and wrong here: the box has a real
 * border, so the count sat ON it.
 */
.dsh-dschat-preview-meta { margin: 6px 0 10px; }
.dsh-dschat-preview-note { align-items: flex-start; line-height: 1.55; }
.dsh-dschat-pop-foot { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.dsh-dschat-steps { display: flex; flex-direction: column; gap: 7px; padding: 4px 0 8px; }
.dsh-dschat-step { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dschat-tx-2); }
.dsh-dschat-step[data-done] { color: var(--dschat-tx); }
.dsh-dschat-tick {
  width: 16px; height: 16px; border-radius: 50%; corner-shape: round; flex: none; display: grid; place-items: center;
  border: 1.5px solid var(--dschat-line-3);
}
.dsh-dschat-step[data-done] .dsh-dschat-tick {
  background: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary); color: #fff;
}
.dsh-dschat-step .dsh-dschat-spin { width: 14px; height: 14px; border-width: 1.8px; }
.dsh-dschat-prog { height: 3px; border-radius: 99px; corner-shape: round; background: var(--dschat-quiet); overflow: hidden; margin: 2px 0 4px; }
.dsh-dschat-prog > i { display: block; height: 100%; width: 0; background: var(--dschat-accent); transition: width .3s ease; }

/* ---------- run-status card (panel modal, not a settings page) ---------- */
.dsh-dschat-status { display: block; }
.dsh-dschat-sethead h1 { margin: 0 0 4px; font-size: 20px; font-weight: 500; line-height: 28px; }
.dsh-dschat-sethead p { margin: 0 0 20px; font-size: 13px; color: var(--dschat-tx-2); max-width: 640px; }
.dsh-dschat-setcard {
  margin: 0 0 12px; padding: 12px 14px;
  border-radius: var(--dschat-radius-lg);
  background: var(--dschat-filled);
  border: 1px solid var(--dschat-line);
}
.dsh-dschat-status .dsh-dschat-sethead h1 { font-size: 15px; font-weight: 600; line-height: 22px; }
.dsh-dschat-status .dsh-dschat-sethead p { margin: 0 0 12px; max-width: none; }
.dsh-dschat-setcard h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.dsh-dschat-setrow {
  display: flex; align-items: baseline; gap: 16px; padding: 5px 0;
  border-top: 1px solid var(--dschat-line);
}
.dsh-dschat-setrow:first-of-type { border-top: none; }
.dsh-dschat-setlabel { flex: none; width: 150px; font-size: 12.5px; color: var(--dschat-tx-2); }
.dsh-dschat-setvalue {
  flex: 1; min-width: 0; font-size: 12.5px; color: var(--dschat-tx);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-dschat-mono { font-family: var(--dschat-mono); font-size: 11.5px; }
.dsh-dschat-on, .dsh-dschat-off { display: inline-flex; align-items: center; gap: 5px; }
.dsh-dschat-on { color: var(--dschat-success); }
.dsh-dschat-off { color: var(--dschat-tx-3); }

.dsh-dschat-setactions { display: flex; gap: 8px; }
.dsh-dschat-sethint { margin: 10px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--dschat-tx-3); }

/* ---------- engine notice (in the transcript) ---------- */
/*
 * \u300C\u7F51\u9875\u7AEF\u6CA1\u6709\u5C31\u7EEA\u300D, at the end of the conversation.
 *
 * Not a toast: it is a state, not an event \u2014 it stays until the page is up, and
 * the button that fixes it is on the card. Tinted with the WARNING state rather
 * than the error one, because the message it concerns is not lost (it goes back
 * into the composer or waits in the queue) and the common cause is mundane.
 */
.dsh-dschat-notice {
  display: flex; align-items: flex-start; gap: 10px; margin: 14px 0 4px; padding: 12px 14px;
  border-radius: var(--dschat-radius-lg);
  background: var(--dschat-filled);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 45%, var(--dschat-line-2));
}
.dsh-dschat-notice-mark {
  flex: none; display: grid; place-items: center; width: 18px; height: 18px; margin-top: 1px;
  color: var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-secondary));
}
.dsh-dschat-notice-body { flex: 1; min-width: 0; }
.dsh-dschat-notice-body strong { display: block; font-size: 13px; font-weight: 600; }
.dsh-dschat-notice-body p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--dschat-tx-2); word-break: break-word; }
.dsh-dschat-notice-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }

/* ---------- \u8FD0\u884C\u72B6\u6001 modal ---------- */
.dsh-dschat-modal {
  position: absolute; inset: 0; z-index: 55; display: grid; place-items: center;
  background: color-mix(in srgb, #000 42%, transparent); padding: 24px;
}
.dsh-dschat-modal-card {
  position: relative; width: min(640px, 100%); max-height: 100%; overflow: auto;
  padding: 18px 20px 20px; border-radius: var(--dschat-radius-lg);
  background: var(--dschat-raised); border: 1px solid var(--dschat-line-3);
  box-shadow: 0 18px 48px #0000003d;
}
.dsh-dschat-modal-close {
  position: absolute; top: 12px; right: 12px; width: 26px; height: 26px;
  display: grid; place-items: center; border: none; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--dschat-tx-3);
}
.dsh-dschat-modal-close:hover { background: var(--dschat-hover); color: var(--dschat-tx); }

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
/*
 * The crash fence (panel/slot.tsx). Centred, quiet, and readable on its own:
 * it is what the reader sees INSTEAD of the panel, and its job is to say so
 * without looking like the panel half-rendered.
 */
.dsh-dschat-crash {
  align-items: center; justify-content: center; gap: 10px; padding: 32px 24px;
  text-align: center; height: 100%;
}
.dsh-dschat-crash-message {
  margin: 0; color: var(--dschat-tx); font-size: 13px; line-height: 1.6; max-width: 46ch;
}
.dsh-dschat-crash-detail {
  margin: 0; max-width: 100%; overflow: auto; text-align: left;
  padding: 10px 12px; border-radius: var(--dschat-radius-sm);
  background: var(--dschat-filled); border: 1px solid var(--dschat-line-2);
  color: var(--dschat-danger);
  font-family: var(--dschat-mono); font-size: 12px; white-space: pre-wrap; word-break: break-word;
}


`;

// src/client/index.ts
var NS = "dsh-dschat";
var PANEL_ID = "dschat";
var inject = ["slots", "locale"];
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
      DSchatSlot
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
