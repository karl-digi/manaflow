import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["morphcloud", "ssh2", "node-ssh", "cpu-features"],
  outputFileTracingIncludes: {
    "/": ["./scripts/pr-review/pr-review-inject.bundle.js"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = ["morphcloud", "ssh2", "node-ssh", "cpu-features"];
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, ...externals]
        : config.externals
          ? [config.externals, ...externals]
          : externals;
    } else {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
  transpilePackages: [
    "@cmux/server",
    "@cmux/shared",
    "@cmux/convex",
    "@monaco-editor/react",
    "monaco-editor",
    "refractor",
  ],
};

export default nextConfig;
