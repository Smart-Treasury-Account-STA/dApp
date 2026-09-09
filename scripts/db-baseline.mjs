// Records every existing migration as already applied, without running it.
// Run with `pnpm db:baseline`.
//
// Needed exactly once per database that predates Drizzle. Both Neon branches
// were created from hand-written DDL, so their tables already exist while the
// journal is empty; `drizzle-kit generate` emits plain `CREATE TABLE`, so a
// first `db:migrate` there would fail on "relation already exists". This
// writes the journal rows the migrator would have written, using drizzle's
// own `readMigrationFiles` so the hashes match what `db:migrate` will look
// for. It is idempotent, and it never touches application tables.
//
// A database that does NOT predate Drizzle needs `db:migrate`, not this.
import { neon } from '@neondatabase/serverless'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import { MIGRATIONS_FOLDER, requireDatabaseUrl } from './db-shared.mjs'

const query = neon(requireDatabaseUrl())

// Same shape the migrator creates, so it recognises these rows as its own.
await query.query('CREATE SCHEMA IF NOT EXISTS "drizzle"')
await query.query(
  `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
     id SERIAL PRIMARY KEY,
     hash text NOT NULL,
     created_at bigint
   )`
)

const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
let recorded = 0

for (const migration of migrations) {
  const existing = await query.query(
    'SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = $1',
    [migration.hash]
  )
  if (existing.length > 0) {
    console.log(`skip  ${migration.hash.slice(0, 12)} already recorded`)
    continue
  }
  await query.query(
    'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
    [migration.hash, migration.folderMillis]
  )
  recorded += 1
  console.log(`ok    ${migration.hash.slice(0, 12)} recorded as applied`)
}

console.log(
  `\n${recorded} migration(s) recorded, ${migrations.length - recorded} already present.`
)
