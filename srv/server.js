// Loaded by CAP at startup, before the services: makes the variables of a local .env file available
// (GEMINI_API_KEY, AICORE_SERVICE_KEY, ...). Real environment variables win over the file.
import cds from '@sap/cds'
import { registerSecurity } from './security.js'
import { registerPreview } from './preview.js'
import { registerExport } from './export.js'

try {
  process.loadEnvFile('.env')
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}

// the guards come first; then the sandbox/live preview (/preview, /live) and the export bundle (/export)
cds.on('bootstrap', registerSecurity)
cds.on('bootstrap', registerPreview)
cds.on('bootstrap', registerExport)
