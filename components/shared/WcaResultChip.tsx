'use client';

import { useLang } from '@/lib/i18n';
import type { Result } from '@/lib/types';

/** Small "WCA" chip shown next to an imported result whose athlete shares a
 *  name with a club athlete of the same competition — so the real-competition
 *  row can't be mistaken for the club member's own result. Renders nothing
 *  for every other row. */
export default function WcaResultChip({ result }: { result: Pick<Result, 'source' | 'matchedClubAthleteId'> }) {
  const { t } = useLang();
  if (result.source !== 'imported' || !result.matchedClubAthleteId) return null;
  return (
    <span
      title={t('results.wca-chip-title')}
      style={{
        display: 'inline-block', marginLeft: '0.4rem', padding: '0.05rem 0.35rem',
        borderRadius: '4px', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em',
        verticalAlign: 'middle', cursor: 'help',
        background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.45)', color: '#fbbf24',
      }}
    >
      WCA
    </span>
  );
}
