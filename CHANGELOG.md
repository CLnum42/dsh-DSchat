# Changelog

All notable changes to dsh-DSchat are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Versioning note: `0.5.1` and `0.6.0` are the first two releases cut from a
committed tree — everything before them shipped as `0.4.2` and earlier.

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
