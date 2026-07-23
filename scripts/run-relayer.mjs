const appUrl = process.env.RELAYER_APP_URL ?? "http://localhost:3000";
const token = process.env.RELAYER_ADMIN_TOKEN;

if (!token) {
  throw new Error("RELAYER_ADMIN_TOKEN must be set before running the relayer.");
}

const response = await fetch(new URL("/api/relayer/run", appUrl), {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-relayer-token": token,
  },
});

const payload = await response.json();
if (!response.ok) {
  throw new Error(payload.error ?? `Relayer run failed with ${response.status}.`);
}

console.log(JSON.stringify(payload, null, 2));
