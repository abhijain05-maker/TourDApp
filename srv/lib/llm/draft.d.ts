/** The target a tour step gets for an inventory control (view, id or text fallback). */
export function targetFor(control: unknown): {
  viewName?: string
  controlId?: string
  fallbacks: { by: string; value: string }[]
}
export const DRAFT_SCHEMA: object
