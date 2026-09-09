import type { ExtractTablesWithRelations } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import * as schema from '@/lib/db/schema'

export * from '@/lib/db/schema'

/**
 * The portable Postgres surface the stores are written against, rather than
 * the Neon HTTP client's own type.
 *
 * Everything here is plain Drizzle: no `batch`, no `$withAuth`, nothing
 * driver-specific. Naming that explicitly is what lets the tests hand the
 * stores a PGlite database and have the compiler agree it is the same
 * contract, instead of casting the difference away.
 */
export type Database = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

/**
 * The single seam between this app's stores and Postgres.
 *
 * Drizzle over `@neondatabase/serverless`'s HTTP driver. HTTP rather than
 * `Pool`/`Client` on purpose: those need a WebSocket and, on Node runtimes
 * without a global `WebSocket`, an explicit `neonConfig.webSocketConstructor`.
 * Nothing here needs a multi-statement transaction -- `createTreasury` is a
 * single `INSERT ... ON CONFLICT`, and `updateRelayerJob` uses an optimistic
 * `version` check -- so the simpler driver is also the correct one, with no
 * cold-start connection to establish.
 *
 * Tests replace this module with a PGlite-backed Drizzle instance built from
 * the same schema, so they exercise the real SQL against a real Postgres
 * engine instead of a hand-written double. See `src/lib/db/testing.ts`.
 */

let instance: Database | null = null

/**
 * The Drizzle client, built on first use rather than at module load.
 *
 * A function, not an exported instance: route modules that Next.js pulls into
 * the build import the stores, and DATABASE_URL is not necessarily present
 * there. Constructing eagerly would fail the build; this fails at the first
 * query with a message that says what is missing. It is also the seam tests
 * replace, which is far easier to do with one function than with a live
 * client object.
 */
export function getDb(): Database {
  if (instance) return instance
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL must be configured before reading or writing persisted state.'
    )
  }
  instance = drizzle(url, { schema })
  return instance
}

/** Postgres `timestamptz` comes back as a `Date`; the record types this app
 * exposes over its API use ISO strings, and have since before there was a
 * database. Converting at the seam keeps that JSON shape unchanged. */
export function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}
