import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SKIP = new Set(['node_modules', 'TourPlayer.js', 'tour.json'])

/** Loads a folder as [{ path, content }] with forward-slash paths relative to `base`. */
export function loadSources(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...loadSources(full, base))
    else
      out.push({
        path: relative(base, full).split(sep).join('/'),
        content: readFileSync(full, 'utf8'),
      })
  }
  return out
}

export const demoSources = () => loadSources('samples/demo-app', 'samples/demo-app')
export const messySources = () => loadSources('test/fixtures/messy-app', 'test/fixtures/messy-app')
