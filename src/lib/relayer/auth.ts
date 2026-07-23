export function requireRelayerAdmin(request: Request) {
  const token = process.env.RELAYER_ADMIN_TOKEN;
  if (!token) {
    throw new Error("RELAYER_ADMIN_TOKEN must be configured before mutating relayer jobs.");
  }
  if (request.headers.get("x-relayer-token") !== token) {
    throw new Error("Unauthorized relayer request.");
  }
}
