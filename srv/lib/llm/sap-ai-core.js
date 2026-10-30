// SAP Generative AI Hub transport (@sap-ai-sdk/orchestration). Credentials come from the AI Core service
// binding on BTP or, locally, from the AICORE_SERVICE_KEY environment variable (read by the SAP Cloud SDK).
// The orchestration client fixes model and response format at construction time, so one is built per call.
import { OrchestrationClient } from '@sap-ai-sdk/orchestration'
import { generateWithLlm } from './generate.js'
import { providerDisabled } from './config.js'
import { scrub } from './secrets.js'

/**
 * The orchestration service treats "{{?name}}" in messages as a template placeholder. Source code and
 * i18n bundles can contain it, so break the sequence (a space is harmless to the model).
 */
export const neutralizePlaceholders = (text) => String(text).split('{{?').join('{ {?')

const statusOf = (e) =>
  e?.cause?.status ?? e?.cause?.response?.status ?? e?.response?.status ?? e?.status

export function friendlySapError(e) {
  const status = statusOf(e)
  const code = e?.cause?.code ?? e?.code
  const retryable =
    status === 429 ||
    status >= 500 ||
    ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
  let message = scrub(e?.message ?? String(e))
  if (status === 401 || status === 403)
    message =
      'SAP AI Core rejected the credentials (check AICORE_SERVICE_KEY or the service binding)'
  else if (status === 404)
    message = `SAP AI Core found no deployment for this model/resource group (${message}); check AICORE_MODEL and AICORE_RESOURCE_GROUP`
  else if (status === 429) message = 'SAP AI Core rate limit reached; try again later'
  const err = new Error(message, { cause: e })
  err.retryable = retryable
  err.status = status
  return err
}

const REQUEST_REJECTS_FORMAT = /response_format|json_schema|structured/i

/**
 * @param {{env?: object, createClient?: (config: object, deployment?: object) => {chatCompletion: Function}}} [options]
 *   `createClient` exists for tests.
 */
export function createSapAiCoreProvider({
  env = process.env,
  createClient = (config, deployment) => new OrchestrationClient(config, deployment),
} = {}) {
  const hasCredentials = () =>
    !!env.AICORE_SERVICE_KEY || String(env.VCAP_SERVICES ?? '').includes('aicore')

  const provider = {
    id: 'sap-ai-core',
    label: 'SAP Generative AI Hub',
    isConfigured: () => hasCredentials() && !providerDisabled(env, 'sap-ai-core'),
    defaultModel: () => env.AICORE_MODEL || null,

    async complete({ system, messages, schema, schemaName, model, signal }) {
      const name = model || provider.defaultModel()
      if (!name)
        throw new Error(
          'No model chosen for SAP Generative AI Hub: set AICORE_MODEL (a model deployed in your AI Core resource group) or enter one in the generate dialog',
        )
      const deployment = env.AICORE_RESOURCE_GROUP
        ? { resourceGroup: env.AICORE_RESOURCE_GROUP }
        : undefined
      const configFor = (withFormat) => ({
        promptTemplating: {
          model: { name },
          ...(withFormat
            ? {
                prompt: {
                  response_format: {
                    type: 'json_schema',
                    json_schema: { name: schemaName || 'tour_draft', strict: true, schema },
                  },
                },
              }
            : {}),
        },
      })
      const request = {
        messages: [
          { role: 'system', content: neutralizePlaceholders(system) },
          ...messages.map((m) => ({ role: m.role, content: neutralizePlaceholders(m.content) })),
        ],
      }
      const requestConfig = signal ? { signal } : undefined

      let response
      try {
        try {
          response = await createClient(configFor(true), deployment).chatCompletion(
            request,
            requestConfig,
          )
        } catch (e) {
          // not every model behind the orchestration service supports json_schema: retry once, prompt-only
          if (
            statusOf(e) === 400 &&
            REQUEST_REJECTS_FORMAT.test(
              JSON.stringify(e?.cause?.response?.data ?? e?.message ?? ''),
            )
          ) {
            response = await createClient(configFor(false), deployment).chatCompletion(
              request,
              requestConfig,
            )
          } else {
            throw e
          }
        }
      } catch (e) {
        throw friendlySapError(e)
      }
      const usage = response.getTokenUsage?.() ?? {}
      return {
        text: response.getContent() ?? '',
        finishReason: response.getFinishReason?.(),
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
        },
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
