import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Dockerfile's `prod` stage ship a self-contained server instead of
  // the whole node_modules tree. Must be skipped on Vercel: under Turbopack
  // (Next 16's default bundler) `.next/next-server.js.nft.json` is never
  // generated, but standalone's copyTracedFiles() still reads it
  // unconditionally, crashing the build with ENOENT. Vercel sets `VERCEL=1`
  // during its builds, so gate on that instead of hardcoding a Docker flag.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
};

export default nextConfig;
