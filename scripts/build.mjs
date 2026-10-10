/**
 * dsh-DSchat build.
 *
 * Two artifacts, because the plugin has two runtimes:
 *
 *   lib/index.js   Host half — ESM for the Electron/Node side. Everything the
 *                  harness ships (`@deepseek-ai/*`) and playwright-core stays
 *                  external: the plugin must run against the harness's own
 *                  module instances, not a private copy.
 *
 *   lib/client.js  Browser half — the harness's Client module table loads a
 *                  lazy factory through `window.__ModuleLoader__.load({ id,
 *                  factory })`. React comes from that table, so react,
 *                  react-dom and react/jsx-runtime stay external and are
 *                  resolved through the `require` the loader passes in. The
 *                  bundle is emitted as CJS and wrapped in the envelope the
 *                  loader expects; the wrapper supplies the local `module` /
 *                  `exports` the CJS output writes to.
 *
 * No build scripts run at install time; esbuild resolves its platform binary
 * from its own optional dependency.
 */

import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'lib')
const watch = process.argv.includes('--watch')

/**
 * The version and build time, baked into both bundles.
 *
 * "Which version am I actually running?" had four different answers on this
 * machine (package.json, the git tag, the newest tarball, and whatever
 * uncommitted tree the profile had linked). The one answer that is always right
 * is the one baked into the running bundle, so the status card reports it —
 * and a build time, because a rebuilt-but-unchanged version is exactly the case
 * where version alone cannot tell two builds apart.
 */
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const BUILD_TIME = new Date().toISOString()
const DEFINE = {
  __DSCHAT_VERSION__: JSON.stringify(String(pkg.version)),
  __DSCHAT_BUILD__: JSON.stringify(BUILD_TIME),
}

/** Package name — also the Client module id the loader keys the factory by. */
const PKG = 'dsh-dschat'

/** Harness packages resolve from the running harness, never from the bundle. */
const HARNESS_EXTERNAL = [
  '@deepseek-ai/*',
]

/**
 * Host-half externals.
 *
 * `@deepseek-ai/*` and playwright-core resolve at runtime (the former from the
 * running harness, the latter from this package's own node_modules).
 * Everything else — notably `schemastery` — is BUNDLED: a `link:`-installed
 * package resolves third-party imports from its real path, so a bare
 * `schemastery` import would not resolve from the profile. The shipped
 * dsh-webchat plugin inlines it for the same reason.
 */
const HOST_EXTERNAL = [
  ...HARNESS_EXTERNAL,
  'playwright-core',
]

/** Browser module-table entries the Client half resolves at runtime. */
const CLIENT_EXTERNAL = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  ...HARNESS_EXTERNAL,
]

mkdirSync(outDir, { recursive: true })

/** Common options shared by both halves. */
const common = {
  bundle: true,
  logLevel: 'info',
  sourcemap: false,
  minify: false,
  target: ['node22'],
  legalComments: 'none',
  define: DEFINE,
}

/**
 * Host half: plain ESM the Node side imports directly, emitted straight to the
 * package entry `lib/index.js`.
 *
 * There is no loader indirection: the harness imports this file as-is and
 * collapses any import-time failure into a bare "failed to import" (see README,
 * 「两个会让插件"静默加载失败"的坑」), so a wrong external or a missing export
 * shows up there and nowhere else.
 */
const hostOptions = {
  ...common,
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(outDir, 'index.js'),
  format: 'esm',
  platform: 'node',
  external: HOST_EXTERNAL,
}

/** Browser half: CJS, then wrapped in the loader envelope. */
const clientOptions = {
  ...common,
  entryPoints: [join(root, 'src/client/index.ts')],
  outfile: join(outDir, 'client.body.js'),
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: CLIENT_EXTERNAL,
  target: ['chrome120'],
}

/**
 * Wrap the emitted CJS body in the Client module envelope. The `id` must equal
 * the package name: the loader keys factories by it.
 * @param body - the CJS bundle text.
 * @returns the wrapped module source.
 */
function wrapClient(body) {
  return `window.__ModuleLoader__.load({
	id: ${JSON.stringify(PKG)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${body}
		if (module.exports.apply === undefined && typeof apply === 'function') module.exports.apply = apply;
		if (module.exports.inject === undefined && typeof inject !== 'undefined') module.exports.inject = inject;
		return module.exports;
	}
});
`
}

/** Build the browser half and write the wrapped artifact. */
async function buildClient() {
  await build(clientOptions)
  const body = readFileSync(join(outDir, 'client.body.js'), 'utf8')
  writeFileSync(join(outDir, 'client.js'), wrapClient(body), 'utf8')
  // The raw CJS body is a build intermediate; only the wrapped artifact ships.
  rmSync(join(outDir, 'client.body.js'), { force: true })
  rmSync(join(outDir, 'client.js.map'), { force: true })
}

/** Build the host half plus the diagnostic package entry. */
async function buildHost() {
  await build(hostOptions)
}

await buildHost()
await buildClient()
console.log(`[dsh-dschat] built lib/index.js and lib/client.js (v${String(pkg.version)}, ${BUILD_TIME})`)

if (watch) {
  const { context } = await import('esbuild')
  const hostCtx = await context(hostOptions)
  await hostCtx.watch()
  console.log('[dsh-dschat] watching src/ (client half is rebuilt on demand)')
}
