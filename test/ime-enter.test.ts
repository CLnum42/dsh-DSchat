/**
 * Regression test for the composer's Enter key — and for the composer's height.
 *
 * Both check behaviour a static render cannot see, so they run in a real
 * Chromium: the panel's own components, mounted against a stub API, driven by
 * real DOM events.
 *
 * The Enter case is the reason this file exists. A Chinese/Japanese/Korean input
 * method commits its candidate with Enter, and the browser reports that keydown
 * with `isComposing: true` while `key` is still `'Enter'`. The composer used to
 * test `key`/`shiftKey` alone, so picking a pinyin candidate sent the
 * half-finished draft to the web model and cleared the box. The rule now mirrors
 * the host's own composer (`event.nativeEvent.isComposing`), and these tests
 * hold it there.
 *
 * Skipped, not failed, when Chrome is unavailable: the logic check aborts first
 * and needs no browser at all, and a machine without Chrome should still be able
 * to run the rest of the suite (the browser half of this plugin is optional).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * Bundle the panel (plus the export under test) into one ESM file.
 *
 * React stays external and the bundle is written INSIDE the package, so the
 * bundle and the test resolve the same React instance.
 */
async function loadPanelModule(): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(root, '.tmp-ime-test-'))
  const outfile = join(dir, 'panel.mjs')
  writeFileSync(join(dir, 'entry.tsx'), `
    export { DSchatPanel, submitsOnEnter } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
  `, 'utf8')
  await build({
    entryPoints: [join(dir, 'entry.tsx')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  })
  const module = await import(pathToFileURL(outfile).href)
  rmSync(dir, { recursive: true, force: true })
  return module as Record<string, unknown>
}

test('Enter submits, but not while an input method owns it', async () => {
  const { submitsOnEnter } = await loadPanelModule() as {
    submitsOnEnter: (event: {
      key: string
      shiftKey?: boolean
      isComposing?: boolean
      nativeEvent?: { isComposing?: boolean }
    }) => boolean
  }

  // The plain cases.
  assert.equal(submitsOnEnter({ key: 'Enter' }), true, 'a plain Enter sends')
  assert.equal(submitsOnEnter({ key: 'Enter', shiftKey: false }), true)
  assert.equal(submitsOnEnter({ key: 'Enter', shiftKey: true }), false, 'Shift+Enter is a newline')
  assert.equal(submitsOnEnter({ key: 'a' }), false)

  // The regression: an IME-confirming Enter (this is the shape Chromium sends
  // when Enter picks a pinyin candidate) must NOT submit.
  assert.equal(
    submitsOnEnter({ key: 'Enter', nativeEvent: { isComposing: true } }),
    false,
    'the native isComposing flag blocks the submit',
  )
  assert.equal(submitsOnEnter({ key: 'Enter', isComposing: true }), false, 'a proxied isComposing flag blocks it too')
  // ...and an explicitly-finished composition still sends.
  assert.equal(submitsOnEnter({ key: 'Enter', nativeEvent: { isComposing: false } }), true)
  // Shift+Enter stays a newline even where the composition flag is absent.
  assert.equal(submitsOnEnter({ key: 'Enter', shiftKey: true, nativeEvent: { isComposing: false } }), false)
})

test('the mounted panel neither sends on an IME Enter nor keeps the box at two lines', async (t) => {
  const { chromium } = await import('playwright-core')
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  } catch (error) {
    t.skip(`Chrome unavailable, browser half skipped: ${String(error)}`)
    return
  }

  const dir = mkdtempSync(join(root, '.tmp-ime-browser-'))
  try {
    writeFileSync(join(dir, 'entry.tsx'), `
      import { createElement } from 'react'
      import { createRoot } from 'react-dom/client'
      import { DSchatPanel } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
      import { zh } from ${JSON.stringify(join(root, 'src/client/locales.ts'))}
      import { PANEL_CSS } from ${JSON.stringify(join(root, 'src/client/panel/styles.ts'))}

      const now = Date.now()
      const state = {
        engine: 'ready', loggedIn: true, busy: false, deepThink: false, search: false,
        activeChatId: 'c1',
        chats: [{ id: 'c1', title: 't', createdAt: now, updatedAt: now, model: 'deepseek-chat', streaming: false,
          messages: [{ id: 'm1', role: 'user', content: 'hi', ts: now }] }],
      }
      window.__sent = []
      const ok = async (extra) => ({ ok: true, ...extra })
      const pending = () => new Promise(() => undefined)
      const api = {
        state: async () => ({ ok: true, ...state }),
        tail: async () => ok({ busy: false, streaming: false }),
        context: async () => ok({ workspaces: [], cwd: '/' }),
        send: async (text, images) => { window.__sent.push({ text, images }); return ok({ chatId: 'c1', stored: true }) },
        newChat: async () => ok({ chatId: 'c1' }), stop: pending, wake: pending, openLogin: pending, closeBrowser: pending,
        setDeepThink: pending, setSearch: pending, transfer: pending, exportFile: pending,
        renameChat: pending, deleteChat: pending, clearChats: pending, webChats: pending,
        recover: pending, restore: pending, attach: pending,
      }
      window.__mount = () => {
        const style = document.createElement('style')
        style.textContent = PANEL_CSS
        document.head.appendChild(style)
        const tt = (key) => zh[key] ?? key
        createRoot(document.getElementById('seat')).render(createElement(DSchatPanel, {
          api, tt, t: tt,
          openSession: async () => true,
          pickDirectory: async () => null,
          createWorkspace: async () => ({ workspaceId: 'w', title: 'w' }),
        }))
      }
    `, 'utf8')
    const outfile = join(dir, 'ui.mjs')
    await build({
      entryPoints: [join(dir, 'entry.tsx')],
      outfile,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      target: ['chrome120'],
      logLevel: 'silent',
    })

    const page = join(dir, 'index.html')
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8">
      <style>html,body{margin:0;height:100%}#seat{width:1100px;height:760px}</style></head>
      <body><div id="seat"></div>
      <script>${(await import('node:fs')).readFileSync(outfile, 'utf8')}</script>
      <script>window.__mount()</script></body></html>`, 'utf8')

    const view = await browser.newPage({ viewport: { width: 1100, height: 760 } })
    await view.goto(`file://${page}`, { waitUntil: 'load' })
    await view.waitForSelector('.dsh-dschat-input', { timeout: 15_000 })
    await view.waitForTimeout(400)

    const composerHeight = () => view.evaluate(() =>
      Math.round(document.querySelector('.dsh-dschat-input').getBoundingClientRect().height))

    // The empty box is its min-height, and a long draft grows it past two lines
    // while staying inside the cap. The min-height came down from 52px in the
    // v0.5 composer pass, which put every control on a 30px baseline and closed
    // the card up around its contents.
    const emptyHeight = await composerHeight()
    assert.ok(emptyHeight >= 44 && emptyHeight <= 50, `an empty composer is ~46px tall, measured ${emptyHeight}`)

    await view.locator('.dsh-dschat-input').fill(Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行`).join('\n'))
    await view.waitForTimeout(150)
    const grownHeight = await composerHeight()
    assert.ok(grownHeight > emptyHeight, `a 12-line draft grows the composer (${emptyHeight} -> ${grownHeight})`)
    assert.ok(grownHeight <= 181, `the composer never grows past its 180px cap, measured ${grownHeight}`)

    // An IME-confirming Enter: nothing may be sent and the draft must stay put.
    await view.locator('.dsh-dschat-input').fill('ni hao 你好')
    await view.waitForTimeout(80)
    await view.evaluate(() => {
      document.querySelector('.dsh-dschat-input').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', isComposing: true, bubbles: true, cancelable: true,
      }))
    })
    await view.waitForTimeout(250)
    const afterIme = await view.evaluate(() => ({
      sent: (window as unknown as { __sent: unknown[] }).__sent.length,
      draft: (document.querySelector('.dsh-dschat-input') as HTMLTextAreaElement).value,
    }))
    assert.equal(afterIme.sent, 0, 'an IME-confirming Enter must not send the message')
    assert.equal(afterIme.draft, 'ni hao 你好', 'the draft is untouched by an IME Enter')

    // Positive control: a plain Enter does send, with the text that was typed.
    await view.evaluate(() => {
      document.querySelector('.dsh-dschat-input').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', isComposing: false, bubbles: true, cancelable: true,
      }))
    })
    await view.waitForTimeout(250)
    const afterPlain = await view.evaluate(() => ({
      sent: (window as unknown as { __sent: Array<{ text: string }> }).__sent.length,
      last: (window as unknown as { __sent: Array<{ text: string }> }).__sent.at(-1)?.text ?? null,
      draft: (document.querySelector('.dsh-dschat-input') as HTMLTextAreaElement).value,
    }))
    assert.equal(afterPlain.sent, 1, 'a plain Enter sends exactly once')
    assert.equal(afterPlain.last, 'ni hao 你好', 'the plain Enter carries the typed text')
    assert.equal(afterPlain.draft, '', 'the composer clears after a real send')
  } finally {
    await browser.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
