import { timingSafeEqual } from "node:crypto";

import { RELAYER_SESSION_COOKIE, verifySessionValue } from "@/lib/relayer/session";

function tokensMatch(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    if (key === name) {
      // The session cookie value is always `<digits>.<hex>` (see
      // createSessionValue), which never contains percent-encoded bytes, so
      // no decodeURIComponent is needed here (and it could otherwise throw
      // on a malformed cookie, turning a clean 401 into a 500).
      return part.slice(separatorIndex + 1).trim();
    }
  }

  return undefined;
}

/**
 * Authorizes a relayer mutation via either credential:
 * - the `x-relayer-token` header, matched against `RELAYER_ADMIN_TOKEN` with a
 *   timing-safe comparison (used by the `pnpm relayer:run` CLI), or
 * - a valid `sta_relayer_session` cookie minted by `POST /api/relayer/session`
 *   (used by the browser console after the operator unlocks it).
 *
 * Throws when neither credential authenticates.
 */
export function requireRelayerAdmin(request: Request) {
  const adminToken = process.env.RELAYER_ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error("RELAYER_ADMIN_TOKEN must be configured before mutating relayer jobs.");
  }

  const headerToken = request.headers.get("x-relayer-token");
  if (headerToken && tokensMatch(headerToken, adminToken)) {
    return;
  }

  const sessionCookie = readCookie(request, RELAYER_SESSION_COOKIE);
  if (verifySessionValue(adminToken, sessionCookie)) {
    return;
  }

  throw new Error("Unauthorized relayer request.");
}
