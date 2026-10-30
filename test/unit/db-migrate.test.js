import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  addableDefinition,
  columnsOf,
  inspect,
  migrate,
  planMigration,
  splitStatements,
} from '../../scripts/lib/db-migrate.mjs'

const OLD = `CREATE TABLE app_Items (
  ID NVARCHAR(36) NOT NULL,
  name NVARCHAR(50) NOT NULL,
  PRIMARY KEY(ID)
);

CREATE VIEW Srv_Items AS SELECT
  Items_0.ID,
  Items_0.name
FROM app_Items AS Items_0;
`

const NEW = `CREATE TABLE app_Items (
  ID NVARCHAR(36) NOT NULL,
  name NVARCHAR(50) NOT NULL,
  note NVARCHAR(200),
  status NVARCHAR(10) DEFAULT 'new',
  size INTEGER NOT NULL,
  label NVARCHAR(30) DEFAULT 'a,b (c)',
  PRIMARY KEY(ID)
);

CREATE TABLE app_Tags (
  ID NVARCHAR(36) NOT NULL,
  item_ID NVARCHAR(36) NOT NULL,
  PRIMARY KEY(ID)
);

CREATE VIEW Srv_Items AS SELECT
  Items_0.ID,
  Items_0.name,
  Items_0.note,
  Items_0.status
FROM app_Items AS Items_0;
`

const database = (ddl) => {
  const db = new DatabaseSync(':memory:')
  db.exec(ddl)
  return db
}

describe('reading the compiled SQL', () => {
  it('splits it into tables and views', () => {
    expect(splitStatements(NEW).map((s) => [s.kind, s.name])).toEqual([
      ['table', 'app_Items'],
      ['table', 'app_Tags'],
      ['view', 'Srv_Items'],
    ])
  })

  it('lists the columns of a table, not its constraints, and does not stumble over commas in types and defaults', () => {
    const items = splitStatements(NEW)[0].sql
    expect(columnsOf(items).map((c) => c.name)).toEqual([
      'ID',
      'name',
      'note',
      'status',
      'size',
      'label',
    ])
    expect(columnsOf(items).find((c) => c.name === 'label').def).toBe(
      "NVARCHAR(30) DEFAULT 'a,b (c)'",
    )
    const decimal = columnsOf(
      'CREATE TABLE t (\n  a DECIMAL(9,2) NOT NULL,\n  b INTEGER,\n  FOREIGN KEY (a) REFERENCES x(y)\n)',
    )
    expect(decimal).toEqual([
      { name: 'a', def: 'DECIMAL(9,2) NOT NULL' },
      { name: 'b', def: 'INTEGER' },
    ])
  })

  it('a column that must not be empty but has no default is added as optional', () => {
    expect(addableDefinition('INTEGER NOT NULL')).toEqual({ def: 'INTEGER', relaxed: true })
    expect(addableDefinition("NVARCHAR(5) NOT NULL DEFAULT 'x'")).toEqual({
      def: "NVARCHAR(5) NOT NULL DEFAULT 'x'",
      relaxed: false,
    })
    expect(addableDefinition('NCLOB')).toEqual({ def: 'NCLOB', relaxed: false })
  })
})

describe('migrating a database', () => {
  it('adds new tables and columns, rebuilds the views, and keeps every row', () => {
    const db = database(OLD)
    db.exec("INSERT INTO app_Items (ID, name) VALUES ('1', 'first'), ('2', 'second')")
    const plan = migrate(db, NEW)
    expect(plan.createdTables).toEqual(['app_Tags'])
    expect(plan.addedColumns).toEqual([
      'app_Items.note',
      'app_Items.status',
      'app_Items.size',
      'app_Items.label',
    ])
    expect(plan.relaxed).toEqual(['app_Items.size'])

    const rows = db.prepare('SELECT ID, name, note, status, label FROM app_Items ORDER BY ID').all()
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { ID: '1', name: 'first', note: null, status: 'new', label: 'a,b (c)' }, // defaults fill the old rows
      { ID: '2', name: 'second', note: null, status: 'new', label: 'a,b (c)' },
    ])
    // the view sees the new columns
    expect(Object.keys(db.prepare('SELECT * FROM Srv_Items').get())).toEqual([
      'ID',
      'name',
      'note',
      'status',
    ])
    expect(db.prepare('SELECT count(*) AS n FROM app_Tags').get().n).toBe(0)
  })

  it('does nothing the second time', () => {
    const db = database(OLD)
    migrate(db, NEW)
    const again = planMigration(NEW, inspect(db))
    expect(again.createdTables).toEqual([])
    expect(again.addedColumns).toEqual([])
  })

  it('leaves columns and tables the model no longer has alone', () => {
    const db = database(NEW + '\nCREATE TABLE app_Legacy (ID NVARCHAR(36));')
    db.exec("INSERT INTO app_Legacy (ID) VALUES ('x')")
    migrate(db, OLD)
    expect(db.prepare('SELECT count(*) AS n FROM app_Legacy').get().n).toBe(1)
    expect([...inspect(db).tables.get('app_Items')]).toContain('note')
  })

  it('is all or nothing: a broken statement changes nothing', () => {
    const db = database(OLD)
    expect(() => migrate(db, NEW + '\nCREATE VIEW Broken AS SELECT FROM;')).toThrow()
    expect([...inspect(db).tables.get('app_Items')]).toEqual(['ID', 'name'])
    expect(inspect(db).tables.has('app_Tags')).toBe(false)
  })
})

describe('the real model', () => {
  it('can be applied over a database that lacks one of its tables and one of its columns', () => {
    const ddl = execFileSync(
      process.execPath,
      ['node_modules/@sap/cds-dk/bin/cds.js', 'compile', 'db', 'srv', '--to', 'sql'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    expect(inspect(database(ddl)).tables.has('tourd_Projects')).toBe(true)

    // an older database: no extension tokens, no "description" column of projects
    const without = (re, text) => {
      expect(text).toMatch(re)
      return text.replace(re, '')
    }
    let older = without(/CREATE TABLE tourd_ExtensionTokens \([\s\S]*?\n\);\n/, ddl)
    older = without(/CREATE VIEW TourService_ExtensionTokens[\s\S]*?;\n/, older)
    older = without(/CREATE VIEW TourService_Projects[\s\S]*?;\n/, older)
    older = without(/ {2}description NVARCHAR\(500\),\n/, older)
    const old = database(older)
    old.exec("INSERT INTO tourd_Projects (ID, name) VALUES ('p1', 'kept')")
    const plan = migrate(old, ddl)
    expect(plan.createdTables).toEqual(['tourd_ExtensionTokens'])
    expect(plan.addedColumns).toEqual(['tourd_Projects.description'])
    expect(old.prepare('SELECT name, description FROM tourd_Projects').get()).toMatchObject({
      name: 'kept',
      description: null,
    })
    expect(old.prepare('SELECT count(*) AS n FROM TourService_Projects').get().n).toBe(1)
  })
})
