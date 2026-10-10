/**
 * Does a press OUTSIDE the 会话列表 popover close it?
 *
 * This is a behavioural check the design sheet cannot make. It needs a real
 * pointer, because the panel listens for `pointerdown` and because the whole
 * question is about event ORDER: the listener is attached in an effect, so a
 * press that lands after the opening click must close the menu while the
 * opening click itself must not.
 *
 * It drives the REAL component in both directions:
 *
 *   1. mount with the list closed, press the trigger  -> open
 *   2. press a point over the transcript              -> closed
 *   3. press the trigger again                        -> open
 *   4. type in the popover's search box, press again  -> still open
 *
 * The last two are the ones that catch a regression to `mousedown`-on-document
 * without a `contains` guard: a menu that closes while the reader is typing in
 * it is worse than one that never closes.
 *
 * Usage: node scripts/list-dismiss-check.mjs [--src src/client] [--keep-open]
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? fallback : argv[index + 1]
}
const srcDir = join(root, flag('src', 'src/client'))

const CHATS = [
  { id: 'c1', title: '关于上下文组织的对话', ts: Date.now(), updatedAt: Date.now(), messageCount: 3 },
  { id: 'c2', title: '把英文翻译为通顺的中文', ts: Date.now() - 3_600_000, updatedAt: Date.now() - 3_600_000, messageCount: 6 },
  { id: 'c3', title: '总结这份文档的主要内容', ts: Date.now() - 86_400_000, updatedAt: Date.now() - 86_400_000, messageCount: 12 },
]

const scratch = mkdtempSync(join(root, '.tmp-dismiss-'))
let server = null
let browser = null

try {
  const entry = join(scratch, 'entry.tsx')
  writeFileSync(entry, `
    import { createElement } from 'react'
    import { createRoot } from 'react-dom/client'
    import { DSchatPanel } from ${JSON.stringify(join(srcDir, 'panel/DSchatPanel.tsx'))}
    import { zh } from ${JSON.stringify(join(srcDir, 'locales.ts'))}
    import { PANEL_CSS } from ${JSON.stringify(join(srcDir, 'panel/styles.ts'))}
    const pending = () => new Promise(() => undefined)
    const chats = ${JSON.stringify(CHATS)}
    function makeApi() {
      const ok = async (extra) => ({ ok: true, ...extra })
      return {
        state: async () => ok({ engine: 'ready', loggedIn: true, busy: false, deepThink: true, search: true,
          version: '0.6.4', chats, activeChatId: 'c1' }),
        chat: async () => ok({ chat: { ...chats[0], messages: [] } }),
        tail: async () => ok({ busy: false, streaming: false }),
        context: async () => ok({ workspaces: [], cwd: '/tmp', settings: {} }),
        attachmentUrl: () => '',
        wake: pending, newChat: pending, send: pending, attach: pending, stop: pending,
        openLogin: pending, closeBrowser: pending, setDeepThink: pending, setSearch: pending,
        transfer: pending, exportFile: pending, renameChat: pending, deleteChat: pending,
        clearChats: pending, webChats: pending, recover: pending, restore: pending, transferPreview: pending,
        /* The panel asks the HOST where the query appears (see the note above
           the filtered memo in the panel); the stub answers "nowhere", which is
           the honest answer for a stub with no message bodies. */
        searchConversations: async () => ok({ ids: [] }),
      }
    }
    window.__mount = () => {
      const style = document.createElement('style')
      style.textContent = PANEL_CSS
      document.head.appendChild(style)
      const tt = (key) => zh[key] ?? key
      createRoot(document.getElementById('seat')).render(createElement(DSchatPanel, {
        api: makeApi(), tt, t: tt,
        openSession: async () => true, pickDirectory: async () => null,
        createWorkspace: async () => ({ workspaceId: 'w', title: 'w' }),
      }))
    }
  `, 'utf8')
  const outfile = join(scratch, 'bundle.js')
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

  const tokens = readFileSync(join(root, 'refs/dsh-tokens.css'), 'utf8')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}</style>
<style>html,body{margin:0;height:100%;background:var(--dsw-alias-bg-base)}#seat{width:100%;height:100%}</style>
</head><body><div id="seat"></div>
<script>try{localStorage.setItem('dsh-dschat.rail.open','0')}catch(e){}</script>
<script>${readFileSync(outfile, 'utf8')}</script>
<script>window.__mount();</script></body></html>`
  writeFileSync(join(scratch, 'index.html'), html, 'utf8')

  server = createServer((request, response) => {
    const file = join(scratch, (request.url ?? '/').split('?')[0].replace(/^\//, '') || 'index.html')
    if (!existsSync(file)) { response.writeHead(404); response.end('nope'); return }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(readFileSync(file))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 620, height: 780 } })
  const failures = []
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'load' })
  await page.waitForSelector('.dsh-dschat-thread')

  const isOpen = () => page.evaluate(() => document.querySelector('.dsh-dschat-listpop') !== null)
  const check = (label, actual, expected) => {
    const ok = actual === expected
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: open=${actual} (expected ${expected})`)
    if (!ok) failures.push(`${label}: open=${actual}, expected ${expected}`)
  }
  const clickCenter = async (selector, dy = 0) => {
    const box = await page.locator(selector).boundingBox()
    if (box === null) throw new Error(`no box for ${selector}`)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + dy)
    await page.waitForTimeout(250)
  }

  check('initial', await isOpen(), false)

  await clickCenter('.dsh-dschat-tbtn-sessions')
  check('after pressing the trigger', await isOpen(), true)

  /*
   * Outside: the HEADER, which is the one part of the panel the popover can
   * never reach.
   *
   * This used to press the empty-state heading in the transcript, and that
   * stopped being "outside" the moment the list learned to fill its available
   * height: the popover now covers the transcript's upper half, so the press
   * landed INSIDE the menu and correctly did nothing. The test was measuring the
   * wrong thing; the anchor for "outside" has to be a region the popover is
   * structurally forbidden from occupying, and the header is it — the list opens
   * into the body and never above it.
   *
   * That invariant is asserted, not assumed: if the popover's top edge ever
   * climbs into the header, the geometry check below fails on the same run.
   */
  const geometry = await page.evaluate(() => {
    const pop = document.querySelector('.dsh-dschat-listpop')
    const header = document.querySelector('.dsh-dschat-header')
    if (pop === null || header === null) return null
    return { popTop: Math.round(pop.getBoundingClientRect().top), headerBottom: Math.round(header.getBoundingClientRect().bottom) }
  })
  const aboveHeader = geometry !== null && geometry.popTop >= geometry.headerBottom
  console.log(`${aboveHeader ? 'ok  ' : 'FAIL'} the popover stays below the header: popTop=${geometry?.popTop}, headerBottom=${geometry?.headerBottom}`)
  if (!aboveHeader) failures.push('the popover overlaps the header')

  await clickCenter('.dsh-dschat-brand-name')
  check('after pressing the header (outside)', await isOpen(), false)

  await clickCenter('.dsh-dschat-tbtn-sessions')
  check('after pressing the trigger again', await isOpen(), true)

  /* Inside: the search box must not dismiss its own menu. */
  await page.locator('.dsh-dschat-listpop .dsh-dschat-search input').click()
  await page.keyboard.type('翻译')
  await page.waitForTimeout(250)
  check('after typing in the popover search box', await isOpen(), true)
  const query = await page.inputValue('.dsh-dschat-listpop .dsh-dschat-search input')
  const rows = await page.locator('.dsh-dschat-listpop .dsh-dschat-item').count()
  console.log(`     search kept "${query}" and filtered to ${rows} row(s)`)

  /* Inside again: picking a row is a close, but by the row's own handler. */
  await page.locator('.dsh-dschat-listpop .dsh-dschat-search input').fill('')
  await page.waitForTimeout(200)
  await clickCenter('.dsh-dschat-listpop .dsh-dschat-item >> nth=0')
  check('after picking a conversation', await isOpen(), false)

  console.log(failures.length === 0 ? '\nall dismiss checks passed' : `\n${failures.length} FAILURE(S)`)
  for (const failure of failures) console.error(' -', failure)
  process.exitCode = failures.length === 0 ? 0 : 1
} finally {
  if (browser !== null) await browser.close()
  if (server !== null) server.close()
  rmSync(scratch, { recursive: true, force: true })
}
