/**
 * Render the REAL panel twice, side by side, and let one extra sheet be the
 * only difference between the two panes.
 *
 * This is a decision sheet, not a mock: both panes are the shipped React
 * component, the shipped stylesheet and the shipped locale, mounted in Chrome
 * against the harness's own theme tokens. The difference is the file named by
 * `--candidate`, which is appended after the panel sheet and therefore wins the
 * cascade.
 *
 * Two ways to use it:
 *
 *   1. a palette PROPOSAL, as a small sheet of token overrides (the original
 *      use — `docs/candidate-palette.css` was one, and it has since been merged
 *      into the panel sheet and deleted);
 *   2. a BEFORE/AFTER, by passing a whole previous sheet. A complete older
 *      PANEL_CSS re-states every rule it owns, so appending it reproduces the
 *      old panel exactly — that is how the v0.6.4 sheets were made:
 *
 *        git show HEAD:src/client/panel/styles.ts  (extract the template literal)
 *          > .tmp-web/old-panel.css
 *        node scripts/proposal-preview.mjs --out .tmp-before-after \
 *          --candidate .tmp-web/old-panel.css \
 *          --label-left '新配色 · DeepSeek 网页端' --tag-left new \
 *          --label-right '旧配色 · 上一版' --tag-right old \
 *          --note '...'
 *
 * Output: one PNG per shot in the output directory, plus report.json with the
 * per-element computed colours each pane actually painted.
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? fallback : argv[index + 1]
}
const outDir = join(root, flag('out', '.tmp-proposal'))
/* Empty by default: with no candidate the two panes show the same shipped sheet. */
const candidateArg = flag('candidate', '')
const candidate = candidateArg === '' ? '' : join(root, candidateArg)
const captions = {
  left: { label: flag('label-left', '当前配色'), tag: flag('tag-left', 'old') },
  right: { label: flag('label-right', '提案'), tag: flag('tag-right', 'new') },
  note: flag('note', `只有右侧额外加载了 <code>${candidateArg || '(none)'}</code>。`),
}

/**
 * The renders, and the clip each one is photographed at.
 *
 * WIDE is the whole panel at a panel-sized width: it shows the header, the
 * transcript and the composer together, which is what "the style is unified"
 * has to be judged on. CLOSE is the empty page and the composer on their own —
 * the two things this change is about — so the copy can be read.
 */
const WIDE = { width: 620, height: 760 }

/**
 * One short conversation, enough to show every surface the palette touches: a
 * user bubble, a reasoning row, a cited reply and its sources list.
 */
const DEMO = [{
  id: 'chat-demo',
  title: '界面配色与文案的样例对话',
  ts: Date.now() - 60_000,
  updatedAt: Date.now(),
  messageCount: 3,
  source: 'synthetic',
  messages: [
    {
      id: 'm1',
      role: 'user',
      ts: Date.now() - 300_000,
      content: '迁移到 harness 之后，新会话的上下文要怎么组织比较好？',
    },
    {
      id: 'm2',
      role: 'assistant',
      ts: Date.now() - 240_000,
      thinkingMs: 72_000,
      content: [
        '<details><summary>思考过程</summary>',
        '先看目标：读者要的是能直接开工的上下文，而不是整段聊天记录。',
        '</details>',
        '建议分三层组织：目标、约束、待办。',
        '',
        '1. 目标写一句话',
        '2. 约束写死不能改的',
        '3. 待办按优先级排',
        '',
        '参考网页端的做法 [citation:1]，以及 harness 自己的会话格式 [citation:2]。',
      ].join('\n'),
      sources: [
        { index: 1, title: 'DeepSeek 网页端会话格式', url: 'https://chat.deepseek.com/' },
        { index: 2, title: 'Harness session 结构', url: 'https://example.com/harness-session' },
      ],
    },
    {
      id: 'm3',
      role: 'user',
      ts: Date.now() - 60_000,
      content: '先把配色统一一下。',
    },
  ],
}]

const EMPTY = { engine: 'ready', loggedIn: true, busy: false, streaming: false, chats: [], activeChatId: undefined }
const WITH_CHAT = { engine: 'ready', loggedIn: true, busy: false, streaming: false, chats: DEMO, activeChatId: DEMO[0].id }

const SHOTS = [
  { name: '01-新会话页-浅色', state: EMPTY, dark: false },
  { name: '02-新会话页-深色', state: EMPTY, dark: true },
  { name: '03-会话页-浅色', state: WITH_CHAT, dark: false },
  { name: '04-会话页-深色', state: WITH_CHAT, dark: true },
]

/** Bundle the real panel + stylesheet + locale, with a working stub API. */
async function bundle(dir) {
  const entry = join(dir, 'entry.tsx')
  writeFileSync(entry, `
    import { createElement } from 'react'
    import { createRoot } from 'react-dom/client'
    import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
    import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
    import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

    /*
     * A stub API answering exactly what the empty page and the composer ask
     * for. Anything the panel would only call after a click stays pending: no
     * shot here presses anything.
     */
    const pending = () => new Promise(() => undefined)
    function makeApi(state) {
      const ok = async (extra) => ({ ok: true, ...extra })
      const chats = state.chats ?? []
      return {
        state: async () => ok({
          engine: 'ready', loggedIn: true, busy: false, deepThink: true, search: true,
          version: '0.6.2', build: '2026-10-10T00:00:00.000Z',
          ...state,
          chats: chats.map(({ messages, ...summary }) => ({ ...summary, messageCount: (messages ?? []).length })),
        }),
        chat: async () => ok({ chat: chats[0] }),
        tail: async () => ok({ busy: false, streaming: false }),
        context: async () => ok({ workspaces: [], cwd: '/tmp', settings: {} }),
        attachmentUrl: () => '',
        wake: pending, newChat: pending, send: pending, attach: pending,
        stop: pending, openLogin: pending, closeBrowser: pending,
        setDeepThink: pending, setSearch: pending, transfer: pending, exportFile: pending,
        renameChat: pending, deleteChat: pending, clearChats: pending, webChats: pending,
        recover: pending, restore: pending, transferPreview: pending,
      }
    }

    let root = null
    window.__mount = (state) => {
      if (root !== null) root.unmount()
      if (document.querySelector('style[data-panel]') === null) {
        const style = document.createElement('style')
        style.dataset.panel = 'true'
        style.textContent = PANEL_CSS
        document.head.appendChild(style)
      }
      /*
       * The candidate sheet goes LAST, after the panel's own sheet.
       *
       * The panel registers PANEL_CSS at mount, so a candidate file linked in
       * the document head is appended BEFORE it and loses every equally
       * specific rule on document order — which is exactly how the first
       * version of this sheet rendered two identical panes. In the real
       * integration these rules live INSIDE styles.ts and the question does
       * not arise; here the sheet has to be moved behind the panel's.
       */
      for (const sheet of document.querySelectorAll('style[data-candidate]')) {
        document.head.appendChild(sheet)
      }
      const tt = (key) => zh[key] ?? key
      root = createRoot(document.getElementById('seat'))
      root.render(createElement(DSchatPanel, {
        api: makeApi(state), tt, t: tt,
        openSession: async () => true,
        pickDirectory: async () => null,
        createWorkspace: async () => ({ workspaceId: 'w', title: 'w' }),
      }))
    }
  `, 'utf8')
  const outfile = join(dir, 'preview.mjs')
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    target: ['chrome120'],
    logLevel: 'silent',
  })
  return outfile
}

/** The token sheet both panes share, plus the optional candidate sheet. */
function frameHtml({ tokens, bundle, candidateCss, state }) {
  return `<!doctype html>
<html data-variant="${candidateCss === '' ? 'current' : 'candidate'}"><head><meta charset="utf-8">
<style>${tokens}</style>
<style>
  html, body { margin: 0; height: 100%; background: var(--dsw-alias-bg-base); }
  #seat { width: 100%; height: 100%; }
</style>
<style data-candidate>${candidateCss}</style>
</head>
<body><div id="seat"></div>
<script>${bundle}</script>
<script>window.__mount(${JSON.stringify(state)});</script>
</body></html>`
}

const dir = mkdtempSync(join(root, '.tmp-proposal-build-'))
mkdirSync(outDir, { recursive: true })
const report = { candidate, shots: [], errors: [], colours: {} }

try {
  const bundleJs = readFileSync(await bundle(dir), 'utf8')
  const tokens = readFileSync(join(root, 'refs/dsh-tokens.css'), 'utf8')
  const candidateCss = candidate === '' ? '' : readFileSync(candidate, 'utf8')

  /*
   * The frames are served over loopback HTTP, not opened as files.
   *
   * Chrome treats every `file://` document as an opaque origin, so a page that
   * embeds two `file://` iframes cannot read them back — which is how the first
   * render of this sheet ended up photographing two blank white boxes and then
   * waiting forever on a selector it was never allowed to see. One origin for
   * the sheet and both panes also means the colour probe below can read the
   * panes directly.
   */
  const server = createServer((request, response) => {
    const name = decodeURIComponent(request.url.split('?')[0]).replace(/^\//, '') || 'index.html'
    const file = join(dir, name)
    if (!existsSync(file)) { response.writeHead(404); response.end('not found'); return }
    response.writeHead(200, {
      'content-type': extname(file) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream',
      /*
       * Nothing here is worth caching, and a cached document is worse than slow:
       * the probe below would silently report the PREVIOUS run's colours as if
       * they were this run's, i.e. exactly the "no difference" reading this
       * sheet exists to prevent.
       */
      'cache-control': 'no-store, no-cache, must-revalidate',
    })
    response.end(readFileSync(file))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  /** Write one variant document and hand back its served URL. */
  const writeFrame = (name, css, state) => {
    const file = join(dir, `${name}.html`)
    writeFileSync(file, frameHtml({ tokens, bundle: bundleJs, candidateCss: css, state }), 'utf8')
    /* A unique query per write, so no layer between here and Chrome can reuse one. */
    return `${origin}/${encodeURIComponent(name)}.html?v=${Math.random().toString(36).slice(2)}`
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const view = await browser.newPage({ viewport: { width: WIDE.width * 2 + 60, height: WIDE.height + 120 }, deviceScaleFactor: 2 })
  /*
   * Every frame's console and crash lands in the report. A blank pane is the
   * one failure a screenshot cannot explain, and this is what explains it.
   */
  view.on('console', message => {
    if (message.type() === 'error') report.errors.push(`console: ${message.text()}`)
  })
  view.on('pageerror', error => report.errors.push(`pageerror: ${error.message}`))
  view.on('frameattached', () => {
    const frame = view.frames()[view.frames().length - 1]
    frame?.on('pageerror', error => report.errors.push(`frame pageerror: ${error.message}`))
  })

  /**
   * Wait until BOTH panes have really mounted.
   *
   * `waitUntil: 'load'` fires before an iframe's own scripts have finished, so
   * the first render of this sheet photographed two empty white boxes. The
   * panel's root element is the thing to wait for: it only exists once React
   * has committed, and once it is there the tokens have resolved with it.
   */
  const waitForPanes = async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const counts = await Promise.all(view.frames()
        .filter(frame => frame !== view.mainFrame())
        .map(frame => frame.evaluate(() => document.querySelectorAll('.dsh-dschat').length).catch(() => 0)))
      if (counts.length === 2 && counts.every(count => count > 0)) return true
      await view.waitForTimeout(250)
    }
    return false
  }

  for (const shot of SHOTS) {
    const currentUrl = writeFrame(`current-${shot.name}`, '', shot.state)
    const proposedUrl = writeFrame(`proposed-${shot.name}`, candidateCss, shot.state)

    /*
     * One page, two iframes at EXACTLY panel size, so the two renders are the
     * same number of CSS pixels and the difference in the picture is the
     * difference in the code.
     */
    await view.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 24px 26px 34px; background: #eceef1;
    font: 13px/1.5 -apple-system, "PingFang SC", "Segoe UI", system-ui, sans-serif; color: #14171c;
  }
  .sheet { display: flex; gap: 24px; align-items: flex-start; }
  .pane { display: flex; flex-direction: column; gap: 10px; }
  .cap { display: flex; align-items: center; gap: 8px; font-size: 12.5px; height: 22px; }
  .cap b { font-size: 13px; }
  .tag { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px; border: 1px solid; }
  .tag.old { color: #8a5a00; border-color: rgba(224,149,21,.45); background: rgba(224,149,21,.12); }
  .tag.new { color: #1d6b3d; border-color: rgba(34,169,95,.45); background: rgba(34,169,95,.12); }
  iframe {
    width: ${WIDE.width}px; height: ${WIDE.height}px; border: 1px solid rgba(0,0,0,.14);
    border-radius: 12px; background: #fff; display: block;
    box-shadow: 0 10px 26px rgba(15,23,42,.10);
  }
  .foot { margin-top: 14px; font-size: 12px; color: #5b6472; }
  .foot code { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; }
</style></head><body>
  <div class="sheet">
    <div class="pane">
      <div class="cap"><span class="tag ${captions.left.tag}">现在</span><b>${captions.left.label}</b></div>
      <iframe id="pane-current" src="${currentUrl}"></iframe>
    </div>
    <div class="pane">
      <div class="cap"><span class="tag ${captions.right.tag}">对照</span><b>${captions.right.label}</b></div>
      <iframe id="pane-proposed" src="${proposedUrl}"></iframe>
    </div>
  </div>
  <div class="foot">两侧都是同一个真实组件（同一份 <code>DSchatPanel.tsx</code> / <code>styles.ts</code> / <code>locales.ts</code>），
  ${captions.note}</div>
</body></html>`, { waitUntil: 'load' })

    await view.waitForTimeout(400)
    const mounted = await waitForPanes()
    if (!mounted) report.errors.push(`blank panes in ${shot.name}`)
    /*
     * The theme switch, applied from the OUTSIDE.
     *
     * `document.body` inside a `view.setContent` page is the SHEET's body: the
     * panels live in iframes with bodies of their own, so setting the attribute
     * on the sheet painted nothing — the first version of these shots put two
     * light-mode panes side by side and called one of them 「深色」. Each frame
     * is addressed by id, and the same rule the harness uses
     * (`body[data-ds-dark-theme]`) is what the candidate sheet keys off.
     */
    if (shot.dark) {
      for (const id of ['pane-current', 'pane-proposed']) {
        const handle = await view.$(`#${id}`)
        const frame = handle === null ? null : await handle.contentFrame()
        if (frame === null) { report.errors.push(`no frame for ${id}`); continue }
        await frame.evaluate(() => { document.body.dataset.dsDarkTheme = 'true' })
      }
      await view.waitForTimeout(600)
    } else {
      await view.waitForTimeout(300)
    }
    if (shot.dark) {
      for (const frame of view.frames()) {
        if (frame === view.mainFrame()) continue
        await frame.evaluate(() => { document.body.dataset.dsDarkTheme = 'true' })
      }
      await view.waitForTimeout(600)
    } else {
      await view.waitForTimeout(400)
    }

    const file = join(outDir, `${shot.name}.png`)
    await view.screenshot({ path: file, fullPage: true })
    report.shots.push(file)
    console.log('[proposal] wrote', shot.name)
  }

  /* ---- what each pane actually painted, read back from the DOM ---- */
  const currentUrl = writeFrame('colours-current', '', SHOTS[2].state)
  const proposedUrl = writeFrame('colours-proposed', candidateCss, SHOTS[2].state)
  const read = async (url, dark) => {
    const frame = await browser.newPage({ viewport: WIDE, deviceScaleFactor: 1 })
    await frame.goto(url, { waitUntil: 'load' })
    await frame.waitForSelector('.dsh-dschat-thread', { timeout: 10_000 })
    if (dark) await frame.evaluate(() => { document.body.dataset.dsDarkTheme = 'true' })
    await frame.waitForTimeout(700)
    /*
     * Prove the probe read the variant it thinks it did. Without this, a probe
     * that quietly measured the same document twice reports "no difference" —
     * the most misleading result this sheet can produce.
     */
    const variant = await frame.evaluate(() => document.documentElement.dataset.variant)
    /*
     * Ask the CANDIDATE STYLE ELEMENT whether it carries text, not the style
     * sheet list: the panel registers its own sheet in the same document, so
     * "some sheet mentions --dschat-accent" is true in both panes and the guard
     * reported a mismatch on every run. What has to be true is that the pane
     * claiming `variant=candidate` really has a candidate sheet behind it.
     */
    const candidateRules = await frame.evaluate(() => {
      const style = document.querySelector('style[data-candidate]')
      return style !== null && style.textContent.trim().length > 0
    })
    if ((variant === 'candidate') !== candidateRules) {
      report.errors.push(`probe ${url.split('/').pop()} variant=${variant} candidateRules=${candidateRules}`)
    }
    const out = await frame.evaluate(() => {
      const pick = selector => {
        const el = document.querySelector(selector)
        if (el === null) return null
        const cs = getComputedStyle(el)
        return { bg: cs.backgroundColor, fg: cs.color, border: cs.borderTopColor }
      }
      return {
        page: pick('.dsh-dschat'),
        header: pick('.dsh-dschat-header'),
        rail: pick('.dsh-dschat-rail'),
        railItemActive: pick('.dsh-dschat-item[data-active]'),
        composerCard: pick('.dsh-dschat-card'),
        /*
         * The placeholder, read through ::placeholder — reading the textarea's
         * own `color` measures the text the reader has not typed, not the hint
         * they are looking at.
         */
        placeholder: (() => {
          const el = document.querySelector('.dsh-dschat-input')
          if (el === null) return null
          return {
            text: el.getAttribute('placeholder'),
            colour: getComputedStyle(el, '::placeholder').color,
          }
        })(),
        /*
         * Contrast, measured rather than asserted. Two labels the reader has to
         * read are checked against the surface they actually sit on: the
         * composer's hint and the lit pill's label.
         */
        contrast: (() => {
          /*
           * WCAG relative luminance.
           *
           * `color-mix()` computes to `color(srgb 0.55 0.67 0.94)`, whose
           * components are 0..1 — a naive number-match reads the `2` out of
           * `srgb` and then three fractions as if they were 0..255, which
           * reports a bright disc as near-black and a 8:1 arrow as 1.1:1. The
           * branch below is what makes these numbers trustworthy.
           */
          const luminance = colour => {
            const srgb = colour.startsWith('color(')
            const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]
            const channels = (srgb ? parts.slice(1, 4) : parts.slice(0, 3))
              .map(value => (srgb ? value : value / 255))
              .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
            const [r, g, b] = channels
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
          }
          const ratio = (front, back) => {
            const [a, b] = [luminance(front), luminance(back)].sort((x, y) => y - x)
            return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100
          }
          /*
           * srgb-space colours, normalised to 0..255.
           *
           * `color(srgb 0.57 0.73 1)` is what color-mix() computes to, and
           * reading it as (0, 0, 0) — which a bare number-match does, because
           * the `2` of `srgb` comes first — makes a light disc look black in
           * the compositing step below. Same branch as the luminance helper.
           */
          const parse = value => {
            const parts = value.match(/[\d.]+/g)?.map(Number) ?? []
            if (value.startsWith('color(')) {
              return { r: (parts[1] ?? 0) * 255, g: (parts[2] ?? 0) * 255, b: (parts[3] ?? 0) * 255, a: parts[4] ?? 1 }
            }
            return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 }
          }
          const over = (front, back) => ({
            r: front.r * front.a + back.r * (1 - front.a),
            g: front.g * front.a + back.g * (1 - front.a),
            b: front.b * front.a + back.b * (1 - front.a),
            a: 1,
          })
          const css = colour => `rgb(${Math.round(colour.r)}, ${Math.round(colour.g)}, ${Math.round(colour.b)})`
          /*
           * The surface a reader actually SEES behind an element: every
           * translucent background from the element outward, composited onto
           * the nearest opaque one. Reading a single rgba() value reports the
           * 12% accent pill as if it were 12% black, which is how the first
           * pass measured a 10:1 label at 1.6:1.
           */
          const surface = (element, fallback) => {
            const stack = []
            for (let node = element; node !== null; node = node.parentElement) {
              const value = parse(getComputedStyle(node).backgroundColor)
              if (value.a === 0) continue
              stack.push(value)
              if (value.a === 1) break
            }
            let base = parse(fallback)
            for (const layer of stack.reverse()) base = over(layer, base)
            return css(base)
          }
          const input = document.querySelector('.dsh-dschat-input')
          const pill = document.querySelector('.dsh-dschat-toggle.dsh-dschat-toggle-on')
          const out = {}
          if (input !== null) {
            out.placeholderOnCard = ratio(getComputedStyle(input, '::placeholder').color, surface(input, 'rgb(255,255,255)'))
          }
          if (pill !== null) {
            const label = pill.querySelector('.dsh-dschat-toggle-text') ?? pill
            out.pillLabelOnPill = ratio(getComputedStyle(label).color, surface(pill, 'rgb(255,255,255)'))
          }
          const meta = document.querySelector('.dsh-dschat-item-meta')
          if (meta !== null) out.railMetaOnRail = ratio(getComputedStyle(meta).color, surface(meta, 'rgb(255,255,255)'))
          /*
           * The send arrow, which is the one glyph the reader aims at. The SVG
           * paints with currentColor, so the button's own `color` IS the arrow.
           */
          const send = document.querySelector('.dsh-dschat-send')
          if (send !== null) {
            const disc = surface(send, 'rgb(255,255,255)')
            out.sendArrowOnDisc = ratio(getComputedStyle(send).color, disc)
            /* The disc against the card: a control the reader cannot find is
               the same defect as one they cannot read. */
            out.sendDiscOnCard = ratio(disc, surface(document.querySelector('.dsh-dschat-card') ?? send, 'rgb(255,255,255)'))
            const root = document.querySelector('.dsh-dschat')
            out.ink = root === null ? null : {
              onAccent: getComputedStyle(root).getPropertyValue('--dschat-on-accent').trim(),
              accent: getComputedStyle(root).getPropertyValue('--dschat-accent').trim(),
              sendColour: getComputedStyle(send).color,
              sendDisabled: send.disabled,
            }
          }
          const mark = document.querySelector('.dsh-dschat-empty-mark')
          if (mark !== null) out.emptyMarkGlyph = ratio(getComputedStyle(mark).color, surface(mark, 'rgb(255,255,255)'))
          return out
        })(),
        userBubble: pick('.dsh-dschat-msg[data-role="user"] .dsh-dschat-msg-body'),
        thinkBox: pick('.dsh-dschat-think'),
        sourcesBox: pick('.dsh-dschat-sources'),
        citation: pick('.dsh-dschat-citation'),
        send: pick('.dsh-dschat-send'),
        sendIcon: pick('.dsh-dschat-send svg'),
        toggleOn: pick('.dsh-dschat-toggle.dsh-dschat-toggle-on'),
        toggleOff: pick('.dsh-dschat-toggle:not(.dsh-dschat-toggle-on)'),
        transferBtn: pick('.dsh-dschat-tbtn-on'),
        emptyMark: pick('.dsh-dschat-empty-mark'),
        kbd: pick('.dsh-dschat-kbd'),
      }
    })
    await frame.close()
    return out
  }
  report.colours = {
    lightCurrent: await read(currentUrl, false),
    lightProposed: await read(proposedUrl, false),
    darkCurrent: await read(currentUrl, true),
    darkProposed: await read(proposedUrl, true),
  }
  await browser.close()
  server.close()
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('[proposal] done ->', outDir)
  if (report.errors.length > 0) console.error('render errors:', report.errors)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
