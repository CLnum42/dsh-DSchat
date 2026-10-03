/**
 * Second pass over the official chat.deepseek.com UI: full computed styles for
 * the composer card, its toggle pills and the header toolbar icons, plus
 * high-DPI crops of each.
 */
import { chromium } from 'playwright-core'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC = join(homedir(), '.dsh', 'dsh-webchat', 'browser-profile')
const SCRATCH = join(tmpdir(), 'dschat-ui-ref-profile')
const OUT = process.argv[2] ?? new URL('../.tmp-ui-ref/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const context = await chromium.launchPersistentContext(SCRATCH, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  args: ['--no-proxy-server'],
})
const page = context.pages()[0] ?? (await context.newPage())
await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForSelector('textarea', { timeout: 45_000 })
await page.waitForTimeout(3_000)

const data = await page.evaluate(() => {
  const FULL = ['background', 'backgroundColor', 'backgroundImage', 'color', 'border', 'borderRadius', 'fontSize', 'fontWeight', 'padding', 'display', 'alignItems', 'gap', 'boxShadow', 'transition', 'outline', 'opacity', 'letterSpacing', 'lineHeight', 'height', 'width', 'margin', 'flex', 'justifyContent', 'cursor', 'position', 'overflow']
  const dump = (el, label) => {
    if (!el) return { label, missing: true }
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const style = {}
    for (const key of FULL) style[key] = cs[key]
    return {
      label,
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className : '',
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      style,
      text: (el.textContent ?? '').trim().slice(0, 30),
    }
  }
  const textarea = document.querySelector('textarea')
  const card = textarea.closest('[class]')?.parentElement?.parentElement?.parentElement ?? null
  // Walk every ancestor of the textarea, so the card is identified by geometry.
  const ancestors = []
  for (let el = textarea; el && el !== document.body; el = el.parentElement) ancestors.push(dump(el, 'ancestor'))
  const toggles = [...document.querySelectorAll('.ds-toggle-button')]
  const headerButtons = [...document.querySelectorAll('button, [role="button"], div[class*="ds-button"]')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.top < 60 && r.width > 0 })
    .map(el => dump(el, 'header'))
  return {
    ancestors,
    toggles: toggles.map(el => dump(el, 'toggle')),
    toggleOff: toggles.length > 1 ? dump(toggles[1], 'toggle2') : null,
    headerButtons,
    attach: dump(document.querySelector('svg path[d^="M5.5498"]')?.closest('div[class*="ds-button"]'), 'attach'),
    send: dump(document.querySelector('svg path[d^="M8.3125"]')?.closest('div[class*="ds-button"]'), 'send'),
  }
})
writeFileSync(join(OUT, 'styles.json'), JSON.stringify(data, null, 2), 'utf8')

// Crops (deviceScaleFactor 2 -> retina).
const shots = [
  ['10-composer-card.png', 'textarea >> xpath=ancestor::div[3]'],
  ['11-composer-toolrow.png', 'textarea >> xpath=ancestor::div[2]'],
  ['12-toggles.png', '.ds-toggle-button >> xpath=..'],
  ['13-header-tools.png', 'body'],
]
for (const [name, selector] of shots) {
  try {
    if (name === '13-header-tools.png') {
      await page.screenshot({ path: join(OUT, name), clip: { x: 0, y: 0, width: 300, height: 60 } })
      await page.screenshot({ path: join(OUT, '14-header-tools-right.png'), clip: { x: 1100, y: 0, width: 340, height: 60 } })
      continue
    }
    const el = await page.$(selector)
    if (el) await el.screenshot({ path: join(OUT, name) })
    else console.log('[ui-ref2] missing', name)
  } catch (error) {
    console.log('[ui-ref2] crop failed', name, String(error).slice(0, 120))
  }
}

console.log('[ui-ref2] composer ancestors:')
for (const a of data.ancestors) {
  console.log(`  ${JSON.stringify(a.rect)} r=${a.style.borderRadius} bg=${a.style.backgroundColor} img=${a.style.backgroundImage.slice(0, 60)} shadow=${a.style.boxShadow.slice(0, 70)} border=${a.style.border}`)
}
console.log('[ui-ref2] toggles:')
for (const t of data.toggles) console.log('  ', JSON.stringify(t.rect), t.style.backgroundColor, t.style.color, t.style.border, t.style.padding, t.style.gap, t.style.fontSize, t.style.fontWeight, t.text)
console.log('[ui-ref2] header buttons:')
for (const h of data.headerButtons) console.log('  ', JSON.stringify(h.rect), h.cls.slice(0, 80), h.style.color, h.style.backgroundColor)
await context.close()
