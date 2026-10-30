// Google Gemini transport (@google/genai). All prompt/repair logic lives in generate.js; this file only
// knows how to send a conversation and read the answer. The API key never leaves the server.
import { GoogleGenAI } from '@google/genai'
import { generateWithLlm } from './generate.js'
import { providerDisabled } from './config.js'
import { scrub } from './secrets.js'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
const TIMEOUT_MS = 180_000

/** Maps SDK/network errors to something an end user can act on, and marks transient ones retryable. */
export function friendlyGeminiError(e) {
  const status = e?.status ?? e?.cause?.status
  const retryable =
    status === 429 ||
    status >= 500 ||
    ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(e?.cause?.code ?? e?.code)
  let message = scrub(e?.message ?? String(e))
  if (status === 401 || status === 403)
    message =
      'Gemini rejected the API key (check GEMINI_API_KEY and that the Gemini API is enabled for it)'
  else if (status === 404)
    message = `Gemini does not know this model (${message}); check GEMINI_MODEL`
  else if (status === 429) message = 'Gemini rate limit or quota reached; try again later'
  const err = new Error(message, { cause: e })
  err.retryable = retryable
  return err
}

/**
 * @param {{env?: object, createClient?: (apiKey: string) => {models: {generateContent: Function}}}} [options]
 *   `createClient` exists for tests.
 */
export function createGeminiProvider({
  env = process.env,
  createClient = (apiKey) => new GoogleGenAI({ apiKey }),
} = {}) {
  const provider = {
    id: 'gemini',
    label: 'Google Gemini',
    isConfigured: () => !!env.GEMINI_API_KEY && !providerDisabled(env, 'gemini'),
    defaultModel: () => env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,

    /** @returns {Promise<{text: string, usage: object, finishReason?: string}>} */
    async complete({ system, messages, schema, model, signal }) {
      const client = createClient(env.GEMINI_API_KEY)
      try {
        const response = await client.models.generateContent({
          model: model || provider.defaultModel(),
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            abortSignal: signal,
            httpOptions: { timeout: TIMEOUT_MS },
          },
        })
        const usage = response.usageMetadata ?? {}
        return {
          text: response.text ?? '',
          finishReason: response.candidates?.[0]?.finishReason,
          usage: {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          },
        }
      } catch (e) {
        throw friendlyGeminiError(e)
      }
    },

    async generate(ctx) {
      const model = ctx.model || provider.defaultModel()
      const { tour, report } = await generateWithLlm({
        ...ctx,
        model,
        complete: (req) => provider.complete(req),
      })
      return { tour, report: { ...report, provider: provider.id } }
    },
  }
  return provider
}
