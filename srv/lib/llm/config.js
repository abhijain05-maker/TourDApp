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
