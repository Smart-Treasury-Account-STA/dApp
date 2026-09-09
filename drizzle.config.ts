import { defineConfig } from 'drizzle-kit'

/**
 * `out` is pinned so the migration folder is deliberate rather than defaulting
 * to `./drizzle`. `dbCredentials` is read at command time: `db:generate` needs
 * no database, `db:migrate` does.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
})
