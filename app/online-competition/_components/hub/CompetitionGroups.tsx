import Link from 'next/link';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { EmptyState } from '../ui';
import { fmtDateTime } from './format';

export default function CompetitionGroups({
  live,
  upcoming,
  finished,
}: {
  live: OnlineCompetition[];
  upcoming: OnlineCompetition[];
  finished: OnlineCompetition[];
}) {
  return (
    <div className="oc-hub-left">
      <section className="oc-hub-group">
        <span className="oc-mono-label">Явагдаж буй</span>
        {live.length === 0 ? (
          <EmptyState text="Тэмцээн алга." />
        ) : (
          <div className="oc-hub-row-list">
            {live.map((c) => (
              <Link key={c.id} href={`/online-competition/${c.id}/details`} className="oc-hub-row-live">
                <div>
                  <p style={{ font: '500 15px var(--oc-font-heading), sans-serif', color: '#16140F' }}>{c.name}</p>
                  <p style={{ marginTop: 4, font: '400 11px var(--oc-font-mono), monospace', color: '#8A8474' }}>
                    {fmtDateTime(c.startAt)}
                  </p>
                </div>
                <span className="oc-hub-badge-live">LIVE</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="oc-hub-group">
        <span className="oc-mono-label">Удахгүй болох</span>
        {upcoming.length === 0 ? (
          <EmptyState text="Тэмцээн алга." />
        ) : (
          <div className="oc-hub-row-list">
            {upcoming.map((c) => (
              <Link key={c.id} href={`/online-competition/${c.id}/details`} className="oc-hub-row-upcoming">
                <div>
                  <p style={{ font: '500 15px var(--oc-font-heading), sans-serif', color: '#16140F' }}>{c.name}</p>
                  <p style={{ marginTop: 4, font: '400 11px var(--oc-font-mono), monospace', color: '#8A8474' }}>
                    {fmtDateTime(c.startAt)}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Real registration counts arrive in Phase 3 — no
                      onlineParticipants-based registration exists yet, and
                      Firestore rules don't let a public client list other
                      users' onlineSubmissions to approximate one. */}
                  <span
                    style={{
                      font: '500 11px var(--oc-font-mono), monospace',
                      fontVariantNumeric: 'tabular-nums',
                      color: '#4C473C',
                    }}
                  >
                    0{c.participantLimit != null ? ` / ${c.participantLimit}` : ''}
                  </span>
                  <span className="oc-hub-badge-outline">УДАХГҮЙ</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="oc-hub-group">
        <span className="oc-mono-label">Дууссан</span>
        {finished.length === 0 ? (
          <EmptyState text="Тэмцээн алга." />
        ) : (
          <div className="oc-hub-row-list">
            {finished.map((c) => (
              <Link key={c.id} href={`/online-competition/${c.id}/details`} className="oc-hub-row-finished">
                <div>
                  <p style={{ font: '500 14px var(--oc-font-heading), sans-serif', color: '#4C473C' }}>{c.name}</p>
                  <p style={{ marginTop: 4, font: '400 11px var(--oc-font-mono), monospace', color: '#A9A392' }}>
                    {fmtDateTime(c.startAt)}
                  </p>
                </div>
                <span className="oc-hub-badge-finished">ДУУССАН</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
