// The numbers of the dashboard and the status shown in the lists. Pure functions over plain rows, so they are cheap to
// test and the same everywhere.
import { parseSteps, tagList } from './validate.js'

const count = (rows, key) => {
  const out = {}
  for (const r of rows) out[r[key] ?? ''] = (out[r[key] ?? ''] ?? 0) + 1
  return out
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

/**
 * What the newest results of a requirement's test cases say.
 *   uncovered  no test case verifies it
 *   untested   test cases exist, none has a result yet
 *   failing    at least one failed (or is blocked)
 *   passing    every test case passed
 *   partial    some passed, others have no result yet
 */
export function verification(caseResults) {
  if (!caseResults.length) return 'uncovered'
  if (caseResults.some((r) => r === 'failed' || r === 'blocked')) return 'failing'
  const done = caseResults.filter((r) => r === 'passed' || r === 'skipped').length
  if (done === caseResults.length && caseResults.some((r) => r === 'passed')) return 'passing'
  if (caseResults.some((r) => r === 'passed')) return 'partial'
  return 'untested'
}

/** Requirements for the list: the row, which test cases verify it, and what their results say. */
export function requirementRows(requirements, cases, links) {
  const caseById = new Map(cases.map((c) => [c.ID, c]))
  const casesOf = new Map()
  for (const l of links) {
    if (!casesOf.has(l.requirement_ID)) casesOf.set(l.requirement_ID, [])
    const c = caseById.get(l.testCase_ID)
    if (c) casesOf.get(l.requirement_ID).push(c)
  }
  return requirements.map((r) => {
    const cs = (casesOf.get(r.ID) ?? []).filter((c) => c.status !== 'deprecated')
    return {
      ...r,
      tagList: tagList(r.tags),
      caseCount: cs.length,
      caseCodes: cs.map((c) => c.code),
      verification: verification(cs.map((c) => c.lastResult ?? 'notrun')),
      criteria: r.acceptance ? r.acceptance.split('\n').filter((l) => l.trim()).length : 0,
    }
  })
}

/** Test cases for the list: counts instead of steps, the requirements they verify. */
export function caseRows(cases, requirements, links) {
  const reqById = new Map(requirements.map((r) => [r.ID, r]))
  const reqsOf = new Map()
  for (const l of links) {
    if (!reqsOf.has(l.testCase_ID)) reqsOf.set(l.testCase_ID, [])
    const r = reqById.get(l.requirement_ID)
    if (r) reqsOf.get(l.testCase_ID).push(r)
  }
  return cases.map(({ steps, ...c }) => {
    const list = parseSteps(steps)
    const rs = reqsOf.get(c.ID) ?? []
    const mapped = list.filter((s) => s.auto?.length).length
    return {
      ...c,
      tagList: tagList(c.tags),
      stepCount: list.length,
      mappedSteps: mapped,
      requirementCodes: rs.map((r) => r.code),
      requirementIDs: rs.map((r) => r.ID),
    }
  })
}

/** Counts per run: how many items have which result. */
export function runRows(runs, items) {
  const byRun = new Map()
  for (const i of items) {
    if (!byRun.has(i.run_ID)) byRun.set(i.run_ID, [])
    byRun.get(i.run_ID).push(i)
  }
  return runs.map((r) => {
    const list = byRun.get(r.ID) ?? []
    const c = count(list, 'status')
    const total = list.length
    const done = total - (c.notrun ?? 0)
    return {
      ...r,
      total,
      counts: { notrun: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, ...c },
      progress: pct(done, total),
      passRate: pct(c.passed ?? 0, done),
    }
  })
}

export function dashboard({ requirements, cases, links, runs, items }) {
  const live = cases.filter((c) => c.status !== 'deprecated')
  const reqs = requirementRows(requirements.filter((r) => r.status !== 'retired'), live, links)
  const verif = count(reqs, 'verification')
  const caseIds = new Set(links.map((l) => l.testCase_ID))
  const automation = count(live, 'automation')
  const results = count(live, 'lastResult')
  const rows = runRows(runs, items)
  const lastRun = rows.filter((r) => r.total).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null
  const covered = reqs.length - (verif.uncovered ?? 0)
  return {
    requirements: {
      total: reqs.length,
      covered,
      coveragePct: pct(covered, reqs.length),
      verification: { uncovered: 0, untested: 0, failing: 0, passing: 0, partial: 0, ...verif },
      passingPct: pct(verif.passing ?? 0, reqs.length),
      byPriority: count(reqs, 'priority'),
      byStatus: count(requirements, 'status'),
    },
    cases: {
      total: live.length,
      byStatus: count(cases, 'status'),
      byKind: count(live, 'kind'),
      byPriority: count(live, 'priority'),
      automation: { manual: 0, candidate: 0, automated: 0, ...automation },
      automationPct: pct(automation.automated ?? 0, live.length),
      withoutRequirement: live.filter((c) => !caseIds.has(c.ID)).length,
      results: { passed: 0, failed: 0, blocked: 0, skipped: 0, ...results, notrun: live.filter((c) => !c.lastResult || c.lastResult === 'notrun').length },
    },
    runs: {
      total: runs.length,
      open: runs.filter((r) => r.status === 'open').length,
      last: lastRun && { ID: lastRun.ID, name: lastRun.name, counts: lastRun.counts, passRate: lastRun.passRate, progress: lastRun.progress, createdAt: lastRun.createdAt },
      // the newest first; the designer draws them oldest to newest
      recent: rows.filter((r) => r.total).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 10).map((r) => ({ ID: r.ID, name: r.name, counts: r.counts, total: r.total, passRate: r.passRate, createdAt: r.createdAt })),
    },
    gaps: {
      uncovered: reqs.filter((r) => r.verification === 'uncovered').slice(0, 8).map((r) => ({ ID: r.ID, code: r.code, title: r.title, priority: r.priority })),
      failing: live.filter((c) => c.lastResult === 'failed').slice(0, 8).map((c) => ({ ID: c.ID, code: c.code, title: c.title, priority: c.priority })),
      untraced: live.filter((c) => !caseIds.has(c.ID)).slice(0, 8).map((c) => ({ ID: c.ID, code: c.code, title: c.title, priority: c.priority })),
    },
  }
}
