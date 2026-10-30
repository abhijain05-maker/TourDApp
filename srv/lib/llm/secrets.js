// Keeps credentials out of anything that is stored, logged or shown: error messages from providers and
// SDKs sometimes quote the request, the configuration or the value that could not be parsed.
const SECRET_NAME = /(key|secret|token|password|credential)/i
const MIN_LENGTH = 8
const MASK = '***'

// shapes of well-known credentials, whatever the environment says
const PATTERNS = [
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, // authorization headers
  /\bsk-[A-Za-z0-9_-]{20,}/g, // sk-... style keys
  /"(client_?secret|private_?key|password|access_?token|refresh_?token)"\s*:\s*"[^"]*"/gi, // JSON credentials
]

/** String values inside a JSON environment variable (a service key) whose names say they are secret. */
function secretLeaves(value, name = '', out = []) {
  if (typeof value === 'string') {
    if (SECRET_NAME.test(name) && value.length >= MIN_LENGTH) out.push(value)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) secretLeaves(v, k, out)
  }
  return out
}

/** The secret values this process was started with. */
export function secretValues(env = process.env) {
  const values = new Set()
  for (const [name, value] of Object.entries(env)) {
    if (!SECRET_NAME.test(name) || typeof value !== 'string' || value.length < MIN_LENGTH) continue
    values.add(value)
    if (value.trim().startsWith('{'))
      try {
        for (const leaf of secretLeaves(JSON.parse(value))) values.add(leaf)
      } catch {
        /* not JSON: the whole value is masked anyway */
      }
  }
  // longest first, so a value that contains another one is masked as a whole
  return [...values].sort((a, b) => b.length - a.length)
}

/** @param {unknown} text @returns {string} the text without credentials */
export function scrub(text, env = process.env) {
  let out = String(text ?? '')
  for (const secret of secretValues(env)) out = out.split(secret).join(MASK)
  for (const pattern of PATTERNS) out = out.replace(pattern, MASK)
  return out
}
