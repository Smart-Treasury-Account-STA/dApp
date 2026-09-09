import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import * as schema from '@/lib/db/schema'

/**
 * An empty Postgres for one test file, migrated from the same files that
 * migrate production.
 *
 * PGlite is a real Postgres compiled to WASM: in-process, no server, no
 * network. That matters because the previous store tests mocked `@/lib/db`
 * with hand-written doubles that matched on SQL text, so they proved the
 * store's logic but could not prove its SQL -- the SQL was checked once by
 * hand against Neon and then the check was deleted. A schema drift was
 * therefore invisible to CI, which is how production reached
 * `relation "treasuries" does not exist`.
 */
export async function createTestDatabase() {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: './src/lib/db/migrations' })
  return { db, client }
}
