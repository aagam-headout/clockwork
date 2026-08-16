import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Dockerfile's `prod` stage ship a self-contained server instead of
  // node_modules. Skip on Vercel: Turbopack (Next 16's default) never
  // generates `.next/next-server.js.nft.json`, but standalone's
  // copyTracedFiles() reads it unconditionally and crashes with ENOENT. Gate
  // on Vercel's own `VERCEL=1` rather than a hardcoded Docker flag.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
};

export default nextConfig;
