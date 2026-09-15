'use client';

import Link from 'next/link';
import type { OnlineCompetitionStatus } from '@/lib/online-competition/types';
import type { OwnRoundStats } from '@/lib/online-competition/live-view';
import { HEAD, MONO, fmtResult } from './ui';

const TONE: Record<OnlineCompetitionStatus, { dot: string; fg: string; label: string }> = {
  live: { dot: '#DFFF4F', fg: '#DFFF4F', label: 'LIVE' },
  upcoming: { dot: '#6E6A62', fg: '#9A958A', label: 'УДАХГҮЙ' },
  finished: { dot: '#4FD07A', fg: '#4FD07A', label: 'ДУУССАН' },
  // Unreachable: the route 404s a draft. Present because the Record demands it.
  draft: { dot: '#4A4740', fg: '#6E6A62', label: 'НООРОГ' },
};

/** The strip across the top: competition, status, athlete count, and the
 *  athlete's own three numbers. */
export default function LiveHeader({
  name,
  status,
  athleteCount,
  eventCount,
  context,
  stats,
  detailsHref,
}: {
  name: string;
  status: OnlineCompetitionStatus;
  /** Approved registrations, from the roster route. null until it answers. */
  athleteCount: number | null;
  eventCount: number;
  /** The short line after the status word — the current round, or when
   *  the competition starts. */
  context: string | null;
  /** null when the athlete has no round to describe (signed out, nothing
   *  filed): every cell reads "—". */
  stats: OwnRoundStats | null;
  detailsHref: string;
}) {
  const live = status === 'live';
  const tone = TONE[status];

  return (
    <header
      className="oc-live-head"
      style={{
        border: `1px solid ${live ? '#2B3410' : '#1C1C21'}`,
        background: live ? 'linear-gradient(100deg,#141810,#0D0D10)' : 'linear-gradient(100deg,#141410,#0D0D10)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
        <Link href={detailsHref} className="oc-cd-back" style={{ alignSelf: 'flex-start' }}>
          ← ДЭЛГЭРЭНГҮЙ
        </Link>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 9 }}>
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              flex: 'none',
              borderRadius: '50%',
              background: tone.dot,
              animation: live ? 'khPulse 1.4s ease-in-out infinite' : undefined,
            }}
          />
          <span style={{ font: `700 10px/1 ${MONO}`, letterSpacing: '.24em', color: tone.fg }}>{tone.label}</span>
          {context && (
            <span style={{ font: `500 9px/1.4 ${MONO}`, letterSpacing: '.14em', color: '#6E6A62' }}>{context}</span>
          )}
        </div>
        <h1 style={{ font: `600 26px/1.1 ${HEAD}`, letterSpacing: '-.015em', color: '#F4F1EA', overflowWrap: 'anywhere' }}>
          {name}
        </h1>
        <span style={{ font: `400 11px/1.4 ${MONO}`, color: '#6E6A62' }}>
          {athleteCount ?? '—'} ТАМИРЧИН · {eventCount} ТӨРӨЛ
        </span>
      </div>

      <div
        className="oc-live-stats"
        style={{ display: 'flex', gap: 1, background: '#2A2A31', border: '1px solid #2A2A31', flex: 'none' }}
      >
        <Stat label="МИНИЙ ОРОЛДЛОГО" value={stats ? `${stats.filed} / ${stats.attempts}` : '—'} />
        <Stat
          label={stats?.averageKind === 'single' ? 'ОДООГИЙН СИНГЛ' : 'ОДООГИЙН ДУНДАЖ'}
          value={stats ? fmtResult(stats.average) : '—'}
          volt
        />
        <Stat label="ОДООГИЙН ЗЭРЭГ" value={stats && stats.rank !== null ? `${stats.rank} / ${stats.ranked}` : '—'} />
      </div>
    </header>
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
