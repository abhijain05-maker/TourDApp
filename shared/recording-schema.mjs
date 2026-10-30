// The recording contract written by the TourD recorder (extension / console snippet) and read by the server.
// Strict on purpose: a recording is data that later drives generated code, so unknown fields are errors.
// New optional fields can be added without a version bump; anything else needs RECORDING_VERSION + 1.
import { z } from 'zod'

export const RECORDING_FORMAT = 'tourd-recording'
export const RECORDING_VERSION = 1

/** What a person did. `navigate` is recorded when the router hash changes. */
export const STEP_TYPES = [
  'press',
  'input',
  'select',
  'search',
  'toggle',
  'navigate',
  'note',
  'check',
]

/** What a check looks at: that the control is there, the text it shows, or the value it holds. */
export const CHECK_KINDS = ['visible', 'text', 'value']

const text = z.string().max(500)

/** A text the control shows through a resource-bundle binding, e.g. text="{i18n>create}". */
const i18nSchema = z.strictObject({
  property: z.string().describe('The control property that is bound, e.g. "text"'),
  model: z.string().describe('Name of the resource model, usually "i18n"'),
  key: z.string(),
})

export const controlSchema = z.strictObject({
  id: z.string().min(1).describe('Full runtime id (what getId() returns)'),
  localId: z
    .string()
    .nullable()
    .describe(
      'Id as written in the view (without the view prefix); null when the control has none',
    ),
  viewName: z
    .string()
    .nullable()
    .describe('Fully qualified name of the view the control belongs to'),
  controllerName: z.string().nullable().describe("Name of that view's controller"),
  controlType: z.string().min(1).describe('e.g. sap.m.Button'),
  stableId: z
    .boolean()
    .describe('False for generated ids (__button3) and for clones created by a list binding'),
  text: text.optional().describe('What the control shows (text, title, label, ...)'),
  label: text.optional().describe('Text of the label that points at the control (labelFor)'),
  tooltip: text.optional(),
  placeholder: text.optional(),
  i18n: i18nSchema.optional(),
  bindingPath: z
    .string()
    .optional()
    .describe('Path of the binding context, e.g. /Orders/2 for a control inside a list row'),
  inList: z
    .boolean()
    .optional()
    .describe('True when the control is a clone from a bound aggregation'),
  inDialog: z.boolean().optional().describe('True when the control is inside a Dialog or Popover'),
  selector: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "UI5's own selector for the control (sap/ui/test/RecordReplay.findControlSelectorByDOMElement): an id, or properties, bindings, texts or a parent that match exactly this control",
    ),
  clicked: z
    .string()
    .optional()
    .describe(
      'Type of the control that was actually hit, when the recorded control is a parent of it',
    ),
})

export const stepSchema = z
  .strictObject({
    index: z.number().int().min(0),
    t: z.number().min(0).describe('Milliseconds since the recording started'),
    type: z.enum(STEP_TYPES),
    control: controlSchema.optional(),
    value: z
      .union([z.string().max(2000), z.boolean()])
      .optional()
      .describe('Typed text, selected key/text, or the new state of a toggle'),
    valueText: z
      .string()
      .max(500)
      .optional()
      .describe('For select: the visible text of the chosen item'),
    redacted: z
      .boolean()
      .optional()
      .describe('True when a value was left out on purpose (passwords, secrets)'),
    event: z.string().optional().describe('The UI5 event the step comes from, e.g. press, change'),
    hash: z.string().optional().describe('Router hash after a navigate step'),
    url: z.string().optional(),
    causedBy: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Index of the step that triggered this navigation'),
    note: text.optional(),
    check: z
      .strictObject({ kind: z.enum(CHECK_KINDS), expected: text.optional() })
      .optional()
      .describe('For a check step: what the person pointed at and what it showed at that moment'),
  })
  .superRefine((s, ctx) => {
    if (s.type === 'check' && !s.check)
      ctx.addIssue({ code: 'custom', path: ['check'], message: 'A "check" step needs a check' })
    if (['press', 'input', 'select', 'search', 'toggle', 'check'].includes(s.type) && !s.control)
      ctx.addIssue({
        code: 'custom',
        path: ['control'],
        message: `A "${s.type}" step needs a control`,
      })
    if (s.type === 'navigate' && s.hash === undefined)
      ctx.addIssue({ code: 'custom', path: ['hash'], message: 'A "navigate" step needs a hash' })
    if (s.type === 'note' && !s.note)
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'A "note" step needs a note' })
  })

export const appSchema = z.strictObject({
  url: z.string().describe('Origin and path of the page, without query and hash'),
  startHash: z.string().default(''),
  title: z.string().default(''),
  ui5Version: z.string().nullable().default(null),
  appId: z.string().nullable().default(null).describe('sap.app/id of the first component'),
  locale: z.string().nullable().default(null),
})

export const recordingSchema = z
  .strictObject({
    format: z.literal(RECORDING_FORMAT),
    version: z.literal(RECORDING_VERSION),
    recordedAt: z.string().describe('ISO time the recording started'),
    recorder: z.string().default('').describe('Name and version of the recorder that wrote it'),
    app: appSchema,
    steps: z.array(stepSchema),
  })
  .superRefine((r, ctx) => {
    r.steps.forEach((s, i) => {
      if (s.index !== i)
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'index'],
          message: `Step ${i} has index ${s.index}; indexes must be 0, 1, 2, ...`,
        })
    })
  })

const formatPath = (path) =>
  path.reduce(
    (acc, seg) =>
      typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : String(seg),
    '',
  )

/** Quick check used for format auto-detection: is this plausibly a TourD recording? */
export function looksLikeRecording(input) {
  return !!input && typeof input === 'object' && input.format === RECORDING_FORMAT
}

/**
 * Validate a recording.
 * @returns {{ok: boolean, recording: object|null, issues: Array<{path: string, code: string, severity: 'error', message: string}>}}
 */
export function validateRecording(input) {
  const parsed = recordingSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      recording: null,
      issues: parsed.error.issues.map((i) => ({
        path: formatPath(i.path),
        code: i.code,
        severity: 'error',
        message: i.message,
      })),
    }
  return { ok: true, recording: parsed.data, issues: [] }
}

/** JSON Schema of what recorders write. */
export function toRecordingJsonSchema() {
  return z.toJSONSchema(recordingSchema, { io: 'input' })
}
