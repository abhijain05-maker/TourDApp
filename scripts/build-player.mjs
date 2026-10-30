// Copies player/TourPlayer.js to where it is served from: the CAP app folder (sandbox / live preview) and the demo
// app (as its tourd/ module, exactly like an exported bundle). player/HelpLayer.js is served by the server from
// player/ itself and shipped to apps by "Add the help to the project", so it only gets a copy next to the player
// in the CAP app folder. Run: npm run build:player
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const copies = [
  ['player/TourPlayer.js', 'app/player/TourPlayer.js'],
  ['player/TourPlayer.js', 'samples/demo-app/webapp/tourd/TourPlayer.js'],
  ['player/HelpLayer.js', 'app/player/HelpLayer.js'],
]
for (const [from, to] of copies) {
  mkdirSync(dirname(root + to), { recursive: true })
  copyFileSync(root + from, root + to)
  console.log('copied ->', to)
}
