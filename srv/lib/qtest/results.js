// Results of automated runs, read from what test runners write, matched to test cases by the code in the test's name
// (the wdi5 tests QuickTest generates are named "TC-012 Create an order", so mocha / wdio put the code in every title).
// Understood: JUnit XML (also from wdio-junit-reporter), mocha's json reporter, mochawesome, wdio-json-reporter.
import { XMLParser } from 'fast-xml-parser'
import { findCodes, PREFIX } from './codes.js'
import { InputError } from '../service/sources.js'
import { resolve, RESULTS } from './meta.js'

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  isArray: (name) => ['testsuite', 'testcase'].includes(name),
})

const text = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(v['#text'] ?? v['@_message'] ?? '') : '')

function fromJUnit(content) {
  const doc = xml.parse(content)
  const out = []
  const walk = (suite) => {
    for (const s of suite.testsuite ?? []) walk(s)
    for (const t of suite.testcase ?? []) {
      let status = 'passed'
      let message = ''
      if (t.failure !== undefined) (status = 'failed'), (message = text(t.failure) || text(t.failure?.['@_message']))
      else if (t.error !== undefined) (status = 'failed'), (message = text(t.error))
      else if (t.skipped !== undefined) status = 'skipped'
      out.push({
        name: `${t['@_classname'] ? t['@_classname'] + ' ' : ''}${t['@_name'] ?? ''}`.trim(),
        status,
        durationMs: Math.round(Number(t['@_time'] ?? 0) * 1000),
        message: message.slice(0, 2000),
      })
    }
  }
  walk(doc.testsuites ?? doc)
  return out
}

function fromMocha(doc) {
  const out = []
  const add = (list, status) =>
    list.forEach((t) =>
      out.push({
        name: t.fullTitle ?? t.title ?? '',
        status: status ?? 'passed',
        durationMs: Number(t.duration ?? 0),
        message: String(t.err?.message ?? '').slice(0, 2000),
      }),
    )
  // `tests` holds all of them; the status is told by which of the other lists a test is in
  const failed = new Set((doc.failures ?? []).map((t) => t.fullTitle))
  const pending = new Set((doc.pending ?? []).map((t) => t.fullTitle))
  for (const t of doc.tests ?? [])
    add([t], failed.has(t.fullTitle) ? 'failed' : pending.has(t.fullTitle) ? 'skipped' : 'passed')
  return out
}

function fromMochawesome(doc) {
  const out = []
  const walk = (suite) => {
    for (const t of suite.tests ?? [])
      out.push({
        name: t.fullTitle ?? t.title ?? '',
        status: t.state === 'failed' || t.fail ? 'failed' : t.pending || t.state === 'skipped' ? 'skipped' : 'passed',
        durationMs: Number(t.duration ?? 0),
        message: String(t.err?.message ?? '').slice(0, 2000),
      })
    for (const s of suite.suites ?? []) walk(s)
  }
  for (const r of doc.results ?? []) walk(r)
  return out
}

function fromWdio(doc) {
  const out = []
  for (const s of doc.suites ?? [])
    for (const t of s.tests ?? [])
      out.push({
        name: `${s.name ?? ''} ${t.name ?? ''}`.trim(),
        status: t.state === 'failed' ? 'failed' : t.state === 'skipped' || t.state === 'pending' ? 'skipped' : 'passed',
        durationMs: Number(t.duration ?? 0),
        message: String(t.error?.message ?? t.error ?? '').slice(0, 2000),
      })
  return out
}

/**
 * @param {string} content
 * @returns {{format: string, tests: {name: string, status: string, durationMs: number, message: string, codes: string[]}[]}}
 */
export function parseResults(content) {
  const raw = String(content ?? '').replace(/^﻿/, '').trim()
  if (!raw) throw new InputError('The file is empty')
  let format
  let tests
  if (raw.startsWith('<')) {
    try {
      tests = fromJUnit(raw)
    } catch {
      throw new InputError('The file is not valid XML')
    }
    format = 'junit'
  } else {
    let doc
    try {
      doc = JSON.parse(raw)
    } catch {
      throw new InputError('The file is neither JUnit XML nor JSON')
    }
    if (Array.isArray(doc.results) && doc.results.some((r) => r.suites || r.tests)) (format = 'mochawesome'), (tests = fromMochawesome(doc))
    else if (Array.isArray(doc.tests) && (doc.stats || doc.passes || doc.failures)) (format = 'mocha'), (tests = fromMocha(doc))
    else if (Array.isArray(doc.suites)) (format = 'wdio'), (tests = fromWdio(doc))
    else throw new InputError('This JSON is not a result file QuickTest knows (mocha json, mochawesome, wdio json) - or use JUnit XML')
  }
  return { format, tests: tests.map((t) => ({ ...t, codes: findCodes(t.name, PREFIX.testCase) })) }
}

const WORST = ['failed', 'blocked', 'skipped', 'passed']

/**
 * Matches tests to test cases and gives one result per case (the worst of its tests).
 * @param {ReturnType<typeof parseResults>['tests']} tests
 * @param {Map<string, object>} casesByCode
 */
export function matchResults(tests, casesByCode) {
  const byCase = new Map()
  const unmatched = []
  for (const t of tests) {
    const code = t.codes.find((c) => casesByCode.has(c))
    if (!code) {
      unmatched.push({ name: t.name.slice(0, 200), status: t.status })
      continue
    }
    const entry = byCase.get(code) ?? { code, status: 'passed', durationMs: 0, messages: [], tests: 0 }
    entry.tests++
    entry.durationMs += t.durationMs
    if (WORST.indexOf(t.status) < WORST.indexOf(entry.status)) entry.status = t.status
    if (t.message) entry.messages.push(`${t.name}: ${t.message}`.slice(0, 600))
    byCase.set(code, entry)
  }
  return { matched: [...byCase.values()], unmatched }
}

export const isResult = (v) => !!resolve(RESULTS, v)
