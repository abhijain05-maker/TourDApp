// Provider-neutral AI generation: prompt -> model -> draft -> verified tour, with a repair loop.
// A provider only supplies `complete({ system, messages, schema, model, signal })`.
import { DRAFT_SCHEMA, draftToTour } from './draft.js'
import { buildPrompt, buildRepairMessage } from './prompt.js'
import { lintTour } from '../validate/lint.js'
import { routerHashOf } from '../recordings/devtools-recorder.js'

/** Lint findings the model can fix by itself and should be told about. */
const REPAIRABLE_LINT = new Set([
  'step.wrongRoute',
  'navigate.unknownRoute',
  'step.duplicateTarget',
])

export class ModelAnswerError extends Error {}

/** Models sometimes wrap JSON in fences or add a sentence; take the outermost object. */
export function extractJson(text) {
  const raw = String(text ?? '').trim()
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(unfenced)
  } catch {
    const a = unfenced.indexOf('{')
    const b = unfenced.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(unfenced.slice(a, b + 1))
      } catch {
        /* fall through */
      }
    }
    throw new ModelAnswerError('The answer was not valid JSON')
  }
}

async function withRetry(fn, { retries = 2, delayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!e.retryable || attempt >= retries) throw e
      await new Promise((r) => setTimeout(r, delayMs * 3 ** attempt))
    }
  }
}

/** A call to the model that never answers must not keep a job "running" for ever: stop waiting after `ms`. */
async function withDeadline(call, outer, ms) {
  const timer = AbortSignal.timeout(ms)
  const signal = outer ? AbortSignal.any([outer, timer]) : timer
  let onAbort
  const gone = new Promise((_, reject) => {
    onAbort = () =>
      reject(
        Object.assign(
          new Error(`The AI did not answer within ${Math.round(ms / 1000)} seconds. Try again or choose another provider.`),
          { retryable: false },
        ),
      )
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([call(signal), gone])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

const add = (a, b) => ({
  inputTokens: (a.inputTokens ?? 0) + (b?.inputTokens ?? 0),
  outputTokens: (a.outputTokens ?? 0) + (b?.outputTokens ?? 0),
})

/**
 * @param {object} args
 * @param {Function} args.complete provider transport
 * @param {object} args.inventory
 * @param {object} args.recording mapped recording
 * @param {Array<{path: string, content: string}>} [args.sources]
 * @param {number} [args.maxRepairs=2]
 * @param {(stage: string) => void} [args.onStage]
 * @returns {Promise<{tour: object, report: object}>}
 */
export async function generateWithLlm({
  complete,
  inventory,
  recording,
  sources = [],
  title,
  model,
  language,
  budgetTokens,
  redact,
  maxRepairs = 2,
  retryDelayMs,
  answerTimeoutMs = 240_000,
  onStage = () => {},
  signal,
}) {
  const prompt = buildPrompt({
    inventory,
    recording,
    sources,
    title,
    language,
    budgetTokens,
    redact,
  })
  const messages = [{ role: 'user', content: prompt.user }]
  const startHash = recording.startUrl ? routerHashOf(recording.startUrl) : ''
  let usage = {}
  let repairs = 0
  let result
  let problems

  for (;;) {
    const answer = await withRetry(
      () =>
        withDeadline(
          (s) => complete({ system: prompt.system, messages, schema: DRAFT_SCHEMA, model, signal: s }),
          signal,
          answerTimeoutMs,
        ),
      { delayMs: retryDelayMs },
    )
    usage = add(usage, answer.usage)
    problems = []
    result = null

    try {
      if (/length|max_tokens/i.test(String(answer.finishReason ?? '')))
        throw new ModelAnswerError(
          'The answer was cut off before it was complete; return a shorter tour (fewer, shorter steps)',
        )
      result = draftToTour(extractJson(answer.text), { inventory, recording, title })
      problems = [...result.problems]
      const stepNumber = (id) => result.tour.steps.findIndex((s) => s.id === id) + 1
      for (const issue of lintTour(result.tour, inventory, { recording, startHash }).issues) {
        if (REPAIRABLE_LINT.has(issue.code) && issue.stepId)
          problems.push({
            step: stepNumber(issue.stepId),
            code: issue.code,
            message: issue.message,
          })
      }
    } catch (e) {
      if (!(e instanceof ModelAnswerError) && !/cannot be turned into a valid tour/.test(e.message))
        throw e
      problems = [{ step: 0, code: 'answer.invalid', message: e.message }]
    }

    if (!problems.length) break
    if (repairs >= maxRepairs) {
      if (!result)
        throw new ModelAnswerError(
          `The model did not return a usable tour after ${repairs + 1} attempts: ${problems[0].message}`,
        )
      break
    }
    repairs++
    await onStage('repair')
    messages.push(
      { role: 'assistant', content: answer.text ?? '' },
      { role: 'user', content: buildRepairMessage({ problems, inventory }) },
    )
  }

  const { tour, fixes } = result
  const unresolved = tour.steps.filter((s) => s.meta?.unresolved).length
  return {
    tour,
    report: {
      generator: 'llm',
      model,
      steps: tour.steps.length,
      unresolved,
      repairs,
      fixes,
      remainingProblems: problems.map((p) => `Step ${p.step}: ${p.message}`),
      usage,
      context: prompt.context,
    },
  }
}
