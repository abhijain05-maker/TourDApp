// HTTP side of the previews:
//   /preview/<projectId>/sandbox.html        the sandbox page (a harmless copy of the project's app, see lib/preview/model.js)
//   /preview/<projectId>/app/**              files of that copy: stub controllers   (app-real/**: uploaded controllers)
//   /preview/<projectId>/rt/{TourPlayer,sandbox}.js   runtime files
//   /preview/<projectId>/info.json           what the copy contains (pages, routes, notes)
//   /live/player.js, /live/<tourId>/tour.json   for the "load from TourD" console snippet
// The sandbox page is meant for an <iframe sandbox="allow-scripts"> (no same-origin): it runs with an
// opaque origin, so its requests are cross-origin and these routes answer with CORS "*".
import cds from '@sap/cds'
import { readFile } from 'node:fs/promises'
import { buildPreviewApp, PreviewError } from './lib/preview/model.js'
import { helpAsPredefine, playerAsPredefine } from '../shared/live-snippet.mjs'
import { check, mint } from './lib/capability.js'
import { protect, through } from './lib/protect.js'
import { enforcing } from './lib/service/authz.js'

const { SELECT } = cds.ql
const here = (p) => new URL(p, import.meta.url)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UI5_VERSION = /^(latest|\d{1,2}\.\d{1,3}(\.\d{1,3})?)$/
const ORIGIN = /^https?:\/\/[A-Za-z0-9.[\]:-]{1,200}$/

const RUNTIME = {
  'TourPlayer.js': here('../player/TourPlayer.js'),
  'sandbox.js': here('../sandbox/sandbox.js'),
}

// the page runs in a frame without same-origin access (see the iframe's sandbox attribute); only TourD may frame it
const SANDBOX_CSP = "sandbox allow-scripts; frame-ancestors 'self'"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

const send = (res, status, type, body, extra = {}) =>
  res
    .status(status)
    .set({ ...CORS, 'Content-Type': type, ...extra })
    .send(body)

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

function errorPage(message) {
  // posts the message to the designer too, so it can show it next to the frame
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>TourD sandbox</title></head>
<body style="font:14px sans-serif;margin:1.5rem;color:#1d2d3e"><h3>The sandbox cannot start</h3><p>${escapeHtml(message)}</p>
<script>try{window.parent.postMessage({tourd:"sandbox",type:"error",message:${JSON.stringify(message).split('<').join('\\u003c')}},"*")}catch(e){}</script></body></html>`
}

// built copies of the app, reused while the project's files do not change
const cache = new Map()
const CACHE_MAX = 20

async function previewApp(projectID, controllers) {
  const { Projects, Sources } = cds.entities('tourd')
  const project = await SELECT.one.from(Projects).columns('ID', 'appId').where({ ID: projectID })
  if (!project) return null
  const stamp = await SELECT.one
    .from(Sources)
    .columns('count(*) as n', 'max(modifiedAt) as latest')
    .where({ project_ID: projectID })
  const key = `${projectID}|${controllers}`
  const version = `${stamp?.n}|${stamp?.latest}|${project.appId}`
  const hit = cache.get(key)
  if (hit?.version === version) return hit.app
  const sources = await SELECT.from(Sources)
    .columns('path', 'kind', 'content')
    .where({ project_ID: projectID, deleted: false, binary: false })
  const app = buildPreviewApp(sources, { appId: project.appId ?? undefined, controllers })
  cache.delete(key)
  cache.set(key, { version, app })
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return app
}

async function sandboxHtml(app, query) {
  const ui5 = UI5_VERSION.test(query.ui5 ?? '') ? query.ui5 : '1.120'
  const parentOrigin = ORIGIN.test(query.parentOrigin ?? '') ? query.parentOrigin : '*'
  const real = query.controllers === 'real'
  const config = { appId: app.appId, appBase: real ? './app-real/' : './app/', ui5, parentOrigin }
  const json = JSON.stringify(config).split('<').join('\\u003c')
  const template = await readFile(here('../sandbox/sandbox.html'), 'utf8')
  return template.replace('/*__TOURD_CONFIG__*/ null', () => json)
}

async function handlePreview(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return send(res, 405, 'text/plain', 'Method not allowed')
  const parts = req.path.split('/')
  if (parts[2]?.startsWith('~')) parts.splice(2, 1) // a capability token in the path (see previewGuard)
  const [, projectID, kind, ...rest] = parts
  if (!UUID.test(projectID ?? '')) return send(res, 404, 'text/plain', 'Not found')

  try {
    if (kind === 'rt') {
      const file = RUNTIME[rest.join('/')]
      if (!file) return send(res, 404, 'text/plain', 'Not found')
      return send(res, 200, 'application/javascript; charset=utf-8', await readFile(file, 'utf8'))
    }

    const real = kind === 'app-real' || req.query.controllers === 'real'
    const app = await previewApp(projectID, real ? 'real' : 'stub')
    if (!app) return send(res, 404, 'text/plain', 'Unknown project')

    if (kind === 'sandbox.html') {
      // the page runs in a frame that sends no cookies: from here on its files are asked for with a token in the path
      if (enforcing() && !req.path.split('/')[2]?.startsWith('~')) {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
        return res.redirect(
          302,
          `/preview/${projectID}/~${mint(`preview:${projectID}`)}/sandbox.html${query}`,
        )
      }
      return send(res, 200, 'text/html; charset=utf-8', await sandboxHtml(app, req.query), {
        'Content-Security-Policy': SANDBOX_CSP,
      })
    }
    if (kind === 'info.json')
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(app.info))
    if (kind === 'app' || kind === 'app-real') {
      let rel
      try {
        rel = decodeURIComponent(rest.join('/'))
      } catch {
        return send(res, 400, 'text/plain', 'Bad path')
      }
      if (/[\\\0]/.test(rel) || rel.split('/').some((s) => s === '..' || s === ''))
        return send(res, 400, 'text/plain', 'Bad path')
      const file = app.files.get(rel)
      if (!file) return send(res, 404, 'text/plain', `Not part of the app: ${rel}`)
      return send(res, 200, file.type, file.body)
    }
    return send(res, 404, 'text/plain', 'Not found')
  } catch (e) {
    if (e instanceof PreviewError) {
      if (kind === 'sandbox.html')
        return send(res, 422, 'text/html; charset=utf-8', errorPage(e.message), {
          'Content-Security-Policy': SANDBOX_CSP,
        })
      return send(res, 422, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }))
    }
    cds.log('tourd').error('preview failed', e)
    return send(res, 500, 'text/plain', 'The preview could not be built')
  }
}

async function handleLive(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return send(res, 405, 'text/plain', 'Method not allowed')
  const parts = req.path.split('/').slice(1)
  try {
    if (parts.length === 1 && parts[0] === 'player.js') {
      const source = await readFile(here('../player/TourPlayer.js'), 'utf8')
      return send(res, 200, 'application/javascript; charset=utf-8', playerAsPredefine(source))
    }
    if (parts.length === 1 && parts[0] === 'help.js') {
      const source = await readFile(here('../player/HelpLayer.js'), 'utf8')
      return send(res, 200, 'application/javascript; charset=utf-8', helpAsPredefine(source))
    }
    if (parts.length === 2 && parts[1] === 'help.json' && UUID.test(parts[0])) {
      const { HelpSets } = cds.entities('tourd')
      const help = await SELECT.one.from(HelpSets).columns('definition').where({ ID: parts[0] })
      if (!help) return send(res, 404, 'text/plain', 'Unknown help')
      return send(res, 200, 'application/json; charset=utf-8', help.definition)
    }
    if (parts.length === 2 && parts[1] === 'tour.json' && UUID.test(parts[0])) {
      const { Tours } = cds.entities('tourd')
      const tour = await SELECT.one.from(Tours).columns('definition').where({ ID: parts[0] })
      if (!tour) return send(res, 404, 'text/plain', 'Unknown tour')
      return send(res, 200, 'application/json; charset=utf-8', tour.definition)
    }
  } catch (e) {
    cds.log('tourd').error('live route failed', e)
    return send(res, 500, 'text/plain', 'Could not read the file')
  }
  return send(res, 404, 'text/plain', 'Not found')
}

/** /preview: a logged-in viewer, or the capability token that the sandbox page was redirected to. */
function previewGuard(viewer) {
  return (req, res, next) => {
    if (!enforcing()) return next()
    const [, id, second] = req.path.split('/')
    if (second?.startsWith('~'))
      return check(`preview:${id}`, second.slice(1))
        ? next()
        : send(res, 403, 'text/plain', 'This preview link has expired. Open the preview again.')
    through(viewer, req, res, next)
  }
}

/** /live: the player is public (it is only code); a tour needs a viewer, a paired extension or a capability token. */
function liveGuard(viewer) {
  return (req, res, next) => {
    if (!enforcing()) return next()
    const parts = req.path.split('/').slice(1)
    if (parts.length === 1 && (parts[0] === 'player.js' || parts[0] === 'help.js')) return next()
    if (parts.length === 2 && UUID.test(parts[0]) && check(`live:${parts[0]}`, req.query.t))
      return next()
    through(viewer, req, res, next)
  }
}

export function registerPreview(app) {
  const viewer = protect('Viewer')
  app.use('/preview', previewGuard(viewer), (req, res) => handlePreview(req, res))
  app.use('/live', liveGuard(viewer), (req, res) => handleLive(req, res))
}
