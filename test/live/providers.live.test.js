import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { createGeminiProvider } from '../../srv/lib/llm/gemini.js'
import { createSapAiCoreProvider } from '../../srv/lib/llm/sap-ai-core.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { lintTour } from '../../srv/lib/validate/lint.js'
import { refineStep } from '../../srv/lib/llm/refine.js'
import { demoSources } from '../helpers/sources.js'

// Real calls. Skipped unless the provider is configured (GEMINI_API_KEY / AICORE_SERVICE_KEY + AICORE_MODEL).
// Run with: npm run test:live   (put the keys in .env or the environment)
try {
  process.loadEnvFile('.env')
} catch {}

const sources = demoSources()
const inventory = buildInventory(sources)
const recording = mapRecording(
  parseRecording(readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')),
  inventory,
)

const providers = [createGeminiProvider(), createSapAiCoreProvider()]

for (const provider of providers) {
  const ready = provider.isConfigured() && !!provider.defaultModel()
  describe.skipIf(!ready)(`live: ${provider.label}`, () => {
    it('generates a tour whose every target exists in the app', async () => {
      const { tour, report } = await provider.generate({
        inventory,
        recording,
        sources,
        title: 'Orders tour',
      })
      console.log(
        `[${provider.id}] model=${report.model} steps=${report.steps} repairs=${report.repairs} unresolved=${report.unresolved} tokens=${JSON.stringify(report.usage)} fixes=${JSON.stringify(report.fixes)}`,
      )
      expect(tour.steps.length).toBeGreaterThanOrEqual(4)
      for (const step of tour.steps.filter((s) => s.target?.controlId)) {
        expect(
          inventory.controls.some(
            (c) => c.localId === step.target.controlId && c.viewName === step.target.viewName,
          ),
          `${step.id} -> ${step.target.controlId}`,
        ).toBe(true)
      }
      const lint = lintTour(tour, inventory, { recording })
      expect(lint.summary.errors).toBe(0)
    })

    it('rewrites a single step', async () => {
      const { tour } = await provider.generate({
        inventory,
        recording,
        sources,
        title: 'Orders tour',
      })
      const step = tour.steps.find((s) => s.target?.controlId)
      const out = await refineStep({
        complete: (req) => provider.complete(req),
        tour,
        stepId: step.id,
        instruction: 'Rewrite the text in German, one short sentence.',
        inventory,
        model: provider.defaultModel(),
      })
      const after = out.tour.steps.find((s) => s.id === step.id)
      expect(after.text).not.toBe(step.text)
      expect(after.target).toEqual(step.target)
    })
  })
}
