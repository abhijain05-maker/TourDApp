// Prepares the local SQLite database without ever silently destroying data.
//
// `cds deploy --to sqlite:<file>` drops and recreates the database, so running it on every start
// would wipe all tours. This script therefore
//   - creates the database when the file does not exist yet,
//   - leaves it alone when the compiled schema is unchanged since the last start,
//   - MIGRATES it when the model changed: new tables and columns are added, nothing is dropped, all data stays
//     (the old file is copied to a .bak first, in case something goes wrong),
//   - starts from an empty database only on request (TOURD_DB_RESET=1, the old file is backed up) or when a
//     migration is impossible.
// SQLite here is the local/dev store; for productive use deploy to HANA, where HDI evolves the schema.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from './lib/db-migrate.mjs'

const DB = process.env.TOURD_DB_FILE ?? 'db.sqlite'
const STAMP = `${DB}.schema`
const cds = ['node_modules/@sap/cds-dk/bin/cds.js']
const run = (args) =>
  execFileSync(process.execPath, [...cds, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  })

const ddl = run(['compile', 'db', 'srv', '--to', 'sql'])
const hash = createHash('sha256').update(ddl).digest('hex')
const known = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : null
const force = process.env.TOURD_DB_RESET === '1'

if (existsSync(DB) && known === hash && !force) {
  console.log(`[tourd] ${DB} is up to date - data kept`)
  process.exit(0)
}

const backup = () => {
  const file = `${DB}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
  copyFileSync(DB, file)
  return file
}
const removeDb = () => {
  for (const f of [DB, `${DB}-shm`, `${DB}-wal`]) if (existsSync(f)) unlinkSync(f)
}

if (existsSync(DB) && !force) {
  // the model changed: bring the existing database up to date instead of throwing it away
  const saved = backup()
  const db = new DatabaseSync(DB)
  try {
    const plan = migrate(db, ddl)
    db.close()
    writeFileSync(STAMP, hash + '\n')
    const what = [
      plan.createdTables.length ? `new tables: ${plan.createdTables.join(', ')}` : '',
      plan.addedColumns.length ? `new columns: ${plan.addedColumns.join(', ')}` : '',
    ].filter(Boolean)
    console.log(
      `[tourd] the data model changed: updated ${DB}, all data kept${what.length ? ` (${what.join('; ')})` : ''}; a copy of the old file is ${saved}`,
    )
    process.exit(0)
  } catch (e) {
    try {
      db.close()
    } catch {
      /* already closed */
    }
    console.warn(
      `[tourd] the database could not be updated (${e.message}); starting with an empty one - the old data is in ${saved}`,
    )
    removeDb()
  }
} else if (existsSync(DB)) {
  console.warn(`[tourd] reset requested: backed up the old database to ${backup()}`)
  removeDb()
}

run(['deploy', '--to', `sqlite:${DB}`])
writeFileSync(STAMP, hash + '\n')
console.log(`[tourd] deployed the schema to ${DB}`)
