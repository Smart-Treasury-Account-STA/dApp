import type { NextConfig } from "next";

const DOCS_ORIGIN = process.env.DOCS_ORIGIN ?? "https://docs-lendwise.vercel.app";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      // VitePress docs — a separate Vercel project proxied under /docs so the
      // documentation shares this origin for SEO. The docs project is built
      // with `base: '/docs/'`, so its asset URLs already carry the prefix and
      // resolve back through this same rewrite.
      {
        source: "/docs",
        destination: `${DOCS_ORIGIN}/`,
      },
      {
        source: "/docs/:path*",
        destination: `${DOCS_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
