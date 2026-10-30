// Turns whatever the user hands over (a folder, loose files, a zip) into the {path, content} list the server's
// importSources expects. The whole project is read - text as text, pictures and the like as base64 - except what
// must not leave the browser (secrets) or is only clutter (node_modules, .git, build output); the same rules as
// the server (shared/workspace-rules.mjs).
import { unzipSync } from 'fflate'
import { exclusionReason, isBinaryPath } from '../../shared/workspace-rules.mjs'

export interface UploadFile {
  path: string
  content: string
  /** content is base64 */
  binary?: boolean
}
export interface Skipped {
  path: string
  reason: string
}
export interface IntakeResult {
  files: UploadFile[]
  skipped: Skipped[]
  /** files that were looked at and left out on purpose (dependencies, build output, secrets, clutter) */
  ignored: number
}

export type SourceKind = 'view' | 'fragment' | 'controller' | 'manifest' | 'i18n'

export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_BINARY_BYTES = 2 * 1024 * 1024
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024
export const MAX_ZIP_BYTES = 50 * 1024 * 1024
export const MAX_FILES = 5000

export const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '')

/** Same classification as the server (srv/lib/context/inventory.js): the files the parsers read. */
export function kindOf(path: string): SourceKind | null {
  const p = normalizePath(path).toLowerCase()
  if (p === 'manifest.json' || p.endsWith('/manifest.json')) return 'manifest'
  if (p.endsWith('.view.xml')) return 'view'
  if (p.endsWith('.fragment.xml')) return 'fragment'
  if (/\.controller\.(js|ts)$/.test(p)) return 'controller'
  if (/(^|\/)i18n[^/]*\.properties$/.test(p)) return 'i18n'
  return null
}

/** Is the file part of the project? (false: dependencies, build output, secrets, clutter) */
export function isIncluded(path: string): boolean {
  return exclusionReason(normalizePath(path)) === null
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** A file is binary by its extension, or when its beginning has NUL bytes. */
export function looksBinary(path: string, bytes: Uint8Array): boolean {
  if (isBinaryPath(path)) return true
  const head = bytes.subarray(0, 8000)
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return true
  return false
}

const decoder = new TextDecoder('utf-8')

/** The upload entry for the bytes of a file, or the reason it cannot be kept. */
function entryFor(path: string, bytes: Uint8Array): UploadFile | string {
  const binary = looksBinary(path, bytes)
  const limit = binary ? MAX_BINARY_BYTES : MAX_FILE_BYTES
  if (bytes.length > limit) return `larger than ${limit / 1024 / 1024} MB`
  return binary ? { path, content: toBase64(bytes), binary: true } : { path, content: decoder.decode(bytes) }
}

type WithRelativePath = File & { webkitRelativePath?: string }

/** Reads a FileList from a folder picker (uses webkitRelativePath) or a plain file picker. */
export async function readFiles(input: ArrayLike<File>): Promise<IntakeResult> {
  const files: UploadFile[] = []
  const skipped: Skipped[] = []
  let ignored = 0
  let total = 0
  for (const file of Array.from(input) as WithRelativePath[]) {
    const path = normalizePath(file.webkitRelativePath || file.name)
    if (!isIncluded(path)) {
      ignored++
      continue
    }
    if (files.length >= MAX_FILES) {
      skipped.push({ path, reason: `the limit of ${MAX_FILES} files is reached` })
      continue
    }
    const limit = isBinaryPath(path) ? MAX_BINARY_BYTES : MAX_FILE_BYTES
    if (file.size > limit) {
      skipped.push({ path, reason: `larger than ${limit / 1024 / 1024} MB` })
      continue
    }
    if (total + file.size > MAX_TOTAL_BYTES) {
      skipped.push({ path, reason: 'the upload limit is reached' })
      continue
    }
    const entry = entryFor(path, new Uint8Array(await file.arrayBuffer()))
    if (typeof entry === 'string') {
      skipped.push({ path, reason: entry })
      continue
    }
    total += file.size
    files.push(entry)
  }
  return { files, skipped, ignored }
}

/** Reads a zip archive, extracting only wanted, reasonably small entries (zip-bomb and zip-slip safe). */
export function readZip(data: Uint8Array): IntakeResult {
  if (data.length > MAX_ZIP_BYTES) throw new Error(`The zip file is larger than ${MAX_ZIP_BYTES / 1024 / 1024} MB`)
  const skipped: Skipped[] = []
  let ignored = 0
  let total = 0
  let count = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data, {
      filter: (f) => {
        const path = normalizePath(f.name)
        if (!path || path.endsWith('/')) return false
        if (path.split('/').includes('..')) {
          skipped.push({ path, reason: 'unsafe path' })
          return false
        }
        if (!isIncluded(path)) {
          ignored++
          return false
        }
        const limit = isBinaryPath(path) ? MAX_BINARY_BYTES : MAX_FILE_BYTES
        if (f.originalSize > limit) {
          skipped.push({ path, reason: `larger than ${limit / 1024 / 1024} MB` })
          return false
        }
        if (count >= MAX_FILES) {
          skipped.push({ path, reason: `the limit of ${MAX_FILES} files is reached` })
          return false
        }
        if (total + f.originalSize > MAX_TOTAL_BYTES) {
          skipped.push({ path, reason: 'the upload limit is reached' })
          return false
        }
        total += f.originalSize
        count++
        return true
      },
    })
  } catch {
    throw new Error('This is not a readable zip file')
  }
  const files: UploadFile[] = []
  for (const [name, bytes] of Object.entries(entries)) {
    const path = normalizePath(name)
    const entry = entryFor(path, bytes)
    if (typeof entry === 'string') skipped.push({ path, reason: entry })
    else files.push(entry)
  }
  return { files, skipped, ignored }
}

/** Splits an upload so no single request gets too large for the server's body limit. */
export function chunkFiles(files: UploadFile[], maxBytes = 4 * 1024 * 1024): UploadFile[][] {
  const chunks: UploadFile[][] = []
  let current: UploadFile[] = []
  let size = 0
  for (const f of files) {
    const bytes = f.binary ? f.content.length : new TextEncoder().encode(f.content).length
    if (current.length && size + bytes > maxBytes) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(f)
    size += bytes
  }
  if (current.length) chunks.push(current)
  return chunks
}
