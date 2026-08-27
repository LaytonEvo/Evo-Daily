import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["bcryptjs"],
};

export default nextConfig;
