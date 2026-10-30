// Prepares the browser extension (extension/): copies the recorder and builds the player and help modules it injects.
// Then "Load unpacked" the extension/ folder in chrome://extensions (or edge://extensions).
// Run: npm run build:extension
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { helpAsPredefine, playerAsPredefine } from '../shared/live-snippet.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
copyFileSync(root + 'recorder/recorder.js', root + 'extension/recorder.js')
copyFileSync(root + 'recorder/replay.js', root + 'extension/replay.js')
writeFileSync(
  root + 'extension/live-player.js',
  playerAsPredefine(readFileSync(root + 'player/TourPlayer.js', 'utf8')),
)
// the help layer finds its controls with the player: both are injected, the player first
writeFileSync(
  root + 'extension/live-help.js',
  helpAsPredefine(readFileSync(root + 'player/HelpLayer.js', 'utf8')),
)
console.log(
  'built extension/recorder.js, extension/replay.js, extension/live-player.js and extension/live-help.js',
)
