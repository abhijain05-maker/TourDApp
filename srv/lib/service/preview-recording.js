// "Try it before you send it": the extension asks what TourD would make of a recording it has not sent yet, plays that
// in the app, and the author records again if it does not work. Nothing is saved: this only reads and builds, and it
// builds the same way as the real thing (the test plan as createTestPlan does, the tour as the rules generator does),
// so what passes here is what the generated test or tour will do.
import { parseRecording } from '../recordings/index.js'
import { mapRecording, withLiveControls } from '../recordings/map.js'
import { buildPlan } from '../wdi5/plan.js'
import { generateTourFromRules } from '../llm/rules.js'
import { validatePlan } from '../../../shared/wdi5-plan.mjs'
import { inventoryWithLive } from './live-inventory.js'
import { LIMITS } from './sources.js'

export function registerPreviewRecording(srv, { project, guarded }) {
  srv.on(
    'previewRecording',
    guarded(async (req) => {
      const { projectID, raw, kind } = req.data
      if (kind !== 'test' && kind !== 'tour')
        return req.reject(400, 'kind must be "test" or "tour"')
      if (typeof raw !== 'string' || !raw.trim()) return req.reject(400, 'The recording is empty')
      if (Buffer.byteLength(raw, 'utf8') > LIMITS.recordingBytes)
        return req.reject(
          400,
          `The recording is too large; the limit is ${LIMITS.recordingBytes} bytes`,
        )
      const p = await project(req, projectID)
      if (!p.inventory)
        return req.reject(409, 'Import the app sources first: the project has no inventory yet')

      let normalized
      try {
        normalized = parseRecording(raw)
      } catch (e) {
        return req.reject(400, e.message)
      }
      const base = JSON.parse(p.inventory)

      if (kind === 'test') {
        const mapped = mapRecording(normalized, base)
        const checked = validatePlan(buildPlan({ mapped, inventory: base, name: 'Preview' }))
        if (!checked.ok)
          return req.reject(
            400,
            `The plan is not valid: ${checked.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
          )
        return { kind, definition: JSON.stringify(checked.plan), ...mapped.mapping }
      }

      const inventory = await inventoryWithLive(base, projectID)
      const mapped = mapRecording(normalized, inventory)
      try {
        const { tour } = generateTourFromRules({
          recording: mapped,
          inventory: withLiveControls(inventory, mapped),
          title: normalized.title ?? undefined,
        })
        return { kind, definition: JSON.stringify(tour), ...mapped.mapping }
      } catch (e) {
        return req.reject(400, e.message)
      }
    }),
  )
}
