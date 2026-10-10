/**
 * Reference shots of an EXISTING multi-turn chat on chat.deepseek.com.
 *
 * Purpose: photograph the official page's right-edge "question navigator"
 * (the per-turn tick rail the user asked the panel to copy) so the v0.5 panel
 * can be designed against the real thing instead of a guess.
 *
 * Usage: node scripts/ui-ref-turns.mjs [outDir]   (default: .tmp-ui-turns/)
 */
import { chromium } from 'playwright-core'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(homedir(), '.dsh', 'dsh-webchat', 'browser-profile')
const SCRATCH = join(tmpdir(), 'dschat-ui-turns-profile')
const OUT = process.argv[2] ?? fileURLToPath(new URL('../.tmp-ui-turns/', import.meta.url))

rmSync(SCRATCH, { recursive: true, force: true })
console.log('[turns] copying profile…')
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
await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 45_000 })
await page.waitForTimeout(3_000)

// Click a conversation that is likely long. The sidebar rows are plain text
// nodes; the pinned "AI翻译研究生能力培养" one is a known multi-turn thread.
const titles = ['AI翻译研究生能力培养', 'DSH插件开发介绍', '居住选择建议']
let clicked = null
for (const title of titles) {
  const target = page.locator(`text=${title}`).first()
  if (await target.count() > 0) {
    await target.click({ timeout: 5_000 }).catch(() => {})
    clicked = title
    break
  }
}
console.log('[turns] clicked:', clicked)
await page.waitForTimeout(6_000)

const report = await page.evaluate(() => {
  const vw = innerWidth
  const describe = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 100),
      text: (el.textContent ?? '').trim().slice(0, 60),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      style: {
        background: cs.backgroundColor, color: cs.color, borderRadius: cs.borderRadius,
        opacity: cs.opacity, position: cs.position, display: cs.display, height: cs.height, width: cs.width,
      },
    }
  }
  // Anything living in the right-hand 140px gutter, plus anything that looks
  // like a tick rail (a narrow, tall box with several similar children).
  const right = [...document.querySelectorAll('body *')]
    .filter(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.x + r.width > vw - 140
    })
    .slice(0, 120)
    .map(el => ({ ...describe(el), childCount: el.children.length }))
  const rails = [...document.querySelectorAll('body *')]
    .filter(el => {
      const r = el.getBoundingClientRect()
      return el.children.length >= 3 && r.height > 120 && r.width < 80 && r.x + r.width > vw - 160
    })
    .map(el => ({ ...describe(el), childCount: el.children.length, children: [...el.children].slice(0, 30).map(c => describe(c)) }))
  return { url: location.href, title: document.title, vw, right, rails }
})
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

await page.screenshot({ path: join(OUT, '01-thread.png') })
await page.screenshot({ path: join(OUT, '02-thread-right-edge.png'), clip: { x: 1440 - 160, y: 0, width: 160, height: 900 } })
await page.screenshot({ path: join(OUT, '03-thread-full.png'), fullPage: true })

// Hover the rail (if any) so its tooltip/preview state is captured too.
if (report.rails.length > 0) {
  const first = report.rails[0]
  await page.mouse.move(first.rect.x + first.rect.w / 2, Math.min(880, first.rect.y + 60))
  await page.waitForTimeout(1_200)
  await page.screenshot({ path: join(OUT, '04-hover.png') })
}
console.log('[turns] rails:', report.rails.length)
for (const rail of report.rails) {
  console.log(`  rail ${JSON.stringify(rail.rect)} cls=${rail.cls} children=${rail.childCount}`)
}
await context.close()
console.log('[turns] done ->', OUT)
