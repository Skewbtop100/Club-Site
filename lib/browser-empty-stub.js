// Stub for Node.js built-ins (fs, path, crypto) that some npm packages
// conditionally `require()` inside an `if (isNodeEnvironment)` branch that
// never actually runs in the browser — but bundlers still statically try to
// resolve the require() call regardless of whether that branch is reachable,
// which fails since these aren't real browser modules. Aliasing to this
// empty stub (see next.config.ts) satisfies the resolver without needing
// the dead code to ever execute.
module.exports = {};
