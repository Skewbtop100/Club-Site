// Local copy of the cstimer_module event-type mapping (see lib/scramble.ts's
// CSTIMER_SCRAMBLE_TYPE) — trimmed to common WCA events. Kept as a separate
// copy, not an import, so this feature stays decoupled from club-specific
// files. Server-side only: cstimer_module never ships in the client bundle.
export const ONLINE_COMP_SCRAMBLE_TYPE: Record<string, { type: string; len?: number }> = {
  '333':   { type: '333' },
  '222':   { type: '222so' },
  '444':   { type: '444wca' },
  '555':   { type: '555wca', len: 60 },
  '666':   { type: '666wca', len: 80 },
  '777':   { type: '777wca', len: 100 },
  '333oh': { type: '333' },
  pyram:   { type: 'pyrso', len: 10 },
  skewb:   { type: 'skbso' },
  sq1:     { type: 'sqrs' },
  clock:   { type: 'clkwca' },
  minx:    { type: 'mgmp', len: 70 },
};
