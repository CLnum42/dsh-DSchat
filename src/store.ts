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
  /**
   * Duplicate local transcripts of this same conversation that were folded into
   * one (0 or 1). Non-zero means the sync REPAIRED a list that showed the
   * conversation twice — see {@link TranscriptStore.resolveImportTarget}.
   */
  readonly merged?: number
  /** True when the conversation was created pinned from the web's own 置顶 flag. */
  readonly pinned?: boolean
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

/**
 * Whether a stored transcript IS the same web conversation as an incoming
 * import, judged by what was asked rather than by any name.
 *
 * The case this exists for: a conversation the reader started in the PANEL and
 * later synced from the web. The panel names a chat after the first question it
 * carried; the web names the same conversation with a generated summary — so a
 * title match can never find it, and before the panel recorded web session ids
 * at all (see `DeepSeekWebEngine.stampWebSessionId`) a sync simply wrote a
 * SECOND copy of the conversation under the web's title. Measured on this
 * machine: 59 of 203 synced conversations had exactly that twin.
 *
 * The identity test is the reader's own words, the one part of a turn that
 * survives a regeneration: the candidate's first question must be the incoming
 * copy's first question, and every later question it holds must appear in the
 * incoming copy, in the same order. The opening question is what keeps two
 * conversations that merely overlap in the middle from being folded together —
 * the same first question IS the same history; the same third question is not.
 * A local question the web copy does not contain also refuses the match, since
 * the merge would otherwise reorder or duplicate the reader's own turns.
 *
 * @param candidate - a stored transcript with no web session id yet.
 * @param incoming - the freshly recovered messages, in order.
 */
export function looksLikeSameConversation(candidate: readonly DSchatMessage[], incoming: readonly DSchatMessage[]): boolean {
  const askedBefore = candidate.filter(message => message.role === 'user').map(message => message.content)
  const askedNow = incoming.filter(message => message.role === 'user').map(message => message.content)
  const first = askedBefore[0]
  const firstNow = askedNow[0]
  if (first === undefined || firstNow === undefined || !sameText(first, firstNow)) return false
  let cursor = 0
  for (const question of askedBefore) {
    let found = -1
    for (let index = cursor; index < askedNow.length; index += 1) {
      const next = askedNow[index]
      if (next !== undefined && sameText(question, next)) { found = index; break }
    }
    if (found < 0) return false
    cursor = found + 1
  }
  return true
}

/**
 * Whether two LOCAL transcripts are the same conversation, one being an exact
 * prefix of the other.
 *
 * This is a STRICTER test than {@link looksLikeSameConversation}, and it has to
 * be: that one compares a local chat against the web's copy of a conversation
 * already identified by session id, so a weak match can only ever mis-merge two
 * copies of the same thing. Here both sides are arbitrary local chats and a
 * wrong answer DELETES a row, so the test is message-by-message — same roles,
 * same texts, in the same order — rather than question-by-question.
 *
 * The first attempt reused the question test with the two sides swapped, and a
 * dry run over a real 574-row store proved it wrong: a one-question chat matches
 * ANY conversation that opens with that question, 54 pairs were folded, and 252
 * messages disappeared (the two copies' contents did not line up, so the merge
 * kept one side). Pairing on the messages themselves makes a false positive
 * require two conversations that agree on the same question AND the same answer,
 * which is the same conversation.
 *
 * @param left - one local transcript's messages.
 * @param right - the other's.
 */
export function sameConversationCopies(left: readonly DSchatMessage[], right: readonly DSchatMessage[]): boolean {
  return isMessagePrefix(left, right) || isMessagePrefix(right, left)
}

/** Whether `shorter` is the first N messages of `longer`, identically. */
function isMessagePrefix(shorter: readonly DSchatMessage[], longer: readonly DSchatMessage[]): boolean {
  if (shorter.length === 0 || shorter.length > longer.length) return false
  for (let index = 0; index < shorter.length; index += 1) {
    const a = shorter[index]
    const b = longer[index]
    if (a === undefined || b === undefined || a.role !== b.role) return false
    if (!sameText(a.content, b.content)) return false
  }
  return true
}

/**
 * Union two prefix-aligned copies of one conversation into the survivor's
 * message list.
 *
 * Deliberately NOT `mergeHistory`: that one exists for merging a WEB copy into
 * a local transcript, so on a turn whose two texts differ it takes the incoming
 * one — correct when the incoming side is the server's own record, WRONG here,
 * where the other side is just another local copy that may be the truncated one.
 * A dry run over a real store caught exactly that: folding replaced the panel
 * copy's full reasoning block with the synced copy's shorter rendering, so
 * messages that existed before the fold were gone after it.
 *
 * The rule instead: the SURVIVOR's own text is what the reader has been
 * reading, so it is kept — with one exception, the case a merge exists for at
 * all: when the other copy is a longer version of the SAME message (a truncated
 * reply the web had written out in full), its text completes the survivor's.
 * Everything about the message object stays: its id, its timestamp, the extras
 * measured locally.
 *
 * Note which difference that leaves alone. The two copies of one reply can
 * render its reasoning differently — the panel's live parser lists the pages it
 * opened, while the fragment copy lists the queries it searched — and neither
 * text contains the other. Choosing "the longer" would silently rewrite the
 * reader's message; choosing "the survivor's" keeps their record as it was, and
 * the dropped variant belongs to the copy being folded away.
 *
 * @param survivor - the transcript that will be kept.
 * @param other - the duplicate being folded into it.
 */
function unionPrefixCopies(survivor: readonly DSchatMessage[], other: readonly DSchatMessage[]): DSchatMessage[] {
  const out: DSchatMessage[] = []
  const total = Math.max(survivor.length, other.length)
  for (let index = 0; index < total; index += 1) {
    const keep = survivor[index]
    const fresh = other[index]
    if (keep === undefined) {
      if (fresh !== undefined) out.push(fresh)
      continue
    }
    if (fresh === undefined) {
      out.push(keep)
      continue
    }
    // `contentKey` ignores the reasoning block and citation markers, so this
    // compares the ANSWER: a longer one means the survivor's was truncated.
    const completes = contentKey(fresh.content).length > contentKey(keep.content).length
    out.push(completes ? { ...keep, content: fresh.content } : keep)
  }
  return out
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
      // The first row of the LIST, which is what the reader sees at the top:
      // 置顶 first, then most recently used (see `ordered`). This used to read
      // `.at(-1)` — the oldest conversation — so a store whose activeChatId had
      // gone stale reopened history at the wrong end.
      this.activeChatId = this.ordered()[0]?.id
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

  /**
   * All chats, in the order the list shows them: 置顶 first (most recently
   * pinned first), then newest-used first.
   *
   * The array itself is kept in CREATION order (`createChat` and
   * `importTranscript` unshift), which is not the same thing and was a real
   * ordering bug: a batch sync imports conversations newest-web-first, so
   * unshifting each one left the whole batch REVERSED — the oldest conversation
   * of the account sitting at the top of the list (measured on this machine:
   * 494 of 504 imported rows in reverse web order). Ordering is a property of
   * the list, so it is computed here rather than left to whatever order
   * mutations happened to leave behind.
   */
  list(): DSchatTranscript[] {
    return this.ordered()
  }

  /** `list()`'s order, for the store's own "which chat is first" fallbacks. */
  private ordered(): DSchatTranscript[] {
    return [...this.chats].sort((left, right) => {
      const leftPinned = left.pinned === true
      const rightPinned = right.pinned === true
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1
      if (leftPinned && rightPinned) {
        const pinnedDelta = (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0)
        if (pinnedDelta !== 0) return pinnedDelta
      }
      const delta = right.updatedAt - left.updatedAt
      if (delta !== 0) return delta
      /*
       * Equal times keep the order the array already has — newest-CREATED first,
       * because `createChat` and `importTranscript` unshift. `Array.prototype.sort`
       * is stable (ES2019), so returning 0 IS the tiebreak; comparing ids here
       * instead shuffled two conversations created in the same millisecond into
       * an arbitrary order (caught by the state-route test, which restores two
       * chats back to back).
       */
      return 0
    })
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
    /**
     * The web account's own 置顶 flag for this conversation.
     *
     * It MIRRORS the web: `true` pins the local row, `false` unpins it —
     * including on a conversation that is already stored. Absent means "this
     * caller does not know", and then nothing is changed.
     *
     * The first version only applied it at creation, on the theory that the pin
     * is a local arrangement the sync must not fight. That read the requirement
     * backwards: 置顶 lives on the web account, and the reported symptom was
     * exactly "网页同步没有同步置顶状态" — the two conversations the reader had
     * pinned in the browser stayed unpinned here, because they were already
     * imported and a sync therefore never touched them. A pin made here and not
     * on the web is the thing that does not survive a sync; the reader can see
     * that from the list, which is what the sync is for.
     */
    pinned?: boolean
    /**
     * The conversation's own web times, in epoch ms.
     *
     * A recovered transcript used to be stamped with the moment of the IMPORT,
     * so a batch sync gave every conversation the same `updatedAt` and the list
     * read as "all of these were used just now" — and, because each import went
     * to the top of the array, the batch came out in reverse order (measured:
     * 494 of 504 imported rows). These are the times the list is ordered and
     * dated by.
     */
    createdAt?: number
    updatedAt?: number
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
    const target = this.resolveImportTarget(cleanTitle, input.webSessionId, input.matchByTitle === true, incoming)
    if (target.chat !== undefined) {
      /*
       * Which of the two records survives a duplicate fold.
       *
       * The id-less one, when there is one: it is the chat the READER made and
       * knows by a title they wrote (or their own first question), and it has
       * been their handle on the conversation all along. The synced copy that
       * caused the duplicate is the one that goes — after its messages are
       * folded in, so nothing it uniquely held is lost.
       */
      const survivor = target.twin ?? target.chat
      const folded = target.twin === undefined ? undefined : target.chat
      let changed = this.activeChatId !== survivor.id
      this.activeChatId = survivor.id
      if (input.webSessionId !== undefined && survivor.webSessionId !== input.webSessionId) {
        survivor.webSessionId = input.webSessionId
        changed = true
      }
      /*
       * The union of the two stored copies first, then the web copy over it, so
       * the counters describe the SYNC (what the web added to what the reader
       * had) rather than the bookkeeping of the fold.
       */
      const stored = folded === undefined ? survivor.messages : mergeHistory(survivor.messages, folded.messages).messages
      const merged = mergeHistory(stored, incoming)
      if (merged.changed) {
        survivor.messages = merged.messages
        changed = true
      }
      /*
       * The conversation's own time comes from the WEB copy, not from the clock
       * this sync happens to run on. That is what makes the list order and the
       * "· X 前" stamp mean something for a conversation that was imported
       * rather than chatted in here.
       *
       * Applied whenever the caller supplied one — not only when the merge
       * changed something — because repairing the times of an EXISTING
       * transcript is exactly the case that was broken: a batch sync had stamped
       * every one of them with its own import time. A trailing message the web
       * does not have yet can make the local copy momentarily newer; the merge
       * keeps that message, and the next sync moves the stamp on.
       */
      if (input.updatedAt !== undefined && input.updatedAt > 0 && survivor.updatedAt !== input.updatedAt) {
        survivor.updatedAt = input.updatedAt
        changed = true
      }
      if (input.pinned !== undefined) {
        const pinned = input.pinned === true
        if ((survivor.pinned === true) !== pinned) {
          if (pinned) {
            survivor.pinned = true
            // Keep the moment it was first pinned: the block is ordered by it,
            // and a re-sync is not a fresh pin.
            survivor.pinnedAt = survivor.pinnedAt ?? Date.now()
          } else {
            delete survivor.pinned
            delete survivor.pinnedAt
          }
          changed = true
        }
      }
      if (folded !== undefined) {
        this.chats = this.chats.filter(chat => chat.id !== folded.id)
        changed = true
      }
      // The id adoption must be persisted even when the history itself was not
      // touched, or the sidebar keeps offering a conversation that is already
      // imported.
      if (changed) this.persist()
      return {
        chat: survivor,
        created: false,
        updated: merged.changed || folded !== undefined,
        added: merged.added,
        completed: merged.completed,
        replaced: merged.replaced,
        kept: merged.kept,
        ...(folded === undefined ? {} : { merged: 1 }),
      }
    }
    const now = Date.now()
    const chat: DSchatTranscript = {
      id: `chat-${now.toString(36)}-${randomUUID().slice(0, 6)}`,
      title: cleanTitle,
      /*
       * The conversation's own times when the caller has them (a recover does:
       * the web stores both), the moment of this import otherwise. A batch sync
       * would otherwise file two years of conversations under one timestamp.
       */
      createdAt: input.createdAt !== undefined && input.createdAt > 0 ? input.createdAt : now,
      updatedAt: input.updatedAt !== undefined && input.updatedAt > 0 ? input.updatedAt : now,
      model: input.model,
      messages: incoming,
      streaming: false,
      ...(input.webSessionId === undefined ? {} : { webSessionId: input.webSessionId }),
      // 置顶 mirrors the web account (see the input's own note).
      ...(input.pinned === true ? { pinned: true, pinnedAt: now } : {}),
    }
    this.chats.unshift(chat)
    this.activeChatId = chat.id
    this.persist()
    return {
      chat,
      created: true,
      updated: false,
      added: incoming.length,
      completed: 0,
      replaced: 0,
      kept: 0,
      ...(input.pinned === true ? { pinned: true } : {}),
    }
  }

  /**
   * Fold local DUPLICATES of one web conversation into a single row.
   *
   * The repair that `importTranscript`'s twin adoption cannot reach. That one
   * fires when a conversation is synced, and a conversation an earlier version
   * already imported is by definition never synced again (`missing` excludes it)
   * — so on this machine the 59 pairs the old sync created were still there
   * after the fix, each showing one conversation twice under two titles.
   *
   * Neither side needs the web for this: two local transcripts are compared
   * message-by-message ({@link sameConversationCopies}), and their messages are
   * unioned. The reader's own record survives — the id-less one, with the title
   * they know it by — and it takes over the web session id, so the pair becomes
   * one row that later syncs address correctly.
   *
   * Conservative on purpose: exactly ONE id-less candidate, or nothing happens.
   * A fold is not reversible from the UI, and merging the wrong two
   * conversations would be worse than leaving a duplicate visible. (The first
   * version of the test was not conservative enough and was caught by running it
   * over a real store — see `sameConversationCopies`.)
   *
   * @returns how many duplicates were folded away.
   */
  foldDuplicateConversations(): number {
    let folded = 0
    for (const synced of [...this.chats]) {
      if (synced.webSessionId === undefined) continue
      if (!this.chats.some(chat => chat.id === synced.id)) continue
      const candidates = this.chats.filter(candidate =>
        candidate.id !== synced.id
        && candidate.webSessionId === undefined
        && candidate.streaming !== true
        && candidate.messages.length > 0
        && synced.messages.length > 0
        && sameConversationCopies(candidate.messages, synced.messages))
      if (candidates.length !== 1) continue
      const twin = candidates[0]
      if (twin === undefined) continue
      twin.webSessionId = synced.webSessionId
      // A dedicated union, not `mergeHistory` — see `unionPrefixCopies` for the
      // truncation that method caused here.
      const merged = unionPrefixCopies(twin.messages, synced.messages)
      if (merged.some((message, index) => message !== twin.messages[index]) || merged.length !== twin.messages.length) {
        twin.messages = merged
      }
      this.chats = this.chats.filter(chat => chat.id !== synced.id)
      if (this.activeChatId === synced.id) this.activeChatId = twin.id
      folded += 1
    }
    if (folded > 0) this.persist()
    return folded
  }

  /**
   * Mirror the web account's own list state onto the conversations already
   * stored: which are 置顶, and when each was last used.
   *
   * This is the HALF OF A SYNC THAT NEEDS NO HISTORY READ. 「从网页同步」 used
   * to do nothing at all for a conversation it had already imported — that is
   * what `missing` means — so a reader who pinned a conversation in the browser,
   * or who had imported an old transcript before the plugin recorded real
   * times, could click the button forever and see no change. The list endpoint
   * already carries both facts for the whole account, so applying them costs one
   * request and fixes the arrangement of hundreds of rows at once.
   *
   * Conversations with no web session id (chatted here and never synced) are not
   * touched: the web has never heard of them.
   *
   * @param rows - the web's list, as `listWebConversations` reports it.
   */
  applyWebListState(rows: readonly { sessionId?: string; pinned?: boolean; updatedAt?: number }[]): {
    matched: number
    pinned: number
    unpinned: number
    retimed: number
  } {
    let matched = 0
    let pinned = 0
    let unpinned = 0
    let retimed = 0
    let changed = false
    for (const row of rows) {
      if (row.sessionId === undefined || row.sessionId === '') continue
      const chat = this.chats.find(candidate => candidate.webSessionId === row.sessionId)
      if (chat === undefined) continue
      matched += 1
      const wanted = row.pinned === true
      if ((chat.pinned === true) !== wanted) {
        if (wanted) {
          chat.pinned = true
          chat.pinnedAt = chat.pinnedAt ?? Date.now()
          pinned += 1
        } else {
          delete chat.pinned
          delete chat.pinnedAt
          unpinned += 1
        }
        changed = true
      }
      /*
       * The web's time never lands on a conversation with a reply in flight: the
       * reply loop is stamping that row as it streams, and a list read taken
       * seconds ago would drag it backwards mid-turn. The pin is harmless there
       * (it is not a time), so only the retime is skipped.
       */
      if (row.updatedAt !== undefined && row.updatedAt > 0 && chat.updatedAt !== row.updatedAt && chat.streaming !== true) {
        chat.updatedAt = row.updatedAt
        retimed += 1
        changed = true
      }
    }
    if (changed) this.persist()
    return { matched, pinned, unpinned, retimed }
  }

  /**
   * Which stored chat an incoming import belongs to, and whether a duplicate
   * copy of the same conversation should be folded into it.
   *
   * Three tests for the target, in descending order of confidence:
   *
   *   1. the web session id — a conversation's real identity;
   *   2. the exact title, when the caller asked for it and there is no id;
   *   3. the reader's own questions (see {@link looksLikeSameConversation}) —
   *      the repair path for a chat the panel created before it recorded web
   *      session ids. Without it, the first sync after this plugin version
   *      would still write the twin it should have merged into.
   *
   * `twin` is the duplicate found by test 3 when test 1 or 2 already produced a
   * target: the two copies are the same conversation and the caller folds them
   * into one. One candidate only — two chats that both look like this
   * conversation mean the evidence is not specific enough to fold either, and
   * guessing would merge the reader's history into the wrong record. A chat
   * with a reply in flight is left alone as well: its merge would race the
   * streaming write.
   *
   * @param incoming - the messages being imported, for the question match.
   */
  private resolveImportTarget(title: string, webSessionId: string | undefined, matchByTitle: boolean, incoming: readonly DSchatMessage[]): { chat?: DSchatTranscript; twin?: DSchatTranscript } {
    const byId = webSessionId !== undefined && webSessionId !== ''
      ? this.chats.find(chat => chat.webSessionId === webSessionId)
      : undefined
    if (!matchByTitle) return byId === undefined ? {} : { chat: byId }
    const twin = this.uniqueTwin(incoming)
    if (byId !== undefined) {
      return twin === undefined || twin.id === byId.id ? { chat: byId } : { chat: byId, twin }
    }
    if (title !== DEFAULT_CHAT_TITLE) {
      const byTitle = this.chats.find(chat => chat.title === title && chat.webSessionId === undefined)
      if (byTitle !== undefined) return { chat: byTitle }
    }
    return twin === undefined ? {} : { chat: twin }
  }

  /** The single id-less stored chat that is this same web conversation, if any. */
  private uniqueTwin(incoming: readonly DSchatMessage[]): DSchatTranscript | undefined {
    const twins = this.chats.filter(chat =>
      chat.webSessionId === undefined
      && chat.streaming !== true
      && looksLikeSameConversation(chat.messages, incoming))
    return twins.length === 1 ? twins[0] : undefined
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

  /**
   * Record which web conversation this chat IS.
   *
   * Written by the engine the moment a panel turn has been accepted by the page
   * (see `DeepSeekWebEngine.stampWebSessionId`). Until v0.8 nothing set this
   * outside the recover path, which is why syncing a conversation the reader had
   * been chatting in created a SECOND local transcript of it: the sync had only
   * a title to match on, and the panel's title (the first question) is not the
   * web's generated title.
   *
   * Idempotent, and a no-op when the id is already right — a stamp on every turn
   * must not re-arm the persist debounce for nothing.
   *
   * @returns true when the id changed.
   */
  setWebSessionId(id: string, webSessionId: string): boolean {
    const chat = this.chats.find(candidate => candidate.id === id)
    if (chat === undefined || webSessionId === '' || chat.webSessionId === webSessionId) return false
    chat.webSessionId = webSessionId
    this.persist()
    return true
  }

  /**
   * Pin or unpin one conversation (the local counterpart of the web's 置顶).
   *
   * `pinnedAt` is refreshed on every pin so the pinned block is ordered by when
   * the reader actually pinned, newest first — the same way the web orders it.
   *
   * Deliberately NOT routed through `update()`: that stamps `updatedAt`, and
   * rearranging the list is not activity. Pinning would otherwise move the
   * conversation in the date order too, so unpinning it later would leave it
   * sitting at the top of the recent list as if it had just been used.
   */
  setPinned(id: string, pinned: boolean): DSchatTranscript | undefined {
    const chat = this.chats.find(candidate => candidate.id === id)
    if (chat === undefined) return undefined
    if (pinned) {
      chat.pinned = true
      chat.pinnedAt = Date.now()
    } else {
      delete chat.pinned
      delete chat.pinnedAt
    }
    this.persist()
    return chat
  }

  /** Delete one chat; a deleted active chat falls back to the first row left. */
  deleteChat(id: string): boolean {
    const before = this.chats.length
    this.chats = this.chats.filter(chat => chat.id !== id)
    if (this.chats.length === before) return false
    if (this.activeChatId === id) this.activeChatId = this.ordered()[0]?.id
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
