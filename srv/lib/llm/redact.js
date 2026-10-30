// Best-effort redaction of source code before it is sent to a third-party model: comments are dropped
// (they often hold names, tickets, internal URLs) and secret-looking values are masked. Texts shown in
// the UI (the inventory) are not touched - they are what the tour is about.

const MASK = '[redacted]'

const SECRET_PATTERNS = [
  // key = "value" / key: 'value' for credential-like keys
  [
    /((?:password|passwd|secret|token|api[_-]?key|apikey|client[_-]?secret|authorization|auth)["']?\s*[:=]\s*)(["'])[^"'\n]{4,}\2/gi,
    `$1$2${MASK}$2`,
  ],
  // bearer tokens and well-known key shapes
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, `Bearer ${MASK}`],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, MASK],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  // e-mail addresses
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, MASK],
  // credentials embedded in URLs
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${MASK}@`],
]

function stripJsComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '"' || c === "'" || c === '`') {
      // copy string literals verbatim so "http://x" or '/*' survive
      let j = i + 1
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      out += src.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
    } else {
      out += c
      i++
    }
  }
  return out
}

const stripXmlComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '')

/**
 * @param {string} content file content
 * @param {string} path used to pick the comment syntax
 */
export function redactSource(content, path = '') {
  let text = String(content)
  if (/\.(js|ts|json)$/i.test(path)) text = stripJsComments(text)
  else if (/\.(xml)$/i.test(path)) text = stripXmlComments(text)
  else if (/\.properties$/i.test(path)) text = text.replace(/^\s*[#!].*$/gm, '')
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement)
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/** Whether redaction is on: default yes, `TOURD_REDACT=0` turns it off. */
export const redactionEnabled = (env = process.env) => env.TOURD_REDACT !== '0'
