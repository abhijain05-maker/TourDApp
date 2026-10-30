// Which files belong to a project hand-over. The server decides with these rules and the designer applies the same
// ones before it uploads anything, so nothing that must not leave the browser is ever sent.

/** Folders that are generated or hold other people's code. */
export const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'target',
  'coverage',
  '.idea',
  '.vscode',
  '__MACOSX',
]

/** Files that very likely hold credentials: not read into TourD, not sent to an AI provider, not exported. */
const PROTECTED = [
  /(^|\/)\.env(\..*)?$/,
  /\.(pem|p12|pfx|key|jks)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)default-env\.json$/,
  /(^|\/)\.cdsrc-private\.json$/,
]
const CLUTTER = /(^|\/)(\.DS_Store|Thumbs\.db)$/

/**
 * @param {string} path forward slashes, no leading slash
 * @returns {string|null} why the path is left out (it does not make a project incomplete), or null
 */
export function exclusionReason(path) {
  const segments = path.split('/')
  const dir = segments.slice(0, -1).find((s) => EXCLUDED_DIRS.includes(s))
  if (dir) return `inside "${dir}/", which is not part of a project hand-over`
  if (PROTECTED.some((re) => re.test(path)))
    return 'may contain secrets, so it is not read into TourD'
  if (CLUTTER.test(path)) return 'operating system clutter'
  return null
}

/** Extensions that are never text. Anything else is read as text unless it contains NUL bytes. */
export const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'avif',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'pdf',
  'zip',
  'gz',
  'tgz',
  'mp3',
  'mp4',
  'webm',
  'ogg',
  'wav',
  'xlsx',
  'docx',
  'pptx',
  'jar',
  'wasm',
])

export const extensionOf = (path) => {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isBinaryPath = (path) => BINARY_EXTENSIONS.has(extensionOf(path))
