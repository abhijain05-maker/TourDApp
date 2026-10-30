// Writes shared/tour.schema.json from the Zod contract. Run: npm run build:schema
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { toTourJsonSchema } from '../shared/tour-schema.mjs'

const out = fileURLToPath(new URL('../shared/tour.schema.json', import.meta.url))
writeFileSync(out, JSON.stringify(toTourJsonSchema(), null, 2) + '\n')
console.log('wrote', out)
