/**
 * Render the REAL panel in a real browser and take pictures of it.
 *
 * The plugin's own tests render components to static markup, which catches a
 * crash but says nothing about layout: whether the drag handle is actually
 * grabbable, whether the tool row still fits, whether a collapsed row really is
 * one line tall. This script mounts the shipped component — same source, same
 * stylesheet, same locale — against a stub API and the harness's own theme
 * tokens, then drives it with Chrome and writes screenshots plus a JSON report
 * of measured geometry.
 *
 * Fixtures come from the plugin's real transcript store when it exists
 * (~/.dsh/dsh-dschat/transcripts.json), so what lands in the picture is real
 * conversation content — including a recovered chat, whose reasoning has no
 * measured duration, and a cited reply, whose sources list starts collapsed.
 * Those titles are private: pass `--synthetic` to render an invented rail
 * instead (what the committed shots in docs/screenshots/ use).
 *
 * Usage: node scripts/ui-shot.mjs [outDir] [--synthetic]
 * Needs Google Chrome (channel: 'chrome') and playwright-core, both of which
 * the plugin already carries for the DeepSeek web engine.
 */

import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** First non-flag argument is the output directory; `--synthetic` is not one. */
const outArg = process.argv.slice(2).find(argument => !argument.startsWith('--'))
const outDir = outArg ?? join(root, '.tmp-ui-shot')

/**
 * Ignore the real transcript store and render the fictional rail instead.
 *
 * On by default when any argument is `--synthetic`, and via
 * `DSH_UI_SHOT_SYNTHETIC=1`. Turn it on whenever a shot leaves this machine:
 * the real store's chat titles are private, and a public screenshot must not
 * carry them.
 */
const SYNTHETIC = process.env.DSH_UI_SHOT_SYNTHETIC === '1' || process.argv.includes('--synthetic')

/**
 * What the panel renders.
 *
 * The rail is filled from the plugin's REAL store when there is one
 * (~/.dsh/dsh-dschat/transcripts.json), but the conversation on screen is a
 * deliberate fixture: the three reasoning states and a cited reply have to be
 * visible at once to be checked, and a real store happens to contain them only
 * by luck (and never contains a measured duration yet, because that field is
 * new).
 *
 * With `SYNTHETIC` the rail comes from a fixed list of invented titles, so the
 * output is identical on every machine — that is what the committed shots in
 * `docs/screenshots/` are rendered with.
 */
function fixtures() {
  const now = Date.now()
  const demo = {
    id: 'chat-ui-demo',
    title: 'UI 校验样例（思考用时 / 来源折叠）',
    createdAt: now, updatedAt: now, model: 'deepseek-reasoner', streaming: false,
    messages: [
      { id: 'd-u1', role: 'user', content: '迁移到 harness 之后，新会话的上下文要怎么组织比较好？', ts: now - 120_000 },
      {
        id: 'd-a1', role: 'assistant', ts: now - 90_000, thinkingMs: 72_400,
        content: '<details><summary>思考过程</summary>\n\n先看约束：迁移过去的上下文必须自洽，不能依赖这边的临时状态。\n\n'
          + '再算一遍预算：一段 3 万字的网页对话蒸出来大约 1.5k 字，正好是一封简报的量。\n\n</details>\n\n'
          + '建议分三层组织：**目标**、**约束**、**待办**。\n\n'
          + '1. 目标写一句话\n2. 约束写死不能改的\n3. 待办按优先级排\n\n'
          + '参考网页端的做法[citation:1]，以及 harness 自己的会话格式[citation:2]。\n',
        sources: [
          { url: 'https://example.com/organize', title: '如何组织长对话的上下文' },
          { url: 'https://example.com/session-format', title: 'Session format reference' },
        ],
      },
      { id: 'd-u2', role: 'user', content: '这条是从网页端恢复的，有时间吗？', ts: now - 60_000 },
      {
        id: 'd-a2', role: 'assistant', ts: now - 40_000,
        content: '<details><summary>思考过程</summary>\n\n恢复过来的会话，历史里只有推理文本，没有用时。\n\n</details>\n\n'
          + '恢复的回复没有测量过时长，所以只显示「已思考」。',
      },
      {
        /*
         * The LIVE reasoning fixture: an UNTERMINATED `<details>` block (which
         * is exactly what the engine stores while the model is still thinking —
         * the closer is only appended once the answer starts), no `thinkingMs`,
         * and `streaming: true`. That is the shape the panel's live line keys
         * off, and it has to be long enough to overflow one line or the tail
         * scroll it exercises never engages.
         */
        id: 'd-a3', role: 'assistant', ts: now - 20_000, streaming: true,
        content: '<details><summary>思考过程</summary>\n\n'
          + '先确认这一条要演示的是什么：思考中的那一行应该显示最新的思考内容，'
          + '并且随着内容增长不断向左滚动，让读者永远看到最新写出来的那几个字。\n\n'
          + '所以这里的推理文本必须足够长，长到一行放不下，才看得出尾部跟读的效果；'
          + '同时前缀「思考中：」要固定在最左边，不能被一起滚走或截断。',
      },
    ],
  }
  /**
   * Fictional rail rows for `--synthetic`.
   *
   * Only the fields the rail reads matter: title, `messages.length` (the "N 条"
   * count) and `updatedAt` (the "· X 前" stamp, and the sort order).
   */
  const syntheticRail = [
    ['网页端回复里的引用标记怎么渲染', 6, 3 * 60_000],
    ['从网页恢复会话时推理文本怎么办', 4, 22 * 60_000],
    ['迁移简报应该包含哪些段落', 9, 95 * 60_000],
    ['深度思考开关的状态存在哪', 2, 5 * 3_600_000],
    ['附件落盘之后的清理策略', 7, 9 * 3_600_000],
    ['会话列表拖宽的边界值', 3, 26 * 3_600_000],
    ['导出 markdown 的默认落点', 5, 2 * 86_400_000],
  ].map(([title, count, age]) => ({
    id: `chat-demo-${String(count)}-${String(age)}`,
    title,
    createdAt: now - age,
    updatedAt: now - age,
    model: 'deepseek-chat',
    streaming: false,
    messages: Array.from({ length: count }, (_, index) => ({
      id: `d-demo-${String(count)}-${String(index)}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: '',
      ts: now - age,
    })),
  }))

  const file = join(homedir(), '.dsh', 'dsh-dschat', 'transcripts.json')
  if (!SYNTHETIC) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const chats = Array.isArray(parsed.chats) ? parsed.chats : []
      if (chats.length > 0) return { chats: [demo, ...chats.slice(0, 11)], activeChatId: demo.id, source: file }
    } catch {
      // No store yet: the fixture alone is enough to check the layout.
    }
  }
  return { chats: [demo, ...syntheticRail], activeChatId: demo.id, source: 'synthetic' }
}

/** Bundle the real panel + stylesheet + locale for the browser. */
async function bundle(dir) {
  const entry = join(dir, 'entry.tsx')
  writeFileSync(entry, `
    import { createElement } from 'react'
    import { createRoot } from 'react-dom/client'
    import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
    import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
    import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

    /** Every route the panel may call, answered from the fixture. */
    function makeApi(state) {
      const ok = async (extra) => ({ ok: true, ...extra })
      const pending = () => new Promise(() => undefined)
      return {
        state: async () => ({ ok: true, ...state, engine: 'ready', loggedIn: true, deepThink: true, search: true, busy: false }),
        tail: async () => ok({ busy: false, streaming: false }),
        context: async () => ok({ workspaces: [], cwd: ${JSON.stringify(process.cwd())} }),
        newChat: async () => ok({ chatId: 'chat-new' }),
        send: async () => ok({ chatId: 'chat-a' }),
        stop: pending, openLogin: pending, closeBrowser: pending,
        setDeepThink: pending, setSearch: pending, transfer: pending, exportFile: pending,
        renameChat: pending, deleteChat: pending, clearChats: pending, webChats: pending,
        recover: pending, restore: pending, attach: pending,
      }
    }

    window.__mount = (state) => {
      const style = document.createElement('style')
      style.textContent = PANEL_CSS
      document.head.appendChild(style)
      const tt = (key) => zh[key] ?? key
      createRoot(document.getElementById('seat')).render(createElement(DSchatPanel, {
        api: makeApi(state),
        tt,
        t: tt,
        openSession: async () => true,
        pickDirectory: async () => null,
        createWorkspace: async () => ({ workspaceId: 'w', title: 'w' }),
      }))
    }
  `, 'utf8')
  const outfile = join(dir, 'ui.mjs')
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

/**
 * Scratch INSIDE the package, not in the OS temp dir: the entry imports `react`
 * and `react-dom/client`, which resolve from this package's own node_modules —
 * a page in /var/folders cannot see them.
 */
const dir = mkdtempSync(join(root, '.tmp-ui-build-'))
mkdirSync(outDir, { recursive: true })
const report = { source: '', shots: [], probes: {} }
const errors = []

try {
  const bundleFile = await bundle(dir)
  const fixture = fixtures()
  report.source = fixture.source
  const tokens = readFileSync(join(root, 'refs/dsh-tokens.css'), 'utf8')
  const page = join(dir, 'index.html')
  writeFileSync(page, `<!doctype html>
<html><head><meta charset="utf-8">
<style>${tokens}</style>
<style>
  html, body { margin: 0; height: 100%; background: var(--dsw-alias-bg-base); }
  #seat { width: 1280px; height: 820px; }
</style>
</head>
<body><div id="seat"></div>
<script>${readFileSync(bundleFile, 'utf8')}</script>
<script>window.__mount(${JSON.stringify(fixture)});</script>
</body></html>`, 'utf8')

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const view = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 })
  view.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  view.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  await view.goto(`file://${page}`, { waitUntil: 'load' })
  await view.waitForSelector('.dsh-dschat-thread', { timeout: 10_000 })
  // The panel fetches its snapshot in an effect; give the first render a beat.
  await view.waitForTimeout(600)

  const shot = async (name, options = {}) => {
    const file = join(outDir, `${name}.png`)
    await view.screenshot({ path: file, ...options })
    report.shots.push(file)
  }

  // ---- evidence the layout is what the change asked for -------------------
  report.probes = await view.evaluate(() => {
    const box = selector => {
      const el = document.querySelector(selector)
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    }
    const tools = [...document.querySelectorAll('.dsh-dschat-tools > *')].map(el => ({
      cls: el.className, text: (el.textContent ?? '').trim(), ...(() => {
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), w: Math.round(r.width) }
      })(),
    }))
    return {
      headerButtons: [...document.querySelectorAll('.dsh-dschat-header button')].map(el => el.className),
      brandFirstInHeader: document.querySelector('.dsh-dschat-header')?.firstElementChild?.className ?? null,
      toolRow: tools,
      railWidth: box('.dsh-dschat-rail')?.w ?? null,
      railHandle: box('.dsh-dschat-rail-resize'),
      rightColumn: document.querySelector('.dsh-dschat-side') !== null,
      detailsInDom: document.querySelectorAll('details, summary').length,
      thinkingRows: [...document.querySelectorAll('.dsh-dschat-think')].map(el => ({
        label: el.querySelector('.dsh-dschat-think-label')?.textContent ?? '',
        open: el.getAttribute('data-open'),
        height: Math.round(el.getBoundingClientRect().height),
        ariaExpanded: el.querySelector('.dsh-dschat-think-head')?.getAttribute('aria-expanded') ?? null,
      })),
      sourceRows: [...document.querySelectorAll('.dsh-dschat-sources')].map(el => ({
        head: el.querySelector('.dsh-dschat-sources-head')?.textContent ?? '',
        open: el.getAttribute('data-open'),
        rows: el.querySelectorAll('li').length,
        height: Math.round(el.getBoundingClientRect().height),
      })),
    }
  })
  await shot('01-default')

  /*
   * The two faces of a reasoning row, driven for real.
   *
   * Markup alone cannot show this one: the reader's bug was a TRANSITION (a row
   * that was already open when the duration arrived kept its summary line and
   * appended the body under it), and transitions live in effects, which a static
   * render never runs. So each state is produced by clicking and read back from
   * the DOM. The assertion is MUTUAL EXCLUSION, not "the right class exists":
   *
   *   collapsed → a summary line, no body, and no reasoning text in the DOM;
   *   expanded  → a body, no summary line, and the reasoning text on screen.
   *
   * The resting row is put back into its collapsed state first (the pass above
   * opened it), because "the row a reader meets" is the state this change is
   * about. Then it is opened by its line and closed again by pressing the text —
   * the summary line is not on screen to be clicked when the row is open, which
   * is the whole point, so the expanded body has to be its own control.
   */
  report.probes.thinkingFaces = await (async () => {
    const read = () => view.evaluate(() => {
      const row = document.querySelector('.dsh-dschat-think')
      if (row === null) return null
      const head = row.querySelector('.dsh-dschat-think-head')
      const body = row.querySelector('.dsh-dschat-think-body')
      const r = row.getBoundingClientRect()
      return {
        open: row.getAttribute('data-open') ?? null,
        head: head === null ? null : (head.textContent ?? '').trim(),
        body: body !== null,
        bodyText: (body?.textContent ?? '').trim().slice(0, 24),
        rowHeight: Math.round(r.height),
        aria: (head ?? body)?.getAttribute('aria-expanded') ?? null,
        cursor: body === null ? null : getComputedStyle(body.firstElementChild ?? body).cursor,
      }
    })
    // Start from rest, whichever face the pass above left behind.
    for (let guard = 0; guard < 3; guard++) {
      const row = view.locator('.dsh-dschat-think').first()
      if (await row.getAttribute('data-open') === null) break
      await view.locator('.dsh-dschat-think-body').first().click({ position: { x: 40, y: 12 } })
      await view.waitForTimeout(150)
    }
    const collapsed = await read()
    await shot('02-thinking-collapsed')
    // Open it by its line.
    const line = view.locator('.dsh-dschat-think-head').first()
    if (await line.count() > 0) {
      await line.click()
      await view.waitForTimeout(200)
    }
    const expanded = await read()
    await shot('02b-thinking-open-body-only')
    // Close it by pressing the text, which is the only collapse control left.
    const body = view.locator('.dsh-dschat-think-body').first()
    if (await body.count() > 0) {
      await body.click({ position: { x: 40, y: 12 } })
      await view.waitForTimeout(200)
    }
    const reclosed = await read()
    return { collapsed, expanded, reclosed }
  })()
  await shot('02c-thinking-recollapsed')

  // Expand the sources list.
  const sourcesHead = view.locator('.dsh-dschat-sources-head').first()
  if (await sourcesHead.count() > 0) {
    await sourcesHead.click()
    await view.waitForTimeout(200)
    await shot('03-sources-open')
  }

  // Drag the rail narrower, then wider, and measure what the DOM reports.
  const handle = view.locator('.dsh-dschat-rail-resize')
  if (await handle.count() > 0) {
    const r = await handle.boundingBox()
    await view.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    await view.mouse.down()
    await view.mouse.move(r.x - 80, r.y + r.height / 2, { steps: 8 })
    await view.mouse.up()
    await view.waitForTimeout(150)
    report.probes.railAfterNarrowDrag = await view.evaluate(() => ({
      width: Math.round(document.querySelector('.dsh-dschat-rail').getBoundingClientRect().width),
      aria: document.querySelector('.dsh-dschat-rail-resize').getAttribute('aria-valuenow'),
      stored: (() => { try { return window.localStorage.getItem('dsh-dschat.rail.width') } catch { return 'unavailable' } })(),
    }))
    await shot('04-rail-narrowed')
  }
  /*
   * Dark mode last, and on the SAME page: this profile runs the dark palette
   * (`ui-theme.preference: dark`), and every surface this change added — the
   * reasoning row, the sources row, the drag handle — is a new place a token
   * can land wrong (a hairline that disappears, a menu that turns into a light
   * slab). The harness sheet flips on `body[data-ds-dark-theme]`, exactly like
   * the shell does.
   */
  await view.evaluate(() => { document.body.dataset.dsDarkTheme = 'true' })
  await view.waitForTimeout(250)
  // Both disclosures were left OPEN by the light-mode pass; close them so the
  // picture shows the resting state a reader actually meets.
  for (const selector of ['.dsh-dschat-sources-head', '.dsh-dschat-think-head']) {
    const head = view.locator(selector).first()
    if (await head.count() > 0 && await head.getAttribute('aria-expanded') === 'true') {
      await head.click()
      await view.waitForTimeout(150)
    }
  }
  await shot('05-dark')
  // And open once more, so the expanded styling is checked in dark too.
  for (const selector of ['.dsh-dschat-think-head', '.dsh-dschat-sources-head']) {
    const head = view.locator(selector).first()
    if (await head.count() > 0 && await head.getAttribute('aria-expanded') === 'false') {
      await head.click()
      await view.waitForTimeout(150)
    }
  }
  await shot('06-dark-open')
  report.probes.dark = await view.evaluate(() => {
    const read = selector => {
      const el = document.querySelector(selector)
      return el === null ? null : getComputedStyle(el).backgroundColor
    }
    /*
     * The pills, read in the theme where they were reported broken.
     *
     * The bug was a CASCADE MISS, not a wrong token: the dark "on" rule named
     * the pill but not its label, so the label's light-mode colour won on
     * document order and a lit pill rendered near-white words on a cold blue
     * fill. Reading the LABEL is therefore the assertion that matters — the
     * pill's own background was correct even while the pill looked wrong.
     */
    const pills = [...document.querySelectorAll('.dsh-dschat-toggle')].map(el => {
      const label = el.querySelector('.dsh-dschat-toggle-text') ?? el
      const cs = getComputedStyle(el)
      const ls = getComputedStyle(label)
      return {
        text: (el.textContent ?? '').trim(),
        on: el.className.includes('toggle-on'),
        pillFill: cs.backgroundColor,
        pillBorder: cs.borderColor,
        labelColor: ls.color,
        labelFill: ls.backgroundColor,
        glyphColor: getComputedStyle(el.querySelector('svg') ?? el).color,
        labelMatchesGlyph: ls.color === getComputedStyle(el.querySelector('svg') ?? el).color,
        // The lit pill's words must be the accent, not the primary label ramp.
        labelIsPrimary: ls.color === getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim()
          || ls.color === 'rgb(249, 250, 251)',
      }
    })
    return {
      panel: read('.dsh-dschat'),
      think: read('.dsh-dschat-think'),
      thinkHead: read('.dsh-dschat-think-head'),
      thinkBody: read('.dsh-dschat-think-body'),
      sources: read('.dsh-dschat-sources'),
      pills,
    }
  })

  /* ---------------------------------------------------------------------
   * The 0.3 pass: the header controls, the composer on the web app's metrics,
   * and the live reasoning line.
   *
   * Back to the light theme first — the measurements below are compared against
   * chat.deepseek.com's light palette — then a fresh reload so every control
   * starts in its resting state.
   * ------------------------------------------------------------------- */
  await view.evaluate(() => { delete document.body.dataset.dsDarkTheme })
  await view.reload({ waitUntil: 'load' })
  await view.waitForSelector('.dsh-dschat-thread', { timeout: 10_000 })
  await view.waitForTimeout(600)

  report.probes.header = await view.evaluate(() => {
    const box = el => {
      if (el === null) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        color: cs.color, background: cs.backgroundColor, radius: cs.borderRadius,
      }
    }
    const buttons = [...document.querySelectorAll('.dsh-dschat-hbtns > button')]
    return {
      buttons: buttons.map(el => ({ ...box(el), title: el.getAttribute('title'), pressed: el.getAttribute('aria-pressed') })),
      count: buttons.length,
      brandAfterToolbar: (() => {
        const header = document.querySelector('.dsh-dschat-header')
        return [...(header?.children ?? [])].map(el => el.className)
      })(),
    }
  })
  await shot('07-header', { clip: { x: 0, y: 0, width: 700, height: 52 } })

  // The composer, measured against the web app's own numbers.
  report.probes.composer = await view.evaluate(() => {
    const read = selector => {
      const el = document.querySelector(selector)
      if (el === null) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderRadius,
        background: cs.backgroundColor, color: cs.color, border: cs.border,
        padding: cs.padding, fontSize: cs.fontSize, fontWeight: cs.fontWeight, gap: cs.gap,
      }
    }
    return {
      card: read('.dsh-dschat-card'),
      tools: read('.dsh-dschat-tools'),
      /*
       * The LABEL's colour, read from the label element rather than the pill:
       * the pill's own `color` is inherited by nothing once the span resolves
       * its own, and it is the span the reader actually sees. Reading the
       * parent made a correct pill look like it had lost its accent.
       */
      pills: [...document.querySelectorAll('.dsh-dschat-toggle')].map(el => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const label = el.querySelector('.dsh-dschat-toggle-text')
        return {
          text: (el.textContent ?? '').trim(),
          on: el.className.includes('toggle-on'),
          w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderRadius,
          background: cs.backgroundColor, border: cs.border,
          color: getComputedStyle(label ?? el).color,
          glyph: getComputedStyle(el.querySelector('svg') ?? el).color,
        }
      }),
      attach: read('.dsh-dschat-attach'),
      send: read('.dsh-dschat-send'),
      sendDisabled: document.querySelector('.dsh-dschat-send')?.disabled ?? null,
    }
  })
  await shot('08-composer', { clip: { x: 260, y: 600, width: 1020, height: 220 } })

  // The live reasoning line: prefix, tail, and whether the tail actually scrolled.
  report.probes.liveThinking = await view.evaluate(() => {
    const row = document.querySelector('.dsh-dschat-think[data-live="true"]')
    if (row === null) return { missing: true }
    const prefix = row.querySelector('.dsh-dschat-think-live-prefix')
    const tail = row.querySelector('.dsh-dschat-think-live-tail')
    const clip = row.querySelector('.dsh-dschat-think-live-clip')
    const head = row.querySelector('.dsh-dschat-think-head')
    return {
      prefix: prefix?.textContent ?? null,
      prefixColor: prefix === null || prefix === undefined ? null : getComputedStyle(prefix).color,
      tailText: (tail?.textContent ?? '').slice(-24),
      tailTransform: tail?.style.transform ?? '',
      tailScrollWidth: tail?.scrollWidth ?? null,
      clipWidth: clip?.clientWidth ?? null,
      oneLine: head === null ? null : head.getBoundingClientRect().height,
      open: row.getAttribute('data-open'),
      // The finished rows must NOT be wearing the live treatment.
      finishedRows: [...document.querySelectorAll('.dsh-dschat-think')]
        .filter(el => el.getAttribute('data-live') !== 'true')
        .map(el => ({
          label: el.querySelector('.dsh-dschat-think-label')?.textContent ?? '',
          live: el.querySelector('.dsh-dschat-think-live') !== null,
          open: el.getAttribute('data-open'),
        })),
    }
  })
  await shot('09-live-thinking', { clip: { x: 260, y: 300, width: 1020, height: 300 } })

  // The rail toggle: press it, and the column must leave the DOM.
  const historyButton = view.locator('.dsh-dschat-hbtns > button').first()
  await historyButton.click()
  await view.waitForTimeout(250)
  report.probes.railCollapsed = await view.evaluate(() => ({
    rail: document.querySelector('.dsh-dschat-rail') !== null,
    handle: document.querySelector('.dsh-dschat-rail-resize') !== null,
    headerButtons: [...document.querySelectorAll('.dsh-dschat-hbtns > button')].map(el => el.getAttribute('aria-pressed')),
    stored: (() => { try { return window.localStorage.getItem('dsh-dschat.rail.open') } catch { return 'unavailable' } })(),
  }))
  await shot('10-rail-collapsed')
  await historyButton.click()
  await view.waitForTimeout(250)
  report.probes.railRestored = await view.evaluate(() => ({
    rail: document.querySelector('.dsh-dschat-rail') !== null,
    width: Math.round(document.querySelector('.dsh-dschat-rail')?.getBoundingClientRect().width ?? 0),
  }))

  // The header's search button: it must open the list and land the cursor in it.
  const searchButton = view.locator('.dsh-dschat-hbtns > button').nth(1)
  await searchButton.click()
  await view.waitForTimeout(250)
  report.probes.searchFocus = await view.evaluate(() => ({
    focused: document.activeElement?.className ?? null,
    placeholder: document.activeElement?.getAttribute('placeholder') ?? null,
  }))
  await shot('11-search-focus', { clip: { x: 0, y: 0, width: 700, height: 260 } })

  await browser.close()
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify({ ...report, errors }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...report, errors }, null, 2))
} finally {
  rmSync(dir, { recursive: true, force: true })
}
