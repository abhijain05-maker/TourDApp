// Guards for a tool that has no login: it is meant to run on the user's own machine.
//  - Host check: only answers for localhost / 127.0.0.1 / [::1] (and names listed in TOURD_ALLOWED_HOSTS;
//    "*" switches the check off). This stops other websites from reaching it by DNS rebinding.
//  - Origin check: a request that changes something must come from a page of TourD itself, not from
//    another site (CSRF) and not from the sandbox frame (its origin is "null").
//  - Browser extension: its requests carry the origin chrome-extension://<id> and/or the header X-TourD-Token.
//    They are accepted only with the token of a paired extension, and only for what the extension needs
//    (see EXTENSION_ROUTES). Requests of other local clients (scripts, the designer) carry neither.
//  - Headers: no sniffing, no referrer, no framing by other sites.
// A deployment behind a login (XSUAA, an approuter) sets TOURD_ALLOWED_HOSTS to its own host name.
import cds from '@sap/cds'
import { HEADER as TOKEN_HEADER, verifyToken } from './lib/service/tokens.js'
import { createLimiter } from './lib/rate-limit.js'

const { SELECT } = cds.ql

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const EXTENSION_ORIGIN = /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i
const TOUR_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * What a paired extension may do: list projects, tours, test plans and help, send a recording, add or remove help
 * topics, fetch a tour (or the help) to play.
 */
const EXTENSION_ROUTES = [
  {
    methods: ['GET', 'HEAD'],
    path: (p) =>
      [
        '/odata/v4/tour/Projects',
        '/odata/v4/tour/Tours',
        '/odata/v4/tour/TestPlans',
        '/odata/v4/tour/HelpSets',
        '/odata/v4/tour/providers()',
      ].includes(p),
  },
  {
    methods: ['POST'],
    path: (p) =>
      [
        '/odata/v4/tour/importRecording',
        '/odata/v4/tour/createHelpSet',
        '/odata/v4/tour/saveHelpTopic',
        '/odata/v4/tour/deleteHelpTopic',
        '/odata/v4/tour/improveHelpTopic',
      ].includes(p),
  },
  {
    methods: ['GET', 'HEAD'],
    path: (p) =>
      p === '/live/player.js' ||
      p === '/live/help.js' ||
      new RegExp(`^/live/${TOUR_ID}/(tour|help)\\.json$`, 'i').test(p),
  },
]

export const isExtensionOrigin = (origin) =>
  typeof origin === 'string' && EXTENSION_ORIGIN.test(origin)

export const extensionMayCall = (method, path) =>
  EXTENSION_ROUTES.some((r) => r.methods.includes(method) && r.path(path))

/** "Localhost:4044" -> "localhost", "[::1]:4044" -> "::1" */
export function hostnameOf(hostHeader) {
  const h = String(hostHeader ?? '')
    .trim()
    .toLowerCase()
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'))
  return h.replace(/:\d+$/, '')
}

export function allowedHosts(env = process.env) {
  const extra = (env.TOURD_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return { all: extra.includes('*'), names: new Set([...LOOPBACK, ...extra]) }
}

/** null when the request may proceed, otherwise the reason it is refused. (Extensions are checked separately.) */
export function refusal(req, env = process.env) {
  const allowed = allowedHosts(env)
  const host = hostnameOf(req.headers.host)
  if (!allowed.all && !allowed.names.has(host))
    return `TourD only answers requests for localhost. To use the name "${host}", start it with TOURD_ALLOWED_HOSTS=${host} (or * for any name).`
  if (!SAFE_METHODS.has(req.method)) {
    const origin = req.headers.origin
    if (origin !== undefined && !isExtensionOrigin(origin)) {
      let originHost = null
      try {
        originHost = new URL(origin).host
      } catch {
        /* "null" and garbage are not a page of ours */
      }
      if (
        originHost === null ||
        originHost.toLowerCase() !== String(req.headers.host).toLowerCase()
      )
        return 'Requests that change data are only accepted from the TourD designer itself.'
    }
  }
  return null
}

const deny = (res, reason) => res.status(403).type('text/plain').send(reason)

const extensionLimiter = createLimiter({
  windowMs: 60_000,
  max: Number(process.env.TOURD_EXTENSION_RATE ?? 300),
})

/** Answers the platform's health check: the process is up and the database answers. No login, no data. */
async function health(req, res) {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  try {
    await cds.db.run(SELECT.one.from('tourd.Projects').columns('ID'))
    res.status(200).json({ status: 'UP', db: 'UP' })
  } catch {
    res.status(503).json({ status: 'DOWN', db: 'DOWN' })
  }
}

export function registerSecurity(app) {
  app.disable('x-powered-by')
  app.get('/health', health)
  app.use(async (req, res, next) => {
    try {
      const reason = refusal(req)
      if (reason) return deny(res, reason)
      // Browsers add no Origin to some requests of an extension, so the token itself decides, not the origin
      if (isExtensionOrigin(req.headers.origin) || req.headers[TOKEN_HEADER] !== undefined) {
        const paired = await verifyToken(req)
        if (!paired)
          return deny(
            res,
            'This browser extension is not paired with TourD, or its token was revoked. Create a token in TourD ("Browser extension") and enter it in the extension.',
          )
        if (!extensionMayCall(req.method, req.path))
          return deny(
            res,
            'A paired extension may only read projects, tours, tests and help, send recordings, and add or remove help topics.',
          )
        const turn = extensionLimiter.take(paired.ID)
        if (!turn.ok) {
          res.set('Retry-After', String(turn.retryAfter))
          return res
            .status(429)
            .type('text/plain')
            .send('Too many requests from this extension. Wait a moment.')
        }
        req.tourdExtension = paired
      }
      res.set({
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        // pages that set their own policy (the sandbox page) repeat this directive
        'Content-Security-Policy': "frame-ancestors 'self'",
      })
      next()
    } catch (e) {
      next(e)
    }
  })
}
