'use client';

import { useMemo } from 'react';
import { WCA_EVENTS } from '@/lib/wca-events';
import { fmtTime, betterTime } from '@/lib/time-utils';
import type { Result, Athlete, EventVisibility } from '@/lib/types';

interface Props {
  results: Result[];
  athletes: Athlete[];
  eventVisibility: EventVisibility;
}

function isEventVisible(eventId: string, visibility: EventVisibility, results: Result[]): boolean {
  const vis = visibility[eventId] || 'auto';
  if (vis === 'hide') return false;
  if (vis === 'show') return true;
  return results.some((r) => r.eventId === eventId);
}

interface RecordEntry { time: number; name: string; athleteId: string }

export default function RecordsSection({ results, athletes, eventVisibility }: Props) {
  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    athletes.forEach((a) => { m[a.id] = (a.name || '') + (a.lastName ? ' ' + a.lastName : ''); });
    return m;
  }, [athletes]);

  const { bestSingle, bestAverage } = useMemo(() => {
    const s: Record<string, RecordEntry> = {};
    const a: Record<string, RecordEntry> = {};
    results.forEach((r) => {
      const name = nameMap[r.athleteId] || r.athleteName || r.athleteId;
      if (r.single !== null && r.single !== undefined) {
        if (!s[r.eventId] || betterTime(r.single, s[r.eventId].time)) {
          s[r.eventId] = { time: r.single, name, athleteId: r.athleteId };
        }
      }
      if (r.average !== null && r.average !== undefined) {
        if (!a[r.eventId] || betterTime(r.average, a[r.eventId].time)) {
          a[r.eventId] = { time: r.average, name, athleteId: r.athleteId };
        }
      }
    });
    return { bestSingle: s, bestAverage: a };
  }, [results, nameMap]);

  const visibleEvents = WCA_EVENTS.filter((ev) => isEventVisible(ev.id, eventVisibility, results));

  return (
    <section id="records" style={{ padding: '6rem 2rem', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div className="section-tag">RECORDS</div>
          <h2 className="section-title">Club Records</h2>
          <p className="section-desc">The best single and average ever recorded in each WCA event within our club competitions.</p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: '1rem',
        }}>
          {visibleEvents.map((ev) => {
            const s = bestSingle[ev.id];
            const a = bestAverage[ev.id];
            return (
              <div key={ev.id} className="record-card">
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.9rem' }}>
                  {ev.name}
                </div>

                <RecordRow label="Single Record" entry={s} />
                <RecordRow label="Average Record" entry={a} isAvg />
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        .section-tag {
          display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
          text-transform: uppercase; color: #a78bfa;
          background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
          padding: 0.28rem 0.8rem; border-radius: 999px; margin-bottom: 0.9rem;
        }
        .section-title {
          font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800;
          color: var(--text-primary); margin-bottom: 0.6rem;
        }
        .section-desc { font-size: 1rem; color: var(--muted); max-width: 580px; margin: 0 auto; line-height: 1.65; }
        .record-card {
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 1.4rem;
          transition: border-color 0.25s, box-shadow 0.25s; cursor: default;
        }
        .record-card:hover { border-color: rgba(124,58,237,0.4); box-shadow: 0 0 18px var(--glow); }
        @media (max-width: 768px) { .records-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); } }
      `}</style>
    </section>
  );
}

function RecordRow({ label, entry, isAvg }: { label: string; entry: RecordEntry | undefined; isAvg?: boolean }) {
  return (
    <div style={{
      marginBottom: 0,
      ...(isAvg ? { borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.8rem', marginTop: '0.8rem' } : {}),
    }}>
      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.2rem' }}>
        {label}
      </div>
      {entry ? (
        <>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'monospace', color: '#a78bfa', marginBottom: '0.2rem' }}>
            {fmtTime(entry.time)}
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{entry.name}</div>
        </>
      ) : (
        <div style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: '1.1rem' }}>—</div>
      )}
    </div>
  );
}
