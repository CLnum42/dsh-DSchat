/**
 * Third pass: the pieces the second pass could not show.
 *
 *   1. the toggle pills in their OFF state (both official toggles launch
 *      selected, so the off treatment has to be observed, restored afterwards);
 *   2. the same widgets in dark mode, which is the mode most DSH users run;
 *   3. a zoomed crop of one pill, to read the icon shapes.
 *
 * The toggles are clicked and then clicked back, so the account's stored
 * preference ends where it started.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRATCH = join(tmpdir(), 'dschat-ui-ref-profile')
const OUT = process.argv[2] ?? new URL('../.tmp-ui-ref/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const context = await chromium.launchPersistentContext(SCRATCH, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  args: ['--no-proxy-server'],
})
const page = context.pages()[0] ?? (await context.newPage())
await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForSelector('.ds-toggle-button', { timeout: 45_000 })
await page.waitForTimeout(3_000)

const probe = async (tag) => page.evaluate((tag) => {
  const read = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      cls: typeof el.className === 'string' ? el.className : '',
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      bg: cs.backgroundColor, color: cs.color, border: cs.border, radius: cs.borderRadius,
      padding: cs.padding, gap: cs.gap, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
    }
  }
  const textarea = document.querySelector('textarea')
  const card = textarea?.closest('div[style], div[class]')?.parentElement?.parentElement?.parentElement
  return {
    tag,
    toggles: [...document.querySelectorAll('.ds-toggle-button')].map(read),
    card: read(card),
    send: read(document.querySelector('svg path[d^="M8.3125"]')?.closest('div[class*="ds-button"]')),
    attach: read(document.querySelector('svg path[d^="M5.5498"]')?.closest('div[class*="ds-button"]')),
    pageBg: getComputedStyle(document.body).backgroundColor,
  }
}, tag)

const darkOn = await probe('dark-on')
await page.screenshot({ path: join(OUT, '20-dark-composer.png'), clip: { x: 455, y: 380, width: 790, height: 135 } })

// Off state: click 深度思考 off, photograph, click back on.
const first = page.locator('.ds-toggle-button').first()
await first.click()
await page.waitForTimeout(600)
const darkOff = await probe('dark-off')
await page.screenshot({ path: join(OUT, '21-dark-toggle-off.png'), clip: { x: 465, y: 455, width: 400, height: 50 } })
await first.click()
await page.waitForTimeout(600)
const restored = await probe('dark-restored')
await page.screenshot({ path: join(OUT, '22-dark-toggle-on.png'), clip: { x: 465, y: 455, width: 400, height: 50 } })

await page.emulateMedia({ colorScheme: 'light' })
await page.waitForTimeout(800)
await page.screenshot({ path: join(OUT, '23-light-composer.png'), clip: { x: 455, y: 380, width: 790, height: 135 } })

console.log(JSON.stringify({ darkOn, darkOff, restored }, null, 2))
await context.close()
