// Server clock for the coach challenge (docs/challenge-plan.md, 4b): every
// time-dependent rule — end-time validation (N2), lazy end (decision 20),
// the sanity checks, completion dates and the cleanup cron — reads
// serverNow() instead of Date.now().
//
// TEST-ONLY shift: with PV_TEST_CLOCK_OFFSET_MS set, the tests pin the
// challenge clock to a chosen Ulaanbaatar time (12:00, or 23:50 for the
// late-night run) whatever the real time is. It can never apply to real
// data: it needs FIRESTORE_EMULATOR_HOST (the Admin SDK then talks only to
// the local emulator) and refuses on Vercel (VERCEL is set on every Vercel
// deployment). tests/e2e/emulator-guard.mjs checks these conditions.
// Auth (ID-token expiry) keeps the real clock.

type Env = Record<string, string | undefined>;

export function testClockActive(env: Env = process.env): boolean {
  return !env.VERCEL && !!env.FIRESTORE_EMULATOR_HOST && !!env.PV_TEST_CLOCK_OFFSET_MS &&
    Number.isFinite(Number(env.PV_TEST_CLOCK_OFFSET_MS));
}

export function serverNow(env: Env = process.env): number {
  return testClockActive(env) ? Date.now() + Number(env.PV_TEST_CLOCK_OFFSET_MS) : Date.now();
}
