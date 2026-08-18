import type { NextConfig } from 'next';
import path from 'path';

// @techstark/opencv-js (used by app/dev/cube-edge-detect-test) bundles the
// Emscripten-generated opencv.js, which conditionally does
// `require("fs"/"path"/"crypto")` inside an `if (ENVIRONMENT_IS_NODE)`
// branch that never runs in the browser. Both bundlers still statically try
// to resolve those requires, which fails since they're not real browser
// modules — aliasing them to an empty stub for the browser build satisfies
// the resolver without needing that dead Node-only branch to ever execute.
// Turbopack's resolveAlias doesn't yet accept a raw Windows absolute path
// (backslash-separated) here — normalize to forward slashes.
const nodeBuiltinStub = path.join(__dirname, 'lib/browser-empty-stub.js').replace(/\\/g, '/');

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      fs: { browser: nodeBuiltinStub },
      path: { browser: nodeBuiltinStub },
      crypto: { browser: nodeBuiltinStub },
    },
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
