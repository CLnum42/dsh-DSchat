/**
 * Attachment paths and upload rules, shared by the HTTP routes and the engine.
 *
 * These live in one module because the two halves must agree: the `/attach`
 * route decides where a pasted file LANDS and under which extension, and the
 * engine decides whether the paths a caller then hands to `/send` (or to
 * `dschat_send`) may be uploaded to chat.deepseek.com at all. Two copies of
 * "which extensions are allowed" would drift, and the drift would show up as a
 * file the panel happily accepted and the composer then refused.
 */

import { statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

/** Sub-directory of the plugin data dir that holds pasted/dropped files. */
export const ATTACHMENT_DIR = 'attachments'

/** Absolute attachment directory for one plugin data dir. */
export function attachmentDir(dataDir: string): string {
  return resolve(join(dataDir, ATTACHMENT_DIR))
}

/**
 * True when `path` resolves to something INSIDE `dir` (never `dir` itself).
 *
 * The trailing separator matters: without it `/data/attachments-evil/x.png`
 * passes a `startsWith('/data/attachments')` test. Resolving first means a
 * `../`-shaped path is judged by where it actually points rather than by how it
 * was spelled.
 */
export function isInsideDirectory(dir: string, path: string): boolean {
  const base = resolve(dir)
  const target = resolve(path)
  return target.startsWith(`${base}/`)
}

/** True when `path` IS `dir`, or is inside it (the export-dir rule). */
export function isSameOrInsideDirectory(dir: string, path: string): boolean {
  return resolve(path) === resolve(dir) || isInsideDirectory(dir, path)
}

/**
 * Extensions a caller may hand to the web page as an attachment.
 *
 * An allow-list rather than "whatever the caller put in the name": the path is
 * caller-controlled in principle, and this is the only thing standing between
 * the composer and, say, `~/.ssh/id_rsa` (no extension), `*.pem` or `.env`
 * (both absent here). Everything listed is a plain document, image, archive or
 * text file the page reads rather than runs.
 */
export const SAFE_EXTENSION = /^\.(png|jpg|jpeg|webp|gif|bmp|tiff|heic|svg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|markdown|csv|tsv|json|jsonl|log|xml|yaml|yml|htm|html|tex|rtf|srt|vtt|py|js|mjs|cjs|ts|tsx|jsx|java|c|h|cpp|hpp|cs|go|rs|rb|php|sh|sql|ini|toml|conf|cfg|bin|zip|gz)$/

/** How many files one message may carry (also enforced by the panel composer). */
export const MAX_ATTACH_FILES = 10

/** Per-file cap, matching the panel's own `MAX_ATTACH_BYTES` (24 MiB). */
export const MAX_ATTACH_FILE_BYTES = 24 * 1024 * 1024

/**
 * Cap on one turn's upload, in bytes.
 *
 * Ten files at the per-file cap would be 240 MiB pushed through a browser's file
 * input in a single turn — far past anything the panel can produce, and past
 * what the web page will accept before it starts rejecting silently. This bounds
 * the work a single call can ask for.
 */
export const MAX_ATTACH_TOTAL_BYTES = 48 * 1024 * 1024

/** One rejected upload, in the caller's terms. */
export interface AttachmentRejection {
  readonly path: string
  readonly reason: string
}

/**
 * Check the paths a caller wants uploaded, WITHOUT touching the page.
 *
 * Runs in the engine rather than in one route on purpose: `/send` and the
 * `dschat_send` tool both end in `engine.send`, and the panel's own caps are UI
 * rules a scripted caller never sees. A path outside the plugin's attachment
 * directory is a separate question, answered by {@link isInsideDirectory} at
 * the HTTP boundary only — the agent tool is documented to take files from
 * anywhere the user points it at, so containment must not be enforced here.
 *
 * @param paths - absolute paths the caller asked to attach.
 * @returns one entry per rejected path; empty means every path is uploadable.
 */
export function checkAttachments(paths: readonly string[]): AttachmentRejection[] {
  const rejections: AttachmentRejection[] = []
  if (paths.length > MAX_ATTACH_FILES) {
    // Answered as ONE rejection rather than one per surplus file: the reader
    // needs the rule, not fifty copies of it.
    return [{ path: `${String(paths.length)} files`, reason: `一次最多上传 ${String(MAX_ATTACH_FILES)} 个文件` }]
  }
  let total = 0
  for (const path of paths) {
    if (typeof path !== 'string' || path.trim() === '') {
      rejections.push({ path: String(path), reason: '路径为空' })
      continue
    }
    if (!SAFE_EXTENSION.test(extname(path).toLowerCase())) {
      rejections.push({ path, reason: '不允许上传的文件类型（仅支持图片、文档与文本）' })
      continue
    }
    let size: number
    try {
      const info = statSync(path)
      if (!info.isFile()) {
        rejections.push({ path, reason: '不是一个常规文件' })
        continue
      }
      size = info.size
    } catch (error) {
      rejections.push({ path, reason: `文件不可读（${String(error)}）` })
      continue
    }
    if (size > MAX_ATTACH_FILE_BYTES) {
      rejections.push({ path, reason: `文件超过 ${String(Math.round(MAX_ATTACH_FILE_BYTES / (1024 * 1024)))} MiB` })
      continue
    }
    total += size
    if (total > MAX_ATTACH_TOTAL_BYTES) {
      rejections.push({ path, reason: `本次上传总量超过 ${String(Math.round(MAX_ATTACH_TOTAL_BYTES / (1024 * 1024)))} MiB` })
      break
    }
  }
  return rejections
}

/** One sentence naming what was refused and why, for a tool/route error. */
export function describeRejections(rejections: readonly AttachmentRejection[]): string {
  return rejections.map(item => `${item.path}：${item.reason}`).join('；')
}
