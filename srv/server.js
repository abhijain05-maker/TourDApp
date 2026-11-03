// Loaded by CAP at startup, before the services: makes the variables of a local .env file available
// (GEMINI_API_KEY, AICORE_SERVICE_KEY, ...). Real environment variables win over the file.
import cds from '@sap/cds'
import { readFileSync } from 'node:fs'
import { loadAiCoreKeyFile } from './lib/llm/config.js'
import { registerSecurity } from './security.js'
import { registerPreview } from './preview.js'
import { registerExport } from './export.js'
import { registerQTestRoutes } from './qtest-routes.js'

try {
  process.loadEnvFile('.env')
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}

// AICORE_SERVICE_KEY_FILE=<path of the downloaded service key> instead of pasting the JSON into AICORE_SERVICE_KEY
const keyProblem = loadAiCoreKeyFile(process.env, (p) => readFileSync(p, 'utf8'))
if (keyProblem) cds.log('tourd').warn(keyProblem)

// the guards come first; then the sandbox/live preview (/preview, /live) and the export bundle (/export)
cds.on('bootstrap', registerSecurity)
cds.on('bootstrap', registerPreview)
cds.on('bootstrap', registerExport)
cds.on('bootstrap', registerQTestRoutes) // QuickTest downloads (/qtest)
