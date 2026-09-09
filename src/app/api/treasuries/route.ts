import { NextResponse } from 'next/server'

import { StrKey } from '@stellar/stellar-sdk'

import {
  TreasuryConflictError,
  createTreasury,
  listTreasuriesByOwner,
  validateCreateTreasuryInput,
} from '@/lib/treasuryRegistry/store'
import type { CreateTreasuryInput } from '@/lib/treasuryRegistry/types'
import { verifyTreasuryRegistration } from '@/lib/treasuryRegistry/verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isCreateTreasuryInput(value: unknown): value is CreateTreasuryInput {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.smartAccountId === 'string' &&
    typeof candidate.policyEngineId === 'string' &&
    typeof candidate.intentRegistryId === 'string' &&
    typeof candidate.recoveryManagerId === 'string' &&
    typeof candidate.transferAdapterId === 'string' &&
    typeof candidate.splitAdapterId === 'string' &&
    typeof candidate.ownerAddress === 'string' &&
    typeof candidate.executorAddress === 'string' &&
    typeof candidate.deployTxHash === 'string'
  )
}

export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get('owner')
  if (!owner || !StrKey.isValidEd25519PublicKey(owner)) {
    return NextResponse.json(
      { error: 'A valid ?owner=<G...> query parameter is required.' },
      { status: 400 }
    )
  }

  return NextResponse.json({ treasuries: await listTreasuriesByOwner(owner) })
}

/**
 * No admin-token gate, unlike `/api/relayer/*` — the on-chain ownership
 * check inside `verifyTreasuryRegistration` *is* the access control here.
 * Anyone can submit a registration claim, but it's only persisted once every
 * address in it -- owner, policy engine, intent registry, recovery manager
 * and both adapters -- matches what the smart_account's own instance storage
 * says it is wired to, which only a real deployment could produce.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown
    if (!isCreateTreasuryInput(body)) {
      return NextResponse.json(
        { error: 'Invalid treasury registration payload.' },
        { status: 400 }
      )
    }

    // Validate shape (StrKey checks, tx hash format) before the RPC round
    // trip below -- a cleaner, faster rejection than letting a malformed
    // address surface as an opaque simulation error from loadOwner.
    validateCreateTreasuryInput(body)
    await verifyTreasuryRegistration({
      ...body,
      createdAt: new Date().toISOString(),
    })
    const treasury = await createTreasury(body)
    return NextResponse.json({ treasury })
  } catch (error) {
    if (error instanceof TreasuryConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('could not be verified') ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
