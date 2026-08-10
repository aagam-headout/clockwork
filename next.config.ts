import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Dockerfile's `prod` stage ship a self-contained server instead of
  // the whole node_modules tree. Ignored by Vercel, which builds its own way.
  output: "standalone",
};

export default nextConfig;
