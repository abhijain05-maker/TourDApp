// The readiness scan: reads the files of a project and lists what the project depends on (destinations, services,
// roles, Work Zone content, process automation, BTP services, configuration), with the findings that can be seen in the
// files alone. It does not talk to any system. People check the list; a later live check can add its own findings.
//
// HOW TO ADD A CHECK
//   1. Write an extractor in extractors/: { id, phase: 'extract' | 'check', run(ctx) } (see context.js for ctx.add / ctx.signal).
//   2. Put it in EXTRACTORS below. A new category goes into categories.js. The designer needs no change.
//   3. Add a test in test/unit/readiness-*.test.js with a small project in test/fixtures/readiness/.
import { createHash } from 'node:crypto'
import { createContext } from './context.js'
import { CATEGORIES, LEVELS, STATUSES } from './categories.js'
import apis from './extractors/apis.js'
import auth from './extractors/auth.js'
import bpa from './extractors/bpa.js'
import btp from './extractors/btp.js'
import checks from './extractors/checks.js'
import config from './extractors/config.js'
import destinations from './extractors/destinations.js'
import workzone from './extractors/workzone.js'

export const EXTRACTORS = [btp, destinations, apis, auth, workzone, bpa, config, checks]

const PHASES = ['extract', 'check']

/** Files the scan reads: text files only, and not the ones that only hold clutter. */
export const isScanned = (path) =>
  /\.(json|ya?ml|mtaext|cds|edmx|xml|js|mjs|cjs|ts|bpmn|properties)$/.test(path)

/** Changes when any scanned file changes; the designer uses it to say "scan again". */
export function stampOf(files) {
  const h = createHash('sha256')
  for (const f of [...files]
    .filter((f) => isScanned(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : 1)))
    h.update(`${f.path}\0${f.hash ?? f.content?.length}\0`)
  return h.digest('hex')
}

/**
 * @param {Array<{path: string, content: string}>} files
 * @param {{extractors?: typeof EXTRACTORS}} [options]
 * @returns {{items: object[], warnings: object[], files: number}}
 */
export function scan(files, { extractors = EXTRACTORS } = {}) {
  const used = files.filter((f) => typeof f.content === 'string' && isScanned(f.path))
  const ctx = createContext(used)
  const ordered = [...extractors].sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase))
  for (const x of ordered) {
    try {
      x.run(ctx)
    } catch (e) {
      // one broken extractor must not hide what the others found
      ctx.warn(
        'extractor-failed',
        `The check "${x.id}" stopped (${e.message}); its results are missing.`,
      )
    }
  }
  return { items: ctx.finish(), warnings: ctx.warnings, files: used.length }
}

/** The worst finding of an item: error, warning, info, ok; '' when the scan said nothing. */
export function levelOf(signals) {
  for (const l of LEVELS) if (signals?.some((s) => s.level === l)) return l
  return ''
}

/** What the designer needs to draw itself: it builds its screens from this, not from a fixed list. */
export const meta = () => ({ categories: CATEGORIES, statuses: STATUSES, levels: LEVELS })
