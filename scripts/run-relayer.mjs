// RELAYER_APP_URL is the dApp's base URL *including* its base path
// (`https://smarttreasury.io/app`, `http://localhost:3000/app`): the app is
// served under /app (see next.config.ts), so its API routes live there too.
// `new URL("/api/...", base)` would drop that path, hence the manual join.
const appUrl = (
  process.env.RELAYER_APP_URL ?? 'http://localhost:3000/app'
).replace(/\/+$/, '')
const token = process.env.RELAYER_ADMIN_TOKEN

if (!token) {
  throw new Error('RELAYER_ADMIN_TOKEN must be set before running the relayer.')
}

const response = await fetch(`${appUrl}/api/relayer/run`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-relayer-token': token,
  },
})

const payload = await response.json()
if (!response.ok) {
  throw new Error(
    payload.error ?? `Relayer run failed with ${response.status}.`
  )
}

console.log(JSON.stringify(payload, null, 2))
