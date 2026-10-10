/**
 * Where the plugin's data lives.
 *
 * `DSH_HOME` names the harness home (`~/.dsh` by default), NOT the user's home:
 * the machine-level config layer is `$DSH_HOME/cordis.patch.yml`. Treating it as
 * a home and appending another `.dsh` split the store in two — the transcripts
 * the user already had looked gone, and the browser profile carried over from
 * dsh-webchat could not be found, which read as a lost login. Both code paths
 * (the store's own default and index.ts's `harnessHome`) must land on the same
 * directory whether or not the variable is exported.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultDataDir } from '../src/store.ts'

/** Run `body` with `DSH_HOME` set to `value` (or unset when undefined), then restore. */
function withDshHome(value: string | undefined, body: () => void): void {
  const before = process.env.DSH_HOME
  try {
    if (value === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = value
    body()
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
  }
}

test('an exported DSH_HOME is used as-is, without a second .dsh', () => {
  withDshHome('/tmp/dsh-home-probe', () => {
    assert.equal(defaultDataDir(), join('/tmp/dsh-home-probe', 'dsh-dschat'))
  })
})

test('without DSH_HOME the store falls back to ~/.dsh, not ~/.dsh/.dsh', () => {
  withDshHome(undefined, () => {
    const home = process.env.HOME?.trim()
    const expected = join(home !== undefined && home !== '' ? home : '.', '.dsh', 'dsh-dschat')
    assert.equal(defaultDataDir(), expected)
    // The literal shape the bug produced, asserted absent by construction.
    assert.notEqual(defaultDataDir(), join(homedir(), '.dsh', '.dsh', 'dsh-dschat'))
  })
})

test('a blank DSH_HOME is ignored rather than resolving to a relative path', () => {
  withDshHome('   ', () => {
    const home = process.env.HOME?.trim()
    const expected = join(home !== undefined && home !== '' ? home : '.', '.dsh', 'dsh-dschat')
    assert.equal(defaultDataDir(), expected)
  })
})
