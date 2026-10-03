/**
 * Does `--dsw-static-deepseek-500` resolve inside the harness's own theme sheet?
 *
 * The toggle-on pill asked for it (the page's #4176e6 blue) and the computed
 * label colour came back as `label-primary`, i.e. the declaration was dropped.
 * A custom property whose fallback is not taken still yields `color: ` — invalid
 * at computed-value time — so the value must simply not be defined where the
 * panel sits. This proves which of the two it is.
 */
import { chromium } from 'playwright-core'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(root, '.tmp-token-'))
const tokens = readFileSync(join(root, 'refs/dsh-tokens.css'), 'utf8')
const page = join(dir, 'index.html')
writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8">
<style>${tokens}</style></head><body>
<div id="probe"></div>
</body></html>`, 'utf8')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const view = await browser.newPage()
await view.goto(`file://${page}`, { waitUntil: 'load' })
const result = await view.evaluate(() => {
  const names = [
    '--dsw-static-deepseek-50', '--dsw-static-deepseek-100', '--dsw-static-deepseek-300',
    '--dsw-static-deepseek-400', '--dsw-static-deepseek-450', '--dsw-static-deepseek-500',
    '--dsw-static-deepseek-600', '--dsw-static-deepseek-800',
    '--dsw-alias-state-business-primary', '--dsw-alias-label-primary',
    '--dsw-alias-label-deep-diving', '--dsw-alias-label-deep-diving-shimmer',
  ]
  const el = document.getElementById('probe')
  const out = {}
  for (const name of names) {
    // Serialize through a color so an invalid value shows up as a failure to
    // round-trip rather than as a raw string.
    el.style.color = ''
    el.style.color = `var(${name})`
    const declared = el.style.color
    const computed = getComputedStyle(el).color
    out[name] = { declared, computed, atBody: getComputedStyle(document.body).getPropertyValue(name).trim() }
  }
  return out
})
console.log(JSON.stringify(result, null, 2))
await browser.close()
rmSync(dir, { recursive: true, force: true })
