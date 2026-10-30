// Types for tour-schema.mjs (the module itself is plain JavaScript shared by the server, the designer and the tests).
export const SCHEMA_VERSION: 1
export const PLACEMENTS: string[]

export interface Issue {
  path: string
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  stepId?: string
}

export function validateTour(input: unknown): { ok: boolean; tour: any | null; issues: Issue[] }
export function createEmptyTour(args: { id: string; title: string }): any
export function toTourJsonSchema(): object
