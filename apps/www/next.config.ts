import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    instrumentationHook: true,
  },
  serverExternalPackages: ["morphcloud", "ssh2", "node-ssh", "cpu-features"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = ["morphcloud", "ssh2", "node-ssh", "cpu-features"];
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, ...externals]
        : config.externals
          ? [config.externals, ...externals]
          : externals;
    }
    return config;
  },
  transpilePackages: ["@cmux/server", "@cmux/shared", "@cmux/convex"],
};

export default nextConfig;
