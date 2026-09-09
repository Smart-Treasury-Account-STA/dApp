/**
 * Path prefix the dApp is served under (`basePath` in next.config.ts).
 *
 * `next/link` and `useRouter` apply it on their own; `fetch` does not, so
 * every call to one of this app's own API routes builds its URL here.
 * Reads NEXT_PUBLIC_BASE_PATH, which next.config.ts inlines at build time
 * from the same constant it hands to `basePath`. Unset (Vitest, scripts)
 * means no prefix, which keeps route-level tests independent of the
 * deployment layout.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix an app-relative path (`/api/...`) with the deployment base path. */
export function apiUrl(path: `/${string}`): string {
  return `${BASE_PATH}${path}`;
}
