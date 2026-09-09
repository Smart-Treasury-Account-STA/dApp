import { eq } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { Database } from '@/lib/db'
import { relayerJobs } from '@/lib/db/schema'
import { createTestDatabase } from '@/lib/db/testing'
import {
  createRelayerJob,
  getRelayerJob,
  listRelayerJobsForTreasury,
  updateRelayerJob,
  validateRelayerJobInput,
} from '@/lib/relayer/store'

/**
 * Runs against PGlite, a real Postgres in-process -- see the same note in
 * `treasuryRegistry/store.test.ts`. It matters most here: the optimistic
 * `version` check below is a claim about what Postgres does when two writers
 * race, which a hand-written double could only assert about itself.
 */
const harness = vi.hoisted(() => ({ db: null as unknown as Database }))

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getDb: () => harness.db,
}))

const SMART_ACCOUNT_ID =
  'CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ'
const SMART_ACCOUNT_ID_2 =
  'CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS'

const validInput = {
  smartAccountId: SMART_ACCOUNT_ID,
  intentId: 'a'.repeat(64),
  startLedger: 100,
  endLedger: 200,
  maxExecutions: 1,
}

let close: () => Promise<void>

beforeAll(async () => {
  const { db, client } = await createTestDatabase()
  harness.db = db
  close = () => client.close()
})

afterAll(async () => {
  await close()
})

beforeEach(async () => {
  await harness.db.delete(relayerJobs)
})

describe('validateRelayerJobInput', () => {
  it('accepts a well formed input', () => {
    expect(() => validateRelayerJobInput(validInput)).not.toThrow()
  })

  it('rejects a malformed smartAccountId', () => {
    expect(() =>
      validateRelayerJobInput({
        ...validInput,
        smartAccountId: 'not-a-contract',
      })
    ).toThrow(/smartAccountId/)
  })

  it('accepts a 0x prefixed intent id', () => {
    expect(() =>
      validateRelayerJobInput({
        ...validInput,
        intentId: `0x${'b'.repeat(64)}`,
      })
    ).not.toThrow()
  })

  it('rejects an intent id that is not 32 bytes', () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, intentId: 'abc' })
    ).toThrow('Intent ID must be 32 bytes encoded as 64 hex characters.')
  })

  it('rejects a non integer ledger bound', () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, startLedger: 1.5 })
    ).toThrow('startLedger must be a non-negative safe integer.')
  })

  it('rejects maxExecutions below one', () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, maxExecutions: 0 })
    ).toThrow('maxExecutions must be at least 1.')
  })

  it('rejects an inverted ledger window', () => {
    expect(() =>
      validateRelayerJobInput({ ...validInput, startLedger: 300 })
    ).toThrow('startLedger must be lower than endLedger.')
  })
})

describe('createRelayerJob / getRelayerJob — compound (smartAccountId, intentId) key', () => {
  it('does not collide when two different treasuries schedule the same intentId', async () => {
    const jobA = await createRelayerJob(validInput)
    const jobB = await createRelayerJob({
      ...validInput,
      smartAccountId: SMART_ACCOUNT_ID_2,
    })

    expect(jobA.smartAccountId).toBe(SMART_ACCOUNT_ID)
    expect(jobB.smartAccountId).toBe(SMART_ACCOUNT_ID_2)
    expect(await getRelayerJob(SMART_ACCOUNT_ID, validInput.intentId)).toEqual(
      jobA
    )
    expect(
      await getRelayerJob(SMART_ACCOUNT_ID_2, validInput.intentId)
    ).toEqual(jobB)
  })

  it('is idempotent per (smartAccountId, intentId), not per intentId alone', async () => {
    const first = await createRelayerJob(validInput)
    const second = await createRelayerJob(validInput)
    expect(second).toEqual(first)
  })

  it('getRelayerJob returns null for the right intentId under the wrong smartAccountId', async () => {
    await createRelayerJob(validInput)
    expect(
      await getRelayerJob(SMART_ACCOUNT_ID_2, validInput.intentId)
    ).toBeNull()
  })

  it('normalizes a 0x prefixed intent id to the stored form', async () => {
    const created = await createRelayerJob({
      ...validInput,
      intentId: `0x${'A'.repeat(64)}`,
    })
    expect(created.intentId).toBe('a'.repeat(64))
    expect(
      await getRelayerJob(SMART_ACCOUNT_ID, `0X${'a'.repeat(64)}`)
    ).toEqual(created)
  })

  it('omits txHash entirely while the column is NULL, rather than exposing null', async () => {
    const created = await createRelayerJob(validInput)
    expect('txHash' in created).toBe(false)
  })

  it('starts a job scheduled, at version 0, with no executions', async () => {
    await createRelayerJob(validInput)
    const [row] = await harness.db.select().from(relayerJobs)
    expect(row.status).toBe('scheduled')
    expect(row.version).toBe(0)
    expect(row.executionCount).toBe(0)
    expect(row.childSequence).toBe(1)
  })

  it('lets Postgres reject a status the record type does not allow', async () => {
    // The CHECK is the backstop for writers that do not go through this
    // store. Drizzle wraps driver errors, so the constraint name is on the
    // cause rather than the message.
    await createRelayerJob(validInput)

    const rejection = await harness.db
      .update(relayerJobs)
      .set({ status: 'bogus' as never })
      .where(eq(relayerJobs.intentId, validInput.intentId))
      .then(
        () => null,
        (error: unknown) => error
      )

    expect(rejection).toBeInstanceOf(Error)
    const cause = (rejection as Error).cause
    expect(String(cause instanceof Error ? cause.message : cause)).toMatch(
      /relayer_jobs_status_check/
    )

    const [row] = await harness.db.select().from(relayerJobs)
    expect(row.status).toBe('scheduled')
  })
})

describe('listRelayerJobsForTreasury', () => {
  it('returns only the jobs of the given treasury', async () => {
    await createRelayerJob(validInput)
    await createRelayerJob({
      ...validInput,
      smartAccountId: SMART_ACCOUNT_ID_2,
    })

    const jobs = await listRelayerJobsForTreasury(SMART_ACCOUNT_ID)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].smartAccountId).toBe(SMART_ACCOUNT_ID)
  })
})

describe('updateRelayerJob — optimistic concurrency', () => {
  it('loses no execution when two writers increment the same job at once', async () => {
    // The lost update a per-process write queue could not prevent: two relayer
    // runs on two serverless instances both read executionCount 0 and both
    // write 1, so one execution vanishes from the count. Both calls are in
    // flight together here, against a real Postgres, so the version check is
    // what has to catch it -- the callback may therefore run more than twice.
    await createRelayerJob(validInput)

    const increment = () =>
      updateRelayerJob(SMART_ACCOUNT_ID, validInput.intentId, (current) => ({
        ...current,
        executionCount: current.executionCount + 1,
      }))

    await Promise.all([increment(), increment()])

    const [row] = await harness.db.select().from(relayerJobs)
    expect(row.executionCount).toBe(2)
    expect(row.version).toBe(2)
  })

  it('gives up rather than looping forever when it never wins', async () => {
    await createRelayerJob(validInput)

    // A reader permanently out of date: every UPDATE it drives matches the
    // version predicate against a value no row holds, so no attempt can win.
    // Narrow on purpose -- the retry cap is this function's own logic, not a
    // claim about Postgres, so it does not need a real competing writer.
    const live = harness.db
    const staleReader = new Proxy(live, {
      get(target, property) {
        if (property !== 'select') {
          const value = Reflect.get(target, property)
          return typeof value === 'function' ? value.bind(target) : value
        }
        return () => ({
          from: () => ({
            where: async () => {
              const rows = await live.select().from(relayerJobs)
              return rows.map((row) => ({ ...row, version: row.version + 99 }))
            },
          }),
        })
      },
    }) as Database

    harness.db = staleReader
    try {
      await expect(
        updateRelayerJob(
          SMART_ACCOUNT_ID,
          validInput.intentId,
          (current) => current
        )
      ).rejects.toThrow(/modified concurrently/)
    } finally {
      harness.db = live
    }
  })

  it('throws when the job does not exist', async () => {
    await expect(
      updateRelayerJob(
        SMART_ACCOUNT_ID,
        validInput.intentId,
        (current) => current
      )
    ).rejects.toThrow('Relayer job not found.')
  })

  it('bumps the version on every successful write', async () => {
    await createRelayerJob(validInput)
    await updateRelayerJob(SMART_ACCOUNT_ID, validInput.intentId, (job) => ({
      ...job,
      status: 'ready',
    }))
    const [row] = await harness.db.select().from(relayerJobs)
    expect(row.version).toBe(1)
    expect(row.status).toBe('ready')
  })
})
