'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAthlete } from '@/lib/firebase/services/athletes';
import { getResultsByAthlete } from '@/lib/firebase/services/results';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { Athlete, Result } from '@/lib/types';

interface Session {
  uid: string; username: string; athleteId: string | null; role: string;
}

interface CompHistoryEntry {
  compId: string; compName: string; date?: string;
  events: { eventId: string; single: number | null; average: number | null; round: number; }[];
}

export default function AthleteView({ session, onLogout }: { session: Session; onLogout: () => void; }) {
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadProfile = useCallback(async () => {
    if (!session.athleteId) { setError('No athlete linked to this account.'); setLoading(false); return; }
    try {
      const athData = await getAthlete(session.athleteId);
      if (!athData) { setError('Athlete profile not found.'); setLoading(false); return; }
      setAthlete(athData);

      const rData = await getResultsByAthlete(session.athleteId);
      setResults(rData);
    } catch (e: unknown) {
      setError('Failed to load profile: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [session.athleteId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // ── Derived stats ──────────────────────────────────────────────
  const validResults = results.filter(r => r.single !== null && (r.single as number) > 0);

  const prs: Record<string, { single: number; average: number | null }> = {};
  for (const r of validResults) {
    const s = r.single as number;
    const prev = prs[r.eventId];
    if (!prev || s < prev.single) {
      prs[r.eventId] = { single: s, average: r.average };
    }
  }

  const compIds = [...new Set(results.map(r => r.competitionId))];
  const totalComps = compIds.length;
  const totalEvents = Object.keys(prs).length;

  const historyMap: Record<string, CompHistoryEntry> = {};
  for (const r of results) {
    if (!historyMap[r.competitionId]) {
      historyMap[r.competitionId] = {
        compId: r.competitionId,
        compName: r.competitionName || r.competitionId,
        events: [],
      };
    }
    historyMap[r.competitionId].events.push({
      eventId: r.eventId,
      single: r.single,
      average: r.average,
      round: r.round || 1,
    });
  }
  const history = Object.values(historyMap);

  const initials = athlete?.name
    ? athlete.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  if (loading) return <div className="state-msg" style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--muted)' }}>Loading your profile…</div>;
  if (error)   return <div className="state-msg error" style={{ textAlign: 'center', padding: '5rem 2rem', color: '#f87171' }}>{error}</div>;
  if (!athlete) return null;

  return (
    <div>
      {/* Profile Header */}
      <div className="profile-header">
        <div className="avatar">
          {athlete.imageUrl
            ? <img src={athlete.imageUrl} alt={athlete.name} />
            : initials}
        </div>
        <div className="profile-info" style={{ flex: 1, minWidth: 0 }}>
          <div className="profile-name">{athlete.name}</div>
          <div className="profile-meta">
            {athlete.wcaId && (
              <span className="profile-meta-item">WCA ID: <b>{athlete.wcaId}</b></span>
            )}
            {athlete.birthDate && (
              <span className="profile-meta-item">Born: <b>{athlete.birthDate}</b></span>
            )}
            {athlete.lastName && (
              <span className="profile-meta-item">Last name: <b>{athlete.lastName}</b></span>
            )}
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat-item">
          <div className="stat-val">{totalComps}</div>
          <div className="stat-label">Competitions</div>
        </div>
        <div className="stat-item">
          <div className="stat-val">{totalEvents}</div>
          <div className="stat-label">Events</div>
        </div>
        <div className="stat-item">
          <div className="stat-val">{results.length}</div>
          <div className="stat-label">Total Results</div>
        </div>
      </div>

      {/* Personal Records */}
      {Object.keys(prs).length > 0 && (
        <div>
          <div className="section-title">Personal Records</div>
          <div className="table-wrap" style={{ marginBottom: '2rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Single</th>
                  <th>Average</th>
                </tr>
              </thead>
              <tbody>
                {WCA_EVENTS
                  .filter(ev => prs[ev.id])
                  .map(ev => (
                    <tr key={ev.id}>
                      <td>{ev.name}</td>
                      <td className="time-val">{fmtTime(prs[ev.id].single)}</td>
                      <td className="time-val">
                        {prs[ev.id].average != null ? fmtTime(prs[ev.id].average!) : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Competition History */}
      {history.length > 0 && (
        <div>
          <div className="section-title">Competition History</div>
          {history.map(comp => (
            <div key={comp.compId} style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#c4b5fd', marginBottom: '0.6rem' }}>
                {comp.compName}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Round</th>
                      <th>Single</th>
                      <th>Average</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comp.events.map((r, i) => {
                      const ev = WCA_EVENTS.find(e => e.id === r.eventId);
                      return (
                        <tr key={i}>
                          <td>{ev?.name || r.eventId}</td>
                          <td className="td-muted">{r.round || 1}</td>
                          <td className="time-val">{fmtTime(r.single)}</td>
                          <td className="time-val">{r.average != null ? fmtTime(r.average) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && (
        <div className="empty-state">
          <div style={{ fontSize: '2rem', marginBottom: '0.6rem' }}>🏆</div>
          <div>No results yet. Compete in your first event!</div>
        </div>
      )}
    </div>
  );
}
