/**
 * Offline smoke test for the host half.
 *
 * The harness packages (`@deepseek-ai/*`) only resolve inside a running
 * harness, so this test rebuilds `src/index.ts` with those specifiers aliased
 * to `test/stubs/harness.ts` and then exercises `apply()` against a fake cordis
 * context. It catches the failure a restart would otherwise be needed to see:
 * a bad import, a thrown `apply`, or a route/tool that never registers.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// Type-only: erased at runtime, so it does not defeat the dynamic-import dance
// the harness stubs need.
import type { WebFragment, WebMessage } from '../src/engine/engine.ts'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Bundle the real host entry with the harness packages aliased to stubs. */
async function loadPlugin() {
  const dir = mkdtempSync(join(tmpdir(), 'dschat-host-'))
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
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, dispose: () => { rmSync(dir, { recursive: true, force: true }) } }
}

/**
 * Load `src/transfer.ts` on its own, with the harness packages stubbed.
 *
 * The plugin entry does not re-export the transfer module's pure helpers, and a
 * bare `import('../src/transfer.ts')` fails on `@deepseek-ai/dsh-llm`, which
 * only exists inside the packaged app. Bundling it through the same alias table
 * `loadPlugin` uses makes those helpers testable directly.
 */
async function loadTransferHelpers() {
  const dir = mkdtempSync(join(tmpdir(), 'dschat-transfer-'))
  const outfile = join(dir, 'transfer.mjs')
  await build({
    entryPoints: [join(root, 'src/transfer.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    alias: {
      '@deepseek-ai/dsh-llm': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-session': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-tools': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-workspace': join(root, 'test/stubs/harness.ts'),
    },
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    mod: mod as {
      handoffProvenance: (t: unknown, mode: string) => string
      chunkTranscript: (t: unknown, budget?: number) => unknown[][]
    },
  }
}

/**
 * A distillation is one model call PER CHUNK, so the chunk count is the cost of
 * the whole operation. A long web conversation used to fan out without limit —
 * 200 chunks meant 200 sequential round-trips with nothing on screen. The
 * ceiling is what keeps a transfer bounded, and it has to keep the END of the
 * conversation, which is the part a handoff is built from.
 */
test('the distillation chunk count is capped, and the overflow keeps the tail', async () => {
  const { mod: helpers } = await loadTransferHelpers()
  const message = (index: number) => ({ id: `m${index}`, role: index % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(100), ts: index })

  // 500 messages at a 100-char budget would be 500 chunks without a ceiling.
  const many = { id: 'c', title: 't', messages: Array.from({ length: 500 }, (_, i) => message(i)) }
  const chunks = helpers.chunkTranscript(many, 100)
  assert.ok(chunks.length <= 20, `the fan-out is bounded, got ${chunks.length}`)
  assert.ok(chunks.length > 1, 'a long conversation still uses the map phase')

  // The overflow slice carries the newest messages, not the oldest.
  const last = chunks[chunks.length - 1] as Array<{ id: string }>
  assert.equal(last[last.length - 1].id, 'm499', 'the tail of the conversation survives the ceiling')

  // A short conversation is untouched by the cap: it fits in one call.
  const few = { id: 'c', title: 't', messages: [message(0), message(1)] }
  assert.equal(helpers.chunkTranscript(few, 10_000).length, 1, 'a short transcript stays a single shot')
})

/**
 * Attachment cleanup must respect the transcripts that still point at a file.
 *
 * The pruning rule used to be age alone, which deleted exactly the attachments a
 * reader is most likely to come back to — the ones in conversations older than
 * the TTL. Reopening such a transcript then showed dead chips, and 「导出」 wrote
 * paths that no longer existed.
 */
test('attachment pruning never deletes a file a transcript still references', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-attach-'))
  try {
    const { join: joinPath } = await import('node:path')
    const { mkdirSync, writeFileSync, existsSync, utimesSync } = await import('node:fs')
    const dir = joinPath(dataDir, 'attachments')
    mkdirSync(dir, { recursive: true })
    const keep = joinPath(dir, 'referenced.png')
    const drop = joinPath(dir, 'orphan.png')
    writeFileSync(keep, 'old but referenced')
    writeFileSync(drop, 'old and orphaned')
    // Both are far past the TTL; only the referenced one may survive.
    const ancient = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(keep, ancient, ancient)
    utimesSync(drop, ancient, ancient)

    const { ctx, routes } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: joinPath(dataDir, 'profile') })
    const route = (path: string) => (routes as Route[]).find(r => r.path === path)!

    // A stored conversation that still carries the attachment.
    const restored = fakeResponse()
    await route('/api/dsh-dschat/restore').handler(fakeRequest({
      title: '带附件的会话',
      model: 'deepseek-chat',
      messages: [{ id: 'm1', role: 'user', content: '看这个', ts: 1, attachments: [keep] }],
    }), restored)
    assert.equal(restored.captured.body.ok, true)

    // An upload is what triggers housekeeping.
    const uploaded = fakeResponse()
    await route('/api/dsh-dschat/attach').handler(fakeRequest({
      name: 'new.png', mediaType: 'image/png', data: Buffer.from('new bytes').toString('base64'),
    }), uploaded)
    assert.equal(uploaded.captured.body.ok, true, String(uploaded.captured.body.error))

    assert.equal(existsSync(keep), true, 'a referenced attachment is never pruned')
    assert.equal(existsSync(uploaded.captured.body.path), true, 'the new upload is on disk')
    assert.equal(existsSync(drop), false, 'an unreferenced file past the TTL is still garbage-collected')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

/** Minimal cordis context recording every registration the plugin makes. */function fakeContext(options: { persistence?: unknown } = {}) {
  const routes: Array<{ path: string }> = []
  const tools: Array<{ name: string }> = []
  const sections: Array<{ name: string }> = []
  /** Every forwarded Host event the plugin emitted, in order. */
  const emitted: Array<{ event: string; args: unknown[] }> = []
  const ctx = {
    // Honour disposal the way real cordis does: the returned function runs the
    // effect's cleanup, so a re-registering sync() cannot accumulate entries.
    effect(factory: () => void | (() => void)) {
      const cleanup = factory()
      const run = typeof cleanup === 'function' ? cleanup : () => undefined
      return () => { run() }
    },
    get(name: string) {
      if (name === 'workspaceRegistry') return { list: () => [{ id: 'w1', path: '/tmp/ws', title: 'ws' }] }
      if (name === 'sessions') return { list: () => [{ header: { cwd: '/tmp/ws' } }] }
      if (name === 'sessionPersistence') return options.persistence
      return undefined
    },
    emit(event: string, ...args: unknown[]) {
      emitted.push({ event, args })
    },
    systemPrompt: {
      section: (spec: { name: string }) => {
        sections.push(spec)
        return () => { const at = sections.indexOf(spec); if (at >= 0) sections.splice(at, 1) }
      },
    },
    webServer: {
      register: (route: { path: string }) => {
        routes.push(route)
        return () => { const at = routes.indexOf(route); if (at >= 0) routes.splice(at, 1) }
      },
    },
    tools: {
      register: (tool: { name: string }) => {
        tools.push(tool)
        return () => { const at = tools.indexOf(tool); if (at >= 0) tools.splice(at, 1) }
      },
    },
  }
  return { ctx, routes, tools, sections, emitted }
}

/**
 * A `sessionPersistence` stand-in shaped like the REAL service: `create`/`open`
 * hand back a write HANDLE, and the service itself exposes no `append`.
 *
 * That asymmetry is the whole point. The transfer path once called
 * `persistence.append(...)` — inherited from dsh-webchat, where the same call
 * had never run either — and because the service was read untyped it compiled
 * clean and failed only at run time, mid-transfer, in front of the user.
 */
function fakePersistence() {
  const created: Array<{ header: Record<string, unknown>; events: Array<{ type: string; seq: number }>; flushed: boolean; closed: boolean }> = []
  const makeHandle = (record: { header: Record<string, unknown>; events: Array<{ type: string; seq: number }>; flushed: boolean; closed: boolean }) => ({
    async read() { return { events: record.events } },
    async append(events: Array<{ type: string; seq: number }>) { record.events.push(...events) },
    async flush() { record.flushed = true },
    async close() { record.closed = true },
  })
  const service = {
    async create(header: Record<string, unknown>) {
      const record = { header, events: [] as Array<{ type: string; seq: number }>, flushed: false, closed: false }
      created.push(record)
      return makeHandle(record)
    },
    async open() {
      const record = created[0] ?? { header: {}, events: [], flushed: false, closed: false }
      return makeHandle(record)
    },
  }
  return { service, created }
}

test('host half imports and registers its surfaces', async () => {
  const { mod, dispose } = await loadPlugin()
  try {
    assert.equal(mod.name, 'dschat')
    assert.deepEqual(mod.inject, ['webServer', 'tools', 'systemPrompt', 'sessions'])

    const dataDir = mkdtempSync(join(tmpdir(), 'dschat-data-'))
    const { ctx, routes, tools, sections } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })

    // Every route family member the panel calls must exist.
    const paths = routes.map(route => route.path)
    for (const path of [
      '/api/dsh-dschat/state',
      '/api/dsh-dschat/context',
      '/api/dsh-dschat/wake',
      '/api/dsh-dschat/open-login',
      '/api/dsh-dschat/close-browser',
      '/api/dsh-dschat/new-chat',
      '/api/dsh-dschat/restore',
      '/api/dsh-dschat/send',
      '/api/dsh-dschat/stop',
      '/api/dsh-dschat/deep-think',
      '/api/dsh-dschat/search',
      '/api/dsh-dschat/transfer',
      '/api/dsh-dschat/export',
      '/api/dsh-dschat/rename',
      '/api/dsh-dschat/delete',
      '/api/dsh-dschat/clear',
      '/api/dsh-dschat/web-chats',
      '/api/dsh-dschat/recover',
    ]) assert.ok(paths.includes(path), `missing route ${path}`)

    /*
     * The same check, derived rather than hand-written: every constant in
     * `DSCHAT_API` is a path the panel fetches, so a constant without a route is
     * a guaranteed 404 in the UI. The hard-coded list above documents the
     * contract; this one catches the edit that forgets to extend it.
     */
    const { DSCHAT_API } = await import('../src/protocol.ts')
    for (const [name, path] of Object.entries(DSCHAT_API)) {
      assert.ok(paths.includes(path), `DSCHAT_API.${name} (${path}) has no route`)
    }

    // The five agent tools keep their documented names.
    assert.deepEqual(
      tools.map(tool => tool.name).sort(),
      ['dschat_import', 'dschat_recover', 'dschat_send', 'dschat_status', 'dschat_transfer'],
    )
    assert.equal(sections.length, 1)
    assert.match(sections[0].name, /dsh-dschat/)

    rmSync(dataDir, { recursive: true, force: true })
  } finally {
    dispose()
  }
})

test('disabled config registers nothing', async () => {
  const { mod, dispose } = await loadPlugin()
  try {
    const dataDir = mkdtempSync(join(tmpdir(), 'dschat-data-'))
    const { ctx, routes, tools, sections } = fakeContext()
    mod.apply(ctx, { enabled: false, announceToAgent: false, dataDir, profileDir: join(dataDir, 'p') })
    assert.equal(routes.length, 0)
    assert.equal(tools.length, 0)
    assert.equal(sections.length, 0)
    rmSync(dataDir, { recursive: true, force: true })
  } finally {
    dispose()
  }
})

/** A minimal IncomingMessage stand-in: headers, socket, async body chunks. */
function fakeRequest(body: unknown, host = '127.0.0.1:19387', address = '127.0.0.1', url = '/') {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    headers: { host },
    socket: { remoteAddress: address },
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/**
 * A minimal ServerResponse stand-in capturing status, headers, and the body.
 *
 * The body has two arms, and both are needed. The JSON routes answer with a
 * string, which is parsed and exposed as `body`; the attachment route answers
 * the stored FILE, so its Buffer is exposed as `bytes` — a fake that parsed
 * everything as JSON could not tell whether those bytes ever arrived.
 */
function fakeResponse() {
  const captured: {
    status: number
    body: any
    bytes: Buffer
    headers: Record<string, string>
  } = { status: 0, body: undefined, bytes: Buffer.alloc(0), headers: {} }
  return {
    captured,
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status
      if (headers !== undefined) captured.headers = headers
    },
    end(payload: string | Buffer) {
      if (typeof payload === 'string') captured.body = JSON.parse(payload)
      else captured.bytes = payload
    },
  }
}

type Route = { path: string; handler: (req: any, res: any) => unknown | Promise<unknown> }

test('attach route persists pasted image bytes and returns a real path', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-attach-'))
  try {
    const { ctx, routes } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })

    const attach = (routes as Route[]).find(route => route.path === '/api/dsh-dschat/attach')
    assert.ok(attach !== undefined, 'attach route registered')

    // A tiny PNG signature is enough: the route treats the payload as opaque.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const res = fakeResponse()
    await attach.handler(
      fakeRequest({ name: 'screenshot.png', mediaType: 'image/png', data: bytes.toString('base64') }),
      res,
    )

    assert.equal(res.captured.status, 200)
    assert.equal(res.captured.body.ok, true)
    assert.match(res.captured.body.path, /attachments\/.*\.png$/)
    assert.ok(res.captured.body.path.startsWith(dataDir), 'attachment lands under the plugin data dir')
    assert.deepEqual(readFileSync(res.captured.body.path), bytes)
    /*
     * The stored name keeps the reader's own file name, after the UUID.
     *
     * It used to be a bare `${randomUUID}${ext}`, which is what the composer
     * then printed as the chip's label — the reported 「一串数字」. The UUID must
     * still lead (it is the uniqueness guarantee) and the extension must still
     * be last, so this pins the whole shape, not just "contains the name".
     */
    const file = res.captured.body.path.split('/').pop()
    assert.match(file, /^[0-9a-f-]{36}__screenshot\.png$/, 'uuid, then the readable name, then the extension')
    assert.equal(res.captured.body.name, 'screenshot.png', 'and the bare name is handed back for the chip')

    // An empty body is a caller error, not a crash.
    const bad = fakeResponse()
    await attach.handler(fakeRequest({ name: 'x.png', mediaType: 'image/png', data: '' }), bad)
    assert.equal(bad.captured.status, 400)
    assert.equal(bad.captured.body.ok, false)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

/**
 * The read-back route: the composer's thumbnails, and the fence around them.
 *
 * Three things are being pinned, and each one is a bug that is invisible without
 * a test:
 *
 *   · the bytes come back (a broken route means every chip in the composer
 *     renders a broken image, and the panel cannot tell that from a pruned file);
 *   · the media type follows the EXTENSION, so an image is served as an image
 *     and a document does not pretend to be one;
 *   · a path outside the attachment directory is refused — this route reads
 *     from disk, and `?path=/etc/passwd` must be a 404 rather than a file.
 */
test('attachment route serves stored bytes and refuses anything outside the directory', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-attachment-'))
  try {
    const { ctx, routes } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })

    const attach = (routes as Route).find(route => route.path === '/api/dsh-dschat/attach')
    const serve = (routes as Route).find(route => route.path === '/api/dsh-dschat/attachment')
    assert.ok(attach !== undefined && serve !== undefined, 'both attachment routes registered')

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
    const stored = fakeResponse()
    await attach.handler(fakeRequest({ name: '季度 经营 分析.png', mediaType: 'image/png', data: bytes.toString('base64') }), stored)
    const path = stored.captured.body.path as string
    assert.match(path, /__季度 经营 分析\.png$/, 'the label is the reader\'s own name, extension outside it, spaces and all')

    const ok = fakeResponse()
    await serve.handler(
      fakeRequest(undefined, '127.0.0.1:19387', '127.0.0.1', `/api/dsh-dschat/attachment?path=${encodeURIComponent(path)}`),
      ok,
    )
    assert.equal(ok.captured.status, 200)
    assert.equal(ok.captured.headers['content-type'], 'image/png', 'the extension decides the media type')
    assert.equal(ok.captured.headers['content-length'], String(bytes.length))
    assert.match(ok.captured.headers['content-disposition'] ?? '', /filename\*=UTF-8''/, 'the download name is the readable one')
    assert.deepEqual(ok.captured.bytes, bytes, 'and the stored bytes are what came back')

    // A path outside the attachment directory is never read.
    const outside = fakeResponse()
    await serve.handler(
      fakeRequest(undefined, '127.0.0.1:19387', '127.0.0.1', `/api/dsh-dschat/attachment?path=${encodeURIComponent('/etc/hosts')}`),
      outside,
    )
    assert.equal(outside.captured.status, 404, 'a path outside the attachment directory is refused')

    // A file that was pruned, and a request that named nothing at all.
    const missing = fakeResponse()
    await serve.handler(
      fakeRequest(undefined, '127.0.0.1:19387', '127.0.0.1', `/api/dsh-dschat/attachment?path=${encodeURIComponent(join(dataDir, 'attachments', 'gone.png'))}`),
      missing,
    )
    assert.equal(missing.captured.status, 404)
    const unnamed = fakeResponse()
    await serve.handler(fakeRequest(undefined, '127.0.0.1:19387', '127.0.0.1', '/api/dsh-dschat/attachment'), unnamed)
    assert.equal(unnamed.captured.status, 400)

    // And the same loopback fence as every other route in the family.
    const remote = fakeResponse()
    await serve.handler(
      fakeRequest(undefined, '192.168.1.9:19387', '192.168.1.9', `/api/dsh-dschat/attachment?path=${encodeURIComponent(path)}`),
      remote,
    )
    assert.equal(remote.captured.status, 403)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

test('context route reports workspaces, cwd and resolved settings', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-context-'))
  try {
    const { ctx, routes } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })

    const context = (routes as Route[]).find(route => route.path === '/api/dsh-dschat/context')
    assert.ok(context !== undefined, 'context route registered')
    const res = fakeResponse()
    await context.handler(fakeRequest(undefined), res)

    assert.equal(res.captured.status, 200)
    assert.equal(res.captured.body.cwd, '/tmp/ws')
    assert.deepEqual(res.captured.body.workspaces, [{ id: 'w1', path: '/tmp/ws', title: 'ws' }])
    assert.equal(res.captured.body.settings.dataDir, dataDir)
    assert.equal(res.captured.body.settings.profileDir, join(dataDir, 'profile'))
    assert.equal(res.captured.body.settings.browserHeadless, true)
    assert.equal(res.captured.body.settings.replyTimeoutMs, 180_000)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

test('every route refuses a non-loopback caller', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-guard-'))
  try {
    const { ctx, routes } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })
    for (const route of routes as Route[]) {
      const res = fakeResponse()
      await route.handler(fakeRequest({}, '192.168.1.9:19387', '192.168.1.9'), res)
      assert.equal(res.captured.status, 403, `${route.path} must fence non-loopback callers`)
      assert.equal(res.captured.body.error, 'loopback only')
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

/**
 * chat.deepseek.com ships hashed CSS-module class names that change on every
 * deploy. A `[class*="conversation"]`-style probe silently matches zero
 * elements, which surfaces as an empty "从网页恢复" list rather than an error —
 * so the row/selection selectors are pinned to the deep-link href the site
 * cannot rename, and this test fails if a class-name probe creeps back in.
 */
test('web-side selectors rely on structure, not hashed class names', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(join(root, 'src/engine/engine.ts'), 'utf8')
  assert.ok(source.includes('a[href*="/a/chat/s/"]'), 'sidebar rows use the conversation deep-link href')
  assert.ok(source.includes('[data-virtual-list-item-key]'), 'message list uses the virtualizer item key')
  // The class-name probes that were verified dead against the live page.
  for (const dead of ['[class*="chat-item"]', '[class*="session-item"]']) {
    assert.ok(!source.includes(dead), `${dead} matched nothing live and must not come back`)
  }
  // The site's controls are div[role="button"] and a live probe found zero
  // <button> elements, so a role-based variant must precede every <button> one.
  for (const label of ['停止生成', '新对话']) {
    const role = source.indexOf(`'[role="button"]:has-text("${label}")'`)
    const plain = source.indexOf(`'button:has-text("${label}")'`)
    assert.ok(role > -1, `a [role="button"] variant for ${label} exists`)
    assert.ok(role < plain, `the [role="button"] variant for ${label} is tried before <button>`)
  }
})

/**
 * Session format v4 makes `isSeeded` a REQUIRED header field, but session
 * creation is the only place that builds a header by hand and the omission does
 * not surface at write time — the seeded session persists fine and only fails
 * later, on restore, with "format v4 header lacks required field isSeeded".
 * That is precisely how the transfer path broke in the desktop app, so the two
 * required fields no v4 caller may omit are pinned here.
 */
test('the transfer header carries the required v4 fields', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(join(root, 'src/transfer.ts'), 'utf8')
  const header = source.slice(source.indexOf('const header: SessionHeader = {'))
  const block = header.slice(0, header.indexOf('}'))
  for (const field of ['version', 'id', 'createdAt', 'isSeeded', 'delegationDepth']) {
    assert.ok(new RegExp(`\\b${field}\\b`).test(block), `the hand-built header sets ${field}`)
  }
  assert.match(block, /isSeeded:\s*false/, 'a session created from ordinary seed messages is unseeded')
})

test('transfer writes a cold session through the persistence write handle', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-transfer-'))
  try {
    const { service, created } = fakePersistence()
    const { ctx, routes, tools, emitted } = fakeContext({ persistence: service })
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })

    // Seed the transcript store the way the panel does, through the restore route.
    const restore = (routes as Array<{ path: string; handler: Function }>).find(r => r.path === '/api/dsh-dschat/restore')!
    const res = fakeResponse()
    await restore.handler(fakeRequest({
      title: '网页会话测试',
      model: 'deepseek-chat',
      messages: [
        { id: 'm1', role: 'user', content: '帮我想一个插件名字', ts: 1 },
        { id: 'm2', role: 'assistant', content: '可以叫 dsh-DSchat。', ts: 2 },
      ],
    }), res)
    const chatId = res.captured.body.chatId as string
    assert.ok(typeof chatId === 'string' && chatId !== '', 'restore returned a chat id')

    const transfer = (tools as Array<{ name: string; execute: Function }>).find(t => t.name === 'dschat_transfer')!
    const result = await transfer.execute({ chatId, cwd: dataDir })

    assert.equal(result.error, undefined, `transfer must not fail: ${String(result.error)}`)
    assert.ok(typeof result.sessionId === 'string' && result.sessionId !== '', 'transfer returned a session id')

    // The cold session is built through the handle, never through the service.
    assert.equal(created.length, 1, 'exactly one stored session was created')
    const [record] = created
    const { SESSION_FORMAT_VERSION } = await import('./stubs/harness.ts')
    assert.equal(record.header.version, SESSION_FORMAT_VERSION, 'the versioned header is written')
    assert.equal(record.header.isSeeded, false, 'a freshly seeded session is unseeded')
    assert.ok(record.events.some(e => e.type === 'user/message'), 'the brief is the first message')
    // Format v4 retires the `plugin` source kind: native admission rejects it
    // with "format v4 message requires a producer-owned source kind". Every
    // message this plugin authors must carry a real producer kind instead.
    const producers: readonly string[] = ['user', 'model', 'tool', 'system-prompt']
    for (const event of record.events as Array<{ type: string; data?: { source?: { kind?: string } } }>) {
      const kind = event.data?.source?.kind
      if (kind === undefined) continue
      assert.notEqual(kind, 'plugin', `${event.type} must not use the retired plugin source kind`)
      assert.ok(producers.includes(kind), `${event.type} source kind ${JSON.stringify(kind)} is producer-owned`)
    }
    // The harness requires messageSeqs to be empty EXACTLY for a user-authored
    // title ("session/title messageSeqs must be empty exactly for a user title").
    const titleEvent = (record.events as Array<{ type: string; data?: { messageSeqs?: unknown[]; source?: { kind?: string } } }>)
      .find(e => e.type === 'session/title')
    assert.ok(titleEvent !== undefined, 'the web chat title is pinned as a session/title event')
    assert.equal(
      (titleEvent.data?.messageSeqs?.length ?? 0) === 0,
      titleEvent.data?.source?.kind === 'user',
      'title messageSeqs emptiness agrees with its source kind',
    )
    assert.equal(record.flushed, true, 'the write is flushed durably')
    assert.equal(record.closed, true, 'write ownership is released')

    /*
     * The cold write bypasses `ctx.sessions`, so nothing emits `session/created`
     * and the session controller never forwards a list row. Without the explicit
     * `api-session/added` announcement the new session is invisible to the Web
     * Client: no sidebar row, and `uiWorkspace.openSession(id)` throws
     * "sessions.retain: unknown session" — the reported "no new session, and it
     * does not open" defect. The announcement is therefore part of the contract,
     * not a nicety.
     */
    const added = emitted.filter(entry => entry.event === 'api-session/added')
    assert.equal(added.length, 1, 'the created session is announced exactly once')
    const row = added[0].args[0] as Record<string, unknown>
    assert.equal(row.sessionId, result.sessionId, 'the announced row names the new session')
    assert.equal(row.cwd, dataDir, 'the row carries the session cwd so the sidebar can group it')
    assert.equal(row.running, false, 'a freshly seeded session is not running')
    assert.equal(row.agentAvailable, false, 'a cold session has no live Agent yet')
    assert.equal(row.blank, false, 'the row carries a first message, so the GUI must not reuse it as blank')
    assert.ok(typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt), 'the row has a finite recency')
    assert.ok(!Object.hasOwn(row, 'projections'), 'no projection hints are invented')
    assertLosslessJson(row, 'api-session/added row')

    // Second branch: continue an existing session. This one has no workspace, so
    // its result must OMIT workspaceId — an own property holding undefined is not
    // lossless JSON, and the harness then rejects the whole tool result with
    // "value is not lossless JSON" even though the append already succeeded.
    //
    // The conversation carried in is a SECOND one: appending the SAME transcript
    // twice is skipped as a duplicate by design (pinned by the test below), which
    // is not what this branch is about.
    const res2 = fakeResponse()
    await restore.handler(fakeRequest({
      title: '网页会话测试（第二轮）',
      model: 'deepseek-chat',
      messages: [
        { id: 'm3', role: 'user', content: '接着上一轮，继续做', ts: 3 },
        { id: 'm4', role: 'assistant', content: '好。', ts: 4 },
      ],
    }), res2)
    const secondChatId = res2.captured.body.chatId as string
    assert.notEqual(secondChatId, chatId, 'a second round is its own transcript')

    const continued = await transfer.execute({ chatId: secondChatId, targetSessionId: result.sessionId })
    assert.equal(continued.error, undefined, `continue must not fail: ${String(continued.error)}`)
    assert.equal(continued.sessionId, result.sessionId, 'continue targets the same session')
    assert.equal(continued.continued, true, 'continue reports the continue path')
    assertLosslessJson(continued, 'dschat_transfer (continue)')
    assert.ok(
      !Object.hasOwn(continued, 'workspaceId'),
      'an absent workspace is omitted, not present as undefined',
    )
    assert.ok(record.events.some(e => e.type === 'turn/start'), 'continue opens a turn')
    assert.ok(record.events.some(e => e.type === 'step/start'), 'continue opens a step')
    const activity = emitted.filter(entry => entry.event === 'api-session/activity')
    assert.equal(activity.length, 1, 'the appended session reports one activity tick')
    assert.equal(activity[0].args[0], result.sessionId, 'the activity names the appended session')
    assertLosslessJson(activity[0].args, 'api-session/activity args')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

/**
 * 「追加到已有会话」 must be idempotent.
 *
 * A transfer can be attempted twice without anyone meaning to: the panel's
 * request times out and the reader clicks again, an agent re-calls the tool, or
 * a double click lands. Each of those used to append the whole brief a second
 * time, and the resumed agent then read the same task twice. The provenance line
 * a handoff carries identifies it, so the repeat is recognised and skipped.
 */
test('re-appending the same handoff is a no-op, a new round still appends', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-idempotent-'))
  try {
    const { service, created } = fakePersistence()
    const { ctx, routes, tools } = fakeContext({ persistence: service })
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })
    const restore = (routes as Array<{ path: string; handler: Function }>).find(r => r.path === '/api/dsh-dschat/restore')!
    const importChat = async (title: string, messages: Array<Record<string, unknown>>): Promise<string> => {
      const res = fakeResponse()
      await restore.handler(fakeRequest({ title, model: 'deepseek-chat', messages }), res)
      return res.captured.body.chatId as string
    }
    const transfer = (tools as Array<{ name: string; execute: Function }>).find(t => t.name === 'dschat_transfer')!

    // A session seeded from one conversation...
    const firstChatId = await importChat('幂等测试会话', [{ id: 'm1', role: 'user', content: '第一轮', ts: 1 }])
    const seed = await transfer.execute({ chatId: firstChatId, cwd: dataDir })
    assert.equal(seed.error, undefined)
    const [record] = created

    // ...and a SECOND web conversation appended to it: a real append.
    const secondChatId = await importChat('另一个网页会话', [{ id: 'n1', role: 'user', content: '另一个话题', ts: 1 }])
    const first = await transfer.execute({ chatId: secondChatId, targetSessionId: seed.sessionId })
    assert.equal(first.continued, true)
    assert.notEqual(first.duplicate, true, 'the first append is not a duplicate')
    const afterFirst = record.events.length

    // The retry: same conversation, same state — nothing new may be written.
    const retry = await transfer.execute({ chatId: secondChatId, targetSessionId: seed.sessionId })
    assert.equal(retry.continued, true, 'the retry still reports the continue path')
    assert.equal(retry.duplicate, true, 'and it is reported as a duplicate')
    assert.equal(record.events.length, afterFirst, 'no second copy of the brief was appended')

    // The same conversation re-appended to the session it was SEEDED from is the
    // same duplicate: the brief is already there, whoever put it there.
    const reseed = await transfer.execute({ chatId: firstChatId, targetSessionId: seed.sessionId })
    assert.equal(reseed.duplicate, true, 'a brief already in the session is never appended twice')

    // A later round of that conversation is a NEW handoff: its provenance covers
    // how far the web conversation had got when it was transferred.
    const { mod: helpers } = await loadTransferHelpers()
    const before = { id: secondChatId, title: '另一个网页会话', messages: [{ id: 'n1' }] }
    const grown = { id: secondChatId, title: '另一个网页会话', messages: [{ id: 'n1' }, { id: 'n2' }] }
    assert.notEqual(
      helpers.handoffProvenance(grown, 'raw'),
      helpers.handoffProvenance(before, 'raw'),
      'a conversation that moved on fingerprints differently, so it appends',
    )
    assert.equal(
      helpers.handoffProvenance(before, 'raw'),
      helpers.handoffProvenance({ ...before }, 'raw'),
      'the same state fingerprints the same way, so the retry is caught',
    )
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

/**
 * The append path opens the target's stored log for writing, and both ways that
 * can be refused are user-facing: the id does not exist (the picker once sent
 * web-chat ids here, which is exactly this case) or the session is live and
 * already owned by its own writer. A raw storage class name in the toast told
 * the user nothing, so each refusal is translated.
 */
test('append refusals are reported in the user\'s terms', async () => {
  const { mod, dispose } = await loadPlugin()
  const cases = [
    ['SessionPersistenceNotFoundError', /找不到 harness 会话/],
    ['SessionAlreadyOwnedError', /正在使用中/],
  ] as const
  try {
    for (const [errorName, expected] of cases) {
      const failure = Object.assign(new Error('storage detail'), { name: errorName })
      const service = {
        async create() { throw new Error('create is not exercised here') },
        async open() { throw failure },
      }
      const dataDir = mkdtempSync(join(tmpdir(), 'dschat-append-'))
      try {
        const { ctx, routes, tools } = fakeContext({ persistence: service })
        mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })

        const restore = (routes as Array<{ path: string; handler: Function }>).find(r => r.path === '/api/dsh-dschat/restore')!
        const res = fakeResponse()
        await restore.handler(fakeRequest({
          title: '追加目标测试',
          model: 'deepseek-chat',
          messages: [{ id: 'm1', role: 'user', content: '继续这个任务', ts: 1 }],
        }), res)
        const chatId = res.captured.body.chatId as string

        const transfer = (tools as Array<{ name: string; execute: Function }>).find(t => t.name === 'dschat_transfer')!
        const result = await transfer.execute({ chatId, targetSessionId: 'session-missing' })
        assert.match(String(result.error), expected, `${errorName} is translated`)
      } finally {
        rmSync(dataDir, { recursive: true, force: true })
      }
    }
  } finally {
    dispose()
  }
})

/**
 * The harness rejects a tool result whose value is not lossless JSON, and the
 * failure is total: the user sees "invalid output" even though the side effect
 * already happened. `undefined` anywhere is the usual cause, and `JSON.stringify`
 * hides it by dropping the key, so walk the value instead.
 */
function assertLosslessJson(value: unknown, label: string, path = '$'): void {
  if (value === undefined) assert.fail(`${label}: ${path} is undefined (omit the key instead)`)
  if (value === null) return
  const type = typeof value
  if (type === 'number') {
    assert.ok(Number.isFinite(value), `${label}: ${path} is not a finite number`)
    return
  }
  if (type === 'string' || type === 'boolean') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLosslessJson(item, label, `${path}[${index}]`))
    return
  }
  if (type === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertLosslessJson(item, label, `${path}.${key}`)
    }
    return
  }
  assert.fail(`${label}: ${path} has non-JSON type ${type}`)
}

/**
 * Bundle the tool factories on their own so their RETURN VALUES can be exercised
 * with fakes. Every tool result crosses the same lossless-JSON gate, and a
 * violation is reported as "invalid output" — the side effect has already
 * happened, so the user sees a failure for something that worked.
 */
async function loadToolFactories() {
  const dir = mkdtempSync(join(tmpdir(), 'dschat-tools-'))
  const outfile = join(dir, 'tools.mjs')
  const entry = join(dir, 'entry.ts')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(entry, `
    export { dschatSendTool, dschatImportTool, dschatStatusTool } from ${JSON.stringify(join(root, 'src/tools.ts'))}
  `, 'utf8')
  await build({
    entryPoints: [entry],
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
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

test('a successful send returns a lossless-JSON result', async () => {
  const { mod, dispose } = await loadToolFactories()
  try {
    // Success carries no error/code: those must be OMITTED, not present as undefined.
    const engine = {
      send: async () => ({ ok: true, reply: '网页端的回答', error: undefined, code: undefined }),
      status: () => ({ engine: 'ready' }),
    }
    const tool = mod.dschatSendTool(engine)
    const ok = await tool.execute({ text: '你好' })
    assert.equal(ok.reply, '网页端的回答')
    assert.equal(ok.partial, false)
    assert.ok(!Object.hasOwn(ok, 'error'), 'a successful send omits error')
    assert.ok(!Object.hasOwn(ok, 'code'), 'a successful send omits code')
    assertLosslessJson(ok, 'dschat_send (success)')

    // Failure keeps both, and stays lossless.
    const failing = { send: async () => ({ ok: false, reply: '', error: '超时', code: 'TIMEOUT' }) }
    const failed = await mod.dschatSendTool(failing).execute({ text: '你好' })
    assert.equal(failed.error, '超时')
    assert.equal(failed.code, 'TIMEOUT')
    assert.equal(failed.partial, true)
    assertLosslessJson(failed, 'dschat_send (failure)')
  } finally {
    dispose()
  }
})

/**
 * `stateView` lists its fields explicitly, so a field added to `engine.status()`
 * is silently dropped from /state unless it is named there too — the panel then
 * polls forever for a flag that never arrives. This pins the whole panel-facing
 * shape, not just the new field.
 */
test('the state route exposes every field the panel reads', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-state-'))
  try {
    const { ctx, routes } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })
    const route = (routes as Array<{ path: string; handler: Function }>)
      .find(r => r.path === '/api/dsh-dschat/state')!
    const res = fakeResponse()
    await route.handler(fakeRequest(undefined), res)
    assert.equal(res.captured.status, 200)
    for (const field of [
      'engine', 'loggedIn', 'deepThink', 'search',
      'busy', 'preparingNewChat', 'chats',
    ]) {
      assert.ok(Object.hasOwn(res.captured.body, field), `/state exposes ${field}`)
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

/**
 * Transient browser teardown must never latch a lasting engine error.
 *
 * Reported symptom: the panel showed "引擎错误：无法打开 http:…" and stayed
 * there. The real cause was `newChat()` doing its page work on the background
 * queue — so a restart, or closing the login window, could reject the
 * navigation that was in flight. The old code recorded that as
 * `setState('error', …)` AND left the dead page/context cached, and status()
 * only self-healed out of 'ready', so nothing ever cleared it.
 */
test('isShutdownError recognises teardown without swallowing real errors', async () => {
  const { isShutdownError } = await import('../src/engine/engine.ts')
  for (const message of [
    'page.waitForTimeout: Target page, context or browser has been closed',
    'Target closed',
    'page.goto: Target page, context or browser has been closed',
    'browserContext.close: Browser has been closed',
    'Browser closed',
    'Execution context was destroyed, most likely because of a navigation',
    'Protocol error (Target.sendMessageToTarget): Connection closed',
  ]) {
    assert.equal(isShutdownError(new Error(message)), true, `teardown: ${message}`)
  }
  for (const message of [
    'page.goto: net::ERR_INTERNET_DISCONNECTED at https://chat.deepseek.com',
    'page.goto: Timeout 45000ms exceeded',
    '无法启动浏览器（请检查 Chrome/Edge 是否已安装…）',
    'locator.click: Error: strict mode violation: resolved to 2 elements',
    'net::ERR_NAME_NOT_RESOLVED',
  ]) {
    assert.equal(isShutdownError(new Error(message)), false, `real failure: ${message}`)
  }
  // Non-Error throws must not blow up the classifier.
  assert.equal(isShutdownError('Target closed'), true)
  assert.equal(isShutdownError(undefined), false)
})

/**
 * A page/context pair whose `isClosed()` is false but whose every operation
 * rejects with a Playwright teardown message — i.e. the browser died between
 * the liveness check and the call, which is exactly the reported race.
 */
function deadPageMocks(navigationError: string) {
  const teardown = () => { throw new Error(navigationError) }
  const context = { close: async () => undefined }
  const page = {
    isClosed: () => false,
    goto: teardown,
    waitForTimeout: teardown,
    addInitScript: async () => undefined,
    setDefaultTimeout: () => undefined,
    evaluate: teardown,
    url: () => 'https://chat.deepseek.com',
    locator: teardown,
  }
  return { context, page }
}

test('the reported teardown leaves the engine stopped, not latched in error', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-teardown-'))
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      // status() only stores toggles and titles; a minimal store is enough.
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir: join(dataDir, 'profile') },
    )
    const { context, page } = deadPageMocks(
      'page.waitForTimeout: Target page, context or browser has been closed',
    )
    Object.assign(engine, { context, page })

    /*
     * openDeepSeekPage is the seam that produced the reported message, and
     * ensureBrowser() calls it on a fresh launch — so drive it directly rather
     * than going through ensureBrowser, which short-circuits on a page whose
     * isClosed() still reports false (the race being reproduced).
     */
    const navigate = (engine as unknown as { openDeepSeekPage(): Promise<void> }).openDeepSeekPage.bind(engine)
    await assert.rejects(() => navigate())
    assert.equal(engine.getState(), 'stopped', 'a teardown is not an engine error')
    assert.equal(engine.getEngineError(), undefined, 'no "无法打开 http:…" banner is latched')
    // The dead handles must be dropped, or every later call reuses a corpse.
    assert.equal((engine as unknown as { page?: unknown }).page, undefined)
    assert.equal((engine as unknown as { context?: unknown }).context, undefined)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('a genuinely dead navigation still latches a real error', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-realerr-'))
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir: join(dataDir, 'profile') },
    )
    const { context, page } = deadPageMocks(
      'page.goto: net::ERR_INTERNET_DISCONNECTED at https://chat.deepseek.com',
    )
    Object.assign(engine, { context, page })

    const navigate = (engine as unknown as { openDeepSeekPage(): Promise<void> }).openDeepSeekPage.bind(engine)
    await assert.rejects(() => navigate())
    assert.equal(engine.getState(), 'error')
    assert.match(String(engine.getEngineError()), /无法打开 https:\/\/chat\.deepseek\.com/)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('status clears a stale error once the browser is gone', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-selfheal-'))
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir: join(dataDir, 'profile') },
    )
    // The state the user was stuck on: an error plus a closed page.
    Object.assign(engine, {
      state: 'error',
      engineError: '无法打开 https://chat.deepseek.com：Target page, context or browser has been closed',
      page: { isClosed: () => true },
      context: { close: async () => undefined },
    })

    const status = await engine.status()
    assert.equal(status.engine, 'stopped', 'a stale error with a dead browser heals to stopped')
    assert.equal(status.engineError, undefined, 'the banner text is dropped')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('status keeps a real error while the browser is still connected', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-liveerr-'))
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir: join(dataDir, 'profile') },
    )
    Object.assign(engine, {
      state: 'error',
      engineError: '无法打开 https://chat.deepseek.com：net::ERR_INTERNET_DISCONNECTED',
      page: { isClosed: () => false, evaluate: () => ({}), url: () => 'https://chat.deepseek.com' },
      context: { close: async () => undefined },
    })

    const status = await engine.status()
    assert.equal(status.engineError, '无法打开 https://chat.deepseek.com：net::ERR_INTERNET_DISCONNECTED')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

/**
 * The double launch, pinned at the engine.
 *
 * Reported: clicking the composer started a browser, and then typing/sending
 * started ANOTHER one before the conversation worked. Two engine behaviours
 * produced that, and both are asserted here:
 *
 *   1. `openLoginWindow` disposed whatever was running before it opened the
 *      visible window — so a click that merely raced a stale "not logged in"
 *      snapshot tore down a working, authenticated page and relaunched it;
 *   2. the login watcher closed the browser once it saw the session, leaving the
 *      following send with no page, i.e. one more launch.
 *
 * These tests never touch a real browser: the engine's ONE launch seam
 * (`launchBrowser`) is replaced with a recorder. That is both safer and
 * sharper than the real call — it answers not just "how many launches" but
 * "was the launch in login mode", which is the whole first-run decision.
 */
function engineFixture(name: string) {
  const dataDir = mkdtempSync(join(tmpdir(), `dschat-${name}-`))
  return { dataDir, profileDir: join(dataDir, 'profile') }
}

/** A page whose only interesting answer is whether the chat UI is loaded. */
function pageMock(options: { signedIn: boolean; onBringToFront?: () => void }) {
  return {
    isClosed: () => false,
    url: () => (options.signedIn ? 'https://chat.deepseek.com/a/chat/s/abc' : 'https://chat.deepseek.com/sign_in'),
    // A mounted composer is what `isLoggedIn` reads as "the chat UI".
    locator: () => ({ count: async () => (options.signedIn ? 1 : 0) }),
    bringToFront: async () => { options.onBringToFront?.() },
  }
}

/**
 * Replace the launch seam with a recorder that hands back `page`.
 *
 * Returning the page AND installing it on the engine is what the real
 * `launchBrowser` does, so everything downstream (`isLoggedIn`, the login
 * watcher, a later send) sees a consistent engine.
 */
function recordLaunches(
  engine: unknown,
  page: unknown,
  context: { close: () => Promise<void> },
): Array<{ loginMode: boolean }> {
  const launches: Array<{ loginMode: boolean }> = []
  Object.assign(engine as object, {
    launchBrowser: async () => {
      launches.push({ loginMode: (engine as { loginMode: boolean }).loginMode })
      Object.assign(engine as object, { page, context })
      return page
    },
  })
  return launches
}

test('waking a live, signed-in page reuses it instead of launching a browser', async () => {
  const { dataDir, profileDir } = engineFixture('wake')
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir },
    )
    const counts = { disposed: 0 }
    const context = { close: async () => { counts.disposed++ } }
    const page = pageMock({ signedIn: true })
    Object.assign(engine, { context, page })
    const launches = recordLaunches(engine, page, context)

    const woken = await engine.wake()
    assert.equal(woken.ok, true)
    assert.equal(woken.loggedIn, true, 'a mounted composer means signed in')
    assert.equal(woken.launched, false, 'the live page was reused')
    assert.equal(launches.length, 0, 'and no browser was launched')
    assert.equal(counts.disposed, 0, 'nothing was torn down either')
    assert.equal(engine.getState(), 'stopped', 'the engine state was never even flipped to launching')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('openLoginWindow keeps a working signed-in browser instead of relaunching it', async () => {
  const { dataDir, profileDir } = engineFixture('login-reuse')
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir },
    )
    const counts = { disposed: 0, front: 0 }
    const context = { close: async () => { counts.disposed++ } }
    const page = pageMock({ signedIn: true, onBringToFront: () => { counts.front++ } })
    Object.assign(engine, { context, page })
    const launches = recordLaunches(engine, page, context)

    const opened = await engine.openLoginWindow()
    assert.equal(opened.ok, true)
    assert.equal(opened.reused, true, 'the page was reused')
    assert.equal(opened.launched, false)
    assert.equal(launches.length, 0, 'no second browser for an authenticated session')
    assert.equal(counts.disposed, 0, 'the working browser must not be disposed')
    assert.equal(counts.front, 1, 'it is brought forward instead, so the reader sees it')
    assert.equal((engine as unknown as { page?: unknown }).page, page, 'and it stays the engine\'s page')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('openLoginWindow still replaces a page that cannot log in (the sign-in screen)', async () => {
  const { dataDir, profileDir } = engineFixture('login-escalate')
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir },
    )
    const counts = { disposed: 0 }
    const context = { close: async () => { counts.disposed++ } }
    const stale = pageMock({ signedIn: false })
    Object.assign(engine, { context, page: stale })
    const launches = recordLaunches(engine, pageMock({ signedIn: false }), context)

    const opened = await engine.openLoginWindow()
    assert.equal(opened.ok, true)
    assert.equal(opened.loginWindow, true, 'a visible window is now waiting for the user')
    assert.ok(counts.disposed >= 1, 'the unusable page was disposed so a headed window can open')
    assert.equal(launches.length, 1, 'exactly one launch')
    assert.equal(launches[0].loginMode, true, 'and it is a HEADED one: the only launch a login can use')
    // Leave no login watcher polling behind (it would hold the test process
    // open for its full ten-minute window): this is the panel's 「关闭浏览器」.
    await engine.disposeBrowser()
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('the first wake on an empty profile goes straight to the login window', async () => {
  const { dataDir, profileDir } = engineFixture('first-run')
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir },
    )
    const context = { close: async () => undefined }
    const launches = recordLaunches(engine, pageMock({ signedIn: false }), context)

    const woken = await engine.wake()
    assert.equal(woken.ok, true)
    assert.equal(launches.length, 1, 'a first run launches ONCE, not twice')
    assert.equal(launches[0].loginMode, true, 'straight into the visible window')
    assert.equal(woken.loginWindow, true, 'and the panel is told not to ask for one itself')
    // Same reason as above: stop the watcher this wake started.
    await engine.disposeBrowser()
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('a profile that has run before wakes headless', async () => {
  const { dataDir, profileDir } = engineFixture('returning')
  try {
    // The mark `hasProfileData` looks for: a used profile holds cookies, so a
    // browser launched here is very likely still authenticated and must stay
    // out of the way.
    mkdirSync(join(profileDir, 'Default'), { recursive: true })
    writeFileSync(join(profileDir, 'Default', 'Cookies'), 'sqlite')
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir },
    )
    const context = { close: async () => undefined }
    const launches = recordLaunches(engine, pageMock({ signedIn: false }), context)

    const woken = await engine.wake()
    assert.equal(launches.length, 1)
    assert.equal(launches[0].loginMode, false, 'the quiet path: no visible window for a returning reader')
    assert.equal(woken.loginWindow, undefined, 'so the panel escalates only if it has to')
    assert.equal(woken.loggedIn, false, 'the page here is the sign-in screen')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('the login watcher keeps the page once the user signs in', async () => {
  const { dataDir, profileDir } = engineFixture('watch')
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir },
    )
    const counts = { disposed: 0 }
    const context = { close: async () => { counts.disposed++ } }
    // Not signed in yet — the state a login window starts in. The context is
    // NOT installed up front: a browser already there would be disposed on the
    // way in, and this test counts exactly those disposals.
    const page = pageMock({ signedIn: false })
    recordLaunches(engine, page, context)
    await engine.openLoginWindow()

    // The user signs in.
    Object.assign(page, pageMock({ signedIn: true }))
    await new Promise(resolve => setTimeout(resolve, 1_500))

    assert.equal(counts.disposed, 0, 'the browser is KEPT: closing it is what forced the second launch')
    assert.equal(engine.getState(), 'ready', 'and the engine reports a usable page')
    assert.equal(
      (engine as unknown as { loginMode: boolean }).loginMode, false,
      'the login window is no longer a login window — it is the working page',
    )
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('one launch serves every concurrent caller', async () => {
  const { dataDir, profileDir } = engineFixture('coalesce')
  try {
    const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
    const engine = new DeepSeekWebEngine(
      { createChat: () => ({ id: 'chat-1' }), listChats: () => [], getChat: () => undefined } as never,
      { dataDir, profileDir },
    )
    let launches = 0
    /*
     * Stand in for `launchBrowser`: it answers with a page that is alive but NOT
     * signed in, and it deliberately does NOT install itself on the engine —
     * that keeps `isPageAlive()` false, which is the state all three callers
     * arrive in (a page already alive short-circuits `ensureBrowser`).
     */
    Object.assign(engine, {
      launchBrowser: async () => {
        launches++
        await new Promise(resolve => setTimeout(resolve, 30))
        return pageMock({ signedIn: false })
      },
    })

    const [first, second, third] = await Promise.all([
      engine.ensureBrowser(),
      engine.ensureBrowser(),
      engine.ensureBrowser(),
    ])
    assert.equal(launches, 1, 'three callers, one browser')
    assert.equal(first, second)
    assert.equal(second, third)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

/**
 * Recover: the conversation must come back WHOLE and FAST.
 *
 * Two reported failures, one cause. `[data-virtual-list-item-key]` is a
 * virtualiser, so a single DOM read returns only the rows mounted around the
 * viewport (measured: a 16-message conversation rendered exactly 2). Every
 * recover therefore produced a 2-message transcript of a conversation that had
 * 30, while paying for a full page navigation and a fixed wait each time.
 *
 * The fix reads the conversation from its own history — from the page's
 * authenticated history endpoint first, then the app's IndexedDB cache, and
 * only then the DOM (harvested by walking the whole virtual list). These tests
 * pin each tier, its ordering, and the "recover again repairs a short import"
 * behaviour that the old title-only dedup made impossible.
 */

/** Fragment model as the web stores it (see WebFragment in engine.ts). */
const WEB_MESSAGE = (id: number, role: string, fragments: WebFragment[]): WebMessage =>
  ({ message_id: id, role, status: 'FINISHED', fragments })

/** A conversation as the page's history endpoint / cache returns it. */
function historyPayload(count = 4) {
  return {
    ok: true as const,
    title: '网页标题',
    messages: Array.from({ length: count }, (_, index) => index % 2 === 0
      ? WEB_MESSAGE(index + 1, 'USER', [{ type: 'REQUEST', content: `问题 ${index + 1}` }])
      : WEB_MESSAGE(index + 1, 'ASSISTANT', [
        { type: 'THINK', content: `思考 ${index + 1}` },
        { type: 'RESPONSE', content: `回答 ${index + 1}` },
      ])),
  }
}

/**
 * A page whose `evaluate` answers each engine call by its SOURCE, because the
 * engine distinguishes them that way too (the arguments are a selector, a
 * session id and so on, which overlap between calls).
 */
function webPage(options: {
  /** Answer for the history endpoint; `undefined` = the endpoint failed. */
  history?: unknown
  /** Answers for successive cache reads (last value repeats). */
  cache?: Array<unknown>
  /** Sidebar rows (omit to model "title not found"). */
  rows?: Array<{ title: string; sessionId?: string }>
  /** Rows the DOM harvest finds, in message order. */
  harvested?: Array<{ role: 'user' | 'assistant'; parts: Array<{ kind: 'think' | 'body'; markdown: string; text: string }> }>
  /** Whether clicking/goto actually navigates. */
  navigates?: boolean
  /** Whether the harvest mock should also report a mounted-row count. */
  initialUrl?: string
}) {
  let url = options.initialUrl ?? 'https://chat.deepseek.com/'
  const gotos: string[] = []
  const clicks: number[] = []
  let cacheReads = 0
  const rows = options.rows ?? []

  const locator = {
    count: async () => (rows.length === 0 ? 0 : 1),
    getAttribute: async () => '/a/chat/s/sid-1',
    click: async () => { clicks.push(1); if (options.navigates === true) url = 'https://chat.deepseek.com/a/chat/s/sid-1' },
    scrollIntoViewIfNeeded: async () => undefined,
    first: () => locator,
    filter: () => locator,
  }

  const page = {
    isClosed: () => false,
    url: () => url,
    locator: (selector: string) => {
      if (selector === 'textarea') return { count: async () => 1 }
      return locator
    },
    waitForFunction: async () => undefined,
    waitForTimeout: async () => undefined,
    reload: async () => undefined,
    goto: async (target: string) => {
      gotos.push(target)
      if (target.includes('/a/chat/s/')) url = target
    },
    evaluate: async (fn: unknown, arg?: unknown) => {
      const source = String(fn)
      // The two web-history readers are told apart by their source (each takes
      // a session id); the selector readers by the argument they are handed.
      if (source.includes('history_messages')) return options.history
      if (source.includes("'history-message'")) {
        const list = options.cache ?? []
        const value = list.length === 0 ? undefined : list[Math.min(cacheReads, list.length - 1)]
        cacheReads += 1
        return value
      }
      if (arg === 'a[href*="/a/chat/s/"]') return rows
      if (arg === '[data-virtual-list-item-key]') return options.harvested ?? []
      // probePage and friends
      return { pageAlive: true, url, messageItemCount: 0, markdownCount: 0 }
    },
  }
  const context = { close: async () => undefined }
  return { page, context, gotos, clicks, cacheReads: () => cacheReads }
}

async function engineWith(page: unknown, context: unknown, dataDir: string, store?: unknown) {
  const { DeepSeekWebEngine } = await import('../src/engine/engine.ts')
  const { TranscriptStore } = await import('../src/store.ts')
  // One store instance per test: two instances over the same file would each
  // keep their own in-memory copy, and the assertions would read a stale one.
  const transcripts = store ?? new TranscriptStore({ dataDir })
  const engine = new DeepSeekWebEngine(transcripts as never, { dataDir, profileDir: join(dataDir, 'profile') })
  Object.assign(engine, { page, context })
  return { engine, store: transcripts as InstanceType<typeof TranscriptStore> }
}

test('recover reads the whole conversation from the history endpoint without navigating', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-recover-api-'))
  try {
    const mocks = webPage({ history: historyPayload(32), rows: [{ title: '标题', sessionId: 'sid-1' }] })
    const { engine, store } = await engineWith(mocks.page, mocks.context, dataDir)
    const result = await engine.recoverWebConversation('标题')

    assert.equal(result.ok, true, result.error)
    assert.equal(result.source, 'history-api')
    assert.equal(result.messageCount, 32, 'every message comes back, not just the mounted rows')
    assert.equal(result.sessionId, 'sid-1')
    assert.equal(mocks.gotos.length, 0, 'the fast path must not navigate at all')
    assert.equal(mocks.clicks.length, 0, 'and must not click the sidebar')
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0]?.messages.length, 32)
    assert.equal(store.list()[0]?.webSessionId, 'sid-1', 'the session id is remembered for the next sync')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('recover falls back to the app cache, and only opens the page when both reads fail', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-recover-cache-'))
  try {
    const mocks = webPage({
      history: undefined,
      cache: [undefined, { title: '缓存标题', messages: historyPayload(6).messages }],
      rows: [{ title: '标题', sessionId: 'sid-1' }],
    })
    const { engine } = await engineWith(mocks.page, mocks.context, dataDir)
    const result = await engine.recoverWebConversation({ sessionId: 'sid-1', title: '标题' })

    assert.equal(result.ok, true, result.error)
    assert.equal(result.source, 'page-cache')
    assert.equal(result.messageCount, 6)
    assert.deepEqual(mocks.gotos, ['https://chat.deepseek.com/a/chat/s/sid-1'], 'the page is opened by its own deep link')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('recover harvests the DOM when the API and the cache are both empty', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-recover-dom-'))
  try {
    const mocks = webPage({
      history: undefined,
      cache: [undefined],
      rows: [{ title: '标题', sessionId: 'sid-1' }],
      harvested: [
        { role: 'user', parts: [{ kind: 'body', markdown: '', text: '问题' }] },
        { role: 'assistant', parts: [{ kind: 'body', markdown: '<p>回答</p>', text: '回答' }] },
      ],
    })
    const { engine } = await engineWith(mocks.page, mocks.context, dataDir)
    const result = await engine.recoverWebConversation('标题')

    assert.equal(result.ok, true, result.error)
    assert.equal(result.source, 'dom')
    assert.equal(result.messageCount, 2)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('recover refuses a title that is not in the sidebar', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-recover-missing-'))
  try {
    const mocks = webPage({ history: historyPayload(2), rows: [] })
    const { engine } = await engineWith(mocks.page, mocks.context, dataDir)
    const result = await engine.recoverWebConversation('不存在的会话')
    assert.equal(result.ok, false)
    assert.match(String(result.error), /未在网页端找到会话/)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('recover says what is empty instead of blaming a redesign', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-recover-empty-'))
  try {
    const mocks = webPage({ history: undefined, cache: [undefined], rows: [{ title: '标题', sessionId: 'sid-1' }], harvested: [] })
    const { engine } = await engineWith(mocks.page, mocks.context, dataDir)
    const result = await engine.recoverWebConversation('标题')
    assert.equal(result.ok, false)
    assert.match(String(result.error), /未能读到/)
    assert.equal(/已改版/.test(String(result.error)), false, 'no unfalsifiable "page redesigned"')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('a second recover repairs a transcript that was imported short', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-recover-upsert-'))
  try {
    const { TranscriptStore } = await import('../src/store.ts')
    const store = new TranscriptStore({ dataDir })
    // What the old DOM-only recover left behind: the last exchange only.
    const short = store.importTranscript({
      title: '标题',
      model: 'deepseek-chat',
      messages: [
        { id: 'm1', role: 'user', content: '最后的问题', ts: 1 },
        { id: 'm2', role: 'assistant', content: '最后的回答', ts: 2 },
      ],
    })
    assert.equal(short.created, true)

    const mocks = webPage({ history: historyPayload(30), rows: [{ title: '标题', sessionId: 'sid-1' }] })
    const { engine } = await engineWith(mocks.page, mocks.context, dataDir, store)
    const result = await engine.recoverWebConversation('标题')

    assert.equal(result.ok, true, result.error)
    assert.equal(result.created, false, 'the existing transcript is reused, not duplicated')
    assert.equal(result.updated, true, 'and it is overwritten with the fuller history')
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0]?.messages.length, 30)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('recover never truncates a stored transcript with a shorter history', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-recover-nochurn-'))
  try {
    const { TranscriptStore } = await import('../src/store.ts')
    const store = new TranscriptStore({ dataDir })
    store.importTranscript({
      title: '标题',
      model: 'deepseek-chat',
      messages: Array.from({ length: 12 }, (_, index) => ({ id: `m${index}`, role: 'user' as const, content: 'x'.repeat(500), ts: index })),
    })
    const mocks = webPage({ history: historyPayload(4), rows: [{ title: '标题', sessionId: 'sid-1' }] })
    const { engine } = await engineWith(mocks.page, mocks.context, dataDir, store)
    const result = await engine.recoverWebConversation('标题')
    assert.equal(result.ok, true, result.error)
    assert.equal(result.updated, false)
    assert.equal(store.list()[0]?.messages.length, 12, 'the stored copy survives')
    assert.equal(store.list()[0]?.webSessionId, 'sid-1', 'but the id is still adopted')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('the web message model converts to markdown, thinking and attachments', async () => {
  const { webMessagesToScraped } = await import('../src/engine/engine.ts')
  const scraped = webMessagesToScraped([
    WEB_MESSAGE(1, 'USER', [
      { type: 'FILE', files: [{ file_name: 'image.png' }] },
      { type: 'REQUEST', content: '这张图对吗？' },
    ]),
    WEB_MESSAGE(2, 'ASSISTANT', [
      { type: 'TOOL_SEARCH', content: '搜索到 2 个网页', queries: [{ query: '翻译研究' }], results: [{ url: 'https://a.example/1', title: '甲页' }, {}] },
      { type: 'THINK', content: '先分析图片。' },
      { type: 'RESPONSE', content: '**有依据**但不全面[citation:1]。' },
      { type: 'TIP', content: '本回答由 AI 生成' },
    ]),
  ])

  assert.equal(scraped.length, 2)
  const [user, assistant] = scraped
  assert.equal(user?.role, 'user')
  assert.match(user?.parts[0]?.text ?? '', /这张图对吗？/)
  assert.match(user?.parts[0]?.text ?? '', /附件：image\.png/, 'attachments are named, not dropped')

  const thinking = assistant?.parts.find(part => part.kind === 'think')?.text ?? ''
  assert.match(thinking, /先分析图片。/)
  assert.match(thinking, /搜索到 2 个网页/, 'search steps are kept, like the live stream parser does')
  assert.match(thinking, /- 翻译研究/)
  assert.equal(/本回答由 AI 生成/.test(thinking), false, 'the UI disclaimer is not conversation')

  const body = assistant?.parts.find(part => part.kind === 'body')?.text ?? ''
  assert.equal(body, '**有依据**但不全面[citation:1]。', 'the answer markdown is taken verbatim, not HTML-escaped')

  /*
   * The stored fragments are the ONLY place a recovered conversation's source
   * URLs exist — the rendered page keeps them in its own state — so this is
   * what makes `[citation:1]` clickable after a 从网页恢复. Entry count is the
   * numbering: a result with no url is dropped, and the rest keep their order.
   */
  assert.deepEqual(assistant?.sources, [{ url: 'https://a.example/1', title: '甲页' }],
    'the search results become the source table of that message, in citation order')

  /*
   * POSITIONS ARE THE CONTRACT. `[citation:N]` indexes this list, so a result
   * the page named no URL for must keep its SLOT instead of being filtered out
   * — otherwise `[citation:2]` slides onto the first source and the answer
   * links its claim to the wrong page.
   */
  const positional = webMessagesToScraped([
    WEB_MESSAGE(1, 'USER', [{ type: 'REQUEST', content: '问' }]),
    WEB_MESSAGE(2, 'ASSISTANT', [
      { type: 'TOOL_SEARCH', content: '搜索到 2 个网页', results: [{}, { url: 'https://b.example/2', title: '乙页' }] },
      { type: 'RESPONSE', content: '结论[citation:2]。' },
    ]),
  ])
  assert.deepEqual(positional[1]?.sources, [{ url: '' }, { url: 'https://b.example/2', title: '乙页' }],
    'an unnamed result holds its slot rather than shifting the ones after it')
})

test('raw reference markers become the citation chips the panel renders', async () => {
  const { webMessagesToScraped } = await import('../src/engine/engine.ts')
  const scraped = webMessagesToScraped([
    WEB_MESSAGE(1, 'USER', [{ type: 'REQUEST', content: '问' }]),
    WEB_MESSAGE(2, 'ASSISTANT', [{ type: 'RESPONSE', content: '看官方 MV[reference:5]，另有[reference:12]。' }]),
  ])
  const body = scraped[1]?.parts.find(part => part.kind === 'body')?.text ?? ''
  assert.equal(body, '看官方 MV[citation:5]，另有[citation:12]。')
  assert.equal(/\[reference:/.test(body), false, 'the raw spelling never reaches the transcript')
})

test('recovered markdown is not mangled by the HTML converter', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-recover-markdown-'))
  try {
    const answer = '# 标题\n\n**粗体**与 `代码`\n\n- 一\n- 二\n\n| a | b |\n| - | - |\n| 1 | 2 |'
    const mocks = webPage({
      history: { ok: true, title: '标题', messages: [
        WEB_MESSAGE(1, 'USER', [{ type: 'REQUEST', content: '问题' }]),
        WEB_MESSAGE(2, 'ASSISTANT', [{ type: 'RESPONSE', content: answer }]),
      ] },
      rows: [{ title: '标题', sessionId: 'sid-1' }],
    })
    const { engine, store } = await engineWith(mocks.page, mocks.context, dataDir)
    await engine.recoverWebConversation('标题')
    const content = store.list()[0]?.messages[1]?.content ?? ''
    assert.ok(content.includes('**粗体**'), `markdown survived: ${content}`)
    assert.ok(content.includes('| a | b |'), 'tables survive')
    assert.equal(/&lt;|&quot;/.test(content), false, 'nothing got HTML-escaped on the way in')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
/**
 * The composer is an ORDINARY text field.
 *
 * Both ways this box used to refuse the reader are pinned here, because each was
 * reported as its own bug:
 *
 *   - `disabled` (the first version) dropped every pointer event — 「点击输入框
 *     无反应」;
 *   - `readOnly` (the fix for that) kept the caret but still refused TEXT: with
 *     the web page down, or while a reply was streaming, the one control on
 *     screen that looks like a text field could not hold a sentence. The reader
 *     who pastes a screenshot and then wants to describe it had nowhere to type.
 *
 * So: neither attribute, in any engine state. What the gestures MEAN is decided
 * by the handlers — clicking or focusing starts the page in the background
 * (`onFocus` alone is not enough: clicking a box that is already focused fires
 * no focus event, which is the second attempt after a failed start).
 */
test('the composer is editable in every engine state, and starting is a side effect', async () => {
  const { readFileSync } = await import('node:fs')
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')
  const start = panel.indexOf("className: 'dsh-dschat-input'")
  assert.ok(start > -1, 'the composer textarea exists')
  const block = panel.slice(start, panel.indexOf('}),', start))
  assert.equal(
    /disabled:/.test(block), false,
    'the composer must not use `disabled`: that drops pointer events entirely, which is the reported "点击输入框无反应"',
  )
  assert.equal(
    /readOnly:/.test(block), false,
    'and it must not use readOnly either: the field has to accept text while the engine is down and while a reply streams',
  )
  assert.ok(/onFocus:/.test(block), 'focusing it is wired to starting the engine')
  assert.ok(/onClick:/.test(block), 'so is clicking it — a click on an already-focused box fires no focus event')
  // Placeholder: the only thing that reports engine state in the field, and it
  // never says "waiting for the reply" (requirement 2).
  assert.equal(
    /composer\.busy/.test(block), false,
    'a running turn does not turn the composer into a status display',
  )
  /*
   * The send control is armed by CONTENT, not by engine state: a message typed
   * before the page is up, or during a reply, has to be submittable.
   */
  assert.ok(
    /const canSend = draft\.trim\(\) !== '' \|\| images\.length > 0/.test(panel),
    'send is armed by the draft, not by `loggedIn`/`busy`',
  )
})

/**
 * A start that fails explains itself IN THE CONVERSATION, with a retry.
 *
 * Reported: with the page down, the composer said nothing useful and the failed
 * launch was a toast — gone before the reader looked back from the browser
 * window, and with nothing to click. The notice is the fix: it renders at the
 * end of the thread (both in an empty conversation and under the last message),
 * it stays until the engine is up, and it carries the one action that can fix
 * it. `force` matters: the automatic start is deliberately rate-limited after a
 * failure, and the button must not be swallowed by that.
 */
test('a failed engine start reports itself in the conversation with a retry', async () => {
  const { readFileSync } = await import('node:fs')
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')

  assert.ok(/const \[launchError, setLaunchError\] = useState/.test(panel), 'the failure is state, not a toast')
  assert.match(panel, /dsh-dschat-notice/, 'it renders as a notice card')
  assert.ok(
    /engine\.notice\.retry/.test(panel) && /engine\.notice\.title/.test(panel),
    'the notice is titled and carries a retry label',
  )
  // It is inside the thread — the conversation is where the failed message was.
  const thread = panel.slice(panel.indexOf('function thread()'), panel.indexOf('function messageNode'))
  assert.ok(thread.includes('engineNotice()'), 'the notice renders at the end of the transcript')
  // The retry button forces the start past the failure cooldown.
  const retry = panel.slice(panel.indexOf('const retryEngine'), panel.indexOf('const send ='))
  assert.ok(/ensureReady\(\{ force: true \}\)/.test(retry), 'the retry button ignores the cooldown')
  assert.ok(
    /WAKE_RETRY_COOLDOWN_MS/.test(panel),
    'the automatic start is rate-limited after a failure, so a dead engine is not relaunched per keystroke',
  )
  /*
   * And the failure paths actually set it: one per way a start can go wrong
   * (no answer at all, a host too old for /wake, and a page that wants a
   * sign-in), each with its own sentence — a single generic "启动失败" would
   * leave the reader with nothing to act on.
   */
  for (const key of ['engine.notice.unreachable', 'engine.notice.staleHost', 'engine.notice.needLogin']) {
    assert.ok(panel.includes(`'${key}'`), `\`${key}\` is reported`)
  }
  assert.ok(
    (panel.match(/setLaunchError\(/g) ?? []).length >= 4,
    'every failure path (and the retry) touches the notice state',
  )
})

/**
 * A message written while a reply streams is QUEUED, not refused.
 *
 * The web page answers one question at a time, so a second send genuinely cannot
 * go out immediately — but the reader is typing into an ordinary composer, and
 * the old answers were both wrong: the engine refused it with BUSY, and the
 * panel pre-empted that by disabling send (`!canSend`). The message now waits in
 * the panel's own outbox and leaves when the turn ends.
 */
test('a message sent during a turn waits in the outbox instead of being refused', async () => {
  const { readFileSync } = await import('node:fs')
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')

  assert.ok(/const \[outbox, setOutbox\] = useState<QueuedMessage\[\]>/.test(panel), 'the outbox exists')
  const send = panel.slice(panel.indexOf('const send = useCallback'), panel.indexOf('const stop = useCallback'))
  assert.ok(
    /if \(busy \|\| streaming\) \{[\s\S]*?enqueue\(text, sentImages\)/.test(send),
    'a send during a turn is queued rather than dropped',
  )
  assert.ok(
    /outcome === 'busy'\) enqueue\(text, sentImages\)/.test(send),
    'the engine saying BUSY (a stale panel snapshot) is queued too, not shown as an error',
  )
  // The queue drains itself when the turn ends, and only then.
  const drain = panel.slice(panel.indexOf('const drainOutbox'), panel.indexOf('const send = useCallback'))
  assert.ok(/if \(busy \|\| streaming\) return/.test(drain), 'the drain waits for the turn to end')
  assert.ok(
    /if \(launchError !== undefined\) return/.test(drain),
    'and it stops retrying while a failure notice is up, so a dead engine cannot spin',
  )
  // It is visible and cancellable: a queue the reader cannot see is one they
  // will type again.
  assert.match(panel, /dsh-dschat-queue-item/, 'queued messages are rendered')
  assert.ok(/composer\.queue\.cancel/.test(panel), 'and each row can be cancelled')
})

test('the offline composer explains itself without pretending to be a button', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(join(root, 'src/client/panel/styles.ts'), 'utf8')
  assert.ok(
    /\.dsh-dschat-card\[data-engine="off"\] \.dsh-dschat-input::placeholder/.test(css),
    'the offline state tints the placeholder, which is what says "this will start the page"',
  )
  assert.ok(
    /\.dsh-dschat-card\[data-engine="off"\] \{/.test(css),
    'the card is tinted while the engine is down',
  )
  assert.equal(
    /\.dsh-dschat-input:read-only/.test(css), false,
    'no rule keys off a read-only composer any more: the field has no such state',
  )
  const panel = readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')
  assert.ok(
    /'data-engine': loggedIn === true && engineLive \? 'on' : 'off'/.test(panel),
    'the panel sets the marker the stylesheet keys off',
  )
  const locales = readFileSync(join(root, 'src/client/locales.ts'), 'utf8')
  assert.ok(/composer\.offline/.test(locales), 'the offline placeholder exists')
  assert.ok(/composer\.queue\.note/.test(locales), 'and so does the queue hint')
})

/* --------------------------------------------------------------- streaming */

/**
 * The reply loop must READ ONLY THE NEW BYTES.
 *
 * The whole-buffer version shipped the entire accumulated SSE body to Node on
 * every tick — ~742 KiB per read by the end of a 40k-character reply — and then
 * re-parsed it from scratch, so the cost of a tick grew with the length of the
 * reply and the output arrived in ever-larger paragraphs. Both halves of that
 * mistake are pinned here because either one alone reintroduces the symptom.
 */
test('the reply loop reads only the bytes that are new', async () => {
  const { readFileSync } = await import('node:fs')
  const engine = readFileSync(join(root, 'src/engine/engine.ts'), 'utf8')

  assert.ok(/__wcCursor/.test(engine), 'the page-side read cursor exists')
  assert.ok(
    /stream\.text\.slice\(cursor\)/.test(engine),
    'readCapture returns a slice from the cursor, not the whole buffer',
  )
  assert.ok(
    /w\.__wcCursor = 0/.test(engine),
    'a new turn rewinds the cursor with the capture buffer, or the first read is empty',
  )
  assert.equal(
    /parseStreamReply\(\s*capture\.text\s*\)/.test(engine), false,
    'the loop must not re-parse the whole accumulated stream',
  )
  assert.ok(
    /createStreamReplyParser\(\)/.test(engine),
    'it keeps one incremental parser for the turn',
  )

  // The tick is what bounds how smooth the panel can ever be: at 350 ms nothing
  // downstream can beat ~3 Hz.
  const tick = /const STREAM_TICK_MS = (\d[\d_]*)/.exec(engine)
  assert.ok(tick !== null, 'the tick is a named constant')
  assert.ok(Number(tick[1].replaceAll('_', '')) <= 150, `the tick is fast (got ${tick[1]} ms)`)
  assert.ok(
    /waitForTimeout\(STREAM_TICK_MS\)/.test(engine),
    'the loop waits on that constant rather than a literal',
  )
  assert.equal(
    /waitForTimeout\(350\)/.test(engine), false,
    'no 350 ms literal is left in the stream loop',
  )

  // The DOM fallback used to mean "3 ticks", which silently became 240 ms once
  // the tick got faster — long enough to freeze a stale reply as this turn's.
  assert.ok(/DOM_STABLE_MS/.test(engine), 'the fallback stability window is wall-clock')
  assert.equal(/domStable/.test(engine), false, 'the tick-counting version is gone')
})

/**
 * `/tail` exists so the panel can update ~10×/s without serializing the whole
 * store each time. Its value is entirely in what it does NOT carry, so that is
 * what this asserts: one message, no `chats`, no engine round trip.
 */
test('the tail route answers with one message, never the whole store', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-tail-'))
  try {
    const { ctx, routes } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })
    const table = routes as Route[]

    const restore = table.find(route => route.path === '/api/dsh-dschat/restore')!
    const body = '金庸的武侠小说'.repeat(400)
    const restored = fakeResponse()
    await restore.handler(
      fakeRequest({ title: '流式测试', model: 'deepseek-chat', messages: [
        { id: 'u1', role: 'user', content: '问题', ts: 1 },
        { id: 'a1', role: 'assistant', content: body, ts: 2 },
      ] }),
      restored,
    )
    const chatId = restored.captured.body.chatId as string
    assert.ok(typeof chatId === 'string' && chatId !== '', 'the fixture chat exists')

    const tail = table.find(route => route.path === '/api/dsh-dschat/tail')!
    const first = fakeResponse()
    await tail.handler(fakeRequest(undefined, '127.0.0.1:19387', '127.0.0.1', `/api/dsh-dschat/tail?chat=${chatId}&at=0`), first)

    assert.equal(first.captured.status, 200)
    assert.equal(first.captured.body.ok, true)
    assert.equal(first.captured.body.chatId, chatId)
    assert.equal(first.captured.body.message.tail, body, 'an unknown client gets the whole message body')
    assert.equal(first.captured.body.message.head, 0)
    assert.equal(first.captured.body.message.length, body.length)
    assert.equal(
      Object.hasOwn(first.captured.body, 'chats'), false,
      'the response must not carry the transcript store — that is what /state is for',
    )
    assert.ok(
      JSON.stringify(first.captured.body).length < 4_000,
      'and it stays small: one message, not 108 chats',
    )
    assert.equal(
      Object.hasOwn(first.captured.body, 'deepThink'), false,
      '/tail must not read the page toggles: that would put a CDP round trip on the hot path',
    )

    // The very next tick, with the client holding what it was just given, is a
    // no-op delta rather than a resend.
    const second = fakeResponse()
    await tail.handler(fakeRequest(undefined, '127.0.0.1:19387', '127.0.0.1', `/api/dsh-dschat/tail?chat=${chatId}&at=${body.length}`), second)
    assert.equal(second.captured.body.message.head, body.length, 'the unchanged prefix is acknowledged')
    assert.equal(second.captured.body.message.tail, '', 'nothing is resent')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

/**
 * The reasoning duration's wire contract.
 *
 * The web page shows 「已思考（用时 X 秒）」, but neither its stored history nor its
 * fragments carry that number — the engine times the turn itself and writes it
 * onto the message. The tail is then the only feed the panel has while the
 * answer streams, so the measurement has to travel on it, and it has to stay
 * absent (not zero) for a reply that carried no reasoning at all: a zero would
 * render as 「用时 1 秒」.
 */
test('the tail carries the reasoning duration, and stays quiet without one', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-thinking-'))
  try {
    const { ctx, routes } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })
    const table = routes as Route[]
    const restore = table.find(route => route.path === '/api/dsh-dschat/restore')!
    const tail = table.find(route => route.path === '/api/dsh-dschat/tail')!

    const reasoned = fakeResponse()
    await restore.handler(
      fakeRequest({ title: '深度思考', model: 'deepseek-reasoner', messages: [
        { id: 'u1', role: 'user', content: '问题', ts: 1 },
        {
          id: 'a1', role: 'assistant', ts: 2, thinkingMs: 12_400,
          content: '<details><summary>思考过程</summary>\n\n推理\n\n</details>\n\n答案。',
        },
      ] }),
      reasoned,
    )
    const withTime = fakeResponse()
    await tail.handler(fakeRequest(
      undefined, '127.0.0.1:19387', '127.0.0.1',
      `/api/dsh-dschat/tail?chat=${reasoned.captured.body.chatId as string}&at=0`,
    ), withTime)
    assert.equal(withTime.captured.status, 200)
    assert.equal(withTime.captured.body.message.thinkingMs, 12_400, 'the measurement reaches the panel')

    // A plain reply (no reasoning) must not gain a duration from nowhere.
    const plain = fakeResponse()
    await restore.handler(
      fakeRequest({ title: '普通回复', model: 'deepseek-chat', messages: [
        { id: 'u1', role: 'user', content: '问题', ts: 1 },
        { id: 'a1', role: 'assistant', content: '答案。', ts: 2 },
      ] }),
      plain,
    )
    const without = fakeResponse()
    await tail.handler(fakeRequest(
      undefined, '127.0.0.1:19387', '127.0.0.1',
      `/api/dsh-dschat/tail?chat=${plain.captured.body.chatId as string}&at=0`,
    ), without)
    assert.equal(
      Object.hasOwn(without.captured.body.message, 'thinkingMs'), false,
      'no reasoning, no duration — 0 would render as 「用时 1 秒」',
    )
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

/**
 * Where the duration comes from.
 *
 * Not the page (it stores no timing) and not the panel (it sees one delta at a
 * time): the reply loop times its own turn — first reasoning fragment to first
 * answer fragment — and writes the result on every message it stores, including
 * the last one. Two cases must deliberately measure NOTHING, and they are the
 * ones a well-meaning simplification breaks: a reply with no reasoning, and a
 * snapshot that arrives with reasoning AND answer together (a DOM scrape of a
 * finished reply), where the interval was never observed.
 */
test('the reply loop times the reasoning it streams, and only when it saw it', async () => {
  const engine = readFileSync(join(root, 'src/engine/engine.ts'), 'utf8')

  assert.ok(/noteThinking\(/.test(engine), 'the loop advances a reasoning clock')
  assert.ok(/hasAnswerBody/.test(engine), 'the answer boundary is the shared rule, not a local regex')
  assert.match(
    engine,
    /thinkingMs = Date\.now\(\) - thinkingStartedAt/,
    'the duration is the measured interval, not an estimate',
  )
  assert.match(
    engine,
    /!markdown\.trimStart\(\)\.startsWith\('<details>'\) \|\| hasAnswer\) return/,
    'a snapshot that already carried both halves is not timed at all',
  )
  assert.ok(
    /thinkingMs === undefined \? \{\} : \{ thinkingMs \}/.test(engine),
    'every store write carries the measurement (streaming, final and error paths)',
  )
  // The label has to be able to say "still thinking", which is exactly the
  // window where the duration does not exist yet.
  assert.ok(
    /msg\.thought\.running/.test(readFileSync(join(root, 'src/client/panel/DSchatPanel.tsx'), 'utf8')),
    'and the panel distinguishes "still thinking" from "thought, unmeasured"',
  )
})

/**
 * The citation table's wire contract.
 *
 * `[citation:N]` is a number in the answer text, so the panel can only make it
 * clickable if the message's own source table reaches the browser. The tail is
 * the hot path (10 folds/s), which is why the table travels WHOLE and only when
 * there is one: an empty array would erase the table on the next tick, and a
 * delta would point citations at the wrong source.
 */
test('a cited reply hands its source table to the panel, and an uncited one stays quiet', async () => {
  const { mod, dispose } = await loadPlugin()
  const dataDir = mkdtempSync(join(tmpdir(), 'dschat-sources-'))
  try {
    const { ctx, routes } = fakeContext()
    mod.apply(ctx, { dataDir, profileDir: join(dataDir, 'profile') })
    const table = routes as Route[]

    const restore = table.find(route => route.path === '/api/dsh-dschat/restore')!
    const cited = fakeResponse()
    await restore.handler(
      fakeRequest({ title: '带来源', model: 'deepseek-chat', messages: [
        { id: 'u1', role: 'user', content: '问题', ts: 1 },
        {
          id: 'a1', role: 'assistant', content: '有依据[citation:1]。', ts: 2,
          sources: [{ url: 'https://a.example/1', title: '甲页' }, { url: 'https://b.example/2' }],
        },
      ] }),
      cited,
    )
    const plain = fakeResponse()
    await restore.handler(
      fakeRequest({ title: '无来源', model: 'deepseek-chat', messages: [
        { id: 'u2', role: 'user', content: '问题', ts: 1 },
        { id: 'a2', role: 'assistant', content: '没有搜索。', ts: 2 },
      ] }),
      plain,
    )

    const tail = table.find(route => route.path === '/api/dsh-dschat/tail')!
    const withSources = fakeResponse()
    const citedId = cited.captured.body.chatId as string
    await tail.handler(fakeRequest(undefined, '127.0.0.1:19387', '127.0.0.1', `/api/dsh-dschat/tail?chat=${citedId}&at=0`), withSources)
    assert.deepEqual(withSources.captured.body.message.sources, [
      { url: 'https://a.example/1', title: '甲页' },
      { url: 'https://b.example/2' },
    ], 'the whole table rides the tail, in citation order')

    const bare = fakeResponse()
    const plainId = plain.captured.body.chatId as string
    await tail.handler(fakeRequest(undefined, '127.0.0.1:19387', '127.0.0.1', `/api/dsh-dschat/tail?chat=${plainId}&at=0`), bare)
    assert.equal(
      Object.hasOwn(bare.captured.body.message, 'sources'), false,
      'no search means no field at all — an empty array would erase a stored table',
    )

    // /state carries the same messages, so a reload or a chat switch keeps them.
    const state = fakeResponse()
    const stateRoute = table.find(route => route.path === '/api/dsh-dschat/state')!
    await stateRoute.handler(fakeRequest(), state)
    const stored = (state.captured.body.chats as Array<{ id: string; messages: Array<Record<string, unknown>> }>)
      .find(chat => chat.id === citedId)
    assert.deepEqual(stored?.messages[1]?.sources, [
      { url: 'https://a.example/1', title: '甲页' },
      { url: 'https://b.example/2' },
    ], 'and the store keeps the table across a full snapshot')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    dispose()
  }
})

/**
 * An agent reading a transferred transcript has no panel to resolve
 * `[citation:N]` in, so the source table has to travel as markdown too.
 */
test('a transferred transcript carries its sources as footnote links', async () => {
  /*
   * `transfer.ts` imports the harness SDK (`@deepseek-ai/dsh-llm` and friends),
   * which only resolves inside a running harness, so it is bundled with those
   * specifiers aliased away — the same seam the plugin's own loader uses.
   */
  const bundleDir = mkdtempSync(join(tmpdir(), 'dschat-transfer-md-'))
  const outfile = join(bundleDir, 'transfer.mjs')
  await build({
    entryPoints: [join(root, 'src/transfer.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    alias: {
      '@deepseek-ai/dsh-llm': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-session': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-tools': join(root, 'test/stubs/harness.ts'),
      '@deepseek-ai/dsh-workspace': join(root, 'test/stubs/harness.ts'),
      'playwright-core': join(root, 'test/stubs/harness.ts'),
    },
  })
  const { renderMessagesMarkdown } = await import(pathToFileURL(outfile).href) as {
    renderMessagesMarkdown: (messages: unknown[], options?: { excludeThinking?: boolean }) => string
  }
  const markdown = renderMessagesMarkdown([
    { id: 'u1', role: 'user', content: '问', ts: 1 },
    {
      id: 'a1', role: 'assistant', content: '有依据[citation:1]。', ts: 2,
      sources: [{ url: 'https://a.example/1', title: '甲页' }, { url: 'https://b.example/2' }],
    },
    { id: 'a2', role: 'assistant', content: '没有搜索。', ts: 3 },
  ])
  assert.match(markdown, /> 参考来源：\[1\] \[甲页\]\(https:\/\/a\.example\/1\) · \[2\] \[https:\/\/b\.example\/2\]\(https:\/\/b\.example\/2\)/,
    'sources are numbered to match the markers, with the URL as the fallback label')
  assert.equal(
    (markdown.match(/参考来源/g) ?? []).length, 1,
    'a reply that cited nothing gets no footnote block',
  )
  // The markers themselves stay untouched: the distilled brief is built from
  // this text, and rewriting it would leak panel vocabulary into the session.
  assert.ok(markdown.includes('有依据[citation:1]。'), 'the answer text is passed through verbatim')

  // Numbering follows the TABLE, not the footnote list: a source the page named
  // no URL for leaves a gap, so `[2]` still means the second source.
  const gapped = renderMessagesMarkdown([
    {
      id: 'a3', role: 'assistant', content: '结论[citation:2]。', ts: 4,
      sources: [{ url: '' }, { url: 'https://b.example/2', title: '乙页' }],
    },
  ])
  assert.match(gapped, /> 参考来源：\[2\] \[乙页\]\(https:\/\/b\.example\/2\)/, 'the second source keeps number 2')
  assert.equal(/\[1\]/.test(gapped), false, 'an unnamed source is simply not listed')
  rmSync(bundleDir, { recursive: true, force: true })
})
