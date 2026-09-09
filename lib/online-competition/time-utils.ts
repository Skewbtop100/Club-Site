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

// ── Time-limit input ─────────────────────────────────────────────────────
// The admin types a human time; the schema stores centiseconds.

/** Renders a stored limit back in the format the parser accepts, so the
 *  admin field round-trips exactly what it was given. Always M:SS, with
 *  .cc only when there is a fraction — "10:00", "0:30", "1:30.50". */
export function fmtTimeLimit(cs: number): string {
  const m = Math.floor(cs / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const base = `${m}:${String(sec).padStart(2, '0')}`;
  return c === 0 ? base : `${base}.${String(c).padStart(2, '0')}`;
}

/** Parses "10:00" / "1:30.00" / "0:30" / "30" / "30.50" into centiseconds.
 *
 *  Rules, deliberately strict:
 *   - '' (or whitespace) is VALID and means NO LIMIT -> null.
 *   - Minutes are optional and unbounded; seconds are 0-59 and must be
 *     present; centiseconds are an optional 1-2 digits.
 *   - "600" is REJECTED rather than guessed at. Without a colon it would
 *     have to mean either 600 seconds or 6 minutes, and silently choosing
 *     one would set a limit ten times off. The admin writes "10:00".
 *   - Zero is REJECTED: a limit of 0 DNFs every possible solve, which is
 *     never what anyone means and is indistinguishable from a typo.
 *  Anything else returns ok:false, and the caller refuses the save rather
 *  than dropping the value — silently storing "no limit" because the text
 *  was unparseable is the failure mode worth avoiding. */
export function parseTimeLimit(text: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  const m = /^(?:(\d{1,3}):)?([0-5]?\d)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!m) return { ok: false };
  const minutes = m[1] ? parseInt(m[1], 10) : 0;
  const seconds = parseInt(m[2], 10);
  const centis = m[3] ? parseInt(m[3].padEnd(2, '0'), 10) : 0;
  const value = minutes * 6000 + seconds * 100 + centis;
  if (value <= 0) return { ok: false };
  return { ok: true, value };
}
