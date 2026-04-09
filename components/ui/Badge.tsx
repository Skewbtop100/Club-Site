type BadgeType = 'WR' | 'CR' | 'NR' | 'TR' | 'PR';

const BADGE_STYLES: Record<BadgeType, { bg: string; color: string; border: string }> = {
  WR: { bg: 'rgba(250,204,21,0.15)',  color: '#fbbf24', border: 'rgba(250,204,21,0.35)' },
  CR: { bg: 'rgba(74,222,128,0.12)',  color: '#4ade80', border: 'rgba(74,222,128,0.3)' },
  NR: { bg: 'rgba(96,165,250,0.12)',  color: '#60a5fa', border: 'rgba(96,165,250,0.3)' },
  TR: { bg: 'rgba(167,139,250,0.12)', color: '#a78bfa', border: 'rgba(167,139,250,0.3)' },
  PR: { bg: 'rgba(236,72,153,0.12)',  color: '#f9a8d4', border: 'rgba(236,72,153,0.3)' },
};

interface BadgeProps {
  type: BadgeType;
  className?: string;
}

export default function Badge({ type, className }: BadgeProps) {
  const s = BADGE_STYLES[type];
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.1rem 0.38rem',
        borderRadius: '4px',
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        fontFamily: 'monospace',
        lineHeight: 1.4,
        flexShrink: 0,
      }}
    >
      {type}
    </span>
  );
}
