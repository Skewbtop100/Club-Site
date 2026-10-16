// Browser clock for the coach challenge (docs/challenge-plan.md, 4b): the
// end-time picker, "running until HH:MM", the timer's end-time switch-off
// and the coach live view read appNow() instead of Date.now(), so they
// agree with the server's serverNow() (lib/server/clock.ts).
//
// TEST-ONLY shift: in the emulator test mode Playwright sets
// window.__pvTestClockOffset to the same offset the test server uses. The
// condition is written out here — the same two build-time constants as
// lib/firebase.ts EMULATOR_MODE — rather than imported, because the bundler
// only removes the dead branch when the constants sit in this module: in a
// production build it becomes `if (false)` and the branch and its marker
// disappear (tests/e2e/emulator-guard.mjs checks for "__pvTestClockOffset").

export function appNow(): number {
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === '1' &&
      typeof window !== 'undefined') {
    const off = (window as unknown as { __pvTestClockOffset?: unknown }).__pvTestClockOffset;
    if (typeof off === 'number' && Number.isFinite(off)) return Date.now() + off;
  }
  return Date.now();
}
