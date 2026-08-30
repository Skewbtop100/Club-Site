// Small local copy of the club's centisecond-formatting logic
// (lib/time-utils.ts), trimmed to what this feature needs. Kept as a
// separate copy rather than an import so this feature stays decoupled from
// club-specific files.

/** Format centiseconds as m:ss.cc (or s.cc under a minute). */
export function fmtCentiseconds(cs: number): string {
  if (cs >= 6000) {
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    const c = cs % 100;
    return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  }
  const s = Math.floor(cs / 100);
  const c = cs % 100;
  return `${s}.${String(c).padStart(2, '0')}`;
}
