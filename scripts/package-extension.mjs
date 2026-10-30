// Packs the extension into extension-dist/tourd-recorder-<version>.zip, ready to share with colleagues
// (they unzip it and "Load unpacked", or IT distributes it by policy). Run: npm run package:extension
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const root = fileURLToPath(new URL('..', import.meta.url))
await import('./build-extension.mjs')

const dir = join(root, 'extension')
const files = {}
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const full = join(d, name)
    if (statSync(full).isDirectory()) walk(full)
    else files[relative(dir, full).split(sep).join('/')] = readFileSync(full)
  }
}
walk(dir)
files['README.txt'] = strToU8(
  [
    'TourD Recorder',
    '',
    '1. Unzip this folder.',
    '2. Open chrome://extensions (or edge://extensions) and switch on Developer mode.',
    '3. Choose "Load unpacked" and select the unzipped folder.',
    '4. In TourD, open "Browser extension", create a token and paste it into the extension\'s settings (the gear).',
    '',
  ].join('\n'),
)

const version = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version
mkdirSync(join(root, 'extension-dist'), { recursive: true })
const out = join(root, 'extension-dist', `tourd-recorder-${version}.zip`)
writeFileSync(out, zipSync(files, { level: 9, mtime: new Date('2026-01-01T00:00:00Z') }))
console.log(`wrote extension-dist/tourd-recorder-${version}.zip (${Object.keys(files).length} files)`)
