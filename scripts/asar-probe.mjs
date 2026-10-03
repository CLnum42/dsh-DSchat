/**
 * Read-only ASAR probe for the DSH application bundle.
 *
 * The plugins here are built against Harness packages that only exist inside the
 * running app's `app.asar`, and the packaged copy is the authority on their real
 * API (the docs and the npm tarballs are not always the same revision). This
 * extracts individual files from the bundle WITHOUT unpacking 121 MB, which is
 * how `openTab('browser', …)` and `remote.workspaceFiles.list(…)` were confirmed
 * for the DSchat file picker and the link interception.
 *
 * Usage:
 *   node scripts/asar-probe.mjs <filter> [outDir]
 *   node scripts/asar-probe.mjs "node_modules/@deepseek-ai/dsh-client-ui-sidebar-files/"
 *
 * The filter is a substring of the in-archive path; matching files are written
 * to `outDir` (default `.asar-probe/`) with `/` flattened to `__`.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The packaged app. Override with the second environment-form argument if the app moves. */
const ASAR = process.env.DSH_ASAR ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'

const filter = process.argv[2]
const outRoot = process.argv[3] ?? '.asar-probe'
if (filter === undefined) {
  console.error('usage: node scripts/asar-probe.mjs <path-substring> [outDir]')
  process.exit(2)
}

/*
 * ASAR layout: a pickle header (16 bytes, the payload size at offset 8), then
 * the JSON directory table, then the concatenated member bytes. The table is
 * followed by four alignment bytes inside the same pickle payload, so it is
 * parsed up to its final brace rather than by a length field.
 */
const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(8)
const hb = Buffer.alloc(headerSize)
fs.readSync(fd, hb, 0, headerSize, 16)
const text = hb.toString('utf8')
const header = JSON.parse(text.slice(0, text.lastIndexOf('}') + 1))
const dataStart = 16 + headerSize

const hits = []
const walk = (node, prefix) => {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const p = prefix === '' ? name : `${prefix}/${name}`
    if (value.files !== undefined) walk(value, p)
    else hits.push({ p, off: Number(value.offset), size: value.size })
  }
}
walk(header, '')

fs.mkdirSync(outRoot, { recursive: true })
const picked = hits.filter(hit => hit.p.includes(filter))
for (const hit of picked) {
  const buf = Buffer.alloc(hit.size)
  fs.readSync(fd, buf, 0, hit.size, dataStart + hit.off)
  fs.writeFileSync(path.join(outRoot, hit.p.replaceAll('/', '__')), buf)
}
console.log(`${picked.length} file(s) -> ${outRoot}`)
for (const hit of picked) console.log(`  ${hit.size}\t${hit.p}`)
