# Changelog

All notable changes to dsh-DSchat are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Versioning note: `0.5.1` and `0.6.0` are the first two releases cut from a
committed tree — everything before them shipped as `0.4.2` and earlier.

## [0.6.1] — 2026-10-10

Three defects reported against 0.6.0, and one prompt-cost decision. The panel
fixes need a page refresh; the prompt change takes effect on restart (the host
half assembles the prompt).

### Changed
- **The plugin no longer writes 786 characters into every system prompt.**
  `announceToAgent` defaulted to true, so every session — and every subagent, and
  every session in unrelated workspaces — carried a prose catalogue of the six
  `dschat_*` tools. Measured against the schemas the model already receives
  (4,626 characters), that was +17% of pure duplication: the tool inventory is
  the tools' own descriptions, the trigger words («网页端», «deepseek web»,
  «转移到 harness») are each tool's `Triggers:` line, and the login requirement,
  the "no API billing" note and the transfer's preview-then-confirm semantics are
  all already in the description of the tool they belong to. The harness's own
  guidance is explicit — say each fact once, do not repeat the tool definition in
  a system-prompt section — and no other installed plugin announces itself:
  `dsh-better-sidebar` contributes context per action via `agent.inject()`, and
  the rest contribute none. Default is now `false`; the opt-in text is one line,
  derived from tool visibility (`ctx.tools.get('dschat_status', scope)` returning
  `''` for an agent that cannot see the tools, which the assembler drops
  entirely). The one fact no schema carried — that the sidebar 「Chat」 panel is
  this plugin — moved into `dschat_status`'s description, where it costs nothing
  extra and disappears with the tool.

### Fixed
- **A new conversation's first exchange showed the answer and not the question.**
  `/state` carries summaries and `/chat?id=` carries one conversation's body, so
  selecting a conversation is two requests in flight at once. `refreshState` is
  what INTRODUCES a conversation the panel has never seen (「新对话」, a recover,
  another window) and the body request is answered first routinely — measured on
  a 222-conversation store, `/chat` answers in ~0.8 ms against `/state`'s
  ~3 ms. Applying that body to a list that did not carry the chat yet was a
  silent `chats.map` no-op, so nothing marked the conversation loaded, and every
  later poll replaced its messages with `[]` again. Only the /tail feed could put
  anything in it, and the tail carries the ANSWER: the transcript showed a reply
  with no question above it. Bodies now go through a count-checked cache, so a
  body that arrives before its summary is applied the moment the summary lands,
  and a conversation with no authoritative body is fetched when it is the one on
  screen.
- **A conversation with history rendered as a brand-new one.** The same empty
  body made the transcript fall into the empty branch — which IS the
  new-conversation page — once per poll, between the answer and the blank state.
  That blink was the reported 「一闪一闪」 and the 「突然回到新对话」. A
  conversation whose body is still on its way now says so (「正在载入这段对话…」)
  instead of offering to start a conversation, and a body already on screen is
  never replaced by that placeholder.
- **Searching inside a conversation never worked.** `DSCHAT_API` carried the key
  `search` twice — once for `GET /search-conversations`, once for the web-search
  TOGGLE — and a later key silently wins in an object literal, so the constant
  resolved to the toggle: every message search was a GET against a write-guarded
  route, a 405 the filter swallowed. The keys are now `searchConversations` and
  `search`, and `route-surface.test.ts` fails when two endpoints share a name or
  when a constant points at a path the host does not register.

### Added
- `test/new-chat-body.test.ts` — the snapshot/body race, driven with the real
  ordering and a MutationObserver, so "the page blinks" is measured rather than
  sampled.
- `test/route-surface.test.ts` — the route table against the host's registered
  paths, plus a source-level duplicate-key check (a repeated key is gone by the
  time the object exists, which is why the type system never saw it).
- `test/prompt-footprint.test.ts` — the DEFAULT configuration contributes no
  prompt text; the opt-in is capped at 200 characters so the catalogue cannot
  creep back unnoticed; and it renders empty for an agent the tools are hidden
  from. `host-smoke`'s "one section by default" assertion became "none".

## [0.6.0] — 2026-10-10

The release the review called "the road to shippable": the data plane, the
failure surface and the scraper's fidelity. Nothing here adds a feature the
reader asks for; all of it removes a way to lose work or to be misled.

### Fixed
- **The DOM fallback no longer loses text.** The HTML parser recognised a
  self-closing tag only by a literal `/>`, which standard HTML never writes for
  `<br>`, `<img>`, `<hr>` or `<input>`: each became an OPEN tag that collected
  every following sibling, and the markdown converter then discarded those
  children. The root cause was larger than the report — the parser compared each
  close tag against a synthetic node whose `tagName` was always `undefined`, so
  **no close tag ever matched** and every element swallowed the rest of the
  fragment. On the DOM-fallback paths `<pre>`/`<code>` bodies are read from
  `textContent`, which parsed nodes do not carry, so one code block took the code
  AND everything after it. Fixed all of it: close-tag matching, the void-element
  set, value-less attributes (`checked` was stored as `undefined`, so every
  scraped checkbox rendered unchecked), a `rawText` fallback for `code`/`pre`/
  `math`, and the code-fence language (`attributes.class`, not just `className`).
- **The store can no longer lose a whole history to a power cut.** Writes are
  `tmp → fsync(file) → rename → fsync(directory)`; the temp name carries the pid
  so two writers cannot share one intermediate file, and a failed write removes
  its own.
- **Two harness instances can no longer overwrite each other.** A single-writer
  lock (`transcripts.json.lock`, holding a pid) is decided by LIVENESS — a lock
  left by a crash is taken over, one held by a live process makes this instance
  read-only, with the reason reported in the status card.
- **A file written by a newer version is refused rather than reduced.** The
  `version` field was written and never read: a future format would have been
  loaded as this one's, losing every unrecognised field and then overwriting the
  original.
- **A local page can no longer clear the history.** Every mutating route is
  POST-only and requires a same-origin `Origin`/`Sec-Fetch-Site` plus a per-run
  CSRF token; the loopback check is fail-closed (`remoteAddress === undefined` is
  no longer treated as local).
- **A file outside the plugin's directories can no longer be uploaded or
  written.** `/send` requires attachment paths inside `<dataDir>/attachments`,
  `/export` writes only inside the configured export directory, and `/restore`
  validates the message shape instead of persisting whatever it is handed.
- **Stopping actually stops.** The stop button no longer queues behind the turn
  it interrupts, a timeout stops the page instead of leaving it generating, and
  the submit check is bound to the turn it belongs to.
- **A sync no longer overwrites local-only turns.** An equal-length stretch is
  settled in place only when every USER message in it is recognisably the same
  message.
- English interfaces no longer print the host's Chinese error strings: every
  route failure carries a structured code the panel renders through its own
  dictionary.

### Changed
- **`/state` answers with summaries.** It used to ship every transcript —
  5.75 MiB on a 220-conversation store, polled every 1.5 s (~3.8 MiB/s). The
  bodies now travel on `GET /chat?id=`, and message search moved to the host
  (`GET /search-conversations?q=`) because a client-side scan only ever saw the
  conversations it happened to have fetched. Measured on the real store:
  **5.75 MiB → 48.1 KiB per poll (122×)**.
- **Hand-offs are previewed before they are written.** `/transfer-preview` builds
  the exact first message, the panel shows it and lets it be edited, and the
  confirmed bytes are what gets written. A hand-off that had to fall back to the
  raw log says so instead of reporting the same success as a distilled brief. The
  agent tool previews by default and writes on `confirm: true`.
- Transfers to the panel now resolve their destination before doing the expensive
  distillation, so a bad workspace or a live target session costs nothing.

### Added
- `dschat_stop` — the tool the BUSY hint had always named without it existing.
- **Copy diagnostics** in the status card: version, build time, phase, engine
  error, page URL, last error with its code, store warning, resolved paths and
  the live `probe-page` output, in one click. It reports whether the copy worked
  instead of claiming success regardless.
- The status card shows the **running bundle's version and build time** (injected
  at build time) — `package.json`, the git tag, the newest tarball and the linked
  working tree are four different answers, and this is the one that is always
  right.
- The offline, signed-out and engine-error states each name themselves in the
  conversation and offer their own action, instead of living only in a 7px lamp's
  tooltip.

### Tests
146 → 169 cases. The new ones are the interesting part: a real-Chrome
end-to-end test that scrapes a page whose reply contains `<br>`, an image, a code
block and checkboxes and asserts what lands in the transcript; a falsification
run of the parser suite (all 10 cases fail without the fix); durability tests
driven against a **copy** of the real 5.72 MiB store; and a locale test that
every structured code has a sentence in both dictionaries and that the English
one carries no CJK.

## [0.5.1] — 2026-10-10

### Fixed
- The five P0 defects from the review: the route family's trust fence (method,
  origin, CSRF, fail-closed loopback), path convergence for `/send` `/export`
  `/restore`, transfer previews with a visible distillation fallback, a stop that
  works while an agent's send holds the engine, and a sync that no longer
  overwrites local-only content.
- The README's installation section, which claimed `link:` could not work. The
  2026-10-01 startup failure was a missing `dsh.client.platform`, not a symlink —
  quoted from the crash log now, along with a "when Harness will not start"
  section.
- `NOTICE` and the client entry's comment claimed a `settings.section` page and a
  Config form the shell renders. Neither exists.

[0.6.0]: https://github.com/CLnum42/dsh-DSchat/releases/tag/v0.6.0
[0.5.1]: https://github.com/CLnum42/dsh-DSchat/releases/tag/v0.5.1
