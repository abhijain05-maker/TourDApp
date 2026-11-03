// CSV the way Excel and test tools write it: quoted fields with line breaks, "" for a quote, comma or semicolon or tab.

export function detectDelimiter(text) {
  const first = String(text).split(/\r?\n/, 1)[0] ?? ''
  const count = (ch) => first.split(ch).length - 1
  const best = [',', ';', '\t'].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : ','
}

/** @returns {string[][]} rows (a completely empty line is skipped) */
export function parseCsv(input, delimiter) {
  const text = String(input ?? '').replace(/^﻿/, '')
  const d = delimiter ?? detectDelimiter(text)
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    if (row.some((v) => v.trim() !== '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === d) endField()
    else if (ch === '\n') endRow()
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
    } else field += ch
  }
  if (field !== '' || row.length) endRow()
  return rows
}

const cell = (v) => {
  const s = String(v ?? '')
  return /[",\n\r;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** With a byte order mark, so Excel reads the text as UTF-8. */
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
