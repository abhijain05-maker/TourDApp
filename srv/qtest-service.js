// QuickTest service: test management for the apps QuickDev knows. The handlers live in srv/lib/qtest/service/*.js,
// one file per area; this file wires them together. Projects, recordings and test plans are the ones of the other
// QuickDev apps (tourd.*): nothing of those is changed here.
import cds from '@sap/cds'
import { InputError } from './lib/service/sources.js'
import { registerAuthz } from './lib/service/authz.js'
import { registerAi } from './lib/qtest/service/ai.js'
import { registerAutomation } from './lib/qtest/service/automation.js'
import { registerImport } from './lib/qtest/service/import.js'
import { registerItems } from './lib/qtest/service/items.js'
import { registerRuns } from './lib/qtest/service/runs.js'

const { SELECT } = cds.ql

export default class QTestService extends cds.ApplicationService {
  init() {
    const { Projects } = cds.entities('tourd')
    registerAuthz(this)

    const guarded = (fn) => async (req) => {
      try {
        return await fn(req)
      } catch (e) {
        if (e instanceof InputError) return req.reject(400, e.message)
        throw e
      }
    }

    const project = async (req, id, columns = ['ID', 'name', 'inventory']) =>
      (await SELECT.one.from(Projects).columns(...columns).where({ ID: id })) ?? req.reject(404, `Project ${id} not found`)

    const ctx = { project, guarded }
    const items = registerItems(this, ctx)
    registerImport(this, { ...ctx, items })
    registerRuns(this, { ...ctx, items })
    registerAutomation(this, { ...ctx, items })
    registerAi(this, ctx)

    // everything here is written by the actions above
    for (const entity of ['CREATE', 'UPDATE', 'DELETE'])
      this.before(entity, '*', (req) => req.reject(405, 'Use the actions of the QuickTest service'))

    return super.init()
  }
}
