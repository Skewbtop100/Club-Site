'use client';

import { useEffect, useState } from 'react';
import { subscribeCompetitions } from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { saveResult } from '@/lib/firebase/services/results';
import { fmtTime, parseTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { Athlete, Competition } from '@/lib/types';

function calcAo5(solves: (number | null)[]): number | null {
  const vals = solves.filter(v => v !== null) as number[];
  if (vals.length < 5) return null;
  const dnfCount = vals.filter(v => v < 0).length;
  if (dnfCount >= 2) return -1;
  const sorted = [...vals].sort((a, b) => { if (a < 0 && b < 0) return 0; if (a < 0) return 1; if (b < 0) return -1; return a - b; });
  const mid = sorted.slice(1, 4);
  if (mid.some(v => v < 0)) return -1;
  return Math.round(mid.reduce((s, v) => s + v, 0) / 3);
}
function bestOf(solves: (number | null)[]): number {
  const v = solves.filter(x => x !== null && Number(x) > 0) as number[];
  return v.length ? Math.min(...v) : -1;
}

interface PanelState {
  id: number; athleteId: string; eventId: string; round: number;
  solves: string[]; penalties: ('none' | '+2' | 'dnf')[];
  msg: string; msgType: string;
}
function emptyPanel(id: number): PanelState {
  return { id, athleteId: '', eventId: '', round: 1, solves: ['','','','',''], penalties: ['none','none','none','none','none'], msg: '', msgType: '' };
}

export default function ResultsEntryTab() {
  const [athletes, setAthletes]   = useState<Athlete[]>([]);
  const [comps, setComps]         = useState<Competition[]>([]);
  const [compId, setCompId]       = useState('');
  const [panels, setPanels]       = useState<PanelState[]>([emptyPanel(0)]);
  const [numCols, setNumCols]     = useState(1);

  useEffect(() => {
    getAthletes().then(setAthletes);
    const unsub = subscribeCompetitions((data) => setComps(data));
    return unsub;
  }, []);

  function updatePanel(id: number, patch: Partial<PanelState>) {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }
  function setSolve(panelId: number, i: number, val: string) {
    setPanels(prev => prev.map(p => { if (p.id !== panelId) return p; const s = [...p.solves]; s[i] = val; return { ...p, solves: s }; }));
  }
  function setPenalty(panelId: number, i: number, pen: 'none' | '+2' | 'dnf') {
    setPanels(prev => prev.map(p => { if (p.id !== panelId) return p; const ps = [...p.penalties]; ps[i] = ps[i] === pen ? 'none' : pen; return { ...p, penalties: ps }; }));
  }

  function computeResult(p: PanelState) {
    const parsed = p.solves.map((s, i) => {
      if (p.penalties[i] === 'dnf') return -1;
      const v = parseTime(s); if (v === null) return null;
      return p.penalties[i] === '+2' ? (v < 0 ? v : v + 200) : v;
    });
    return { single: bestOf(parsed), average: calcAo5(parsed), parsed };
  }

  async function submit(panelId: number) {
    const panel = panels.find(p => p.id === panelId)!;
    if (!panel.athleteId || !compId || !panel.eventId) {
      updatePanel(panelId, { msg: 'Please fill athlete, event and round.', msgType: 'error' }); return;
    }
    const { single, average, parsed } = computeResult(panel);
    const comp = comps.find(c => c.id === compId);
    const ath  = athletes.find(a => a.id === panel.athleteId);
    const docId = `${compId}_${panel.eventId}_r${panel.round}_${panel.athleteId}`;
    try {
      await saveResult(docId, {
        athleteId: panel.athleteId, athleteName: ath?.name || '',
        competitionId: compId, competitionName: comp?.name || '',
        eventId: panel.eventId, round: panel.round,
        single: single < 0 ? single : single, average,
        solves: parsed, status: 'published', source: 'entry',
      });
      updatePanel(panelId, { msg: `✓ Saved! Single: ${fmtTime(single)} Ao5: ${fmtTime(average)}`, msgType: 'success' });
    } catch (e: unknown) {
      updatePanel(panelId, { msg: 'Error: ' + (e instanceof Error ? e.message : String(e)), msgType: 'error' });
    }
  }

  const selComp = comps.find(c => c.id === compId);
  const evList = selComp?.events ? WCA_EVENTS.filter(e => (selComp.events as Record<string,boolean>)?.[e.id]) : WCA_EVENTS;
  const liveComps = comps.filter(c => c.status === 'live' || c.status === 'upcoming');
  const compAthletes = selComp?.athletes;

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />Results Entry</div>

      {/* Competition selector + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ maxWidth: '340px', marginBottom: 0, flex: 1 }}>
          <label>Competition</label>
          <select value={compId} onChange={e => { setCompId(e.target.value); setPanels([emptyPanel(0)]); }}>
            <option value="">— Select competition —</option>
            {liveComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {compId && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', paddingTop: '1.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Panels: <strong>{panels.length}</strong></span>
            <button className="btn-xs" onClick={() => { const np = panels.length + 1; setPanels(p => [...p, emptyPanel(p.length)]); setNumCols(Math.min(np, 3)); }}>+ Add Panel</button>
            <button className="btn-xs" onClick={() => { if (panels.length <= 1) return; setPanels(p => p.slice(0, -1)); setNumCols(Math.min(panels.length - 1, 3)); }}>− Remove</button>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Cols:</span>
            {[1,2,3].map(n => (
              <button key={n} className={`btn-xs${numCols === n ? ' active' : ''}`}
                style={numCols === n ? { background: 'rgba(124,58,237,0.18)', borderColor: 'rgba(124,58,237,0.4)', color: '#a78bfa' } : {}}
                onClick={() => setNumCols(n)}>{n}</button>
            ))}
          </div>
        )}
      </div>

      {!compId && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
          Select a competition to start entering results.
        </div>
      )}

      {compId && (
        <div className="multi-entry-grid" style={{ gridTemplateColumns: `repeat(${numCols}, 1fr)` }}>
          {panels.map(panel => {
            const { single, average } = computeResult(panel);
            const panelAthletes = compAthletes
              ? athletes.filter(a => {
                  const ca = compAthletes.find(x => x.id === a.id);
                  if (!ca) return false;
                  if (!panel.eventId) return true;
                  return ca.events.includes(panel.eventId);
                })
              : athletes;
            return (
              <div className="compact-panel" key={panel.id}>
                <div className="compact-panel-header">
                  <span className="compact-panel-title">Panel {panel.id + 1}</span>
                  <div className="compact-panel-actions">
                    <button className="btn-xs" onClick={() => updatePanel(panel.id, { ...emptyPanel(panel.id) })}>Clear</button>
                  </div>
                </div>

                {/* Athlete */}
                <select className="compact-select" value={panel.athleteId}
                  onChange={e => updatePanel(panel.id, { athleteId: e.target.value })}>
                  <option value="">— Athlete —</option>
                  {[...panelAthletes].sort((a,b) => a.name.localeCompare(b.name)).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>

                {/* Event + Round */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem', marginBottom: '0.3rem' }}>
                  <select className="compact-select" value={panel.eventId} style={{ marginBottom: 0 }}
                    onChange={e => updatePanel(panel.id, { eventId: e.target.value })}>
                    <option value="">— Event —</option>
                    {evList.map(e => <option key={e.id} value={e.id}>{e.short}</option>)}
                  </select>
                  <select className="compact-select" value={panel.round} style={{ marginBottom: 0 }}
                    onChange={e => updatePanel(panel.id, { round: Number(e.target.value) })}>
                    {[1,2,3,4].map(r => <option key={r} value={r}>R{r}</option>)}
                  </select>
                </div>

                {/* Solves */}
                <div className="compact-solves-row">
                  {panel.solves.map((sv, i) => (
                    <div className="solve-group" key={i}>
                      <div className="solve-label">S{i+1}</div>
                      <input
                        className={`solve-input${panel.penalties[i] === 'dnf' ? ' dnf-val' : ''}`}
                        value={panel.penalties[i] === 'dnf' ? 'DNF' : sv}
                        readOnly={panel.penalties[i] === 'dnf'}
                        onChange={e => setSolve(panel.id, i, e.target.value)}
                        style={{ width: '100%', padding: '0.5rem 0.15rem', fontSize: '0.82rem' }}
                      />
                      <div className="solve-btns">
                        <button className={`solve-btn solve-btn-plus2${panel.penalties[i] === '+2' ? ' active' : ''}`}
                          style={{ fontSize: '0.58rem', padding: '0.15rem 0.1rem' }}
                          onClick={() => setPenalty(panel.id, i, '+2')}>+2</button>
                        <button className={`solve-btn solve-btn-dnf${panel.penalties[i] === 'dnf' ? ' active' : ''}`}
                          style={{ fontSize: '0.58rem', padding: '0.15rem 0.1rem' }}
                          onClick={() => setPenalty(panel.id, i, 'dnf')}>DNF</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Calculated */}
                <div className="compact-calc-row">
                  <div className="calc-item">
                    <div className="calc-label">Single</div>
                    <div className={`calc-value${single < 0 ? ' dnf' : ' accent'}`}>{fmtTime(single < 0 ? single : single)}</div>
                  </div>
                  <div className="calc-item">
                    <div className="calc-label">Ao5</div>
                    <div className={`calc-value${average !== null && average < 0 ? ' dnf' : ' accent'}`}>{fmtTime(average)}</div>
                  </div>
                </div>

                <button className="btn-sm-primary" style={{ width: '100%' }} onClick={() => submit(panel.id)}>
                  Submit Result
                </button>
                {panel.msg && <div className={`msg ${panel.msgType}`} style={{ display: 'block', marginTop: '0.5rem' }}>{panel.msg}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
