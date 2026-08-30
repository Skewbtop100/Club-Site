import type { Timestamp } from 'firebase/firestore';

export function fmtDateTime(ts: Timestamp | undefined | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toMillisOrNull(ts: Timestamp | undefined | null): number | null {
  return ts ? ts.toMillis() : null;
}
