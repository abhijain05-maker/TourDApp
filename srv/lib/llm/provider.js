// Tour generation providers. A provider turns { inventory, recording } into a draft tour.
// The rule-based provider is always available; Gemini and SAP Generative AI Hub register themselves too and
// report `configured: false` until their credentials are set.
import { generateTourFromRules } from './rules.js'
import { createGeminiProvider } from './gemini.js'
import { createSapAiCoreProvider } from './sap-ai-core.js'
import { redactionEnabled } from './redact.js'

const rules = {
  id: 'rules',
  label: 'Rule-based (no AI)',
  isConfigured: () => true,
  defaultModel: () => null,
  /** @returns {Promise<{tour: object, report: object}>} */
  async generate({ recording, inventory, title }) {
    const { tour, report } = generateTourFromRules({ recording, inventory, title })
    return { tour, report: { ...report, generator: 'rules' } }
  },
}

// Kept in a global slot so every module instance (server, test harness, scripts) sees the same providers.
const REGISTRY = (globalThis[Symbol.for('tourd.providers')] ??= new Map())
for (const p of [rules, createGeminiProvider(), createSapAiCoreProvider()])
  if (!REGISTRY.has(p.id)) REGISTRY.set(p.id, p)

export function registerProvider(provider) {
  REGISTRY.set(provider.id, provider)
}

export function getProvider(id) {
  return REGISTRY.get(id) ?? null
}

/** Default provider from TOURD_LLM_PROVIDER, falling back to the always-available rule generator. */
export function defaultProviderId(env = process.env) {
  const wanted = env.TOURD_LLM_PROVIDER
  return wanted && REGISTRY.get(wanted)?.isConfigured() ? wanted : 'rules'
}

export function listProviders() {
  return [...REGISTRY.values()].map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    model: p.defaultModel(),
    redaction: redactionEnabled(),
  }))
}
