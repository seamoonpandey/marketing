import type { NextConfig } from "next";

// The product calls /api on its own origin. In development and tests Next proxies it to the API
// (API_URL, or 127.0.0.1:API_PORT); in production nginx routes /api before it reaches Next.
const API_URL = process.env.API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? "8000"}`;

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
