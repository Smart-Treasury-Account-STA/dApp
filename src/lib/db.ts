import { neon } from "@neondatabase/serverless";

/**
 * The single seam between this app's stores and Postgres.
 *
 * Everything above it (`treasuryRegistry/store.ts`, `relayer/store.ts`) keeps
 * its business logic in TypeScript and its public API unchanged; everything
 * below it is Neon. Tests mock this module, exactly as they previously mocked
 * `node:fs/promises` -- the boundary moved, the assertions did not.
 *
 * Deliberately the HTTP driver (`neon()`), not `Pool`/`Client`: those need a
 * WebSocket and, on Node runtimes without a global `WebSocket`, an explicit
 * `neonConfig.webSocketConstructor`. Nothing here needs a multi-statement
 * transaction -- `createTreasury` is a single atomic `INSERT ... ON CONFLICT`,
 * and `updateRelayerJob` uses the optimistic `version` check below -- so the
 * simpler driver is also the correct one, with no cold-start connection to
 * establish.
 */

/** Read at call time, not at module load: `store.ts` is imported by route
 * modules that Next.js also pulls into the build, where DATABASE_URL is not
 * necessarily present. Failing here gives a clear message at the first query
 * instead of breaking the build. */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be configured before reading or writing persisted state.",
    );
  }
  return url;
}

/**
 * Runs one parameterized statement and returns its rows.
 *
 * Always pass values through `params` -- the driver sends them out of band, so
 * a contract id or address coming from a request body can never be parsed as
 * SQL.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await neon(connectionString()).query(text, params);
  return rows as T[];
}

/** Postgres `timestamptz` comes back as a `Date`; the record types this app
 * exposes over its API use ISO strings, and have since before there was a
 * database. Converting at the seam keeps that JSON shape unchanged. */
export function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
