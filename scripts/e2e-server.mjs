// Starts the TourD server for the Playwright tests on a throwaway database (db.e2e.sqlite),
// so test runs never read or change the real db.sqlite.
import { spawn } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'

const DB = 'db.e2e.sqlite'
for (const f of [DB, `${DB}-shm`, `${DB}-wal`, `${DB}.schema`]) if (existsSync(f)) unlinkSync(f)

// no AI keys from a .env file: the tests expect "no provider configured" and mock the model calls themselves
const env = {
  ...process.env,
  TOURD_DB_FILE: DB,
  CDS_REQUIRES_DB_CREDENTIALS_URL: DB,
  GEMINI_API_KEY: '',
  AICORE_SERVICE_KEY: '',
}
const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['start'], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
const stop = () => child.kill()
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.on('exit', (code) => process.exit(code ?? 0))
