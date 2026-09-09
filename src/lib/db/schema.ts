import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

import type { RelayerJobRecord } from '@/lib/relayer/types'

/**
 * The two persisted stores, as Drizzle tables.
 *
 * This file is the single source of truth for the database shape: migrations
 * are generated from it (`pnpm db:generate`) and the stores query through it,
 * so a column can no longer exist in one place and not the other. Before it,
 * the DDL lived only in the Neon console and a new database came up empty --
 * which is how production started answering
 * `relation "treasuries" does not exist`.
 *
 * Constraint and index names are pinned to the ones already live on both
 * branches, so generating from this schema describes the existing databases
 * rather than proposing to rename half of them.
 */

/** Treasuries registered through the deploy wizard. */
export const treasuries = pgTable(
  'treasuries',
  {
    smartAccountId: text('smart_account_id').primaryKey(),
    policyEngineId: text('policy_engine_id').notNull(),
    intentRegistryId: text('intent_registry_id').notNull(),
    recoveryManagerId: text('recovery_manager_id').notNull(),
    transferAdapterId: text('transfer_adapter_id').notNull(),
    splitAdapterId: text('split_adapter_id').notNull(),
    ownerAddress: text('owner_address').notNull(),
    executorAddress: text('executor_address').notNull(),
    deployTxHash: text('deploy_tx_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Covers the only filtered read the API makes.
    //
    // `nullsFirst` is Postgres's own default for DESC, so it renders back as
    // a plain `DESC` and matches the indexes already live on both branches.
    // Drizzle would otherwise emit `DESC NULLS LAST`, a different index on
    // paper -- harmless here, since the column is NOT NULL, but enough to
    // make every schema diff report drift forever.
    index('treasuries_owner_address_created_at_idx').on(
      table.ownerAddress,
      table.createdAt.desc().nullsFirst()
    ),
  ]
)

/**
 * Scheduled-payment jobs the relayer executes.
 *
 * The primary key is composite because a job's identity is
 * (smart_account_id, intent_id): two treasuries can pick colliding intent ids,
 * and a single-key model would silently merge them.
 *
 * Ledger numbers are `integer`, not `bigint`, on purpose. A Stellar ledger
 * sequence is a u32, and the driver hands back int8 as a string, which would
 * break the `number`-typed fields these columns feed.
 */
export const relayerJobs = pgTable(
  'relayer_jobs',
  {
    smartAccountId: text('smart_account_id').notNull(),
    intentId: text('intent_id').notNull(),
    childSequence: integer('child_sequence').notNull(),
    startLedger: integer('start_ledger').notNull(),
    endLedger: integer('end_ledger').notNull(),
    maxExecutions: integer('max_executions').notNull(),
    executionCount: integer('execution_count').notNull().default(0),
    // Typed against the record the API exposes, and constrained in the
    // database by the CHECK below, so an unknown status cannot be stored
    // whether it arrives through this app or any other client.
    status: text('status').$type<RelayerJobRecord['status']>().notNull(),
    note: text('note').notNull(),
    txHash: text('tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Drives the optimistic concurrency in `updateRelayerJob`: the UPDATE
    // matches on the version it read, so a writer overtaken by another
    // serverless instance updates no row and re-applies instead of losing an
    // execution.
    version: integer('version').notNull().default(0),
  },
  (table) => [
    primaryKey({
      name: 'relayer_jobs_pkey',
      columns: [table.smartAccountId, table.intentId],
    }),
    check(
      'relayer_jobs_status_check',
      sql`${table.status} = ANY (ARRAY['scheduled'::text, 'ready'::text, 'executing'::text, 'executed'::text, 'blocked'::text, 'failed'::text])`
    ),
    index('relayer_jobs_updated_at_idx').on(
      table.updatedAt.desc().nullsFirst()
    ),
  ]
)
