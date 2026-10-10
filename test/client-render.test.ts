/**
 * Render smoke test for the browser half.
 *
 * A panel that throws while rendering blanks its slot entry (the shell logs
 * `slot entry crashed in '<slot>'` and renders nothing), and that failure is
 * invisible until someone opens the UI. This test renders both components to
 * static markup with React itself, so a bad element, a broken hook or a
 * mistyped prop fails here instead of in front of the user.
 *
 * Effects do not run under static rendering, which is exactly what we want: the
 * assertion is "the initial screen renders", not "the network works".
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'

import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * Bundle the two panel components into one importable ESM file.
 *
 * React stays external and the bundle is written INSIDE the package, so both
 * the bundle and `react-dom/server` resolve the same React instance — two
 * copies would null the hook dispatcher and fail every render.
 */
async function loadComponents() {
  const dir = mkdtempSync(join(root, '.tmp-client-test-'))
  const outfile = join(dir, 'components.mjs')
  const entry = join(dir, 'entry.tsx')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(entry, `
    export { DSchatPanel, thoughtLabel, openExternalLink } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
    export { DSchatStatus } from ${JSON.stringify(join(root, 'src/client/panel/DSchatStatus.tsx'))}
    export { Markdown, Thinking, SourceList, sourceRows } from ${JSON.stringify(join(root, 'src/client/panel/Markdown.tsx'))}
  `, 'utf8')
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  })
  const mod = await import(pathToFileURL(outfile).href)
  const server = await import('react-dom/server')
  const react = await import('react')
  return { ...mod, renderToStaticMarkup: server.renderToStaticMarkup, createElement: react.createElement, dir }
}

/** A stub API whose every call stays pending — static rendering never awaits. */
function stubApi() {
  const never = new Promise(() => undefined)
  return {
    state: () => never,
    context: () => never,
    send: () => never,
    stop: () => never,
    newChat: () => never,
    wake: () => never,
    openLogin: () => never,
    closeBrowser: () => never,
    setDeepThink: () => never,
    setSearch: () => never,
    transfer: () => never,
    exportFile: () => never,
    renameChat: () => never,
    deleteChat: () => never,
    clearChats: () => never,
    webChats: () => never,
    recover: () => never,
    restore: () => never,
    attach: () => never,
  }
}

const deps = {
  api: stubApi() as never,
  tt: (key: string) => key,
  openSession: () => undefined,
  pickDirectory: async () => null,
  createWorkspace: async () => ({ workspaceId: 'w', title: 'w' }),
}

test('DSchatPanel renders its initial screen', async () => {
  const { DSchatPanel, renderToStaticMarkup, createElement, dir } = await loadComponents()
  try {
    const html = renderToStaticMarkup(createElement(DSchatPanel, deps as never))
    assert.ok(html.length > 0, 'panel produced markup')
    // The shell of the panel, its rail and its composer must all be present.
    assert.match(html, /dsh-dschat-header/)
    assert.match(html, /dsh-dschat-rail/)
    assert.match(html, /dsh-dschat-composer/)
    assert.match(html, /dsh-dschat-phase/)
    // With no snapshot yet the status gauge must read as not-started, not blank.
    assert.match(html, /status\.stopped/)
    assert.match(html, /empty\.title/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * The append target list comes from the shell's own session list (`main`'s
 * `useSessions` standard prop). Rendering with that hook present is the smoke
 * test for the selector plumbing: a hook-order slip or a bad snapshot shape
 * would throw here instead of inside the running panel.
 */
/**
 * The composer's tool row, asserted on real markup rather than on the source.
 *
 * Three controls in two groups, in the order the reader uses them: 深度思考 and
 * 智能搜索 on the left, then the spacer, then 附件 immediately left of the send
 * circle. The pills describe what the message will ask for; 附件 and 发送 both
 * act on it now, so they sit together on the right — the grouping
 * chat.deepseek.com's own composer uses (its paperclip is the send button's
 * left-hand neighbour).
 *
 * 「上传文件」 is a bare glyph now, matching chat.deepseek.com's own composer, so
 * the words live on the accessible name rather than in the row. The assertion
 * reads them from there: a control whose label only exists in a tooltip is
 * invisible to a screen reader, and that is the failure this guards.
 */
test('the composer groups 深度思考 + 智能搜索 on the left, 附件 + 发送 on the right', async () => {
  const { DSchatPanel, renderToStaticMarkup, createElement, dir } = await loadComponents()
  try {
    const html = renderToStaticMarkup(createElement(DSchatPanel, deps as never))
    const header = html.slice(html.indexOf('dsh-dschat-header'), html.indexOf('dsh-dschat-body'))
    const composer = html.slice(html.indexOf('dsh-dschat-composer'))

    assert.equal(/toggle\.deepThink|toggle\.search/.test(header), false, 'the toggles are not header chrome')
    assert.match(composer, /dsh-dschat-toggle/, '深度思考 / 智能搜索 render as composer pills')

    const think = composer.indexOf('toggle.deepThink')
    const search = composer.indexOf('toggle.search')
    /*
     * The LAST spacer, not the first.
     *
     * The action row above the card (会话列表 / 搜索 / 新对话 … DSH 迁移) has one
     * of its own, and it comes first in the markup. The grouping this test
     * guards is the TOOL row's, one spacer further down.
     */
    const spacer = composer.lastIndexOf('dsh-dschat-spacer')
    const upload = composer.indexOf('composer.upload')
    const send = composer.indexOf('dsh-dschat-send')
    assert.ok(think > -1 && search > -1 && upload > -1, 'all three controls are in the tool row')
    assert.ok(think < search, '深度思考 comes before 智能搜索')
    assert.ok(spacer > search, 'the spacer separates the two groups')
    assert.ok(spacer < upload, '附件 is on the RIGHT of the spacer, with the send control')
    assert.ok(upload < send, 'and immediately LEFT of 发送, where the page puts its paperclip')
    // The hidden Finder input travels with the button it belongs to.
    assert.ok(composer.indexOf('dsh-dschat-fileinput') > spacer, 'the file input moved with it')
    assert.match(composer, /dsh-dschat-attach/, 'the attach control is the official glyph button')
    assert.match(composer, /aria-label="composer\.upload"/, 'and it still names itself for assistive tech')
    // The two pills wear the web app's own artwork, not a bolt and a globe.
    assert.match(composer, /viewBox="0 0 16 16"/, 'the pills carry inline SVG glyphs')

    // No second attach affordance: the paperclip that opened the in-app file
    // browser is gone, so the hidden Finder input is the only file control.
    assert.equal(/composer\.attach\.hint/.test(composer), false, 'the duplicate attach button is gone')
    assert.equal(/picker\.open/.test(composer), false, 'and so is the in-app picker it opened')
    assert.match(composer, /dsh-dschat-fileinput/, 'the Finder input stays')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * One click, one browser.
 *
 * Reported: clicking the offline composer started a browser, and typing then
 * started a SECOND one before the conversation worked. The click went to
 * `openLogin` (a headed, always-relaunching window) while the send path went to
 * `ensureBrowser` — two different browsers for one intention.
 *
 * These assertions pin the shape of the fix: focus wakes the engine, and the
 * visible login window is reached only as the wake's escalation. It is a source
 * assertion rather than a rendered one because static rendering never runs a
 * handler; the behaviour behind it is covered against the engine in
 * host-smoke.test.ts ("the first wake on an empty profile...", "one launch
 * serves every concurrent caller").
 */
test('the composer wakes the engine instead of forcing a login window', async () => {
  const { readFileSync } = await import('node:fs')
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')

  const input = panel.indexOf("className: 'dsh-dschat-input'")
  const focus = panel.slice(input, panel.indexOf('onChange:', input))
  assert.ok(/void ensureReady\(\)/.test(focus), 'focusing the composer wakes the engine')
  assert.equal(
    /openLogin\(\)/.test(focus), false,
    'focus must not go straight to the visible login window — that is the relaunch that made one click cost two browsers',
  )

  const ready = panel.slice(panel.indexOf('const ensureReady'), panel.indexOf('const retry'))
  assert.ok(ready.includes('api.wake()'), 'the wake is the first request')
  assert.ok(
    ready.indexOf('api.wake()') < ready.indexOf('api.openLogin()'),
    'and the login window is the escalation, not the opening move',
  )
  assert.ok(
    /woken\.loginWindow !== true/.test(ready),
    'a wake that already opened the login window must not be asked for a second one',
  )
  // The panel must also relay the wake's failure instead of silently doing nothing.
  assert.ok(ready.includes('toast.wake.failed'), 'a failed wake is reported')
  // ...and it must survive meeting a host that has no /wake route at all: the
  // browser half is reloaded on its own (a page refresh) while the host half
  // waits for a Harness restart, so the 404 pairing is a real state.
  assert.ok(/HTTP 404/.test(ready), 'a host without /wake falls back instead of breaking the composer')

  /*
   * Enter on a composer whose engine is down wakes it rather than dropping the
   * message: the reader pressed Enter, which is an unambiguous intent. The wake
   * lives in `deliver` — the one path every send takes, whether it was typed or
   * drained from the queue — so there is exactly one place that can forget it.
   */
  const deliver = panel.slice(panel.indexOf('const deliver = useCallback'), panel.indexOf('const drainOutbox'))
  assert.ok(/await ensureReady\(\)/.test(deliver), 'sending wakes a down engine first')
  /*
   * ...and a start that ends on the sign-in screen reports itself in the
   * conversation (with 「打开登录窗口」 on the same card) instead of as a toast.
   */
  assert.ok(deliver.includes("return 'failed'"), 'a failed start hands the message back to the caller')
  assert.ok(panel.includes('engine.notice.needLogin'), 'being signed out is reported as a notice')
})

/**
 * The header's two halves, and the three window controls that moved OUT of it.
 *
 * The controls exist because the conversation list, the search box and 新对话
 * had no visible entry point: the list was permanent (with no way to give the
 * conversation the full width), the search box was a bare input nobody was told
 * about, and the only 新对话 button sat above that list. They used to live in
 * the header; they now sit in the action row directly above the composer, next
 * to the conversation they act on.
 *
 * The header keeps identity (the whale + the product name) and the engine's
 * state lamp, which is also the entry to the engine menu. The rail is rendered
 * by DEFAULT (a reader who has never touched the toggle gets the list), so this
 * asserts the initial screen: the brand, one lamp, three buttons in the action
 * row, the history one pressed, the list on screen.
 */
test('the header carries the whale mark and the lamp, and the controls moved to the action row', async () => {
  const { DSchatPanel, renderToStaticMarkup, createElement, dir } = await loadComponents()
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(join(root, 'src/client/panel/styles.ts'), 'utf8')
  const panelSource = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')
  try {
    const html = renderToStaticMarkup(createElement(DSchatPanel, deps as never))
    const header = html.slice(html.indexOf('dsh-dschat-header'), html.indexOf('dsh-dschat-body'))
    const composer = html.slice(html.indexOf('dsh-dschat-composer'), html.indexOf('dsh-dschat-phase'))

    /*
     * Identity first, status after: the whale names the product, the lamp
     * reports whether its engine is up. Both removals have to be asserted as
     * ABSENT, or a later edit could quietly reintroduce a pseudo-button here.
     */
    const brand = header.indexOf('dsh-dschat-brand')
    const lamp = header.indexOf('dsh-dschat-lamp')
    assert.ok(brand > -1, 'the product mark is in the header')
    assert.ok(lamp > -1, 'and the state lamp beside it')
    assert.ok(brand < lamp, 'identity leads, status follows')
    assert.match(header, /brand\.title/, 'the header names the product it is talking to')

    // The mark renders the house artwork at its own ratio, not on the icon grid.
    assert.match(header, /viewBox="0 0 23\.16 17\.04"/, 'the official fish geometry')
    assert.match(header, /data-phase="stopped"/, 'with no snapshot yet it claims nothing')

    /*
     * The conversation's three verbs are the ACTION ROW's: 会话列表 / 新对话 on
     * the left, 迁移 at the right end. All are labelled (dsh-dschat-tbtn) — the
     * row is where a reader looks for "a new chat", so a glyph-only square there
     * was a control they had to already know.
     *
     * 搜索 is deliberately NOT one of them: it duplicated the rail's own search
     * box, which is on screen whenever the rail is (the default). What it
     * uniquely did — reach search with the rail collapsed — belongs to ⌘K, and
     * the assertion below makes sure ⌘K still does it.
     */
    assert.equal(
      (composer.match(/dsh-dschat-tbtn[" ]/g) ?? []).length, 3,
      'three labelled buttons on the action row',
    )
    const history = composer.indexOf('rail.hide')
    const fresh = composer.indexOf('action.newChat.hint')
    assert.ok(history > -1 && fresh > -1, 'each button carries its own label')
    assert.ok(history < fresh, 'in the order 会话列表, 新对话')
    assert.equal(
      composer.includes('rail.search.hint'), false,
      'and the row no longer carries a search button',
    )
    assert.match(composer, /aria-pressed="true"/, 'the history toggle reads as pressed while the list is shown')
    for (const key of ['action.sessions', 'action.newChat']) {
      assert.ok(composer.includes(key), `the button carries the visible word for ${key}`)
    }

    /*
     * The search it dropped is still reachable, and by the path that has to work
     * in every state: the shortcut goes through `openSearch()`, which brings a
     * collapsed rail back before focusing. The direct `searchRef.current?.focus()`
     * this replaced was a no-op whenever the rail was hidden — the box is not in
     * the DOM then — so the old code silently lost the shortcut in exactly the
     * state where a keyboard path matters most.
     *
     * Comments are stripped before matching: the fix's own comment names the
     * call it warns against, and prose must not trip a code-level guard.
     */
    const code = panelSource.replace(/\/\*[\s\S]*?\*\//g, '')
    const shortcut = code.slice(
      code.indexOf("event.key.toLowerCase() === 'k'"),
      code.indexOf("event.key === '/'"),
    )
    assert.ok(shortcut.includes('openSearch()'), '⌘K opens the search through the same path the button used')
    assert.equal(
      /searchRef\.current\?\.focus\(\)/.test(shortcut), false,
      'and never focuses the ref directly: it is null while the rail is collapsed',
    )
    /* The rail's own box advertises the shortcut it now owns. */
    assert.match(
      panelSource.slice(panelSource.indexOf('dsh-dschat-search')),
      /title: tr\('rail\.search\.hint'\)/,
      'the search box carries the ⌘K hint the removed button used to hold',
    )

    /*
     * The engine menu is at the TITLE BAR's right end — after the drag spacer,
     * i.e. the header's last child — and NOT on the action row. Those four
     * entries (运行状态 / 导出 markdown / 打开登录窗口 / 关闭浏览器) are about the
     * panel and its browser, not about this conversation, and the row below
     * belongs to the conversation.
     */
    const more = header.indexOf('more.hint')
    assert.ok(more > -1, 'the engine menu has a visible home')
    assert.ok(more > header.indexOf('dsh-dschat-spacer'), 'at the title bar\'s right end, after the drag region')
    assert.equal(
      composer.includes('more.hint'), false,
      'and it is no longer on the action row',
    )
    assert.equal(
      (header.match(/dsh-dschat-tbtn[" ]/g) ?? []).length, 1,
      'the header carries exactly one of those buttons: the 「···」',
    )
    assert.equal(
      composer.includes('dsh-dschat-btn-primary'), false,
      'and 迁移 is no longer a filled primary chip inside the row',
    )

    /*
     * The lamp's panel is the status sentence and NOTHING else. It held these
     * same four entries once; a `moreItem` left behind here would mean the menu
     * exists in two places, which is how the header ends up carrying commands
     * twice.
     *
     * The four keys ARE in the header now — the engine menu lives there — so the
     * assertion is that they belong to the MENU and not to the lamp's panel:
     * the panel is one line of text, with no menu rows inside it.
     *
     * The panel itself is closed in a static render (the component returns null
     * for it), so its own positive half — the sentence, and the absence of
     * buttons — is measured in a real browser by scripts/ui-shot.mjs.
     */
    assert.equal(
      composer.includes('dsh-dschat-pop-status') || header.includes('dsh-dschat-pop-status'), false,
      'no panel is rendered until a trigger opens one',
    )
    const lampPanel = css.slice(
      css.indexOf('.dsh-dschat-pop-status .dsh-dschat-lamp-status'),
      css.indexOf('}', css.indexOf('.dsh-dschat-pop-status .dsh-dschat-lamp-status')),
    )
    assert.ok(lampPanel.includes('border-bottom: none'), 'the lamp\'s panel styles the sentence, and only that')
    assert.equal(
      /dsh-dschat-menu-item/.test(css.slice(css.indexOf('.dsh-dschat-pop-status'), css.indexOf('.dsh-dschat-pop-status') + 400)),
      false,
      'and carries no menu rows of its own',
    )

    assert.equal(header.includes('panel.title'), false, 'the redundant panel name is gone')
    assert.equal(header.includes('dsh-dschat-status'), false, 'and so is the status chip')
    assert.equal(header.includes('dsh-dschat-vsep'), false, 'with the divider that framed it')

    assert.match(html, /dsh-dschat-rail/, 'and the list is on screen without any interaction')
    assert.match(html, /dsh-dschat-search/, 'with its search box')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * The composer's right-hand keyboard hint is gone.
 *
 * 「⌘K 搜索」 sat between the paperclip and the send circle — the one strip this
 * row has to spare — where a keycap plus a label reads as a second, dead send
 * button. The SHORTCUT still works, so this asserts that the advertisement is
 * gone rather than the feature, and that the controls sharing the row survived.
 */
test('the composer no longer advertises the ⌘K search shortcut', async () => {
  const { DSchatPanel, renderToStaticMarkup, createElement, dir } = await loadComponents()
  try {
    const html = renderToStaticMarkup(createElement(DSchatPanel, deps as never))
    const composer = html.slice(html.indexOf('dsh-dschat-composer'), html.indexOf('dsh-dschat-phase'))
    assert.equal(composer.includes('dsh-dschat-tools-hint'), false, 'no hint span in the tool row')
    assert.equal(composer.includes('⌘K'), false, 'no keycap either')
    assert.equal(composer.includes('composer.hint.search'), false, 'and no locale lookup for it')
    assert.match(composer, /dsh-dschat-toggle/, '深度思考 / 智能搜索')
    assert.match(composer, /dsh-dschat-attach/, '附件')
    assert.match(composer, /dsh-dschat-send/, '发送')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * A collapsed rail is ABSENT, not narrow.
 *
 * The panel reads the choice from localStorage, so the collapsed state is
 * reachable in a static render. A zero-width column would keep the resize
 * handle in the tab order and its 6px strip on screen — a phantom control
 * nobody can see, which is exactly the "sidebar collapsed" bug class this
 * panel has already been bitten by once.
 */
test('a collapsed conversation list leaves the DOM entirely', async () => {
  const { DSchatPanel, renderToStaticMarkup, createElement, dir } = await loadComponents()
  const globals = globalThis as { window?: unknown }
  const hadWindow = 'window' in globals
  const store = new Map<string, string>()
  const render = (): string => renderToStaticMarkup(createElement(DSchatPanel, deps as never))
  try {
    globals.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
      },
    }

    store.set('dsh-dschat.rail.open', '0')
    const closed = render()
    assert.equal(/dsh-dschat-rail\b/.test(closed), false, 'no rail element is rendered')
    assert.equal(/dsh-dschat-rail-resize/.test(closed), false, 'and no resize handle survives it')
    assert.match(closed, /rail\.show/, 'the header button offers the way back')
    assert.match(closed, /dsh-dschat-composer/, 'and the conversation keeps its composer')

    // '0' is the only value that means closed: a first-run reader (nothing
    // stored) and any other value both get the list.
    store.delete('dsh-dschat.rail.open')
    assert.match(render(), /dsh-dschat-rail-resize/, 'an unset preference shows the list')
    store.set('dsh-dschat.rail.open', '1')
    assert.match(render(), /dsh-dschat-rail-resize/, 'and so does an explicit open')
  } finally {
    if (hadWindow) globals.window = undefined
    else delete globals.window
    rmSync(dir, { recursive: true, force: true })
  }
})

test('DSchatPanel renders against the shell session list', async () => {
  const { DSchatPanel, renderToStaticMarkup, createElement, dir } = await loadComponents()
  try {
    const useSessions = (selector: (list: unknown) => unknown) => selector({
      byId: {
        'session-cold': { sessionId: 'session-cold', updatedAt: 20, agentAvailable: false, title: '冷会话' },
        'session-open': { sessionId: 'session-open', updatedAt: 30, agentAvailable: true, running: true, title: '运行中' },
        'session-blank': { sessionId: 'session-blank', updatedAt: 10, agentAvailable: false, blank: true },
      },
    })
    const html = renderToStaticMarkup(createElement(DSchatPanel, { ...deps, useSessions } as never))
    assert.match(html, /dsh-dschat-header/)
    assert.match(html, /dsh-dschat-composer/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * A citation marker must reach the page it cites.
 *
 * The marker carries a number only, so this is the pair of contracts that make
 * it useful: `[citation:N]` resolves against the reply's OWN source table
 * (positional — `sources[N - 1]`), and the resulting anchor goes through the
 * same click path as any other link. A marker whose source is unknown must stay
 * the plain chip it always was rather than becoming a link to a guessed URL.
 */
test('a citation marker links to the source the reply names, and only then', async () => {
  const { Markdown, createElement, renderToStaticMarkup, dir } = await loadComponents()
  try {
    const written: string[] = []
    const tree = Markdown({
      source: '结论[citation:2]，另有[citation:1,2] 和 [citation:9]。',
      sources: [
        { url: 'https://a.example/1', title: '甲页' },
        { url: 'https://b.example/2' },
      ],
      sourcesLabel: '参考来源（2）',
      onOpenLink: (href: string) => { written.push(href); return true },
    }) as never

    const anchors: Array<Record<string, unknown>> = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { for (const child of node) walk(child); return }
      if (node === null || typeof node !== 'object') return
      const element = node as { type?: unknown; props?: Record<string, unknown> }
      if (element.type === 'a' && element.props !== undefined) anchors.push(element.props)
      walk(element.props?.children)
    }
    walk(tree)

    // Three citation links: the third marker names a source that does not
    // exist, so it stays a plain chip. The source ROWS are collapsed (they are
    // covered by `sourceRows` below), which is why they are not counted here.
    assert.equal(anchors.length, 3, 'every known citation is a link')
    assert.equal(anchors[0]?.href, 'https://b.example/2', 'citation 2 is the SECOND source')
    assert.equal(anchors[1]?.href, 'https://a.example/1', 'a list marker expands in order')
    assert.equal(anchors[2]?.href, 'https://b.example/2')
    assert.equal(anchors[0]?.target, '_blank', 'an unrouted click still falls back to the system browser')

    let prevented = 0
    ;(anchors[0]?.onClick as (event: unknown) => void)({ button: 0, preventDefault: () => { prevented++ } })
    assert.deepEqual(written, ['https://b.example/2'], 'the citation click reaches the panel link handler')
    assert.equal(prevented, 1, 'and the anchor does not ALSO open a window')

    const html = renderToStaticMarkup(tree)
    assert.ok(html.includes('参考来源（2）'), 'the source list is labelled, with its count')
    assert.ok(html.includes('dsh-dschat-citation'), 'the chips keep their class')
    assert.ok(html.includes('>9<'), 'a citation with no source is still shown, as a plain chip')
    assert.equal(html.includes('dsh-dschat-source-no'), false, 'the rows are collapsed by default')
    assert.match(html, /aria-expanded="false"/, 'and the heading says so')

    // No table at all: the chips must NOT become anchors, and no list appears.
    const bare = renderToStaticMarkup(Markdown({ source: '结论[citation:3]。', sourcesLabel: '参考来源（1）' }) as never)
    assert.ok(bare.includes('dsh-dschat-cite'), 'the marker still renders as a citation chip')
    assert.equal(bare.includes('<a '), false, 'a citation with no source table is never a link')
    assert.equal(bare.includes('参考来源'), false, 'and there is no source list to show')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * A transcript link must land in the machine's own browser.
 *
 * The panel used to route links into a column of its own (or into the shell's
 * right Sidebar, which refuses to open anything while a global main panel is on
 * screen) — that is the 「点开跑到系统浏览器去了」 complaint, inverted. Now there is
 * one destination, and it is the OS browser: `window.open` is the shell's own
 * external-link path (the Electron main process answers it with
 * `shell.openExternal` and denies the popup).
 *
 * Both halves are exercised: the destination (`openExternalLink`, with a stand-in
 * for `window`) and the anchor contract in `Markdown` (reported, default-
 * prevented when taken, left to `target="_blank"` when declined).
 */
test('a transcript link opens in the machine browser, and only for web schemes', async () => {
  const { Markdown, openExternalLink, createElement, dir } = await loadComponents()
  const globals = globalThis as { window?: unknown }
  const hadWindow = 'window' in globals
  const opened: Array<[string, string, string]> = []
  try {
    globals.window = {
      open: (url: string, target: string, features: string) => { opened.push([url, target, features]) },
    }

    assert.equal(openExternalLink('https://example.com/a'), true)
    assert.equal(openExternalLink('http://127.0.0.1:19387/ui'), true)
    assert.deepEqual(opened[0], ['https://example.com/a', '_blank', 'noopener,noreferrer'])
    assert.deepEqual(opened[1], ['http://127.0.0.1:19387/ui', '_blank', 'noopener,noreferrer'])

    // Anything that is not a web page is refused rather than handed to the OS:
    // a mailto: or a harness-internal URL must not become an external app call.
    for (const href of ['mailto:a@b.c', 'javascript:alert(1)', 'dsh-resource://file/session/x/y', 'not a url']) {
      assert.equal(openExternalLink(href), false, `${href} is not a page`)
    }
    assert.equal(opened.length, 2, 'only the http(s) links were opened')

    // The anchor side: a plain click is reported and default-prevented when the
    // handler took it, so the link is opened exactly once.
    const written: unknown[] = []
    const tree = Markdown({ source: 'see [the docs](https://example.com/a) and [x](https://example.com/b)', onOpenLink: (href: string) => { written.push(href); return true } }) as never
    const anchors: Array<Record<string, unknown>> = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { for (const child of node) walk(child); return }
      if (node === null || typeof node !== 'object') return
      const element = node as { type?: unknown; props?: Record<string, unknown> }
      if (element.type === 'a' && element.props !== undefined) anchors.push(element.props)
      walk(element.props?.children)
    }
    walk(tree)
    assert.equal(anchors.length, 2, 'both links render as anchors')
    assert.equal(anchors[0]?.href, 'https://example.com/a')
    assert.equal(anchors[0]?.target, '_blank', 'the untouched default is the system browser too')

    let prevented = 0
    const click = (event: Record<string, unknown>): void => {
      (anchors[0]?.onClick as (event: unknown) => void)({ button: 0, preventDefault: () => { prevented++ }, ...event })
    }
    click({})
    assert.deepEqual(written, ['https://example.com/a'], 'a plain click is handed to the host')
    assert.equal(prevented, 1, 'and the anchor does not ALSO open a window')

    click({ metaKey: true })
    assert.equal(written.length, 1, 'a modifier click is the user\'s own gesture and is never intercepted')
    assert.equal(prevented, 1)

    // A handler that declines leaves the click alone, so `target="_blank"`
    // (which the desktop shell also routes to the system browser) takes over.
    const declined = Markdown({ source: '[x](https://example.com/c)', onOpenLink: () => false }) as never
    const other: Array<Record<string, unknown>> = []
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) { for (const child of node) collect(child); return }
      if (node === null || typeof node !== 'object') return
      const element = node as { type?: unknown; props?: Record<string, unknown> }
      if (element.type === 'a' && element.props !== undefined) other.push(element.props)
      collect(element.props?.children)
    }
    collect(declined)
    let fallbackPrevented = 0
    ;(other[0]?.onClick as (event: unknown) => void)({ button: 0, preventDefault: () => { fallbackPrevented++ } })
    assert.equal(fallbackPrevented, 0, 'a declined link keeps its native behaviour')
  } finally {
    if (!hadWindow) delete globals.window
    rmSync(dir, { recursive: true, force: true })
  }
})

test('DSchatStatus renders its initial screen', async () => {
  const { DSchatStatus, renderToStaticMarkup, createElement, dir } = await loadComponents()
  try {
    const html = renderToStaticMarkup(createElement(DSchatStatus, { ...deps } as never))
    assert.ok(html.length > 0, 'the status card produced markup')
    assert.match(html, /dsh-dschat-status/)
    assert.match(html, /status\.title/)
    assert.match(html, /settings\.status/)
    assert.match(html, /settings\.runtime/)
    assert.match(html, /settings\.actions/)
    // Before the context route answers, the runtime card shows the loading line
    // rather than an empty section.
    assert.match(html, /settings\.loading/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the client module envelope and its slot registrations are intact', async () => {
  const { readFileSync } = await import('node:fs')
  const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
  // The loader keys factories by id, so the id must equal the package name.
  assert.match(bundle, /id: "dsh-dschat"/)
  assert.match(bundle, /window\.__ModuleLoader__\.load\(/)
  // Both declared surfaces must be registered somewhere in the bundle.
  for (const slot of ['sidebar.panellist', 'main']) {
    assert.ok(bundle.includes(`name: "${slot}"`) || bundle.includes(`"${slot}"`), `registers ${slot}`)
  }
  /*
   * And DSchat must NOT claim a page in the shell's Settings.
   *
   * It used to register `settings.section`, which put a whole page in Settings
   * for a card that is read-only and belongs next to the panel it describes.
   * The plugin's actual configuration is the Config form the shell renders on
   * the Plugins page; the status card is now 「运行状态」 in the panel's own menu.
   */
  assert.equal(
    bundle.includes('"settings.section"'), false,
    'DSchat does not occupy a page of its own in Settings',
  )
  // React must come from the shell's module table, never be bundled.
  assert.match(bundle, /require\("react"\)/)
  assert.ok(!bundle.includes('@deepseek-ai/dsh-client-ui-primitives'), 'no harness Client package is imported')
})

/**
 * Slot names this plugin registers into, with the inject faces the mounted
 * component reads off its props. A registration that omits a face renders an
 * error state (or crashes the shell's slot entry) and is invisible offline
 * unless the registration itself is exercised — which is what this test does.
 */
const REQUIRED_FACES: Record<string, string[]> = {
  'sidebar.panellist': [],
  main: ['api', 'tt', 'openSession', 'pickDirectory', 'createWorkspace'],
}

/**
 * Build the real client entry and run `apply` against a recording context.
 *
 * The context mirrors the two things that actually matter here: `slots.inject`
 * gates a registration on the owning slot existing (a bare `register` for a slot
 * declared by another subtree is dropped), and `slots.register` receives the
 * registration object plus the component.
 */
async function runClientApply(options: { services?: Record<string, unknown> } = {}) {
  const dir = mkdtempSync(join(root, '.tmp-client-entry-'))
  const outfile = join(dir, 'entry.mjs')
  await build({
    entryPoints: [join(root, 'src/client/index.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  })
  const mod = await import(pathToFileURL(outfile).href) as {
    apply(ctx: unknown): void
  }

  const registrations: Array<{ slot: string; reg: Record<string, unknown>; component: unknown }> = []
  const injected: string[] = []
  const warnings: string[] = []

  const ctx = {
    effect(factory: () => void | (() => void)) { factory(); return () => undefined },
    // The shell publishes its lookups on the context; the entry reads the
    // Sidebar and the Remote carrier through here at CALL time.
    get(name: string) { return options.services?.[name] },
    locale: {
      register: () => () => undefined,
      bind: () => (key: string) => key,
      subscribe: () => () => undefined,
    },
    slots: {
      // A slot the shell has not declared yet never calls back — model that as
      // "the registration simply never happens".
      inject(name: string, callback: () => void) { injected.push(name); callback(); return () => undefined },
      register(reg: Record<string, unknown>, component: unknown) {
        registrations.push({ slot: String(reg.name), reg, component })
        return () => undefined
      },
    },
  }

  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  try {
    mod.apply(ctx)
  } finally {
    console.warn = originalWarn
  }
  return { registrations, injected, warnings, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

test('every slot is registered through inject, with the faces its component needs', async () => {
  // The style effect touches document; static markup rendering needs no DOM.
  const globals = globalThis as { document?: unknown }
  const hadDocument = 'document' in globals
  if (!hadDocument) {
    globals.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } }
  }
  const { registrations, injected, warnings, dispose } = await runClientApply()
  try {
    // A registration failure is swallowed into a console.warn by design, so a
    // warning here means a surface silently went missing.
    assert.deepEqual(warnings.filter(w => w.includes('[dsh-dschat]')), [], 'no swallowed registration failure')

    for (const slot of Object.keys(REQUIRED_FACES)) {
      assert.ok(injected.includes(slot), `${slot} registered through slots.inject`)
    }

    assert.equal(registrations.length, 2, 'exactly two surfaces register (sidebar row + center panel)')
    for (const [slot, faces] of Object.entries(REQUIRED_FACES)) {
      const entry = registrations.find(r => r.slot === slot)
      assert.ok(entry !== undefined, `${slot} has a registration`)
      if (faces.length === 0) continue
      const inject = entry.reg.inject
      assert.equal(typeof inject, 'function', `${slot} carries an inject face`)
      const provided = (inject as () => Record<string, unknown>)()
      for (const face of faces) {
        assert.ok(provided[face] !== undefined, `${slot} injects "${face}"`)
      }
    }

    // `label` must be a thunk so the shell re-reads localized text per projection.
    for (const { slot, reg } of registrations) {
      if (slot === 'main') continue
      assert.equal(typeof reg.label, 'function', `${slot} label is a thunk`)
    }
  } finally {
    dispose()
    if (!hadDocument) delete globals.document
  }
})

/**
 * PANEL_CSS is one backtick-delimited template literal, so a stray backtick in a
 * CSS comment ends the string early and the rest parses as an EXPRESSION —
 * "`.dsh-dschat-msg-line`" became `` `str`.dsh - dschat - msg - line ``, which
 * esbuild happily compiles and which then throws `dschat is not defined` at run
 * time, inside the browser half, where the only symptom is a blank panel.
 * Backticks in the file's own JSDoc header are legal, so only the body is checked.
 */
test('PANEL_CSS template literal is not terminated early', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(join(root, 'src/client/panel/styles.ts'), 'utf8')
  const marker = 'export const PANEL_CSS = `'
  const open = source.indexOf(marker)
  assert.ok(open > -1, 'the PANEL_CSS declaration is present')
  // Everything between the opening delimiter and the LAST backtick in the file is
  // template BODY, so it may not contain one.
  const body = source.slice(open + marker.length, source.lastIndexOf('`'))
  const stray = body.split('`').length - 1
  assert.equal(stray, 0, `PANEL_CSS body contains ${stray} stray backtick(s); each one ends the literal early`)
})

/**
 * Floating surfaces and the primary button both used tokens that invert with
 * the theme instead of following the accent:
 *
 *   alias-bg-overlay -> opaque #e9ecf2 light / opaque #61666b DARK, so a menu
 *                       painted with it is a light slab on the dark panel;
 *   button-primary-fill -> brand-primary, i.e. near-white in dark mode, which
 *                       made the transfer button the brightest thing on screen.
 *
 * Measured in a real browser (Chromium + the harness token sheet): the toggle
 * and the primary button now composite to the same fill in both themes
 * (#e6edfc light, #222835 dark) and the menu surface tracks the panel instead
 * of fighting it. These guards exist because neither mistake is visible in a
 * unit test — both render fine, just wrong.
 */
test('floating surfaces use the menu material, not the overlay token', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(join(root, 'src/client/panel/styles.ts'), 'utf8')
  assert.ok(
    css.includes('--dschat-surface: var(--dsw-specific-menu'),
    'the shared surface token is derived from --dsw-specific-menu',
  )
  assert.equal(
    /var\(\s*--dsw-alias-bg-overlay\s*\)/.test(css), false,
    'no surface may paint --dsw-alias-bg-overlay: it is opaque panel grey in dark mode, not a floating material',
  )
  // The token NAME may still be mentioned in prose; only usage is banned.
  for (const surface of ['.dsh-dschat-pop', '.dsh-dschat-msg-acts']) {
    const start = css.indexOf(`${surface} {`)
    assert.ok(start > -1, `${surface} is styled`)
    const rule = css.slice(start, css.indexOf('}', start))
    assert.ok(
      rule.includes('var(--dschat-surface)'),
      `${surface} must paint var(--dschat-surface)`,
    )
  }
})

/**
 * The composer's row opens UPWARD; everything in the title bar opens DOWNWARD.
 *
 * The action row's triggers are at the bottom of the panel, so a menu that grew
 * down from one of them would cover the input card it acts on and would have to
 * fit in the 60-odd pixels between the card and the phase line. Measured in a
 * real browser before the change: the 迁移 panel opened at y=627 downward, over
 * the textarea.
 *
 * The title bar is the mirror image: an upward panel there opened at y=-35 —
 * above the window entirely. So the shared rule is inverted once, for the strip,
 * and every control that strip gains later inherits the right answer.
 *
 * These assertions are about the ANCHOR (`bottom` for the row, `top` for the
 * header) rather than about pixel values. The second half is why the anchor
 * arithmetic is worth a guard at all: it only holds while the wrapper is the
 * trigger's own size. As a stretched flex item of the 36px action row, the
 * wrapper made `bottom: calc(100% + 8px)` resolve to 36px instead of 8px — a gap
 * that changes with whatever else is in the row, which no unit test would have
 * caught on its own.
 */
test('the composer\'s menus open upward, and the title bar\'s open downward', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(join(root, 'src/client/panel/styles.ts'), 'utf8')
  const ruleOf = (selector) => {
    const start = css.indexOf(`${selector} {`)
    assert.ok(start > -1, `${selector} is styled`)
    return css.slice(start, css.indexOf('}', start))
  }

  const pop = ruleOf('.dsh-dschat-pop')
  assert.match(pop, /bottom:\s*calc\(100% \+ 8px\)/, 'panels anchor above their trigger by default')
  assert.equal(
    /[^-]top:/.test(pop), false,
    'and declare no top offset: both offsets set would stretch the box between them',
  )
  assert.ok(pop.includes('right: 0'), 'opening to the left of a right-hand trigger')

  const anchor = ruleOf('.dsh-dschat-pop-wrap')
  assert.ok(anchor.includes('position: relative'), 'the wrapper is the containing block')
  assert.ok(
    anchor.includes('align-self: center'),
    'and stays the trigger\'s own size rather than stretching to the action row\'s height',
  )

  /*
   * The header's inversion. It is keyed on the STRIP, not on the lamp or the
   * 「···」: one rule covers both, and a third control added up there cannot get
   * it wrong.
   */
  const header = ruleOf('.dsh-dschat-header .dsh-dschat-pop')
  assert.ok(header.includes('top: calc(100% + 8px)'), 'the title bar\'s panels open downward, into the transcript')
  assert.ok(header.includes('bottom: auto'), 'which means the shared bottom anchor must be cleared')
  assert.equal(
    ruleOf('.dsh-dschat-lamp-wrap > .dsh-dschat-pop').includes('bottom: auto'), false,
    'and the lamp rule no longer repeats it — the strip owns that decision now',
  )
  assert.equal(
    /\.dsh-dschat-actions[^{]*\.dsh-dschat-pop\s*\{/.test(css), false,
    'the action row must NOT override the anchor: it is the strip the upward default is for',
  )
})

/**
 * The transfer button and the composer pills share one accent family.
 *
 * They no longer share one *recipe*, and that is the change this guards: the
 * pills are now the web app's own switches (a deepseek-static wash with the
 * accent as both border and label — see the composer section of the README),
 * while 「在 Harness 中继续」 is the panel's own primary action and keeps the
 * 13% `state-business-primary` tint that is correct in both themes regardless of
 * which statics a future skin ships.
 *
 * What must NOT come back is the mistake that produced both rules:
 * `button-primary-fill` resolves to brand-primary, which is near-white in dark
 * mode — the reported 「太白了」. So the assertions below are about the accent
 * family and the inverted family, not about matching percentages.
 */
test('the primary button and the composer pills stay on the accent family', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(join(root, 'src/client/panel/styles.ts'), 'utf8')
  const ruleOf = (selector) => {
    const start = css.indexOf(`${selector} {`)
    assert.ok(start > -1, `${selector} is styled`)
    return css.slice(start, css.indexOf('}', start))
  }
  const primary = ruleOf('.dsh-dschat-btn-primary')
  assert.ok(primary.includes('state-business-primary'), 'the primary fill is the accent')
  assert.equal(
    /var\(\s*--dsw-alias-button-primary-(fill|hover|dimmed)\s*\)/.test(primary), false,
    'no button-primary-* token: that family inverts with the theme and goes white in dark mode',
  )
  assert.equal(
    primary.includes('label-primary-foreground'), false,
    'the primary fill is a 13% tint, so its label cannot be the on-accent foreground colour',
  )
  assert.ok(ruleOf('.dsh-dschat-btn-primary:hover').includes('label-primary'), 'the hover label stays readable')

  /*
   * The action row's own buttons are the same argument in a different shape.
   *
   * 「DSH 迁移」 left the primary family when it moved onto the row: one line
   * above a card whose primary action is a 16px accent circle, a filled blue
   * chip competed with the send button and made the loudest thing in a row of
   * four quiet glyphs the one control that is not the message. So rest is
   * transparent and quiet, and the accent comes back only where it MEANS
   * something — hover, and the open state that says "this button owns the panel
   * on screen now". Both are tints of the accent token; the inverted
   * button-primary-* family must not appear at all.
   */
  const tbtn = ruleOf('.dsh-dschat-tbtn')
  assert.ok(tbtn.includes('background: transparent'), 'the toolbar button rests unfilled')
  assert.ok(tbtn.includes('color: var(--dsw-alias-label-secondary)'), 'and quiet, like the glyphs beside it')
  assert.equal(
    /border:\s*1px solid var\(--dsw/.test(tbtn), false,
    'rest draws no visible border — only the open state does',
  )
  const tbtnOn = ruleOf('.dsh-dschat-tbtn-on')
  assert.ok(tbtnOn.includes('state-business-primary'), 'the open state is the accent family')
  assert.equal(
    /button-primary-(fill|hover|dimmed)/.test(
      [tbtn, tbtnOn, ruleOf('.dsh-dschat-tbtn:hover'), ruleOf('.dsh-dschat-tbtn:disabled')].join('\n'),
    ),
    false,
    'never the theme-inverting button-primary-* family, which goes white in dark mode',
  )

  // The pills: the web app's own two-state recipe, both states by token.
  // Sliced from the selector to the closing brace at column zero, because this
  // rule is a two-line selector list and the single-line helper above would
  // read the first line as if it were the whole rule.
  const toggleStart = css.indexOf('.dsh-dschat-toggle.dsh-dschat-toggle-on,')
  assert.ok(toggleStart > -1, 'the on-state pill is styled')
  const toggle = css.slice(toggleStart, css.indexOf('\n}', toggleStart))
  assert.ok(toggle.includes('--dsw-static-deepseek-50'), 'the on-state fill is the web app\'s own light blue')
  assert.ok(toggle.includes('--dsw-static-deepseek-500'), 'and its label/border are the accent blue')
  assert.ok(toggle.includes('--dsw-alias-state-business-primary'), 'with a token-only fallback, never a literal colour')
  const darkStart = css.indexOf('body[data-ds-dark-theme] .dsh-dschat-toggle.dsh-dschat-toggle-on')
  assert.ok(darkStart > -1, 'and the dark pill repeats the compound class')
  const dark = css.slice(darkStart, css.indexOf('\n}', darkStart))
  assert.ok(dark.includes('--dsw-static-deepseek-800'), 'the dark end of the same ramp, not the light one')
})

/**
 * Every place this panel pairs `button-primary-dimmed` with a label, in both
 * themes, measured against the real palette:
 *
 *   label-primary-foreground -> 1.16:1 light / 1.97:1 dark (invisible)
 *   label-secondary          -> 4.98:1 light / 6.37:1 dark
 *
 * The dimmed fill is light grey in light mode and dark grey in dark mode; the
 * *-foreground family is its inverse in both, so they cancel out. This is the
 * same mistake that produced the user-visible "有点暗" and the bright white
 * primary button, so it gets a guard rather than a comment.
 */
test('a dimmed fill never carries an on-accent foreground colour', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(join(root, 'src/client/panel/styles.ts'), 'utf8')
  // Comments are stripped first: the fix's own explanation names the token it
  // warns against, and prose must not trip a declaration-level guard.
  const declarationsOnly = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const offenders = []
  const ruleRe = /([^{}]+)\{([^}]*)\}/g
  for (const [, selector, decls] of declarationsOnly.matchAll(ruleRe)) {
    if (!decls.includes('button-primary-dimmed')) continue
    if (decls.includes('label-primary-foreground') || decls.includes('label-primary-inverted')) {
      offenders.push(selector.trim())
    }
  }
  assert.deepEqual(offenders, [], `these rules put an on-accent colour on a dimmed fill: ${offenders.join(', ')}`)
  /*
   * The disabled send button is the one place the pairing is now deliberately
   * absent, and it has to SAY so — the reason the guard above exists is that
   * `background` alone lets the enabled colour leak through, and the disabled
   * rule inherits its background from the enabled rule directly above it.
   *
   * The design it implements is the web app's own: the accent circle stays the
   * accent circle and the whole control drops to 40% opacity, so the glyph is
   * white-on-accent at every state and the contrast argument that produced the
   * old grey-dimmed fill no longer applies to it. What must never come back is
   * the old shape of the fix: a `button-primary-dimmed` fill (light grey in
   * light mode, dark grey in dark mode) under an on-accent glyph.
   */
  const send = declarationsOnly.slice(declarationsOnly.indexOf('.dsh-dschat-send:disabled'))
  const sendRule = send.slice(0, send.indexOf('}'))
  assert.ok(sendRule.includes('opacity'), 'the disabled send button dims the whole control')
  assert.equal(
    /button-primary-(dimmed|fill)/.test(sendRule), false,
    'the disabled send button keeps the accent fill it inherits, rather than swapping in the theme-inverting primary family',
  )
})

/**
 * The macOS window chrome band.
 *
 * The Electron window is titleBarStyle "hiddenInset" with the traffic lights at
 * x=16, floating over the page. The shell reserves that band with
 * --dsh-frame-leading-clearance, set on the frame only while
 * [data-sidebar-collapsed] is on: 160px, or 84px in fullscreen, and unset on
 * Web and Windows, where a real title bar owns the space. Its own Conversation
 * header reads the variable, so it always starts at the clearance edge; the
 * sidebar's 280px column usually hides the problem, and collapsing it exposes
 * the panel's flat 14px inset — the rail toggle, brand mark and brand name were
 * painted under the traffic lights and under the shell's own 打开侧边栏 /
 * 新建会话 controls (the shell.leading seat, ending at 152px).
 *
 * Measured against the live GUI (Chromium + the harness sheet, sidebar
 * collapsed, html[data-platform=darwin]): padding-inline-start 14px -> 160px,
 * first header control at x=160. Expanded stays 14px; collapsed fullscreen
 * resolves to the shell's own 84px.
 *
 * This is a guard rather than a comment because nothing about the mistake is
 * visible in a unit test or at the default window size — it only shows up in
 * one platform, one sidebar state, at the top-left corner of the screen.
 */
test('the header clears the macOS window chrome band', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(join(root, 'src/client/panel/styles.ts'), 'utf8')
  const ruleOf = (selector) => {
    const start = css.indexOf(`${selector} {`)
    assert.ok(start > -1, `${selector} is styled`)
    return css.slice(start, css.indexOf('}', start))
  }

  const header = ruleOf('.dsh-dschat-header')
  assert.ok(
    header.includes('var(--dsh-frame-leading-clearance'),
    'the header must read the shell chrome clearance, the same variable the shell Conversation header consumes',
  )
  assert.match(
    header,
    /max\(\s*14px\s*,\s*var\(--dsh-frame-leading-clearance,\s*0px\)\s*\)/,
    'the clearance must be floored at the plain 14px inset so Web, Windows and an expanded sidebar are unchanged',
  )
  assert.ok(header.includes('padding-inline:'), 'the chrome clearance applies to the leading edge only')
  assert.equal(
    /[^-\w]padding:\s*0\s+14px/.test(header), false,
    'a flat padding shorthand would shadow the leading inset again',
  )

  /*
   * One nowrap row with no wrap point: when the window cannot fit it, something
   * must give instead of pushing the controls off the edge.
   *
   * What gives is the run of empty space — and it is now the only thing that
   * can, because the header holds three fixed boxes: the brand, the lamp, and
   * the 「···」 menu button (which the spacer has to stay to the right of, since
   * that is where a title bar's menu lives). None of them may shrink: a squashed
   * mark is a broken logo, the lamp is the only readout of the engine's state,
   * and the menu is the only way to reach 导出 markdown.
   */
  assert.ok(ruleOf('.dsh-dschat-spacer').includes('flex: 1'), 'the spacer is the flexible child')
  const brand = ruleOf('.dsh-dschat-brand')
  assert.ok(brand.includes('flex: none'), 'the brand is a fixed box — it may never be squeezed')
  assert.equal(brand.includes('min-width: 0'), false, 'and it never shrinks below its own size')
  const lamp = ruleOf('.dsh-dschat-lamp')
  assert.ok(lamp.includes('flex: none'), 'the lamp is a fixed box too')
  assert.equal(lamp.includes('min-width: 0'), false, 'and it never shrinks below its own size')
  /*
   * The action row is BELOW the header, so it may wrap or scroll on its own
   * terms — but its controls still must not be shrunk into each other by a
   * narrow column, which is why each keeps `flex: none` as well. Since v0.4.1
   * that is the same rule the header's menu button uses, because they are the
   * same button.
   */
  for (const selector of ['.dsh-dschat-tbtn']) {
    assert.ok(ruleOf(selector).includes('flex: none'), `${selector} keeps its controls at full size`)
    assert.ok(ruleOf(selector).includes('white-space: nowrap'), `${selector} never wraps its label`)
  }
})

/**
 * The panel must take its smooth updates from `/tail` (one message, as a delta)
 * and NEVER from `/state` (the whole store — 2,581,434 bytes on a real 108-chat
 * history) at streaming speed.
 *
 * Reporting symptom: the reply appeared "一大段一大段" — paragraphs at a time.
 * The cause was this loop polling the full store every 600 ms to move a few
 * dozen new characters, so the panel believed it was streaming while it was
 * really sampling. Both halves are pinned: the fast feed exists, and the slow
 * snapshot no longer speeds up.
 */
test('the streaming feed is the tail poll, not a fast /state poll', async () => {
  const { readFileSync } = await import('node:fs')
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')

  assert.ok(/api\.tail\(/.test(panel), 'the panel polls the tail feed')
  assert.ok(/POLL_TAIL_MS/.test(panel), 'at its own fast interval')

  const fast = /const POLL_TAIL_MS = (\d+)/.exec(panel)
  assert.ok(fast !== null, 'the tail interval is a named constant')
  assert.ok(Number(fast[1]) <= 150, `the tail interval is fast enough to read as continuous (got ${fast[1]} ms)`)

  const idle = /const POLL_IDLE_MS = ([\d_]+)/.exec(panel)
  assert.ok(idle !== null, 'the /state interval is a named constant')
  assert.ok(
    Number(idle[1].replaceAll('_', '')) >= 1_000,
    `/state must stay slow — it serializes every transcript (got ${idle[1]} ms)`,
  )
  assert.equal(
    /POLL_STREAM_MS/.test(panel), false,
    'no fast /state interval may come back: that is the paragraph-sized update',
  )
  // The delta rule itself lives in `mergeTail` (protocol.ts) so the host's
  // `head`/`tail` and the panel's apply are one piece of code; the panel must
  // route every tail response through it rather than assigning the body.
  assert.ok(/mergeTail\(/.test(panel), 'the panel folds a tail through the shared merge')
  const protocol = readFileSync(join(root, 'src/protocol.ts'), 'utf8')
  assert.ok(
    /\.slice\(0, message\.head\)\s*\+\s*message\.tail/.test(protocol),
    'the merge applies the head/tail delta rather than replacing the message',
  )
  // Tailing must start on send, not when /state next reports busy: the gap
  // between Enter and the first token is exactly when the panel looked stuck.
  assert.ok(/TAIL_AFTER_SEND_MS/.test(panel), 'sending arms the tail loop immediately')
  // The one place the fast loop may need a full snapshot (a chat the panel has
  // not seen yet) must be throttled to the slow cadence — otherwise the
  // fallback quietly becomes the fast whole-store poll this replaced.
  assert.match(
    panel,
    /lastReconcileRef\.current\s*>=\s*POLL_IDLE_MS/,
    'the tail loop throttles its /state fallback',
  )
})

/**
 * Reported bug: pressing 引用 on a reply put the literal
 * `> <details><summary>思考过程</summary>` into the composer.
 *
 * Cause: the stored message is ONE string whose first line is the thinking
 * wrapper, and the quote action took `content.split('\n')[0]`. The behaviour
 * itself is pinned in test/reply.test.ts; this one pins the panel to that
 * helper, because the tempting one-liner is still sitting right there.
 */
test('quoting and copying a reply go through the reply splitter', async () => {
  const { readFileSync } = await import('node:fs')
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')

  assert.ok(/from '\.\/reply\.ts'/.test(panel), 'the panel imports the splitter')
  assert.ok(/replyBody\(message\.content\)/.test(panel), 'copy takes the answer, not the reasoning')
  assert.ok(/firstLine\(message\.content\)/.test(panel), 'quote takes the answer, not the reasoning')
  assert.equal(
    /:(?:^|[^.\w])message\.content\.split\('\\n'\)\[0\]/.test(panel), false,
    "quoting must never take the raw first line: that line IS the <details> opener",
  )
  // The reasoning is still reachable — as its own action, never folded back
  // into the copy button (which is what the bug report was really about).
  assert.ok(/thinkingBody\(message\.content\)/.test(panel), 'the reasoning is offered separately')
  assert.ok(/msg\.copyThinking/.test(panel), 'and its action is labelled')
})

/**
 * Reported bug: the top bar was blank and double-clicking it did nothing.
 *
 * The desktop shell turns `data-window-drag` into a draggable region; this panel
 * is a full-width seat at the top of the window, so without the attribute its
 * header covered the only strip the user could grab.
 *
 * Deliberately asserted as an ATTRIBUTE and not as CSS: the drag rule has to
 * stay in the shell's sheet, because the control-exclusion rule
 * (`:is(button,…){-webkit-app-region:no-drag}`) lives there too. A plugin sheet
 * that declared `drag` would make the header's own buttons undraggable.
 */
test('the panel header is a window drag region', async () => {
  const { readFileSync } = await import('node:fs')
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')
  const cssSource = readFileSync(join(root, 'src/client/panel/styles.ts'), 'utf8')
  // Comments are not CSS: the file documents the shell's rule on purpose.
  const css = cssSource.replace(/\/\*[\s\S]*?\*\//g, '')

  assert.match(
    panel,
    /'data-window-drag': true/,
    "the panel must claim the shell's drag hook or the title bar stays dead",
  )
  assert.equal(
    /-webkit-app-region/.test(css), false,
    'the drag property itself must stay in the shell sheet, which also excludes the controls',
  )
})

/**
 * Reported bug: "输入框可以复制和拖动图片进去，但其他文件似乎不行".
 *
 * Two independent image-only filters did it — the drop/paste handler and the
 * engine's `accept*="image"` selector — and both had to go, because either one
 * alone still refuses a PDF.
 */
test('dropped and pasted files are not filtered down to images', async () => {
  const { readFileSync } = await import('node:fs')
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')
  const engine = readFileSync(join(root, 'src/engine/engine.ts'), 'utf8')
  const routes = readFileSync(join(root, 'src/routes.ts'), 'utf8')

  assert.ok(/isAttachableFile/.test(panel), 'the drop/paste filter has a name that is not about images')
  assert.equal(
    /isImageFile/.test(panel), false,
    'a file.type.startsWith(image/) filter is what silently ate every PDF and .docx',
  )
  assert.ok(/filter\(isAttachableFile\)/.test(panel), 'both handlers route through it')

  // The page is the authority on types; the engine may only prefer an input
  // that accepts documents, never require an image one.
  assert.equal(
    /accept\*="image" i\]'\]/.test(engine), false,
    'the image-only selector list made images the only attachable type',
  )
  assert.ok(/attachFiles\(/.test(engine), 'the engine uploads files, not images')
  assert.equal(/attachImages\(/.test(engine), false, 'and no image-only entry point is left behind')

  // A nameless attachment must not inherit the old blanket `.png`: the web page
  // reads the extension, so a `.docx` named `x.png` is refused there instead of
  // here, where the reason is still visible.
  assert.equal(
    /return '\.png'/.test(routes), false,
    'the extension fallback may not claim every unknown file is an image',
  )
  assert.ok(/SAFE_EXTENSION/.test(routes), 'and it is an allow-list, not the caller-supplied name')
})

/**
 * The conversation list is user-sized.
 *
 * The rail was a fixed 238px column, which is both too narrow for
 * 「DSH 插件槽位与 UI 集成方案」-length titles and impossible to shrink for a reader
 * who only wants the transcript. It is now a drag handle (plus arrow keys, since
 * a width that can only be set by dragging is a width half the readers cannot
 * set) with the width remembered per window in localStorage.
 *
 * The handle's ARIA value is the assertion that matters in a static render: it
 * is the state the drag mutates, and it is what a screen reader announces.
 */
test('the conversation list renders a drag handle at its remembered width', async () => {
  const { DSchatPanel, renderToStaticMarkup, createElement, dir } = await loadComponents()
  const globals = globalThis as { window?: unknown }
  const hadWindow = 'window' in globals
  const store = new Map<string, string>()
  const render = (): string => renderToStaticMarkup(createElement(DSchatPanel, deps as never))
  try {
    globals.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
      },
    }

    // Nothing remembered: the shipped default, and a separator the reader can
    // grab, key or double-click.
    const fresh = render()
    assert.match(fresh, /dsh-dschat-rail-resize/, 'the handle is rendered')
    assert.match(fresh, /role="separator"/, 'and it is a separator, not a decorative div')
    assert.match(fresh, /aria-valuenow="238"/, 'at the default width')
    assert.match(fresh, /width:238px/, 'which is what the rail is actually laid out at')

    // A remembered width is honoured.
    store.set('dsh-dschat.rail.width', '310')
    assert.match(render(), /aria-valuenow="310"/, 'a stored width is restored on the next mount')
    assert.match(render(), /width:310px/)

    // Anything outside the survivable range is clamped rather than trusted: a
    // stored 20px would leave a rail too narrow to click, and a stored 4000px
    // would leave no transcript at all.
    store.set('dsh-dschat.rail.width', '20')
    assert.match(render(), /aria-valuenow="170"/, 'a too-narrow stored width is clamped up')
    store.set('dsh-dschat.rail.width', '4000')
    assert.match(render(), /aria-valuenow="460"/, 'a too-wide stored width is clamped down')
    store.set('dsh-dschat.rail.width', 'nonsense')
    assert.match(render(), /aria-valuenow="238"/, 'an unparsable width falls back to the default')

    /*
     * And the drag itself: pointer moves are tracked on the WINDOW (the pointer
     * leaves the 6px strip immediately otherwise), the width is written once on
     * release rather than 60×/s, and the panel blocks text selection while it
     * is in flight.
     */
    const panel = (await import('node:fs')).readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')
    assert.match(panel, /window\.addEventListener\('pointermove', move\)/, 'the drag follows the window, not the handle')
    assert.match(panel, /writeStored\(RAIL_STORE, String\(width\)\)/, 'the width is persisted once, on release')
    assert.match(panel, /data-rail-drag/, 'the panel marks an in-flight drag')
    assert.equal(/toggleSide|sideColumn|data-rail=|rightbar\./.test(panel), false, 'no right-column plumbing is left')
  } finally {
    if (!hadWindow) delete globals.window
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * The reasoning row: a real disclosure with the turn's measured duration.
 *
 * The engine stores reasoning inside a `<details>` wrapper, which is the right
 * format for a transcript and the wrong thing to render: the browser's own
 * marker and type scale ignore the panel's theme, and the summary would say
 * whatever the engine wrote instead of how long the model actually thought. The
 * panel therefore splits the reasoning off and hands it to `Thinking`.
 *
 * Three states of the label are pinned here, because each one is a different
 * claim to the reader: a running thought, a measured one, and one recovered
 * from the web (whose history has the text but no timing).
 */
test('the reasoning row is a disclosure with a measured duration', async () => {
  const { Markdown, Thinking, thoughtLabel, renderToStaticMarkup, createElement, dir } = await loadComponents()
  try {
    const tr = (key: string, values?: Record<string, string>): string => {
      const templates: Record<string, string> = {
        'msg.thought': '已思考',
        'msg.thought.running': '思考中…',
        'msg.thought.seconds': '已思考（用时 {seconds} 秒）',
        'msg.thought.minutes': '已思考（用时 {minutes} 分 {seconds} 秒）',
      }
      const template = templates[key] ?? key
      return values === undefined
        ? template
        : template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
    }

    assert.equal(thoughtLabel(undefined, true, tr), '思考中…', 'a reply still thinking says so')
    assert.equal(thoughtLabel(undefined, false, tr), '已思考', 'a recovered reply has no time to claim')
    assert.equal(thoughtLabel(400, false, tr), '已思考（用时 1 秒）', 'a sub-second thought is not "0 秒"')
    assert.equal(thoughtLabel(12_400, false, tr), '已思考（用时 12 秒）')
    assert.equal(thoughtLabel(72_000, false, tr), '已思考（用时 1 分 12 秒）')
    assert.equal(thoughtLabel(60_000, false, tr), '已思考（用时 1 分 0 秒）')

    // The block renders as a button + body, and the body stays closed: the
    // answer is what the reader came for.
    const html = renderToStaticMarkup(createElement(Thinking, {
      source: '先看约束，再算一遍。',
      label: '已思考（用时 12 秒）',
    } as never))
    assert.match(html, /dsh-dschat-think-head/, 'the row is the panel\'s own control')
    assert.match(html, /已思考（用时 12 秒）/, 'and it carries the measured duration')
    assert.match(html, /aria-expanded="false"/, 'collapsed by default')
    assert.equal(/<details|<summary/.test(html), false, 'no raw details element is rendered')
    assert.equal(/先看约束/.test(html), false, 'a collapsed row does not render its reasoning')

    // A `<details>` block arriving inside markdown (the engine's stored format,
    // or a message an author wrote) goes through the SAME disclosure.
    const viaMarkdown = renderToStaticMarkup(createElement(Markdown, {
      source: '<details><summary>思考过程</summary>\n\n推理内容\n\n</details>\n\n答案。',
    } as never))
    assert.equal(/<details|<summary/.test(viaMarkdown), false, 'the markdown path renders no raw details either')
    assert.match(viaMarkdown, /dsh-dschat-think-head/)
    assert.match(viaMarkdown, /思考过程/, 'a foreign block keeps its own summary text')
    assert.match(viaMarkdown, /答案。/, 'and the answer stays visible')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * The reasoning row's two faces, which are MUTUALLY EXCLUSIVE.
 *
 * This is the reported bug, and the reason these assertions are shaped as
 * "the one is absent whenever the other is present" rather than as two
 * independent checks: the row used to keep its summary line mounted and simply
 * append the body under it, so a reader who watched a thought finish saw a
 * 「思考中…」 row with the entire reasoning printed below it — both faces at
 * once. The reader asked for one or the other, and for the collapsed line to be
 * what they meet by default.
 *
 * The three states, all readable from markup alone:
 *
 *   - collapsed (the default) → the summary line, and NO reasoning in the DOM;
 *   - expanded → the reasoning, and NO summary line;
 *   - still reasoning (`thinkingMs` absent, `streaming` true) → ALSO the
 *     collapsed line, carrying the live one-line 「思考中：<最新的思考内容>」 view
 *     instead of a label. This is the state that changed: the row used to open
 *     ITSELF for the duration of the thought, so a reasoner unfolded a
 *     screenful of text on every turn and folded it back once the answer
 *     arrived. It now stays closed until the reader opens it.
 *
 * The live line is a tail view: the prefix is its own element so it can never be
 * scrolled or truncated away, and the text sits in a clipping window the panel
 * shifts by a measured overflow.
 *
 * The OPEN face cannot be reached from a static render (nothing clicks), so the
 * browser pass (scripts/ui-shot.mjs) drives it for real; what is pinned here is
 * that the two faces are mutually exclusive whichever way each is reached.
 */
test('a reasoning row shows either its summary line or its text, never both', async () => {
  const { Thinking, renderToStaticMarkup, createElement, dir } = await loadComponents()
  const HEAD = /dsh-dschat-think-head/
  const BODY = /dsh-dschat-think-body/
  try {
    // 1. Collapsed — what a finished thought looks like with no interaction, and
    // what every message in the transcript shows.
    const collapsed = renderToStaticMarkup(createElement(Thinking, {
      source: '先看约束，再算一遍。',
      label: '已思考（用时 12 秒）',
    } as never))
    assert.match(collapsed, HEAD, 'the row is the panel\'s own control')
    assert.match(collapsed, /已思考（用时 12 秒）/, 'and it carries the measured duration')
    assert.match(collapsed, /aria-expanded="false"/, 'collapsed by default')
    assert.equal(BODY.test(collapsed), false, 'the collapsed face renders no body')
    assert.equal(/先看约束/.test(collapsed), false, 'and keeps the reasoning out of the DOM')
    assert.equal(/dsh-dschat-think-live/.test(collapsed), false, 'a finished thought shows no live line')

    /*
     * 2. STILL REASONING. The row is born collapsed and STAYS collapsed — the
     * reasoning is not in the DOM — but the one visible line is the live view,
     * so 「思考中：…」 and a tail of the newest text are on screen the whole time.
     * Nothing the reader needs is hidden; only the screenful is.
     */
    const running = renderToStaticMarkup(createElement(Thinking, {
      source: '先看约束：迁移过去的上下文必须自洽。\n\n再算一遍预算。',
      label: '思考中…',
      liveLabel: '思考中：',
      streaming: true,
    } as never))
    assert.match(running, HEAD, 'a running thought still shows its one line')
    assert.match(running, /aria-expanded="false"/, 'and does not open itself')
    assert.equal(BODY.test(running), false, 'the running reasoning is NOT unfolded into the transcript')
    assert.match(running, /dsh-dschat-think-live/, 'the line is the live tail view instead of a label')
    assert.match(running, /dsh-dschat-think-live-prefix/, 'whose prefix is its own element, so it cannot be clipped away')
    assert.match(running, /再算一遍预算。/, 'and whose text is the newest part of the thought')
    assert.equal(/dsh-dschat-think-label/.test(running), false, 'the plain 「已思考」 label does not also render')

    /*
     * 3. The open face, reached the way the browser pass reaches it: a row the
     * reader opened while it was running, then the duration arrives (`thinkingMs`
     * stamped, `streaming` still true for the rest of the reply). The open face
     * is what is on screen, and the summary line is NOT beside it.
     *
     * A static render produces the INITIAL (closed) state only, so this drives
     * the FACE directly through the same props the open row carries — see the
     * `expanded` fixture the browser pass also uses.
     */
    const expanded = renderToStaticMarkup(createElement(Thinking, {
      source: '先看约束：迁移过去的上下文必须自洽。\n\n再算一遍预算。',
      label: '思考中…',
      liveLabel: '思考中：',
      streaming: true,
      defaultOpen: true,
    } as never))
    assert.match(expanded, BODY, 'the opened thought shows its text')
    assert.match(expanded, /data-open="true"/, 'the row says it is open')
    assert.equal(HEAD.test(expanded), false, 'and the summary line is NOT also on screen')
    assert.equal(/dsh-dschat-think-live/.test(expanded), false, 'so no live line is rendered either')
    assert.match(expanded, /先看约束：迁移过去的上下文必须自洽。/, 'the reasoning itself is what is on screen')
    assert.match(expanded, /role="button"/, 'the expanded body is its own collapse control')
    assert.match(expanded, /aria-expanded="true"/, 'and reports itself as expanded')

    // 4. Recovered from the web: no timing to claim, and nothing to watch. This
    // must NOT be mistaken for the live state — it is a finished thought whose
    // duration was never measured.
    const recovered = renderToStaticMarkup(createElement(Thinking, {
      source: '历史里只有推理文本。',
      label: '已思考',
      liveLabel: '思考中：',
      streaming: false,
    } as never))
    assert.match(recovered, /已思考/, 'a recovered thought says so')
    assert.equal(/dsh-dschat-think-live/.test(recovered), false, 'and is not rendered as a running one')
    assert.equal(/历史里只有推理文本/.test(recovered), false, 'a closed row renders no reasoning')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * The source rows themselves, which the collapsed list keeps out of the DOM.
 *
 * Positions are the contract — `[citation:N]` indexes this table — so a row
 * the page named no URL for must keep its slot and render as plain text rather
 * than being dropped (which would silently point every later citation at the
 * wrong page).
 */
test('every source row keeps its number and links only when it has a URL', async () => {
  const { sourceRows, createElement, renderToStaticMarkup, dir } = await loadComponents()
  try {
    const rows = sourceRows([
      { url: 'https://a.example/1', title: '甲页' },
      { url: '' },
      { url: 'https://c.example/3' },
    ]) as never
    const html = renderToStaticMarkup(createElement('ol', null, rows) as never)

    assert.equal((html.match(/dsh-dschat-source-no/g) ?? []).length, 3, 'three numbered rows')
    assert.equal((html.match(/<a /g) ?? []).length, 2, 'the URL-less row is not a link')
    assert.match(html, />1<[\s\S]*甲页/)
    assert.match(html, /dsh-dschat-source-plain/, 'the placeholder renders as plain text')
    assert.match(html, /href="https:\/\/c\.example\/3"/, 'and the row after it keeps its own URL')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Reported bug: "点击后没有出现新会话，更没有打开新会话" — and, after that one was
 * fixed, "打开后看到的是上一次的蒸馏上下文".
 *
 * Both symptoms came from the same shape of mistake: a navigation the shell
 * refuses (`sessions.retain: unknown session <id>`) was swallowed inside a
 * try/catch, so the click left the reader on whatever session was already on
 * screen. Retrying is necessary (the Client list learns the new row over a
 * different socket) but not sufficient — the panel must also SAY when even the
 * retries ran out.
 */
test('the transfer reports a navigation the shell could not take', async () => {
  const { readFileSync } = await import('node:fs')
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')
  const entry = readFileSync(join(root, 'src/client/index.ts'), 'utf8')
  const locales = readFileSync(join(root, 'src/client/locales.ts'), 'utf8')

  assert.ok(/Promise<boolean>/.test(entry), 'the navigation reports its outcome instead of returning void')
  assert.ok(/resolve\(false\)/.test(entry), 'a refused navigation resolves false — it is a branch, not a log line')
  assert.ok(/OPEN_SESSION_ATTEMPTS/.test(entry), 'and it still retries while the Client list catches up')
  assert.ok(/refreshProjections/.test(entry), 'warming the title projection keeps the new row from being blank')

  assert.ok(/toast\.open\.failed/.test(panel), 'the panel surfaces a failed navigation to the reader')
  assert.ok(/opened === false/.test(panel), 'only an explicit false toasts: a face that returns nothing is not a failure')
  assert.ok(
    /'toast\.open\.failed'/.test(locales),
    'and the message is localized, like every other string in this panel',
  )

  /*
   * The transfer popover must not remember the previous "append to an existing
   * session" choice: its default target is the most recently updated cold
   * session, i.e. the LAST transfer — so a stale selection silently writes the
   * new brief into the previous session and the reader sees the previous
   * distillation where they expected a fresh session.
   */
  assert.match(
    panel,
    /if \(!transferOpen\) \{\s*setTransferTarget\('new'\)/,
    'opening the transfer popover always starts from "新建会话"',
  )
})

/**
 * Reported bugs: "先出现参考来源，然后是流式输出的内容" — the source list rendered
 * while the reply was still streaming, so it stood alone at the top of an empty
 * message and was pushed down as the answer grew above it.
 *
 * The web numbers its sources as soon as the search step returns, which is
 * BEFORE the first token of the answer, and the engine stores the table the
 * moment it exists (it has to: the table is the only copy of the URLs).
 * Withholding `sourcesLabel` while `streaming` is what orders the transcript the
 * way the page itself ends up — answer, then sources — and the CHIPS stay live,
 * because `sources` is still handed over on every tick.
 */
test('the source list waits for the reply to finish, while citation chips stay live', async () => {
  const { Markdown, renderToStaticMarkup, createElement, dir } = await loadComponents()
  const { readFileSync } = await import('node:fs')
  try {
    const sources = [{ url: 'https://example.com/a', title: 'A' }]
    const streaming = renderToStaticMarkup(createElement(Markdown, {
      source: '正文 [citation:1]',
      sources,
    } as never))
    const settled = renderToStaticMarkup(createElement(Markdown, {
      source: '正文 [citation:1]',
      sources,
      sourcesLabel: '参考来源（1）',
    } as never))

    assert.equal(/dsh-dschat-sources/.test(streaming), false, 'no source list while streaming')
    assert.match(streaming, /dsh-dschat-citation/, 'but the citation chip is still rendered')
    assert.match(streaming, /href="https:\/\/example\.com\/a"/, 'and it is still a link to its source')

    assert.match(settled, /dsh-dschat-sources/, 'the list appears once the reply is complete')
    assert.match(settled, /参考来源（1）/, 'with the count the panel formatted')
    assert.equal(/dsh-dschat-source-no/.test(settled), false, 'and stays folded until the reader asks')

    // The panel is what withholds the heading, keyed on `streaming`, and what
    // formats the count into it.
    const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')
    assert.match(
      panel,
      /sources === undefined \|\| message\.streaming === true\s*\? \{\}\s*: \{ sourcesLabel/,
      'the panel withholds the heading while the reply streams',
    )
    assert.match(panel, /tr\('msg\.sources\.count'/, 'and passes the count through the locale')
    /*
     * The TABLE must go over on every tick, not only once the reply settles:
     * it is what makes the chips clickable while the answer is still arriving.
     * Dropping it (the label is right there, after all) leaves the numbers
     * rendering as dead chips for the whole stream, which is silent — the
     * panel still looks fine, the links just are not links.
     */
    assert.match(
      panel,
      /\.\.\.\(sources === undefined \? \{\} : \{ sources \}\)/,
      'the panel hands the citation table over unconditionally',
    )
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Every `tr('…')` key the browser half asks for must exist in the dictionary.
 *
 * Locale keys are strings looked up at render time, so a typo — or a key that
 * was removed from the dictionary while a component kept asking for it — is
 * invisible to TypeScript and to a render test: the panel happily prints
 * `msg.sources.count` to the user. That is not hypothetical; it shipped once in
 * this exact file and was caught only by looking at a screenshot.
 *
 * The dictionary is read as SOURCE rather than imported so the guard also fails
 * when the key exists in one language and not the other.
 */
test('every locale key the panel asks for exists in both dictionaries', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const locales = readFileSync(join(root, 'src/client/locales.ts'), 'utf8')
  const zh = locales.slice(locales.indexOf('export const zh'), locales.indexOf('export const en'))
  const en = locales.slice(locales.indexOf('export const en'))
  const keysOf = (block: string): Set<string> =>
    new Set([...block.matchAll(/^  '([^']+)':/gm)].map(match => match[1] as string))

  const asked = new Set<string>()
  for (const file of readdirSync(join(root, 'src/client/panel'))) {
    const source = readFileSync(join(root, 'src/client/panel', file), 'utf8')
    for (const match of source.matchAll(/\btr\('([^']+)'/g)) asked.add(match[1] as string)
    for (const match of source.matchAll(/\btt\('([^']+)'/g)) asked.add(match[1] as string)
  }
  const entry = readFileSync(join(root, 'src/client/index.ts'), 'utf8')
  for (const match of entry.matchAll(/\btt\('([^']+)'/g)) asked.add(match[1] as string)

  assert.ok(asked.size > 20, `the scan found the panel's copy (${asked.size} keys)`)
  const zhKeys = keysOf(zh)
  const enKeys = keysOf(en)
  assert.deepEqual([...asked].filter(key => !zhKeys.has(key)), [], 'every key exists in zh')
  assert.deepEqual([...asked].filter(key => !enKeys.has(key)), [], 'every key exists in en')
  assert.deepEqual(
    [...zhKeys].filter(key => !enKeys.has(key)),
    [],
    'and the two dictionaries stay the same size',
  )
})
