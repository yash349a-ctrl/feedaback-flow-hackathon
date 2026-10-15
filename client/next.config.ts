import path from "node:path";
import type { NextConfig } from "next";

// Keep development file discovery inside the client app (avoids unrelated parent lockfiles).
// Keep output tracing at workspace root so deployment can still see workspace metadata.
const clientRoot = path.resolve(__dirname);
const workspaceRoot = path.resolve(clientRoot, "..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: clientRoot },
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
