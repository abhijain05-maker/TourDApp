// Login and role checks for the routes that are not part of the OData service (/export, /preview, /live). Where the
// deployment does not enforce roles (localhost) these do nothing.
import cds from '@sap/cds'
import express from 'express'
import { enforcing, requireRole } from './service/authz.js'

/** An express router that logs the caller in (cds.requires.auth) and checks the role; null when nothing is enforced. */
export function protect(role = 'Viewer') {
  if (!enforcing()) return null
  const router = express.Router()
  router.use(cds.middlewares.context(), cds.middlewares.auth(), requireRole(role))
  return router
}

/** Runs `router` (if any) and then `next`. */
export const through = (router, req, res, next) => (router ? router(req, res, next) : next())
