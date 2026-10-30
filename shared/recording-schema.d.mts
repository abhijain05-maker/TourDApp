// Types for recording-schema.mjs (plain JavaScript shared by the server, the designer, the extension and the tests).
export const RECORDING_FORMAT: 'tourd-recording'
export const RECORDING_VERSION: 1
export const STEP_TYPES: string[]
export const CHECK_KINDS: string[]

export interface RecordedControl {
  id: string
  localId: string | null
  viewName: string | null
  controllerName: string | null
  controlType: string
  stableId: boolean
  text?: string
  label?: string
  tooltip?: string
  placeholder?: string
  i18n?: { property: string; model: string; key: string }
  bindingPath?: string
  inList?: boolean
  inDialog?: boolean
  clicked?: string
}

export interface RecordedStep {
  index: number
  t: number
  type: 'press' | 'input' | 'select' | 'search' | 'toggle' | 'navigate' | 'note'
  control?: RecordedControl
  value?: string | boolean
  valueText?: string
  redacted?: boolean
  event?: string
  hash?: string
  url?: string
  causedBy?: number
  note?: string
}

export interface TourdRecording {
  format: 'tourd-recording'
  version: 1
  recordedAt: string
  recorder: string
  app: {
    url: string
    startHash: string
    title: string
    ui5Version: string | null
    appId: string | null
    locale: string | null
  }
  steps: RecordedStep[]
}

export function looksLikeRecording(input: unknown): boolean
export function validateRecording(input: unknown): {
  ok: boolean
  recording: TourdRecording | null
  issues: { path: string; code: string; severity: 'error'; message: string }[]
}
export function toRecordingJsonSchema(): object
