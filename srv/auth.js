// Authentication for a deployment (cds.requires.auth.impl). Two kinds of caller:
//  - a person, who comes through the approuter with an XSUAA token (or, in tests and locally, a mocked user);
//  - a paired browser extension, which cannot log in: srv/security.js has already checked its pairing token and the
//    short list of routes it may use, and marked the request, so here it becomes a user with the role "Extension".
// Which kind of login the person uses is cds.requires.auth.base ("xsuaa" by default; "mocked" in tests).
import cds from '@sap/cds'

export default function tourdAuth(options) {
  const base = cds.middlewares.auth({ ...options, impl: undefined, kind: options.base ?? 'xsuaa' })
  return function auth(req, res, next) {
    if (req.tourdExtension) {
      const user = new cds.User({ id: `extension:${req.tourdExtension.name}`, roles: { Extension: 1 } })
      cds.context.user = req.user = user
      return next()
    }
    return base(req, res, next)
  }
}
