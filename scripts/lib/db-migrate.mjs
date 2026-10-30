// Brings an existing SQLite database up to the data model without losing data.
//
// `cds deploy` drops everything. This reads the SQL that the compiler produces for the model and applies only
// what is missing: new tables, new columns (added as nullable or with their default), and all views are
// rebuilt (they hold no data). Nothing is ever dropped or rewritten - columns that the model no longer has simply
// stay, so a downgrade or a rename cannot destroy anything.
//
// What it cannot do: change the type of a column, or add a NOT NULL column without a default to a table that
// has rows (the column is added as nullable instead). That is fine for TourD's own tables.

/** @returns {Array<{kind: 'table'|'view'|'other', name: string, sql: string}>} */
export function splitStatements(ddl) {
  const out = []
  for (const part of ddl.split(/;\s*(?:\r?\n|$)/)) {
    const sql = part.trim()
    if (!sql) continue
    const m = /^CREATE\s+(TABLE|VIEW)\s+("?[\w.]+"?)/i.exec(sql)
    out.push(
      m
        ? { kind: m[1].toLowerCase(), name: m[2].replace(/"/g, ''), sql }
        : { kind: 'other', name: '', sql },
    )
  }
  return out
}

const CONSTRAINT = /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i

/** Column definitions of a CREATE TABLE statement: [{name, def}] (def = everything after the name). */
export function columnsOf(createTable) {
  const open = createTable.indexOf('(')
  const close = createTable.lastIndexOf(')')
  const body = createTable.slice(open + 1, close)
  // split at top-level commas (a default like DEFAULT 'a,b' or a type like DECIMAL(9,2) must not break it)
  const parts = []
  let depth = 0
  let quote = false
  let current = ''
  for (const ch of body) {
    if (ch === "'") quote = !quote
    if (!quote && ch === '(') depth++
    if (!quote && ch === ')') depth--
    if (!quote && depth === 0 && ch === ',') {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  return parts
    .map((p) => p.trim())
    .filter((p) => p && !CONSTRAINT.test(p))
    .map((p) => {
      const m = /^("?[\w]+"?)\s+([\s\S]*)$/.exec(p)
      return { name: m[1].replace(/"/g, ''), def: m[2].trim() }
    })
}

/** ALTER TABLE cannot add NOT NULL without a default: such a column is added as nullable. */
export function addableDefinition(def) {
  const notNull = /\bNOT\s+NULL\b/i.test(def)
  const hasDefault = /\bDEFAULT\b/i.test(def)
  const cleaned = def.replace(/\bPRIMARY\s+KEY\b/i, '')
  return notNull && !hasDefault
    ? { def: cleaned.replace(/\bNOT\s+NULL\b/i, '').trim(), relaxed: true }
    : { def: cleaned.trim(), relaxed: false }
}

/**
 * @param {string} ddl compiled SQL of the model
 * @param {{tables: Map<string, Set<string>>, views: Set<string>}} existing what the database has now
 * @returns {{statements: string[], createdTables: string[], addedColumns: string[], relaxed: string[], rebuiltViews: number}}
 */
export function planMigration(ddl, existing) {
  const plan = { statements: [], createdTables: [], addedColumns: [], relaxed: [], rebuiltViews: 0 }
  const statements = splitStatements(ddl)
  for (const s of statements) {
    if (s.kind !== 'table') continue
    const have = existing.tables.get(s.name)
    if (!have) {
      plan.statements.push(s.sql)
      plan.createdTables.push(s.name)
      continue
    }
    for (const column of columnsOf(s.sql)) {
      if (have.has(column.name)) continue
      const { def, relaxed } = addableDefinition(column.def)
      plan.statements.push(`ALTER TABLE ${s.name} ADD COLUMN ${column.name} ${def}`)
      plan.addedColumns.push(`${s.name}.${column.name}`)
      if (relaxed) plan.relaxed.push(`${s.name}.${column.name}`)
    }
  }
  // views hold no data: drop what is there and create what the model says, in the model's order
  for (const name of existing.views) plan.statements.push(`DROP VIEW IF EXISTS ${name}`)
  for (const s of statements) {
    if (s.kind === 'view') {
      plan.statements.push(s.sql)
      plan.rebuiltViews++
    }
  }
  return plan
}

/** What the database has: tables with their columns, and the views. */
export function inspect(db) {
  const tables = new Map()
  const views = new Set()
  for (const row of db
    .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view')")
    .all()) {
    if (row.name.startsWith('sqlite_')) continue
    if (row.type === 'view') views.add(row.name)
    else
      tables.set(
        row.name,
        new Set(
          db
            .prepare(`PRAGMA table_info(${JSON.stringify(row.name)})`)
            .all()
            .map((c) => c.name),
        ),
      )
  }
  return { tables, views }
}

/** Applies the plan in one transaction; nothing changes if anything fails. */
export function migrate(db, ddl) {
  const plan = planMigration(ddl, inspect(db))
  db.exec('BEGIN')
  try {
    for (const sql of plan.statements) db.exec(sql)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return plan
}
