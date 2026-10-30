// Who may do what, once somebody is logged in. The roles are those of xs-security.json:
//   Viewer     reads (projects, files, tours, tests, exports)
//   Editor     everything a Viewer can, and changes things (upload, edit, generate, export, pair extensions)
//   Extension  not a role to assign: what a paired browser extension is (it may send a recording, srv/security.js limits the rest)
// Only enforced where the deployment asks for it (cds.env.tourd.enforceRoles, set by the production profile), so a
// developer on localhost is not asked to log in.
import cds from '@sap/cds'

const READ_METHODS = new Set(['GET', 'HEAD'])
// what the browser extension may do besides sending a recording: write help (srv/security.js lists the routes)
const HELP_BY_EXTENSION = new Set([
  'saveHelpTopic',
  'deleteHelpTopic',
  'createHelpSet',
  'improveHelpTopic',
])

export const enforcing = () => cds.env.tourd?.enforceRoles === true

/** The role a request needs, from its HTTP method and the action it calls. */
export function roleNeeded(method, event) {
  if (READ_METHODS.has(String(method).toUpperCase())) return 'Viewer'
  if (HELP_BY_EXTENSION.has(event) || event === 'importRecording') return 'Extension'
  return 'Editor'
}

const may = (user, role) => {
  if (!user) return false
  if (role === 'Viewer') return user.is('Viewer') || user.is('Editor') || user.is('Extension')
  if (role === 'Extension') return user.is('Extension') || user.is('Editor')
  return user.is('Editor')
}

export function registerAuthz(srv) {
  if (!enforcing()) return
  srv.before('*', (req) => {
    const method = req.http?.req?.method ?? (req.event === 'READ' ? 'GET' : 'POST')
    const needed = roleNeeded(method, req.event)
    if (!req.user || req.user.id === 'anonymous') return req.reject(401, 'Log in to use TourD.')
    if (!may(req.user, needed))
      return req.reject(
        403,
        `This needs the role ${needed === 'Extension' ? 'Editor' : needed} in TourD.`,
      )
  })
}

/** Express middleware for the routes that are not part of the service (/export, /preview, /live). */
export function requireRole(role = 'Viewer') {
  return (req, res, next) => {
    if (!enforcing()) return next()
    const user = req.user ?? cds.context?.user
    if (!user || user.id === 'anonymous')
      return res.status(401).type('text/plain').send('Log in to use TourD.')
    if (!may(user, role))
      return res.status(403).type('text/plain').send(`This needs the role ${role} in TourD.`)
    next()
  }
}
