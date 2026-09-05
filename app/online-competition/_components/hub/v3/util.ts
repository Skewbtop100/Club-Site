import type { Timestamp } from 'firebase/firestore';

/** "2026-09-12" — date only, for the hero/row meta lines where the time
 *  is shown separately. */
export function fmtDate(ts: Timestamp | undefined | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "18:00" */
export function fmtTime(ts: Timestamp | undefined | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Coarse Mongolian "time left" label for the registration countdown —
 *  the largest two units that are non-zero, so a two-week window reads
 *  "13 хоног 4 цаг" and the last hour reads "42 мин". */
export function fmtRemaining(ms: number): string {
  if (ms <= 0) return 'Хугацаа дууссан';
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return hours > 0 ? `${days} хоног ${hours} цаг` : `${days} хоног`;
  if (hours > 0) return rem > 0 ? `${hours} цаг ${rem} мин` : `${hours} цаг`;
  return `${Math.max(1, rem)} мин`;
}

/** Splits a trailing 4-digit year off a competition name so the hero can
 *  render it in volt ("Хором Оупен 2026" -> ["Хором Оупен ", "2026"]).
 *  Returns a null tail when the name doesn't end in a year — the spec is
 *  explicit that the split shouldn't be forced. */
export function splitTrailingYear(name: string): [string, string | null] {
  const m = /^(.*\S)\s+(\d{4})$/.exec(name.trim());
  return m ? [`${m[1]} `, m[2]] : [name, null];
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Т';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}
