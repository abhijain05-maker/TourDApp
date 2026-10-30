// Short-lived "capability" tokens for the few things that run where a login cannot follow: the sandbox page (a frame
// without same-origin access sends no cookies) and the "load the tour from TourD" console snippet (it runs in the
// user's own app). A token says "this scope, until this time" and is signed with a secret of the server, so it proves
// that a logged-in person asked for it. Scopes: "preview:<projectId>", "live:<tourId>".
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// one secret per process unless TOURD_SECRET is set (needed as soon as there is more than one instance)
const SECRET = process.env.TOURD_SECRET || randomBytes(32).toString('hex')
export const TTL_MS = 12 * 60 * 60 * 1000

const sign = (scope, expiry, secret = SECRET) =>
  createHmac('sha256', secret).update(`${scope}|${expiry}`).digest('base64url').slice(0, 32)

export function mint(scope, { ttl = TTL_MS, now = Date.now(), secret } = {}) {
  const expiry = Math.floor((now + ttl) / 1000).toString(36)
  return `${expiry}.${sign(scope, expiry, secret)}`
}

export function check(scope, token, { now = Date.now(), secret } = {}) {
  if (typeof token !== 'string' || token.length > 100) return false
  const [expiry, sig] = token.split('.')
  if (!expiry || !sig || !/^[0-9a-z]+$/.test(expiry)) return false
  if (parseInt(expiry, 36) * 1000 < now) return false
  const want = Buffer.from(sign(scope, expiry, secret))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}

export const SCOPES = ['preview', 'live']
