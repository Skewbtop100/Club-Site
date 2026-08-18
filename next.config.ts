import type { NextConfig } from 'next';

// @techstark/opencv-js (used by app/dev/cube-edge-detect-test) bundles the
// Emscripten-generated opencv.js, which conditionally does
// `require("fs"/"path"/"crypto")` inside an `if (ENVIRONMENT_IS_NODE)`
// branch that never runs in the browser. Both bundlers still statically try
// to resolve those requires, which fails since they're not real browser
// modules — aliasing them to an empty stub for the browser build satisfies
// the resolver without needing that dead Node-only branch to ever execute.
//
// This MUST be a plain project-root-relative string, not an OS absolute
// path built via path.join(__dirname, ...). Turbopack resolves
// turbopack.resolveAlias targets itself relative to the project root (its
// own error messages say "inside of [project]/"), and it classifies a
// bare `/`-rooted absolute path as a distinct, unimplemented "server
// relative import" — that's what broke the Vercel build (path resolved to
// `/vercel/path0/lib/browser-empty-stub.js`) even though the equivalent
// Windows absolute path (`C:/Users/.../lib/browser-empty-stub.js`, which
// has a drive letter Turbopack apparently classifies differently) happened
// to work in local dev/build. A relative string sidesteps the whole
// OS-path/absolute-path distinction, since Turbopack interprets it itself.
const nodeBuiltinStub = './lib/browser-empty-stub.js';

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
