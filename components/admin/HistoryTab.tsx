'use client';

import { useEffect, useState } from 'react';
import { subscribeCompetitions } from '@/lib/firebase/services/competitions';
import { getResultsByComp } from '@/lib/firebase/services/results';
import type { Competition, Result } from '@/lib/types';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';

interface CompCard {
  comp: Competition;
  open: boolean;
  loading: boolean;
  results: Result[];
  evId: string;
}

export default function HistoryTab() {
  const [cards, setCards] = useState<CompCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeCompetitions((comps) => {
      const sorted = [...comps].sort((a, b) => (String(b.date) || '').localeCompare(String(a.date) || ''));
      setCards(prev => {
        const map = new Map(prev.map(c => [c.comp.id, c]));
        return sorted.map(comp => map.get(comp.id) || { comp, open: false, loading: false, results: [], evId: '' });
      });
      setLoading(false);
    });
    return unsub;
  }, []);

  async function toggleCard(compId: string) {
    setCards(prev => prev.map(c => {
      if (c.comp.id !== compId) return c;
      if (!c.open && c.results.length === 0) {
        getResultsByComp(compId).then(r => {
          setCards(prev2 => prev2.map(x => x.comp.id === compId ? { ...x, results: r, loading: false } : x));
        });
        return { ...c, open: true, loading: true };
      }
      return { ...c, open: !c.open };
    }));
  }

  function setEvId(compId: string, evId: string) {
    setCards(prev => prev.map(c => c.comp.id === compId ? { ...c, evId } : c));
  }

  if (loading) return <div className="spinner-row">Loading<span className="spinner-ring" /></div>;

  return (
    <div className="hc-list">
      {cards.length === 0 && <div className="empty-state">No competitions yet.</div>}
      {cards.map(card => {
        const evList = card.comp.events ? WCA_EVENTS.filter(e => (card.comp.events as Record<string,boolean>)?.[e.id]) : [];
        const filtResults = card.evId ? card.results.filter(r => r.eventId === card.evId) : card.results;
        const roundsInEv = card.evId ? [...new Set(filtResults.map(r => r.round || 1))].sort() : [];

        return (
          <div className="hc-card" key={card.comp.id}>
            <div className="hc-header">
              <div className="hc-info">
                <div className="hc-name">{card.comp.name}</div>
                <div className="hc-chips">
                  {card.comp.date && <span className="hc-chip">{String(card.comp.date)}</span>}
                  <span className="hc-chip">{card.comp.status}</span>
                  <span className="hc-chip">{card.results.length || '?'} results</span>
                </div>
              </div>
              <button className={`hc-toggle-btn${card.open ? ' open' : ''}`} onClick={() => toggleCard(card.comp.id)}>
                {card.open ? 'Hide' : 'View Results'}
              </button>
            </div>

            {card.open && (
              <div className="hc-body open">
                {card.loading
                  ? <div style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.83rem' }}>Loading results…</div>
                  : (
                    <>
                      {evList.length > 0 && (
                        <div className="hc-ev-tabs">
                          <button className={`hc-ev-pill${!card.evId ? ' active' : ''}`} onClick={() => setEvId(card.comp.id, '')}>All</button>
                          {evList.map(ev => (
                            <button key={ev.id} className={`hc-ev-pill${card.evId === ev.id ? ' active' : ''}`}
                              onClick={() => setEvId(card.comp.id, ev.id)}>
                              {ev.short}
                            </button>
                          ))}
                        </div>
                      )}
                      {filtResults.length === 0
                        ? <div style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.83rem' }}>No results found.</div>
                        : roundsInEv.length > 0
                          ? roundsInEv.map(r => {
                              const rRows = filtResults.filter(x => (x.round || 1) === r)
                                .sort((a, b) => { const sa = a.single ?? Infinity, sb = b.single ?? Infinity; if (sa < 0 && sb < 0) return 0; if (sa < 0) return 1; if (sb < 0) return -1; return sa - sb; });
                              return (
                                <div key={r}>
                                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#c4b5fd', padding: '0.6rem 1.2rem 0.3rem' }}>Round {r}</div>
                                  <div className="table-wrap" style={{ borderRadius: 0, border: 'none', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                    <table>
                                      <thead>
                                        <tr>
                                          <th>#</th>
                                          <th>Name</th>
                                          <th>Event</th>
                                          <th className="th-r">Single</th>
                                          <th className="th-r">Average</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {rRows.map((row, i) => (
                                          <tr key={row.id}>
                                            <td style={{ color: 'var(--muted)', fontSize: '0.78rem', fontWeight: 700 }}>{i+1}</td>
                                            <td style={{ fontWeight: 600 }}>{row.athleteName || row.athleteId}</td>
                                            <td className="td-muted">{WCA_EVENTS.find(e => e.id === row.eventId)?.short || row.eventId}</td>
                                            <td className="time-val" style={{ textAlign: 'right' }}>{fmtTime(row.single)}</td>
                                            <td className="time-val" style={{ textAlign: 'right' }}>{fmtTime(row.average)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              );
                            })
                          : (
                            <div className="table-wrap" style={{ borderRadius: 0, border: 'none', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                              <table>
                                <thead>
                                  <tr>
                                    <th>#</th><th>Name</th><th>Event</th><th>R</th>
                                    <th className="th-r">Single</th><th className="th-r">Avg</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filtResults
                                    .sort((a,b) => (a.eventId).localeCompare(b.eventId) || (a.round || 1) - (b.round || 1))
                                    .map((row, i) => (
                                      <tr key={row.id}>
                                        <td style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{i+1}</td>
                                        <td style={{ fontWeight: 600 }}>{row.athleteName || row.athleteId}</td>
                                        <td className="td-muted">{WCA_EVENTS.find(e => e.id === row.eventId)?.short || row.eventId}</td>
                                        <td className="td-muted">{row.round || 1}</td>
                                        <td className="time-val" style={{ textAlign: 'right' }}>{fmtTime(row.single)}</td>
                                        <td className="time-val" style={{ textAlign: 'right' }}>{fmtTime(row.average)}</td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          )
                      }
                    </>
                  )
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
