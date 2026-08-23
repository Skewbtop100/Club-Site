import { Scrambow } from 'scrambow';

// ── Scramble generation (via scrambow) ───────────────────────────────────────
// scrambow supports: 222, 333, 444, 555, 666, 777, 333fm, pyram, skewb, sq1,
// clock, minx. OH/BLD/MBF use the same scramble as their base puzzle.
//
// Lifted out of app/timer/page.tsx so it can be reused outside the Timer
// (e.g. Practice Log) without pulling in the rest of that file.
export const SCRAMBOW_TYPE: Record<string, string> = {
  '333':    '333',
  '222':    '222',
  '444':    '444',
  '555':    '555',
  '666':    '666',
  '777':    '777',
  '333oh':  '333',
  '333bld': '333',
  '444bld': '444',
  '555bld': '555',
  '333mbf': '333',
  '333fm':  '333fm',
  'pyram':  'pyram',
  'skewb':  'skewb',
  'sq1':    'sq1',
  'clock':  'clock',
  'minx':   'minx',
};

export function generateScramble(eventId: string): string {
  const type = SCRAMBOW_TYPE[eventId] ?? '333';
  try {
    const result = new Scrambow().setType(type).get(1);
    const s = result[0]?.scramble_string ?? '';
    // Collapse runs of whitespace and trim — scrambow pads cells in NxN output.
    return s.replace(/[ \t]+/g, ' ').trim();
  } catch {
    return '';
  }
}

// ── Server-side WCA-quality scramble generation (via cstimer_module) ────────
//
// Same source as csTimer's own scrambler (cs0x7f, csTimer's author, publishes
// this npm package directly from csTimer's codebase). Plain synchronous JS —
// no Web Worker involved, unlike cubing/scramble, which fails to instantiate
// its worker under Next.js's client-side bundler (see app/api/scramble/route.ts
// for the server-side call site; this mapping is server-only, never imported
// client-side). Types/lengths per cs0x7f/cstimer's README event list.
export const CSTIMER_SCRAMBLE_TYPE: Record<string, { type: string; len?: number }> = {
  '333':    { type: '333' },
  '222':    { type: '222so' },
  '444':    { type: '444wca' },
  '555':    { type: '555wca', len: 60 },
  '666':    { type: '666wca', len: 80 },
  '777':    { type: '777wca', len: 100 },
  '333oh':  { type: '333' },
  '333bld': { type: '333' },
  '444bld': { type: '444bld', len: 40 },
  '555bld': { type: '555bld', len: 60 },
  // WCA-standard ids (lib/wca-events.ts) for the same three BLD events —
  // ResultsEntryTab/admin pages use these spellings, the Timer page uses
  // the 'bld' spellings above; both need to resolve here since this map is
  // keyed by whatever eventId the caller passes to /api/scramble.
  '333bf':  { type: '333' },
  '444bf':  { type: '444bld', len: 40 },
  '555bf':  { type: '555bld', len: 60 },
  '333mbf': { type: '333' },
  '333fm':  { type: '333fm' },
  'pyram':  { type: 'pyrso', len: 10 },
  'skewb':  { type: 'skbso' },
  'sq1':    { type: 'sqrs' },
  'clock':  { type: 'clkwca' },
  'minx':   { type: 'mgmp', len: 70 },
};
