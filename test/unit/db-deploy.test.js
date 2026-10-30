import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'

// scripts/db-deploy.mjs must never wipe an existing database just because the server restarts.
const dir = mkdtempSync(join(tmpdir(), 'tourd-db-'))
const file = join(dir, 'test.sqlite')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const deploy = (env = {}) => {
  const r = spawnSync(process.execPath, ['scripts/db-deploy.mjs'], {
    env: { ...process.env, TOURD_DB_FILE: file, ...env },
    encoding: 'utf8',
  })
  if (r.status !== 0) throw new Error(r.stderr || 'db-deploy failed')
  return r.stdout + r.stderr // the backup notice goes to stderr
}
const projects = () => {
  const db = new DatabaseSync(file)
  try {
    return db
      .prepare('select name from tourd_Projects')
      .all()
      .map((r) => r.name)
  } finally {
    db.close()
  }
}
const insert = () => {
  const db = new DatabaseSync(file)
  db.exec("insert into tourd_Projects (ID, name) values ('p1', 'keep me')")
  db.close()
}
const backups = () => readdirSync(dir).filter((f) => f.endsWith('.bak'))

describe('db-deploy', () => {
  it('creates the schema on first start', () => {
    expect(deploy()).toContain('deployed the schema')
    expect(projects()).toEqual([])
  })

  it('keeps the data on every later start while the model is unchanged', () => {
    insert()
    expect(deploy()).toContain('data kept')
    expect(deploy()).toContain('data kept')
    expect(projects()).toEqual(['keep me'])
    expect(backups()).toEqual([])
  })

  it('brings an older database up to the model after a change and keeps all data', () => {
    // make the database look like one from before the model got the table of extension tokens
    const db = new DatabaseSync(file)
    db.exec('drop table tourd_ExtensionTokens')
    db.close()
    writeFileSync(`${file}.schema`, 'outdated\n')
    const out = deploy()
    expect(out).toContain('all data kept')
    expect(out).toContain('new tables: tourd_ExtensionTokens')
    expect(projects()).toEqual(['keep me'])
    expect(backups()).toHaveLength(1) // a copy of the old file, just in case
    expect(deploy()).toContain('data kept') // and from now on it is up to date
    const check = new DatabaseSync(file)
    expect(check.prepare('select count(*) as n from tourd_ExtensionTokens').get().n).toBe(0)
    check.close()
  })

  it('starts from an empty database, with a backup, when a reset is requested explicitly', () => {
    expect(deploy({ TOURD_DB_RESET: '1' })).toContain('reset requested')
    expect(projects()).toEqual([])
    expect(backups()).toHaveLength(2)
  })
})
