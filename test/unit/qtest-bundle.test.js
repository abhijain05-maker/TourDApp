import { describe, it, expect } from 'vitest'
import { parseCsv, toCsv } from '../../srv/lib/qtest/csv.js'
import { readXlsx, writeXlsx, columnName, columnIndex } from '../../srv/lib/qtest/xlsx.js'
import {
  exportFlatRows,
  exportJson,
  exportXlsx,
  parseBook,
  planImport,
  templateXlsx,
} from '../../srv/lib/qtest/bundle.js'
import { cleanCase, cleanRequirement, cleanTags } from '../../srv/lib/qtest/validate.js'
import { findCodes, formatCode, parseCode } from '../../srv/lib/qtest/codes.js'
import { resolve, PRIORITIES } from '../../srv/lib/qtest/meta.js'

const REQS = [
  { ID: 'r1', code: 'REQ-001', seq: 1, title: 'Create an order', description: 'Line one\nLine two', acceptance: 'A\nB', priority: 'high', kind: 'functional', status: 'approved', tags: 'orders,core', source: 'J-1', owner: 'kim' },
  { ID: 'r2', code: 'REQ-002', seq: 2, title: 'Delete an order', priority: 'low', kind: 'functional', status: 'draft' },
]
const CASES = [
  {
    ID: 'c1', code: 'TC-001', seq: 1, title: 'Create with valid data, "quoted"', objective: 'happy', preconditions: 'logged in', priority: 'high', kind: 'smoke', status: 'ready', tags: 'smoke', automation: 'manual',
    steps: JSON.stringify([{ id: 'st1', action: 'Open the list', data: '', expected: 'List shown' }, { id: 'st2', action: 'Press "Create"', data: 'ACME; Inc', expected: 'Form opens\nwith two lines' }]),
  },
]
const LINKS = [{ requirementCode: 'REQ-001', caseCode: 'TC-001' }]

describe('csv', () => {
  it('reads quotes, line breaks, semicolons and a BOM', () => {
    expect(parseCsv('﻿a;b\n"x;1";"two\nlines"\n')).toEqual([['a', 'b'], ['x;1', 'two\nlines']])
    expect(parseCsv('a,b\r\n"say ""hi""",2\r\n\r\n')).toEqual([['a', 'b'], ['say "hi"', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('writes what it reads', () => {
    const rows = [['a', 'b,c'], ['x"y', 'two\nlines']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})

describe('xlsx', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
    expect(['A', 'Z', 'AA', 'AB1', 'ZZ12'].map(columnIndex)).toEqual([0, 25, 26, 27, 701])
  })
  it('round-trips text, line breaks, markup characters and leading zeros', () => {
    const sheets = [
      { name: 'One', rows: [['a', 'b'], ['007', 'x < y & "z"\nnext'], ['', 'only second']] },
      { name: 'Two/Bad:Name', rows: [['h'], ['v']] },
    ]
    const back = readXlsx(writeXlsx(sheets))
    expect(back.map((s) => s.name)).toEqual(['One', 'Two Bad Name'])
    expect(back[0].rows).toEqual([['a', 'b'], ['007', 'x < y & "z"\nnext'], ['', 'only second']])
  })
  it('refuses a file that is not a workbook', () => {
    expect(() => readXlsx(Buffer.from('hello'))).toThrow(/not a valid/)
  })
})

describe('codes and vocabulary', () => {
  it('formats and reads codes', () => {
    expect(formatCode('TC', 7)).toBe('TC-007')
    expect(parseCode('tc 7', 'TC')).toEqual({ code: 'TC-007', seq: 7 })
    expect(parseCode('REQ-1', 'TC')).toBeNull()
    expect(findCodes('[tc-12] and TC_3 but not ATC-5', 'TC')).toEqual(['TC-012', 'TC-003'])
  })
  it('knows other tools words', () => {
    expect(resolve(PRIORITIES, 'Blocker')).toBe('critical')
    expect(resolve(PRIORITIES, 'P2')).toBe('high')
    expect(resolve(PRIORITIES, 'whatever')).toBeNull()
  })
})

describe('validation', () => {
  it('refuses unknown values on save but coerces them on upload', () => {
    expect(() => cleanRequirement({ title: 'x', priority: 'huge' }, { create: true })).toThrow(/priority/)
    const warnings = []
    expect(cleanRequirement({ title: 'x', priority: 'huge', status: 'Done' }, { create: true, lenient: true, warnings })).toMatchObject({ priority: 'medium', status: 'implemented' })
    expect(warnings).toHaveLength(1)
  })
  it('needs a title on create, not on update', () => {
    expect(() => cleanCase({}, { create: true })).toThrow(/title/)
    expect(cleanCase({ status: 'ready' })).toEqual({ status: 'ready' })
  })
  it('cleans tags and steps', () => {
    expect(cleanTags(' smoke, Login ,smoke;;')).toBe('smoke,Login')
    const c = cleanCase({ title: 't', steps: [{ action: ' a ' }, { id: 'st1', action: 'b' }, { id: 'st1', expected: 'c' }] }, { create: true })
    expect(c.stepList.map((s) => s.id)).toEqual(['st1', 'st2', 'st3'])
    expect(c.stepList[0].action).toBe('a')
    expect(() => cleanCase({ title: 't', steps: 'x' })).toThrow(/list/)
  })
})

describe('the book: download and upload', () => {
  const data = { requirements: REQS, cases: CASES, links: LINKS }

  it('round-trips through xlsx', () => {
    const parsed = parseBook({ filename: 'book.xlsx', content: Buffer.from(exportXlsx(data)) })
    expect(parsed.requirements).toHaveLength(2)
    expect(parsed.requirements[0]).toMatchObject({ code: 'REQ-001', title: 'Create an order', acceptance: 'A\nB', priority: 'high' })
    expect(parsed.cases[0]).toMatchObject({ code: 'TC-001', requirements: ['REQ-001'] })
    expect(parsed.cases[0].steps).toEqual([
      { action: 'Open the list', data: '', expected: 'List shown' },
      { action: 'Press "Create"', data: 'ACME; Inc', expected: 'Form opens\nwith two lines' },
    ])
  })

  it('round-trips through json', () => {
    const parsed = parseBook({ filename: 'b.json', content: exportJson({ projectName: 'P', ...data }) })
    expect(parsed.requirements[0].title).toBe('Create an order')
    expect(parsed.cases[0].steps).toHaveLength(2)
    expect(parsed.cases[0].requirements).toEqual(['REQ-001'])
  })

  it('reads the flat csv it writes (one row per step)', () => {
    const csv = toCsv(exportFlatRows({ cases: CASES, links: LINKS }))
    const parsed = parseBook({ filename: 'flat.csv', content: csv })
    expect(parsed.requirements).toHaveLength(0)
    expect(parsed.cases).toHaveLength(1)
    expect(parsed.cases[0].steps).toHaveLength(2)
    expect(parsed.cases[0].steps[1].data).toBe('ACME; Inc')
  })

  it('reads another tool: its own header names, steps below a case without an id', () => {
    const csv = [
      'Test Case Name,Summary,Step,Expected Result,Priority',
      'Login works,User can log in,Open the app,The login page shows,P1',
      ',,Enter user and password,The fields are filled,',
      ',,Press Log in,The home page opens,',
      'Logout works,,Press Log out,The login page shows,Minor',
    ].join('\n')
    const parsed = parseBook({ filename: 'x.csv', content: csv })
    expect(parsed.cases.map((c) => c.title)).toEqual(['Login works', 'Logout works'])
    expect(parsed.cases[0].steps).toHaveLength(3)
    expect(parsed.cases[0].priority).toBe('P1')
    const plan = planImport({ parsed, requirements: [], cases: [] })
    expect(plan.cases[0].fields.priority).toBe('critical')
    expect(plan.cases[1].fields.priority).toBe('low')
  })

  it('says what is wrong with a file', () => {
    expect(() => parseBook({ filename: 'x.csv', content: 'hello\nworld' })).toThrow(/No requirements or test cases/)
    expect(() => parseBook({ filename: 'x.json', content: '{nope' })).toThrow(/JSON/)
  })

  it('reads the template it offers', () => {
    const parsed = parseBook({ filename: 't.xlsx', content: Buffer.from(templateXlsx()) })
    expect(parsed.requirements).toHaveLength(1)
    expect(parsed.cases[0].steps).toHaveLength(4)
    expect(parsed.cases[0].requirements).toEqual(['REQ-001'])
  })
})

describe('planning an import', () => {
  const parsed = () =>
    parseBook({
      filename: 'b.json',
      content: JSON.stringify({
        requirements: [
          { code: 'REQ-001', title: 'Create an order', priority: 'critical' }, // changes an existing one
          { code: 'REQ-002', title: 'Delete an order', priority: 'low', kind: 'functional', status: 'draft' }, // same as stored
          { title: 'Brand new' },
          { code: 'REQ-010', title: 'Keeps its number' },
          { code: 'REQ-010', title: 'Same number again' },
        ],
        cases: [{ title: 'A case', requirements: ['REQ-001', 'REQ-099', 'Brand new'], steps: [{ action: 'x' }] }],
      }),
    })

  it('creates, updates, leaves alone and explains', () => {
    const plan = planImport({ parsed: parsed(), requirements: REQS, cases: CASES })
    expect(plan.requirements.map((r) => [r.code, r.action])).toEqual([
      ['REQ-001', 'update'],
      ['REQ-002', 'unchanged'],
      ['REQ-003', 'create'],
      ['REQ-010', 'create'],
      ['REQ-011', 'create'],
    ])
    expect(plan.requirements[0].changes).toContain('priority')
    expect(plan.cases[0]).toMatchObject({ code: 'TC-002', action: 'create', requirementCodes: ['REQ-001'] })
    expect(plan.warnings.some((w) => /REQ-099/.test(w))).toBe(true)
    expect(plan.counts.requirements).toEqual({ create: 3, update: 1, unchanged: 1, skip: 0 })
  })

  it('can leave existing items as they are', () => {
    const plan = planImport({ parsed: parsed(), requirements: REQS, cases: CASES, strategy: 'skip' })
    expect(plan.requirements[0].action).toBe('skip')
    expect(plan.requirements[2].action).toBe('create')
  })

  it('finds an existing item by title when the file has no id', () => {
    const p = parseBook({ filename: 'b.json', content: JSON.stringify({ requirements: [{ title: 'create an ORDER', priority: 'low' }] }) })
    const plan = planImport({ parsed: p, requirements: REQS, cases: [] })
    expect(plan.requirements[0]).toMatchObject({ code: 'REQ-001', action: 'update' })
  })
})
