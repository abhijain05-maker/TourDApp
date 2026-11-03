// The vocabulary of QuickTest as data. The designer draws its filters, chips and pickers from qtestMeta(), the server
// validates against the same lists: a new priority, kind or status is one entry here, nothing else changes.
// `state` is an SAPUI5 ValueState (Error | Warning | Success | Information | None); `synonyms` are what an upload
// from another tool may say (they are matched in lower case).

const list = (rows) => rows.map(([id, label, state, synonyms = []]) => ({ id, label, state, synonyms }))

export const PRIORITIES = list([
  ['critical', 'Critical', 'Error', ['blocker', 'p0', 'p1', 'urgent', 'highest', '1']],
  ['high', 'High', 'Warning', ['major', 'p2', '2']],
  ['medium', 'Medium', 'None', ['normal', 'moderate', 'p3', '3', 'default']],
  ['low', 'Low', 'Information', ['minor', 'trivial', 'p4', 'p5', 'lowest', '4', '5']],
])

export const REQUIREMENT_KINDS = list([
  ['functional', 'Functional', 'None', ['feature', 'story', 'user story', 'business']],
  ['ui', 'UI / UX', 'None', ['ux', 'usability', 'screen', 'layout']],
  ['data', 'Data', 'None', ['database', 'model', 'validation']],
  ['integration', 'Integration', 'None', ['api', 'odata', 'interface', 'destination']],
  ['security', 'Security', 'None', ['authorization', 'authorisation', 'authentication', 'role', 'roles']],
  ['performance', 'Performance', 'None', ['speed', 'load', 'scalability']],
  ['accessibility', 'Accessibility', 'None', ['a11y']],
  ['other', 'Other', 'None', []],
])

export const REQUIREMENT_STATUSES = list([
  ['draft', 'Draft', 'None', ['new', 'open', 'proposed']],
  ['approved', 'Approved', 'Information', ['accepted', 'ready', 'baselined']],
  ['implemented', 'Implemented', 'Warning', ['done', 'in test', 'developed', 'resolved']],
  ['verified', 'Verified', 'Success', ['tested', 'closed', 'passed']],
  ['retired', 'Retired', 'None', ['obsolete', 'rejected', 'dropped', 'deprecated', 'cancelled']],
])

export const CASE_KINDS = list([
  ['functional', 'Functional', 'None', ['positive', 'happy path', 'feature']],
  ['smoke', 'Smoke', 'None', ['sanity', 'bvt']],
  ['regression', 'Regression', 'None', []],
  ['negative', 'Negative', 'None', ['error', 'invalid']],
  ['boundary', 'Boundary', 'None', ['limit', 'edge']],
  ['ui', 'UI / UX', 'None', ['ux', 'usability', 'layout']],
  ['integration', 'Integration', 'None', ['api', 'e2e', 'end to end']],
  ['security', 'Security', 'None', ['authorization', 'authorisation', 'role']],
  ['accessibility', 'Accessibility', 'None', ['a11y']],
  ['performance', 'Performance', 'None', ['load', 'speed']],
])

export const CASE_STATUSES = list([
  ['draft', 'Draft', 'None', ['new', 'open']],
  ['review', 'In review', 'Information', ['in review', 'under review']],
  ['ready', 'Ready', 'Success', ['approved', 'final', 'active']],
  ['deprecated', 'Deprecated', 'Warning', ['obsolete', 'retired', 'archived', 'inactive']],
])

export const AUTOMATION = list([
  ['manual', 'Manual', 'None', ['no', 'not automated']],
  ['candidate', 'Candidate', 'Information', ['planned', 'to automate', 'automatable']],
  ['automated', 'Automated', 'Success', ['yes', 'wdi5', 'automatic']],
])

export const RESULTS = list([
  ['notrun', 'Not run', 'None', ['not executed', 'unexecuted', 'pending', 'todo']],
  ['passed', 'Passed', 'Success', ['pass', 'ok', 'success', 'green']],
  ['failed', 'Failed', 'Error', ['fail', 'failure', 'error', 'red']],
  ['blocked', 'Blocked', 'Warning', ['block']],
  ['skipped', 'Skipped', 'Information', ['skip', 'ignored', 'n/a', 'na']],
])

export const RUN_STATUSES = list([
  ['open', 'Open', 'Information'],
  ['closed', 'Closed', 'Success'],
])

export const ORIGINS = ['manual', 'ai', 'import', 'recording']

const ids = (rows) => rows.map((r) => r.id)
export const SETS = {
  priority: ids(PRIORITIES),
  requirementKind: ids(REQUIREMENT_KINDS),
  requirementStatus: ids(REQUIREMENT_STATUSES),
  caseKind: ids(CASE_KINDS),
  caseStatus: ids(CASE_STATUSES),
  automation: ids(AUTOMATION),
  result: ids(RESULTS),
}

/**
 * Finds the entry of `rows` that `value` names: by id, label or synonym (any case).
 * @returns {string|null} the id, or null when the value is empty or unknown
 */
export function resolve(rows, value) {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!v) return null
  for (const r of rows) if (r.id === v || r.label.toLowerCase() === v) return r.id
  for (const r of rows) if (r.synonyms.includes(v)) return r.id
  return null
}

export const qtestMeta = () => ({
  priorities: PRIORITIES.map(({ synonyms, ...r }) => r),
  requirementKinds: REQUIREMENT_KINDS.map(({ synonyms, ...r }) => r),
  requirementStatuses: REQUIREMENT_STATUSES.map(({ synonyms, ...r }) => r),
  caseKinds: CASE_KINDS.map(({ synonyms, ...r }) => r),
  caseStatuses: CASE_STATUSES.map(({ synonyms, ...r }) => r),
  automation: AUTOMATION.map(({ synonyms, ...r }) => r),
  results: RESULTS.map(({ synonyms, ...r }) => r),
  runStatuses: RUN_STATUSES,
  limits: { steps: 200, title: 300, text: 20000 },
})
