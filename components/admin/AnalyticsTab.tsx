'use client';

import { useEffect, useState } from 'react';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { getCompetitions } from '@/lib/firebase/services/competitions';
import { getAllResults } from '@/lib/firebase/services/results';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';

interface Stat { label: string; value: string | number; sub?: string; }
interface EventStat { eventId: string; count: number; best: number | null; }

export default function AnalyticsTab() {
  const [loading, setLoading] = useState(true);
  const [topStats, setTopStats] = useState<Stat[]>([]);
  const [eventStats, setEventStats] = useState<EventStat[]>([]);

  useEffect(() => {
    async function load() {
      const [athletes, competitions, results] = await Promise.all([
        getAthletes(),
        getCompetitions(),
        getAllResults(),
      ]);
      const validResults = results.filter(r => r.single !== null && Number(r.single) > 0);

      setTopStats([
        { label: 'Total Athletes', value: athletes.length },
        { label: 'Total Competitions', value: competitions.length },
        { label: 'Total Results', value: results.length },
        { label: 'Valid Results', value: validResults.length },
        { label: 'Live Competitions', value: competitions.filter(c => c.status === 'live').length, sub: 'currently live' },
        { label: 'Unique Athletes (results)', value: new Set(results.map(r => r.athleteId)).size },
      ]);

      const evMap: Record<string, { count: number; best: number | null }> = {};
      for (const r of validResults) {
        if (!evMap[r.eventId]) evMap[r.eventId] = { count: 0, best: null };
        evMap[r.eventId].count++;
        const s = Number(r.single);
        if (s > 0 && (evMap[r.eventId].best === null || s < (evMap[r.eventId].best as number))) {
          evMap[r.eventId].best = s;
        }
      }
      setEventStats(
        WCA_EVENTS
          .filter(e => evMap[e.id])
          .map(e => ({ eventId: e.id, count: evMap[e.id].count, best: evMap[e.id].best }))
          .sort((a, b) => b.count - a.count)
      );
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="spinner-row">Loading analytics<span className="spinner-ring" /></div>;

  return (
    <div>
      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {topStats.map((s, i) => (
          <div key={i} style={{
            background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '14px', padding: '1.2rem 1rem', textAlign: 'center',
          }}>
            <div style={{
              fontSize: '2rem', fontWeight: 800,
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>{s.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '0.3rem' }}>{s.label}</div>
            {s.sub && <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.2rem' }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Per-event stats */}
      {eventStats.length > 0 && (
        <div className="card">
          <div className="card-title"><span className="title-accent" />Results by Event</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Results</th>
                  <th>Best Single</th>
                </tr>
              </thead>
              <tbody>
                {eventStats.map(es => {
                  const ev = WCA_EVENTS.find(e => e.id === es.eventId);
                  return (
                    <tr key={es.eventId}>
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ fontFamily: 'monospace', color: '#a78bfa', marginRight: '0.6rem', fontSize: '0.78rem' }}>
                          {ev?.short}
                        </span>
                        {ev?.name || es.eventId}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{
                            height: '6px', borderRadius: '3px',
                            width: `${Math.round((es.count / (eventStats[0]?.count || 1)) * 120)}px`,
                            background: 'linear-gradient(90deg, var(--accent), var(--accent2))',
                            minWidth: '4px',
                          }} />
                          {es.count}
                        </div>
                      </td>
                      <td className="time-val">{fmtTime(es.best)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
