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

export async function runDueRelayerJobs() {
  const response = await fetch(apiUrl('/api/relayer/run'), {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string }
    throw new Error(payload.error ?? 'Could not run due relayer jobs.')
  }
  const payload = (await response.json()) as { updated: RelayerJobRecord[] }
  return payload.updated
}

export async function openRelayerSession(token: string) {
  const response = await fetch(apiUrl('/api/relayer/session'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!response.ok) {
    throw new Error('Invalid operator token.')
  }
}

export async function closeRelayerSession() {
  await fetch(apiUrl('/api/relayer/session'), {
    method: 'DELETE',
    credentials: 'same-origin',
  })
}

/**
 * Whether the httpOnly relayer session cookie is still live.
 *
 * The console cannot read that cookie, so on a fresh page it has no way to
 * know it is already unlocked. Answers `false` on any transport failure: a
 * console that wrongly believes it is unlocked shows enabled buttons that
 * fail at the server.
 */
export async function probeRelayerSession(): Promise<boolean> {
  try {
    const response = await fetch(apiUrl('/api/relayer/session'), {
      credentials: 'same-origin',
    })
    if (!response.ok) return false
    const payload = (await response.json()) as { active?: boolean }
    return payload.active === true
  } catch {
    return false
  }
}
