/**
 * Where an export lands: the resolver's precedence, and the remembered pick.
 *
 * Two halves of one promise the reader was given — 「导出 markdown 默认写到下载
 * 文件夹」 and 「初次选择路径后，后面的导出默认写上次选择的路径」 — and both live
 * in code that has no business needing a browser or a running harness:
 * `resolveExportDir` decides the directory and `TranscriptStore` remembers it.
 *
 * The home directory is redirected per test: the resolver reads `HOME` at call
 * time, and an assertion about "a relative path means ~/导出" has to be able to
 * name the home it means without touching the real one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureExportDir, resolveExportDir } from '../src/export-dir.ts'
import { TranscriptStore } from '../src/store.ts'

/** Run `body` with `HOME` pointed at `home`, then restore it. */
function withHome<T>(home: string, body: () => T): T {
  const before = process.env.HOME
  const beforeExport = process.env.DSH_EXPORT_DIR
  try {
    process.env.HOME = home
    delete process.env.DSH_EXPORT_DIR
    return body()
  } finally {
    if (before === undefined) delete process.env.HOME
    else process.env.HOME = before
    if (beforeExport === undefined) delete process.env.DSH_EXPORT_DIR
    else process.env.DSH_EXPORT_DIR = beforeExport
  }
}

test('the export directory falls back to ~/Downloads, and a relative pick means ~', () => {
  const home = mkdtempSync(join(tmpdir(), 'dschat-home-'))
  try {
    withHome(home, () => {
      const downloads = resolveExportDir()
      assert.equal(downloads, join(home, 'Downloads'), 'nothing configured lands in the download folder')
      assert.ok(existsSync(downloads), 'and the folder is CREATED rather than refused')

      // A relative value resolves against the home directory, not the process
      // cwd: the same rule the harness's own workspace paths follow, and the
      // only one that means the same thing after a restart from another folder.
      const relative = resolveExportDir('导出')
      assert.equal(relative, join(home, '导出'))
      assert.ok(existsSync(relative), 'a relative folder is created too')
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the reader’s own pick outranks the configured default', () => {
  const home = mkdtempSync(join(tmpdir(), 'dschat-home-'))
  const configured = mkdtempSync(join(tmpdir(), 'dschat-configured-'))
  const picked = mkdtempSync(join(tmpdir(), 'dschat-picked-'))
  try {
    withHome(home, () => {
      assert.equal(resolveExportDir('', ''), join(home, 'Downloads'), 'blank values are not a choice')
      assert.equal(resolveExportDir(configured), configured, 'the configured folder is the default')
      assert.equal(
        resolveExportDir(configured, picked),
        picked,
        'and the folder the reader chose in the dialog wins over it — config is what a deployment ships, the pick is what the reader said last',
      )
      // Whitespace is not a choice either: a field the reader cleared must fall
      // back to the default rather than create a folder named " ".
      assert.equal(resolveExportDir(configured, '   '), configured)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(configured, { recursive: true, force: true })
    rmSync(picked, { recursive: true, force: true })
  }
})

test('a path that cannot be a directory is refused with the real reason', () => {
  const home = mkdtempSync(join(tmpdir(), 'dschat-home-'))
  try {
    withHome(home, () => {
      assert.throws(() => { ensureExportDir('  ') }, /不能为空/, 'an empty path is refused before any syscall')
      // A FILE where the reader named a folder: the mkdir error has to reach the
      // caller, because "the export failed" with no reason is what the reader
      // would otherwise have to debug.
      const file = join(home, 'not-a-folder')
      writeFileSync(file, 'x')
      assert.throws(() => { ensureExportDir(file) })
      assert.ok(statSync(file).isFile(), 'the file is left exactly as it was')
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the chosen folder is remembered on disk and comes back after a restart', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-prefs-'))
  const picked = mkdtempSync(join(tmpdir(), 'dschat-picked-'))
  try {
    const first = new TranscriptStore({ dataDir })
    assert.equal(first.exportDirPref(), undefined, 'nothing is remembered before the reader chooses')
    assert.equal(first.setExportDirPref(picked), true, 'the pick is stored')
    assert.equal(first.setExportDirPref(picked), false, 'storing the same folder again is a no-op')
    first.flush()
    first.dispose()

    // The file itself: a preference has to be on disk, not just in memory, and it
    // travels with the transcripts the store already writes atomically.
    const written = JSON.parse(readFileSync(join(dataDir, 'transcripts.json'), 'utf8')) as { prefs?: { exportDir?: string } }
    assert.equal(written.prefs?.exportDir, picked, 'the file carries the chosen folder')

    // A restart: a fresh store over the same data dir answers with the folder the
    // reader picked, without any config involved.
    const second = new TranscriptStore({ dataDir })
    assert.equal(second.exportDirPref(), picked, 'the pick survives a restart')
    second.dispose()
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(picked, { recursive: true, force: true })
  }
})

test('a malformed preference is ignored instead of reaching mkdir', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-prefs-bad-'))
  try {
    // Hand-written, or written by a build that stored something else: a path that
    // is not a non-empty string must not survive the read, because it is passed
    // to `mkdirSync` on every export.
    writeFileSync(join(dataDir, 'transcripts.json'), JSON.stringify({
      version: 1,
      chats: [],
      prefs: { exportDir: 42 },
    }))
    const store = new TranscriptStore({ dataDir })
    assert.equal(store.exportDirPref(), undefined, 'a non-string preference is dropped')
    store.dispose()
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
