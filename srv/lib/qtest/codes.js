// Human readable ids: REQ-001, TC-001. The number grows per project and is never reused, even when the item is deleted
// (a deleted TC-007 stays deleted in reports and in the title of an automated test).
export const PREFIX = { requirement: 'REQ', testCase: 'TC' }

export const formatCode = (prefix, n) => `${prefix}-${String(n).padStart(3, '0')}`

const SHAPE = /^([A-Za-z]{2,8})[-_ ]?(\d{1,7})$/

/** "tc 7", "TC_007", "tc-7" -> { code: "TC-007", seq: 7 } for the prefix; null when it is not a code of this kind. */
export function parseCode(value, prefix) {
  const m = SHAPE.exec(String(value ?? '').trim())
  if (!m || m[1].toUpperCase() !== prefix) return null
  const seq = Number(m[2])
  return seq > 0 ? { code: formatCode(prefix, seq), seq } : null
}

/** Finds codes of a kind inside free text (a test title of an automated run). */
export function findCodes(text, prefix) {
  const out = []
  for (const m of String(text ?? '').matchAll(new RegExp(`\\b${prefix}[-_ ]?(\\d{1,7})\\b`, 'gi')))
    out.push(formatCode(prefix, Number(m[1])))
  return out
}
