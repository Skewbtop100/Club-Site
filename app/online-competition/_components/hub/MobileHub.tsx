'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { OnlineCompetition, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import { EmptyState } from '../ui';
import { fmtDateTime } from './format';

const TABS: { value: OnlineCompetitionStatus; label: string }[] = [
  { value: 'live', label: 'Явагдаж буй' },
  { value: 'upcoming', label: 'Удахгүй' },
  { value: 'finished', label: 'Дууссан' },
];

const BADGE_CLASS: Record<OnlineCompetitionStatus, string> = {
  live: 'oc-hub-badge-live',
  upcoming: 'oc-hub-badge-outline',
  finished: 'oc-hub-badge-finished',
};

const BADGE_LABEL: Record<OnlineCompetitionStatus, string> = {
  live: 'LIVE',
  upcoming: 'УДАХГҮЙ',
  finished: 'ДУУССАН',
};

export default function MobileHub({
  live,
  upcoming,
  finished,
}: {
  live: OnlineCompetition[];
  upcoming: OnlineCompetition[];
  finished: OnlineCompetition[];
}) {
  const [tab, setTab] = useState<OnlineCompetitionStatus>(live.length > 0 ? 'live' : 'upcoming');
  const byTab: Record<OnlineCompetitionStatus, OnlineCompetition[]> = { live, upcoming, finished };
  const items = byTab[tab];

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="oc-hub-mobile-tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`oc-hub-mobile-tab${tab === t.value ? ' oc-hub-mobile-tab-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState text="Тэмцээн алга." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((c) => (
            <Link key={c.id} href={`/online-competition/${c.id}/details`} className="oc-hub-mobile-card">
              <div className="oc-hub-mobile-card-row">
                <span style={{ font: '500 15px var(--oc-font-heading), sans-serif', color: '#16140F' }}>
                  {c.name}
                </span>
                <span className={BADGE_CLASS[tab]}>{BADGE_LABEL[tab]}</span>
              </div>
              <div className="oc-hub-mobile-card-row">
                <span style={{ font: '400 11px var(--oc-font-mono), monospace', color: '#8A8474' }}>
                  {fmtDateTime(c.startAt)}
                </span>
                {tab === 'upcoming' && (
                  <span
                    style={{
                      font: '500 11px var(--oc-font-mono), monospace',
                      fontVariantNumeric: 'tabular-nums',
                      color: '#4C473C',
                    }}
                  >
                    0{c.participantLimit != null ? ` / ${c.participantLimit}` : ''}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
