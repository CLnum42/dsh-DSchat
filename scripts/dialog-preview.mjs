/**
 * Render the REAL panel from two source states side by side, for a UI change
 * that is a change of STRUCTURE rather than of colour.
 *
 * `proposal-preview.mjs` compares two stylesheets over one component tree: the
 * palettes differ, the markup does not, so it can drive both panes from one
 * bundle. This sheet exists for the other kind of change — 输入框高度 and
 * 会话列表 becoming a dialog — where the SECOND pane has different markup, and
 * a CSS override therefore cannot express it.
 *
 * So both panes are bundled here, each from its own source tree:
 *
 *   --base  <dir>   the tree photographed on the left  (default: repo src)
 *   --alt   <dir>   the tree photographed on the right (default: same as base)
 *
 * A diff of the two trees is the proposal. Both panes are still the shipped
 * React component, the shipped stylesheet and the shipped locale — this is a
 * screenshot of the product, not a mock of it.
 *
 * Two knobs drive the panel into the state each shot is about:
 *
 *   --rail-open true|false   what the left pane's 会话列表 defaults to
 *                            (the panel reads it from localStorage at mount)
 *   --open-sessions true     click the 会话列表 trigger in BOTH panes after
 *                            mount — a real click, through the same selector
 *                            the tests use, so the shot proves the button opens
 *                            something rather than that a flag was set
 *
 * Usage:
 *   node scripts/dialog-preview.mjs \
 *     --base .tmp-before-src --alt src/client \
 *     --rail-open false --open-sessions true \
 *     --out docs/proposal-v0.8-ui
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
const bool = (name, fallback) => {
  const value = flag(name, undefined)
  return value === undefined ? fallback : value === 'true' || value === '1'
}
const resolve = value => (value.startsWith('/') ? value : join(root, value))

const baseDir = resolve(flag('base', 'src/client'))
const altDir = resolve(flag('alt', flag('base', 'src/client')))
const outDir = join(root, flag('out', '.tmp-dialog-preview'))
/*
 * The list starts CLOSED in both panes, and is opened by a real click (see
 * `--open-sessions`).
 *
 * `--rail-open` writes the panel's own preference key, and it is kept for one
 * case only: a pane whose storage works and whose initial state therefore
 * survives. It CANNOT be the normal path, because these frames have no usable
 * localStorage at all (the sandboxed iframe throws on access), and the panel's
 * documented default for a missing preference is OPEN — which, in the new
 * tree, means a conversation-list dialog covering the very screenshot that was
 * supposed to show an empty composer. So the sheet drives the state the way a
 * reader does: it clicks the trigger and waits for the surface to appear.
 */
const railOpenBase = bool('rail-open-base', bool('rail-open', false))
const railOpenAlt = bool('rail-open-alt', bool('rail-open', false))
const openSessions = bool('open-sessions', false)
const captions = {
  left: { label: flag('label-left', '现在'), tag: 'old' },
  right: { label: flag('label-right', '提案'), tag: 'new' },
  note: flag('note', ''),
}

/**
 * Panel-sized, and tall enough that the whole composer is in frame: the two
 * things this sheet is about both live at the bottom (the input) or fill the
 * panel (the dialog), so the transcript must not be cropped to reach them.
 */
const WIDE = {
  width: Number(flag('width', '620')),
  height: Number(flag('height', '780')),
}

/** One short conversation: enough bubbles to give the dialog a backdrop. */
const DEMO = [{
  id: 'chat-demo',
  title: '关于上下文组织的对话',
  ts: Date.now() - 60_000,
  updatedAt: Date.now(),
  messageCount: 3,
  source: 'synthetic',
  messages: [
    { id: 'm1', role: 'user', ts: Date.now() - 300_000, content: '迁移到 harness 之后，新会话的上下文要怎么组织比较好？' },
    {
      id: 'm2',
      role: 'assistant',
      ts: Date.now() - 240_000,
      thinkingMs: 72_000,
      content: '建议分三层组织：目标、约束、待办。目标写一句话，约束写死不能改的，待办按优先级排。',
    },
    { id: 'm3', role: 'user', ts: Date.now() - 60_000, content: '先把会话列表改成弹窗吧。' },
  ],
}]

/**
 * The conversation list the panel shows when the list is open.
 *
 * `state.chats` is the SUMMARY projection (no `messages`), which is what the
 * list actually renders — the full transcript is fetched per chat on open.
 */
const LIST = [
  DEMO[0],
  {
    id: 'chat-1', title: '把英文翻译为通顺的中文', ts: Date.now() - 3_600_000,
    updatedAt: Date.now() - 3_600_000, messageCount: 6, source: 'web',
  },
  {
    id: 'chat-2', title: '总结这份文档的主要内容', ts: Date.now() - 86_400_000,
    updatedAt: Date.now() - 86_400_000, messageCount: 12, source: 'web',
  },
  {
    id: 'chat-3', title: 'SQLite 索引为什么没走上', ts: Date.now() - 172_800_000,
    updatedAt: Date.now() - 172_800_000, messageCount: 24, source: 'web',
  },
  {
    id: 'chat-4', title: '润色这段产品文案', ts: Date.now() - 604_800_000,
    updatedAt: Date.now() - 604_800_000, messageCount: 4, source: 'web',
  },
]

/*
 * `--list-size N` pads the conversation list with plausible rows, so the two
 * things a floating list has to get right — the CEILING (a long list must not
 * open off the top of the panel) and the INTERNAL SCROLL (the search box and the
 * footer stay put while the rows move) — can be photographed instead of
 * asserted. The default is the five hand-written conversations below.
 */
const listSize = Number(flag('list-size', '0'))
const padded = listSize > LIST.length
  ? LIST.concat(Array.from({ length: listSize - LIST.length }, (_, index) => ({
    id: `chat-extra-${index}`,
    title: `示例对话 ${index + 1}：一段足够长的标题用来检查截断`,
    ts: Date.now() - (index + 8) * 3_600_000,
    updatedAt: Date.now() - (index + 8) * 3_600_000,
    messageCount: (index % 9) + 2,
    source: 'web',
  })))
  : LIST

const summaries = list => list.map(({ messages, ...summary }) => ({ ...summary, messageCount: (messages ?? []).length }))
const WITH_CHAT = { engine: 'ready', loggedIn: true, busy: false, streaming: false, chats: summaries(DEMO), activeChatId: DEMO[0].id }
const WITH_LIST = { engine: 'ready', loggedIn: true, busy: false, streaming: false, chats: summaries(padded), activeChatId: padded[0].id }

const SHOTS = [
  { name: '01-输入框高度-浅色', state: WITH_CHAT, dark: false },
  { name: '02-输入框高度-深色', state: WITH_CHAT, dark: true },
  { name: '03-会话列表浮层-浅色', state: WITH_LIST, dark: false, open: true },
  { name: '04-会话列表浮层-深色', state: WITH_LIST, dark: true, open: true },
]

/**
 * Bundle one source tree.
 *
 * `dir` is the tree's `src/client` directory, so the three imports and the
 * stub API below are identical for both panes — the only difference between
 * them is which files they were built from.
 */
async function bundle(dir, scratch) {
  const entry = join(scratch, `entry-${Math.random().toString(36).slice(2)}.tsx`)
  writeFileSync(entry, `
    import { createElement } from 'react'
    import { createRoot } from 'react-dom/client'
    import { DSchatPanel } from ${JSON.stringify(join(dir, 'panel/DSchatPanel.tsx'))}
    import { zh } from ${JSON.stringify(join(dir, 'locales.ts'))}
    import { PANEL_CSS } from ${JSON.stringify(join(dir, 'panel/styles.ts'))}

    /*
     * A stub API answering exactly what the empty page, the composer and the
     * conversation list ask for. Anything the panel would only call after a
     * click that this sheet does not make stays pending.
     */
    const pending = () => new Promise(() => undefined)
    function makeApi(state) {
      const ok = async (extra) => ({ ok: true, ...extra })
      const chats = state.chats ?? []
      return {
        state: async () => ok({
          engine: 'ready', loggedIn: true, busy: false, deepThink: true, search: true,
          version: '0.6.4', build: '2026-10-11T00:00:00.000Z',
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
  const outfile = join(scratch, `bundle-${Math.random().toString(36).slice(2)}.js`)
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
  return readFileSync(outfile, 'utf8')
}

function frameHtml({ tokens, bundle, state, rail }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${tokens}</style>
<style>
  html, body { margin: 0; height: 100%; background: var(--dsw-alias-bg-base); }
  #seat { width: 100%; height: 100%; }
</style>
</head>
<body><div id="seat"></div>
<script>
  /*
   * The list's initial state, forced before the bundle runs.
   *
   * The panel reads this synchronously from localStorage in its useState
   * initialiser, so writing it after mount is too late. localStorage itself is
   * NOT usable here: each pane is a sandboxed iframe and every access throws,
   * which the panel correctly treats as "no preference stored" — and its
   * documented default for that is OPEN, i.e. the old sidebar. In the new tree
   * that default is a dialog over the whole panel, so a sheet that meant to
   * photograph an empty composer got a conversation list instead, and the
   * failure looked exactly like a bug in the panel.
   *
   * The override therefore replaces the Storage object for this document only,
   * before React can capture a reference to the real one. The bundled panel
   * shares this scope (it is inlined into the same script), so its window
   * lookup finds the shim. The key is a constant from the panel itself
   * (RAIL_OPEN_STORE, src/client/panel/DSchatPanel.tsx).
   */
  (function forceListState(open) {
    const KEY = 'dsh-dschat.rail.open'
    const memory = new Map([[KEY, open ? '1' : '0']])
    const shim = {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => { memory.set(key, String(value)) },
      removeItem: (key) => { memory.delete(key) },
      clear: () => { memory.clear() },
      key: (index) => Array.from(memory.keys())[index] ?? null,
      get length() { return memory.size },
    }
    /*
     * Assignment, not defineProperty.
     *
     * In an opaque origin (a sandboxed iframe) accessing window.localStorage
     * THROWS, and a throwing accessor cannot be redefined — defineProperty
     * itself fails, the whole frame script dies before mounting the panel, and
     * the sheet photographs an empty div. A plain assignment does not go
     * through the throwing getter, so it replaces the property outright.
     */
    try { window.localStorage = shim } catch (error) { /* left as-is: the probe reports ERR */ }
  })(${rail ? 'true' : 'false'})
</script>
<script>${bundle}</script>
<script>window.__mount(${JSON.stringify(state)});</script>
</body></html>`
}

const scratch = mkdtempSync(join(root, '.tmp-dialog-build-'))
mkdirSync(outDir, { recursive: true })
const report = { baseDir, altDir, railOpenBase, railOpenAlt, openSessions, shots: [], errors: [] }

try {
  const baseBundle = await bundle(baseDir, scratch)
  const altBundle = await bundle(altDir, scratch)
  const tokens = readFileSync(join(root, 'refs/dsh-tokens.css'), 'utf8')

  /*
   * The frames are served over loopback HTTP rather than opened as files, for
   * the reason recorded in proposal-preview.mjs: a `file://` document is an
   * opaque origin, and a sheet that embeds two of them cannot read either back.
   */
  const server = createServer((request, response) => {
    const name = decodeURIComponent(request.url.split('?')[0]).replace(/^\//, '') || 'index.html'
    const file = join(scratch, name)
    if (!existsSync(file)) { response.writeHead(404); response.end('not found'); return }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(readFileSync(file))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  const writeFrame = (name, bundleJs, state, rail) => {
    const file = join(scratch, `${name}.html`)
    writeFileSync(file, frameHtml({ tokens, bundle: bundleJs, state, rail }), 'utf8')
    /*
     * The initial list state travels in the QUERY, not in the frame's own
     * storage: these frames are sandboxed, so localStorage throws inside them
     * and no amount of writing before mount can influence the panel. The panel
     * reads this parameter itself (see initialListOpen) and it wins over the
     * stored preference. The cache-buster rides along so no layer between here
     * and Chrome can serve a previous run's document.
     */
    const nonce = Math.random().toString(36).slice(2)
    return `${origin}/${encodeURIComponent(name)}.html?dschat-list=${rail ? 'open' : 'closed'}&v=${nonce}`
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const view = await browser.newPage({
    viewport: { width: WIDE.width * 2 + 60, height: WIDE.height + 120 },
    deviceScaleFactor: 2,
  })
  view.on('console', message => {
    if (message.type() === 'error') report.errors.push(`console: ${message.text()}`)
  })
  view.on('pageerror', error => report.errors.push(`pageerror: ${error.message}`))

  const frameOf = async (id) => {
    const handle = await view.$(`#${id}`)
    return handle === null ? null : handle.contentFrame()
  }
  /** Both panes really mounted; a blank iframe is the one failure a PNG hides. */
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
    const baseUrl = writeFrame(`base-${shot.name}`, baseBundle, shot.state, railOpenBase)
    const altUrl = writeFrame(`alt-${shot.name}`, altBundle, shot.state, railOpenAlt)

    await view.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 24px 26px 34px; background: #eceef1;
    font: 13px/1.5 -apple-system, "PingFang SC", "Segoe UI", system-ui, sans-serif; color: #14171c;
  }
  /* width:max-content so the sheet is never narrower than its panes; without
     it flex-shrink quietly narrows BOTH iframes (the left one more), and the two
     renders stop being the same number of CSS pixels. */
  .sheet { display: flex; gap: 24px; align-items: flex-start; width: max-content; }
  .pane { display: flex; flex-direction: column; gap: 10px; flex: none; }
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
</style></head><body>
  <div class="sheet">
    <div class="pane">
      <div class="cap"><span class="tag ${captions.left.tag}">现在</span><b>${captions.left.label}</b></div>
      <iframe id="pane-base" src="${baseUrl}"></iframe>
    </div>
    <div class="pane">
      <div class="cap"><span class="tag ${captions.right.tag}">提案</span><b>${captions.right.label}</b></div>
      <iframe id="pane-alt" src="${altUrl}"></iframe>
    </div>
  </div>
  <div class="foot">两侧都是同一份真实组件（各自的 <code>DSchatPanel.tsx</code> / <code>styles.ts</code> / <code>locales.ts</code>）。
  ${captions.note}</div>
</body></html>`, { waitUntil: 'load' })

    await view.waitForTimeout(400)
    if (!await waitForPanes()) report.errors.push(`blank panes in ${shot.name}`)

    if (shot.dark) {
      for (const frame of view.frames()) {
        if (frame === view.mainFrame()) continue
        await frame.evaluate(() => { document.body.dataset.dsDarkTheme = 'true' })
      }
      await view.waitForTimeout(700)
    } else {
      await view.waitForTimeout(300)
    }

    /*
     * The click, in every pane, AFTER mount.
     *
     * It goes through the trigger's class rather than a flag so the shot proves
     * the button is wired to the dialog. The old tree has no such trigger (its
     * list is the rail), so a pane without it is not an error — it is the
     * baseline.
     *
     * The click is dispatched IN PAGE rather than through Playwright's
     * `elementHandle.click()`. That API re-checks actionability after the
     * click: the dialog the first click opened then covers the trigger, so the
     * retry never fires, times out, and the run dies with "intercepts pointer
     * events" — while the screenshot it was trying to take sits one click
     * behind it. A plain DOM click fires exactly once, and React's delegated
     * root listener handles it identically.
     */
    if (openSessions && (shot.open ?? false)) {
      for (const id of ['pane-base', 'pane-alt']) {
        const frame = await frameOf(id)
        if (frame === null) { report.errors.push(`no frame for ${id}`); continue }
        /*
         * Click, then CHECK that the surface is up, and retry if it is not.
         *
         * The first version clicked once and trusted it. In the pane that
         * matters that click is sometimes lost: the pane is still finishing its
         * first paint when the trigger is found, React commits a render over
         * it, and the shot then records a dialog that never opened — while the
         * metrics pass, because they are read from a SEPARATE standalone page
         * where the same click lands. Retrying against the observable result is
         * what makes the picture and the numbers agree.
         */
        const open = async () => frame.evaluate(() => (
          document.querySelector('.dsh-dschat-listpop') !== null
          || document.querySelector('.dsh-dschat-rail') !== null
        ))
        for (let attempt = 0; attempt < 5; attempt += 1) {
          if (await open()) break
          await frame.evaluate(() => {
            /*
             * Two trees, two shapes, one verb: 会话列表.
             *
             * The new tree marks the button with a class. The old one has no
             * marker and its title is LOCALIZED text, so matching on the
             * message key finds nothing and on the Chinese label would break
             * the moment the locale changes. The glyph is the stable handle:
             * that button is the only control in either tree whose <svg> draws
             * the list mark, and the mark itself is what changed in this
             * proposal (a panel-with-gutter became three rules) — so the
             * selector matches one path or the other and nothing else.
             */
            const marker = '[d="M6.2 3.1v9.8"], rect[x="2.1"][y="3.1"]'
            const trigger = document.querySelector('.dsh-dschat-tbtn-sessions')
              ?? Array.from(document.querySelectorAll('.dsh-dschat button'))
                .find(node => node.querySelector('svg ' + marker)
                  || Array.from(node.querySelectorAll('path')).some(path =>
                    (path.getAttribute('d') ?? '').includes('M6.2 3.1v9.8')))
            if (trigger !== undefined && trigger !== null) trigger.click()
          })
          await view.waitForTimeout(500)
        }
        if (!await open()) report.errors.push(`${id} did not open on click (${shot.name})`)
      }
    }

    /*
     * Read the panes back IMMEDIATELY before the capture, and put what they say
     * in the report.
     *
     * This is the check that would have caught the two defects this script had
     * while it was being written: a shared rail preference that CLOSED the
     * dialog the click had just opened, and a sheet whose flex sizing narrowed
     * both iframes so the pictures were of two different scales. A PNG cannot
     * say either of those things; a probe can.
     */
    const state = {}
    for (const id of ['pane-base', 'pane-alt']) {
      const frame = await frameOf(id)
      state[id] = frame === null ? null : await frame.evaluate(() => {
        const dialog = document.querySelector('.dsh-dschat-listpop')
        const rail = document.querySelector('.dsh-dschat-rail')
        const trigger = document.querySelector('.dsh-dschat-tbtn-sessions')
        return {
          dialog: dialog !== null,
          dialogRows: dialog === null ? 0 : dialog.querySelectorAll('.dsh-dschat-item').length,
          rail: rail !== null,
          railRows: rail === null ? 0 : rail.querySelectorAll('.dsh-dschat-item').length,
          triggerOn: trigger === null ? null : trigger.className.includes('hbtn-on'),
          listOpen: document.querySelector('.dsh-dschat')?.getAttribute('data-list-open') ?? null,
          stored: (() => { try { return window.localStorage.getItem('dsh-dschat.rail.open') } catch (e) { return 'ERR' } })(),
          panes: document.querySelectorAll('iframe').length,
          inputHeight: Math.round(document.querySelector('.dsh-dschat-input')?.getBoundingClientRect().height ?? 0),
          viewport: { w: window.innerWidth, h: window.innerHeight },
        }
      })
    }
    report.panes = { ...(report.panes ?? {}), [shot.name]: state }

    const file = join(outDir, `${shot.name}.png`)
    await view.screenshot({ path: file, fullPage: true })
    report.shots.push(file)
    console.log('[dialog] wrote', shot.name)
  }

  /* ---- the numbers, read back from the live DOM of each pane ---- */
  const measure = async (url, dark, sessions) => {
    const frame = await browser.newPage({ viewport: WIDE, deviceScaleFactor: 1 })
    await frame.goto(url, { waitUntil: 'load' })
    await frame.waitForSelector('.dsh-dschat-thread', { timeout: 10_000 })
    if (dark) await frame.evaluate(() => { document.body.dataset.dsDarkTheme = 'true' })
    await frame.waitForTimeout(600)
    if (sessions) {
      const target = await frame.$('.dsh-dschat-tbtn-sessions')
      if (target !== null) {
        await frame.evaluate(() => document.querySelector('.dsh-dschat-tbtn-sessions')?.click())
        await frame.waitForTimeout(500)
      }
    }
    const out = await frame.evaluate(() => {
      const box = selector => {
        const el = document.querySelector(selector)
        if (el === null) return null
        const rect = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return {
          w: Math.round(rect.width), h: Math.round(rect.height),
          top: Math.round(rect.top), bottom: Math.round(rect.bottom),
          minHeight: cs.minHeight, maxHeight: cs.maxHeight,
          padding: cs.padding, lineHeight: cs.lineHeight, fontSize: cs.fontSize,
        }
      }
      const input = document.querySelector('.dsh-dschat-input')
      return {
        panel: box('.dsh-dschat'),
        card: box('.dsh-dschat-card'),
        input: box('.dsh-dschat-input'),
        /* How many text lines the empty box shows, at the panel's own metrics. */
        inputLines: input === null ? null
          : Math.round((input.getBoundingClientRect().height
            - parseFloat(getComputedStyle(input).paddingTop)
            - parseFloat(getComputedStyle(input).paddingBottom))
            / parseFloat(getComputedStyle(input).lineHeight) * 10) / 10,
        thread: box('.dsh-dschat-thread'),
        list: box('.dsh-dschat-rail, .dsh-dschat-dialog'),
        listToggleIcon: (() => {
          const svg = document.querySelector('.dsh-dschat-tbtn-sessions svg')
          if (svg === null) return null
          const html = svg.innerHTML
          return {
            /* A three-bar glyph is three strokes; the history glyph is a circle
               plus a hand. */
            strokes: (html.match(/<line|<rect|<path/g) ?? []).length,
            circles: (html.match(/<circle|<ellipse/g) ?? []).length,
            path: svg.querySelector('path')?.getAttribute('d')?.slice(0, 100) ?? null,
          }
        })(),
        anchors: (() => {
          /* The FIRST wrapper on the row is 会话列表's; the second is 迁移's.
             Naming it by position keeps the probe off the header's own 「···」
             wrapper, which is also a .dsh-dschat-pop-wrap. */
          const wrap = document.querySelector('.dsh-dschat-actions .dsh-dschat-pop-wrap')
          const trig = document.querySelector('.dsh-dschat-tbtn-sessions')
          const pop = document.querySelector('.dsh-dschat-listpop')
          const actions = document.querySelector('.dsh-dschat-actions')
          const r = node => { if (node === null) return null; const b = node.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) } }
          return { wrap: r(wrap), trig: r(trig), pop: r(pop), actions: r(actions),
            wrapPosition: wrap === null ? null : getComputedStyle(wrap.parentElement).position }
        })(),
        availVar: (() => {
          const wrap = document.querySelector('.dsh-dschat-actions .dsh-dschat-pop-wrap')
          if (wrap === null) return null
          return {
            inline: wrap.style.getPropertyValue('--dschat-list-avail') || null,
            popMaxHeight: (() => {
              const pop = wrap.querySelector('.dsh-dschat-listpop')
              return pop === null ? null : getComputedStyle(pop).maxHeight
            })(),
            wrapTop: Math.round(wrap.getBoundingClientRect().top),
          }
        })(),
        listMetrics: (() => {
          const row = document.querySelector('.dsh-dschat-listpop .dsh-dschat-item')
          const list = document.querySelector('.dsh-dschat-listpop .dsh-dschat-list')
          const foot = document.querySelector('.dsh-dschat-listpop-foot')
          const search = document.querySelector('.dsh-dschat-listpop .dsh-dschat-search')
          const pop = document.querySelector('.dsh-dschat-listpop')
          if (row === null || list === null || foot === null || search === null || pop === null) return null
          const px = node => Math.round(node.getBoundingClientRect().height)
          const popStyle = getComputedStyle(pop)
          return {
            row: px(row), search: px(search), foot: px(foot),
            popPadding: popStyle.paddingTop + '/' + popStyle.paddingBottom,
            chrome: px(pop) - list.clientHeight,
            visibleRows: Math.round((list.clientHeight / px(row)) * 10) / 10,
            lastRowHidden: (() => {
              const rows = list.querySelectorAll('.dsh-dschat-item')
              const last = rows[rows.length - 1]
              if (last === undefined) return null
              const listBox = list.getBoundingClientRect()
              const lastBox = last.getBoundingClientRect()
              return Math.round(lastBox.bottom - listBox.bottom)
            })(),
          }
        })(),
        listScroll: (() => {
          const el = document.querySelector('.dsh-dschat-listpop .dsh-dschat-list')
          if (el === null) return null
          return {
            clientH: el.clientHeight, scrollH: el.scrollHeight,
            scrollable: el.scrollHeight > el.clientHeight,
            overflowY: getComputedStyle(el).overflowY,
          }
        })(),
        listpopStyle: (() => {
          const el = document.querySelector('.dsh-dschat-listpop')
          if (el === null) return null
          const cs = getComputedStyle(el)
          const wrap = el.parentElement
          return {
            maxHeight: cs.maxHeight, height: cs.height, overflow: cs.overflow,
            bottom: cs.bottom, top: cs.top, position: cs.position,
            wrapH: wrap === null ? null : wrap.getBoundingClientRect().height,
            wrapMaxH: wrap === null ? null : getComputedStyle(wrap).maxHeight,
          }
        })(),
        dialogCard: box('.dsh-dschat-listpop, .dsh-dschat-modal-card'),
        dialogSearch: box('.dsh-dschat-listpop .dsh-dschat-search'),
        dialogRows: document.querySelectorAll('.dsh-dschat-listpop .dsh-dschat-item').length,
        railRows: document.querySelectorAll('.dsh-dschat-rail .dsh-dschat-item').length,
      }
    })
    await frame.close()
    return out
  }

  /*
   * The measurements mirror the SHOTS above, `open` included: a probe that
   * clicks in a case the picture does not click in reports a state the reader
   * will never see next to that picture. (This is how the height comparison
   * briefly gained a dialog in its numbers and not in its PNGs.)
   */
  const shotOpen = name => SHOTS.find(shot => shot.name === name)?.open ?? false
  report.measured = {
    light: await measure(writeFrame('m-base-light', baseBundle, SHOTS[0].state, railOpenBase), false, shotOpen(SHOTS[0].name)),
    lightAlt: await measure(writeFrame('m-alt-light', altBundle, SHOTS[0].state, railOpenAlt), false, shotOpen(SHOTS[0].name)),
    dark: await measure(writeFrame('m-base-dark', baseBundle, SHOTS[1].state, railOpenBase), true, shotOpen(SHOTS[1].name)),
    darkAlt: await measure(writeFrame('m-alt-dark', altBundle, SHOTS[1].state, railOpenAlt), true, shotOpen(SHOTS[1].name)),
    list: await measure(writeFrame('m-base-list', baseBundle, SHOTS[2].state, railOpenBase), false, shotOpen(SHOTS[2].name)),
    listAlt: await measure(writeFrame('m-alt-list', altBundle, SHOTS[2].state, railOpenAlt), false, shotOpen(SHOTS[2].name)),
  }

  await browser.close()
  server.close()
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('[dialog] done ->', outDir)
  if (report.errors.length > 0) console.error('render errors:', report.errors)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
