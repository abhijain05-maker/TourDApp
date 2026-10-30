// Builds what runs on Cloud Foundry: gen/srv (the server) and gen/db (the HDI deployer). `cds build --production`
// produces the model and the server code; this adds what the server reads at run time (the player, the sandbox page,
// the shared modules, the built designer) and trims the package.json to what a deployment needs.
// Run: npm run build:cf   (the npm script builds the designer, the player and the extension first)
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const at = (p) => root + p

const build = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['cds', 'build', '--production'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (build.status !== 0) process.exit(build.status ?? 1)

for (const dir of ['player', 'sandbox', 'shared'])
  cpSync(at(dir), at(`gen/srv/${dir}`), { recursive: true })
if (!existsSync(at('app/designer/index.html'))) {
  console.error('app/designer is not built: run npm run build:designer first')
  process.exit(1)
}
mkdirSync(at('gen/srv/app'), { recursive: true })
cpSync(at('app'), at('gen/srv/app'), { recursive: true })

// files of the project root that cds build copies along and a deployment does not need
for (const f of ['playwright.config.js', 'vitest.config.js', 'vitest.live.config.js', 'vitest.wdi5.config.js'])
  rmSync(at(`gen/srv/${f}`), { force: true })

const pkg = JSON.parse(readFileSync(at('gen/srv/package.json'), 'utf8'))
pkg.scripts = { start: 'cds-serve' } // no local database deployment, no test runners
delete pkg.devDependencies
writeFileSync(at('gen/srv/package.json'), JSON.stringify(pkg, null, 2) + '\n')
console.log('built gen/srv (server + player + sandbox + designer) and gen/db (HDI deployer)')
