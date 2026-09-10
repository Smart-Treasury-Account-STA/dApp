import { apiUrl } from '@/lib/basePath'
import type {
  CreateRelayerJobInput,
  RelayerJobRecord,
} from '@/lib/relayer/types'

export async function fetchRelayerJobs(smartAccountId: string) {
  const response = await fetch(
    apiUrl(
      `/api/relayer/jobs?smartAccountId=${encodeURIComponent(smartAccountId)}`
    ),
    { cache: 'no-store' }
  )
  if (!response.ok) {
    throw new Error('Could not load relayer jobs.')
  }
  const payload = (await response.json()) as { jobs: RelayerJobRecord[] }
  return payload.jobs
}

export async function queueRelayerJob(input: CreateRelayerJobInput) {
  const response = await fetch(apiUrl('/api/relayer/jobs'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string }
    throw new Error(payload.error ?? 'Could not queue relayer job.')
  }
  const payload = (await response.json()) as { job: RelayerJobRecord }
  return payload.job
}

export async function executeRelayerJob(
  smartAccountId: string,
  intentId: string
) {
  const response = await fetch(
    apiUrl(
      `/api/relayer/jobs/${intentId}/execute?smartAccountId=${encodeURIComponent(smartAccountId)}`
    ),
    {
      method: 'POST',
      credentials: 'same-origin',
    }
  )
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string }
    throw new Error(payload.error ?? 'Could not execute relayer job.')
  }
  const payload = (await response.json()) as { job: RelayerJobRecord }
  return payload.job
}

export type RelayerSessionState = {
  active: boolean
  /** The Stellar address the session belongs to, or null when there is none. */
  subject: string | null
}

/**
 * What the httpOnly relayer session cookie currently is, if anything.
 *
 * The console cannot read that cookie, so on a fresh page it has no way to
 * know it is already open. Answers "no session" on any transport failure: a
 * console that wrongly believes it is authenticated shows enabled buttons
 * that fail at the server.
 */
export async function probeRelayerSession(): Promise<RelayerSessionState> {
  try {
    const response = await fetch(apiUrl('/api/relayer/session'), {
      credentials: 'same-origin',
    })
    if (!response.ok) return { active: false, subject: null }
    const payload = (await response.json()) as {
      active?: boolean
      subject?: string | null
    }
    return {
      active: payload.active === true,
      subject: payload.subject ?? null,
    }
  } catch {
    return { active: false, subject: null }
  }
}

/**
 * Opens a session as the connected wallet: asks the server for a challenge,
 * has the wallet sign it, and exchanges the pair for the cookie.
 *
 * `sign` is passed in rather than imported so this module stays transport
 * only -- and so the caller decides which wallet does the signing.
 */
export async function openWalletRelayerSession(
  address: string,
  sign: (message: string) => Promise<string>
) {
  const challengeResponse = await fetch(apiUrl('/api/auth/challenge'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  if (!challengeResponse.ok) {
    const payload = (await challengeResponse.json()) as { error?: string }
    throw new Error(payload.error ?? 'Could not start wallet authentication.')
  }
  const { challenge } = (await challengeResponse.json()) as {
    challenge: string
  }

  const signedMessage = await sign(challenge)

  const response = await fetch(apiUrl('/api/relayer/session'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge, signedMessage }),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(payload?.error ?? 'The wallet signature was not accepted.')
  }
}

/**
 * Makes sure the session belongs to `address` before a call that needs one,
 * opening a wallet session when there is none -- or when the one there is
 * belongs to someone else.
 *
 * The second case is the one that bit on mainnet (2026-09-10): the cookie
 * outlives the wallet connection by up to eight hours, so switching the
 * connected wallet left the previous address's session in place and the
 * next queue went through under it, with no signature asked of the wallet
 * actually connected. The server had scoped it correctly to the *cookie's*
 * address; it was the console that let the two drift apart. A session is
 * proof for one address, so it is only reused for that address.
 *
 * Whether the address may act on a given treasury stays the server's
 * decision, per treasury. A returning wallet is still not asked to sign
 * twice within its session.
 */
export async function ensureRelayerSession(
  address: string,
  sign: (message: string) => Promise<string>
) {
  const state = await probeRelayerSession()
  if (state.active && state.subject === address) return state
  await openWalletRelayerSession(address, sign)
  return probeRelayerSession()
}
