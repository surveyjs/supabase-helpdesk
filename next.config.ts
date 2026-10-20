import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained `.next/standalone` server so the Docker runtime image
  // can run `node server.js` without the full node_modules tree. See Dockerfile.
  output: "standalone",
  // CI E2E jobs set SKIP_BUILD_TYPECHECK=1 because the lint job already runs
  // `tsc --noEmit` in parallel. Unset locally and in Docker => normal builds.
  typescript: { ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "1" },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
