// Small helpers the QuickTest handlers share.
import cds from '@sap/cds'

const { SELECT } = cds.ql

export const Q = () => cds.entities('qtest')
export const T = () => cds.entities('tourd')
export const json = (v) => JSON.stringify(v)
export const uuid = () => cds.utils.uuid()

/** JSON from a request field; a 400 with the name of the field when it is not valid. */
export function parseJson(req, text, what, fallback) {
  if ((text === undefined || text === null || text === '') && fallback !== undefined) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return req.reject(400, `The ${what} is not valid JSON`)
  }
}

export const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

/** The next number for a code in the project: one above the highest ever used, deleted items included in the count of the table only. */
export async function nextSeq(entity, projectID) {
  const row = await SELECT.one.from(entity).columns('max(seq) as top').where({ project_ID: projectID })
  return (Number(row?.top) || 0) + 1
}

/** Who is acting: the login name, or nothing on an open local server. */
export function actor(req) {
  const id = req.user?.id
  return id && id !== 'anonymous' && !String(id).startsWith('extension:') ? String(id).slice(0, 120) : null
}

/** All rows a screen needs of a project in one go. */
export async function loadBook(projectID, { steps = false } = {}) {
  const { Requirements, TestCases, Coverage } = Q()
  const caseColumns = ['ID', 'project_ID', 'code', 'seq', 'title', 'objective', 'preconditions', 'priority', 'kind', 'status', 'tags', 'owner', 'automation', 'plan_ID', 'recording_ID', 'origin', 'version', 'lastResult', 'lastRunAt', 'createdAt', 'modifiedAt', 'createdBy', 'modifiedBy']
  const [requirements, cases, links] = await Promise.all([
    SELECT.from(Requirements).where({ project_ID: projectID }).orderBy('seq'),
    SELECT.from(TestCases)
      .columns(...caseColumns, ...(steps ? ['steps'] : []))
      .where({ project_ID: projectID })
      .orderBy('seq'),
    SELECT.from(Coverage).columns('ID', 'requirement_ID', 'testCase_ID', 'origin').where({ project_ID: projectID }),
  ])
  return { requirements, cases, links }
}

/** Links with the codes on both ends (what the downloads and the matrix need). */
export const linkCodes = (book) => {
  const reqById = new Map(book.requirements.map((r) => [r.ID, r.code]))
  const caseById = new Map(book.cases.map((c) => [c.ID, c.code]))
  return book.links
    .map((l) => ({ requirementCode: reqById.get(l.requirement_ID), caseCode: caseById.get(l.testCase_ID) }))
    .filter((l) => l.requirementCode && l.caseCode)
}
