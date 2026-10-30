// Hand-over of the project's files: what changed (as a zip to unzip over the project, or as a patch), or all of it.
import { strToU8, zipSync } from 'fflate'
import { createTwoFilesPatch } from 'diff'
import { baseOf, statusOf } from '../service/workspace.js'
import { slugOf } from './bundle.js'

const bytes = (r) =>
  r.binary ? new Uint8Array(Buffer.from(r.content ?? '', 'base64')) : strToU8(r.content ?? '')

const FIXED_TIME = new Date('2026-01-01T00:00:00Z') // the same input gives the same bytes

/** Rows of the Sources table sorted into { added, modified, deleted, unchanged }. */
export function classify(rows) {
  const out = { added: [], modified: [], deleted: [], unchanged: [] }
  for (const r of [...rows].sort((a, b) => (a.path < b.path ? -1 : 1))) out[statusOf(r)].push(r)
  return out
}

const list = (rows) => (rows.length ? rows.map((r) => `- \`${r.path}\``).join('\n') : '_none_')

function changesText(name, c) {
  return [
    `# Changes to ${name}`,
    '',
    'Unzip this over the folder of your project (the one that contains the files listed below) and confirm that',
    'existing files are replaced. Then delete the files listed under "Remove".',
    '',
    `## New files (${c.added.length})`,
    list(c.added),
    '',
    `## Changed files (${c.modified.length})`,
    list(c.modified),
    '',
    `## Remove (${c.deleted.length})`,
    list(c.deleted),
    '',
  ].join('\n')
}

/** @returns {{filename: string, zip: Uint8Array, counts: object}} only new and changed files, plus CHANGES.md */
export function buildChangesZip(rows, projectName) {
  const c = classify(rows)
  const files = { 'CHANGES.md': strToU8(changesText(projectName, c)) }
  for (const r of [...c.added, ...c.modified]) files[r.path] = bytes(r)
  return {
    filename: `${slugOf(projectName)}-changes.zip`,
    zip: zipSync(files, { level: 6, mtime: FIXED_TIME }),
    counts: { added: c.added.length, modified: c.modified.length, deleted: c.deleted.length },
  }
}

/** @returns {{filename: string, zip: Uint8Array}} the whole project as it is now (without removed files) */
export function buildFullZip(rows, projectName) {
  const c = classify(rows)
  const files = {}
  for (const r of [...c.added, ...c.modified, ...c.unchanged]) files[r.path] = bytes(r)
  return {
    filename: `${slugOf(projectName)}.zip`,
    zip: zipSync(files, { level: 6, mtime: FIXED_TIME }),
  }
}

const NL = String.fromCharCode(10)
const withoutHeader = (patch) =>
  patch
    .split(NL)
    .filter((line, i) => !(i < 2 && (line.startsWith('Index: ') || /^={20,}$/.test(line))))
    .join(NL)
const unified = (oldName, newName, before, after) =>
  withoutHeader(createTwoFilesPatch(oldName, newName, before, after, '', '', { context: 3 }))

/** A unified patch (git style) of every change; binary files are only mentioned. */
export function buildPatch(rows) {
  const c = classify(rows)
  const parts = []
  for (const r of [...c.added, ...c.modified, ...c.deleted]) {
    const head = `diff --git a/${r.path} b/${r.path}${NL}`
    if (r.binary) {
      parts.push(`${head}Binary files a/${r.path} and b/${r.path} differ${NL}`)
    } else if (r.deleted) {
      parts.push(
        `${head}deleted file mode 100644${NL}` +
          unified(`a/${r.path}`, '/dev/null', baseOf(r) ?? '', ''),
      )
    } else if (!r.baseHash) {
      parts.push(
        `${head}new file mode 100644${NL}` +
          unified('/dev/null', `b/${r.path}`, '', r.content ?? ''),
      )
    } else {
      parts.push(head + unified(`a/${r.path}`, `b/${r.path}`, baseOf(r) ?? '', r.content ?? ''))
    }
  }
  return parts.join('')
}
