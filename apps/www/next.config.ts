import path from "node:path";
import type { NextConfig } from "next";

const docsDirAlias = path.resolve(__dirname, "../../docs");

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  serverExternalPackages: ["morphcloud", "ssh2", "node-ssh", "cpu-features"],
  webpack: (config, { isServer }) => {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["@/docs"] = docsDirAlias;

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
