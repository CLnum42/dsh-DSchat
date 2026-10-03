/**
 * Render the DSchat mark against the HOST's own icons at the sizes they are
 * actually drawn at, so the stroke weight can be judged instead of guessed.
 *
 * The host draws a plugin's `icon.svg` at 30px in a plugin-list row and 36px on
 * a plugin card (`ROW_ARTWORK_SIZE` / `CARD_ARTWORK_SIZE` in the plugin
 * manager); its sidebar glyphs are the primitives' outline icons at 16/18px,
 * stroked at `ICON_REGULAR_STROKE = 1` / `ICON_MEDIUM_STROKE = 1.3` on a 16-box.
 *
 * Usage: node scripts/ui-icon-check.mjs [out.png]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

// `new URL(...).pathname` is percent-encoded, and this checkout lives under a
// path with spaces (「dsh 工作区」) — decode before touching the filesystem.
const root = decodeURIComponent(new URL('..', import.meta.url).pathname)
const out = process.argv[2] ?? `${root}.tmp-ui-ref/icon-check.png`
mkdirSync(dirname(out), { recursive: true })

/** Verbatim `IconPluginPinwheelOutlineArtwork` (host primitives), 16-box. */
const PINWHEEL = `
  <path d="M7.84457 5.06199C11.6605 4.93876 14.7962 6.14848 14.8484 7.76397C14.8875 8.97461 13.1838 10.0696 10.7215 10.5942"/>
  <path d="M5.12742 8.07731C5.00419 4.26138 6.21391 1.12568 7.8294 1.07351C9.04004 1.03441 10.135 2.73808 10.6596 5.20037"/>
  <path d="M8.02457 10.6802C4.20865 10.8034 1.07294 9.5937 1.02077 7.97821C0.981678 6.76758 2.68535 5.67262 5.14763 5.14798"/>
  <path d="M10.7476 7.89535C10.8708 11.7113 9.66109 14.847 8.0456 14.8991C6.83496 14.9382 5.74 13.2346 5.21536 10.7723"/>`

/** Verbatim `IconSearchOutlineArtwork`-shaped host glyph, 16-box, 1.3 stroke. */
const HOST_FOLDER = `<path d="M1.8 4.4a1.6 1.6 0 0 1 1.6-1.6h2.3l1.5 1.7h5.8a1.6 1.6 0 0 1 1.6 1.6v5.1a1.6 1.6 0 0 1-1.6 1.6H3.4a1.6 1.6 0 0 1-1.6-1.6z"/>`

/** The mark as ChatIcon draws it (16-box, 1.25 stroke). */
const CHAT = `
  <path d="M3.1 3.6h9.8a1.3 1.3 0 0 1 1.3 1.3v5.3a1.3 1.3 0 0 1-1.3 1.3H7.5l-3.1 2.6v-2.6H3.1a1.3 1.3 0 0 1-1.3-1.3V4.9a1.3 1.3 0 0 1 1.3-1.3Z"/>
  <path d="M5.5 6.6h5.4M5.5 9h3.2"/>`

const packageIcon = readFileSync(`${root}icon.svg`, 'utf8').replace(/^<\?xml[^>]*\?>/, '')
const oldIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect x="4" y="4" width="56" height="56" rx="16" fill="#0f1115"/>
  <path d="M16 21h32v20H31l-9 7v-7h-6z" fill="none" stroke="#f9fafb" stroke-width="4"/>
  <path d="M24 28h16M24 35h9" stroke="#f9fafb" stroke-width="4" stroke-linecap="round"/>
</svg>`

const hostIcon = (size, stroke) =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${PINWHEEL}</svg>`

/** One column of the comparison table. */
function cell(label, inner, background = 'transparent') {
  return `<figure style="background:${background}"><div class="stage">${inner}</div><figcaption>${label}</figcaption></figure>`
}

const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; padding:28px; font:12px/1.5 -apple-system,"PingFang SC",sans-serif;
         background:#0f1115; color:#e6e8eb; }
  h2 { font-size:13px; font-weight:600; margin:0 0 14px; color:#9aa4b2; letter-spacing:.04em; }
  .row { display:flex; gap:26px; align-items:flex-start; margin-bottom:30px; flex-wrap:wrap; }
  figure { margin:0; text-align:center; }
  .stage { height:64px; display:grid; place-items:center; }
  figcaption { margin-top:6px; color:#7d8794; font-size:11px; }
  svg { color:#e6e8eb; }
  img { display:block; }
</style>

<h2>插件列表里的包图标（host 按 30px 行内 / 36px 卡片渲染）</h2>
<div class="row">
  ${cell('旧 icon.svg @30', `<img src="data:image/svg+xml;utf8,${encodeURIComponent(oldIcon)}" width="30" height="30">`)}
  ${cell('新 icon.svg @30', `<img src="data:image/svg+xml;utf8,${encodeURIComponent(packageIcon)}" width="30" height="30">`)}
  ${cell('新 icon.svg @36', `<img src="data:image/svg+xml;utf8,${encodeURIComponent(packageIcon)}" width="36" height="36">`)}
  ${cell('host 默认插件图案 @30', `<svg viewBox="0 0 36 36" width="30" height="30"><rect x="6" y="6" width="24" height="24" rx="7" fill="#4b5563"/><circle cx="18" cy="18" r="4" fill="#e6e8eb"/></svg>`)}
</div>

<h2>侧边栏导航（16 / 18px，与 host 图标同列）</h2>
<div class="row">
  ${cell('host 插件 pinwheel @16', hostIcon(16, 1.3))}
  ${cell('host 文件夹 @16', `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">${HOST_FOLDER}</svg>`)}
  ${cell('新 ChatIcon @16', `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${CHAT}</svg>`)}
  ${cell('新 ChatIcon @18', `<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${CHAT}</svg>`)}
  ${cell('空会话水印 @22', `<svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${CHAT}</svg>`)}
  ${cell('旧 ChatIcon @16（1.4）', `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/><path d="M5.5 6.5h5M5.5 8.6h3"/></svg>`)}
</div>

<h2>浅色主题下的侧边栏（同一行对比）</h2>
<div class="row" style="background:#f7f8fa; color:#1f2328; padding:16px; border-radius:12px; flex-wrap:nowrap;">
  ${cell('host pinwheel @16', hostIcon(16, 1.3))}
  ${cell('host 文件夹 @16', `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">${HOST_FOLDER}</svg>`)}
  ${cell('新 ChatIcon @16', `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${CHAT}</svg>`)}
  ${cell('新 icon.svg @30', `<img src="data:image/svg+xml;utf8,${encodeURIComponent(packageIcon)}" width="30" height="30">`)}
  ${cell('旧 icon.svg @30', `<img src="data:image/svg+xml;utf8,${encodeURIComponent(oldIcon)}" width="30" height="30">`)}
</div>
<div class="row" style="background:#f7f8fa; color:#1f2328; padding:16px; border-radius:12px; flex-wrap:nowrap;">
  <figcaption style="color:#1f2328;font-weight:600">深色主题（同一张表在 host 深色侧边栏里的样子）</figcaption>
</div>
<div class="row" style="background:#0f1115; padding:16px; border-radius:12px; flex-wrap:nowrap;">
  ${cell('host pinwheel @16', hostIcon(16, 1.3))}
  ${cell('新 ChatIcon @16', `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${CHAT}</svg>`)}
  ${cell('新 icon.svg @30', `<img src="data:image/svg+xml;utf8,${encodeURIComponent(packageIcon)}" width="30" height="30">`)}
  ${cell('新 icon.svg @36', `<img src="data:image/svg+xml;utf8,${encodeURIComponent(packageIcon)}" width="36" height="36">`)}
  ${cell('旧 icon.svg @30', `<img src="data:image/svg+xml;utf8,${encodeURIComponent(oldIcon)}" width="30" height="30">`)}
</div>
`

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 3 })
await page.setContent(html, { waitUntil: 'load' })
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log('icon comparison -> ' + out)
