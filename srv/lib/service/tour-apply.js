// "Add the tour to the project": previewTourApply returns what would change (file by file, before and after),
// applyTourToProject writes the files the user accepted. The edits are computed again on apply, from the files as
// they are then, so a file changed in between is never overwritten with an outdated plan.
import cds from '@sap/cds'
import { readFile } from 'node:fs/promises'
import { planTourApply } from '../export/apply.js'
import { normalizeSourcePath } from './sources.js'

const { SELECT } = cds.ql

export function registerTourApply(srv, { project, rebuildInventory, guarded, workspace }) {
  const { Sources, Tours } = cds.entities('tourd')

  const planFor = async (req, tourID) => {
    const tour = await SELECT.one.from(Tours).where({ ID: tourID })
    if (!tour) return req.reject(404, 'Tour not found')
    const p = await project(req, tour.project_ID)
    let inventory = null
    try {
      inventory = p.inventory ? JSON.parse(p.inventory) : null
    } catch {
      /* the plan then says the tour could not be checked */
    }
    const files = await SELECT.from(Sources)
      .columns('path', 'content')
      .where({ project_ID: tour.project_ID, deleted: false, binary: false })
    const playerSource = await readFile(
      new URL('../../../player/TourPlayer.js', import.meta.url),
      'utf8',
    )
    return {
      projectID: tour.project_ID,
      plan: planTourApply({ tour: JSON.parse(tour.definition), inventory, files, playerSource }),
    }
  }

  srv.on('previewTourApply', async (req) => {
    const { plan } = await planFor(req, req.data.tourID)
    return {
      ok: plan.ok,
      blocking: plan.blocking,
      notes: plan.notes,
      edits: plan.edits
        .filter((e) => e.action !== 'unchanged')
        // the edits of existing code first: those are the ones to read
        .sort((x, y) => (x.action === y.action ? 0 : x.action === 'modify' ? -1 : 1))
        .map((e) => ({
          path: e.path,
          action: e.action,
          what: e.what,
          before: e.before,
          after: e.after,
        })),
    }
  })

  srv.on(
    'applyTourToProject',
    guarded(async (req) => {
      const { projectID, plan } = await planFor(req, req.data.tourID)
      if (!plan.ok) return req.reject(409, plan.blocking[0]?.message ?? 'The tour cannot be added')
      const wanted = Array.isArray(req.data.paths)
        ? new Set(req.data.paths.map(normalizeSourcePath))
        : null
      const todo = plan.edits.filter(
        (e) => e.action !== 'unchanged' && (!wanted || wanted.has(e.path)),
      )
      for (const e of todo) await workspace.writeFile(req, projectID, e.path, e.after)
      if (todo.length) await rebuildInventory(projectID)
      // "also make them part of the project": they do not show up as changes
      if (req.data.accept && todo.length)
        await workspace.accept(projectID, { paths: todo.map((e) => e.path) })
      return { applied: todo.length, paths: todo.map((e) => e.path) }
    }),
  )
}
