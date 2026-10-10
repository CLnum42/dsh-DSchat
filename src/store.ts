/**
 * Local transcript store. Chats are persisted as one JSON file under the
 * plugin data dir (~/.dsh/dsh-dschat/transcripts.json by default) so web
 * conversations survive restarts and can be transferred into harness mode
 * at any time. Atomic writes (tmp + rename) keep a crash from corrupting
 * history.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DSchatMessage, DSchatTranscript } from './protocol.ts'

/**
 * The store format this build reads and writes.
 *
 * Written into every file so a FUTURE version can be recognised instead of
 * silently misread: the old code wrote `version: 1` and never looked at it, so a
 * v2 file (extra fields, different message shape) would have been loaded as v1 —
 * dropping whatever it did not recognise and then overwriting the original on
 * the next write. A newer file is now left alone and reported.
 */
export const STORE_VERSION = 1

/**
 * Default plugin data directory (tests inject a sandbox root).
 *
 * `DSH_HOME` already IS the `~/.dsh` directory (it defaults to `~/.dsh`, and
 * the machine-level config layer is `$DSH_HOME/cordis.patch.yml`), so it must
 * not be treated as the user's home: doing that produced
 * `$DSH_HOME/.dsh/dsh-dschat` and split the store in two whenever the variable
 * was exported. This mirrors `harnessHome()` in index.ts.
 */
export function defaultDataDir(): string {
  const configured = process.env.DSH_HOME?.trim()
  if (configured !== undefined && configured !== '') return join(configured, 'dsh-dschat')
  const home = process.env.HOME?.trim()
  return join(home !== undefined && home !== '' ? home : '.', '.dsh', 'dsh-dschat')
}

/**
 * True when a pid is a live process we can see.
 *
 * `EPERM` means the process exists but belongs to someone else — still alive,
 * and still the owner of the lock.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'EPERM'
  }
}

/**
 * Flush a directory entry, so a rename survives a power cut.
 *
 * Best effort by necessity: Node cannot open a directory for reading on Windows
 * at all, and some file systems refuse the fsync. A failure here is not a write
 * failure — the data IS on disk, only the durability of its NAME is unconfirmed
 * — so it must never be reported as one.
 */
function syncDirectory(dir: string): void {
  let handle: number | undefined
  try {
    handle = openSync(dir, 'r')
    fsyncSync(handle)
  } catch {
    // Windows, or a file system that will not fsync a directory.
  } finally {
    if (handle !== undefined) {
      try {
        closeSync(handle)
      } catch {
        // Already closed or never really open; nothing to recover.
      }
    }
  }
}

export interface TranscriptStoreOptions {
  /** Root data dir; the transcripts file lives directly under it. */
  dataDir?: string
}

/** What one store import (`importTranscript`) produced. */
export interface ImportResult {
  readonly chat: DSchatTranscript
  /** True when the conversation had no local transcript before. */
  readonly created: boolean
  /** True when an existing transcript changed at all (see {@link HistoryMerge}). */
  readonly updated: boolean
  /** Messages the transcript gained. */
  readonly added: number
  /** Stored messages completed from a longer web copy. */
  readonly completed: number
  /** Stored messages whose text the web copy replaced (edit / regeneration). */
  readonly replaced: number
  /** Stored messages the web copy does not have (kept). */
  readonly kept: number
}

interface StoreFile {
  version: number
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
 * The shortest text that may be accepted as a PARTIAL copy of another (chars).
 *
 * Below this, "one is a prefix of the other" stops identifying anything: 「回答
 * 2」 is a prefix of 「回答 29」, and 「继续」 is a prefix of 「继续吧」 — pairing
 * those would silently graft one turn's id onto another turn's text. Twelve
 * characters is comfortably past the shortest thing a reader types twice by
 * accident while still covering a truncated Chinese sentence.
 */
const MIN_PARTIAL_CHARS = 12

/**
 * A message's text reduced to what two copies of it must agree on.
 *
 * A recovered copy and a stored copy of the SAME message are not byte-equal:
 * the reasoning block is inline `<details>` markup that the DOM scraper and the
 * history endpoint reproduce differently, citation markers are renumbered per
 * render, and the page's HTML round-trip rearranges whitespace. Comparing the
 * raw strings therefore finds no overlap at all in exactly the case this
 * matters for — an old, truncated local copy of a conversation being re-synced.
 *
 * @param content - stored markdown.
 */
export function contentKey(content: string): string {
  return content
    // The reasoning block, closed… (`<details>` is how the panel stores it.)
    .replace(/<details[\s\S]*?<\/details>/gi, ' ')
    // …or still open, which is what a reply stored mid-thought looks like.
    .replace(/<details[\s\S]*$/i, ' ')
    .replace(/\[citation:\s*\d+\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when two message texts are the same message, or one is a short copy of it. */
function sameText(left: string, right: string): boolean {
  const a = contentKey(left)
  const b = contentKey(right)
  if (a === b) return true
  if (a === '' || b === '') return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= MIN_PARTIAL_CHARS && long.startsWith(short)
}

/** What one re-sync did to a stored transcript. */
export interface HistoryMerge {
  /** The transcript to keep: the stored messages, plus what was missing. */
  readonly messages: DSchatMessage[]
  /** Messages the store did not have at all (appended from the web copy). */
  readonly added: number
  /** Stored messages the web wrote out in full (a truncated local copy, completed). */
  readonly completed: number
  /** Stored messages whose text the web changed (an edit or a regeneration). */
  readonly replaced: number
  /** Stored messages the web copy does not contain at all (kept, never dropped). */
  readonly kept: number
  /** True when the result differs from what was stored. */
  readonly changed: boolean
}

/**
 * Keep the stored IDENTITY of every message the web copy also has.
 *
 * A re-sync used to replace `chat.messages` wholesale, which was wrong in a way
 * that shows: an id is the panel's handle on a row (the hover toolbar, the tail
 * delta, the search landing mark, and the `data-message-id` the anchor and the
 * question navigator scroll to), a timestamp is the reader's sense of when they
 * asked, and `thinkingMs` / `attachments` are facts measured or chosen LOCALLY
 * that the web copy simply does not carry. All of them were thrown away on
 * every sync, and the reader's own conversation re-rendered as a stranger's.
 *
 * So the stored list is the spine and the web copy is the news:
 *
 *   · a message both sides have keeps its id, ts and local extras — and is
 *     COMPLETED in place when the stored text is a truncated copy of the web's
 *     (the old DOM scraper stored whatever had rendered);
 *   · a message only the web has is appended (the sync's whole point);
 *   · a message only the store has is KEPT — it is a local record of something
 *     the web no longer shows, and deleting the reader's history is not this
 *     function's call to make.
 *
 * Alignment is by content, not by position: messages are matched in order on
 * their {@link contentKey}, which is what makes the two copies of a conversation
 * line up even when one of them is missing its first 28 turns. A stretch that
 * matches nothing on either side (an edit or a regeneration) is settled in
 * place, web text over local, so a regenerated answer does not appear twice.
 *
 * When NOTHING matches at all the two copies share no evidence of identity, and
 * the old rule applies: the longer list wins, because a sync may only ever grow
 * a transcript. Nothing is inferred from position in that case — pairing 2
 * stored messages with 2 of 30 unrelated ones would invent turns.
 *
 * @param existing - the stored messages, in order.
 * @param incoming - the freshly recovered messages, in order.
 */
export function mergeHistory(existing: readonly DSchatMessage[], incoming: readonly DSchatMessage[]): HistoryMerge {
  if (existing.length === 0) {
    return { messages: [...incoming], added: incoming.length, completed: 0, replaced: 0, kept: 0, changed: incoming.length > 0 }
  }
  if (incoming.length === 0) {
    return { messages: [...existing], added: 0, completed: 0, replaced: 0, kept: existing.length, changed: false }
  }

  /*
   * The anchors: every incoming message that matches a stored one, taken in
   * order. Greedy is enough and is deterministic — the page gives one copy of a
   * conversation, so a message matches at most a handful of candidates and the
   * earliest unused one is the right one.
   */
  const anchors: Array<{ incoming: number; stored: number }> = []
  let cursor = 0
  for (let i = 0; i < incoming.length; i += 1) {
    for (let j = cursor; j < existing.length; j += 1) {
      const next = incoming[i]
      const current = existing[j]
      if (next === undefined || current === undefined) continue
      if (next.role !== current.role) continue
      if (!sameText(current.content, next.content)) continue
      anchors.push({ incoming: i, stored: j })
      cursor = j + 1
      break
    }
  }
  if (anchors.length === 0) {
    const grow = incoming.length >= existing.length
    return grow
      ? { messages: [...incoming], added: incoming.length, completed: 0, replaced: 0, kept: 0, changed: true }
      : { messages: [...existing], added: 0, completed: 0, replaced: 0, kept: existing.length, changed: false }
  }

  const messages: DSchatMessage[] = []
  let added = 0
  let completed = 0
  let replaced = 0
  let kept = 0

  /**
   * Settle the stretch between two anchors.
   *
   * Equal lengths with matching roles mean the two copies are describing the
   * same TURNS, and a stretch like that is settled in place: the web text wins
   * where it differs, the stored id stays, and the answer does not appear twice.
   * That is what a regenerated reply looks like — the question is unchanged and
   * is therefore an anchor of its own, leaving a stretch of ASSISTANT messages
   * that share nothing.
   *
   * Length plus role alone was NOT enough, and the case it got wrong was
   * invisible: a turn that exists only locally (the reader asked it here and the
   * web never stored it) sits in the same SLOT as an unrelated web turn, so the
   * two stretches pair up one-for-one and the local text is overwritten while
   * keeping its own id. The reader's own words were gone, and nothing on screen
   * said so — the exact opposite of this function's promise that a sync may only
   * ever grow a transcript.
   *
   * So a stretch counts as "the same turns, revised" only when every USER
   * message in it is recognisably the same message ({@link sameText}). The user
   * half of a turn is what a reader typed and recognises: an answer can be
   * regenerated into something unrecognisable, a question cannot be replaced
   * without losing what was asked. When a question does not match, the stretch
   * is settled as one-sided on BOTH sides — the store's copy first, then the
   * web's — which is the honest reading and never drops text.
   */
  const gap = (stored: readonly DSchatMessage[], fresh: readonly DSchatMessage[]): void => {
    const aligned = stored.length === fresh.length
      && stored.every((message, index) => message.role === fresh[index]?.role)
    const sameQuestions = aligned && stored.every((message, index) => {
      if (message.role !== 'user') return true
      const next = fresh[index]
      return next !== undefined && sameText(message.content, next.content)
    })
    if (aligned && sameQuestions) {
      stored.forEach((message, index) => {
        const next = fresh[index]
        if (next === undefined) return
        messages.push(withLocalIdentity(message, next))
        replaced += 1
      })
      return
    }
    for (const message of stored) {
      messages.push(message)
      kept += 1
    }
    for (const message of fresh) {
      messages.push(message)
      added += 1
    }
  }

  let storedAt = 0
  let incomingAt = 0
  for (const anchor of anchors) {
    gap(existing.slice(storedAt, anchor.stored), incoming.slice(incomingAt, anchor.incoming))
    const stored = existing[anchor.stored]
    const next = incoming[anchor.incoming]
    if (stored !== undefined && next !== undefined) {
      messages.push(withLocalIdentity(stored, next))
      const before = contentKey(stored.content)
      const after = contentKey(next.content)
      if (before !== after && before.length > 0 && (after.startsWith(before) || before.startsWith(after))) completed += 1
    }
    storedAt = anchor.stored + 1
    incomingAt = anchor.incoming + 1
  }
  gap(existing.slice(storedAt), incoming.slice(incomingAt))

  const changed = messages.length !== existing.length
    || messages.some((message, index) => message !== existing[index])
  return { messages, added, completed, replaced, kept, changed }
}

/**
 * The stored message, wearing the web copy's text.
 *
 * Everything the reader already has a handle on survives: the id (the panel
 * keys rows by it), the timestamp (their own record of when they asked),
 * `thinkingMs` (measured locally), `attachments` (chosen locally — the web copy
 * carries no paths) and any `error` the panel recorded. The web copy supplies
 * the text, whether it is still streaming, and the citations it resolved.
 *
 * @param stored - the message already in the transcript.
 * @param incoming - the same message as the web copy has it.
 */
function withLocalIdentity(stored: DSchatMessage, incoming: DSchatMessage): DSchatMessage {
  const sameContent = contentKey(stored.content) === contentKey(incoming.content)
  // A truncated local copy is completed; an identical one is left alone, so a
  // re-sync that finds nothing new does not rewrite a single byte.
  const content = sameContent ? stored.content : incoming.content
  const sources = incoming.sources === undefined ? stored.sources : incoming.sources
  const error = incoming.error === undefined ? stored.error : incoming.error
  /*
   * The very same object comes back when nothing about the message changed.
   * That is not an optimisation: `importTranscript` reports "changed" by
   * identity, and the store's own persist is armed by that flag — a sync that
   * found nothing new must leave the file (and every row the panel keys by
   * reference) exactly as it was.
   */
  if (content === stored.content && sources === stored.sources && error === stored.error && incoming.streaming === stored.streaming) {
    return stored
  }
  return {
    ...stored,
    content,
    streaming: incoming.streaming,
    ...(sources === undefined ? {} : { sources }),
    ...(error === undefined ? {} : { error }),
  }
}

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

  /**
   * False when this process must NOT write (a newer on-disk format, or another
   * live instance owns the file).
   *
   * Reads keep working and the in-memory history keeps serving, because refusing
   * to write must not look like refusing to run — but clobbering the file is not
   * an option either, and the reason is reported through {@link storeWarning}.
   */
  private writable = true

  /** The lock file this instance created, when it holds one. */
  private lockFile: string | undefined

  constructor(options: TranscriptStoreOptions = {}) {
    this.dataDir = options.dataDir ?? defaultDataDir()
    this.file = join(this.dataDir, 'transcripts.json')
    /*
     * The lock is taken BEFORE the first write and after the first read, so the
     * refusal below can be decided in the right order: a second instance learns
     * it must not write while the history is still readable, instead of losing
     * the race and overwriting a live transcript.
     */
    const loaded = this.read()
    this.chats = loaded.chats
    this.activeChatId = loaded.activeChatId
    this.acquireLock()
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
   * Claim the transcript file, or stand down if another live process has it.
   *
   * Two harness instances pointed at one data dir used to be a silent
   * last-writer-wins race: each kept a whole copy of the history in memory and
   * rewrote the file on every change, so whichever quit last erased everything
   * the other had added. The lock (`transcripts.json.lock`, holding a pid) turns
   * that into a named condition the reader can act on.
   *
   * Ownership is decided by LIVENESS rather than by the file existing, because a
   * crash must not lock the reader out of their own history forever: a lock whose
   * pid is gone is taken over. Same-process holders (the tests, a second store on
   * one dir) are simply us.
   */
  private acquireLock(): void {
    const lock = `${this.file}.lock`
    try {
      mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
      writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 })
      this.lockFile = lock
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') {
        // An unwritable data dir is already reported by the first write attempt;
        // failing here would turn "cannot lock" into "cannot start".
        return
      }
    }
    let owner = Number.NaN
    try {
      owner = Number.parseInt(readFileSync(lock, 'utf8').trim(), 10)
    } catch {
      // An unreadable lock is treated as "no usable owner" and taken over.
    }
    if (Number.isInteger(owner) && owner !== process.pid && isProcessAlive(owner)) {
      this.writable = false
      this.warn(
        `另一份 DSH 实例（pid ${String(owner)}）正在使用同一份会话记录（${this.file}）。` +
        '为避免互相覆盖，本次只读：新消息仍会显示，但不会写入磁盘，请关掉另一个实例后重启。',
      )
      return
    }
    try {
      // A stale lock (a crashed owner, an unreadable one): take it over.
      writeFileSync(lock, String(process.pid), { mode: 0o600 })
      this.lockFile = lock
    } catch {
      // Best effort: without the lock we behave as before, still reporting any
      // real write failure.
    }
  }

  /**
   * Land everything pending and give the lock back.
   *
   * Called from the plugin's disposer: a normal shutdown should not leave a lock
   * file behind for the next start to reason about — liveness handles the crash
   * case, this handles the tidy one.
   */
  dispose(): void {
    this.flush()
    if (this.lockFile === undefined) return
    try {
      rmSync(this.lockFile, { force: true })
    } catch {
      // Leaving it is harmless: the pid is gone, so the next start takes over.
    }
    this.lockFile = undefined
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
      return { version: STORE_VERSION, chats: [] }
    }
    try {
      const parsed = JSON.parse(text) as Partial<StoreFile>
      /*
       * A NEWER format is read as far as possible and then left alone.
       *
       * The version field was written and never read, so a future v2 file —
       * extra fields, a different message shape — was loaded as v1: whatever
       * this build did not recognise was dropped, and the next write replaced
       * the original with that reduced copy. Refusing to write is the only
       * honest answer when the reader's data is newer than the reader.
       */
      const version = typeof parsed.version === 'number' ? parsed.version : STORE_VERSION
      if (version > STORE_VERSION) {
        this.writable = false
        this.warn(
          `会话记录文件是新版本（v${String(version)}，本插件只到 v${String(STORE_VERSION)}）。` +
          '本次只读：历史仍可查看，但不会写回，以免丢掉新版本的字段。请升级 dsh-dschat 插件。',
        )
      }
      const chats = Array.isArray(parsed.chats) ? parsed.chats : []
      return {
        version,
        activeChatId: typeof parsed.activeChatId === 'string' ? parsed.activeChatId : undefined,
        chats: chats.filter(chat => typeof chat?.id === 'string' && Array.isArray(chat.messages)),
      }
    } catch (error) {
      // Unparseable JSON: quarantine before the first write can land, or the
      // only copy of every conversation is gone.
      this.warn(`会话记录文件无法解析（${String(error)}）${this.quarantine()}。本次以空历史启动。`)
      return { version: STORE_VERSION, chats: [] }
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
   * The atomic, DURABLE write: tmp file → fsync → rename → fsync the directory.
   *
   * `tmp + rename` alone is atomic against a crash of the WRITER, which is all
   * it was ever claimed to be — but it says nothing about the bytes reaching the
   * platter. A rename that lands while the file's contents are still in the page
   * cache leaves, after a power cut, a file that is present, correctly named and
   * EMPTY. Both fsyncs are needed for that reason, and for different halves of
   * it: the first flushes the data before the name can point at it, the second
   * flushes the directory entry that does the pointing.
   *
   * The tmp name carries the pid, so two processes writing one data dir cannot
   * destroy each other's half-written file — they no longer share a name to
   * collide on.
   *
   * Failures are caught, not thrown: the debounced write runs from a bare
   * `setTimeout`, so a throw here (ENOSPC, EACCES, a read-only volume) escaped
   * as an uncaught exception in the HOST process — the plugin could take the app
   * down to report a full disk. The message is recorded and surfaced through
   * `/state` instead, and the in-memory history stays served.
   */
  private writeNow(): void {
    if (!this.writable) return
    const tmp = `${this.file}.${String(process.pid)}-${randomUUID().slice(0, 8)}.tmp`
    try {
      mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
      const payload: StoreFile = { version: STORE_VERSION, activeChatId: this.activeChatId, chats: this.chats }
      // Compact, not `null, 2`: this file is machine-written and can reach
      // megabytes, and the streaming path rewrites it. Indenting it doubled both
      // the serialize cost and the bytes for no reader's benefit.
      const data = JSON.stringify(payload)
      const handle = openSync(tmp, 'w', 0o600)
      try {
        writeSync(handle, data)
        fsyncSync(handle)
      } finally {
        closeSync(handle)
      }
      renameSync(tmp, this.file)
      syncDirectory(this.dataDir)
    } catch (error) {
      // The tmp file is this call's own; leaving it behind would accumulate one
      // dead megabyte per failed write.
      try {
        rmSync(tmp, { force: true })
      } catch {
        // Nothing left to do about it, and it must not mask the real error.
      }
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
   * whether it was created and what the sync changed.
   *
   * Matching is by web session id first and exact title second. The title-only
   * dedup this replaces made re-syncing "idempotent" in the worst way: an
   * import that had been truncated (the old scraper only saw the rows the
   * virtual list had mounted) could never be repaired, because the second
   * recover matched the title and returned the short transcript unchanged.
   *
   * A refresh is now a MERGE, not a replacement — see {@link mergeHistory}. The
   * messages the store already had keep their ids, timestamps and local extras,
   * the ones it was missing are appended, and a truncated copy is completed in
   * place. A recover that comes back with fewer bytes still never truncates what
   * is already stored.
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
  }): ImportResult {
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
      const merged = mergeHistory(existing.messages, incoming)
      if (merged.changed) {
        existing.messages = merged.messages
        existing.updatedAt = Date.now()
        changed = true
      }
      // The id adoption must be persisted even when the history itself was not
      // touched, or the sidebar keeps offering a conversation that is already
      // imported.
      if (changed) this.persist()
      return {
        chat: existing,
        created: false,
        updated: merged.changed,
        added: merged.added,
        completed: merged.completed,
        replaced: merged.replaced,
        kept: merged.kept,
      }
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
    return { chat, created: true, updated: false, added: incoming.length, completed: 0, replaced: 0, kept: 0 }
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
