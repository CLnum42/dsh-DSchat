/**
 * What dsh-DSchat costs the system prompt.
 *
 * A prompt section is not free and not private: it renders into every session,
 * every subagent, and every workspace that has nothing to do with this plugin.
 * DSchat used to spend 786 characters there on a prose catalogue of its own six
 * tools — a catalogue the model already receives as tool schemas, in which each
 * tool's own description carries both its usage and its trigger words. The
 * harness's own guidance calls that out ("say each fact once"; do not repeat the
 * tool definition in a system-prompt section), and no other plugin in this
 * profile does it.
 *
 * Three things have to stay true, so they are asserted here rather than left to
 * a code review:
 *
 *   1. the DEFAULT configuration contributes no prompt text at all;
 *   2. the opt-in is small — a budget, not a vibe, because the size is exactly
 *      what crept up unnoticed the first time;
 *   3. the opt-in is scoped to tool visibility, so an agent that cannot call
 *      these tools renders nothing (the assembler drops an empty section).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Bundle the real host entry with the harness packages aliased to stubs. */
async function loadPlugin() {
  const dir = mkdtempSync(join(tmpdir(), 'dschat-prompt-'))
  const outfile = join(dir, 'bundle.mjs')
  await build({
    entryPoints: [join(root, 'src/index.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    alias: {
      '@deepseek-ai/dsh-llm': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-session': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-tools': join(root, 'test/stubs/harness.ts'),
      'playwright-core': join(root, 'test/stubs/harness.ts'),
    },
  })
  const mod = await import(pathToFileURL(outfile).href) as { apply: (ctx: unknown, config: unknown) => void }
  return { mod, dispose: () => { rmSync(dir, { recursive: true, force: true }) } }
}

/** A prompt section as the plugin registers it. */
interface Section {
  name: string
  order: number
  text: string | ((context: { scope?: object }) => string)
}

/**
 * The smallest cordis context the plugin's `apply` needs.
 *
 * `tools.get` answers the way the real registry does — by name, honouring the
 * scope the caller passes — which is what lets the last test show the section
 * disappearing for an agent the tools are hidden from. `hidden` models exactly
 * that: a `tools.restrict()` that removed the tool from this scope.
 */
function fakeContext(options: { hideTools?: boolean } = {}) {
  const sections: Section[] = []
  const registered: Array<{ name: string }> = []
  const ctx = {
    effect(factory: () => void | (() => void)) {
      const cleanup = factory()
      return () => { if (typeof cleanup === 'function') cleanup() }
    },
    get() { return undefined },
    systemPrompt: {
      section: (spec: Section) => {
        sections.push(spec)
        return () => { const at = sections.indexOf(spec); if (at >= 0) sections.splice(at, 1) }
      },
    },
    webServer: { register: () => () => undefined },
    tools: {
      register: (tool: { name: string }) => {
        registered.push(tool)
        return () => { const at = registered.indexOf(tool); if (at >= 0) registered.splice(at, 1) }
      },
      get: (name: string) => (options.hideTools === true
        ? undefined
        : registered.find(tool => tool.name === name)),
    },
  }
  return { ctx, sections, registered }
}

/** Render whatever the section would contribute for one agent scope. */
function render(section: Section | undefined): string {
  if (section === undefined) return ''
  return typeof section.text === 'string' ? section.text : section.text({ scope: {} })
}

test('the default configuration adds no prompt text', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-prompt-data-'))
  try {
    const { ctx, sections, registered } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })
    assert.equal(registered.length, 6, 'the tools are still registered — they are the discovery surface')
    assert.deepEqual(sections, [], 'and the prompt is left alone')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

test('the opt-in announcement is one short line, and yields to tool visibility', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-prompt-data-'))
  try {
    // Visible tools: the line renders.
    const visible = fakeContext()
    mod.apply(visible.ctx, { dataDir, profileDir: join(dataDir, 'profile'), announceToAgent: true })
    assert.equal(visible.sections.length, 1)
    const text = render(visible.sections[0])
    assert.ok(text.length > 0, 'an agent that can call the tools is told about them')
    assert.ok(
      text.length <= 200,
      `the announcement must stay a line, was ${String(text.length)} chars: ${text}`,
    )
    assert.match(text, /dschat_/)

    /*
     * Hidden tools: nothing.
     *
     * `''` is not a blank line in the prompt — the assembler drops empty
     * sections — which is what makes a restricted agent's cost exactly zero
     * instead of "zero plus an empty string".
     */
    const hidden = fakeContext({ hideTools: true })
    mod.apply(hidden.ctx, { dataDir, profileDir: join(dataDir, 'profile'), announceToAgent: true })
    assert.equal(hidden.sections.length, 1, 'the section is registered for the scope it was asked for')
    assert.equal(render(hidden.sections[0]), '', 'but renders nothing when the tools are not visible')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})
