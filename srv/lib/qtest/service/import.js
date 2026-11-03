// Upload of a test book (.xlsx, .csv, .json): "preview" says what an upload would create, change or leave alone;
// "apply" does it, in one transaction, and keeps the ids the file has.
import cds from '@sap/cds'
import { parseBook, planImport } from '../bundle.js'
import { cleanCase, cleanRequirement } from '../validate.js'
import { Q, json } from './common.js'

const { SELECT, UPDATE } = cds.ql

const LIMIT = 8 * 1024 * 1024

export function registerImport(srv, { project, guarded, items }) {
  const { Requirements, TestCases } = Q()

  srv.on(
    'importBook',
    guarded(async (req) => {
      const { projectID, filename, encoding, mode } = req.data
      const as = ['auto', 'requirements', 'cases'].includes(req.data.as) ? req.data.as : 'auto'
      const strategy = req.data.strategy === 'skip' ? 'skip' : 'update'
      await project(req, projectID, ['ID'])
      const raw = String(req.data.content ?? '')
      if (!raw) return req.reject(400, 'The file is empty')
      const content = encoding === 'base64' ? Buffer.from(raw, 'base64') : raw
      if (content.length > LIMIT) return req.reject(413, 'The file is too large (8 MB at most)')

      const parsed = parseBook({ filename, content, as })
      const [requirements, cases] = await Promise.all([
        SELECT.from(Requirements).where({ project_ID: projectID }),
        SELECT.from(TestCases).where({ project_ID: projectID }),
      ])
      const plan = planImport({ parsed, requirements, cases, strategy })
      const summary = {
        format: parsed.format,
        detected: parsed.detected,
        counts: plan.counts,
        warnings: plan.warnings.slice(0, 100),
        requirements: plan.requirements.slice(0, 300).map(({ line, action, code, title, changes }) => ({ line, action, code, title, changes })),
        cases: plan.cases.slice(0, 300).map(({ line, action, code, title, changes, requirementCodes }) => ({ line, action, code, title, changes, requirementCodes: requirementCodes ?? [] })),
      }
      if (mode !== 'apply') return json({ ...summary, applied: false })

      const idOfCode = new Map(requirements.map((r) => [r.code, r.ID]))
      for (const item of plan.requirements) {
        if (item.action === 'create') {
          const row = await items.createRequirement(projectID, { ...item.fields, code: item.code, seq: item.seq }, 'import')
          idOfCode.set(row.code, row.ID)
        } else if (item.action === 'update') {
          const fields = cleanRequirement(Object.fromEntries(item.changes.map((k) => [k, item.fields[k]])))
          await UPDATE(Requirements).set(fields).where({ ID: item.ID })
        }
      }
      for (const item of plan.cases) {
        let id = item.ID
        if (item.action === 'create') {
          const row = await items.createCase(projectID, { ...item.fields, code: item.code, seq: item.seq }, { origin: 'import', note: 'Imported' })
          id = row.ID
        } else if (item.action === 'update') {
          const row = cases.find((c) => c.ID === item.ID)
          const fields = cleanCase(Object.fromEntries(item.changes.map((k) => [k, k === 'steps' ? item.fields.stepList : item.fields[k]])))
          await items.updateCase(row, fields, 'Imported')
        }
        // links are added, never removed: an upload without the column must not cut the traceability
        if (id && item.requirementCodes?.length) {
          const have = await items.linkedRequirementIDs(id)
          const want = item.requirementCodes.map((c) => idOfCode.get(c)).filter(Boolean)
          await items.setLinks(projectID, id, [...new Set([...have, ...want])], 'import')
        }
      }
      return json({ ...summary, applied: true })
    }),
  )
}
