/**
 * Local transcript store. Chats are persisted as one JSON file under the
 * plugin data dir (~/.dsh/dsh-dschat/transcripts.json by default) so web
 * conversations survive restarts and can be transferred into harness mode
 * at any time. Atomic writes (tmp + rename) keep a crash from corrupting
 * history.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DSchatMessage, DSchatTranscript } from './protocol.ts'

/** Default plugin data directory (tests inject a sandbox root). */
export function defaultDataDir(): string {
  const home = process.env.DSH_HOME ?? process.env.HOME ?? '.'
  return join(home, '.dsh', 'dsh-dschat')
}

export interface TranscriptStoreOptions {
  /** Root data dir; the transcripts file lives directly under it. */
  dataDir?: string
}

interface StoreFile {
  version: 1
  activeChatId?: string
  chats: DSchatTranscript[]
}

/**
 * How long a mutation may sit unwritten before the backstop timer fires.
 *
 * A streaming reply upserts the same message ~10×/s, and each write serializes
 * the WHOLE store — measured at 4.9 ms of `JSON.stringify` plus 1.6 ms of
 * `writeFileSync` on a 2.6 MB / 108-chat store, i.e. ~6.5 ms of synchronous
 * main-thread blocking per tick. Coalescing turns that into one write per
 * second while the reply streams; `flush()` still lands the final state the
 * moment a turn ends.
 */
export const PERSIST_DEBOUNCE_MS = 1_000

/**
 * Make every message in ONE conversation carry its own id.
 *
 * Returns the repaired list (a NEW array; `DSchatMessage` is readonly, so a
 * record is replaced, never mutated) plus whether anything changed — the
 * caller persists only then.
 *
 * Two different flaws are repaired, because they need different answers:
 *
 *   - The SAME message stored twice. Canonical case: an import payload that
 *     carried a message already in the transcript, so the file now holds two
 *     byte-identical records (same id, role, content, ts and sources). One of
 *     them is dropped — keeping both would show the reader the same answer
 *     twice, and re-iding one would turn a duplicate into a fake second turn.
 *   - Two DIFFERENT messages sharing an id. No reader can tell them apart (the
 *     panel keys by id, `upsertMessage` replaces the first match, `tailDelta`
 *     addresses a reply by it), so the later record gets a fresh id. Which one
 *     keeps the original id does not matter as long as exactly one does.
 */
export function ensureUniqueMessageIds(messages: readonly DSchatMessage[]): { messages: DSchatMessage[]; changed: boolean } {
  const seen = new Map<string, DSchatMessage>()
  const kept: DSchatMessage[] = []
  let changed = false
  for (const message of messages) {
    const id = typeof message.id === 'string' ? message.id : ''
    const previous = id === '' ? undefined : seen.get(id)
    if (previous === undefined) {
      const next = id === '' ? { ...message, id: randomUUID() } : message
      if (next !== message) changed = true
      seen.set(next.id, next)
      kept.push(next)
      continue
    }
    changed = true
    if (sameMessage(previous, message)) continue
    const next = { ...message, id: randomUUID() }
    seen.set(next.id, next)
    kept.push(next)
  }
  return { messages: kept, changed }
}

/** Byte-identical record test: the same message stored twice, not two turns. */
function sameMessage(left: DSchatMessage, right: DSchatMessage): boolean {
  return left.role === right.role
    && left.content === right.content
    && left.ts === right.ts
    && JSON.stringify(left.sources ?? null) === JSON.stringify(right.sources ?? null)
}

/**
 * The title every brand-new chat carries until its first exchange names it.
 *
 * Exported because it is an IDENTITY HAZARD, not decoration: a large share of
 * stored chats can share this exact title at any moment, so anything that tries
 * to find a conversation by title has to treat it as "no name at all".
 */
export const DEFAULT_CHAT_TITLE = '新的对话'

/**
 * JSON-file transcript store. Mutations are synchronous and durable — go
 * through the in-memory list — but persistence is coalesced: a burst of
 * updates (the streaming case) becomes one atomic write, and nothing is lost
 * because the writer is only ever behind, never blind. Flush at every point
 * the process could go away: the end of a turn and plugin disposal.
 *
 * The engine and the routes share this single instance, so the GUI and the
 * agent tools always see the same history.
 */
export class TranscriptStore {
  readonly dataDir: string
  private readonly file: string
  private chats: DSchatTranscript[]
  private activeChatId: string | undefined
  /** Pending coalesced write; undefined when everything is on disk. */
  private persistTimer: ReturnType<typeof setTimeout> | undefined
  /**
   * A load or write problem worth telling the reader about.
   *
   * The store used to fail silently in both directions: an unreadable file
   * became "no history" and was then overwritten by the next write, and a failed
   * write threw inside a `setTimeout` (an uncaught exception in the host). Both
   * are now recorded here and surfaced through `/state`, so the panel can say
   * what happened instead of the history quietly disappearing.
   */
  private warning: string | undefined

  constructor(options: TranscriptStoreOptions = {}) {
    this.dataDir = options.dataDir ?? defaultDataDir()
    this.file = join(this.dataDir, 'transcripts.json')
    const loaded = this.read()
    this.chats = loaded.chats
    this.activeChatId = loaded.activeChatId
    if (this.activeChatId !== undefined && !this.chats.some(chat => chat.id === this.activeChatId)) {
      // `chats` is newest-first (`createChat` unshifts), so the newest is at 0.
      // This used to read `.at(-1)` — the OLDEST conversation — so a store whose
      // activeChatId had gone stale reopened history at the wrong end.
      this.activeChatId = this.chats.at(0)?.id
    }
    /*
     * Repair duplicate message ids at load, before anything can render them.
     *
     * A message id is not just a label here: the panel uses it as its React
     * key, and the routes use it to address one message. A chat holding two
     * messages with the same id is therefore not a cosmetic problem — React
     * warns, and then under keyed reconciliation it can lose track of one of
     * the two fibers, leaving that message's DOM node orphaned in the parent.
     * That is exactly the "old answer is still stuck inside a brand-new empty
     * chat" report: the stale node is not re-rendered, it was never removed.
     *
     * Healed here rather than only in the panel because the invariant belongs
     * to the data: an id an importer reused is a duplicate from the moment it
     * is written, and every reader (panel, export, transfer, search) would
     * otherwise have to defend against it separately.
     */
    let repaired = false
    for (const chat of this.chats) {
      const fixed = ensureUniqueMessageIds(chat.messages)
      if (!fixed.changed) continue
      chat.messages = fixed.messages
      repaired = true
    }
    // Only write when something was actually repaired, so a healthy store is
    // never rewritten (and re-timestamped) merely for being opened.
    if (repaired) this.persist()
  }

  /** A store problem the UI should surface, or undefined when all is well. */
  storeWarning(): string | undefined {
    return this.warning
  }

  /** Record (and log) a store problem, keeping the first one seen this session. */
  private warn(message: string): void {
    if (this.warning === undefined) this.warning = message
    console.warn(`[dsh-dschat] ${message}`)
  }

  /**
   * Move an unreadable store aside so the next write cannot destroy it.
   *
   * Renaming (not deleting, not copying) is what makes this safe: whatever the
   * file contained stays on disk under a name the plugin will never overwrite,
   * and the reader can hand it back or repair it.
   */
  private quarantine(): string {
    const target = `${this.file}.corrupt-${Date.now()}`
    try {
      renameSync(this.file, target)
      return `，原文件已备份为 ${target}`
    } catch (error) {
      return `，且备份失败（${String(error)}）`
    }
  }

  private read(): StoreFile {
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch (error) {
      /*
       * A MISSING file is the normal first run. Anything else — EACCES, EIO, a
       * directory in the way — is a real failure, and reading it as "no history"
       * is how one bad read turned into a total loss: the constructor started
       * empty and the next write replaced the file with nothing.
       */
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        this.warn(`读取会话记录失败（${String(error)}）。本次以空历史启动，原文件未被覆盖。`)
      }
      return { version: 1, chats: [] }
    }
    try {
      const parsed = JSON.parse(text) as Partial<StoreFile>
      const chats = Array.isArray(parsed.chats) ? parsed.chats : []
      return {
        version: 1,
        activeChatId: typeof parsed.activeChatId === 'string' ? parsed.activeChatId : undefined,
        chats: chats.filter(chat => typeof chat?.id === 'string' && Array.isArray(chat.messages)),
      }
    } catch (error) {
      // Unparseable JSON: quarantine before the first write can land, or the
      // only copy of every conversation is gone.
      this.warn(`会话记录文件无法解析（${String(error)}）${this.quarantine()}。本次以空历史启动。`)
      return { version: 1, chats: [] }
    }
  }

  private persist(): void {
    if (this.persistTimer !== undefined) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      this.writeNow()
    }, PERSIST_DEBOUNCE_MS)
    // Never hold the process open just to land a transcript write.
    this.persistTimer.unref?.()
  }

  /**
   * Land every pending mutation immediately.
   *
   * Called when the process might be about to exit (the end of a turn, plugin
   * disposal) so coalescing can never be the reason a finished reply is lost.
   */
  flush(): void {
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }
    this.writeNow()
  }

  /**
   * The atomic write itself: tmp file + rename, compact JSON.
   *
   * Failures are caught, not thrown: the debounced write runs from a bare
   * `setTimeout`, so a throw here (ENOSPC, EACCES, a read-only volume) escaped
   * as an uncaught exception in the HOST process — the plugin could take the app
   * down to report a full disk. The message is recorded and surfaced through
   * `/state` instead, and the in-memory history stays served.
   */
  private writeNow(): void {
    try {
      mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
      const payload: StoreFile = { version: 1, activeChatId: this.activeChatId, chats: this.chats }
      const tmp = `${this.file}.tmp`
      // Compact, not `null, 2`: this file is machine-written and can reach
      // megabytes, and the streaming path rewrites it. Indenting it doubled both
      // the serialize cost and the bytes for no reader's benefit.
      writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch (error) {
      this.warn(`保存会话记录失败（${String(error)}）。本次运行的历史只存在于内存中，关闭窗口后会丢失。`)
    }
  }

  /** Create a fresh chat and make it active. */
  createChat(model: string): DSchatTranscript {
    const now = Date.now()
    const chat: DSchatTranscript = {
      id: `chat-${now.toString(36)}-${randomUUID().slice(0, 6)}`,
      title: DEFAULT_CHAT_TITLE,
      createdAt: now,
      updatedAt: now,
      model,
      messages: [],
      streaming: false,
    }
    this.chats.unshift(chat)
    this.activeChatId = chat.id
    this.persist()
    return chat
  }

  /** All chats, newest first. */
  list(): DSchatTranscript[] {
    return [...this.chats]
  }

  /**
   * One chat by id.
   *
   * Exists for the streaming tail route, which must not call `list()`: copying
   * and then scanning 100+ transcripts on every 100 ms poll is exactly the kind
   * of whole-store work the tail endpoint was added to avoid.
   */
  get(id: string): DSchatTranscript | undefined {
    return this.chats.find(chat => chat.id === id)
  }

  /**
   * Import (or refresh) a recovered web conversation. Returns the chat, plus
   * whether it was created and whether an existing one was overwritten.
   *
   * Matching is by web session id first and exact title second. The title-only
   * dedup this replaces made re-syncing "idempotent" in the worst way: an
   * import that had been truncated (the old scraper only saw the rows the
   * virtual list had mounted) could never be repaired, because the second
   * recover matched the title and returned the short transcript unchanged.
   *
   * An existing transcript is only ever UPGRADED — a recover that comes back
   * with fewer bytes never truncates what is already stored.
   */
  importTranscript(input: {
    title: string
    model: string
    messages: DSchatMessage[]
    /** Web session id this conversation was recovered from, when known. */
    webSessionId?: string
    /**
     * Allow matching an existing transcript by TITLE when there is no web
     * session id to match on.
     *
     * Only the recover path may ask for this: it is re-syncing one identifiable
     * web conversation, and the DOM-scraped layer genuinely has no id to match
     * on. Callers that are not re-syncing (「撤销」 restoring a deleted chat)
     * must leave it off, because a title is not an identity — every chat starts
     * out titled 「新的对话」, so a title match can graft a restored transcript
     * onto an unrelated conversation.
     */
    matchByTitle?: boolean
  }): { chat: DSchatTranscript; created: boolean; updated: boolean } {
    const cleanTitle = input.title.trim().replace(/\s+/g, ' ').slice(0, 80) || DEFAULT_CHAT_TITLE
    /*
     * Import is the one door foreign ids come through: a caller hands over a
     * whole history (a recover, or 「撤销」 replaying what the panel still holds),
     * and an id it reused would otherwise be written straight into the file.
     * Repair here as well as at load so a duplicate never reaches disk, not just
     * never survives a restart.
     */
    const incoming = ensureUniqueMessageIds(input.messages).messages
    const existing = this.findForImport(cleanTitle, input.webSessionId, input.matchByTitle === true)
    if (existing !== undefined) {
      let changed = this.activeChatId !== existing.id
      this.activeChatId = existing.id
      if (input.webSessionId !== undefined && existing.webSessionId !== input.webSessionId) {
        existing.webSessionId = input.webSessionId
        changed = true
      }
      const updated = this.isFuller(incoming, existing.messages)
      if (updated) {
        existing.messages = incoming
        existing.updatedAt = Date.now()
        changed = true
      }
      // The id adoption must be persisted even when the history itself was not
      // replaced, or the sidebar keeps offering a conversation that is already
      // imported.
      if (changed) this.persist()
      return { chat: existing, created: false, updated }
    }
    const now = Date.now()
    const chat: DSchatTranscript = {
      id: `chat-${now.toString(36)}-${randomUUID().slice(0, 6)}`,
      title: cleanTitle,
      createdAt: now,
      updatedAt: now,
      model: input.model,
      messages: incoming,
      streaming: false,
      ...(input.webSessionId === undefined ? {} : { webSessionId: input.webSessionId }),
    }
    this.chats.unshift(chat)
    this.activeChatId = chat.id
    this.persist()
    return { chat, created: true, updated: false }
  }

  /**
   * Which stored chat an incoming import belongs to.
   *
   * By web session id first, and — only when the caller asked for it and there
   * is no id — by title. The title branch additionally refuses the default
   * title and refuses chats that are already tied to a known web conversation,
   * so it can only ever re-attach an id-less import to another id-less
   * transcript with a real, matching name.
   */
  private findForImport(title: string, webSessionId: string | undefined, matchByTitle: boolean): DSchatTranscript | undefined {
    if (webSessionId !== undefined && webSessionId !== '') {
      const byId = this.chats.find(chat => chat.webSessionId === webSessionId)
      if (byId !== undefined) return byId
    }
    if (!matchByTitle || title === DEFAULT_CHAT_TITLE) return undefined
    return this.chats.find(chat => chat.title === title && chat.webSessionId === undefined)
  }

  /**
   * True when the incoming history carries more than what is stored.
   * Message count decides first (a 2-message import of a 32-message
   * conversation is the failure being repaired); equal counts need a real size
   * increase so a re-recover with identical content does not churn the file.
   */
  private isFuller(next: DSchatMessage[], current: DSchatMessage[]): boolean {
    if (current.length === 0) return next.length > 0
    if (next.length !== current.length) return next.length > current.length
    const size = (messages: DSchatMessage[]): number => messages.reduce((total, message) => total + message.content.length, 0)
    return size(next) > size(current)
  }

  /** Web session ids already imported (so the sidebar can mark the rest). */
  webSessionIds(): Set<string> {
    const ids = new Set<string>()
    for (const chat of this.chats) if (chat.webSessionId !== undefined) ids.add(chat.webSessionId)
    return ids
  }

  /** The active chat, or undefined when none exists yet. */
  activeChat(): DSchatTranscript | undefined {
    if (this.activeChatId === undefined) return undefined
    return this.chats.find(chat => chat.id === this.activeChatId)
  }

  /** Read one chat by id. */
  getChat(id: string): DSchatTranscript | undefined {
    return this.chats.find(chat => chat.id === id)
  }

  /** Pick the active chat, creating one if none exists. */
  ensureActiveChat(model: string): DSchatTranscript {
    return this.activeChat() ?? this.createChat(model)
  }

  /** Set which chat is active. */
  setActiveChat(id: string): boolean {
    if (!this.chats.some(chat => chat.id === id)) return false
    this.activeChatId = id
    this.persist()
    return true
  }

  /** Mutate the active (or named) chat and persist. */
  private update(id: string, mutate: (chat: DSchatTranscript) => void): DSchatTranscript | undefined {
    const chat = this.chats.find(candidate => candidate.id === id)
    if (chat === undefined) return undefined
    mutate(chat)
    chat.updatedAt = Date.now()
    this.persist()
    return chat
  }

  /** Append a message to a chat. */
  appendMessage(id: string, message: DSchatMessage): DSchatTranscript | undefined {
    return this.update(id, chat => {
      /*
       * Belt and braces on the id invariant. The engine's own ids are fresh
       * UUIDs, so this never fires for a normal turn — but the panel keys off
       * this field, and the one time it collided the damage was invisible in
       * the store and visible only as a stray node in the UI. A cold path
       * (once or twice per turn) is cheap enough to make that impossible.
       */
      const unique = chat.messages.some(existing => existing.id === message.id)
        ? { ...message, id: randomUUID() }
        : message
      chat.messages.push(unique)
      if (unique.role === 'assistant') chat.streaming = unique.streaming ?? false
    })
  }

  /** Replace (or insert) one message by id — used for streaming updates. */
  upsertMessage(id: string, message: DSchatMessage): DSchatTranscript | undefined {
    return this.update(id, chat => {
      const index = chat.messages.findIndex(candidate => candidate.id === message.id)
      if (index >= 0) chat.messages[index] = message
      else chat.messages.push(message)
      if (message.role === 'assistant') chat.streaming = message.streaming ?? false
    })
  }

  /** Mark the chat's streaming flag (assistant reply started/stopped). */
  setStreaming(id: string, streaming: boolean, model?: string): DSchatTranscript | undefined {
    return this.update(id, chat => {
      chat.streaming = streaming
      if (model !== undefined) chat.model = model
    })
  }

  /** Rename a chat (used to pin a meaningful title after the first exchange). */
  renameChat(id: string, title: string): DSchatTranscript | undefined {
    const clean = title.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (clean === '') return undefined
    return this.update(id, chat => { chat.title = clean })
  }

  /** Delete one chat; a deleted active chat falls back to the newest remaining. */
  deleteChat(id: string): boolean {
    const before = this.chats.length
    this.chats = this.chats.filter(chat => chat.id !== id)
    if (this.chats.length === before) return false
    if (this.activeChatId === id) this.activeChatId = this.chats.at(0)?.id
    this.persist()
    return true
  }

  /** Delete every chat; returns the number removed. */
  clearAllChats(): number {
    const count = this.chats.length
    if (count === 0) return 0
    this.chats = []
    this.activeChatId = undefined
    this.persist()
    return count
  }
}
