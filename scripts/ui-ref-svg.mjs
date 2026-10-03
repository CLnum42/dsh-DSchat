/**
 * Fourth pass: lift the official inline SVGs verbatim (toggle pills, attach,
 * send, header toolbar) so the panel can reuse the real artwork instead of a
 * hand-drawn approximation.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRATCH = join(tmpdir(), 'dschat-ui-ref-profile')
const OUT = process.argv[2] ?? new URL('../.tmp-ui-ref/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const context = await chromium.launchPersistentContext(SCRATCH, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ['--no-proxy-server'],
})
const page = context.pages()[0] ?? (await context.newPage())
await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForSelector('.ds-toggle-button', { timeout: 45_000 })
await page.waitForTimeout(3_000)

const svgs = await page.evaluate(() => {
  const grab = (root) => [...(root?.querySelectorAll('svg') ?? [])]
    .map(svg => {
      // Strip the lottie wrapper's runtime bits: keep path/circle/rect geometry.
      const shapes = [...svg.querySelectorAll('path, circle, rect, line, polyline, polygon')]
        .map(shape => shape.outerHTML)
        .filter(html => html.length > 20)
        .join('')
      return shapes
    })
    .filter(Boolean)
  const out = {}
  const toggles = [...document.querySelectorAll('.ds-toggle-button')]
  out.deepThink = grab(toggles[0])
  out.search = grab(toggles[1])
  out.attach = grab(document.querySelector('svg path[d^="M5.5498"]')?.closest('div[class*="ds-button"]'))
  out.send = grab(document.querySelector('svg path[d^="M8.3125"]')?.closest('div[class*="ds-button"]'))
  // Header toolbar: the two icon buttons after the wordmark.
  const headerButtons = [...document.querySelectorAll('div[class*="ds-button"]')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.top < 60 && r.width > 20 })
  out.headerToolbar = headerButtons.map(grab)
  out.headerToolbarTitles = headerButtons.map(el => ({
    title: el.getAttribute('title') ?? el.querySelector('[title]')?.getAttribute('title') ?? '',
    aria: el.getAttribute('aria-label') ?? '',
    cls: el.className,
  }))
  return out
})
writeFileSync(join(OUT, 'svg.json'), JSON.stringify(svgs, null, 2), 'utf8')
console.log(JSON.stringify(svgs, null, 2).slice(0, 6000))
await context.close()
