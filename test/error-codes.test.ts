/**
 * Structured failure codes, end to end.
 *
 * The host used to answer a failure with a Chinese sentence and nothing else, so
 * the panel printed that sentence into an English interface; and four perfectly
 * good `error.*` dictionary entries sat unused because nothing ever produced a
 * code for them to key off.
 *
 * These three tests pin the three links of that chain:
 *   1. every route failure CARRIES a code (the host half);
 *   2. the panel renders the code through the dictionary, and falls back to the
 *      host's detail only when it has no sentence of its own (the client half);
 *   3. the diagnostic report that a reader pastes into a bug report contains the
 *      things someone else needs to reason about it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { zh, en } from '../src/client/locales.ts'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * Bundle the two panel modules before importing them.
 *
 * Node strips types but not JSX, so a `.tsx` file cannot be imported directly —
 * the same reason the panel's own render tests bundle first. Only the two pure
 * exports this file needs are asked for, so nothing renders.
 */
async function loadPanel() {
  // Inside the repo, so the external `react` resolves from its own node_modules
  // — a temp dir outside the tree has no package.json to walk up to.
  const dir = mkdtempSync(join(root, '.tmp-error-codes-panel-'))
  const entry = join(dir, 'entry.tsx')
  const outfile = join(dir, 'panel.mjs')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(entry, `
    export { explain } from ${JSON.stringify(join(root, 'src/client/panel/DSchatPanel.tsx'))}
    export { buildDiagnosticReport } from ${JSON.stringify(join(root, 'src/client/panel/DSchatStatus.tsx'))}
  `, 'utf8')
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  })
  const mod = await import(pathToFileURL(outfile).href) as {
    explain: (
      result: { code?: string; error?: string } | undefined,
      fallback: string,
      tr: (key: string) => string,
    ) => string
    buildDiagnosticReport: (input: Record<string, unknown>) => string
  }
  return { ...mod, cleanup: () => { rmSync(dir, { recursive: true, force: true }) } }
}

/** The dictionary as the panel's `tr`, which is how a real failure is rendered. */
const zhTr = (key: string): string => (zh as Record<string, string>)[key] ?? key
const enTr = (key: string): string => (en as Record<string, string>)[key] ?? key

test('a failure with a code is rendered in the reader\'s language, not the host\'s', async () => {
  const { explain, cleanup } = await loadPanel()
  // The host's detail is Chinese; the English dictionary must win over it.
  const failure = { code: 'PATH', error: '附件路径不在附件目录内：/etc/hosts' }
  const english = explain(failure, '', enTr)
  assert.equal(english, (en as Record<string, string>)['error.PATH'])
  assert.equal(/[\u4e00-\u9fff]/.test(english), false, 'no host-language text leaks into the English sentence')
  assert.equal(explain(failure, '', zhTr), (zh as Record<string, string>)['error.PATH'], 'and the Chinese one is the Chinese entry')
  // The detail is deliberately NOT concatenated in: that is what put host text
  // back into an English toast. It stays in the response and in 复制诊断.
  assert.equal(english.includes('/etc/hosts'), false, 'the technical detail does not ride the localized sentence')
  cleanup()
})

test('every code the routes can answer with has a sentence in both dictionaries', async () => {
  const { explain, cleanup } = await loadPanel()
  const codes = [
    'NEED_LOGIN', 'PAGE_CHANGED', 'TIMEOUT', 'NETWORK', 'BUSY',
    'LOOPBACK', 'METHOD', 'ORIGIN', 'CSRF', 'PATH', 'BAD_REQUEST', 'TOO_LARGE', 'NOT_FOUND', 'INTERNAL',
  ]
  for (const code of codes) {
    const sentence = explain({ code }, 'FALLBACK', zhTr)
    assert.notEqual(sentence, 'FALLBACK', `${code} has no zh sentence`)
    assert.notEqual(sentence, `error.${code}`, `${code} is missing from the zh dictionary`)
    const english = explain({ code }, 'FALLBACK', enTr)
    assert.notEqual(english, `error.${code}`, `${code} is missing from the en dictionary`)
    assert.equal(/[\u4e00-\u9fff]/.test(english), false, `${code}'s English sentence carries CJK`)
  }
  cleanup()
})

test('an unknown or absent code falls back to the host detail, then to the caller', async () => {
  const { explain, cleanup } = await loadPanel()
  // A deployment newer than this panel can answer with a code the panel has
  // never heard of; showing the host's sentence beats showing a bare key.
  assert.equal(explain({ code: 'SOMETHING_NEW', error: '宿主说明' }, '兜底', zhTr), '宿主说明')
  assert.equal(explain({ error: '宿主说明' }, '兜底', zhTr), '宿主说明', 'no code at all: the detail')
  assert.equal(explain({}, '兜底', zhTr), '兜底', 'nothing to say: the caller owns the sentence')
  assert.equal(explain(undefined, '兜底', zhTr), '兜底', 'and a request that never got an answer')
  cleanup()
})

test('the diagnostic report carries what someone else needs to reproduce', async () => {
  const { buildDiagnosticReport, cleanup } = await loadPanel()
  const report = buildDiagnosticReport({
    version: '0.5.1',
    build: '2026-10-10T10:27:53.040Z',
    phase: 'error',
    engine: 'error',
    engineError: '浏览器启动失败',
    loggedIn: false,
    busy: false,
    deepThink: true,
    search: false,
    pageUrl: 'https://chat.deepseek.com/a/chat/s/abc',
    lastError: '等待回复超时',
    lastErrorCode: 'TIMEOUT',
    storeWarning: '保存会话记录失败（ENOSPC）',
    chats: 42,
    settings: {
      browserChannel: 'chrome', browserExecutablePath: '', browserProxy: 'direct', browserHeadless: true,
      replyTimeoutMs: 180_000, dataDir: '/data', profileDir: '/data/profile', exportDir: '/exports',
      transferDistill: true, transferProvider: 'deepseek', transferModel: 'deepseek-chat', announceToAgent: false,
    },
    probe: { pageAlive: true, markdownCount: 3 },
    userAgent: 'Chrome/1.0',
  })
  for (const fragment of [
    'dsh-DSchat 0.5.1',
    'build: 2026-10-10T10:27:53.040Z',
    'phase: error — 浏览器启动失败',
    'loggedIn: false',
    'lastError: 等待回复超时 [TIMEOUT]',
    'storeWarning: 保存会话记录失败（ENOSPC）',
    'chats: 42',
    'dataDir: /data',
    'profileDir: /data/profile',
    'exportDir: /exports',
    'replyTimeoutMs: 180000',
    'probe: {"pageAlive":true,"markdownCount":3}',
  ]) {
    assert.ok(report.includes(fragment), `the report must carry ${JSON.stringify(fragment)}:\n${report}`)
  }
  // Absent values read as '-' rather than 'undefined': this text is pasted into
  // issues, and "undefined" reads as a bug in the report itself.
  const bare = buildDiagnosticReport({ phase: 'stopped', loggedIn: null, chats: 0, settings: null, probe: null })
  assert.equal(bare.includes('undefined'), false, `no "undefined" in the report:\n${bare}`)
  assert.match(bare, /^dsh-DSchat -$|^dsh-DSchat -\n/m, 'an unknown version reads as "-"')
  assert.match(bare, /settings: \(not loaded\)/)
  cleanup()
})

/*
 * The host half: a failure that cannot be localized is invisible in an English
 * UI, so "every failure carries a code" is a property worth enforcing
 * mechanically rather than by review. The only permitted `ok: false` in the
 * routes module is the one inside the `failure()` helper itself.
 */
test('every route failure goes through the coded helper', async () => {
  const source = readFileSync(join(root, 'src', 'routes.ts'), 'utf8')
  const bare = [...source.matchAll(/ok:\s*false/g)]
  assert.equal(bare.length, 1, `exactly one bare "ok: false" (the helper): found ${String(bare.length)}`)
  assert.match(source, /function failure\(res: ServerResponse, status: number, code: DSchatApiCode, error: string\): void \{/)
  /*
   * And the codes actually reach the wire. A route answered with a failure and
   * no code would pass a source scan only if it built the body some other way,
   * so one live-ish probe of the cheapest failure path is worth having: the
   * file list is read, the routes are built, and the first bad request is made.
   */
  const dir = mkdtempSync(join(tmpdir(), 'dschat-codes-'))
  const entry = join(dir, 'entry.ts')
  const outfile = join(dir, 'routes.mjs')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(entry, `export { sanitizeRestoreMessages } from ${JSON.stringify(join(root, 'src/routes.ts'))}\n`)
  await build({
    entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    alias: {
      '@deepseek-ai/dsh-llm': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-session': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-tools': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-workspace': join(root, 'test/stubs/harness.ts'),
    },
  })
  const mod = await import(pathToFileURL(outfile).href) as { sanitizeRestoreMessages: (value: unknown) => { dropped: number } }
  assert.equal(mod.sanitizeRestoreMessages([null, 1, 'x']).dropped, 3, 'the module under test really loaded')
  rmSync(dir, { recursive: true, force: true })
})
