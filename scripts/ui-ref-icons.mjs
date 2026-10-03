/**
 * Render the official composer icons large, so the panel's own artwork can be
 * checked against the real thing before it is written into icons.tsx.
 *
 * Usage: node scripts/ui-ref-icons.mjs [out.png]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const out = process.argv[2] ?? new URL('../.tmp-ui-ref/icons.png', import.meta.url).pathname
mkdirSync(dirname(out), { recursive: true })

// Verbatim from the live page (scripts/ui-ref-svg.mjs), coordinates rounded to
// two decimals because that is the precision the panel's own icons use.
const DEEP_THINK = `
  <circle cx="8" cy="8" r="1.23" fill="currentColor" stroke="none"/>
  <path d="M10.51 10.51C7.3 13.71 3.58 15.19 2.2 13.8 0.81 12.42 2.29 8.7 5.49 5.49 8.7 2.29 12.42 .81 13.8 2.2 15.19 3.58 13.71 7.3 10.51 10.51Z"/>
  <path d="M10.73 5.27C13.94 8.47 15.31 12.29 13.8 13.8 12.29 15.31 8.48 13.94 5.27 10.73 2.07 7.53 .69 3.71 2.2 2.2 3.71 .69 7.53 2.06 10.73 5.27Z"/>`

const WEB_SEARCH = `
  <path d="M8 14.85C9.6 14.85 10.89 11.78 10.89 8 10.89 4.22 9.6 1.15 8 1.15"/>
  <path d="M8 14.85C6.4 14.85 5.11 11.78 5.11 8 5.11 4.22 6.4 1.15 8 1.15"/>
  <circle cx="8" cy="8" r="6.85"/>
  <path d="M1.64 8h12.72"/>`

const ATTACH = `<path fill="currentColor" stroke="none" d="M5.55 9.75V5h1.4v4.75a1.05 1.05 0 0 0 2.1 0V4.5a2.8 2.8 0 1 0-5.6 0v5.25a4.55 4.55 0 0 0 9.1 0V4h1.4v5.75a5.95 5.95 0 0 1-11.9 0V4.5a4.2 4.2 0 1 1 8.4 0v5.25a2.45 2.45 0 0 1-4.9 0Z"/>`
const SEND = `<path fill="currentColor" stroke="none" d="M8.31.98a2.5 2.5 0 0 1 .95.45c.22.18.47.43.72.68l4.73 4.72-1.42 1.42L9 3.96v11.08H7V3.96L2.71 8.25 1.29 6.83l4.73-4.72c.25-.25.5-.5.72-.68a2.5 2.5 0 0 1 .95-.45 2.3 2.3 0 0 1 .62 0Z"/>`

const html = `<!doctype html><meta charset="utf-8">
<style>
 body { margin:0; background:#151517; color:#f9fafb; font:14px -apple-system,sans-serif; display:flex; gap:40px; padding:28px 36px; }
 .cell { display:flex; flex-direction:column; align-items:center; gap:10px; }
 .box { width:96px; height:96px; display:grid; place-items:center; border:1px solid #3a3a3f; border-radius:20px; }
 .box.on { background:#283142; border-color:#4868b2; color:#679efe; }
 .box.off { background:#2d3546cc; border-color:#4e6db5cd; color:#f9fafb; }
 .box.plain { border:none; }
 svg { display:block; }
 .label { font-size:12px; color:#a1a1aa; }
</style>
<div class="cell"><div class="box off"><svg width="64" height="64" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${DEEP_THINK}</svg></div><div class="label">deepThink off</div></div>
<div class="cell"><div class="box on"><svg width="64" height="64" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${DEEP_THINK}</svg></div><div class="label">deepThink on</div></div>
<div class="cell"><div class="box off"><svg width="64" height="64" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${WEB_SEARCH}</svg></div><div class="label">search off</div></div>
<div class="cell"><div class="box on"><svg width="64" height="64" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${WEB_SEARCH}</svg></div><div class="label">search on</div></div>
<div class="cell"><div class="box plain"><svg width="64" height="64" viewBox="0 0 16 16" fill="none">${ATTACH}</svg></div><div class="label">attach</div></div>
<div class="cell"><div class="box plain"><svg width="64" height="64" viewBox="0 0 16 16" fill="none">${SEND}</svg></div><div class="label">send</div></div>
`

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 940, height: 220 }, deviceScaleFactor: 2 })
await page.setContent(html)
await page.screenshot({ path: out })
await browser.close()
console.log('[ui-ref-icons] wrote', out)
