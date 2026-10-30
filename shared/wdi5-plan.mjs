// The wdi5 test plan: the recording turned into steps (what to do, where, what to check) and the settings of the
// generated project. Plain data on purpose: the designer edits it as a table, the server renders it into files.
// Strict like the tour schema - anything unknown is an error, because the plan drives generated code.
import { z } from 'zod'

export const PLAN_VERSION = 1

export const FRAMEWORKS = ['mocha', 'jasmine']
export const AUTH_MODES = ['none', 'basic', 'btp', 'custom']
export const STRATEGIES = ['id', 'ui5', 'i18n', 'text', 'label', 'binding']
export const STEP_KINDS = ['open', 'press', 'enterText', 'search', 'select', 'assert']
export const ASSERT_TYPES = ['url', 'value', 'selectedKey', 'visible', 'text']

/**
 * Versions the generated package.json asks for. wdio-ui5-service 3 has WebdriverIO 9 as a peer: the latest
 * WebdriverIO (10) must not be installed next to it.
 */
export const WDI5_PACKAGES = {
  mocha: {
    '@wdio/cli': '^9',
    '@wdio/globals': '^9',
    '@wdio/local-runner': '^9',
    '@wdio/mocha-framework': '^9',
    '@wdio/spec-reporter': '^9',
    webdriverio: '^9',
    'wdio-ui5-service': '^3',
  },
  jasmine: {
    '@wdio/cli': '^9',
    '@wdio/globals': '^9',
    '@wdio/local-runner': '^9',
    '@wdio/jasmine-framework': '^9',
    '@wdio/spec-reporter': '^9',
    webdriverio: '^9',
    'wdio-ui5-service': '^3',
  },
}

const url = z.string().max(500)
const css = z.string().min(1).max(200)

export const settingsSchema = z.strictObject({
  baseUrl: url.describe('Address of the running app (where UI5 is bootstrapped)'),
  framework: z.enum(FRAMEWORKS),
  auth: z.enum(AUTH_MODES),
  authSelectors: z
    .strictObject({ username: css, password: css, submit: css })
    .optional()
    .describe('Only for auth "custom": CSS selectors of the login form'),
  testDir: z.string().max(200).describe('Folder of the tests, relative to the project root'),
  root: z
    .string()
    .max(200)
    .describe('Folder that holds the tests and wdio.conf.js; empty = next to the app folder'),
})

export const DEFAULT_SETTINGS = {
  baseUrl: 'http://localhost:8080/index.html',
  framework: 'mocha',
  auth: 'none',
  testDir: 'test/e2e',
  root: '',
}

const selectorSchema = z
  .record(z.string(), z.unknown())
  .describe('The inner object of a wdi5 selector: { id, viewName, controlType, properties, ... }')

export const locatorSchema = z.strictObject({
  name: z.string().min(1).max(80).describe('Name in the generated code, e.g. createBtn'),
  strategy: z.enum(STRATEGIES),
  selector: selectorSchema,
  alternatives: z
    .array(z.strictObject({ strategy: z.enum(STRATEGIES), selector: selectorSchema }))
    .default([]),
  controlType: z.string().nullable().default(null),
  viewName: z.string().nullable().default(null),
  display: z.string().max(200).nullable().default(null),
  note: z.string().max(300).optional(),
})

export const assertionSchema = z.strictObject({
  type: z.enum(ASSERT_TYPES),
  expected: z.string().max(500).optional(),
})

export const stepSchema = z.strictObject({
  id: z.string().min(1).max(40),
  kind: z.enum(STEP_KINDS),
  title: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  locator: z.string().nullable().default(null).describe('Key into plan.locators'),
  value: z.string().max(500).optional().describe('Text to type'),
  choice: z.string().max(200).optional().describe('Item to choose in a select'),
  submit: z.boolean().optional().describe('Press Enter after typing'),
  assertion: assertionSchema.optional(),
  hash: z.string().max(300).optional().describe('For "open": the hash of the page to start on'),
  from: z
    .strictObject({
      index: z.number().int().nullable().default(null),
      via: z.string().nullable().default(null),
      confidence: z.number().nullable().default(null),
    })
    .optional()
    .describe('Where in the recording the step comes from'),
  heuristic: z.boolean().optional().describe('An assertion TourD added by itself'),
  noReuse: z.boolean().optional().describe('Do not call a helper of the project for this step'),
  edited: z.boolean().optional().describe('Changed by hand in the step table'),
  note: z.string().max(300).optional(),
})

export const planSchema = z.strictObject({
  version: z.literal(PLAN_VERSION),
  name: z.string().min(1).max(200),
  app: z.strictObject({
    id: z.string().nullable().default(null),
    url: z.string().nullable().default(null),
  }),
  settings: settingsSchema,
  locators: z.record(z.string(), locatorSchema),
  steps: z.array(stepSchema).max(500),
})

/** @returns {{ok: true, plan: object} | {ok: false, issues: {path: string, message: string}[]}} */
export function validatePlan(input) {
  const r = planSchema.safeParse(input)
  if (r.success) {
    const issues = []
    for (const s of r.data.steps)
      if (s.locator && !r.data.locators[s.locator])
        issues.push({ path: `steps.${s.id}.locator`, message: `Unknown locator "${s.locator}"` })
    if (issues.length) return { ok: false, issues }
    return { ok: true, plan: r.data }
  }
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}
