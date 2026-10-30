// Pairing tokens for the browser extension. The token is a long random secret that is shown once;
// only its SHA-256 is stored, so a copy of the database does not give access.
import { createHash, randomBytes } from 'node:crypto'
import cds from '@sap/cds'

const { SELECT, UPDATE } = cds.ql

export const TOKEN_PREFIX = 'tourd_'
export const HEADER = 'x-tourd-token'

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex')

export function newToken() {
  const token = TOKEN_PREFIX + randomBytes(24).toString('base64url')
  return { token, prefix: token.slice(0, TOKEN_PREFIX.length + 4), tokenHash: hashToken(token) }
}

const TOUCH_EVERY_MS = 60_000

/**
 * Does the request carry the token of a paired, not revoked extension?
 * @returns {Promise<{ID: string, name: string} | null>}
 */
export async function verifyToken(req) {
  const token = req.headers?.[HEADER]
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 200)
    return null
  const { ExtensionTokens } = cds.entities('tourd')
  const row = await SELECT.one
    .from(ExtensionTokens)
    .columns('ID', 'name', 'lastUsedAt')
    .where({ tokenHash: hashToken(token), revoked: false })
  if (!row) return null
  if (!row.lastUsedAt || Date.now() - new Date(row.lastUsedAt).getTime() > TOUCH_EVERY_MS)
    await UPDATE(ExtensionTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where({ ID: row.ID })
  return { ID: row.ID, name: row.name }
}
