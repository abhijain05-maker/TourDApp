// Shapes returned by the TourService (see srv/tour-service.cds).

export interface Project {
  ID: string
  name: string
  description: string | null
  ui5Version: string
  appId: string | null
  parseStatus: 'empty' | 'ok' | 'warnings'
  createdAt: string
  modifiedAt: string
}

export type FileStatus = 'unchanged' | 'added' | 'modified' | 'deleted'

/** A file of the project (the workspace); the content is read separately. */
export interface SourceRow {
  ID: string
  project_ID: string
  path: string
  kind: 'view' | 'fragment' | 'controller' | 'manifest' | 'i18n' | 'other'
  status?: FileStatus
  size?: number
  binary?: boolean
  edited?: boolean
  hash?: string | null
}

export interface FileInfo {
  ID: string
  path: string
  kind: SourceRow['kind']
  status: FileStatus | 'removed'
  size: number
  binary: boolean
  edited: boolean
  hash: string | null
}

export interface FileDetail extends Omit<FileInfo, 'size' | 'edited'> {
  content: string
  /** the uploaded copy; null for a file that was added here */
  base: string | null
}

export interface ApplyNote {
  code: string
  message: string
}
export interface ApplyEdit {
  path: string
  action: 'add' | 'modify'
  what: string
  before: string | null
  after: string
}
export interface ApplyPlan {
  ok: boolean
  blocking: ApplyNote[]
  notes: ApplyNote[]
  edits: ApplyEdit[]
  /** JSON: what a project that has wdi5 already offers (tests only) */
  existing?: string | null
}

export interface RecordingRow {
  ID: string
  project_ID: string
  name: string
  format: 'tourd-recorder' | 'devtools-recorder' | 'ui5-test-recorder' | 'plain-text'
  summary: string | null // JSON: { steps, skipped, actionable, mapped, unmapped }
  createdAt: string
}

export interface RecordingSummary {
  steps: number
  skipped: number
  actionable: number
  mapped: number
  unmapped: number
}

export interface TourRow {
  ID: string
  project_ID: string
  recording_ID: string | null
  name: string
  definition: string
  version: number
  generator: string | null
  model: string | null
  createdAt: string
  modifiedAt: string
}

export interface TourVersionRow {
  ID: string
  tour_ID: string
  version: number
  note: string | null
  createdAt: string
}

export interface Job {
  ID: string
  project_ID: string
  recording_ID: string | null
  tour_ID: string | null
  provider: string
  model: string | null
  status: 'queued' | 'running' | 'done' | 'failed'
  stage: string | null
  error: string | null
  report: string | null // JSON
}

export interface ProviderInfo {
  id: string
  label: string
  configured: boolean
  model: string | null
  /** comments and secret-looking values are removed from source files before they are sent */
  redaction: boolean
}

export interface Warning {
  code: string
  message: string
}

export interface SkippedFile {
  path: string
  reason: string
  /** true: left out on purpose (secrets, build output); false: the project is incomplete without it */
  expected: boolean
}

export interface ImportResult {
  imported: number
  ignored: string[]
  skipped?: SkippedFile[]
  complete?: boolean
  appId: string | null
  views: number
  controls: number
  warnings: Warning[]
}

export interface RecordingResult {
  ID: string
  format: string
  steps: number
  actionable: number
  mapped: number
  unmapped: number
  skipped: number
}

export interface LintIssue {
  path: string
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  stepId: string | null
}

export interface LintResult {
  errors: number
  warnings: number
  infos: number
  issues: LintIssue[]
}

export interface InventoryControl {
  viewName: string | null
  localId: string | null
  type: string
  display: string | null
  hasStableId: boolean
  template: boolean
  scope: 'view' | 'fragment'
}

export interface Inventory {
  appId: string | null
  routes: { name: string; pattern: string; params: string[]; viewNames: string[] }[]
  views: { viewName: string; path: string }[]
  controls: InventoryControl[]
  warnings: Warning[]
}

// The tour document (shared/tour-schema.mjs)
export interface TourStep {
  id: string
  title: string
  text: string
  target?: { viewName?: string; controlId?: string; fallbacks: { by: string; value: string }[] }
  placement: string
  before: { type: 'navigate'; hash: string }[]
  meta?: { source?: string; confidence?: number; unresolved: boolean; note?: string }
}

export interface TourDocument {
  schemaVersion: 1
  id: string
  title: string
  options: { showProgress: boolean; allowSkip: boolean; overlay: boolean; waitTimeoutMs: number }
  steps: TourStep[]
}

/** What the sandbox copy of a project's app contains (GET /preview/:projectId/info.json). */
export interface PreviewInfo {
  appId: string
  controllers: 'stub' | 'real'
  stubbedControllers: number
  rootView: string | null
  views: { viewName: string; path: string }[]
  routes: { name: string; pattern: string; params: string[] }[]
  mockModels: string[]
  warnings: string[]
  notes: string[]
}

/** What the sandbox reports when the user clicks a control in pick mode. */
export interface PickResult {
  viewName: string | null
  controlId: string | null
  controlType: string
  text: string
  clicked: string
  viaParent: boolean
}

/** GET /export/:tourId/check.json: is the tour fit to ship, and what would the zip contain. */
export interface ExportCheck {
  ok: boolean
  blocking: { code: string; message: string; stepId?: string }[]
  warnings: { code: string; message: string; stepId?: string }[]
  checkedTargets: boolean
  filename: string
  title: string
  version: number
  files: string[]
}

/** A paired browser extension (the token itself is shown once, when it is created). */
export interface ExtensionTokenRow {
  ID: string
  name: string
  prefix: string | null
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
}

export interface TestPlanRow {
  ID: string
  project_ID: string
  recording_ID: string | null
  name: string
  definition: string
  version: number
  generator: string | null
  createdAt: string
  modifiedAt: string
}

export interface HelpTopic {
  id: string
  title: string
  summary: string
  text: string
  note: string
  links: { label: string; url: string }[]
  target: { viewName?: string; controlId?: string; fallbacks: { by: string; value: string }[] }
  meta?: { source?: string; controlType?: string; screen?: string; hash?: string }
}

export interface HelpDocument {
  schemaVersion: 1
  id: string
  title: string
  options: { panelTitle: string; showBadges: boolean; buttonPosition: 'top' | 'bottom' }
  topics: HelpTopic[]
}

export interface HelpSetRow {
  ID: string
  project_ID: string
  name: string
  definition: string
  version: number
  generator: string | null
  createdAt: string
  modifiedAt: string
}

export interface DryRun {
  locators: Record<string, { strategy: string; status: 'found' | 'missing' | 'ambiguous' | 'unchecked'; count: number; note: string }>
  steps: Record<string, 'found' | 'missing' | 'ambiguous' | 'unchecked'>
  summary: Record<'found' | 'missing' | 'ambiguous' | 'unchecked', number>
}
