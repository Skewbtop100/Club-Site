'use client';

import type { OwnRoundStats } from '@/lib/online-competition/live-view';
import { MONO, fmtResult } from './ui';

/** The athlete's three numbers — all that is left of the header banner.
 *  Rendered only when there is a round to describe; see the page. */
export default function LiveStats({ stats }: { stats: OwnRoundStats }) {
  return (
    <div className="oc-live-stats">
      <Stat label="МИНИЙ ОРОЛДЛОГО" value={`${stats.filed} / ${stats.attempts}`} />
      <Stat
        label={stats.averageKind === 'single' ? 'ОДООГИЙН СИНГЛ' : 'ОДООГИЙН ДУНДАЖ'}
        value={fmtResult(stats.average)}
        volt
      />
      <Stat label="ОДООГИЙН ЗЭРЭГ" value={stats.rank !== null ? `${stats.rank} / ${stats.ranked}` : '—'} />
    </div>
  );
}

function Stat({ label, value, volt = false }: { label: string; value: string; volt?: boolean }) {
  return (
    <div className="oc-live-stat">
      <span className="oc-live-stat-label">{label}</span>
      <span
        style={{
          font: `700 16px/1 ${MONO}`,
          fontVariantNumeric: 'tabular-nums',
          color: volt ? '#DFFF4F' : '#F4F1EA',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}
