import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // firebase-admin/auth pulls in jwks-rsa -> jose (ESM-only in recent versions),
  // which breaks when Turbopack tries to bundle it for the serverless runtime
  // (require() of an ES Module). Keeping it external makes Node resolve it
  // natively at runtime instead, which is what firebase-admin expects.
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
