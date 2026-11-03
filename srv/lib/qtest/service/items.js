// Requirements, test cases, the links between them, their lists, the matrix and the dashboard.
import cds from '@sap/cds'
import { formatCode, PREFIX } from '../codes.js'
import { caseRows, dashboard, requirementRows, runRows } from '../metrics.js'
import { qtestMeta } from '../meta.js'
import { changedFields, cleanCase, cleanRequirement, cleanTags, parseSteps, tagList } from '../validate.js'
import { actor, isObject, json, linkCodes, loadBook, nextSeq, parseJson, Q, T, uuid } from './common.js'
import { listProviders } from '../../llm/provider.js'

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql

const CONTENT_FIELDS = ['title', 'objective', 'preconditions', 'priority', 'kind', 'status', 'tags', 'stepList']

export function registerItems(srv, { project, guarded }) {
  const { Requirements, TestCases, Coverage, CaseVersions, Runs, RunItems } = Q()
  const { TestPlans } = T()

  const requirement = async (req, ID) => (await SELECT.one.from(Requirements).where({ ID })) ?? req.reject(404, 'Requirement not found')
  const testCase = async (req, ID) => (await SELECT.one.from(TestCases).where({ ID })) ?? req.reject(404, 'Test case not found')

  // ---- creating and saving one item (also used by the batch, the import and the recording) -------------------------

  const createRequirement = async (projectID, fields, origin = 'manual') => {
    const seq = fields.seq ?? (await nextSeq(Requirements, projectID))
    const { seq: _s, code: _c, ...rest } = fields
    const row = { ID: uuid(), project_ID: projectID, code: fields.code ?? formatCode(PREFIX.requirement, seq), seq, ...rest, origin }
    await INSERT.into(Requirements).entries(row)
    return row
  }

  const snapshotOf = (c, steps) => ({ code: c.code, title: c.title, objective: c.objective ?? '', preconditions: c.preconditions ?? '', priority: c.priority, kind: c.kind, status: c.status, tags: c.tags ?? '', steps })

  const writeVersion = async (c, steps, note) =>
    INSERT.into(CaseVersions).entries({ ID: uuid(), testCase_ID: c.ID, version: c.version, snapshot: json(snapshotOf(c, steps)), note: note ? String(note).slice(0, 200) : null })

  const createCase = async (projectID, fields, { origin = 'manual', extra = {}, note } = {}) => {
    const seq = fields.seq ?? (await nextSeq(TestCases, projectID))
    const { stepList = [], seq: _s, code: _c, ...rest } = fields
    const row = { ID: uuid(), project_ID: projectID, code: fields.code ?? formatCode(PREFIX.testCase, seq), seq, ...rest, steps: json(stepList), origin, version: 1, ...extra }
    await INSERT.into(TestCases).entries(row)
    await writeVersion(row, stepList, note ?? 'Created')
    return { ...row, stepList }
  }

  const updateCase = async (row, fields, note) => {
    const { stepList, ...rest } = fields
    const changed = changedFields(row, fields).filter((f) => CONTENT_FIELDS.includes(f) || f === 'steps')
    const set = { ...rest }
    if (stepList) set.steps = json(stepList)
    if (!Object.keys(set).length) return row
    if (changed.length) set.version = row.version + 1
    await UPDATE(TestCases).set(set).where({ ID: row.ID })
    const now = { ...row, ...set }
    if (changed.length) await writeVersion(now, stepList ?? parseSteps(row.steps), note)
    // an automated test is named after the case: keep the name of its plan in step
    if (row.plan_ID && (set.title !== undefined)) {
      const plan = await SELECT.one.from(TestPlans).columns('definition', 'version').where({ ID: row.plan_ID })
      if (plan) {
        const def = JSON.parse(plan.definition)
        def.name = `${row.code} ${set.title}`.slice(0, 200)
        await UPDATE(TestPlans).set({ definition: json(def), name: def.name, version: plan.version + 1 }).where({ ID: row.plan_ID })
      }
    }
    return now
  }

  const setLinks = async (projectID, caseID, requirementIDs, origin = 'manual') => {
    const wanted = [...new Set(requirementIDs)]
    const valid = wanted.length ? (await SELECT.from(Requirements).columns('ID').where({ project_ID: projectID, ID: { in: wanted } })).map((r) => r.ID) : []
    const have = await SELECT.from(Coverage).columns('ID', 'requirement_ID').where({ testCase_ID: caseID })
    const haveIds = new Set(have.map((l) => l.requirement_ID))
    const drop = have.filter((l) => !valid.includes(l.requirement_ID)).map((l) => l.ID)
    if (drop.length) await DELETE.from(Coverage).where({ ID: { in: drop } })
    const add = valid.filter((id) => !haveIds.has(id)).map((id) => ({ ID: uuid(), project_ID: projectID, requirement_ID: id, testCase_ID: caseID, origin }))
    if (add.length) await INSERT.into(Coverage).entries(add)
  }

  const caseDetail = async (ID) => {
    const c = await SELECT.one.from(TestCases).where({ ID })
    if (!c) return null
    const links = await SELECT.from(Coverage).columns('requirement_ID').where({ testCase_ID: ID })
    const reqs = links.length ? await SELECT.from(Requirements).columns('ID', 'code', 'title', 'priority', 'status').where({ ID: { in: links.map((l) => l.requirement_ID) } }).orderBy('seq') : []
    const plan = c.plan_ID ? await SELECT.one.from(TestPlans).columns('ID', 'name', 'version', 'generator', 'modifiedAt').where({ ID: c.plan_ID }) : null
    const { steps, ...rest } = c
    return { ...rest, tagList: tagList(c.tags), steps: parseSteps(steps), requirements: reqs, requirementIDs: reqs.map((r) => r.ID), plan }
  }

  const requirementDetail = async (ID) => {
    const r = await SELECT.one.from(Requirements).where({ ID })
    if (!r) return null
    const links = await SELECT.from(Coverage).columns('testCase_ID').where({ requirement_ID: ID })
    const cases = links.length ? await SELECT.from(TestCases).columns('ID', 'code', 'title', 'priority', 'status', 'automation', 'lastResult', 'lastRunAt').where({ ID: { in: links.map((l) => l.testCase_ID) } }).orderBy('seq') : []
    return { ...r, tagList: tagList(r.tags), cases, caseIDs: cases.map((c) => c.ID) }
  }

  // ---- reading ---------------------------------------------------------------------------------------------------

  srv.on('qtestMeta', () => json(qtestMeta()))
  srv.on('providers', () => listProviders())

  srv.on('overview', async () => {
    const projects = await SELECT.from(T().Projects).columns('ID', 'name', 'description', 'appId', 'parseStatus', 'createdAt', 'modifiedAt').orderBy('createdAt desc')
    const [reqs, cases, links, runs] = await Promise.all([
      SELECT.from(Requirements).columns('ID', 'project_ID', 'status'),
      SELECT.from(TestCases).columns('ID', 'project_ID', 'status', 'automation', 'lastResult'),
      SELECT.from(Coverage).columns('project_ID', 'requirement_ID'),
      SELECT.from(Runs).columns('ID', 'project_ID', 'status'),
    ])
    const by = (rows) => {
      const m = new Map()
      for (const r of rows) m.set(r.project_ID, [...(m.get(r.project_ID) ?? []), r])
      return m
    }
    const [R, C, L, N] = [by(reqs), by(cases), by(links), by(runs)]
    return json(
      projects.map((p) => {
        const rs = (R.get(p.ID) ?? []).filter((r) => r.status !== 'retired')
        const cs = (C.get(p.ID) ?? []).filter((c) => c.status !== 'deprecated')
        const covered = new Set((L.get(p.ID) ?? []).map((l) => l.requirement_ID))
        const run = cs.filter((c) => c.lastResult && c.lastResult !== 'notrun')
        const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
        return {
          ...p,
          requirements: rs.length,
          cases: cs.length,
          runs: (N.get(p.ID) ?? []).length,
          coveragePct: pct(rs.filter((r) => covered.has(r.ID)).length, rs.length),
          automationPct: pct(cs.filter((c) => c.automation === 'automated').length, cs.length),
          passRate: pct(run.filter((c) => c.lastResult === 'passed').length, run.length),
          failing: cs.filter((c) => c.lastResult === 'failed').length,
        }
      }),
    )
  })

  const runsOf = async (projectID) => {
    const runs = await SELECT.from(Runs).where({ project_ID: projectID }).orderBy('createdAt desc')
    const items = runs.length ? await SELECT.from(RunItems).columns('run_ID', 'status').where({ run_ID: { in: runs.map((r) => r.ID) } }) : []
    return { runs, items }
  }

  srv.on('dashboard', async (req) => {
    await project(req, req.data.projectID, ['ID'])
    const book = await loadBook(req.data.projectID, { steps: false })
    const { runs, items } = await runsOf(req.data.projectID)
    return json(dashboard({ ...book, runs, items }))
  })

  srv.on('listRequirements', async (req) => {
    await project(req, req.data.projectID, ['ID'])
    const { requirements, cases, links } = await loadBook(req.data.projectID)
    return json(requirementRows(requirements, cases, links))
  })

  srv.on('listCases', async (req) => {
    await project(req, req.data.projectID, ['ID'])
    const { requirements, cases, links } = await loadBook(req.data.projectID, { steps: true })
    return json(caseRows(cases, requirements, links))
  })

  srv.on('getRequirement', async (req) => json(await requirementDetail(req.data.ID).then((r) => r ?? req.reject(404, 'Requirement not found'))))
  srv.on('getCase', async (req) => json(await caseDetail(req.data.ID).then((c) => c ?? req.reject(404, 'Test case not found'))))

  srv.on('caseVersions', async (req) => json(await SELECT.from(CaseVersions).columns('version', 'note', 'createdAt', 'createdBy').where({ testCase_ID: req.data.caseID }).orderBy('version desc')))
  srv.on('getCaseVersion', async (req) => {
    const v = await SELECT.one.from(CaseVersions).where({ testCase_ID: req.data.caseID, version: req.data.version })
    return v ? v.snapshot : req.reject(404, 'Version not found')
  })

  srv.on('matrix', async (req) => {
    await project(req, req.data.projectID, ['ID'])
    const { requirements, cases, links } = await loadBook(req.data.projectID)
    const rows = requirementRows(requirements, cases, links)
    return json({
      requirements: rows.map((r) => ({ ID: r.ID, code: r.code, title: r.title, priority: r.priority, status: r.status, verification: r.verification })),
      cases: cases.map((c) => ({ ID: c.ID, code: c.code, title: c.title, priority: c.priority, status: c.status, automation: c.automation, lastResult: c.lastResult })),
      links: links.map((l) => [l.requirement_ID, l.testCase_ID]),
    })
  })

  // ---- requirements ----------------------------------------------------------------------------------------------

  srv.on(
    'saveRequirement',
    guarded(async (req) => {
      const { projectID, ID } = req.data
      await project(req, projectID, ['ID'])
      const data = parseJson(req, req.data.data, 'requirement')
      if (!isObject(data)) return req.reject(400, 'The requirement must be a JSON object')
      const fields = cleanRequirement(data, { create: !ID })
      let id = ID
      if (!ID) id = (await createRequirement(projectID, fields, ['ai', 'import'].includes(data.origin) ? data.origin : 'manual')).ID
      else {
        const row = await requirement(req, ID)
        if (row.project_ID !== projectID) return req.reject(404, 'Requirement not found')
        if (Object.keys(fields).length) await UPDATE(Requirements).set(fields).where({ ID })
      }
      return json(await requirementDetail(id))
    }),
  )

  srv.on('deleteRequirement', async (req) => {
    await requirement(req, req.data.ID)
    await DELETE.from(Coverage).where({ requirement_ID: req.data.ID })
    await DELETE.from(Requirements).where({ ID: req.data.ID })
    return true
  })

  // ---- test cases ------------------------------------------------------------------------------------------------

  srv.on(
    'saveCase',
    guarded(async (req) => {
      const { projectID, ID, note } = req.data
      await project(req, projectID, ['ID'])
      const data = parseJson(req, req.data.data, 'test case')
      if (!isObject(data)) return req.reject(400, 'The test case must be a JSON object')
      const fields = cleanCase(data, { create: !ID })
      let id = ID
      if (!ID) {
        const c = await createCase(projectID, fields, { origin: ['ai', 'import'].includes(data.origin) ? data.origin : 'manual', note })
        id = c.ID
      } else {
        const row = await testCase(req, ID)
        if (row.project_ID !== projectID) return req.reject(404, 'Test case not found')
        // an automated case stays automated; the designer cannot claim it without a plan
        if (fields.automation === 'automated' && !row.plan_ID) fields.automation = 'candidate'
        await updateCase(row, fields, note)
      }
      // the requirements the case verifies travel inside `data`: absent = leave the links as they are, [] = remove them all
      if (Array.isArray(data.requirementIDs)) await setLinks(projectID, id, data.requirementIDs)
      return json(await caseDetail(id))
    }),
  )

  srv.on('deleteCase', async (req) => {
    const row = await testCase(req, req.data.ID)
    await DELETE.from(Coverage).where({ testCase_ID: row.ID })
    await DELETE.from(CaseVersions).where({ testCase_ID: row.ID })
    await UPDATE(RunItems).set({ testCase_ID: null }).where({ testCase_ID: row.ID })
    await DELETE.from(TestCases).where({ ID: row.ID })
    if (row.plan_ID) await DELETE.from(TestPlans).where({ ID: row.plan_ID })
    return true
  })

  srv.on('duplicateCase', async (req) => {
    const row = await testCase(req, req.data.ID)
    const steps = parseSteps(row.steps).map((s) => ({ ...s, auto: [] }))
    const copy = await createCase(
      row.project_ID,
      { title: `${row.title} (copy)`.slice(0, 300), objective: row.objective, preconditions: row.preconditions, priority: row.priority, kind: row.kind, status: 'draft', tags: row.tags, owner: row.owner, stepList: steps },
      { note: `Copy of ${row.code}` },
    )
    const links = await SELECT.from(Coverage).columns('requirement_ID').where({ testCase_ID: row.ID })
    await setLinks(row.project_ID, copy.ID, links.map((l) => l.requirement_ID))
    return json(await caseDetail(copy.ID))
  })

  srv.on('restoreCaseVersion', async (req) => {
    const row = await testCase(req, req.data.caseID)
    const v = await SELECT.one.from(CaseVersions).where({ testCase_ID: row.ID, version: req.data.version })
    if (!v) return req.reject(404, 'Version not found')
    const snap = JSON.parse(v.snapshot)
    await updateCase(row, { title: snap.title, objective: snap.objective, preconditions: snap.preconditions, priority: snap.priority, kind: snap.kind, status: snap.status, tags: snap.tags, stepList: cleanCase({ title: 'x', steps: snap.steps }, { create: true }).stepList }, `Restored from version ${v.version}`)
    return json(await caseDetail(row.ID))
  })

  // ---- several at once -------------------------------------------------------------------------------------------

  const KINDS = { requirements: Requirements, cases: TestCases }
  const entityOf = (req, name) => KINDS[name] ?? req.reject(400, 'entity must be "requirements" or "cases"')

  srv.on(
    'bulk',
    guarded(async (req) => {
      const { projectID, ids } = req.data
      const E = entityOf(req, req.data.entity)
      const patch = parseJson(req, req.data.patch, 'change')
      if (!isObject(patch)) return req.reject(400, 'The change must be a JSON object')
      await project(req, projectID, ['ID'])
      const allowed = req.data.entity === 'cases' ? ['status', 'priority', 'kind', 'owner', 'automation'] : ['status', 'priority', 'kind', 'owner', 'source']
      const base = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)))
      const clean = req.data.entity === 'cases' ? cleanCase(base) : cleanRequirement(base)
      const columns = req.data.entity === 'cases' ? ['ID', 'tags', 'plan_ID'] : ['ID', 'tags']
      const rows = ids?.length ? await SELECT.from(E).columns(...columns).where({ project_ID: projectID, ID: { in: ids } }) : []
      for (const r of rows) {
        const set = { ...clean }
        if (patch.addTags !== undefined || patch.removeTags !== undefined || patch.tags !== undefined) {
          let tags = patch.tags !== undefined ? tagList(cleanTags(patch.tags)) : tagList(r.tags)
          const add = tagList(cleanTags(patch.addTags))
          const remove = new Set(tagList(cleanTags(patch.removeTags)).map((t) => t.toLowerCase()))
          tags = tags.concat(add).filter((t) => !remove.has(t.toLowerCase()))
          set.tags = cleanTags(tags)
        }
        if (req.data.entity === 'cases' && set.automation === 'automated' && !r.plan_ID) delete set.automation
        if (Object.keys(set).length) await UPDATE(E).set(set).where({ ID: r.ID })
      }
      return rows.length
    }),
  )

  srv.on('bulkDelete', async (req) => {
    const { projectID, ids } = req.data
    const E = entityOf(req, req.data.entity)
    if (!ids?.length) return 0
    const own = (await SELECT.from(E).columns('ID').where({ project_ID: projectID, ID: { in: ids } })).map((r) => r.ID)
    if (!own.length) return 0
    if (req.data.entity === 'requirements') await DELETE.from(Coverage).where({ requirement_ID: { in: own } })
    else {
      const plans = (await SELECT.from(TestCases).columns('plan_ID').where({ ID: { in: own } })).map((c) => c.plan_ID).filter(Boolean)
      await DELETE.from(Coverage).where({ testCase_ID: { in: own } })
      await DELETE.from(CaseVersions).where({ testCase_ID: { in: own } })
      await UPDATE(RunItems).set({ testCase_ID: null }).where({ testCase_ID: { in: own } })
      if (plans.length) await DELETE.from(TestPlans).where({ ID: { in: plans } })
    }
    await DELETE.from(E).where({ ID: { in: own } })
    return own.length
  })

  // ---- links -----------------------------------------------------------------------------------------------------

  srv.on('setCoverage', async (req) => {
    const { requirementID, caseID, linked } = req.data
    const r = await requirement(req, requirementID)
    const c = await testCase(req, caseID)
    if (r.project_ID !== c.project_ID) return req.reject(400, 'The requirement and the test case belong to different projects')
    const existing = await SELECT.one.from(Coverage).columns('ID').where({ requirement_ID: requirementID, testCase_ID: caseID })
    if (linked && !existing) await INSERT.into(Coverage).entries({ ID: uuid(), project_ID: r.project_ID, requirement_ID: requirementID, testCase_ID: caseID, origin: 'manual' })
    if (!linked && existing) await DELETE.from(Coverage).where({ ID: existing.ID })
    return true
  })

  srv.on('linkCases', async (req) => {
    const r = await requirement(req, req.data.requirementID)
    const wanted = [...new Set(req.data.caseIDs ?? [])]
    const valid = wanted.length ? (await SELECT.from(TestCases).columns('ID').where({ project_ID: r.project_ID, ID: { in: wanted } })).map((c) => c.ID) : []
    const have = await SELECT.from(Coverage).columns('ID', 'testCase_ID').where({ requirement_ID: r.ID })
    const drop = have.filter((l) => !valid.includes(l.testCase_ID)).map((l) => l.ID)
    if (drop.length) await DELETE.from(Coverage).where({ ID: { in: drop } })
    const haveIds = new Set(have.map((l) => l.testCase_ID))
    const add = valid.filter((id) => !haveIds.has(id)).map((id) => ({ ID: uuid(), project_ID: r.project_ID, requirement_ID: r.ID, testCase_ID: id, origin: 'manual' }))
    if (add.length) await INSERT.into(Coverage).entries(add)
    return valid.length
  })

  // ---- a reviewed batch (AI proposals) -----------------------------------------------------------------------------

  srv.on(
    'saveBatch',
    guarded(async (req) => {
      const { projectID } = req.data
      await project(req, projectID, ['ID'])
      const payload = parseJson(req, req.data.payload, 'batch')
      const origin = payload.origin === 'import' ? 'import' : 'ai'
      const keyToID = new Map()
      const made = { requirements: [], cases: [] }
      for (const r of Array.isArray(payload.requirements) ? payload.requirements.slice(0, 200) : []) {
        const row = await createRequirement(projectID, cleanRequirement(r, { create: true }), origin)
        if (r.key) keyToID.set(String(r.key), row.ID)
        made.requirements.push({ key: r.key ?? null, ID: row.ID, code: row.code })
      }
      for (const c of Array.isArray(payload.cases) ? payload.cases.slice(0, 400) : []) {
        const row = await createCase(projectID, cleanCase(c, { create: true }), { origin, note: origin === 'ai' ? 'Created by AI' : 'Created' })
        const refs = [...(c.requirementIDs ?? []), ...(c.requirementKeys ?? []).map((k) => keyToID.get(String(k)))].filter(Boolean)
        const codes = Array.isArray(c.requirementCodes) ? c.requirementCodes : []
        let ids = refs
        if (codes.length) {
          const found = await SELECT.from(Requirements).columns('ID').where({ project_ID: projectID, code: { in: codes.map(String) } })
          ids = ids.concat(found.map((r) => r.ID))
        }
        if (ids.length) await setLinks(projectID, row.ID, ids, origin)
        made.cases.push({ key: c.key ?? null, ID: row.ID, code: row.code })
      }
      return json(made)
    }),
  )

  const linkedRequirementIDs = async (caseID) => (await SELECT.from(Coverage).columns('requirement_ID').where({ testCase_ID: caseID })).map((l) => l.requirement_ID)

  return { requirement, testCase, createRequirement, createCase, updateCase, setLinks, linkedRequirementIDs, caseDetail, writeVersion, runsOf }
}
