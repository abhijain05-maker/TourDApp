// Validation of uploaded project files: safe paths, size limits, nothing that holds secrets or only clutters.
// The whole project is kept (so it can be edited and handed back), not just the files the parsers understand.
import { createHash } from 'node:crypto'
import { classifySource } from '../context/inventory.js'
import { exclusionReason } from '../../../shared/workspace-rules.mjs'

export { exclusionReason, EXCLUDED_DIRS } from '../../../shared/workspace-rules.mjs'

export const LIMITS = {
  files: 5000,
  /** a text file, and a view/controller/manifest in particular, must fit: such a file is never silently left out */
  fileBytes: 1024 * 1024,
  binaryBytes: 2 * 1024 * 1024,
  totalBytes: 25 * 1024 * 1024,
  recordingBytes: 2 * 1024 * 1024,
}

export class InputError extends Error {}

/** Forward slashes, no leading "./" or "/", no ".." segments, no control characters. */
export function normalizeSourcePath(p) {
  const s = String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
  if (!s || s.length > 500) throw new InputError(`Invalid file path "${String(p).slice(0, 80)}"`)
  if (/[\u0000-\u001f]/.test(s))
    throw new InputError(`File path contains control characters: "${s.slice(0, 80)}"`)
  if (s.split('/').some((seg) => seg === '..' || seg === ''))
    throw new InputError(`File path must not contain ".." or empty segments: "${s}"`)
  return s
}

export const sha256 = (text) =>
  createHash('sha256')
    .update(String(text ?? ''))
    .digest('hex')

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Bytes a file really has: base64 is decoded, text counted as UTF-8. */
export function byteSize(content, binary) {
  if (!binary) return Buffer.byteLength(content, 'utf8')
  const pad = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0
  return Math.floor((content.length * 3) / 4) - pad
}

/**
 * @param {Array<{path: string, content: string, binary?: boolean}>} files `binary: true` means content is base64
 * @returns {{
 *   accepted: Array<{path: string, kind: string, content: string, binary: boolean, size: number}>,
 *   ignored: string[],
 *   skipped: Array<{path: string, reason: string, expected: boolean}>
 * }} `ignored`: left out on purpose (see exclusionReason). `skipped`: could not be kept (too large, too many);
 *   `expected: false` means the project is incomplete without it. Later duplicates win.
 */
export function prepareFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new InputError('No files were provided')
  if (files.length > LIMITS.files)
    throw new InputError(`Too many files (${files.length}); the limit is ${LIMITS.files}`)

  const prepared = []
  const ignored = []
  const skipped = []
  for (const f of files) {
    const path = normalizeSourcePath(f?.path)
    const why = exclusionReason(path)
    if (why) {
      ignored.push(path)
      skipped.push({ path, reason: why, expected: true })
      continue
    }
    const binary = f?.binary === true
    const content = typeof f?.content === 'string' ? f.content : ''
    if (binary ? !BASE64.test(content) : content.includes('\u0000')) {
      skipped.push({ path, reason: 'not a text file and not valid base64', expected: false })
      continue
    }
    const bytes = byteSize(content, binary)
    const kind = classifySource(path)
    const limit = binary ? LIMITS.binaryBytes : LIMITS.fileBytes
    if (bytes > limit) {
      if (kind !== 'other')
        throw new InputError(`${path} is too large (${bytes} bytes); the limit is ${limit}`)
      skipped.push({
        path,
        reason: `too large (${bytes} bytes; the limit is ${limit})`,
        expected: false,
      })
      continue
    }
    prepared.push({ path, kind, content, binary, size: bytes })
  }

  // the files the parsers use come first: when the total is reached, only the others are left out
  const byPath = new Map()
  for (const f of prepared) byPath.set(f.path, f)
  const ordered = [...byPath.values()].sort(
    (a, b) => Number(a.kind === 'other') - Number(b.kind === 'other'),
  )
  const accepted = []
  let total = 0
  for (const f of ordered) {
    if (total + f.size > LIMITS.totalBytes) {
      if (f.kind !== 'other')
        throw new InputError(
          `The upload is too large; the limit is ${LIMITS.totalBytes} bytes in total`,
        )
      skipped.push({ path: f.path, reason: 'the upload limit is reached', expected: false })
      continue
    }
    total += f.size
    accepted.push(f)
  }
  return { accepted, ignored, skipped }
}
