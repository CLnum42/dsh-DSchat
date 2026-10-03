/**
 * Render the UI prototype and photograph every scene the control bar can put it in.
 *
 * Usage: node prototype/shot.mjs prototype/dsh-DSchat-prototype.html
 *
 * Output goes to the gitignored scratch dir `prototype/.tmp-shot/`. The curated
 * set that is actually committed (and referenced by prototype/README.md) lives in
 * `prototype/screenshots/` as 1600px WebP.
 *
 * `playwright-core` resolves from this package's own node_modules; there is no
 * machine-specific absolute path anywhere in this file.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('./.tmp-shot/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const url = 'file://' + encodeURI(process.argv[2])
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const shot = name => page.screenshot({ path: join(OUT, name) })
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', e => errs.push('pageerror: ' + e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(300)
await shot('shot-1-light.png')

await page.click('#pt-hover')
await page.waitForTimeout(150)
await shot('shot-2-hover.png')

await page.click('#pt-dark')
await page.click('#ds-transfer')
await page.waitForTimeout(220)
await shot('shot-3-transfer.png')

await page.click('#ds-go')
await page.waitForTimeout(1250)
await shot('shot-4-progress.png')

await page.waitForTimeout(1600)
await page.click('#pt-light')
await page.waitForTimeout(300)
await shot('shot-5-toast.png')

await page.click('#pt-empty')
await page.waitForTimeout(200)
await shot('shot-6-empty.png')

await page.click('#pt-error')
await page.click('.ds-item:nth-child(1) .ds-item-main')
await page.waitForTimeout(200)
await page.click('#pt-error')
await page.waitForTimeout(200)
await shot('shot-7-error.png')

await page.fill('#ds-input', '迁移到 harness 之后，新会话的上下文要怎么组织比较好？')
await page.click('#ds-send')
await page.waitForTimeout(600)
await shot('shot-8-streaming.png')

// narrow-window check
await page.setViewportSize({ width: 1040, height: 780 })
await page.waitForTimeout(250)
await shot('shot-9-narrow.png')

// narrow drawer opened
await page.click("#ds-rail-toggle")
await page.waitForTimeout(250)
await shot("shot-10-drawer.png")
// dark, wide, rail reset
await page.setViewportSize({ width: 1440, height: 900 })
await page.click("#pt-dark")
await page.waitForTimeout(250)
await shot("shot-11-dark.png")
console.log('errors:', errs.length ? errs : 'none')
console.log('shots ->', OUT)
await browser.close()
