import { describe, expect, it } from 'vitest'

import {
  indexJobsByIntent,
  normalizeIntentId,
} from '@/lib/relayer/queuedIntents'
import type { RelayerJobRecord } from '@/lib/relayer/types'

const INTENT = 'a'.repeat(64)

function job(overrides: Partial<RelayerJobRecord> = {}): RelayerJobRecord {
  return {
    smartAccountId: 'CD6GY4UUTNPW4TUV7LDL5SELN4BBHJG4KDDT3W6G23DY6XCGM75MULMQ',
    intentId: INTENT,
    childSequence: 1,
    startLedger: 100,
    endLedger: 200,
    maxExecutions: 1,
    executionCount: 0,
    status: 'scheduled',
    note: '',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('normalizeIntentId', () => {
  it('strips a 0x prefix and lowercases', () => {
    expect(normalizeIntentId(`0X${'AB'.repeat(32)}`)).toBe('ab'.repeat(32))
  })
})

describe('indexJobsByIntent', () => {
  it('finds a job by any spelling of its intent id', () => {
    const index = indexJobsByIntent([job()])
    expect(
      index.get(normalizeIntentId(`0x${INTENT.toUpperCase()}`))?.status
    ).toBe('scheduled')
  })

  it('counts terminal jobs too — queueing again would be a no-op', () => {
    const index = indexJobsByIntent([job({ status: 'executed' })])
    expect(index.has(INTENT)).toBe(true)
  })

  it('is empty when nothing is queued', () => {
    expect(indexJobsByIntent([]).size).toBe(0)
  })
})
