'use client';

// GitHub-contribution-style activity grid — last ~12 weeks, one cell per
// day, filled if the athlete practiced ANY event that day (binary, matches
// how Phase 4's streak counts "any event that day" too). Not event-scoped.
//
// Data comes from getPracticeHistoryForAthlete (Phase 1) — already fetches
// every event for this athlete in one query; dates/sessions are just
// grouped client-side, no new query.
//
// Only ever mounted inside AthleteProfileOverlay's "Дасгал" tab, which
// stays hardcoded (no i18n) per the Phase 3 exception — this component
// matches that convention.

import { useEffect, useMemo, useState } from 'react';
import { getPracticeHistoryForAthlete, todayInClubTz } from '@/lib/firebase/services/practiceSessions';
import { getEvent } from '@/lib/wca-events';
import { fmtMs } from '@/lib/timer-engine';
import type { PracticeSession } from '@/lib/types/practice';

const WEEKS = 12;
const DAYS = WEEKS * 7;
const CELL = 12;
const GAP = 3;

/** Weekday index (0=Sun..6=Sat) for a YYYY-MM-DD date, UTC-based like the
 *  rest of this feature's date handling (Asia/Ulaanbaatar has no DST). */
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function dateNDaysBefore(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

export default function PracticeHeatMap({ athleteId }: { athleteId: string }) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPracticeHistoryForAthlete(athleteId)
      .then((s) => { if (!cancelled) setSessions(s); })
      .catch(() => { if (!cancelled) setSessions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [athleteId]);

  const byDate = useMemo(() => {
    const m = new Map<string, PracticeSession[]>();
    for (const s of sessions) {
      const list = m.get(s.date);
      if (list) list.push(s); else m.set(s.date, [s]);
    }
    return m;
  }, [sessions]);

  // Oldest-first list of the last DAYS calendar days, plus leading blanks
  // so the grid's column-major auto-flow lines each cell up with its real
  // weekday row (Sun=0 .. Sat=6).
  const cells = useMemo(() => {
    const today = todayInClubTz();
    const start = dateNDaysBefore(today, DAYS - 1);
    const leadingBlanks = weekdayOf(start);
    const out: (string | null)[] = new Array(leadingBlanks).fill(null);
    for (let i = 0; i < DAYS; i++) out.push(dateNDaysBefore(today, DAYS - 1 - i));
    return out;
  }, []);

  if (loading) {
    return <div className="spinner-row"><span className="spinner-ring" /></div>;
  }

  const selectedSessions = selectedDate ? (byDate.get(selectedDate) ?? []) : [];

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 12, padding: '1rem', marginTop: '1rem',
    }}>
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.7rem',
      }}>
        Идэвхийн зураглал
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateRows: `repeat(7, ${CELL}px)`,
            gridAutoFlow: 'column',
            gridAutoColumns: `${CELL}px`,
            gap: `${GAP}px`,
            width: 'fit-content',
          }}
        >
          {cells.map((date, i) => {
            if (date === null) return <div key={i} />;
            const daySessions = byDate.get(date);
            const practiced = !!daySessions && daySessions.length > 0;
            const isSelected = selectedDate === date;
            return (
              <div
                key={date}
                title={practiced ? `${date} — ${daySessions!.length} session(s)` : date}
                onClick={() => practiced && setSelectedDate(isSelected ? null : date)}
                style={{
                  width: CELL, height: CELL, borderRadius: 3,
                  background: practiced ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                  outline: isSelected ? '2px solid var(--accent2)' : 'none',
                  outlineOffset: 1,
                  cursor: practiced ? 'pointer' : 'default',
                  transition: 'outline-color 0.15s',
                }}
              />
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <div style={{
          marginTop: '0.8rem', padding: '0.6rem 0.7rem', borderRadius: 8,
          background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c4b5fd', marginBottom: '0.35rem' }}>
            {selectedDate}
          </div>
          {selectedSessions.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.15rem 0' }}>
              <span style={{ color: 'var(--muted)' }}>{getEvent(s.event)?.name ?? s.event}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text)' }}>
                {s.ao5 === null ? 'DNF' : fmtMs(s.ao5)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
