import type { NextConfig } from "next";

// The dApp is served under https://smarttreasury.io/app. The marketing site
// (org/marketing) owns the apex domain and proxies /app/* to this project's
// own Vercel deployment, so every route, asset, and API handler here carries
// the /app prefix. `next/link` and the router add it on their own; plain
// `fetch` calls do not, so they go through `apiUrl()` in src/lib/basePath.ts,
// which reads the same value back from NEXT_PUBLIC_BASE_PATH.
const BASE_PATH = "/app";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  basePath: BASE_PATH,
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      // On the project's own origin (sta-dapp.vercel.app, the testnet
      // deployment) nothing is served at `/` once basePath is set. Send it
      // to the console instead of a 404.
      {
        source: "/",
        destination: BASE_PATH,
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
