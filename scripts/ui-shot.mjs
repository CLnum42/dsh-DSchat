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
    /*
     * A web session id, so these rows are the ones that offer 「从网页同步」.
     * Without it the per-row sync action — the only way to top up a conversation
     * that was synced once and then continued on the web — would never appear in
     * a screenshot, which is exactly the kind of thing a rendered check is for.
     */
    webSessionId: `web-demo-${String(count)}`,
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

    /**
     * Every route the panel may call, answered from the fixture.
     *
     * window.__state is the LIVE snapshot: window.__patch moves the engine
     * (a turn ending, a login landing) without reloading the page, which is what
     * makes the busy→idle queue drain testable. window.__calls records every
     * call this API instance served, so a driver can assert on BEHAVIOUR — "the
     * click started the engine", "the send was queued, not refused" — rather
     * than on the markup that happens to be on screen.
     */
    function makeApi(state) {
      const ok = async (extra) => ({ ok: true, ...extra })
      const pending = () => new Promise(() => undefined)
      window.__state = state
      const calls = []
      window.__calls = calls
      const record = (name, fn) => (...args) => {
        calls.push({ name, args })
        return fn(...args)
      }
      /**
       * The wake, as the real engine behaves: it brings the page up AND the
       * profile is signed in, so the snapshot flips to ready. A fixture that
       * wants the failure path sets wakeError, which the FIRST wake consumes
       * — the retry button then meets a healthy engine, which is exactly the
       * sequence 「启动失败 → 重试 → 发送成功」.
       */
      const wake = async () => {
        if (window.__state.wakeError) {
          const error = window.__state.wakeError
          window.__state.wakeError = null
          return { ok: false, error }
        }
        window.__state.engine = 'ready'
        window.__state.loggedIn = true
        return ok({ loggedIn: true, launched: true })
      }
      return {
        state: async () => ({
          ok: true, deepThink: true, search: true,
          engine: 'ready', loggedIn: true, busy: false,
          ...window.__state,
        }),
        tail: async () => ok({ busy: window.__state.busy === true, streaming: window.__state.streaming === true }),
        wake: record('wake', wake),
        context: async () => ok({
          workspaces: [],
          cwd: ${JSON.stringify(process.cwd())},
          /*
           * The 运行状态 card reads these. They are the plugin's real defaults,
           * so the card is rendered with the same row count a reader sees.
           */
          settings: {
            browserChannel: '', browserExecutablePath: '', browserProxy: '', browserHeadless: true,
            replyTimeoutMs: 180000, dataDir: '~/.dsh/dsh-dschat', profileDir: '~/.dsh/dsh-webchat/browser-profile',
            exportDir: '~/Downloads', transferDistill: true, transferProvider: '', transferModel: '',
            announceToAgent: true,
          },
        }),
        newChat: async () => ok({ chatId: 'chat-new' }),
        send: record('send', async (text, images) => (window.__state.sendError
          ? { ok: false, ...window.__state.sendError }
          : ok({ chatId: 'chat-a' }))),
        /*
         * The attach route, as the host really answers it.
         *
         * The stored path carries the reader's name after the uuid — that is the
         * part the chip must NOT print — and the returned name is the bare one it
         * must. Built by concatenation rather than a nested template literal:
         * this whole entry is itself a template string, so NO second pair of
         * backticks may appear inside it, in code or in these comments.
         */
        attach: record('attach', async input => ok({
          path: '/tmp/dschat-attachments/58485f1d-8ca8-4307-9f8e-bf21179d654d__' + (input?.name ?? 'file'),
          bytes: 12,
          name: input?.name ?? 'file',
        })),
        /*
         * The thumbnail URL, recorded and answered with visible pixels.
         *
         * The panel points an img at /api/dsh-dschat/attachment?path=… and
         * nothing serves that from a file:// page, so a screenshot could only
         * ever show a broken-image glyph. The call is still RECORDED, which is
         * what proves the panel asked for the right path; this drawing is only
         * what makes the rendered thumbnail something a reader can see. It is
         * percent-encoded end to end because the entry is itself a template
         * string, where a literal quote would be gone before the browser saw it.
         */
        attachmentUrl: record('attachmentUrl', () =>
          'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2256%22%20height%3D%2256%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23cfe0ff%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%234176e6%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2256%22%20height%3D%2256%22%20fill%3D%22url(%23g)%22%2F%3E%3Ccircle%20cx%3D%2220%22%20cy%3D%2220%22%20r%3D%226%22%20fill%3D%22%23ffffff%22%20opacity%3D%220.85%22%2F%3E%3Cpath%20d%3D%22M6%2048l14-16%2010%2012%208-9%2012%2013z%22%20fill%3D%22%23ffffff%22%20opacity%3D%220.75%22%2F%3E%3C%2Fsvg%3E'),
        stop: pending, openLogin: pending, closeBrowser: pending,
        setDeepThink: pending, setSearch: pending, transfer: pending, exportFile: pending,
        renameChat: pending, deleteChat: pending, clearChats: pending, webChats: pending,
        recover: pending, restore: pending,
        /*
         * The hand-off preview, answered with a short sample brief so the
         * preview box can be rendered and measured like any other surface.
         * The transfer call itself stays pending: the shots stop before the
         * write, which is the whole point of having a preview.
         *
         * Newlines are joined with String.fromCharCode(10) rather than an escape
         * sequence: this block is itself inside a template literal, where a
         * backslash-n would be turned into a real newline before the browser
         * ever parsed it.
         */
        transferPreview: record('transferPreview', async () => window.__previewFail === true ? ok({
          markdown: '（原文迁移：整段网页对话记录，约 15,000 字…）',
          distilled: false,
          mode: 'distill',
          fallback: true,
          fallbackReason: '蒸馏不可用（LLM 服务、提供方或模型不可用，或调用未正常结束），本次改用原文迁移',
        }) : ok({
          markdown: [
            '这是一次从 DeepSeek 网页端会话（chat.deepseek.com）转来的上下文交接。',
            '',
            '## 目标',
            '把网页端讨论的面板改版落成一个可执行的实现计划。',
            '',
            '## 已确认',
            '- 迁移前必须先看到首条消息，且可以编辑',
            '- 蒸馏不可用时要明确说明回退成原文',
            '',
            '## 待办',
            '1. 预览接口',
            '2. 确认后写入',
          ].join(String.fromCharCode(10)),
          distilled: true,
          mode: 'distill',
          fallback: false,
          provider: 'deepseek',
          model: 'deepseek-chat',
        })),
      }
    }

    /**
     * Mount the panel against a fixture.
     *
     * The previous tree is UNMOUNTED first: re-rendering the same root would
     * only update props, and every piece of state that matters here — the draft,
     * the outbox, the failure cooldown — lives inside the component. Each mount
     * gets a fresh recorder as well (the old API keeps writing to its own).
     */
    let root = null
    window.__mount = (state) => {
      if (root !== null) root.unmount()
      if (document.querySelector('style[data-ui-shot]') === null) {
        const style = document.createElement('style')
        style.dataset.uiShot = 'true'
        style.textContent = PANEL_CSS
        document.head.appendChild(style)
      }
      const tt = (key) => zh[key] ?? key
      root = createRoot(document.getElementById('seat'))
      root.render(createElement(DSchatPanel, {
        api: makeApi(state),
        tt,
        t: tt,
        openSession: async () => true,
        pickDirectory: async () => null,
        createWorkspace: async () => ({ workspaceId: 'w', title: 'w' }),
      }))
    }

    /** Move the engine without reloading: busy → idle, signed out → signed in. */
    window.__patch = (patch) => { Object.assign(window.__state, patch) }
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
    const header = document.querySelector('.dsh-dschat-header')
    const lamp = document.querySelector('.dsh-dschat-lamp > i')
    const actions = document.querySelector('.dsh-dschat-actions')
    const card = document.querySelector('.dsh-dschat-card')
    return {
      /*
       * The title bar is identity + state + the 「···」 menu, and nothing else:
       * any conversation control still up here would mean the v0.4 move never
       * happened, and any MISSING 「···」 would mean the engine menu lost its
       * visible home again.
       */
      headerChildren: [...(header?.children ?? [])].map(el => el.className),
      headerButtons: [...(header?.querySelectorAll('button') ?? [])].map(el => el.className),
      windowControlsInHeader: header?.querySelectorAll('.dsh-dschat-tbtn').length ?? -1,
      menuInHeader: [...(header?.children ?? [])].at(-1)?.querySelector('.dsh-dschat-tbtn') !== null,
      menuOpensDownward: (() => {
        const pop = header?.querySelector('.dsh-dschat-pop')
        return pop === null || pop === undefined ? null : getComputedStyle(pop).top !== 'auto'
      })(),
      brandName: document.querySelector('.dsh-dschat-brand-name')?.textContent ?? null,
      brand: box(document.querySelector('.dsh-dschat-brand')),
      lamp: box(document.querySelector('.dsh-dschat-lamp')),
      lampDot: lamp === null ? null : { ...box(lamp), background: getComputedStyle(lamp).backgroundColor },
      lampTone: document.querySelector('.dsh-dschat-lamp')?.getAttribute('data-tone') ?? null,
      /* The action row must sit ABOVE the input card, not inside it. */
      actions: box(actions),
      card: box(card),
      actionRowAboveCard: (() => {
        if (actions === null || card === null) return null
        return Math.round(actions.getBoundingClientRect().bottom) <= Math.round(card.getBoundingClientRect().top) + 1
      })(),
      actionButtons: [...document.querySelectorAll('.dsh-dschat-actions > button')].map(el => ({
        ...box(el), title: el.getAttribute('title'), pressed: el.getAttribute('aria-pressed'),
        text: (el.textContent ?? '').trim(),
      })),
      transferLabel: document.querySelector('.dsh-dschat-tbtn-transfer')?.textContent?.trim() ?? null,
      /*
       * Every button on the action row, measured while everything is at rest:
       * all four must read as QUIET toolbar buttons (transparent fill, no
       * border), each carrying its own words — 「DSH 迁移」 is no longer a filled
       * primary chip, and the three conversation buttons are no longer
       * glyph-only squares.
       */
      actionRowButtons: [...document.querySelectorAll('.dsh-dschat-actions > .dsh-dschat-tbtn')].map(el => {
        const cs = getComputedStyle(el)
        return {
          ...box(el), text: (el.textContent ?? '').trim(), title: el.getAttribute('title'),
          pressed: el.getAttribute('aria-pressed'), expanded: el.getAttribute('aria-expanded'),
          border: cs.borderColor, background: cs.backgroundColor, fontWeight: cs.fontWeight,
          glyph: el.querySelector('.dsh-dschat-tbtn-glyph svg, svg') !== null,
          caret: el.querySelector('.dsh-dschat-tbtn-caret') !== null,
        }
      }),
      transferButton: (() => {
        const el = document.querySelector('.dsh-dschat-tbtn-transfer')
        if (el === null) return null
        const cs = getComputedStyle(el)
        return {
          ...box(el), title: el.getAttribute('title'), expanded: el.getAttribute('aria-expanded'),
          border: cs.borderColor, borderWidth: cs.borderWidth, fontWeight: cs.fontWeight,
          caret: el.querySelector('.dsh-dschat-tbtn-caret') !== null,
          glyph: el.querySelector('.dsh-dschat-tbtn-glyph svg') !== null,
        }
      })(),
      /* The title bar's 「···」: the same button, at the other end of the panel. */
      moreButton: (() => {
        const el = document.querySelector('.dsh-dschat-header .dsh-dschat-tbtn')
        if (el === null) return null
        const cs = getComputedStyle(el)
        const headerBox = header.getBoundingClientRect()
        return {
          ...box(el), title: el.getAttribute('title'), expanded: el.getAttribute('aria-expanded'),
          border: cs.borderColor, background: cs.backgroundColor,
          /* The whole point of the move: it sits at the strip's right end. */
          fromRightEdge: Math.round(headerBox.right - el.getBoundingClientRect().right),
          svg: el.querySelector('svg') !== null,
        }
      })(),
      /* The lamp panel's containing block, so a mis-anchored popover is visible here. */
      lampWrap: (() => {
        const el = document.querySelector('.dsh-dschat-lamp-wrap')
        if (el === null) return null
        const r = el.getBoundingClientRect()
        return { className: el.className, position: getComputedStyle(el).position, x: Math.round(r.x), w: Math.round(r.width) }
      })(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
    }
  })
  await shot('07-header', { clip: { x: 0, y: 0, width: 700, height: 52 } })

  /*
   * The lamp's panel: the status sentence, opened from the state dot.
   *
   * It used to be the engine menu as well (four entries); those moved to the
   * action row's 「···」, so what this asserts is that the panel is now exactly
   * the sentence — no buttons at all — which is the "what does the colour mean"
   * answer and nothing else.
   */
  await view.locator('.dsh-dschat-lamp').click()
  await view.waitForTimeout(200)
  report.probes.lampMenu = await view.evaluate(() => {
    const pop = document.querySelector('.dsh-dschat-lamp-wrap .dsh-dschat-pop')
    return {
      open: pop !== null,
      heading: pop?.querySelector('.dsh-dschat-lamp-status')?.textContent ?? null,
      items: [...(pop?.querySelectorAll('button') ?? [])].map(el => (el.textContent ?? '').trim()),
      box: pop === null ? null : (() => {
        const r = pop.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      })(),
      withinViewport: pop === null ? null : pop.getBoundingClientRect().left >= 0,
      /* The resolved anchor, so "which rule won" is answerable from the report. */
      style: pop === null ? null : (() => {
        const cs = getComputedStyle(pop)
        return { bottom: cs.bottom, left: cs.left, right: cs.right, width: cs.width, position: cs.position, offsetParent: pop.offsetParent?.className ?? null }
      })(),
      /* The header's panel still opens BELOW the dot it belongs to. */
      opensBelowTrigger: pop === null ? null : (() => {
        const dot = document.querySelector('.dsh-dschat-lamp').getBoundingClientRect()
        return Math.round(pop.getBoundingClientRect().top) >= Math.round(dot.bottom) - 1
      })(),
    }
  })
  await shot('07b-lamp-menu', { clip: { x: 0, y: 0, width: 700, height: 300 } })
  await view.keyboard.press('Escape')
  await view.waitForTimeout(150)

  /*
   * The two menus on the ACTION ROW, opened for real.
   *
   * This is the change the user asked for, so it is measured rather than
   * asserted: both panels must sit ABOVE their trigger (the anchor moved from
   * below, where the 迁移 panel covered the input card it acts on), both must
   * stay inside the viewport, and the migration button must carry the open-state
   * tint while the panel is up.
   *
   * The clips are anchored on the measured trigger rather than on a guessed y:
   * the action row's height depends on the composer's own metrics, and a fixed
   * clip would silently photograph the wrong strip the next time those change.
   */
  const transferBox = await view.locator('.dsh-dschat-tbtn-transfer').boundingBox()
  const menuClip = transferBox === null
    ? { x: 260, y: 380, width: 1020, height: 420 }
    : {
      x: Math.max(0, Math.round(transferBox.x) - 520),
      y: Math.max(0, Math.round(transferBox.y) - 380),
      width: 700,
      height: 430,
    }
  /**
   * Geometry any menu is judged by (see the note above).
   *
   * One page-side reader taking the trigger's selector, so every menu is
   * measured by the same arithmetic — the panel's own box, its trigger's box,
   * the 8px gap, and BOTH possible vertical relations, so the caller states
   * which one it expects. A menu on the composer's row opens upward; a menu in
   * the title bar opens downward.
   */
  const menuGeometry = selector => view.evaluate(triggerSelector => {
    const wrap = document.querySelector(triggerSelector)?.closest('.dsh-dschat-pop-wrap')
    const pop = wrap?.querySelector('.dsh-dschat-pop') ?? null
    const trigger = wrap?.querySelector('.dsh-dschat-tbtn') ?? null
    const read = el => {
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    }
    if (pop === null || trigger === null) return { open: pop !== null, trigger: read(trigger), panel: null }
    const p = pop.getBoundingClientRect()
    const t = trigger.getBoundingClientRect()
    return {
      open: true,
      panel: read(pop),
      trigger: read(trigger),
      /* Upward: the panel's BOTTOM is above the trigger's TOP. */
      opensUpward: Math.round(p.bottom) <= Math.round(t.top),
      upwardGap: Math.round(t.top - p.bottom),
      /* Downward: the panel's TOP is below the trigger's BOTTOM. */
      opensDownward: Math.round(p.top) >= Math.round(t.bottom),
      downwardGap: Math.round(p.top - t.bottom),
      /* An upward menu must not cover the card it acts on. */
      clearOfComposerCard: Math.round(p.bottom)
        <= Math.round(document.querySelector('.dsh-dschat-card').getBoundingClientRect().top),
      withinViewport: p.left >= 0 && p.right <= window.innerWidth && p.top >= 0 && p.bottom <= window.innerHeight,
      /* The resolved anchor, so "which rule won" is answerable from the report. */
      cssBottom: getComputedStyle(pop).bottom,
      cssTop: getComputedStyle(pop).top,
    }
  }, selector)

  await view.locator('.dsh-dschat-tbtn-transfer').click()
  await view.waitForTimeout(220)
  report.probes.transferPopover = await menuGeometry('.dsh-dschat-tbtn-transfer')
  report.probes.transferPopover.heading = await view.evaluate(
    () => document.querySelector('.dsh-dschat-pop-up h4')?.textContent ?? null,
  )
  report.probes.transferPopover.triggerOpen = await view.evaluate(() => {
    const el = document.querySelector('.dsh-dschat-tbtn-transfer')
    const cs = getComputedStyle(el)
    return { expanded: el.getAttribute('aria-expanded'), background: cs.backgroundColor, border: cs.borderColor }
  })
  report.probes.transferPopover.caretFlipped = await view.evaluate(() => {
    const caret = document.querySelector('.dsh-dschat-tbtn-transfer .dsh-dschat-tbtn-caret')
    return caret === null ? null : getComputedStyle(caret).transform
  })
  await shot('07c-transfer-popover', { clip: menuClip })

  /*
   * The preview step, driven for real: click the dialog's primary button, wait
   * for the editable box, and photograph it. This is the surface the whole
   * trust fix hangs on — if the box were clipped, or the confirm button pushed
   * out of the dialog, a static-markup test would never notice.
   */
  await view.locator('.dsh-dschat-pop-up .dsh-dschat-btn-primary').click()
  await view.locator('.dsh-dschat-preview').waitFor({ state: 'visible', timeout: 5_000 })
  await view.waitForTimeout(160)
  const previewBox = await view.locator('.dsh-dschat-pop-up').boundingBox()
  report.probes.transferPreview = {
    text: await view.locator('.dsh-dschat-preview').inputValue(),
    editable: await view.locator('.dsh-dschat-preview').isEditable(),
    notice: await view.evaluate(() => document.querySelector('.dsh-dschat-pop-up .dsh-dschat-hintline')?.textContent ?? null),
    buttons: await view.evaluate(() =>
      [...document.querySelectorAll('.dsh-dschat-pop-up .dsh-dschat-pop-foot button')].map(el => (el.textContent ?? '').trim())),
    // The dialog opens UPWARD, so a box taller than the space above it is lost
    // off the top of the window rather than scrolled to.
    box: previewBox === null ? null : { y: Math.round(previewBox.y), height: Math.round(previewBox.height) },
    viewport: view.viewportSize(),
  }
  await shot('07e-transfer-preview', { clip: menuClip })

  /*
   * And the case the whole fix exists for: distillation UNAVAILABLE.
   *
   * The host reports it in the preview (`fallback` + `fallbackReason`) and the
   * dialog has to say so where the reader is already looking, rather than
   * producing the same success sentence a real brief produces. Photographed and
   * colour-measured, because "the warning is there but rendered in the same grey
   * as a footnote" is the failure mode a text assertion cannot see.
   */
  await view.evaluate(() => { window.__previewFail = true })
  await view.locator('.dsh-dschat-pop-up .dsh-dschat-pop-foot button').nth(1).click()
  await view.waitForTimeout(260)
  report.probes.transferPreviewFallback = {
    notices: await view.evaluate(() =>
      [...document.querySelectorAll('.dsh-dschat-pop-up .dsh-dschat-preview-note')].map(el => ({
        text: (el.textContent ?? '').trim(),
        colour: getComputedStyle(el).color,
        tone: el.getAttribute('data-tone'),
      }))),
    confirmEnabled: await view.locator('.dsh-dschat-pop-up .dsh-dschat-btn-primary').isEnabled(),
  }
  await shot('07f-transfer-preview-fallback', { clip: menuClip })
  await view.keyboard.press('Escape')
  await view.waitForTimeout(180)

  /*
   * The title bar's 「···」, opened for real. It must open DOWNWARD (it is in the
   * top strip — measured before that rule existed: the panel landed at y=-35,
   * above the window) and sit at the strip's right end.
   */
  const moreBox = await view.locator('.dsh-dschat-header .dsh-dschat-tbtn').boundingBox()
  await view.locator('.dsh-dschat-header .dsh-dschat-tbtn').click()
  await view.waitForTimeout(220)
  report.probes.moreMenu = await menuGeometry('.dsh-dschat-header .dsh-dschat-tbtn')
  report.probes.moreMenu.items = await view.evaluate(
    () => [...document.querySelectorAll('.dsh-dschat-pop-menu .dsh-dschat-menu-item')].map(el => (el.textContent ?? '').trim()),
  )
  await shot('07d-more-menu', {
    clip: moreBox === null
      ? { x: 0, y: 0, width: 1280, height: 240 }
      : {
        x: Math.max(0, Math.round(moreBox.x) - 460),
        y: 0,
        width: 520,
        height: 240,
      },
  })
  await view.keyboard.press('Escape')
  await view.waitForTimeout(150)

  /*
   * The composer's attachments: a real file through the panel's own hidden
   * input, so the two things the reader complained about are exercised end to
   * end — the chip must show THEIR name (not the stored uuid), and an image
   * must render as a thumbnail rather than a paperclip.
   */
  const pngPath = join(dir, '季度 经营 分析.png')
  writeFileSync(pngPath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOklEQVR42u3OMQEAAAgDoC251a3gLwSgOTcV'
    + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4LcFZgAB6Q0YQwAAAABJRU5ErkJggg==',
    'base64',
  ))
  await view.setInputFiles('.dsh-dschat-fileinput', pngPath)
  await view.waitForTimeout(800)
  report.probes.attachments = await view.evaluate(() => {
    const chip = document.querySelector('.dsh-dschat-attachments > *')
    const img = chip?.querySelector('img')
    const attachCall = (window.__calls ?? []).filter(call => call.name === 'attach').at(-1)
    return {
      count: document.querySelectorAll('.dsh-dschat-attachments > *').length,
      className: chip?.className ?? null,
      /* The readable name: the reader's own, without the stored uuid prefix. */
      title: chip?.getAttribute('title') ?? null,
      text: (chip?.textContent ?? '').trim(),
      usesUuid: /[0-9a-f]{8}-[0-9a-f]{4}/.test(chip?.textContent ?? ''),
      isThumbnail: chip?.className?.includes('dsh-dschat-thumb') ?? false,
      imgSrc: img?.getAttribute('src') ?? null,
      imgAlt: img?.getAttribute('alt') ?? null,
      removeLabel: chip?.querySelector('button')?.getAttribute('aria-label') ?? null,
      sentName: attachCall?.args?.[0]?.name ?? null,
      /* Every route the panel called, so a silent attach is visible here. */
      calls: (window.__calls ?? []).map(call => call.name),
      fileInputPresent: document.querySelector('.dsh-dschat-fileinput') !== null,
      /* The exact path the thumbnail asked the host to serve. */
      thumbnailAskedFor: (window.__calls ?? []).filter(call => call.name === 'attachmentUrl').at(-1)?.args?.[0] ?? null,
    }
  })
  await shot('08b-composer-attachments', { clip: { x: 260, y: 540, width: 1020, height: 280 } })
  /* Removing it must empty the row again. */
  const removeButton = view.locator('.dsh-dschat-attachments button').first()
  if (await removeButton.count() > 0) {
    await removeButton.click()
    await view.waitForTimeout(200)
    report.probes.attachmentsRemoved = await view.evaluate(
      () => document.querySelectorAll('.dsh-dschat-attachments > *').length,
    )
  } else {
    report.probes.attachmentsRemoved = 'no chip to remove'
  }
  /* The panel must still be intact after an upload and a removal. */
  report.probes.afterAttachments = await view.evaluate(() => ({
    panel: document.querySelector('.dsh-dschat') !== null,
    actions: document.querySelectorAll('.dsh-dschat-actions > button').length,
    composer: document.querySelector('.dsh-dschat-composer') !== null,
    bodyChildren: [...document.body.children].map(el => el.tagName + '.' + el.className).slice(0, 6),
  }))

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
  const historyButton = view.locator('.dsh-dschat-actions > button').first()
  await historyButton.click()
  await view.waitForTimeout(250)
  report.probes.railCollapsed = await view.evaluate(() => ({
    rail: document.querySelector('.dsh-dschat-rail') !== null,
    handle: document.querySelector('.dsh-dschat-rail-resize') !== null,
    headerButtons: [...document.querySelectorAll('.dsh-dschat-actions > button')].map(el => el.getAttribute('aria-pressed')),
    stored: (() => { try { return window.localStorage.getItem('dsh-dschat.rail.open') } catch { return 'unavailable' } })(),
  }))
  await shot('10-rail-collapsed')
  await historyButton.click()
  await view.waitForTimeout(250)
  report.probes.railRestored = await view.evaluate(() => ({
    rail: document.querySelector('.dsh-dschat-rail') !== null,
    width: Math.round(document.querySelector('.dsh-dschat-rail')?.getBoundingClientRect().width ?? 0),
  }))

  /*
   * ⌘K is now the ONLY way into search when the rail is hidden (the action row's
   * 搜索 button is gone), so it is driven in exactly that state.
   *
   * That is also the case the old implementation got wrong: it focused
   * `searchRef` directly, and the ref is null while the rail is collapsed, so
   * the shortcut silently did nothing. Here the rail is collapsed first, the
   * shortcut is pressed, and the probe reads back three things: the rail is
   * back, the cursor is in the box, and the box is the search input.
   */
  await historyButton.click()
  await view.waitForTimeout(250)
  report.probes.railCollapsedBeforeShortcut = await view.evaluate(
    () => document.querySelector('.dsh-dschat-rail') === null,
  )
  await view.keyboard.press('Meta+k')
  await view.waitForTimeout(350)
  report.probes.searchFocus = await view.evaluate(() => ({
    railBack: document.querySelector('.dsh-dschat-rail') !== null,
    focused: document.activeElement?.className ?? null,
    placeholder: document.activeElement?.getAttribute('placeholder') ?? null,
    shortcutHint: document.activeElement?.getAttribute('title') ?? null,
    /* The row no longer offers a search button to click instead. */
    searchButtonInRow: [...document.querySelectorAll('.dsh-dschat-actions > button')]
      .some(el => (el.textContent ?? '').includes('搜索') || (el.textContent ?? '').includes('Search')),
    rowLabels: [...document.querySelectorAll('.dsh-dschat-actions .dsh-dschat-tbtn-text')]
      .map(el => el.textContent),
  }))
  await shot('11-search-focus', { clip: { x: 0, y: 0, width: 700, height: 260 } })

  /* ============ the composer as an ordinary input field ============ */

  /*
   * Three states, driven for real, all of them reported as "the composer did
   * not let me type":
   *
   *   12  the web engine is down — the field types, and the click starts the
   *       page in the background (one wake, not zero, and not a login window);
   *   13  the start FAILS — the reason is a notice in the conversation with a
   *       retry button, the draft comes back, and the retry leads to a send;
   *   14  a reply is streaming — the field types, the message is QUEUED instead
   *       of refused, and it leaves by itself when the turn ends.
   *
   * Geometry alone would not catch any of these (all three render fine); they
   * are read back from the DOM and from the calls the panel made.
   */
  const mount = async (patch) => {
    await view.evaluate(state => { window.__mount(state) }, { ...fixture, ...patch })
    await view.waitForSelector('.dsh-dschat-input', { timeout: 5_000 })
    await view.waitForTimeout(350)
  }
  const callsOf = async name => await view.evaluate(
    key => (window.__calls ?? []).filter(call => call.name === key).length,
    name,
  )
  /** The streaming chat, for the state where the panel must see a live turn. */
  const streamingChats = fixture.chats.map((chat, index) => (index === 0 ? { ...chat, streaming: true } : chat))

  // ---- 12: engine down, and still an input ---------------------------------
  await mount({ engine: 'stopped', loggedIn: false, busy: false, streaming: false })
  report.probes.composerOffline = await view.evaluate(() => {
    const input = document.querySelector('.dsh-dschat-input')
    return {
      readOnly: input.readOnly,
      disabled: input.disabled,
      placeholder: input.placeholder,
      cardEngine: document.querySelector('.dsh-dschat-card')?.getAttribute('data-engine') ?? null,
      sendDisabled: document.querySelector('.dsh-dschat-send')?.disabled ?? null,
      sendInDom: document.querySelector('.dsh-dschat-send') !== null,
    }
  })
  await view.click('.dsh-dschat-input')
  await view.keyboard.type('引擎没起来也能打字')
  await view.waitForTimeout(400)
  report.probes.composerOfflineTyped = await view.evaluate(() => ({
    value: document.querySelector('.dsh-dschat-input').value,
    wakes: (window.__calls ?? []).filter(call => call.name === 'wake').length,
    sends: (window.__calls ?? []).filter(call => call.name === 'send').length,
    sendDisabled: document.querySelector('.dsh-dschat-send')?.disabled ?? null,
    placeholder: document.querySelector('.dsh-dschat-input').placeholder,
  }))
  await shot('12-composer-offline', { clip: { x: 260, y: 560, width: 1020, height: 260 } })

  // Enter submits it: the message leaves the box, and the page was started once.
  await view.keyboard.press('Enter')
  await view.waitForTimeout(500)
  report.probes.composerOfflineSend = await view.evaluate(() => ({
    value: document.querySelector('.dsh-dschat-input').value,
    wakes: (window.__calls ?? []).filter(call => call.name === 'wake').length,
    sendArgs: (window.__calls ?? []).filter(call => call.name === 'send').map(call => call.args[0]),
  }))

  // ---- 13: a start that fails, and the retry that fixes it -----------------
  await mount({ engine: 'stopped', loggedIn: false, busy: false, streaming: false, wakeError: '浏览器启动超时：page.goto 45s（NETWORK）' })
  await view.click('.dsh-dschat-input')
  await view.keyboard.type('这条会发不出去')
  await view.waitForTimeout(250)
  await view.keyboard.press('Enter')
  await view.waitForTimeout(700)
  report.probes.engineNotice = await view.evaluate(() => {
    const notice = document.querySelector('.dsh-dschat-notice')
    return {
      present: notice !== null,
      inThread: notice?.closest('.dsh-dschat-thread') !== null,
      title: notice?.querySelector('strong')?.textContent ?? null,
      body: notice?.querySelector('p')?.textContent ?? null,
      buttons: [...(notice?.querySelectorAll('button') ?? [])].map(button => button.textContent),
      draft: document.querySelector('.dsh-dschat-input').value,
      readOnly: document.querySelector('.dsh-dschat-input').readOnly,
      sends: (window.__calls ?? []).filter(call => call.name === 'send').length,
      wakes: (window.__calls ?? []).filter(call => call.name === 'wake').length,
    }
  })
  await shot('13-engine-notice', { clip: { x: 260, y: 280, width: 1020, height: 460 } })
  /*
   * The same card in the dark theme. Every surface added here — this notice, the
   * queue row, the 运行状态 modal — is a tinted fill or a hairline, and both are
   * exactly what disappears when a light-theme value is reused on a dark page
   * (the panel has been bitten by that before; see the composer's own dark
   * branch). The shot is for the eye; the class list is the machine-readable
   * half.
   */
  await view.evaluate(() => { document.body.dataset.dsDarkTheme = 'true' })
  await view.waitForTimeout(150)
  report.probes.engineNoticeDark = await view.evaluate(() => {
    const notice = document.querySelector('.dsh-dschat-notice')
    return notice === null ? { missing: true } : {
      background: getComputedStyle(notice).backgroundColor,
      border: getComputedStyle(notice).borderColor,
      body: getComputedStyle(notice.querySelector('p')).color,
    }
  })
  await shot('13b-engine-notice-dark', { clip: { x: 260, y: 280, width: 1020, height: 460 } })
  await view.evaluate(() => { delete document.body.dataset.dsDarkTheme })

  await view.click('.dsh-dschat-notice button')
  await view.waitForTimeout(600)
  report.probes.engineNoticeRetry = await view.evaluate(() => ({
    wakes: (window.__calls ?? []).filter(call => call.name === 'wake').length,
    noticeGone: document.querySelector('.dsh-dschat-notice') === null,
    draft: document.querySelector('.dsh-dschat-input').value,
  }))
  // The draft survived the whole detour and goes out on the next Enter.
  await view.click('.dsh-dschat-input')
  await view.keyboard.press('Enter')
  await view.waitForTimeout(500)
  report.probes.engineNoticeRecovered = await view.evaluate(() => ({
    sends: (window.__calls ?? []).filter(call => call.name === 'send').map(call => call.args[0]),
    value: document.querySelector('.dsh-dschat-input').value,
  }))

  // ---- 14: streaming, so the next message is queued ------------------------
  await mount({ engine: 'ready', loggedIn: true, busy: true, streaming: true, chats: streamingChats })
  report.probes.composerWhileBusy = await view.evaluate(() => ({
    readOnly: document.querySelector('.dsh-dschat-input').readOnly,
    disabled: document.querySelector('.dsh-dschat-input').disabled,
    placeholder: document.querySelector('.dsh-dschat-input').placeholder,
    stopInDom: document.querySelector('.dsh-dschat-stop') !== null,
    sendInDom: document.querySelector('.dsh-dschat-send') !== null,
    sendDisabled: document.querySelector('.dsh-dschat-send')?.disabled ?? null,
  }))
  await view.click('.dsh-dschat-input')
  await view.keyboard.type('这一条要排队')
  await view.waitForTimeout(250)
  await view.click('.dsh-dschat-send')
  await view.waitForTimeout(300)
  report.probes.composerQueued = await view.evaluate(() => ({
    rows: [...document.querySelectorAll('.dsh-dschat-queue-item')].map(row => row.textContent),
    note: document.querySelector('.dsh-dschat-queue-note')?.textContent ?? null,
    value: document.querySelector('.dsh-dschat-input').value,
    sends: (window.__calls ?? []).filter(call => call.name === 'send').length,
    // The field is still the reader's: it must accept the NEXT message too.
    editable: document.querySelector('.dsh-dschat-input').readOnly === false,
  }))
  await view.keyboard.type('还能继续写')
  await view.waitForTimeout(200)
  report.probes.composerQueuedTyping = await view.evaluate(() => ({
    value: document.querySelector('.dsh-dschat-input').value,
  }))
  await shot('14-composer-queued', { clip: { x: 260, y: 520, width: 1020, height: 300 } })

  // The turn ends: the queue drains by itself and the message goes out.
  await view.evaluate(() => {
    window.__patch({
      busy: false,
      streaming: false,
      chats: window.__state.chats.map(chat => ({ ...chat, streaming: false })),
    })
  })
  await view.waitForTimeout(2_600)
  report.probes.composerQueueDrained = await view.evaluate(() => ({
    rows: document.querySelectorAll('.dsh-dschat-queue-item').length,
    sendArgs: (window.__calls ?? []).filter(call => call.name === 'send').map(call => call.args[0]),
    draft: document.querySelector('.dsh-dschat-input').value,
  }))
  await shot('15-composer-drained', { clip: { x: 260, y: 560, width: 1020, height: 260 } })

  /*
   * The same notice in an EMPTY conversation.
   *
   * The two branches of the transcript render different elements (see the note
   * on `thread()`), so the notice has to be reachable in both — a fresh install
   * whose very first message could not be sent is exactly this state.
   */
  await mount({ engine: 'stopped', loggedIn: false, busy: false, streaming: false, wakeError: '没有网络（NETWORK）', chats: [], activeChatId: undefined })
  await view.click('.dsh-dschat-input')
  await view.keyboard.type('第一条消息')
  await view.keyboard.press('Enter')
  await view.waitForTimeout(700)
  report.probes.engineNoticeEmptyChat = await view.evaluate(() => ({
    emptyState: document.querySelector('.dsh-dschat-empty') !== null,
    notice: document.querySelector('.dsh-dschat-notice') !== null,
    noticeInThread: document.querySelector('.dsh-dschat-notice')?.closest('.dsh-dschat-thread') !== null,
    draft: document.querySelector('.dsh-dschat-input').value,
  }))

  /* ---- and the status card, which is no longer a Settings page ---- */
  /*
   * Reached through the title bar's 「···」, which is where these four entries
   * live now. The action row holds none of them any more — its four buttons are
   * the conversation's verbs — so aiming at it would quietly open nothing and
   * photograph an empty modal slot.
   */
  await view.locator('.dsh-dschat-header .dsh-dschat-tbtn').click()
  await view.waitForTimeout(250)
  await view.evaluate(() => {
    const item = [...document.querySelectorAll('.dsh-dschat-pop-menu .dsh-dschat-menu-item')]
      .find(button => button.textContent.includes('运行状态') || button.textContent.includes('Runtime'))
    if (item) item.click()
  })
  await view.waitForTimeout(400)
  report.probes.statusCard = await view.evaluate(() => ({
    open: document.querySelector('.dsh-dschat-modal') !== null,
    rows: document.querySelectorAll('.dsh-dschat-modal .dsh-dschat-setrow').length,
    actions: [...document.querySelectorAll('.dsh-dschat-modal .dsh-dschat-setactions button')].map(button => button.textContent),
    title: document.querySelector('.dsh-dschat-modal h1')?.textContent ?? null,
  }))
  await shot('16-status-card', { clip: { x: 300, y: 100, width: 680, height: 620 } })
  await view.evaluate(() => { document.body.dataset.dsDarkTheme = 'true' })
  await view.waitForTimeout(150)
  report.probes.statusCardDark = await view.evaluate(() => {
    const card = document.querySelector('.dsh-dschat-modal-card')
    return card === null ? { missing: true } : {
      background: getComputedStyle(card).backgroundColor,
      border: getComputedStyle(card).borderColor,
      row: getComputedStyle(card.querySelector('.dsh-dschat-setrow')).borderTopColor,
    }
  })
  await shot('16b-status-card-dark', { clip: { x: 300, y: 100, width: 680, height: 620 } })
  await view.evaluate(() => { delete document.body.dataset.dsDarkTheme })

  /*
   * ---- 17..20: the question navigator and the 「↓ 最新」 pill ----
   *
   * A LONG conversation is required, not optional: the navigator deliberately
   * does not exist until a transcript has more than one question AND actually
   * overflows, and neither condition holds in the fixture above. So this mounts
   * a purpose-built one — four questions, each with a reply tall enough to push
   * the next question off screen.
   */
  const longReply = Array.from({ length: 10 }, (_, i) =>
    `第 ${String(i + 1)} 段：这里是回答的正文，长度是为了把消息流撑到必须滚动的高度。`).join('\n\n')
  const longMessages = []
  const navClock = Date.now()
  for (let i = 1; i <= 4; i += 1) {
    const at = navClock - (30 - i) * 60_000
    longMessages.push({ id: `n-u${String(i)}`, role: 'user', content: `第 ${String(i)} 个问题：请把这一段展开讲讲，最好给出可以照做的步骤。`, ts: at })
    longMessages.push({ id: `n-a${String(i)}`, role: 'assistant', content: longReply, ts: at + 5_000 })
  }
  const longChat = { ...fixture.chats[0], id: 'chat-ui-long', title: '提问导航样例', messages: longMessages, streaming: false }
  await mount({ chats: [longChat, ...fixture.chats.slice(1)], activeChatId: longChat.id })
  await view.waitForTimeout(400)
  report.probes.questionNav = await view.evaluate(() => {
    const nav = document.querySelector('.dsh-dschat-nav')
    const list = document.querySelector('.dsh-dschat-thread')
    const box = el => {
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    }
    const items = [...document.querySelectorAll('.dsh-dschat-nav-item')]
    const active = items.findIndex(item => item.dataset.active === 'true')
    return {
      present: nav !== null,
      collapsed: box(nav),
      items: items.length,
      active,
      pitch: items.length > 1 ? Math.round(items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top) : 0,
      tick: (() => {
        const tick = items[0]?.querySelector('.dsh-dschat-nav-tick')
        if (tick === undefined || tick === null) return null
        const cs = getComputedStyle(tick)
        return { w: cs.width, h: cs.height, bg: cs.backgroundColor }
      })(),
      gutter: getComputedStyle(document.querySelector('.dsh-dschat-thread-inner')).paddingRight,
      overflow: list.scrollHeight > list.clientHeight,
      latest: document.querySelector('.dsh-dschat-latest') !== null,
    }
  })
  await shot('17-nav-collapsed', { clip: { x: 980, y: 52, width: 300, height: 620 } })
  await shot('17b-nav-collapsed-full')

  // Hover: the capsule becomes the question list, and — the part that matters —
  // the rows do not move while it does.
  const firstTick = view.locator('.dsh-dschat-nav-item').first()
  const rowYBefore = await firstTick.evaluate(el => Math.round(el.getBoundingClientRect().top))
  await firstTick.hover()
  await view.waitForTimeout(320)
  const rowYAfter = await firstTick.evaluate(el => Math.round(el.getBoundingClientRect().top))
  report.probes.questionNavOpen = await view.evaluate(() => {
    const nav = document.querySelector('.dsh-dschat-nav')
    const item = document.querySelector('.dsh-dschat-nav-item')
    const text = item?.querySelector('.dsh-dschat-nav-text')
    const r = nav.getBoundingClientRect()
    return {
      open: nav.dataset.open === 'true',
      w: Math.round(r.width),
      rowH: Math.round(item.getBoundingClientRect().height),
      textShown: text !== null && getComputedStyle(text).display !== 'none',
      firstText: (text?.textContent ?? '').slice(0, 24),
    }
  })
  report.probes.questionNavOpen.rowStable = rowYBefore === rowYAfter
  await shot('18-nav-open', { clip: { x: 640, y: 52, width: 640, height: 500 } })

  // Click: the first question lands at the top of the viewport, and the tick
  // for it becomes the current one.
  await firstTick.click()
  await view.waitForTimeout(1_400)
  report.probes.questionJump = await view.evaluate(() => {
    const list = document.querySelector('.dsh-dschat-thread')
    const first = list.querySelector('[data-role="user"]')
    const items = [...document.querySelectorAll('.dsh-dschat-nav-item')]
    return {
      offset: Math.round(first.getBoundingClientRect().top - list.getBoundingClientRect().top),
      active: items.findIndex(item => item.dataset.active === 'true'),
      latest: document.querySelector('.dsh-dschat-latest') !== null,
    }
  })
  await shot('19-nav-jump', { clip: { x: 260, y: 52, width: 1020, height: 400 } })

  // The 「↓ 最新」 pill: offered off the end, and it retires itself on the way back.
  await shot('20-latest-pill', { clip: { x: 620, y: 380, width: 660, height: 260 } })
  await view.locator('.dsh-dschat-latest').click()
  await view.waitForTimeout(1_600)
  /* ---- 21: the per-row 「从网页同步」 action, revealed on hover ---- */
  const railChat = await view.evaluate(() => {
    const row = [...document.querySelectorAll('.dsh-dschat-item')]
      .find(item => item.querySelector('.dsh-dschat-item-acts button[title*="同步"]') !== null)
    if (row === undefined || row === null) return null
    const r = row.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: row.textContent?.slice(0, 20) ?? '' }
  })
  if (railChat !== null) {
    await view.mouse.move(railChat.x + railChat.w / 2, railChat.y + railChat.h / 2)
    await view.waitForTimeout(250)
  }
  report.probes.railSyncAction = await view.evaluate(() => {
    const rows = [...document.querySelectorAll('.dsh-dschat-item')]
    const withSync = rows.filter(row => row.querySelector('.dsh-dschat-item-acts button[title*="同步"]') !== null)
    return {
      rows: rows.length,
      withSync: withSync.length,
      buttons: withSync[0] === undefined ? [] : [...withSync[0].querySelectorAll('.dsh-dschat-item-acts button')].map(button => button.getAttribute('title')),
    }
  })
  await shot('21-rail-sync-action', { clip: { x: 0, y: 52, width: 300, height: 420 } })

  report.probes.latestPill = await view.evaluate(() => {
    const list = document.querySelector('.dsh-dschat-thread')
    return {
      gone: document.querySelector('.dsh-dschat-latest') === null,
      gap: Math.round(list.scrollHeight - list.scrollTop - list.clientHeight),
    }
  })

  await browser.close()
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify({ ...report, errors }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...report, errors }, null, 2))
} finally {
  if (process.env.DSH_UI_SHOT_KEEP !== '1') rmSync(dir, { recursive: true, force: true })
  else console.log('[ui-shot] kept scratch dir:', dir)
}
