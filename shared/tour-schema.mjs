// The tour contract. Single source of truth for: API validation, designer forms, the LLM response
// schema (derived), and the exported tour.schema.json. The browser player does its own light checks.
import { z } from 'zod'

export const SCHEMA_VERSION = 1

/** Subset of sap.m.PlacementType that makes sense for a tour bubble. */
export const PLACEMENTS = [
  'PreferredBottomOrFlip',
  'PreferredTopOrFlip',
  'PreferredLeftOrFlip',
  'PreferredRightOrFlip',
  'Bottom',
  'Top',
  'Left',
  'Right',
  'Vertical',
  'Horizontal',
]

const fallbackSchema = z.strictObject({
  by: z
    .enum(['id', 'css', 'text'])
    .describe('How to look the control up when the primary lookup fails'),
  value: z.string().min(1),
})

export const targetSchema = z
  .strictObject({
    viewName: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Fully qualified view name, e.g. my.app.view.Main. Needed to resolve view-local ids.',
      ),
    controlId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'View-local control id (global id if no viewName). May be omitted for controls without an id when a fallback is given.',
      ),
    fallbacks: z.array(fallbackSchema).default([]),
  })
  .refine((t) => !!t.controlId || t.fallbacks.length > 0, {
    path: ['controlId'],
    message: 'A target needs a controlId or at least one fallback',
  })

const navigateAction = z.strictObject({
  type: z.literal('navigate'),
  hash: z.string().describe('Router hash to navigate to before showing the step, e.g. "order/new"'),
})

const beforeActionSchema = z.discriminatedUnion('type', [navigateAction])

const metaSchema = z.strictObject({
  source: z.string().optional().describe('Where the step came from, e.g. "recording:3"'),
  confidence: z.number().min(0).max(1).optional(),
  unresolved: z.boolean().default(false).describe('True when the target could not be verified'),
  note: z.string().optional(),
})

export const stepSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  text: z.string().default('').describe('Markdown subset or an {i18n>key} reference'),
  target: targetSchema.optional().describe('Omit for a centered intro/outro step'),
  placement: z.enum(PLACEMENTS).default('PreferredBottomOrFlip'),
  before: z.array(beforeActionSchema).default([]),
  meta: metaSchema.optional(),
})

export const optionsSchema = z
  .strictObject({
    showProgress: z.boolean().default(true),
    allowSkip: z.boolean().default(true),
    overlay: z.boolean().default(true),
    interactive: z.boolean().default(true),
    waitTimeoutMs: z.number().int().min(0).max(60000).default(5000),
  })
  .prefault({})

export const tourSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().min(1),
    title: z.string().min(1),
    options: optionsSchema,
    steps: z.array(stepSchema).min(1),
  })
  .superRefine((tour, ctx) => {
    const seen = new Set()
    tour.steps.forEach((step, i) => {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'id'],
          message: `Duplicate step id "${step.id}"`,
        })
      }
      seen.add(step.id)
    })
  })

const formatPath = (path) =>
  path.reduce(
    (acc, seg) =>
      typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : String(seg),
    '',
  )

const isAutoId = (id) => /^__/.test(id)

/**
 * Validate a tour document.
 * @returns {{ ok: boolean, tour: object | null, issues: Array<{path: string, code: string, severity: 'error'|'warning', message: string}> }}
 *   `tour` has defaults applied. `ok` is false only when there are errors (warnings don't fail validation).
 */
export function validateTour(input) {
  const parsed = tourSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      tour: null,
      issues: parsed.error.issues.map((i) => ({
        path: formatPath(i.path),
        code: i.code,
        severity: 'error',
        message: i.message,
      })),
    }
  }
  const tour = parsed.data
  const issues = []
  tour.steps.forEach((step, i) => {
    if (step.meta?.unresolved) {
      issues.push({
        path: `steps[${i}].target`,
        code: 'step.unresolved',
        severity: 'warning',
        message: `Step "${step.id}": target could not be verified`,
      })
    }
    if (step.target?.controlId && isAutoId(step.target.controlId)) {
      issues.push({
        path: `steps[${i}].target.controlId`,
        code: 'target.unstableId',
        severity: 'warning',
        message: `Step "${step.id}": "${step.target.controlId}" is an auto-generated id and may change between runs`,
      })
    }
  })
  return { ok: true, tour, issues }
}

/** Minimal valid tour with defaults applied; handy for the designer and tests. */
export function createEmptyTour({ id, title }) {
  return tourSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id,
    title,
    steps: [{ id: 's1', title: 'Welcome' }],
  })
}

/** JSON Schema describing what authors write (defaults optional). */
export function toTourJsonSchema() {
  return z.toJSONSchema(tourSchema, { io: 'input' })
}
