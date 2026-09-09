// Applies any not-yet-applied migration in src/lib/db/migrations to the
// database DATABASE_URL points at. Run with `pnpm db:migrate`.
//
// Uses drizzle-orm's own migrator rather than `drizzle-kit migrate` so it
// shares the exact journal bookkeeping with `db:baseline`, which has to
// record a migration as applied without running it.
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'

import { MIGRATIONS_FOLDER, requireDatabaseUrl } from './db-shared.mjs'

const db = drizzle(requireDatabaseUrl())
await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
console.log('Migrations applied.')
