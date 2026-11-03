// The test book as a file: requirements, test cases and their steps, in .xlsx, .csv or .json - to download, and to
// upload again (also files that came from another tool: headers are recognised by their usual names).
//
//   exportSheets()   rows -> sheets (what the workbook and the csv contain)
//   parseBook()      uploaded file -> { requirements, cases, warnings }, whatever the format
//   planImport()     parsed + what exists -> what an import would create / update (nothing is written here)
import { parseCsv } from './csv.js'
import { readXlsx, writeXlsx } from './xlsx.js'
import { formatCode, parseCode, PREFIX } from './codes.js'
import {
  AUTOMATION,
  CASE_KINDS,
  CASE_STATUSES,
  PRIORITIES,
  REQUIREMENT_KINDS,
  REQUIREMENT_STATUSES,
} from './meta.js'
import { changedFields, cleanCase, cleanRequirement, parseSteps, tagList } from './validate.js'
import { InputError } from '../service/sources.js'

// field -> [header shown in files, the other names it is known by (lower case, letters and digits only)]
export const REQUIREMENT_COLUMNS = {
  code: ['ID', ['id', 'reqid', 'requirementid', 'key', 'code', 'number', 'no', 'ref']],
  title: ['Title', ['title', 'name', 'summary', 'requirement', 'shortdescription', 'requirementname']],
  description: ['Description', ['description', 'details', 'text', 'desc', 'longdescription']],
  acceptance: ['Acceptance criteria', ['acceptancecriteria', 'acceptance', 'criteria', 'ac', 'acceptancecriterion']],
  priority: ['Priority', ['priority', 'prio', 'severity', 'importance']],
  kind: ['Type', ['type', 'category', 'kind', 'requirementtype']],
  status: ['Status', ['status', 'state']],
  tags: ['Tags', ['tags', 'labels', 'keywords']],
  source: ['Source', ['source', 'reference', 'origin', 'ticket', 'link']],
  owner: ['Owner', ['owner', 'assignee', 'author', 'responsible']],
}

export const CASE_COLUMNS = {
  code: ['ID', ['id', 'testcaseid', 'tcid', 'testid', 'key', 'code', 'number', 'no', 'ref']],
  title: ['Title', ['title', 'name', 'summary', 'testcase', 'testcasename', 'testname', 'testcasetitle']],
  objective: ['Objective', ['objective', 'description', 'purpose', 'goal', 'details']],
  preconditions: ['Preconditions', ['preconditions', 'precondition', 'prerequisites', 'prerequisite', 'setup', 'given']],
  priority: ['Priority', ['priority', 'prio', 'importance']],
  kind: ['Type', ['type', 'testtype', 'category', 'kind', 'suite']],
  status: ['Status', ['status', 'state']],
  tags: ['Tags', ['tags', 'labels', 'keywords']],
  owner: ['Owner', ['owner', 'assignee', 'author', 'responsible']],
  automation: ['Automation', ['automation', 'automationstatus', 'automated', 'automationstate']],
  requirements: [
    'Requirements',
    ['requirements', 'requirement', 'requirementids', 'reqids', 'linkedrequirements', 'covers', 'coverage', 'traceability', 'verifies'],
  ],
}

export const STEP_COLUMNS = {
  case: ['Test case', ['testcase', 'testcaseid', 'tcid', 'case', 'caseid', 'test', 'testid', 'id']],
  action: ['Action', ['action', 'step', 'stepaction', 'steps', 'teststep', 'stepdescription', 'procedure', 'instruction']],
  data: ['Test data', ['testdata', 'data', 'input', 'inputdata', 'stepdata']],
  expected: ['Expected result', ['expectedresult', 'expected', 'expectedresults', 'expectedoutcome', 'expectedbehaviour', 'expectedbehavior', 'result']],
}

// the cases table may also hold the steps (one row per step)
const FLAT_COLUMNS = { ...CASE_COLUMNS, action: STEP_COLUMNS.action, data: STEP_COLUMNS.data, expected: STEP_COLUMNS.expected }

const IGNORED = new Set(['stepno', 'stepnumber', 'stepnr', 'stepnum', 'n', 'nr', 'seq', 'order', 'index'])

const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const normTitle = (t) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** header cell -> field name, each field used once (the first column that can be it wins), for one set of columns. */
function mapHeaders(header, columns) {
  const taken = new Set()
  return header.map((h) => {
    const key = normHeader(h)
    if (!key || IGNORED.has(key)) return null
    for (const [field, [shown, names]] of Object.entries(columns)) {
      if (taken.has(field)) continue
      if (key === normHeader(shown) || names.includes(key)) {
        taken.add(field)
        return field
      }
    }
    return null
  })
}

/** The first of the top rows that has at least two headers we know; rows -> [{field: text}], and how many fields matched. */
function table(rows, columns) {
  for (let h = 0; h < Math.min(rows.length, 6); h++) {
    const map = mapHeaders(rows[h], columns)
    const fields = map.filter(Boolean)
    if (fields.length < 2) continue
    const out = []
    for (const row of rows.slice(h + 1)) {
      const item = {}
      row.forEach((v, c) => {
        if (map[c] && String(v ?? '').trim() !== '') item[map[c]] = String(v)
      })
      if (Object.keys(item).length) out.push(item)
    }
    return { rows: out, fields: new Set(fields) }
  }
  return { rows: [], fields: new Set() }
}

const splitList = (v) =>
  String(v ?? '')
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)

function toRequirement(r) {
  return { ...r, acceptance: Array.isArray(r.acceptance) ? r.acceptance.join('\n') : r.acceptance }
}

function groupSteps(rows, cases, warnings) {
  const byCode = new Map()
  const byTitle = new Map()
  for (const c of cases) {
    if (c.code) byCode.set(String(c.code).toLowerCase(), c)
    byTitle.set(normTitle(c.title), c)
  }
  for (const s of rows) {
    const ref = String(s.case ?? '').trim()
    const target = byCode.get(ref.toLowerCase()) ?? byCode.get((parseCode(ref, PREFIX.testCase)?.code ?? '').toLowerCase()) ?? byTitle.get(normTitle(ref))
    if (!target) {
      warnings.push(`A step refers to the test case "${ref.slice(0, 40)}", which is not in the file`)
      continue
    }
    ;(target.steps ??= []).push({ action: s.action ?? '', data: s.data ?? '', expected: s.expected ?? '' })
  }
}

/** One table of test cases, possibly with one row per step (flat). */
function casesFrom(tab) {
  const flat = ['action', 'data', 'expected'].some((f) => tab.fields.has(f))
  const out = []
  let last = null
  for (const row of tab.rows) {
    const starts = row.code || row.title
    if (starts) {
      const sameAsLast = last && flat && ((row.code && row.code === last.code) || (!row.code && row.title === last.title))
      if (!sameAsLast) {
        last = { ...row, steps: [], requirements: splitList(row.requirements) }
        for (const f of ['action', 'data', 'expected']) delete last[f]
        out.push(last)
      }
    }
    if (flat && last && (row.action || row.data || row.expected))
      last.steps.push({ action: row.action ?? '', data: row.data ?? '', expected: row.expected ?? '' })
  }
  return out
}

function guessKind(fields, rows) {
  if (['action', 'expected', 'preconditions', 'automation', 'requirements'].some((f) => fields.has(f))) return 'cases'
  if (fields.has('acceptance')) return 'requirements'
  const code = rows.find((r) => r.code)?.code ?? ''
  if (parseCode(code, PREFIX.testCase)) return 'cases'
  return 'requirements'
}

/**
 * @param {{filename?: string, content: Buffer|string, as?: 'auto'|'requirements'|'cases'}} args
 * @returns {{format: string, requirements: object[], cases: object[], warnings: string[], detected: string}}
 */
export function parseBook({ filename = '', content, as = 'auto' }) {
  const warnings = []
  const name = String(filename).toLowerCase()
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8')
  const looksZip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b
  let format = looksZip || name.endsWith('.xlsx') ? 'xlsx' : name.endsWith('.json') || /^\s*[{[]/.test(buf.subarray(0, 40).toString('utf8')) ? 'json' : 'csv'

  if (format === 'json') {
    let doc
    try {
      doc = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''))
    } catch {
      throw new InputError('The file is not valid JSON')
    }
    const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])
    const requirements = list(Array.isArray(doc) ? [] : doc.requirements).map(toRequirement)
    const cases = list(Array.isArray(doc) ? doc : (doc.cases ?? doc.testCases)).map((c) => ({
      ...c,
      steps: Array.isArray(c.steps) ? c.steps : [],
      requirements: Array.isArray(c.requirements) ? c.requirements.map(String) : splitList(c.requirements),
    }))
    return { format, requirements, cases, warnings, detected: 'book' }
  }

  let sheets
  if (format === 'xlsx') {
    try {
      sheets = readXlsx(buf)
    } catch (e) {
      throw new InputError(e.message)
    }
  } else sheets = [{ name: 'csv', rows: parseCsv(buf.toString('utf8')) }]
  if (!sheets.some((s) => s.rows.length)) throw new InputError('The file has no rows')

  let requirements = []
  let cases = []
  let stepRows = []
  let detected = 'book'
  const unnamed = []
  for (const sheet of sheets) {
    const n = sheet.name.toLowerCase()
    if (/^(help|readme|info|about|traceability|matrix|coverage|lists?)$/.test(n)) continue
    if (as === 'auto' && /requirement|^reqs?$/.test(n)) requirements = requirements.concat(table(sheet.rows, REQUIREMENT_COLUMNS).rows.map(toRequirement))
    else if (as === 'auto' && /step/.test(n)) stepRows = stepRows.concat(table(sheet.rows, STEP_COLUMNS).rows)
    else if (as === 'auto' && /test|case|tc/.test(n)) cases = cases.concat(casesFrom(table(sheet.rows, FLAT_COLUMNS)))
    else unnamed.push(sheet)
  }
  for (const sheet of unnamed) {
    // a sheet we cannot tell by its name: the headers tell (or the person said which kind it is)
    const caseTab = table(sheet.rows, FLAT_COLUMNS)
    const kind = as === 'auto' ? guessKind(caseTab.fields, caseTab.rows) : as
    detected = kind
    if (kind === 'cases') cases = cases.concat(casesFrom(caseTab))
    else requirements = requirements.concat(table(sheet.rows, REQUIREMENT_COLUMNS).rows.map(toRequirement))
  }
  if (stepRows.length) groupSteps(stepRows, cases, warnings)
  if (!requirements.length && !cases.length)
    throw new InputError('No requirements or test cases found: the first row must hold the column names (for example Title, Priority, Expected result)')
  return { format, requirements, cases, warnings, detected: unnamed.length ? detected : 'book' }
}

// ---- what an import would do ---------------------------------------------------------------------------------------

/**
 * @param {{parsed: object, requirements: object[], cases: object[], strategy?: 'update'|'skip'}} args
 *   requirements / cases: the rows that exist in the project (code, seq, title and the fields)
 * @returns the plan: items with action create | update | unchanged | skip, the code each gets, links, warnings
 */
export function planImport({ parsed, requirements, cases, strategy = 'update' }) {
  const warnings = [...parsed.warnings]
  const kinds = [
    { name: 'requirements', prefix: PREFIX.requirement, existing: requirements, incoming: parsed.requirements, clean: cleanRequirement },
    { name: 'cases', prefix: PREFIX.testCase, existing: cases, incoming: parsed.cases, clean: cleanCase },
  ]
  const out = { requirements: [], cases: [] }
  const codeOf = { requirements: new Map(), cases: new Map() }
  for (const k of kinds) {
    const byCode = new Map(k.existing.map((r) => [r.code, r]))
    const byTitle = new Map(k.existing.map((r) => [normTitle(r.title), r]))
    let next = Math.max(0, ...k.existing.map((r) => r.seq ?? 0))
    const seen = new Set()
    k.incoming.forEach((raw, n) => {
      const where = `${k.name === 'cases' ? 'Test case' : 'Requirement'} ${n + 1}`
      const item = { line: n + 1, action: 'create', code: null, title: String(raw.title ?? '').slice(0, 300), changes: [], warnings: [] }
      let fields
      try {
        const sendable = { ...raw }
        if (k.name === 'cases') {
          sendable.steps = Array.isArray(raw.steps) ? raw.steps : []
          delete sendable.requirements
        }
        delete sendable.code
        fields = k.clean(sendable, { create: true, lenient: true, warnings: item.warnings })
      } catch (e) {
        item.action = 'skip'
        item.warnings.push(`${where}: ${e.message}`)
        out[k.name].push(item)
        return
      }
      const given = raw.code ? parseCode(raw.code, k.prefix) : null
      if (raw.code && !given) item.warnings.push(`"${String(raw.code).slice(0, 20)}" is not a ${k.prefix} code; a new one is assigned`)
      if (given && !byCode.has(given.code) && seen.has(given.code)) item.warnings.push(`${given.code} appears twice in the file; this one got a new ID`)
      let match = given ? byCode.get(given.code) : byTitle.get(normTitle(fields.title))
      if (match && seen.has(match.code)) {
        item.action = 'skip'
        item.warnings.push(`${where}: ${match.code} appears twice in the file; the second one was left out`)
        out[k.name].push(item)
        return
      }
      if (match) {
        seen.add(match.code)
        item.code = match.code
        item.ID = match.ID
        const changed = changedFields(match, fields)
        item.changes = changed
        item.action = strategy === 'skip' ? 'skip' : changed.length ? 'update' : 'unchanged'
        if (strategy === 'skip') item.warnings.push(`${match.code} exists already and was left as it is`)
      } else {
        let seq
        if (given && !byCode.has(given.code) && !seen.has(given.code)) {
          item.code = given.code
          seq = given.seq
          next = Math.max(next, seq)
        } else {
          seq = ++next
          item.code = formatCode(k.prefix, seq)
        }
        seen.add(item.code)
        item.seq = seq
      }
      item.fields = fields
      codeOf[k.name].set(String(raw.code ?? '').toLowerCase(), item.code)
      out[k.name].push(item)
    })
  }
  // links: a case names the requirements it verifies (by code)
  const known = new Set([...requirements.map((r) => r.code), ...out.requirements.filter((r) => r.action !== 'skip').map((r) => r.code)])
  parsed.cases.forEach((raw, n) => {
    const item = out.cases[n]
    if (!item || item.action === 'skip') return
    item.requirementCodes = []
    for (const ref of raw.requirements ?? []) {
      const c = parseCode(ref, PREFIX.requirement)?.code
      if (c && known.has(c)) item.requirementCodes.push(c)
      else item.warnings.push(`${item.code}: the requirement "${String(ref).slice(0, 30)}" does not exist and was not linked`)
    }
  })
  for (const k of ['requirements', 'cases']) for (const item of out[k]) warnings.push(...item.warnings.map((w) => (w.startsWith(item.code ?? '\u0000') ? w : `${item.code ?? `#${item.line}`}: ${w}`)))
  const count = (list, a) => list.filter((i) => i.action === a).length
  return {
    ...out,
    warnings,
    counts: Object.fromEntries(
      ['requirements', 'cases'].map((k) => [k, { create: count(out[k], 'create'), update: count(out[k], 'update'), unchanged: count(out[k], 'unchanged'), skip: count(out[k], 'skip') }]),
    ),
  }
}

// ---- downloads -----------------------------------------------------------------------------------------------------

const header = (columns) => Object.values(columns).map(([shown]) => shown)

/**
 * @param {{requirements: object[], cases: object[], links: {requirementCode: string, caseCode: string}[]}} data
 * @returns {{name: string, rows: string[][], widths?: number[]}[]}
 */
export function exportSheets({ requirements, cases, links = [], results = {} }) {
  const reqCodesOf = new Map()
  for (const l of links) {
    if (!reqCodesOf.has(l.caseCode)) reqCodesOf.set(l.caseCode, [])
    reqCodesOf.get(l.caseCode).push(l.requirementCode)
  }
  const reqRows = [header(REQUIREMENT_COLUMNS)].concat(
    requirements.map((r) => Object.keys(REQUIREMENT_COLUMNS).map((f) => r[f] ?? '')),
  )
  const caseRows = [header(CASE_COLUMNS)].concat(
    cases.map((c) => Object.keys(CASE_COLUMNS).map((f) => (f === 'requirements' ? (reqCodesOf.get(c.code) ?? []).join(', ') : (c[f] ?? '')))),
  )
  const stepRows = [header(STEP_COLUMNS)]
  for (const c of cases)
    for (const s of parseSteps(c.steps)) stepRows.push([c.code, s.action, s.data, s.expected])
  const caseByCode = new Map(cases.map((c) => [c.code, c]))
  const reqByCode = new Map(requirements.map((r) => [r.code, r]))
  const trace = [['Requirement', 'Requirement title', 'Test case', 'Test case title', 'Last result']]
  const covered = new Set()
  for (const l of links) {
    covered.add(l.requirementCode)
    const r = reqByCode.get(l.requirementCode)
    const c = caseByCode.get(l.caseCode)
    if (r && c) trace.push([r.code, r.title, c.code, c.title, results[c.code] ?? c.lastResult ?? ''])
  }
  for (const r of requirements) if (!covered.has(r.code)) trace.push([r.code, r.title, '(no test case)', '', ''])
  return [
    { name: 'Requirements', rows: reqRows, widths: [10, 40, 50, 50, 11, 14, 13, 20, 20, 16] },
    { name: 'Test cases', rows: caseRows, widths: [10, 44, 40, 36, 11, 14, 11, 20, 16, 12, 24] },
    { name: 'Steps', rows: stepRows, widths: [11, 50, 28, 50] },
    { name: 'Traceability', rows: trace, widths: [13, 40, 12, 44, 12] },
  ]
}

export const exportXlsx = (data) => writeXlsx(exportSheets(data))

export function exportJson({ projectName, requirements, cases, links }) {
  const reqCodesOf = new Map()
  for (const l of links) {
    if (!reqCodesOf.has(l.caseCode)) reqCodesOf.set(l.caseCode, [])
    reqCodesOf.get(l.caseCode).push(l.requirementCode)
  }
  const pick = (row, fields) => Object.fromEntries(fields.map((f) => [f, row[f] ?? '']))
  return JSON.stringify(
    {
      format: 'quicktest-book',
      version: 1,
      project: projectName,
      exportedAt: new Date().toISOString(),
      requirements: requirements.map((r) => ({ ...pick(r, Object.keys(REQUIREMENT_COLUMNS)), tags: tagList(r.tags) })),
      cases: cases.map((c) => ({
        ...pick(c, Object.keys(CASE_COLUMNS).filter((f) => f !== 'requirements')),
        tags: tagList(c.tags),
        steps: parseSteps(c.steps).map(({ action, data, expected }) => ({ action, data, expected })),
        requirements: reqCodesOf.get(c.code) ?? [],
      })),
    },
    null,
    2,
  )
}

/** The cases as one flat table (one row per step) - what most spreadsheet based test plans look like. */
export function exportFlatRows({ cases, links }) {
  const reqCodesOf = new Map()
  for (const l of links) {
    if (!reqCodesOf.has(l.caseCode)) reqCodesOf.set(l.caseCode, [])
    reqCodesOf.get(l.caseCode).push(l.requirementCode)
  }
  const rows = [[...header(CASE_COLUMNS), 'Step no', 'Action', 'Test data', 'Expected result']]
  for (const c of cases) {
    const head = Object.keys(CASE_COLUMNS).map((f) => (f === 'requirements' ? (reqCodesOf.get(c.code) ?? []).join(', ') : (c[f] ?? '')))
    const steps = parseSteps(c.steps)
    if (!steps.length) rows.push([...head, '', '', '', ''])
    steps.forEach((s, i) => rows.push([...(i === 0 ? head : head.map((_, k) => (k < 2 ? head[k] : ''))), i + 1, s.action, s.data, s.expected]))
  }
  return rows
}

/** An empty workbook with the right columns, two examples and a sheet that explains the columns and the allowed values. */
export function templateXlsx() {
  const lists = (rows) => rows.map((r) => r.id).join(', ')
  return writeXlsx([
    {
      name: 'Requirements',
      rows: [
        header(REQUIREMENT_COLUMNS),
        ['REQ-001', 'A buyer can create an order', 'The buyer creates an order from the order list.', 'The Create button opens the order form\nSaving shows a confirmation message\nThe new order is in the list', 'high', 'functional', 'approved', 'orders,core', 'JIRA-123', ''],
      ],
      widths: [10, 40, 50, 50, 11, 14, 13, 20, 20, 16],
    },
    {
      name: 'Test cases',
      rows: [
        header(CASE_COLUMNS),
        ['TC-001', 'Create an order with valid data', 'Checks the happy path of order creation', 'The buyer is logged in', 'high', 'functional', 'ready', 'smoke', '', 'candidate', 'REQ-001'],
      ],
      widths: [10, 44, 40, 36, 11, 14, 11, 20, 16, 12, 24],
    },
    {
      name: 'Steps',
      rows: [
        header(STEP_COLUMNS),
        ['TC-001', 'Open the order list', '', 'The list of orders is shown'],
        ['TC-001', 'Press "Create"', '', 'The order form opens'],
        ['TC-001', 'Enter the customer', 'ACME Corp', 'The customer is accepted'],
        ['TC-001', 'Press "Save"', '', 'A message "Order created" is shown'],
      ],
      widths: [11, 50, 28, 50],
    },
    {
      name: 'Help',
      rows: [
        ['Column', 'Meaning'],
        ['ID', 'Optional. REQ-001 / TC-001. Empty: a new one is assigned. An ID that exists updates that item.'],
        ['Priority', lists(PRIORITIES)],
        ['Requirement type', lists(REQUIREMENT_KINDS)],
        ['Requirement status', lists(REQUIREMENT_STATUSES)],
        ['Test case type', lists(CASE_KINDS)],
        ['Test case status', lists(CASE_STATUSES)],
        ['Automation', lists(AUTOMATION)],
        ['Requirements', 'On a test case: the requirement IDs it verifies, separated by commas.'],
        ['Steps', 'One row per step on the Steps sheet; "Test case" is the ID (or the title) of the case. A one-sheet file with one row per step works too.'],
        ['Acceptance criteria', 'One criterion per line inside the cell.'],
      ],
      widths: [24, 110],
    },
  ])
}
