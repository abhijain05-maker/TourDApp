// Recording adapter registry: detect the format (or take an explicit one) and parse to a normalised recording.
import * as tourd from './tourd-recorder.js'
import * as devtools from './devtools-recorder.js'
import * as ui5Test from './ui5-test-recorder.js'
import * as plain from './plain-text.js'

/** Order matters for auto-detection: strict formats first, the permissive plain text last. */
const ADAPTERS = [tourd, devtools, ui5Test, plain]

export const FORMATS = ADAPTERS.map((a) => a.FORMAT)

export function detectFormat(raw) {
  return ADAPTERS.find((a) => a.detect(raw))?.FORMAT ?? null
}

/**
 * @param {string|object} raw recording content
 * @param {{format?: string}} [options] force a format instead of auto-detecting
 */
export function parseRecording(raw, options = {}) {
  const adapter = options.format
    ? ADAPTERS.find((a) => a.FORMAT === options.format)
    : ADAPTERS.find((a) => a.detect(raw))
  if (options.format && !adapter)
    throw new Error(`Unknown recording format "${options.format}" (known: ${FORMATS.join(', ')})`)
  if (!adapter) throw new Error('Could not recognise the recording format')
  return adapter.parse(raw)
}
