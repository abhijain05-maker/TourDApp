// Switches that let an operator turn AI providers off without touching code.
//   TOURD_DISABLE_AI=1                 -> only the rule-based generator is available
//   TOURD_DISABLED_PROVIDERS=gemini    -> comma separated provider ids to disable
export function providerDisabled(env, id) {
  if (env.TOURD_DISABLE_AI === '1') return true
  return (env.TOURD_DISABLED_PROVIDERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(id)
}

/**
 * The AI Core service key is one line of JSON, awkward to paste into a .env file. AICORE_SERVICE_KEY_FILE names the
 * file the key was downloaded as (a path, quotes allowed); its content is made the one-line value the SAP Cloud SDK reads.
 * A key that is set already wins. Returns a sentence when something is wrong (the server logs it), else null.
 */
export function loadAiCoreKeyFile(env, readFile) {
  const path = String(env.AICORE_SERVICE_KEY_FILE ?? '').trim().replace(/^["']|["']$/g, '')
  if (!path || env.AICORE_SERVICE_KEY) return null
  let text
  try {
    text = readFile(path)
  } catch (e) {
    return `AICORE_SERVICE_KEY_FILE: cannot read "${path}" (${e.code ?? e.message})`
  }
  try {
    env.AICORE_SERVICE_KEY = JSON.stringify(JSON.parse(String(text).replace(/^﻿/, '')))
  } catch {
    return `AICORE_SERVICE_KEY_FILE: "${path}" is not a JSON service key`
  }
  return null
}
