// Readiness: the checklist of what a project depends on. The scan (srv/lib/readiness) lists the things; people check
// them. This file keeps the two apart in the database: a scan rewrites what it knows (`data`, `level`, `present`), a
// person's answer (status, note, owner, inputs) is never touched by a scan.
// Handlers are registered on TourService (see tour-service.js).
import cds from '@sap/cds'
import { scan, levelOf, stampOf, meta } from '../readiness/index.js'
import { CATEGORIES, CATEGORY_IDS, STATUS_IDS } from '../readiness/categories.js'

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql
const uuid = () => cds.utils.uuid()
const KEEP_SCANS = 20

/** What a scan writes for an item (never the person's answer). */
export const rowOf = (item) => ({
  category: item.category,
  kind: item.kind,
  title: item.title.slice(0, 300),
  severity: item.severity,
  level: levelOf(item.signals),
  present: true,
  data: JSON.stringify({
    summary: item.summary,
    sources: item.sources,
    attrs: item.attrs,
    links: item.links,
    verify: item.verify,
    fields: item.fields,
    signals: item.signals,
  }),
})

/**
 * Compares the rows in the database with a new scan.
 * @returns {{insert: object[], update: Array<{ID: string, row: object}>, hide: string[], added: string[], removed: string[]}}
 *   `hide`: ids of rows the scan no longer finds (kept, marked absent, so the answer is not lost)
 */
export function reconcile(existing, items) {
  const byKey = new Map(existing.filter((r) => r.origin !== 'manual').map((r) => [r.itemKey, r]))
  const insert = []
  const update = []
  const added = []
  const seen = new Set()
  for (const item of items) {
    seen.add(item.key)
    const row = byKey.get(item.key)
    if (row) update.push({ ID: row.ID, row: rowOf(item) })
    else {
      insert.push({ ID: uuid(), itemKey: item.key, origin: 'scan', status: 'open', ...rowOf(item) })
      added.push(item.key)
    }
  }
  const gone = [...byKey.values()].filter((r) => !seen.has(r.itemKey) && r.present !== false)
  return { insert, update, hide: gone.map((r) => r.ID), added, removed: gone.map((r) => r.itemKey) }
}

const needsAttention = (r) =>
  r.status === 'broken' || (r.level === 'error' && r.status !== 'working' && r.status !== 'na')

const bucket = () => ({
  total: 0,
  open: 0,
  working: 0,
  broken: 0,
  na: 0,
  error: 0,
  warning: 0,
  attention: 0,
  progress: 0,
})

function count(b, r) {
  b.total++
  b[STATUS_IDS.has(r.status) ? r.status : 'open']++
  if (r.level === 'error' || r.level === 'warning') b[r.level]++
  if (needsAttention(r)) b.attention++
  b.progress = (b.working + b.na) / b.total
}

/** Numbers for the overview and the tiles. `rows` need category, status, level, present. */
export function summarize(rows, { lastScan = null, stamp = null, hasFiles = false } = {}) {
  const live = rows.filter((r) => r.present !== false)
  const all = bucket()
  const categories = new Map(CATEGORIES.map((c) => [c.id, { id: c.id, ...bucket() }]))
  for (const r of live) {
    count(all, r)
    count(categories.get(r.category) ?? categories.get('other'), r)
  }
  return {
    ...all,
    categories: [...categories.values()],
    absent: rows.length - live.length,
    hasFiles,
    scan: lastScan && { at: lastScan.createdAt, files: lastScan.files, total: lastScan.total },
    outdated: !!lastScan && !!stamp && lastScan.stamp !== stamp,
  }
}

export function registerReadiness(srv, { project, guarded }) {
  const { Sources, ReadinessItems, ReadinessScans } = cds.entities('tourd')

  const filesOf = (projectID) =>
    SELECT.from(Sources)
      .columns('path', 'content', 'hash')
      .where({ project_ID: projectID, deleted: false, binary: false })

  const item = async (req, ID) =>
    (await SELECT.one.from(ReadinessItems).where({ ID })) ?? req.reject(404, 'Check not found')

  srv.on('readinessMeta', () => JSON.stringify(meta()))

  srv.on(
    'scanReadiness',
    guarded(async (req) => {
      const { projectID } = req.data
      await project(req, projectID, ['ID'])
      const files = await filesOf(projectID)
      if (!files.length)
        return req.reject(409, 'Upload the project first: there are no files to read.')
      const result = scan(files)
      const existing = await SELECT.from(ReadinessItems)
        .columns('ID', 'itemKey', 'origin', 'present')
        .where({ project_ID: projectID })
      const plan = reconcile(existing, result.items)

      if (plan.insert.length)
        await INSERT.into(ReadinessItems).entries(
          plan.insert.map((r) => ({ ...r, project_ID: projectID })),
        )
      for (const u of plan.update) await UPDATE(ReadinessItems).set(u.row).where({ ID: u.ID })
      if (plan.hide.length)
        await UPDATE(ReadinessItems)
          .set({ present: false })
          .where({ ID: { in: plan.hide } })

      const scanID = uuid()
      await INSERT.into(ReadinessScans).entries({
        ID: scanID,
        project_ID: projectID,
        files: result.files,
        stamp: stampOf(files),
        total: result.items.length,
        report: JSON.stringify({
          added: plan.added,
          removed: plan.removed,
          warnings: result.warnings,
        }),
      })
      const old = await SELECT.from(ReadinessScans)
        .columns('ID')
        .where({ project_ID: projectID })
        .orderBy('createdAt desc')
      if (old.length > KEEP_SCANS)
        await DELETE.from(ReadinessScans).where({
          ID: { in: old.slice(KEEP_SCANS).map((s) => s.ID) },
        })

      return JSON.stringify({
        scanID,
        files: result.files,
        total: result.items.length,
        added: plan.added,
        removed: plan.removed,
        warnings: result.warnings,
      })
    }),
  )

  srv.on('readinessSummary', async (req) => {
    const { projectID } = req.data
    await project(req, projectID, ['ID'])
    const [rows, lastScan, files] = await Promise.all([
      SELECT.from(ReadinessItems)
        .columns('category', 'status', 'level', 'present')
        .where({ project_ID: projectID }),
      SELECT.one
        .from(ReadinessScans)
        .columns('createdAt', 'files', 'total', 'stamp')
        .where({ project_ID: projectID })
        .orderBy('createdAt desc'),
      SELECT.from(Sources)
        .columns('path', 'hash')
        .where({ project_ID: projectID, deleted: false, binary: false }),
    ])
    return JSON.stringify(
      summarize(rows, { lastScan, stamp: stampOf(files), hasFiles: files.length > 0 }),
    )
  })

  srv.on('readinessScanReport', async (req) => {
    const { projectID } = req.data
    const row = await SELECT.one
      .from(ReadinessScans)
      .columns('createdAt', 'files', 'total', 'report')
      .where({ project_ID: projectID })
      .orderBy('createdAt desc')
    return row
      ? JSON.stringify({
          at: row.createdAt,
          files: row.files,
          total: row.total,
          ...JSON.parse(row.report ?? '{}'),
        })
      : null
  })

  srv.on(
    'checkReadiness',
    guarded(async (req) => {
      const { itemID, status, note, owner, inputs } = req.data
      const row = await item(req, itemID)
      const set = {}
      if (status != null) {
        if (!STATUS_IDS.has(status)) return req.reject(400, `Unknown answer "${status}"`)
        if (status !== row.status)
          Object.assign(set, {
            status,
            checkedAt: new Date().toISOString(),
            checkedBy: req.user?.id ?? null,
          })
      }
      if (note != null) set.note = String(note).slice(0, 2000)
      if (owner != null) set.owner = String(owner).slice(0, 120)
      if (inputs != null) {
        let parsed
        try {
          parsed = JSON.parse(inputs)
        } catch {
          return req.reject(400, 'The values are not valid JSON')
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
          return req.reject(400, 'The values must be an object')
        const clean = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [
            String(k).slice(0, 60),
            String(v ?? '').slice(0, 1000),
          ]),
        )
        set.inputs = JSON.stringify(clean)
      }
      if (Object.keys(set).length) await UPDATE(ReadinessItems).set(set).where({ ID: itemID })
      return { ...row, ...set }
    }),
  )

  srv.on(
    'addReadinessItem',
    guarded(async (req) => {
      const { projectID, category, title, summary } = req.data
      await project(req, projectID, ['ID'])
      const name = String(title ?? '').trim()
      if (!name) return req.reject(400, 'Give the check a title')
      if (!CATEGORY_IDS.has(category)) return req.reject(400, `Unknown category "${category}"`)
      const ID = uuid()
      await INSERT.into(ReadinessItems).entries({
        ID,
        project_ID: projectID,
        itemKey: `${category}:manual:${ID}`,
        category,
        kind: 'manual',
        title: name.slice(0, 300),
        severity: 'normal',
        level: '',
        origin: 'manual',
        present: true,
        status: 'open',
        data: JSON.stringify({
          summary: String(summary ?? '').slice(0, 500),
          sources: [],
          attrs: {},
          links: [],
          verify: [],
          fields: [],
          signals: [],
        }),
      })
      return SELECT.one.from(ReadinessItems).where({ ID })
    }),
  )

  srv.on(
    'removeReadinessItem',
    guarded(async (req) => {
      const row = await item(req, req.data.itemID)
      if (row.origin !== 'manual' && row.present !== false)
        return req.reject(
          409,
          'Only checks you added, or checks the scan no longer finds, can be removed.',
        )
      await DELETE.from(ReadinessItems).where({ ID: row.ID })
      return true
    }),
  )
}
