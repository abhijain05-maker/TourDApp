import type { Issue } from '../../../shared/tour-schema.mjs'

export function lintTour(
  tour: unknown,
  inventory: unknown,
  options?: { recording?: unknown; startHash?: string },
): { issues: Issue[]; summary: { errors: number; warnings: number; infos: number } }
