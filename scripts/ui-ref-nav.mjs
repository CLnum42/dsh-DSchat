/**
 * Close-up study of the official right-edge question navigator.
 *
 * Usage: node scripts/ui-ref-nav.mjs [outDir]
 */
import { chromium } from 'playwright-core'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(homedir(), '.dsh', 'dsh-webchat', 'browser-profile')
const SCRATCH = join(tmpdir(), 'dschat-ui-nav-profile')
const OUT = process.argv[2] ?? fileURLToPath(new URL('../.tmp-ui-nav/', import.meta.url))

rmSync(SCRATCH, { recursive: true, force: true })
cpSync(SRC, SCRATCH, { recursive: true, dereference: false })
for (const junk of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) rmSync(join(SCRATCH, junk), { force: true })
mkdirSync(OUT, { recursive: true })

const context = await chromium.launchPersistentContext(SCRATCH, {
  channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 }, args: ['--no-proxy-server'],
})
const page = context.pages()[0] ?? (await context.newPage())
await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 45_000 })
await page.waitForTimeout(3_000)
await page.locator('text=AI翻译研究生能力培养').first().click({ timeout: 5_000 }).catch(() => {})
await page.waitForTimeout(6_000)

// The navigator is the fixed 34px-wide box hugging the right edge.
const nav = page.locator('div').filter({ has: page.locator('div[class]') }).nth(0)
const box = await page.evaluateHandle(() => {
  const fixed = [...document.querySelectorAll('div')].filter(el => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return cs.position === 'fixed' && r.width === 34 && r.height > 100
  })
  return fixed[0] ?? null
})
const rect = await box.evaluate(el => el === null ? null : (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })())
console.log('[nav] box:', JSON.stringify(rect))

const rows = await page.evaluate(() => {
  const fixed = [...document.querySelectorAll('div')].find(el => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return cs.position === 'fixed' && r.width === 34 && r.height > 100
  })
  if (!fixed) return []
  // Rows are the 16x20 flex boxes that each hold one 2px dash.
  const items = [...fixed.querySelectorAll('div')].filter(el => {
    const r = el.getBoundingClientRect()
    return Math.round(r.width) === 16 && Math.round(r.height) === 20
  })
  return items.map((item, index) => {
    const r = item.getBoundingClientRect()
    const dash = item.querySelector('div')
    const cs = dash ? getComputedStyle(dash) : null
    return {
      index,
      text: (item.getAttribute('aria-label') ?? item.textContent ?? '').trim().slice(0, 200),
      title: item.getAttribute('title'),
      role: item.getAttribute('role'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      dash: cs ? { w: cs.width, h: cs.height, bg: cs.backgroundColor, radius: cs.borderRadius, opacity: cs.opacity } : null,
      html: item.outerHTML.slice(0, 600),
    }
  })
})
writeFileSync(join(OUT, 'rows.json'), JSON.stringify({ rect, rows }, null, 2), 'utf8')
console.log('[nav] rows:', rows.length)
for (const row of rows) console.log(`  #${row.index} y=${row.rect.y} dash=${JSON.stringify(row.dash)} label=${row.text.slice(0, 40)}`)

// Hover the third tick and photograph whatever preview appears.
if (rows.length > 3) {
  await page.mouse.move(rows[3].rect.x + rows[3].rect.w / 2, rows[3].rect.y + rows[3].rect.h / 2)
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: join(OUT, '01-hover.png') })
  await page.screenshot({ path: join(OUT, '01-hover-zoom.png'), clip: { x: 1040, y: 0, width: 400, height: 900 } })
  const tooltip = await page.evaluate(() => {
    const els = [...document.querySelectorAll('body *')].filter(el => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 60 && r.width < 420 && r.height > 20 && r.height < 200 && r.x > 1000 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5 && (el.textContent ?? '').trim().length > 4
    })
    return els.slice(0, 12).map(el => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
        text: (el.textContent ?? '').trim().slice(0, 160),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        style: { background: cs.backgroundColor, color: cs.color, radius: cs.borderRadius, shadow: cs.boxShadow, fontSize: cs.fontSize, padding: cs.padding },
      }
    })
  })
  writeFileSync(join(OUT, 'tooltip.json'), JSON.stringify(tooltip, null, 2), 'utf8')
  console.log('[nav] hover candidates:', tooltip.length)
}

// Click a tick and watch the transcript scroll.
if (rows.length > 2) {
  const before = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 300)
    return scroller ? scroller.scrollTop : null
  })
  await page.mouse.click(rows[2].rect.x + rows[2].rect.w / 2, rows[2].rect.y + rows[2].rect.h / 2)
  await page.waitForTimeout(1_200)
  const after = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 300)
    return scroller ? scroller.scrollTop : null
  })
  console.log('[nav] click jump scrollTop:', before, '->', after)
  await page.screenshot({ path: join(OUT, '02-after-jump.png') })
}

await context.close()
console.log('[nav] done ->', OUT)
