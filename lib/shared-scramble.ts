// "Shared scramble code": everyone who enters the same short code gets the
// same scramble #1, #2, #3… for each event, with no server involved.
//
//   scramble = generateSeededScramble(eventId, sharedSeedKey(code, eventId, index))
//
// Determinism across devices / browsers rests on two things:
//   1. The PRNG below uses integer arithmetic only (Math.imul, shifts,
//      >>> 0), which every JS engine computes bit-identically. scrambow's own
//      setSeed() is deliberately NOT used: it derives numbers from
//      frac(1e4 * Math.sin(t)), and Math.sin is implementation-approximated,
//      so Safari and Chrome could disagree in rare cases.
//   2. scrambow draws every random number from the `seed` object it hands
//      its scramblers (no Math.random, no Date/time-based search cutoffs, no
//      crypto); its only other float maths is Math.pow on small integers.
// scripts/test-shared-scramble.mjs checks the result in separate processes
// against a committed golden hash.

/** 4-digit codes ("0000"–"9999"). */
export const SHARED_CODE_RE = /^\d{4}$/;

export function isValidSharedCode(code: string): boolean {
  return SHARED_CODE_RE.test(code);
}

/** Random 4-digit code for "Код үүсгэх" (not part of any seed). */
export function randomSharedCode(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

/** The string every device hashes for (code, event, index). */
export function sharedSeedKey(code: string, eventId: string, index: number): string {
  return `${code}|${eventId}|${index}`;
}

/** cyrb128 — 128-bit string hash (four uint32s) used to seed sfc32. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32 PRNG returning floats in [0, 1) with 32 bits of precision. */
export function seededRandom(seedKey: string): () => number {
  let [a, b, c, d] = cyrb128(seedKey);
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  // Discard the first outputs so similar keys ("…|1", "…|2") decorrelate.
  for (let i = 0; i < 15; i++) next();
  return next;
}
