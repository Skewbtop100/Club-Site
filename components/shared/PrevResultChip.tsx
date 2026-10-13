'use client';

import { useLang } from '@/lib/i18n';

/** Small "Өмнөх" chip shown next to an imported (previous-competition) result
 *  whose athlete shares a name with a club athlete of the same competition —
 *  so that row can't be mistaken for the club member's own result. The
 *  caller decides `show` (lib/staged-reveal.ts clubNameMatcher, against the
 *  competition's current athletes); renders nothing otherwise. */
export default function PrevResultChip({ show }: { show: boolean }) {
  const { t } = useLang();
  if (!show) return null;
  return (
    <span
      title={t('results.wca-chip-title')}
      style={{
        display: 'inline-block', marginLeft: '0.4rem', padding: '0.05rem 0.35rem',
        borderRadius: '4px', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em',
        verticalAlign: 'middle', cursor: 'help', whiteSpace: 'nowrap',
        background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.45)', color: '#fbbf24',
      }}
    >
      {t('results.prev-chip')}
    </span>
  );
}
