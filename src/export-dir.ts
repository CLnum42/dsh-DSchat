/**
 * Where an exported conversation lands on disk.
 *
 * The reader asked for one thing explicitly: 「导出 markdown 的位置，目前不知道，
 * 请默认导出到『下载』文件夹」. So the default is the OS download folder and the
 * user never has to name a directory to get a file they can find — the old
 * behaviour (the host process's cwd, i.e. whatever the plugin happened to be
 * started in) put the file somewhere nobody would look.
 *
 * Resolution order, first hit wins:
 *
 *   1. the folder the reader PICKED in the export dialog — remembered across
 *      restarts, and the most recent explicit answer there is. The request was
 *      「用户初次选择后，后面的导出默认写用户上次选择的路径，除非用户选择改变」,
 *      so a pick outranks even the configured setting: config is the default a
 *      deployment ships, the pick is what the reader said last;
 *   2. the configured `exportDir` — the deployment's default, including one the
 *      reader typed into the YAML by hand;
 *   3. `$DSH_EXPORT_DIR` — an escape hatch for a launcher or a test;
 *   4. `~/Downloads` — the platform's own download folder on macOS, Windows and
 *      Linux alike (Linux desktops do localise it, but `~/Downloads` is what the
 *      XDG user-dirs file points at in every configuration that ships one, and a
 *      missing directory is CREATED here rather than refused).
 *
 * A relative path is resolved against the home directory rather than the cwd, so
 * `exportDir: "导出"` means `~/导出` — the same rule the harness's own workspace
 * paths follow, and the only one that stays stable across restarts.
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** The user's home directory (never a bare `''`). */
function home(): string {
  const value = process.env.HOME ?? process.env.USERPROFILE ?? ''
  return value === '' ? homedir() : value
}

/** Trim a configured value; empty and whitespace mean "not configured". */
function cleaned(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * The directory exports are written to, created if it does not exist.
 *
 * Creating it matters more than it looks: `~/Downloads` does not exist on a
 * fresh server account or in a container, and an export that failed with ENOENT
 * for a directory the plugin itself chose would be a self-inflicted bug.
 *
 * @param configured - the `exportDir` setting, if any.
 * @param remembered - the folder the reader picked in the dialog, if any.
 * @returns an absolute, existing directory path.
 */
export function resolveExportDir(configured?: string, remembered?: string): string {
  const wanted = cleaned(remembered) ?? cleaned(configured) ?? cleaned(process.env.DSH_EXPORT_DIR)
  if (wanted === undefined) return ensureDir(join(home(), 'Downloads'))
  return ensureExportDir(wanted)
}

/**
 * Turn ONE explicit path — what the reader typed or the native picker returned —
 * into an absolute, existing directory.
 *
 * Separate from {@link resolveExportDir} because the two answer different
 * questions: that one asks "where does an export go by default", this one asks
 * "is this particular folder usable". The route that remembers a pick calls this
 * so a bad path fails at the moment the reader names it, with the real `mkdir`
 * error, rather than on every later export.
 *
 * @param value - the path the reader chose; relative resolves against `~`.
 * @throws when the value is empty, or when the directory cannot be created.
 */
export function ensureExportDir(value: string): string {
  const wanted = cleaned(value)
  if (wanted === undefined) throw new Error('导出目录不能为空')
  return ensureDir(isAbsolute(wanted) ? wanted : join(home(), wanted))
}

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}
