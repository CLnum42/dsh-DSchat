/**
 * Dependency-free markdown renderer for the DSchat transcript.
 *
 * Small on purpose: headings, paragraphs, bold/italic, inline + fenced code
 * (with a copy action on the banner), links, DeepSeek `[citation:N]` markers,
 * ordered/unordered lists, blockquotes, GFM tables, horizontal rules, and the
 * `<details>` blocks DeepSeek uses for R1 thinking — rendered as this panel's
 * own disclosure, never as a raw `<details>` element (see {@link Thinking}).
 * Anything unrecognized renders as escaped plain text — never raw HTML.
 *
 * Class names are literal `dsh-dschat-*` strings rather than a CSS module: the
 * panel ships its stylesheet as a string, so there is no module mapping to
 * import.
 */

import { createElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { sourcesOf, type DSchatSource } from '../../protocol.ts'
import { CaretIcon, ThinkIcon } from '../icons.tsx'

/** Escape text for safe rendering (no dangerouslySetInnerHTML anywhere). */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Options threaded through the renderer. */
export interface MarkdownOptions {
  /** Called with a fenced block's body when its copy button is pressed. */
  onCopyCode?: (code: string) => void
  /**
   * Where a rendered link should go.
   *
   * The panel hands web links to the machine's own browser; this renderer must
   * not know that — it only reports the click and lets the caller decide.
   * Returning `false` means "I did not take it", and the anchor keeps its
   * native `target="_blank"` behaviour (which the desktop shell also routes to
   * the system browser). A modifier-click is never reported.
   */
  onOpenLink?: (href: string) => boolean | void
  /**
   * The reply's search sources, in the web's own citation order.
   *
   * `[citation:N]` carries a number only, so this table is what turns a dead
   * "数字注释" into a link to the page the answer actually cites. Without it
   * (an old transcript, a DOM-scraped reply) the marker stays a plain chip
   * rather than becoming a link to nowhere.
   */
  sources?: readonly DSchatSource[]
}

/**
 * The click contract shared by every anchor this renderer produces (plain
 * links, citation chips, and the source list at the end of a reply).
 *
 * The click is reported, never swallowed: `onOpenLink` returning false leaves
 * `defaultPrevented` untouched, so the anchor still does what it did before
 * this callback existed — `target="_blank"`, which the desktop shell hands to
 * the system browser. A modifier-click belongs to the user's own browser
 * gesture and is never intercepted.
 */
function linkClick(href: string | undefined, options: MarkdownOptions) {
  return (event: {
    metaKey?: boolean
    ctrlKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    button?: number
    preventDefault: () => void
  }): void => {
    if (href === undefined || options.onOpenLink === undefined) return
    if (event.button !== undefined && event.button !== 0) return
    if (event.metaKey === true || event.ctrlKey === true || event.shiftKey === true || event.altKey === true) return
    if (options.onOpenLink(href) === false) return
    event.preventDefault()
  }
}

/**
 * The citation numbers inside one `[citation:…]` marker.
 *
 * The web writes one number per marker, but a model occasionally emits a list
 * (`[citation:1,2]`) or a range (`[citation:2-3]`); both are expanded so a
 * clickable chip appears for every source the marker means. Ranges are clamped
 * — a marker is text from a web page, not a program.
 */
export function citationNumbers(body: string): number[] {
  const numbers: number[] = []
  const push = (value: number): void => {
    if (!Number.isInteger(value) || value < 1 || value > 9_999) return
    if (!numbers.includes(value)) numbers.push(value)
  }
  for (const token of body.split(/[,，、;；\s]+/)) {
    if (token === '') continue
    const range = /^(\d+)\s*[-–~至]\s*(\d+)$/.exec(token)
    if (range !== null) {
      const start = Number(range[1])
      const end = Number(range[2])
      const step = end >= start ? 1 : -1
      for (let value = start; value !== end + step && Math.abs(value - start) <= 20; value += step) push(value)
      continue
    }
    const single = /^\[?(\d+)\]?$/.exec(token)
    if (single !== null) push(Number(single[1]))
  }
  return numbers.slice(0, 20)
}

/** Human label for one source row: its title, else its host. */
function sourceLabel(source: DSchatSource): string {
  const title = source.title?.trim()
  if (title !== undefined && title !== '') return title
  try {
    const parsed = new URL(source.url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.host}${path}`
  } catch {
    return source.url
  }
}

/**
 * One `[citation:N]` marker as React nodes.
 *
 * A number whose source is known renders as a LINK to that page — which is the
 * whole point of the marker, and is what the web itself does. A number with no
 * source in the table (an old transcript stored before the URLs were captured,
 * or a reply recovered from the rendered DOM) stays the plain chip it always
 * was, so nothing points at a guessed URL.
 *
 * @param marker - the raw match, e.g. `[citation:2]`.
 * @param key - React key prefix.
 * @param options - renderer callbacks plus the source table.
 */
function citation(marker: string, key: string, options: MarkdownOptions): ReactNode {
  const body = marker.slice('[citation:'.length, -1).trim()
  const numbers = citationNumbers(body)
  const sources = options.sources
  if (numbers.length === 0) {
    return createElement('sup', { key: `${key}-cite`, className: 'dsh-dschat-cite' },
      createElement('span', { className: 'dsh-dschat-citation' }, body))
  }
  return createElement(
    'sup',
    { key: `${key}-cite`, className: 'dsh-dschat-cite' },
    numbers.map(number => {
      const source = sources?.[number - 1]
      const url = source?.url ?? ''
      if (url === '') {
        // Either no table at all, or a position the page named no URL for: the
        // chip stays a chip. A placeholder must never shift its neighbours.
        return createElement('span', { key: `${key}-c${number}`, className: 'dsh-dschat-citation' }, String(number))
      }
      const label = sourceLabel(source ?? { url })
      return createElement(
        'a',
        {
          key: `${key}-c${number}`,
          className: 'dsh-dschat-citation',
          href: url,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: `${label} · ${url}`,
          'aria-label': `${label} · ${url}`,
          onClick: linkClick(url, options),
        },
        String(number),
      )
    }),
  )
}

/**
 * Inline markdown → React nodes. One tokenizer pass: code spans win, then
 * links, then `[citation:…]`, then bold, then italic — every non-token run is
 * escaped text. Bold/italic recurse so a strong span can contain a link.
 *
 * @param text - the raw inline source.
 * @param keyBase - React key prefix for this run (unique per nesting path).
 * @param options - renderer callbacks (`onOpenLink` reaches every nested link).
 */
function inline(text: string, keyBase = 'i', options: MarkdownOptions = {}): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\[citation:[^\]]+\])|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\n]+\*|_[^_\n]+_)/g
  let last = 0
  let index = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(esc(text.slice(last, match.index)))
    const key = `${keyBase}-${index}`
    if (match[1] !== undefined) {
      nodes.push(createElement('code', { key: `${key}-code` }, match[1].slice(1, -1)))
    } else if (match[2] !== undefined) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(match[2])
      const href = link?.[2]
      nodes.push(createElement(
        'a',
        { key: `${key}-a`, href, target: '_blank', rel: 'noopener noreferrer', onClick: linkClick(href, options) },
        link?.[1],
      ))
    } else if (match[3] !== undefined) {
      nodes.push(citation(match[3], key, options))
    } else if (match[4] !== undefined) {
      const inner = match[4].slice(2, -2)
      nodes.push(createElement('strong', { key: `${key}-b` }, ...inline(inner, `${key}-b`, options)))
    } else if (match[5] !== undefined) {
      const inner = match[5].slice(1, -1)
      nodes.push(createElement('em', { key: `${key}-i` }, ...inline(inner, `${key}-i`, options)))
    }
    last = re.lastIndex
    index++
  }
  if (last < text.length) nodes.push(esc(text.slice(last)))
  return nodes
}

/**
 * The renderer's own surface copy, in ONE object.
 *
 * Threaded rather than looked up: `renderMarkdown` is a pure function (and is
 * exercised as one by the tests), so it cannot reach a locale service — and the
 * few strings down here are the ones a reader actually hovers («复制回复»,
 * «点击收起思考过程»). The panel passes `tr`-resolved values; the defaults exist
 * for the tests and for any embedder that only wants the markup.
 */
export interface MarkdownCopy {
  /** Label of every copy control (code blocks, the reply). */
  readonly copy?: string
  /** Tooltip of an expanded reasoning body, which has no summary line left. */
  readonly collapseHint?: string
  /** Summary label for a `<details>` block the web page wrote without one. */
  readonly details?: string
  /** Language label of a fenced block that declared none. */
  readonly language?: string
}

/** Fill in the fallbacks of a {@link MarkdownCopy}. */
function surfaceCopy(copy: MarkdownCopy | string | undefined): Required<MarkdownCopy> {
  const given = typeof copy === "string" ? { copy } : (copy ?? {})
  return {
    copy: given.copy ?? "copy",
    collapseHint: given.collapseHint ?? "Click to collapse the reasoning",
    details: given.details ?? "details",
    language: given.language ?? "text",
  }
}

/** One fenced code block, with the language label and a copy action. */
function codeBlock(language: string, body: string, key: string, options: MarkdownOptions, copy: Required<MarkdownCopy>): ReactNode {
  return createElement(
    'div',
    { key, className: 'dsh-dschat-code' },
    createElement(
      'div',
      { className: 'dsh-dschat-code-bar' },
      createElement('span', null, language === '' ? copy.language : language),
      createElement('span', { className: 'dsh-dschat-spacer' }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-dschat-code-copy',
          title: copy.copy,
          onClick: () => { options.onCopyCode?.(body) },
        },
        copy.copy,
      ),
    ),
    createElement('pre', null, createElement('code', null, body)),
  )
}

/** Split a table row into cells, honoring escaped pipes (\|). */
function splitCells(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const ch of line) {
    if (escaped) { current += ch; escaped = false }
    else if (ch === '\\') { escaped = true }
    else if (ch === '|') { cells.push(current); current = '' }
    else { current += ch }
  }
  cells.push(current)
  let start = 0
  let end = cells.length
  while (start < end && cells[start].trim() === '') start++
  while (end > start && cells[end - 1].trim() === '') end--
  return cells.slice(start, end).map(cell => cell.trim())
}

/** True when a line is a GFM table delimiter row (`:---`, `---:`, `:---:`, …). */
function isDelimiterRow(line: string): boolean {
  const cells = splitCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

/** Render one block of markdown text into React nodes. */
export function renderMarkdown(source: string, options: MarkdownOptions = {}, copy?: MarkdownCopy | string): ReactNode[] {
  const surface = surfaceCopy(copy)
  const raw = source.replace(/\r\n/g, '\n').trim()
  if (raw === '') return []
  const blocks: ReactNode[] = []
  const lines = raw.split('\n')
  let index = 0
  let blockIndex = 0

  const push = (node: ReactNode): void => {
    blocks.push(createElement('div', { key: `b${blockIndex++}` }, node))
  }

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    const fence = /^```([\w+-]*)\s*$/.exec(trimmed)
    if (fence !== null) {
      const language = fence[1] ?? ''
      const body: string[] = []
      index++
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        body.push(lines[index])
        index++
      }
      index++
      push(codeBlock(language, body.join('\n'), `code${blockIndex}`, options, surface))
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      const level = heading[1].length
      push(createElement(`h${level}` as 'h1', null, ...inline(heading[2], `h${blockIndex}`, options)))
      index++
      continue
    }

    // GFM table, checked before the horizontal-rule branch so a delimiter like
    // `--- | ---` is never mistaken for an hr.
    if (line.includes('|') && lines[index + 1] !== undefined && isDelimiterRow(lines[index + 1])) {
      const header = splitCells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length) {
        const row = lines[index]
        if (row.trim() === '' || !row.includes('|')) break
        rows.push(splitCells(row))
        index++
      }
      const width = Math.max(header.length, ...rows.map(row => row.length))
      const rowNode = (cells: string[], rowIndex: number): ReactNode =>
        createElement('tr', { key: rowIndex }, Array.from({ length: width }, (_, col) =>
          createElement('td', { key: col }, ...inline(cells[col] ?? '', `t${blockIndex}-${rowIndex}-${col}`, options))))
      blocks.push(createElement(
        'div',
        { key: `tw${blockIndex}`, className: 'dsh-dschat-table-wrap' },
        createElement('table', { className: 'dsh-dschat-table', key: `t${blockIndex}` },
          createElement('thead', null, createElement('tr', null, header.map((cell, col) =>
            createElement('th', { key: col }, ...inline(cell, `th${blockIndex}-${col}`, options))))),
          createElement('tbody', null, rows.map(rowNode))),
      ))
      blockIndex++
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      push(createElement('hr', { key: `hr${blockIndex}` }))
      index++
      continue
    }

    if (trimmed.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''))
        index++
      }
      push(createElement('blockquote', { key: `q${blockIndex}` }, ...renderMarkdown(quote.join('\n'), options, surface)))
      continue
    }

    // A `<details>` block inside the content (DeepSeek's own wrapper for R1
    // thinking, or one the author wrote). Rendered through this panel's
    // disclosure rather than as a raw element, so it follows the theme and the
    // reader gets the same control as the reasoning block above.
    if (/^<details>/.test(trimmed)) {
      const body: string[] = []
      /*
       * Where the summary lives depends on who wrote the block: the engine
       * writes it on the SAME line as the opener
       * (`<details><summary>思考过程</summary>`), while a hand-written one
       * usually puts it on its own line. Both are accepted — reading only the
       * second shape is what made a real thinking block render with the literal
       * summary "details".
       */
      let summary = /^<details>\s*<summary>\s*([\s\S]*?)\s*<\/summary>/.exec(trimmed)?.[1]
      index++
      while (index < lines.length && !/^<\/details>/.test(lines[index].trim())) {
        const line = lines[index]
        if (summary === undefined) {
          const own = /^<summary>\s*([\s\S]*?)\s*<\/summary>/.exec(line.trim())
          if (own !== null) {
            summary = own[1]
            index++
            continue
          }
        }
        body.push(line)
        index++
      }
      index++
      blocks.push(createElement('div', { key: `d${blockIndex++}` },
        createElement(Thinking, {
          source: body.join('\n'),
          label: summary ?? surface.details,
          options,
          copy: surface,
        })))
      continue
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*+]\s+/, ''))
        index++
      }
      push(createElement('ul', { key: `ul${blockIndex}` }, items.map((item, itemIndex) =>
        createElement('li', { key: itemIndex }, ...inline(item, `uli${blockIndex}-${itemIndex}`, options)))))
      continue
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ''))
        index++
      }
      push(createElement('ol', { key: `ol${blockIndex}` }, items.map((item, itemIndex) =>
        createElement('li', { key: itemIndex }, ...inline(item, `oli${blockIndex}-${itemIndex}`, options)))))
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index].trim()
      if (current === '') break
      if (/^(```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|<\/?(details|table)>)/.test(current)) break
      if (current.includes('|') && lines[index + 1] !== undefined && isDelimiterRow(lines[index + 1])) break
      paragraph.push(current)
      index++
    }
    if (paragraph.length === 0) {
      index++
      continue
    }
    push(createElement('p', { key: `p${blockIndex}` }, ...inline(paragraph.join('\n'), `p${blockIndex}`, options)))
  }

  return blocks
}

/**
 * The live reasoning line: 「思考中：<最新的思考内容>」.
 *
 * The reader asked for two things the plain 「思考中…」 label could not give
 * them: WHAT the model is thinking, and the newest of it. The text arrives
 * fragment by fragment (the engine re-renders the whole message on every tick),
 * so the line is a tail view rather than a summary:
 *
 *   - the prefix 「思考中：」 is a fixed element, so it is never scrolled out of
 *     sight and never truncated away — the reader always knows what they are
 *     looking at;
 *   - the reasoning itself gets ONE line and scrolls LEFT as it grows, which is
 *     the only way a line that is longer than its box can keep its newest
 *     characters visible. `translateX` is applied from a measurement (see the
 *     effect) rather than from `direction: rtl`, which would re-order the
 *     punctuation of mixed CJK/Latin text.
 *   - a shimmer sweeps the prefix while the thought is live, so "still running"
 *     is visible even when the text has not changed for a second.
 *
 * @param props.text - the reasoning accumulated so far (markdown-ish plain text).
 * @param props.prefix - the localized 「思考中：」 lead-in.
 */
function ThinkingLive({ text, prefix }: { text: string; prefix: string }): ReactNode {
  const tailRef = useRef<HTMLSpanElement | null>(null)

  /*
   * Park the tail on the newest characters.
   *
   * A layout effect, not a passive one: the shift has to be in the same frame
   * the new fragment paints in, or a fast stream shows the text jump once per
   * token. It runs on every text change (that IS the dependency) and re-measures
   * on resize, because the same text overflows at one panel width and not at
   * another.
   */
  useBrowserLayoutEffect(() => {
    const element = tailRef.current
    if (element === null) return
    const line = element.parentElement
    const shift = (): void => {
      const overflow = element.scrollWidth - (line?.clientWidth ?? 0)
      element.style.transform = overflow > 0 ? `translateX(${-overflow}px)` : ''
    }
    shift()
    if (typeof ResizeObserver === 'undefined' || line === null) return
    const observer = new ResizeObserver(shift)
    observer.observe(line)
    return () => observer.disconnect()
  }, [text])

  /*
   * Whitespace-collapse the reasoning before it reaches the line: the engine's
   * transcript keeps the blank lines between reasoning paragraphs, and a line
   * view of 「a\n\n\nb」 would spend its width on invisible characters.
   */
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return null
  return createElement(
    'span',
    { className: 'dsh-dschat-think-live' },
    createElement('span', { className: 'dsh-dschat-think-live-prefix' }, prefix),
    createElement(
      'span',
      { className: 'dsh-dschat-think-live-clip' },
      createElement('span', { className: 'dsh-dschat-think-live-tail', ref: tailRef }, flat),
    ),
  )
}

/**
 * `useLayoutEffect` where there is a DOM, `useEffect` where there is not.
 *
 * The panel only ever runs in a browser, but the render tests mount it through
 * `react-dom/server`, and a layout effect there is a warning rather than a
 * no-op — noise that would hide a real one. Choosing the hook once, at module
 * load, keeps the call itself unconditional (so hook order never changes).
 */
const useBrowserLayoutEffect: typeof useLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

/** True while the model is still producing this reasoning (not yet answering). */
function thinkingIsLive(thinkingMs: number | undefined, streaming: boolean | undefined): boolean {
  return thinkingMs === undefined && streaming === true
}

/**
 * Should this click on an expanded reasoning body fold it back?
 *
 * The body is the collapse control (see {@link Thinking}), so the guard has to
 * name the three ways a click inside it means something else:
 *
 *   - ON A LINK. The reasoning is markdown and may cite pages; a reader who
 *     follows one must not lose the text they were reading.
 *   - ON ANY OTHER CONTROL the renderer put in there (a code block's copy
 *     button), for the same reason.
 *   - WHILE TEXT IS SELECTED. Copying a line of the reasoning out is a normal
 *     thing to do with it, and a text drag ends in a click that would otherwise
 *     collapse the block out from under the selection.
 *
 * A modifier-click is deliberately NOT special-cased: it belongs to the link
 * (the anchor opens a background tab) and the link rule above already wins.
 *
 * @param target - the click's target, as React reports it.
 * @returns true when the click means "fold this away".
 */
function collapseFromBodyClick(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest('a, button') !== null) return false
  if (typeof window === 'undefined') return true
  const selection = window.getSelection()
  if (selection !== null && selection.isCollapsed === false && selection.toString() !== '') return false
  return true
}

/**
 * The reasoning block: one control, TWO mutually exclusive faces.
 *
 * Deliberately NOT `<details>`/`<summary>`, which is what the engine's stored
 * markdown wraps the reasoning in. A raw `<details>` renders with the browser's
 * own marker and its own type scale, ignores the panel's theme tokens, cannot
 * carry the 「已思考（用时 …）」 line the reader actually wants, and — the reason
 * this exists — leaves the summary text as whatever the engine wrote into the
 * string instead of something the panel knows (how long the model thought).
 * The panel splits the reasoning off the message and hands it here with that
 * duration already rendered into `label`.
 *
 *   - COLLAPSED (the default): exactly ONE line — the summary button, reading
 *     「已思考（用时 …）」 — and the reasoning is not in the DOM at all.
 *   - EXPANDED: the full reasoning and NOTHING else. The summary line is not
 *     rendered, because the reader who clicked asked for the thought, not for a
 *     label above it.
 *
 * The two faces never coexist. The earlier version kept the header mounted and
 * appended the body under it, which meant the one moment a reader could see the
 * reasoning (right after it finished, while the answer was still arriving) was
 * also the one moment both faces were on screen at once: a 「思考中…」 row with
 * the whole thought under it (reported, with a screenshot).
 *
 * While the model IS reasoning, the COLLAPSED face is the one that shows it:
 * it renders the {@link ThinkingLive} row, so a running thought keeps its
 * 「思考中：…」 lead-in and a streaming one-line tail. The old behaviour opened
 * the body for the whole thought instead, which unfolded a screenful of text
 * and then folded it back — twice per turn, under the reader's cursor.
 *
 * Collapsing from the expanded face: a click anywhere in the body. That is the
 * only affordance the reader asked for, and it is guarded so it cannot fire on
 * the interactions the body is FOR — following a link, or selecting text to
 * copy out of the reasoning (see {@link collapseFromBodyClick}).
 *
 * The auto-collapse is a TRANSITION, not a state: a row mounted on a finished
 * message (a recovered transcript, a page reload) starts closed and is never
 * re-opened by the effect, so only the reply the reader actually watched finish
 * snaps shut.
 *
 * @param props.source - the reasoning text (markdown, rendered on demand).
 * @param props.label - the summary line, already localized.
 * @param props.options - renderer callbacks, so links and code copies inside
 *   the reasoning behave exactly like the ones in the answer.
 * @param props.thinkingMs - measured duration, absent while still thinking.
 * @param props.streaming - true while this reply is still arriving.
 * @param props.liveLabel - localized 「思考中：」 lead-in for the live line.
 * @param props.defaultOpen - render the open face on the FIRST paint. Only a
 *   test seam: the panel never passes it, because the whole point of the
 *   collapse is that nothing opens without the reader's click, and a static
 *   render cannot click.
 */
export function Thinking({ source, label, options = {}, copy, thinkingMs, streaming, liveLabel, defaultOpen = false }: {
  source: string
  label: string
  options?: MarkdownOptions
  /** Surface copy: the copy label, the collapse tooltip, the `<details>` fallback. */
  copy?: MarkdownCopy
  thinkingMs?: number
  streaming?: boolean
  liveLabel?: string
  defaultOpen?: boolean
}): ReactNode {
  const surface = surfaceCopy(copy)
  const live = thinkingIsLive(thinkingMs, streaming)
  /*
   * COLLAPSED, always, from the first render.
   *
   * This used to start open while the model was still reasoning, and an effect
   * re-opened it on every live tick — so a reasoner unfolded a screenful of
   * text on every turn and folded it away once the answer arrived, moving the
   * answer under the reader's cursor twice per turn. The default is now the
   * summary line, in every state: streaming, finished, and recovered from disk.
   *
   * What keeps 「思考中」 visible is the collapsed face itself, not the open
   * body — it renders the {@link ThinkingLive} row, so a running thought still
   * shows its lead-in and a one-line tail (see the render below). Nothing is
   * hidden that the reader needs; expanding is one click, and the click is the
   * only thing that opens it.
   */
  const [open, setOpen] = useState(defaultOpen)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  /*
   * Fold away when the thought FINISHES, but only for a row the reader opened
   * while it was running.
   *
   * A row mounted on an already-finished message never triggers this: it is
   * born collapsed, so there is nothing to close. The effect exists for the one
   * case the new default cannot cover — a reader who expanded the live row to
   * watch it think expects it to close with the turn, exactly as the old
   * auto-collapse did.
   */
  const openedWhileLive = useRef(false)
  useEffect(() => {
    if (live) return
    if (!openedWhileLive.current) return
    openedWhileLive.current = false
    setOpen(false)
  }, [live])

  /*
   * Follow the stream inside the open body.
   *
   * Only while the thought is live, and only when the reader is already at the
   * bottom: scrolling someone back down every token would make the reasoning
   * impossible to read while it is being written, which is the one moment it is
   * most interesting.
   */
  useEffect(() => {
    if (!open || !live) return
    const element = bodyRef.current
    if (element === null) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    if (distance < 48) element.scrollTop = element.scrollHeight
  }, [open, live, source])

  return createElement(
    'div',
    { className: 'dsh-dschat-think', 'data-open': open ? 'true' : undefined, 'data-live': live ? 'true' : undefined },
    open
      ? createElement(
          'div',
          {
            className: 'dsh-dschat-think-body dsh-dschat-scroll',
            ref: bodyRef,
            /*
             * The expanded face is its own collapse control: the summary line is
             * not on screen, so the body has to be clickable. Announced as a
             * button (it IS one) with an always-true `aria-expanded`, so the
             * state is readable without seeing the missing line.
             */
            role: 'button',
            tabIndex: 0,
            title: surface.collapseHint,
            'aria-expanded': true,
            onClick: (event: { target: EventTarget | null }) => {
              if (collapseFromBodyClick(event.target)) setOpen(false)
            },
            // The event is declared as the minimum this handler reads: React
            // passes a full KeyboardEvent (so `preventDefault` is present and
            // the call is real — it stops Space from scrolling the panel), but
            // the handler is written against these fields so it also works when
            // the attribute is replayed over a hand-built event.
            onKeyDown: (event: { key: string; target: EventTarget | null; preventDefault?: () => void }) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              // Keys pressed on a link inside the body belong to that link.
              if (collapseFromBodyClick(event.target) === false) return
              event.preventDefault?.()
              setOpen(false)
            },
          },
          ...renderMarkdown(source, options, copy),
        )
      : createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-dschat-think-head',
            'aria-expanded': false,
            onClick: () => {
              /*
               * Remember that this row was opened DURING the thought, so the
               * effect above can close it when the thought ends. A row opened
               * after the fact is the reader's own doing and stays open.
               */
              if (live) openedWhileLive.current = true
              setOpen(true)
            },
          },
          createElement(ThinkIcon, { size: 13 }),
          live && liveLabel !== undefined
            ? createElement(ThinkingLive, { text: source, prefix: liveLabel })
            : createElement('span', { className: 'dsh-dschat-think-label' }, label),
          createElement(CaretIcon, { size: 11 }),
        ),
  )
}

/**
 * One row per source, in citation order — the list itself, without the
 * disclosure around it.
 *
 * Split out from {@link SourceList} because the rules live here (positional
 * numbering, an empty-URL placeholder that must keep its slot) and this half is
 * pure: the tests drive it directly rather than clicking a collapsed button in
 * a static render.
 *
 * @param sources - the reply's table, already normalized (non-empty).
 * @param options - renderer callbacks (link routing).
 */
export function sourceRows(sources: readonly DSchatSource[], options: MarkdownOptions = {}): ReactNode[] {
  return sources.map((source, index) => {
    const text = sourceLabel(source)
    return createElement(
      'li',
      { key: `${source.url}-${index}` },
      createElement('span', { className: 'dsh-dschat-source-no' }, String(index + 1)),
      /*
       * A source the page named no URL for keeps its NUMBER (positions are the
       * contract) but is not a link — dropping the row would renumber every
       * source after it, which is exactly the wrong-page bug this table exists
       * to prevent.
       */
      source.url === ''
        ? createElement('span', { className: 'dsh-dschat-source-plain' }, text)
        : createElement(
            'a',
            {
              href: source.url,
              target: '_blank',
              rel: 'noopener noreferrer',
              title: `${text} · ${source.url}`,
              onClick: linkClick(source.url, options),
            },
            text,
          ),
    )
  })
}

/**
 * The source list under a cited reply.
 *
 * DeepSeek's own page ends a searched answer with its sources, and it is the
 * only way to reach a page whose marker the model dropped (models do omit
 * markers), so the panel offers the same: one row per source, in citation
 * order, each a link through the same click contract as every other anchor.
 *
 * Collapsed by default. A searched reply can cite twenty pages, and a full list
 * under every answer turned a transcript into a link dump; the heading carries
 * the count, so a collapsed list still says how much is behind it.
 *
 * @param props.sources - the reply's table, already normalized (non-empty).
 * @param props.heading - localized heading, e.g. 「参考来源（8）」.
 * @param props.options - renderer callbacks (link routing).
 */
export function SourceList({ sources, heading, options = {} }: {
  sources: readonly DSchatSource[]
  heading: string
  options?: MarkdownOptions
}): ReactNode {
  const [open, setOpen] = useState(false)
  return createElement(
    'div',
    { className: 'dsh-dschat-sources', 'data-open': open ? 'true' : undefined },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-dschat-sources-head',
        'aria-expanded': open,
        onClick: () => setOpen(value => !value),
      },
      createElement('span', null, heading),
      createElement(CaretIcon, { size: 11 }),
    ),
    open && createElement('ol', null, ...sourceRows(sources, options)),
  )
}

/** The markdown component used by the transcript. */
export function Markdown({ source, onCopyCode, onOpenLink, sources, sourcesLabel, copy }: {
  source: string
  onCopyCode?: (code: string) => void
  /** Where a link click should go; see {@link MarkdownOptions.onOpenLink}. */
  onOpenLink?: (href: string) => boolean | void
  /** Search sources for this reply's `[citation:N]` markers. */
  sources?: readonly DSchatSource[]
  /** Heading for the source list; absent = do not render the list. */
  sourcesLabel?: string
  /** Surface copy: the copy label plus the two labels the renderer falls back on. */
  copy?: MarkdownCopy
}): ReactNode {
  const options: MarkdownOptions = {}
  if (onCopyCode !== undefined) options.onCopyCode = onCopyCode
  if (onOpenLink !== undefined) options.onOpenLink = onOpenLink
  const table = sourcesOf(sources)
  if (table !== undefined) options.sources = table
  return createElement(
    'div',
    null,
    ...renderMarkdown(source, options, copy),
    table === undefined || sourcesLabel === undefined
      ? null
      : createElement(SourceList, { sources: table, heading: sourcesLabel, options }),
  )
}
