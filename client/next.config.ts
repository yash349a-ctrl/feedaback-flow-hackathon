import path from "node:path";
import type { NextConfig } from "next";

// Explicitly anchor Next.js/Turbopack to this repository instead of a lockfile
// that may exist in a parent directory on a developer machine.
const projectRoot = path.resolve(__dirname, "..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
