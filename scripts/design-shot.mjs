/**
 * Screenshot the v0.5 design sheet, one PNG per section.
 *
 * Usage: node scripts/design-shot.mjs
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, '.tmp-design-v5')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 2 })
await page.goto(`file://${join(ROOT, 'docs/design-v0.5-ui.html')}`, { waitUntil: 'load' })
await page.waitForTimeout(400)

const shots = [
  ['01-新问题置顶.png', '#shot-anchor'],
  ['02-右侧提问导航.png', '#shot-nav'],
  ['03-输入区统一.png', '#shot-composer'],
  ['04-深色与总览-浅色.png', '#shot-dark', 'light'],
  ['04-深色与总览-深色.png', '#shot-dark', 'dark'],
]

for (const [name, selector, theme] of shots) {
  if (theme !== undefined) {
    await page.click(`[data-theme-btn="${theme}"]`)
    await page.waitForTimeout(250)
  }
  const el = await page.$(selector)
  await el.screenshot({ path: join(OUT, name) })
  console.log('[design] wrote', name)
}

await browser.close()
console.log('[design] done ->', OUT)
