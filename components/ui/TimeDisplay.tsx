/**
 * Formats centiseconds to M:SS.xx or SS.xx
 *
 * Special values:
 *   -1 → DNF
 *   -2 → DNS
 *   null / undefined → —
 */
export function formatTime(cs: number | null | undefined): string {
  if (cs === -1) return 'DNF';
  if (cs === -2) return 'DNS';
  if (cs === null || cs === undefined) return '—';

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

interface TimeDisplayProps {
  cs: number | null | undefined;
  /** Extra class names */
  className?: string;
  /** If true, renders as inline text (no wrapper span) */
  plain?: boolean;
}

export default function TimeDisplay({ cs, className, plain }: TimeDisplayProps) {
  const text = formatTime(cs);
  const isDnf = cs === -1 || cs === -2;

  if (plain) return <>{text}</>;

  return (
    <span
      className={className}
      style={{
        fontFamily: 'monospace',
        fontWeight: 600,
        color: isDnf ? '#f87171' : undefined,
      }}
    >
      {text}
    </span>
  );
}
