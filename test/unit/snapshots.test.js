import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { generateTourFromRules } from '../../srv/lib/llm/rules.js'
import { lintTour } from '../../srv/lib/validate/lint.js'
import { demoSources } from '../helpers/sources.js'

// Pins the generator output for every fixture format; review the diff when it changes on purpose.
const inventory = buildInventory(demoSources())

describe.each(['devtools.json', 'opa5.js', 'wdi5.js', 'raw.js', 'txt'])(
  'rule generator + lint snapshot: %s',
  (fixture) => {
    it('matches the stored tour and lint result', () => {
      const raw = readFileSync(`test/fixtures/recordings/demo-create-order.${fixture}`, 'utf8')
      const recording = mapRecording(parseRecording(raw), inventory)
      const { tour, report } = generateTourFromRules({ recording, inventory })
      expect({
        mapping: recording.mapping,
        report,
        tour,
        lint: lintTour(tour, inventory, { recording }),
      }).toMatchSnapshot()
    })
  },
)

describe('inventory snapshot', () => {
  it('matches the stored demo app inventory (controls, views, routes)', () => {
    const { controllers, ...rest } = inventory
    expect({
      ...rest,
      controllers: controllers.map((c) => ({ ...c, path: undefined })),
    }).toMatchSnapshot()
  })
})
