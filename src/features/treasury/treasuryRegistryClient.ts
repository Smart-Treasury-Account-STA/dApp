import { apiUrl } from '@/lib/basePath'
import type {
  CreateTreasuryInput,
  TreasuryRecord,
} from '@/lib/treasuryRegistry/types'

export async function fetchMyTreasuries(owner: string) {
  const response = await fetch(
    apiUrl(`/api/treasuries?owner=${encodeURIComponent(owner)}`),
    {
      cache: 'no-store',
    }
  )
  if (!response.ok) {
    throw new Error('Could not load your treasuries.')
  }
  const payload = (await response.json()) as { treasuries: TreasuryRecord[] }
  return payload.treasuries
}

export async function fetchTreasury(smartAccountId: string) {
  const response = await fetch(
    apiUrl(`/api/treasuries/${encodeURIComponent(smartAccountId)}`),
    {
      cache: 'no-store',
    }
  )
  if (!response.ok) {
    throw new Error('Treasury not found.')
  }
  const payload = (await response.json()) as { treasury: TreasuryRecord }
  return payload.treasury
}

export async function registerTreasury(input: CreateTreasuryInput) {
  const response = await fetch(apiUrl('/api/treasuries'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string }
    throw new Error(
      payload.error ?? 'Could not register the deployed treasury.'
    )
  }
  const payload = (await response.json()) as { treasury: TreasuryRecord }
  return payload.treasury
}
