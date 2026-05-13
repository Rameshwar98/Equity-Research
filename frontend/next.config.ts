import type { NextConfig } from "next";

/** Where uvicorn runs during local dev (see backend README). Used only when NODE_ENV=development. */
const backendOrigin =
  process.env.BACKEND_URL?.replace(/\/+$/, "") || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactCompiler: true,
  /** Dev rewrites proxy slow endpoints (e.g. POST generate test history ~2m); default ~30s causes ECONNRESET. */
  experimental: {
    proxyTimeout: 600_000,
  },
  async rewrites() {
    if (process.env.NODE_ENV !== "development") {
      return [];
    }
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
