'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { subscribeCompetitions } from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { subscribeResults, subscribeResultsByComp, saveResult } from '@/lib/firebase/services/results';
import { getAssignmentsByComp } from '@/lib/firebase/services/assignments';
import type { Competition, Athlete, Result } from '@/lib/types';
import type { Assignment } from '@/lib/firebase/services/assignments';
import { fmtTime, parseTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';

// ── helpers ────────────────────────────────────────────────────────
function calcAo5(solves: (number | null)[]): number | null {
  const vals = solves.map(v => (v === null || v === undefined) ? null : Number(v)).filter(v => v !== null) as number[];
  if (vals.length < 5) return null;
  const dnfCount = vals.filter(v => v < 0).length;
  if (dnfCount >= 2) return -1;
  const sorted = [...vals].sort((a, b) => { if (a < 0 && b < 0) return 0; if (a < 0) return 1; if (b < 0) return -1; return a - b; });
  const mid = sorted.slice(1, 4);
  if (mid.some(v => v < 0)) return -1;
  return Math.round(mid.reduce((s, v) => s + v, 0) / 3);
}
function bestSingle(solves: (number | null)[]): number {
  const valid = solves.filter(v => v !== null && v !== undefined && Number(v) > 0) as number[];
  return valid.length ? Math.min(...valid) : -1;
}

// ── Panel state ────────────────────────────────────────────────────
interface PanelState {
  id: number;
  athleteId: string; athleteName: string;
  compId: string; eventId: string; round: number;
  solves: string[];
  penalties: ('none' | '+2' | 'dnf')[];
  msg: string; msgType: string;
}
function emptyPanel(id: number): PanelState {
  return { id, athleteId: '', athleteName: '', compId: '', eventId: '', round: 1, solves: ['', '', '', '', ''], penalties: ['none','none','none','none','none'], msg: '', msgType: '' };
}

interface Session { uid: string; username: string; role: string; }

export default function ResultsEntryView({ session }: { session: Session }) {
  const [tab, setTab]               = useState<'entry' | 'results' | 'assignments'>('entry');
  const [comps, setComps]           = useState<Competition[]>([]);
  const [athletes, setAthletes]     = useState<Athlete[]>([]);
  const [panels, setPanels]         = useState<PanelState[]>([emptyPanel(0)]);
  const [entryCompId, setEntryCompId] = useState('');
  const [allResults, setAllResults] = useState<Result[]>([]);

  // Competition Results state
  const [crCompId, setCrCompId]     = useState('');
  const [crEvId, setCrEvId]         = useState('');
  const [crRound, setCrRound]       = useState(1);
  const [crResults, setCrResults]   = useState<Result[]>([]);
  const unsubCr = useRef<(() => void) | null>(null);

  // Assignments state
  const [asgCompId, setAsgCompId]   = useState('');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [asgEvId, setAsgEvId]       = useState('');

  // ── Boot ────────────────────────────────────────────────────────
  useEffect(() => {
    getAthletes().then(setAthletes);
    const unsubComps = subscribeCompetitions(setComps);
    const unsubResults = subscribeResults(setAllResults);
    return () => { unsubComps(); unsubResults(); };
  }, []);

  // Competition Results feed
  useEffect(() => {
    if (unsubCr.current) { unsubCr.current(); unsubCr.current = null; }
    if (!crCompId) { setCrResults([]); return; }
    const unsub = subscribeResultsByComp(crCompId, setCrResults);
    unsubCr.current = unsub;
    return () => unsub();
  }, [crCompId]);

  // Assignments
  useEffect(() => {
    if (!asgCompId) { setAssignments([]); return; }
    getAssignmentsByComp(asgCompId).then(setAssignments);
  }, [asgCompId]);

  // ── Panel helpers ────────────────────────────────────────────────
  function updatePanel(id: number, patch: Partial<PanelState>) {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  function setSolve(panelId: number, i: number, val: string) {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const solves = [...p.solves]; solves[i] = val;
      return { ...p, solves };
    }));
  }

  function setPenalty(panelId: number, i: number, pen: 'none' | '+2' | 'dnf') {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const penalties = [...p.penalties];
      penalties[i] = penalties[i] === pen ? 'none' : pen;
      return { ...p, penalties };
    }));
  }

  function computeResult(panel: PanelState): { single: number | null; average: number | null; parsed: (number | null)[] } {
    const parsed = panel.solves.map((s, i) => {
      const pen = panel.penalties[i];
      if (pen === 'dnf') return -1;
      const v = parseTime(s);
      if (v === null) return null;
      return pen === '+2' ? (v < 0 ? v : v + 200) : v;
    });
    const single = bestSingle(parsed);
    const average = calcAo5(parsed);
    return { single: single === -1 ? null : single, average, parsed };
  }

  async function submitResult(panelId: number) {
    const panel = panels.find(p => p.id === panelId);
    if (!panel) return;
    if (!panel.athleteId || !panel.compId || !panel.eventId) {
      updatePanel(panelId, { msg: 'Please select athlete, competition and event.', msgType: 'error' });
      return;
    }
    const { single, average, parsed } = computeResult(panel);
    const comp = comps.find(c => c.id === panel.compId);
    const athlete = athletes.find(a => a.id === panel.athleteId);
    const docId = `${panel.compId}_${panel.eventId}_r${panel.round}_${panel.athleteId}`;
    try {
      await saveResult(docId, {
        athleteId: panel.athleteId,
        athleteName: athlete?.name || '',
        competitionId: panel.compId,
        competitionName: comp?.name || '',
        eventId: panel.eventId,
        round: panel.round,
        single, average,
        solves: parsed,
        status: 'published',
        source: 'entry',
        submittedBy: session.uid,
      });
      updatePanel(panelId, { msg: `✓ Saved: ${fmtTime(single)} / ${fmtTime(average)}`, msgType: 'success' });
    } catch (e: unknown) {
      updatePanel(panelId, { msg: 'Error: ' + (e instanceof Error ? e.message : String(e)), msgType: 'error' });
    }
  }

  // ── Competition Results helpers ──────────────────────────────────
  const crComp = comps.find(c => c.id === crCompId);
  const crEvents = crComp?.events
    ? WCA_EVENTS.filter(e => (crComp.events as Record<string,boolean>)?.[e.id])
    : [];
  const crRoundsForEvent = crEvId
    ? [...new Set(allResults.filter(r => r.competitionId === crCompId && r.eventId === crEvId).map(r => r.round || 1))].sort()
    : [];
  const crTableResults = crResults
    .filter(r => r.eventId === crEvId && (r.round || 1) === crRound)
    .sort((a, b) => {
      const sa = a.single ?? Infinity; const sb = b.single ?? Infinity;
      if (sa < 0 && sb < 0) return 0; if (sa < 0) return 1; if (sb < 0) return -1;
      return sa - sb;
    });

  // ── Assignments helpers ─────────────────────────────────────────
  const asgComp = comps.find(c => c.id === asgCompId);
  const asgEvents = asgComp?.events
    ? WCA_EVENTS.filter(e => (asgComp.events as Record<string,boolean>)?.[e.id])
    : [];
  const asgFiltered = assignments.filter(a => !asgEvId || a.eventId === asgEvId);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div>
      {/* Tabs */}
      <div className="tab-nav">
        <button className={`tab-btn${tab === 'entry' ? ' active' : ''}`} onClick={() => setTab('entry')}>✎ Шүүгч</button>
        <button className={`tab-btn${tab === 'results' ? ' active' : ''}`} onClick={() => setTab('results')}>📋 Тэмцээний үзүүлэлт</button>
        <button className={`tab-btn${tab === 'assignments' ? ' active' : ''}`} onClick={() => setTab('assignments')}>👤 Тэмцээний хуваарь</button>
      </div>

      {/* TAB: Results Entry */}
      {tab === 'entry' && (
        <div className="card">
          <div className="card-title"><span className="title-accent" />Үр дүн оруулах</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ maxWidth: '340px', marginBottom: 0, flex: 1 }}>
              <label>Тэмцээн</label>
              <select value={entryCompId} onChange={e => setEntryCompId(e.target.value)}>
                <option value="">— Select competition —</option>
                {comps.filter(c => c.status === 'live' || c.status === 'upcoming').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {entryCompId && (
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', paddingTop: '1.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Panels: <strong>{panels.length}</strong></span>
                <button className="btn-xs" onClick={() => setPanels(prev => [...prev, emptyPanel(prev.length)])}>+ Add</button>
                <button className="btn-xs" onClick={() => setPanels(prev => prev.length > 1 ? prev.slice(0, -1) : prev)}>− Remove</button>
              </div>
            )}
          </div>

          {!entryCompId && (
            <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
              Үр дүнг оруулахын тулд дээрх тэмцээнийг сонгоно уу.
            </div>
          )}

          {entryCompId && (
            <div className="multi-entry-grid" style={{ gridTemplateColumns: `repeat(${Math.min(panels.length, 3)}, 1fr)` }}>
              {panels.map(panel => {
                const comp = comps.find(c => c.id === entryCompId);
                const evList = comp?.events ? WCA_EVENTS.filter(e => (comp.events as Record<string,boolean>)?.[e.id]) : WCA_EVENTS;
                const { single, average } = computeResult(panel);
                return (
                  <div className="compact-panel" key={panel.id}>
                    <div className="compact-panel-header">
                      <span className="compact-panel-title">Panel {panel.id + 1}</span>
                    </div>

                    <select
                      className="compact-select"
                      value={panel.athleteId}
                      onChange={e => {
                        const a = athletes.find(x => x.id === e.target.value);
                        updatePanel(panel.id, { athleteId: e.target.value, athleteName: a?.name || '', compId: entryCompId });
                      }}
                    >
                      <option value="">— Athlete —</option>
                      {athletes.sort((a,b) => a.name.localeCompare(b.name)).map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem', marginBottom: '0.3rem' }}>
                      <select
                        className="compact-select"
                        value={panel.eventId}
                        onChange={e => updatePanel(panel.id, { eventId: e.target.value })}
                        style={{ marginBottom: 0 }}
                      >
                        <option value="">— Event —</option>
                        {evList.map(e => <option key={e.id} value={e.id}>{e.short}</option>)}
                      </select>
                      <select
                        className="compact-select"
                        value={panel.round}
                        onChange={e => updatePanel(panel.id, { round: Number(e.target.value) })}
                        style={{ marginBottom: 0 }}
                      >
                        {[1,2,3,4].map(r => <option key={r} value={r}>R{r}</option>)}
                      </select>
                    </div>

                    <div className="compact-solves-row">
                      {panel.solves.map((sv, i) => (
                        <div className="solve-group" key={i}>
                          <div className="solve-label">S{i+1}</div>
                          <input
                            className={`solve-input${panel.penalties[i] === 'dnf' ? ' dnf-val' : ''}`}
                            value={panel.penalties[i] === 'dnf' ? 'DNF' : sv}
                            readOnly={panel.penalties[i] === 'dnf'}
                            onChange={e => setSolve(panel.id, i, e.target.value)}
                          />
                          <div className="solve-btns">
                            <button
                              className={`solve-btn solve-btn-plus2${panel.penalties[i] === '+2' ? ' active' : ''}`}
                              onClick={() => setPenalty(panel.id, i, '+2')}
                            >+2</button>
                            <button
                              className={`solve-btn solve-btn-dnf${panel.penalties[i] === 'dnf' ? ' active' : ''}`}
                              onClick={() => setPenalty(panel.id, i, 'dnf')}
                            >DNF</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="compact-calc-row">
                      <div className="calc-item">
                        <div className="calc-label">Single</div>
                        <div className={`calc-value${single !== null && single < 0 ? ' dnf' : ' accent'}`}>
                          {fmtTime(single)}
                        </div>
                      </div>
                      <div className="calc-item">
                        <div className="calc-label">Ao5</div>
                        <div className={`calc-value${average !== null && average < 0 ? ' dnf' : ' accent'}`}>
                          {fmtTime(average)}
                        </div>
                      </div>
                    </div>

                    <button className="btn-sm-primary" style={{ width: '100%' }} onClick={() => submitResult(panel.id)}>
                      Submit
                    </button>

                    {panel.msg && (
                      <div className={`msg ${panel.msgType}`} style={{ display: 'block', marginTop: '0.5rem' }}>
                        {panel.msg}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB: Competition Results */}
      {tab === 'results' && (
        <div className="wca-live-layout">
          <div className="wca-sidebar">
            <div className="wca-sidebar-comp-sel">
              <select value={crCompId} onChange={e => { setCrCompId(e.target.value); setCrEvId(''); setCrRound(1); }}>
                <option value="">— Competition —</option>
                {comps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="wca-sidebar-events">
              {!crCompId && <div style={{ padding: '0.9rem 0.85rem', color: 'var(--muted)', fontSize: '0.8rem' }}>Select a competition</div>}
              {crEvents.map(ev => (
                <div
                  key={ev.id}
                  className={`wca-event-item${crEvId === ev.id ? ' active' : ''}`}
                  onClick={() => { setCrEvId(ev.id); setCrRound(1); }}
                >
                  <span className="wca-event-short">{ev.short}</span>
                  <span>{ev.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="wca-main">
            <div className="wca-main-header">
              <div>
                <div className="wca-comp-title">{crComp?.name || 'Select a competition'}</div>
                {crComp && <div className="wca-comp-meta">{crComp.status}</div>}
              </div>
            </div>

            {crEvId && crRoundsForEvent.length > 0 && (
              <div className="wca-event-round-bar">
                <div className="wca-event-round-title">
                  {WCA_EVENTS.find(e => e.id === crEvId)?.name}
                </div>
                <div className="wca-round-tabs">
                  {crRoundsForEvent.map(r => (
                    <button key={r} className={`wca-round-tab${crRound === r ? ' active' : ''}`} onClick={() => setCrRound(r)}>
                      R{r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="wca-table-wrap">
              {!crEvId
                ? <div className="wca-empty">Select an event to view results.</div>
                : crTableResults.length === 0
                  ? <div className="wca-empty">No results yet.</div>
                  : (
                    <table className="wca-results-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Name</th>
                          <th className="th-r">Single</th>
                          <th className="th-r">Average</th>
                          <th className="th-r">S1</th>
                          <th className="th-r">S2</th>
                          <th className="th-r">S3</th>
                          <th className="th-r">S4</th>
                          <th className="th-r">S5</th>
                        </tr>
                      </thead>
                      <tbody>
                        {crTableResults.map((r, i) => {
                          const rankClass = i === 0 ? 'row-gold' : i === 1 ? 'row-silver' : i === 2 ? 'row-bronze' : '';
                          return (
                            <tr key={r.id} className={rankClass}>
                              <td className={`wca-td-rank${i < 3 ? ` wca-rank-${i+1}` : ''}`}>{i+1}</td>
                              <td className="wca-td-name"><div className="wca-name">{r.athleteName || r.athleteId}</div></td>
                              <td className={`wca-td-best${r.single != null && r.single < 0 ? ' dnf-solve' : ''}`}>{fmtTime(r.single)}</td>
                              <td className={`wca-td-avg${r.average != null && r.average < 0 ? ' dnf-avg' : ''}`}>{fmtTime(r.average)}</td>
                              {(r.solves || [null,null,null,null,null]).slice(0,5).map((s, si) => (
                                <td key={si} className={`wca-td-solve${s != null && s < 0 ? ' dnf-solve' : ''}`}>{fmtTime(s)}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )
              }
            </div>
          </div>
        </div>
      )}

      {/* TAB: Assignments */}
      {tab === 'assignments' && (
        <div className="card">
          <div className="card-title"><span className="title-accent" />Assignments</div>
          <div className="form-group" style={{ maxWidth: '340px', marginBottom: '1rem' }}>
            <label>Competition</label>
            <select value={asgCompId} onChange={e => { setAsgCompId(e.target.value); setAsgEvId(''); }}>
              <option value="">— Select competition —</option>
              {comps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {asgCompId && asgEvents.length > 0 && (
            <div className="cao-event-tabs" style={{ marginBottom: '0.8rem' }}>
              <button className={`cao-ev-pill${!asgEvId ? ' active' : ''}`} onClick={() => setAsgEvId('')}>All</button>
              {asgEvents.map(ev => (
                <button key={ev.id} className={`cao-ev-pill${asgEvId === ev.id ? ' active' : ''}`} onClick={() => setAsgEvId(ev.id)}>
                  {ev.short}
                </button>
              ))}
            </div>
          )}

          {!asgCompId
            ? <div className="cao-empty-state">Select a competition to view assignments.</div>
            : assignments.length === 0
              ? <div className="cao-empty-state">No assignments found for this competition.</div>
              : asgFiltered.map((asg, idx) => (
                <div className="cao-heat-card" key={idx}>
                  <div className="cao-heat-header">
                    <span className="cao-heat-label">
                      {WCA_EVENTS.find(e => e.id === asg.eventId)?.name || asg.eventId} — Heat {asg.heat || idx + 1}
                    </span>
                  </div>
                  <div className="cao-heat-body">
                    {(['competitor','judge','scrambler'] as const).map(role => {
                      const names = (asg[role] as string[]) || [];
                      return (
                        <div className="cao-role-group" key={role}>
                          <div className="cao-role-title">{role}</div>
                          <div className="cao-name-list">
                            {names.length
                              ? names.map((n, ni) => <div className="cao-name-tag" key={ni}>{n}</div>)
                              : <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontStyle: 'italic' }}>—</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
          }
        </div>
      )}
    </div>
  );
}
