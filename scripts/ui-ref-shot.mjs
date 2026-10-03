/**
 * Reference shots of the OFFICIAL chat.deepseek.com UI.
 *
 * Purpose: the DSchat panel should reuse the web app's own composer widgets
 * (深度思考 / 智能搜索 / attach / send) and its top-right toolbar. This script
 * copies the logged-in browser profile to a scratch dir (the running plugin's
 * engine holds a lock on the original) and photographs the real page.
 *
 * Usage: node scripts/ui-ref-shot.mjs [outDir]   (default: .tmp-ui-ref/)
 */
import { chromium } from 'playwright-core'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC = join(homedir(), '.dsh', 'dsh-webchat', 'browser-profile')
const SCRATCH = join(tmpdir(), 'dschat-ui-ref-profile')
const OUT = process.argv[2] ?? new URL('../.tmp-ui-ref/', import.meta.url).pathname

rmSync(SCRATCH, { recursive: true, force: true })
console.log('[ui-ref] copying profile…')
cpSync(SRC, SCRATCH, { recursive: true, dereference: false })
for (const junk of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
  rmSync(join(SCRATCH, junk), { force: true })
}
mkdirSync(OUT, { recursive: true })

const context = await chromium.launchPersistentContext(SCRATCH, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ['--no-proxy-server'],
})
const page = context.pages()[0] ?? (await context.newPage())
await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 })

// The composer is the readiness signal: the app hydrates its editor last.
try {
  await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 45_000 })
} catch (error) {
  console.log('[ui-ref] composer never appeared:', String(error).slice(0, 200))
  await page.screenshot({ path: join(OUT, '00-not-ready.png') })
}
await page.waitForTimeout(4_000)
await page.screenshot({ path: join(OUT, '01-page.png') })

// Measured geometry of everything that matters, plus the computed styles the
// panel has to reproduce. Dumped as JSON so the panel's CSS can be written
// against numbers instead of guesses.
const report = await page.evaluate(() => {
  /** Short descriptor for one element. */
  const describe = (el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 120),
      text: (el.textContent ?? '').trim().slice(0, 40),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      style: {
        background: cs.background || cs.backgroundColor,
        color: cs.color,
        border: cs.border,
        borderRadius: cs.borderRadius,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        padding: cs.padding,
        display: cs.display,
        alignItems: cs.alignItems,
        gap: cs.gap,
        boxShadow: cs.boxShadow,
        opacity: cs.opacity,
        height: cs.height,
        width: cs.width,
      },
      svg: el.querySelector('svg')?.outerHTML?.slice(0, 1200) ?? null,
    }
  }
  const buttons = [...document.querySelectorAll('button, [role="button"]')]
    .map(describe)
    .filter(b => b.rect.w > 0)
  const editables = [...document.querySelectorAll('textarea, [contenteditable="true"]')].map(describe)
  /*
   * DeepSeek's icons are often inline <svg> inside a div (not a button), so the
   * whole composer neighbourhood is dumped as a subtree with its geometry.
   */
  const composerRoot = editables[0]
    ? document.querySelector('textarea, [contenteditable="true"]')?.closest('div[class]')?.parentElement?.parentElement
    : null
  const subtree = composerRoot
    ? [...composerRoot.querySelectorAll('*')].slice(0, 200).map(el => ({
        ...describe(el),
        html: el.children.length === 0 ? el.outerHTML.slice(0, 1500) : undefined,
      }))
    : []
  return { buttons, editables, subtree, title: document.title, url: location.href }
})
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

console.log('[ui-ref] title:', report.title)
console.log('[ui-ref] url:', report.url)
console.log('[ui-ref] buttons:')
for (const b of report.buttons) {
  console.log(`  ${JSON.stringify(b.rect)} ${b.text.slice(0, 20).padEnd(22)} ${b.cls.slice(0, 60)}`)
}

await context.close()
console.log('[ui-ref] done ->', OUT)
