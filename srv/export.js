// /export/<tourId>.zip           the export bundle (409 with the list of problems if the tour is not fit to ship,
//                                unless ?force=1, which adds a PROBLEMS.txt)
// /export/<tourId>/check.json    what the export would contain and whether anything blocks it
// /export/project/<projectId>/changes.zip | changes.patch | full.zip   the project's files (lib/export/project.js)
import cds from '@sap/cds'
import { readFile } from 'node:fs/promises'
import { toTourJsonSchema } from '../shared/tour-schema.mjs'
import { buildBundle, checkExport, slugOf } from './lib/export/bundle.js'
import { buildChangesZip, buildFullZip, buildPatch, classify } from './lib/export/project.js'
import { protect, through } from './lib/protect.js'
import { inventoryWithLive } from './lib/service/live-inventory.js'

const { SELECT } = cds.ql
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ZIP = new RegExp(`^/(${UUID})\\.zip$`, 'i')
const CHECK = new RegExp(`^/(${UUID})/check\\.json$`, 'i')
const PROJECT = new RegExp(`^/project/(${UUID})/(changes\\.zip|full\\.zip|changes\\.patch)$`, 'i')

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const json = (res, status, body) =>
  res
    .status(status)
    .set({ ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' })
    .send(JSON.stringify(body))

async function load(tourID) {
  const { Tours, Projects } = cds.entities('tourd')
  const row = await SELECT.one.from(Tours).where({ ID: tourID })
  if (!row) return null
  const project = await SELECT.one.from(Projects).columns('inventory').where({ ID: row.project_ID })
  let inventory = null
  try {
    inventory = project?.inventory ? await inventoryWithLive(JSON.parse(project.inventory), row.project_ID) : null
  } catch {
    /* an unreadable inventory means the controls cannot be checked */
  }
  return { row, tour: JSON.parse(row.definition), inventory }
}

async function bundleFor(loaded, force) {
  const playerSource = await readFile(new URL('../player/TourPlayer.js', import.meta.url), 'utf8')
  return buildBundle({
    tour: loaded.tour,
    inventory: loaded.inventory,
    playerSource,
    schemaJson: JSON.stringify(toTourJsonSchema(), null, 2) + '\n',
    force,
  })
}

/** The files of a project: what changed (zip or patch) or all of it. */
async function handleProject(res, projectID, what) {
  const { Projects, Sources } = cds.entities('tourd')
  const project = await SELECT.one
    .from(Projects)
    .columns('name', 'skipped')
    .where({ ID: projectID })
  if (!project) return json(res, 404, { error: 'Unknown project' })
  const rows = await SELECT.from(Sources).where({ project_ID: projectID })
  const attach = (filename, type, body) =>
    res
      .status(200)
      .set({
        ...NO_STORE,
        'Content-Type': type,
        'Content-Disposition': `attachment; filename="${filename}"`,
      })
      .send(body)

  if (what === 'full.zip') {
    let skipped = []
    try {
      skipped = project.skipped ? JSON.parse(project.skipped) : []
    } catch {
      /* treated as nothing skipped */
    }
    const missing = skipped.filter((s) => !s.expected)
    if (missing.length)
      return json(res, 409, {
        error: `The project cannot be exported as a whole: ${missing.length} file(s) could not be kept when it was uploaded. Download the changes instead.`,
        missing,
      })
    const { filename, zip } = buildFullZip(rows, project.name)
    return attach(filename, 'application/zip', Buffer.from(zip))
  }
  const counts = classify(rows)
  if (!counts.added.length && !counts.modified.length && !counts.deleted.length)
    return json(res, 409, { error: 'There are no changes yet.' })
  if (what === 'changes.patch')
    return attach(
      `${slugOf(project.name)}-changes.patch`,
      'text/x-diff; charset=utf-8',
      buildPatch(rows),
    )
  const { filename, zip } = buildChangesZip(rows, project.name)
  return attach(filename, 'application/zip', Buffer.from(zip))
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return json(res, 405, { error: 'Method not allowed' })
  const projectFiles = PROJECT.exec(req.path)
  if (projectFiles) {
    try {
      return await handleProject(res, projectFiles[1], projectFiles[2].toLowerCase())
    } catch (e) {
      cds.log('tourd').error('project export failed', e)
      return json(res, 500, { error: 'The export could not be built' })
    }
  }
  const zip = ZIP.exec(req.path)
  const check = CHECK.exec(req.path)
  if (!zip && !check) return json(res, 404, { error: 'Not found' })

  try {
    const loaded = await load((zip ?? check)[1])
    if (!loaded) return json(res, 404, { error: 'Unknown tour' })

    if (check) {
      const bundle = await bundleFor(loaded, true)
      return json(res, 200, {
        ...bundle.check,
        filename: bundle.filename,
        title: loaded.tour.title,
        version: loaded.row.version,
        files: Object.keys(bundle.files),
      })
    }

    const force = req.query.force === '1'
    const result = checkExport(loaded.tour, loaded.inventory)
    if (!result.ok && !force)
      return json(res, 409, {
        error: 'The tour has problems that must be fixed before it can be exported',
        blocking: result.blocking,
        warnings: result.warnings,
      })
    const bundle = await bundleFor(loaded, force)
    return res
      .status(200)
      .set({
        ...NO_STORE,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${slugOf(loaded.tour.title)}-tourd.zip"`,
      })
      .send(Buffer.from(bundle.zip))
  } catch (e) {
    cds.log('tourd').error('export failed', e)
    return json(res, 500, { error: 'The export could not be built' })
  }
}

export function registerExport(app) {
  const viewer = protect('Viewer')
  app.use('/export', (req, res, next) => through(viewer, req, res, next), (req, res) => handle(req, res))
}
