'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'

import { STELLAR_CONFIG } from '@/config'
import { useTreasury } from '@/features/treasury/queries'
import { TreasuryConsole } from '@/features/treasury/treasury-console'
import { toContractSet } from '@/lib/treasuryRegistry/types'

export default function TreasuryConsolePage() {
  const params = useParams<{ smartAccountId: string }>()
  const smartAccountId = params.smartAccountId
  const treasuryQuery = useTreasury(smartAccountId)

  if (treasuryQuery.isPending) {
    return (
      <main className="bg-background text-foreground grid min-h-screen place-items-center">
        <p className="text-muted-foreground text-sm">Loading treasury…</p>
      </main>
    )
  }

  if (treasuryQuery.isError || !treasuryQuery.data) {
    return (
      <main className="bg-background text-foreground grid min-h-screen place-items-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-sm">
          No registered treasury was found for{' '}
          <code className="text-xs">{smartAccountId}</code>.
        </p>
        <Link className="text-sm underline" href="/treasuries">
          Back to My Treasuries
        </Link>
      </main>
    )
  }

  const contracts = toContractSet(
    treasuryQuery.data,
    STELLAR_CONFIG.contracts.defaultAsset
  )
  return <TreasuryConsole contracts={contracts} />
}
