// Types for wdi5-plan.mjs (plain JavaScript shared by the server, the designer and the tests).
export const PLAN_VERSION: 1
export const FRAMEWORKS: string[]
export const AUTH_MODES: string[]
export const STRATEGIES: string[]
export const STEP_KINDS: string[]
export const ASSERT_TYPES: string[]
export const WDI5_PACKAGES: Record<'mocha' | 'jasmine', Record<string, string>>

export interface Wdi5Settings {
  baseUrl: string
  framework: 'mocha' | 'jasmine'
  auth: 'none' | 'basic' | 'btp' | 'custom'
  authSelectors?: { username: string; password: string; submit: string }
  testDir: string
  root: string
}
export const DEFAULT_SETTINGS: Wdi5Settings

export type Strategy = 'id' | 'ui5' | 'i18n' | 'text' | 'label' | 'binding'
export interface Wdi5Locator {
  name: string
  strategy: Strategy
  selector: Record<string, unknown>
  alternatives: { strategy: Strategy; selector: Record<string, unknown> }[]
  controlType: string | null
  viewName: string | null
  display: string | null
  note?: string
}
export interface Wdi5Step {
  id: string
  kind: 'open' | 'press' | 'enterText' | 'search' | 'select' | 'assert'
  title: string
  enabled: boolean
  locator: string | null
  value?: string
  choice?: string
  submit?: boolean
  assertion?: { type: 'url' | 'value' | 'selectedKey' | 'visible' | 'text' | 'toast'; expected?: string }
  hash?: string
  from?: { index: number | null; via: string | null; confidence: number | null }
  heuristic?: boolean
  noReuse?: boolean
  edited?: boolean
  note?: string
}
export interface Wdi5Plan {
  version: 1
  name: string
  app: { id: string | null; url: string | null }
  settings: Wdi5Settings
  locators: Record<string, Wdi5Locator>
  steps: Wdi5Step[]
}
export function validatePlan(
  input: unknown,
): { ok: true; plan: Wdi5Plan } | { ok: false; issues: { path: string; message: string }[] }
