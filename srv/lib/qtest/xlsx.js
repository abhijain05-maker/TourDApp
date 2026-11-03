// A small .xlsx writer and reader: enough for tables of text (what a test book is), nothing more. A workbook is a zip of
// XML files; text goes in as inline strings, so no shared-string table is needed to write. The reader also understands
// shared strings, because Excel itself writes them.
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

// characters XML 1.0 cannot carry
const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
const esc = (s) =>
  String(s ?? '')
    .replace(BAD, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function columnName(index) {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const safeSheetName = (name, used) => {
  let base = String(name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let n = 2
  let out = base
  while (used.has(out.toLowerCase())) out = `${base.slice(0, 28)} ${n++}`
  used.add(out.toLowerCase())
  return out
}

function sheetXml({ rows, widths = [] }) {
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : ''
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null || v === undefined || v === '') return ''
          const ref = `${columnName(c)}${r + 1}`
          const style = r === 0 ? ' s="1"' : ' s="2"'
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  const width = Math.max(1, ...rows.map((r) => r.length))
  const filter = rows.length > 1 ? `<autoFilter ref="A1:${columnName(width - 1)}${rows.length}"/>` : ''
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    cols +
    `<sheetData>${body}</sheetData>${filter}</worksheet>`
  )
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF0A6ED1"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>` +
  `</styleSheet>`

/**
 * @param {{name: string, rows: (string|number|null)[][], widths?: number[]}[]} sheets   the first row is the header
 * @returns {Uint8Array} the file
 */
export function writeXlsx(sheets) {
  const used = new Set()
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, used) }))
  const files = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        named
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        named
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
  }
  named.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))))
  return zipSync(files, { level: 6 })
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // keep "007" a text
  trimValues: false,
  isArray: (name) => ['sheet', 'Relationship', 'row', 'c', 'si', 'r'].includes(name),
})

/** Text of an <si> / <is>: a plain <t> or several rich-text runs. */
function textOf(node) {
  if (node === undefined || node === null) return ''
  if (typeof node === 'string') return node
  const t = node.t
  const own = t === undefined ? '' : typeof t === 'object' ? (t['#text'] ?? '') : String(t)
  const runs = (node.r ?? []).map((r) => textOf(r)).join('')
  return own + runs
}

/**
 * @param {Uint8Array|Buffer} bytes
 * @returns {{name: string, rows: string[][]}[]}
 */
export function readXlsx(bytes) {
  let zip
  try {
    zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  } catch {
    throw new Error('The file is not a valid .xlsx workbook')
  }
  const read = (path) => (zip[path] ? parser.parse(strFromU8(zip[path])) : null)
  const workbook = read('xl/workbook.xml')
  if (!workbook?.workbook?.sheets) throw new Error('The file is not a valid .xlsx workbook')
  const rels = new Map(
    (read('xl/_rels/workbook.xml.rels')?.Relationships?.Relationship ?? []).map((r) => [r['@_Id'], r['@_Target']]),
  )
  const strings = (read('xl/sharedStrings.xml')?.sst?.si ?? []).map(textOf)
  const sheets = []
  for (const s of workbook.workbook.sheets.sheet ?? []) {
    const target = rels.get(s['@_r:id']) ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const doc = read(path)
    const rows = []
    for (const row of doc?.worksheet?.sheetData?.row ?? []) {
      const cells = []
      for (const c of row.c ?? []) {
        const index = c['@_r'] ? columnIndex(c['@_r']) : cells.length
        const type = c['@_t']
        let value = ''
        if (type === 'inlineStr') value = textOf(c.is)
        else if (type === 's') value = strings[Number(c.v)] ?? ''
        else if (c.v !== undefined) value = typeof c.v === 'object' ? String(c.v['#text'] ?? '') : String(c.v)
        if (type === 'b') value = value === '1' ? 'TRUE' : 'FALSE'
        cells[index] = value.replace(/\r\n?/g, '\n')
      }
      const r = Number(row['@_r'] ?? rows.length + 1) - 1
      while (rows.length < r) rows.push([])
      rows[r] = Array.from(cells, (v) => v ?? '')
    }
    while (rows.length && rows[rows.length - 1].every((v) => !String(v).trim())) rows.pop()
    sheets.push({ name: String(s['@_name'] ?? ''), rows })
  }
  return sheets
}
