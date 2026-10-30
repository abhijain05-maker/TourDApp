// The help contract: topics bound to controls of a UI5 app (like the Help Topics panel of the BTP cockpit).
// Single source of truth for: API validation, the extension, the designer and the exported help.json.
// A topic's `target` is the same shape as a tour step target, so one resolver finds the control for both.
import { z } from 'zod'
import { targetSchema } from './tour-schema.mjs'

export const HELP_SCHEMA_VERSION = 1

const linkSchema = z.strictObject({
  label: z.string().min(1).max(200),
  url: z
    .string()
    .regex(/^https?:\/\//i, 'A link must start with http:// or https://')
    .max(2000),
})

export const topicSchema = z.strictObject({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  summary: z.string().max(300).default('').describe('One line shown in the topic list'),
  text: z.string().max(8000).default('').describe('Markdown subset or an {i18n>key} reference'),
  note: z.string().max(2000).default('').describe('Optional highlighted note below the text'),
  links: z.array(linkSchema).max(10).default([]),
  target: targetSchema,
  meta: z
    .strictObject({
      source: z.string().optional().describe('extension | designer | ai'),
      controlType: z.string().optional(),
      screen: z.string().optional().describe('Title of the page the topic was made on'),
      hash: z.string().optional().describe('Router hash the topic was made on'),
    })
    .optional(),
})

export const helpOptionsSchema = z
  .strictObject({
    panelTitle: z.string().min(1).max(80).default('Help Topics'),
    showBadges: z.boolean().default(true),
    buttonPosition: z
      .enum(['top', 'bottom'])
      .default('top')
      .describe(
        'Where the ? that switches the help on and off sits: top right of the app, or bottom right',
      ),
  })
  .prefault({})

export const helpSchema = z
  .strictObject({
    schemaVersion: z.literal(HELP_SCHEMA_VERSION),
    id: z.string().min(1),
    title: z.string().min(1),
    options: helpOptionsSchema,
    topics: z.array(topicSchema),
  })
  .superRefine((help, ctx) => {
    const seen = new Set()
    help.topics.forEach((t, i) => {
      if (seen.has(t.id))
        ctx.addIssue({
          code: 'custom',
          path: ['topics', i, 'id'],
          message: `Duplicate topic id "${t.id}"`,
        })
      seen.add(t.id)
    })
  })

const formatPath = (path) =>
  path.reduce(
    (acc, seg) =>
      typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : String(seg),
    '',
  )

const isAutoId = (id) => /^__/.test(id)

/** @returns {{ ok: boolean, help: object | null, issues: Array<{path, code, severity, message}> }} */
export function validateHelp(input) {
  const parsed = helpSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      help: null,
      issues: parsed.error.issues.map((i) => ({
        path: formatPath(i.path),
        code: i.code,
        severity: 'error',
        message: i.message,
      })),
    }
  const help = parsed.data
  const issues = []
  help.topics.forEach((t, i) => {
    if (t.target.controlId && isAutoId(t.target.controlId))
      issues.push({
        path: `topics[${i}].target.controlId`,
        code: 'target.unstableId',
        severity: 'warning',
        message: `Topic "${t.title}": "${t.target.controlId}" is an auto-generated id and may change between runs`,
      })
    if (!t.text.trim() && !t.summary.trim())
      issues.push({
        path: `topics[${i}].text`,
        code: 'topic.empty',
        severity: 'warning',
        message: `Topic "${t.title}" has no text yet`,
      })
  })
  return { ok: true, help, issues }
}

export function createEmptyHelp({ id, title }) {
  return helpSchema.parse({ schemaVersion: HELP_SCHEMA_VERSION, id, title, topics: [] })
}

/** Adds the topic, or replaces the one with the same id. Returns a new help document (not validated). */
export function upsertTopic(help, topic) {
  const topics = help.topics.some((t) => t.id === topic.id)
    ? help.topics.map((t) => (t.id === topic.id ? topic : t))
    : [...help.topics, topic]
  return { ...help, topics }
}

export function removeTopic(help, topicId) {
  return { ...help, topics: help.topics.filter((t) => t.id !== topicId) }
}

export function toHelpJsonSchema() {
  return z.toJSONSchema(helpSchema, { io: 'input' })
}
