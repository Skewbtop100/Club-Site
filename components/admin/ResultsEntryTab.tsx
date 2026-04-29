'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeCompetitions } from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { saveResult, getResultsByComp } from '@/lib/firebase/services/results';
import { fmtTime, parseTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import { useLang, type TranslationKey } from '@/lib/i18n';
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
  id: number; athleteId: string; eventId: string; round: number; group: number;
  solves: string[]; penalties: ('none' | '+2' | 'dnf')[];
  currentSolveIdx: number; rawInput: string;
  selectedChip: number | null;   // which prior-solve chip is showing Edit button (during entry)
  editReturnIdx: number | null;  // where to return after editing a prior solve
  postEditMode: boolean;         // in all-entered view: chips are directly tappable to edit
  msg: string; msgType: string;
}
interface ImportRow {
  idx: number;
  name: string;
  country: string;
  s1: string; s2: string; s3: string; s4: string; s5: string;
  avg: string;
  best: string;
  hasError: boolean;
  isDupe: boolean;
  checked: boolean;
}

function emptyPanel(id: number): PanelState {
  return {
    id, athleteId: '', eventId: '', round: 1, group: 1,
    solves: ['', '', '', '', ''], penalties: ['none', 'none', 'none', 'none', 'none'],
    currentSolveIdx: 0, rawInput: '',
    selectedChip: null, editReturnIdx: null, postEditMode: false,
    msg: '', msgType: '',
  };
}

/** Strip formatting to get back the raw digit string for re-editing.
 *  "8.11" → "811", "1:11.11" → "11111", "11:11.11" → "111111"
 */
function timeToRawDigits(timeStr: string): string {
  return timeStr.replace(/[^0-9]/g, '');
}

function getRoundNames(totalRounds: number, t: (k: TranslationKey) => string): string[] {
  if (totalRounds <= 1) return [t('admin.round.final')];
  if (totalRounds === 2) return [t('admin.round.first'), t('admin.round.final')];
  if (totalRounds === 3) return [t('admin.round.first'), t('admin.round.second'), t('admin.round.final')];
  return [t('admin.round.first'), t('admin.round.second'), t('admin.round.semi'), t('admin.round.final')];
}

/** Convert raw digit string to parseable time string.
 *  "11" → "0.11", "111" → "1.11", "1111" → "11.11",
 *  "11111" → "1:11.11", "111111" → "11:11.11"
 */
function formatRawDigits(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  const padded = d.length < 2 ? d.padStart(2, '0') : d;
  const cs = padded.slice(-2);
  const rest = padded.slice(0, -2);
  if (!rest || parseInt(rest, 10) === 0) return `0.${cs}`;
  const secsStr = rest.slice(-2).padStart(2, '0');
  const minsStr = rest.slice(0, -2);
  if (!minsStr || parseInt(minsStr, 10) === 0) return `${parseInt(secsStr, 10)}.${cs}`;
  return `${parseInt(minsStr, 10)}:${secsStr}.${cs}`;
}

export default function ResultsEntryTab() {
  const { t } = useLang();
  const [athletes, setAthletes]   = useState<Athlete[]>([]);
  const [comps, setComps]         = useState<Competition[]>([]);
  const [compId, setCompId]       = useState('');
  const [panels, setPanels]       = useState<PanelState[]>([emptyPanel(0)]);

  // Import section state
  const [importOpen,    setImportOpen]    = useState(false);
  const [importEventId, setImportEventId] = useState('');
  const [importRound,   setImportRound]   = useState(1);
  const [importGroup,   setImportGroup]   = useState(1);
  const [importText,    setImportText]    = useState('');
  const [importRows,    setImportRows]    = useState<ImportRow[]>([]);
  const [importMsg,     setImportMsg]     = useState('');
  const [importMsgType, setImportMsgType] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [checkLoading,  setCheckLoading]  = useState(false);

  // Inspection timer state
  const [showTimer, setShowTimer]       = useState(false);
  const [timerMs, setTimerMs]           = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStopped, setTimerStopped] = useState(false);
  const timerIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStartRef     = useRef<number>(0);
  const timerAccRef       = useRef<number>(0);
  const lastMilestoneRef  = useRef<number>(0);

  useEffect(() => {
    getAthletes().then(setAthletes);
    const unsub = subscribeCompetitions((data) => setComps(data));
    return unsub;
  }, []);
  useEffect(() => {
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, []);

  function updatePanel(id: number, patch: Partial<PanelState>) {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  function setPenaltyCurrent(panelId: number, pen: 'none' | '+2' | 'dnf') {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const ps = [...p.penalties];
      const idx = p.currentSolveIdx;
      if (idx >= 5) return p;
      ps[idx] = ps[idx] === pen ? 'none' : pen;
      return { ...p, penalties: ps };
    }));
  }

  function advanceSolve(panelId: number) {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const idx = p.currentSolveIdx;
      if (idx >= 5) return p;
      const newSolves = [...p.solves];
      newSolves[idx] = p.penalties[idx] === 'dnf' ? '' : formatRawDigits(p.rawInput);
      // If we were editing a prior solve, return to the original position
      const nextIdx = p.editReturnIdx !== null ? p.editReturnIdx : idx + 1;
      return { ...p, solves: newSolves, currentSolveIdx: nextIdx, rawInput: '', editReturnIdx: null, selectedChip: null };
    }));
  }

  function startEditPriorSolve(panelId: number, solveIdx: number, returnTo?: number) {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      return {
        ...p,
        currentSolveIdx: solveIdx,
        rawInput: p.penalties[solveIdx] === 'dnf' ? '' : timeToRawDigits(p.solves[solveIdx]),
        editReturnIdx: returnTo !== undefined ? returnTo : p.currentSolveIdx,
        selectedChip: null,
        postEditMode: false,
      };
    }));
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
      updatePanel(panelId, { msg: t('admin.results.msg.fill'), msgType: 'error' }); return;
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
      updatePanel(panelId, { msg: `✓ ${t('result.saved')}! ${t('admin.results.single')}: ${fmtTime(single)} Ao5: ${fmtTime(average)}`, msgType: 'success' });
    } catch (e: unknown) {
      updatePanel(panelId, { msg: t('admin.msg.error-prefix') + (e instanceof Error ? e.message : String(e)), msgType: 'error' });
    }
  }

  // ── Inspection timer helpers ──────────────────────────────────────────────────

  function playBeep(freq: number, dur: number) {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur);
      osc.onended = () => ctx.close();
    } catch { /* audio unavailable */ }
  }

  function tapTimer() {
    if (timerRunning) {
      if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
      setTimerRunning(false);
      setTimerStopped(true);
    } else {
      timerStartRef.current = Date.now() - timerAccRef.current;
      setTimerRunning(true);
      setTimerStopped(false);
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - timerStartRef.current;
        timerAccRef.current = elapsed;
        setTimerMs(elapsed);
        const s = elapsed / 1000;
        if (s >= 8  && lastMilestoneRef.current < 8)  { lastMilestoneRef.current = 8;  playBeep(880,  0.18); }
        if (s >= 12 && lastMilestoneRef.current < 12) { lastMilestoneRef.current = 12; playBeep(1100, 0.18); }
        if (s >= 17) {
          clearInterval(timerIntervalRef.current!);
          timerIntervalRef.current = null;
          setTimerRunning(false);
          setTimerStopped(true);
        }
      }, 30);
    }
  }

  function resetTimer() {
    if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
    setTimerRunning(false);
    setTimerStopped(false);
    timerAccRef.current    = 0;
    lastMilestoneRef.current = 0;
    setTimerMs(0);
  }

  function fmtInspection(ms: number) { return (ms / 1000).toFixed(1) + 's'; }

  // ── Import helpers ────────────────────────────────────────────────────────

  function cleanTimeBadge(s: string): string {
    return s.trim().replace(/[A-Z]{1,3}$/, '').trim();
  }

  // For solve cells: preserve DNF/DNS labels, convert blank to "DNF", strip badges from times.
  function cleanSolveCell(raw: string): string {
    const t = raw.trim();
    if (!t) return 'DNF';
    const u = t.toUpperCase();
    if (u === 'DNF') return 'DNF';
    if (u === 'DNS') return 'DNS';
    return cleanTimeBadge(t);
  }

  function parseImportTime(raw: string): number | null {
    // Check DNF/DNS BEFORE cleanTimeBadge, which would strip all uppercase letters.
    const t = raw.trim();
    if (!t || t === '-' || t === '--') return -1; // blank → DNF
    const u = t.toUpperCase();
    if (u === 'DNF') return -1;
    if (u === 'DNS') return -2;
    const s = cleanTimeBadge(t);
    const m = s.match(/^(\d+):(\d{2})\.(\d{2})$/);
    if (m) return (parseInt(m[1]) * 60 + parseInt(m[2])) * 100 + parseInt(m[3]);
    const n = s.match(/^(\d+)\.(\d{2})$/);
    if (n) return parseInt(n[1]) * 100 + parseInt(n[2]);
    return -1; // unparseable → DNF
  }

  function parseImportText(text: string): ImportRow[] {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (!lines.length) return [];
    const useTabs = lines[0].includes('\t');
    const splitLine = useTabs
      ? (l: string) => l.split('\t')
      : (l: string) => l.trim().split(/\s{2,}/);
    const firstCols = splitLine(lines[0]);
    const firstCell = firstCols[0].replace(/^#/, '').trim();
    const start = !firstCell || isNaN(Number(firstCell)) ? 1 : 0;
    return lines.slice(start).map((line, i) => {
      const cols = splitLine(line);
      const name    = (cols[1] || '').trim();
      const country = (cols[2] || '').trim();
      const s1  = cleanSolveCell(cols[3] || '');
      const s2  = cleanSolveCell(cols[4] || '');
      const s3  = cleanSolveCell(cols[5] || '');
      const s4  = cleanSolveCell(cols[6] || '');
      const s5  = cleanSolveCell(cols[7] || '');
      const avg  = cleanTimeBadge(cols[8] || '');
      const best = cleanTimeBadge(cols[9] || '');
      return { idx: i, name, country, s1, s2, s3, s4, s5, avg, best, hasError: !name, isDupe: false, checked: true };
    });
  }

  function updateImportRow(idx: number, field: keyof Omit<ImportRow, 'idx' | 'hasError' | 'isDupe' | 'checked'>, value: string) {
    setImportRows(prev => prev.map(r => r.idx === idx ? { ...r, [field]: value } : r));
  }

  function toggleImportRow(idx: number) {
    setImportRows(prev => prev.map(r => r.idx === idx && !r.isDupe ? { ...r, checked: !r.checked } : r));
  }

  async function checkAndSetRows() {
    const parsed = parseImportText(importText);
    if (!parsed.length) { setImportRows([]); return; }
    setCheckLoading(true);
    try {
      let dupeNames = new Set<string>();
      if (compId && importEventId) {
        const existing = await getResultsByComp(compId);
        const filtered = existing.filter(r =>
          r.eventId === importEventId &&
          r.round === importRound &&
          r.source === 'imported',
        );
        dupeNames = new Set(filtered.map(r => (r.athleteName || '').trim().toLowerCase()));
      }
      setImportRows(parsed.map(row => {
        const isDupe = dupeNames.has(row.name.trim().toLowerCase());
        return { ...row, isDupe, checked: !isDupe };
      }));
    } finally {
      setCheckLoading(false);
    }
  }

  async function doImport() {
    const toImport = importRows.filter(r => r.checked && !r.isDupe);
    if (!compId || !importEventId || toImport.length === 0) return;
    setImportLoading(true);
    setImportMsg('');
    try {
      const comp = comps.find(c => c.id === compId);
      const ts = Date.now();
      for (let i = 0; i < toImport.length; i++) {
        const row = toImport[i];
        const solves: (number | null)[] = [
          parseImportTime(row.s1), parseImportTime(row.s2), parseImportTime(row.s3),
          parseImportTime(row.s4), parseImportTime(row.s5),
        ];
        const single  = bestOf(solves);
        const average = calcAo5(solves);
        const docId = `imp_${compId}_${importEventId}_r${importRound}_g${importGroup}_${ts}_${i}`;
        await saveResult(docId, {
          athleteId: '', athleteName: row.name, country: row.country,
          competitionId: compId, competitionName: comp?.name || '',
          eventId: importEventId, round: importRound, group: importGroup,
          single, average, solves, status: 'published', source: 'imported',
        });
      }
      const dupeCount = importRows.length - toImport.length;
      setImportMsg(`✓ ${toImport.length} ${t('admin.history.results-suffix')} ${t('result.saved')}.${dupeCount > 0 ? ` (${dupeCount} ${t('admin.results.import.already-imported').toLowerCase()})` : ''}`);
      setImportMsgType('success');
      setImportRows([]);
      setImportText('');
    } catch (e: unknown) {
      setImportMsg(t('admin.msg.error-prefix') + (e instanceof Error ? e.message : String(e)));
      setImportMsgType('error');
    } finally {
      setImportLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  function timerColor(ms: number) {
    const s = ms / 1000;
    if (s >= 17) return '#7f1d1d';
    if (s >= 15) return '#ef4444';
    if (s >= 12) return '#f97316';
    if (s >= 8)  return '#fbbf24';
    return '#f8fafc';
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const selComp     = comps.find(c => c.id === compId);
  const evList      = selComp?.events ? WCA_EVENTS.filter(e => (selComp.events as Record<string,boolean>)?.[e.id]) : WCA_EVENTS;
  const liveComps   = comps.filter(c => c.status === 'live' || c.status === 'upcoming');
  const compAthletes = selComp?.athletes;
  const eventConfig = selComp?.eventConfig || {};

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />{t('admin.results.title')}</div>

      {/* Competition selector + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ maxWidth: '340px', marginBottom: 0, flex: 1, minWidth: '200px' }}>
          <label>{t('admin.results.competition')}</label>
          <select value={compId} onChange={e => { setCompId(e.target.value); setPanels([emptyPanel(0)]); resetTimer(); setShowTimer(false); }}>
            <option value="">{t('admin.results.select-comp')}</option>
            {liveComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {compId && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', paddingTop: '1.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{t('admin.results.panels')} <strong>{panels.length}</strong></span>
            <button className="btn-xs" onClick={() => setPanels(p => [...p, emptyPanel(p.length)])}>{t('admin.results.add-panel')}</button>
            <button className="btn-xs" onClick={() => { if (panels.length <= 1) return; setPanels(p => p.slice(0, -1)); }}>{t('admin.results.remove-panel')}</button>
            <button
              className="btn-xs"
              onClick={() => { if (showTimer) { resetTimer(); setShowTimer(false); } else setShowTimer(true); }}
              style={{
                background: showTimer
                  ? 'linear-gradient(135deg, rgba(45,212,191,0.35), rgba(6,182,212,0.35))'
                  : 'linear-gradient(135deg, rgba(45,212,191,0.15), rgba(6,182,212,0.15))',
                border: `1px solid ${showTimer ? 'rgba(45,212,191,0.65)' : 'rgba(45,212,191,0.35)'}`,
                color: showTimer ? '#5eead4' : '#2dd4bf',
              }}
            >
              {t('admin.results.inspection-timer')}
            </button>
          </div>
        )}
      </div>

      {!compId && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
          {t('admin.results.select-prompt')}
        </div>
      )}


      {/* ── Entry Panels ─────────────────────────────────────────────────────── */}
      {compId && (
        <div className="multi-entry-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {panels.map(panel => {
            const cfg        = eventConfig[panel.eventId] || { rounds: 1, groups: 1 };
            const roundNames = getRoundNames(cfg.rounds, t);
            const groupCount = cfg.groups;
            // In edit mode we're not "all entered" even if currentSolveIdx reached 5
            const allEntered = panel.currentSolveIdx >= 5 && panel.editReturnIdx === null;
            const { single, average } = computeResult(panel);

            const panelAthletes = compAthletes
              ? athletes.filter(a => {
                  const ca = compAthletes.find(x => x.id === a.id);
                  if (!ca) return false;
                  if (!panel.eventId) return true;
                  return ca.events.includes(panel.eventId);
                })
              : athletes;

            const curIdx     = panel.currentSolveIdx;
            const curPenalty = curIdx < 5 ? panel.penalties[curIdx] : 'none';
            const preview    = curIdx < 5 && curPenalty !== 'dnf' ? formatRawDigits(panel.rawInput) : '';
            const canAdvance = curPenalty === 'dnf' || panel.rawInput.length > 0;
            const isEditMode = panel.editReturnIdx !== null;

            return (
              <div className="compact-panel" key={panel.id}>
                <div className="compact-panel-header">
                  <span className="compact-panel-title">{t('admin.results.panel')} {panel.id + 1}</span>
                  <div className="compact-panel-actions">
                    <button className="btn-xs" onClick={() => updatePanel(panel.id, { ...emptyPanel(panel.id) })}>{t('admin.results.clear')}</button>
                  </div>
                </div>

                {/* Athlete */}
                <select className="compact-select" value={panel.athleteId}
                  onChange={e => updatePanel(panel.id, { athleteId: e.target.value })}>
                  <option value="">{t('admin.results.select-athlete')}</option>
                  {[...panelAthletes].sort((a,b) => a.name.localeCompare(b.name)).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>

                {/* Event */}
                <select className="compact-select" value={panel.eventId}
                  onChange={e => updatePanel(panel.id, { eventId: e.target.value, round: 1, group: 1 })}>
                  <option value="">{t('admin.results.select-event')}</option>
                  {evList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>

                {/* Round + Group */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.3rem' }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.2rem', paddingLeft: '0.1rem' }}>{t('admin.results.round')}</div>
                    <select className="compact-select" value={panel.round} style={{ marginBottom: 0 }}
                      onChange={e => updatePanel(panel.id, { round: Number(e.target.value) })}>
                      {roundNames.map((name, idx) => (
                        <option key={idx} value={idx + 1}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.2rem', paddingLeft: '0.1rem' }}>{t('admin.results.group')}</div>
                    <select className="compact-select" value={panel.group} style={{ marginBottom: 0 }}
                      onChange={e => updatePanel(panel.id, { group: Number(e.target.value) })}>
                      {Array.from({ length: Math.max(1, groupCount) }, (_, i) => (
                        <option key={i} value={i + 1}>{t('admin.results.group')} {String.fromCharCode(65 + i)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* ── Inspection Timer (shown when toggled from toolbar) ────── */}
                <div style={{ marginBottom: showTimer ? '0.4rem' : 0 }}>
                  {showTimer && (() => {
                    const color  = timerColor(timerMs);
                    const isDnf  = timerMs / 1000 >= 17;
                    const isPlus2 = timerMs / 1000 >= 15 && !isDnf;
                    return (
                      <div
                        onClick={() => !timerStopped && tapTimer()}
                        style={{
                          borderRadius: '10px', overflow: 'hidden',
                          border: `1px solid ${color === '#f8fafc' ? 'rgba(255,255,255,0.1)' : color + '55'}`,
                          cursor: timerStopped ? 'default' : 'pointer',
                          userSelect: 'none', WebkitUserSelect: 'none',
                        }}
                      >
                        <div style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          padding: '1.25rem 1rem', background: `${color}11`, transition: 'background 0.25s', minHeight: '90px',
                        }}>
                          <div style={{
                            fontSize: '3rem', fontWeight: 800, lineHeight: 1,
                            color, transition: 'color 0.25s', fontVariantNumeric: 'tabular-nums',
                          }}>
                            {fmtInspection(timerMs)}
                          </div>
                          {isDnf && <div style={{ fontSize: '0.95rem', fontWeight: 700, color, marginTop: '0.4rem' }}>{t('admin.results.dnf-label')}</div>}
                          {isPlus2 && <div style={{ fontSize: '0.95rem', fontWeight: 700, color, marginTop: '0.4rem' }}>{t('admin.results.plus2-label')}</div>}
                          {!timerStopped && (
                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.5rem' }}>
                              {timerRunning ? t('admin.results.tap-to-stop') : t('admin.results.tap-to-start')}
                            </div>
                          )}
                        </div>
                        {timerStopped && (
                          <div style={{ display: 'flex', justifyContent: 'center', padding: '0.45rem', background: 'rgba(0,0,0,0.25)' }}>
                            <button
                              onClick={e => { e.stopPropagation(); resetTimer(); }}
                              style={{
                                padding: '0.3rem 1.2rem', borderRadius: '7px', fontSize: '0.8rem',
                                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                                color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                              }}
                            >{t('admin.results.reset')}</button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* ── Solve Entry: one at a time ───────────────────────────── */}
                {!allEntered ? (
                  <div style={{ marginTop: '0.5rem' }}>
                    {/* Progress label */}
                    <div style={{
                      fontSize: '0.72rem', fontWeight: 700,
                      color: isEditMode ? '#a78bfa' : 'var(--muted)',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      textAlign: 'center', marginBottom: '0.4rem',
                    }}>
                      {isEditMode ? `${t('admin.results.editing-solve')} ${curIdx + 1}` : `${t('admin.results.solve-prefix')} ${curIdx + 1} ${t('admin.results.solve-of')}`}
                    </div>

                    {/* Large input */}
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={curPenalty === 'dnf' ? '' : panel.rawInput}
                      placeholder={curPenalty === 'dnf' ? 'DNF' : '0'}
                      readOnly={curPenalty === 'dnf'}
                      onChange={e => {
                        const raw = e.target.value.replace(/\D/g, '').slice(0, 6);
                        updatePanel(panel.id, { rawInput: raw });
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && canAdvance) {
                          e.preventDefault();
                          advanceSolve(panel.id);
                        }
                      }}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        fontSize: '2.2rem', fontWeight: 700, textAlign: 'center',
                        padding: '0.65rem 0.5rem', borderRadius: '10px',
                        marginBottom: '0.3rem', minHeight: '68px',
                        background: curPenalty === 'dnf' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${curPenalty === 'dnf' ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.13)'}`,
                        color: curPenalty === 'dnf' ? '#f87171' : 'var(--text)',
                        fontFamily: 'inherit', outline: 'none',
                      }}
                    />

                    {/* Parsed preview */}
                    <div style={{
                      fontSize: '0.82rem', color: 'var(--muted)', textAlign: 'center',
                      minHeight: '1.3em', marginBottom: '0.5rem',
                    }}>
                      {curPenalty === 'dnf' ? 'DNF' : (preview ? `→ ${preview}` : '')}
                    </div>

                    {/* +2 / DNF / Next buttons */}
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button
                        onClick={() => setPenaltyCurrent(panel.id, '+2')}
                        style={{
                          flex: 1, padding: '0.6rem 0', borderRadius: '8px', fontSize: '0.88rem',
                          fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', minHeight: '48px',
                          background: curPenalty === '+2' ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${curPenalty === '+2' ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'}`,
                          color: curPenalty === '+2' ? '#fbbf24' : 'var(--muted)',
                        }}
                      >+2</button>
                      <button
                        onClick={() => setPenaltyCurrent(panel.id, 'dnf')}
                        style={{
                          flex: 1, padding: '0.6rem 0', borderRadius: '8px', fontSize: '0.88rem',
                          fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', minHeight: '48px',
                          background: curPenalty === 'dnf' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${curPenalty === 'dnf' ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.1)'}`,
                          color: curPenalty === 'dnf' ? '#f87171' : 'var(--muted)',
                        }}
                      >DNF</button>
                      <button
                        onClick={() => canAdvance && advanceSolve(panel.id)}
                        style={{
                          flex: 2, padding: '0.6rem 0', borderRadius: '8px', fontSize: '0.9rem',
                          fontFamily: 'inherit', fontWeight: 700, minHeight: '48px',
                          cursor: canAdvance ? 'pointer' : 'not-allowed',
                          background: canAdvance ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.06)',
                          border: `1px solid ${canAdvance ? 'rgba(124,58,237,0.5)' : 'rgba(124,58,237,0.15)'}`,
                          color: canAdvance ? '#a78bfa' : 'rgba(167,139,250,0.3)',
                        }}
                      >
                        {isEditMode ? t('admin.results.update') : curIdx === 4 ? t('admin.results.done') : t('admin.results.next')}
                      </button>
                    </div>

                    {/* Solves entered so far (tappable chips) */}
                    {(() => {
                      // Determine count of "completed" solves for this view
                      // If in edit mode (editReturnIdx set), the "already done" ones are up to editReturnIdx
                      const completedCount = panel.editReturnIdx !== null ? panel.editReturnIdx : curIdx;
                      // Partial live stats
                      const partialVals = panel.solves.slice(0, completedCount).map((s, i) => {
                        if (panel.penalties[i] === 'dnf') return -1 as number;
                        const v = parseTime(s);
                        if (v === null) return null;
                        return panel.penalties[i] === '+2' ? (v < 0 ? v : v + 200) : v;
                      });
                      const liveBest = bestOf(partialVals);
                      const liveAo5  = completedCount >= 5 ? calcAo5(partialVals) : null;
                      return (
                        <>
                          <div style={{ display: 'flex', gap: '0.2rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            {panel.solves.slice(0, completedCount).map((sv, i) => {
                              const isSelected = panel.selectedChip === i;
                              const isBeingEdited = panel.editReturnIdx !== null && curIdx === i;
                              return (
                                <div key={i} style={{ flex: 1, minWidth: '44px', position: 'relative' }}>
                                  <div
                                    onClick={() => updatePanel(panel.id, {
                                      selectedChip: isSelected ? null : i,
                                    })}
                                    style={{
                                      textAlign: 'center',
                                      padding: '0.28rem 0.15rem', borderRadius: '6px',
                                      fontSize: '0.65rem', cursor: 'pointer',
                                      background: isBeingEdited
                                        ? 'rgba(124,58,237,0.18)'
                                        : isSelected
                                          ? 'rgba(255,255,255,0.07)'
                                          : 'rgba(255,255,255,0.025)',
                                      border: `1px solid ${
                                        isBeingEdited
                                          ? 'rgba(124,58,237,0.5)'
                                          : isSelected
                                            ? 'rgba(255,255,255,0.2)'
                                            : 'rgba(255,255,255,0.07)'
                                      }`,
                                      transition: 'background 0.12s, border-color 0.12s',
                                    }}
                                  >
                                    <div style={{ color: 'rgba(255,255,255,0.3)', marginBottom: '1px' }}>S{i+1}</div>
                                    <div style={{ color: panel.penalties[i] === 'dnf' ? '#f87171' : 'var(--text)', fontWeight: 600 }}>
                                      {panel.penalties[i] === 'dnf' ? 'DNF' : (sv || '—')}
                                      {panel.penalties[i] === '+2' ? '+' : ''}
                                    </div>
                                  </div>
                                  {isSelected && !isBeingEdited && (
                                    <button
                                      onClick={e => { e.stopPropagation(); startEditPriorSolve(panel.id, i); }}
                                      style={{
                                        position: 'absolute', top: '100%', left: '50%',
                                        transform: 'translateX(-50%)',
                                        marginTop: '2px', zIndex: 10,
                                        padding: '0.18rem 0.45rem', borderRadius: '5px',
                                        fontSize: '0.62rem', fontWeight: 700,
                                        whiteSpace: 'nowrap', cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        background: 'rgba(124,58,237,0.85)',
                                        border: '1px solid rgba(124,58,237,0.9)',
                                        color: '#fff',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                                      }}
                                    >
                                      Edit
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {Array.from({ length: 5 - completedCount }, (_, i) => {
                              const slotIdx = completedCount + i;
                              const isCurrent = slotIdx === curIdx;
                              return (
                                <div key={slotIdx} style={{
                                  flex: 1, minWidth: '44px', textAlign: 'center',
                                  padding: '0.28rem 0.15rem', borderRadius: '6px',
                                  fontSize: '0.65rem',
                                  background: isCurrent ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.015)',
                                  border: `1px solid ${isCurrent ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.04)'}`,
                                }}>
                                  <div style={{ color: isCurrent ? 'rgba(167,139,250,0.6)' : 'rgba(255,255,255,0.2)', marginBottom: '1px' }}>S{slotIdx+1}</div>
                                  <div style={{ color: isCurrent ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.15)' }}>
                                    {isCurrent ? '▸' : '—'}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Live Best / Ao5 */}
                          {completedCount > 0 && (
                            <div style={{
                              display: 'flex', justifyContent: 'center', gap: '0.5rem',
                              marginTop: '0.45rem', fontSize: '0.75rem', color: 'var(--muted)',
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              <span>{t('admin.results.live-best')} <strong style={{ color: liveBest > 0 ? 'var(--text)' : 'var(--muted)' }}>{liveBest > 0 ? fmtTime(liveBest) : '—'}</strong></span>
                              <span style={{ opacity: 0.35 }}>|</span>
                              <span>{t('admin.results.live-ao5')} <strong style={{ color: liveAo5 !== null ? (liveAo5 < 0 ? '#f87171' : 'var(--text)') : 'var(--muted)' }}>
                                {liveAo5 !== null ? (liveAo5 < 0 ? 'DNF' : fmtTime(liveAo5)) : '—'}
                              </strong></span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  /* ── All 5 entered — summary + save ─────────────────────── */
                  <div style={{ marginTop: '0.5rem' }}>
                    {/* Solve summary chips — tappable when in postEditMode */}
                    <div style={{ marginBottom: panel.postEditMode ? '0.3rem' : '0.5rem' }}>
                      {panel.postEditMode && (
                        <div style={{
                          fontSize: '0.7rem', fontWeight: 700, color: '#a78bfa',
                          textTransform: 'uppercase', letterSpacing: '0.08em',
                          textAlign: 'center', marginBottom: '0.35rem',
                        }}>
                          {t('admin.results.tap-edit')}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                        {panel.solves.map((sv, i) => (
                          <div
                            key={i}
                            onClick={() => panel.postEditMode && startEditPriorSolve(panel.id, i, 5)}
                            style={{
                              flex: 1, minWidth: '44px', textAlign: 'center',
                              padding: '0.3rem 0.15rem', borderRadius: '6px',
                              fontSize: '0.68rem',
                              cursor: panel.postEditMode ? 'pointer' : 'default',
                              background: panel.postEditMode ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${panel.postEditMode ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.08)'}`,
                              transition: 'background 0.12s, border-color 0.12s',
                            }}
                          >
                            <div style={{ color: 'var(--muted)', marginBottom: '2px' }}>S{i+1}</div>
                            <div style={{ color: panel.penalties[i] === 'dnf' ? '#f87171' : 'var(--text)', fontWeight: 600 }}>
                              {panel.penalties[i] === 'dnf' ? 'DNF' : (sv || '—')}
                              {panel.penalties[i] === '+2' ? '+' : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Single / Ao5 */}
                    <div className="compact-calc-row" style={{ marginBottom: '0.5rem' }}>
                      <div className="calc-item">
                        <div className="calc-label">{t('admin.results.single')}</div>
                        <div className={`calc-value${single < 0 ? ' dnf' : ' accent'}`}>{fmtTime(single)}</div>
                      </div>
                      <div className="calc-item">
                        <div className="calc-label">{t('admin.results.ao5')}</div>
                        <div className={`calc-value${average !== null && average < 0 ? ' dnf' : ' accent'}`}>{fmtTime(average)}</div>
                      </div>
                    </div>

                    {/* Save + Edit buttons (or Cancel when in postEditMode) */}
                    {panel.postEditMode ? (
                      <button
                        onClick={() => updatePanel(panel.id, { postEditMode: false })}
                        style={{
                          width: '100%', minHeight: '48px', borderRadius: '10px',
                          fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                          fontFamily: 'inherit',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          color: 'var(--muted)',
                        }}
                      >
                        {t('admin.btn.cancel')}
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          onClick={() => submit(panel.id)}
                          style={{
                            flex: 2, minHeight: '52px', borderRadius: '10px',
                            fontSize: '1rem', fontWeight: 700, cursor: 'pointer',
                            fontFamily: 'inherit',
                            background: 'rgba(34,197,94,0.2)',
                            border: '1px solid rgba(34,197,94,0.5)',
                            color: '#4ade80',
                          }}
                        >
                          {t('admin.btn.save')}
                        </button>
                        <button
                          onClick={() => updatePanel(panel.id, { postEditMode: true })}
                          style={{
                            flex: 1, minHeight: '52px', borderRadius: '10px',
                            fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                            fontFamily: 'inherit',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            color: 'var(--muted)',
                          }}
                        >
                          {t('admin.btn.edit')}
                        </button>
                      </div>
                    )}
                  </div>
                )}

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

      {/* ── Import External Results ─────────────────────────────────────────── */}
      <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '1rem' }}>
        <button
          onClick={() => setImportOpen(v => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.6rem 0.8rem', borderRadius: '8px', cursor: 'pointer',
            background: importOpen ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.92rem', fontWeight: 600,
          }}
        >
          <span>{t('admin.results.import.title')}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{importOpen ? '▲' : '▼'}</span>
        </button>

        {importOpen && (
          <div style={{ marginTop: '1rem' }}>
            {/* Part 1: Selectors */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('admin.results.competition')}</label>
                <select value={compId} onChange={e => { setCompId(e.target.value); setPanels([emptyPanel(0)]); resetTimer(); setShowTimer(false); }}>
                  <option value="">{t('admin.results.select-comp')}</option>
                  {liveComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('admin.results.event')}</label>
                <select value={importEventId} onChange={e => { setImportEventId(e.target.value); setImportRound(1); setImportGroup(1); }}>
                  <option value="">{t('admin.results.select-event')}</option>
                  {evList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('admin.results.round')}</label>
                <select value={importRound} onChange={e => setImportRound(Number(e.target.value))}>
                  {getRoundNames((importEventId ? eventConfig[importEventId]?.rounds : 0) || 1, t).map((n, i) => (
                    <option key={i} value={i + 1}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('admin.results.group')}</label>
                <select value={importGroup} onChange={e => setImportGroup(Number(e.target.value))}>
                  {Array.from({ length: Math.max(1, (importEventId ? eventConfig[importEventId]?.groups : 0) || 1) }, (_, i) => (
                    <option key={i} value={i + 1}>{t('admin.results.group')} {String.fromCharCode(65 + i)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Part 2: Paste area */}
            <div style={{ marginBottom: '0.75rem' }}>
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                rows={6}
                placeholder={t('admin.results.import.paste-placeholder')}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  padding: '0.65rem 0.75rem', borderRadius: '8px',
                  fontSize: '0.82rem', fontFamily: 'monospace', lineHeight: 1.5,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--text)', outline: 'none', marginBottom: '0.5rem',
                }}
              />
              <button
                onClick={checkAndSetRows}
                disabled={checkLoading}
                style={{
                  padding: '0.5rem 1.2rem', borderRadius: '8px',
                  cursor: checkLoading ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 600,
                  background: 'rgba(124,58,237,0.18)',
                  border: '1px solid rgba(124,58,237,0.45)',
                  color: checkLoading ? 'rgba(167,139,250,0.4)' : '#a78bfa',
                }}
              >
                {checkLoading ? t('admin.results.import.checking') : t('admin.results.import.parse')}
              </button>
            </div>

            {/* Part 4: Preview/Edit table */}
            {importRows.length > 0 && (
              <div style={{ overflowX: 'auto', marginBottom: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      {[
                        { label: '✓',      align: 'center' as const },
                        { label: '#',      align: 'center' as const },
                        { label: 'Name',   align: 'left'   as const },
                        { label: 'Country',align: 'left'   as const },
                        { label: 'S1',     align: 'center' as const },
                        { label: 'S2',     align: 'center' as const },
                        { label: 'S3',     align: 'center' as const },
                        { label: 'S4',     align: 'center' as const },
                        { label: 'S5',     align: 'center' as const },
                        { label: 'Avg',    align: 'center' as const },
                        { label: 'Best',   align: 'center' as const },
                        { label: '',       align: 'center' as const },
                      ].map(({ label, align }, hi) => (
                        <th key={hi} style={{
                          padding: '0.4rem 0.5rem', textAlign: align,
                          color: 'var(--muted)', fontWeight: 600,
                          fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em',
                        }}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => {
                      const isEven = i % 2 === 0;
                      const rowBg = row.hasError
                        ? 'rgba(239,68,68,0.07)'
                        : row.isDupe
                          ? 'rgba(251,191,36,0.04)'
                          : isEven ? 'transparent' : 'rgba(255,255,255,0.018)';
                      const dimmed = row.isDupe || !row.checked;
                      const solveFields = ['s1', 's2', 's3', 's4', 's5'] as const;
                      const inputBase: React.CSSProperties = {
                        padding: '0.18rem 0.3rem', borderRadius: '4px', fontSize: '0.78rem',
                        fontFamily: 'inherit', background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.09)',
                        color: 'var(--text)', outline: 'none', textAlign: 'center',
                        opacity: dimmed ? 0.4 : 1,
                      };
                      return (
                        <tr key={row.idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: rowBg }}>
                          {/* Checkbox */}
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={row.checked}
                              disabled={row.isDupe}
                              onChange={() => toggleImportRow(row.idx)}
                              style={{ cursor: row.isDupe ? 'not-allowed' : 'pointer', accentColor: '#a78bfa' }}
                            />
                          </td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.72rem', opacity: dimmed ? 0.4 : 1 }}>{i + 1}</td>
                          {/* Name */}
                          <td style={{ padding: '0.3rem 0.4rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <input
                                value={row.name}
                                onChange={e => updateImportRow(row.idx, 'name', e.target.value)}
                                style={{
                                  ...inputBase, textAlign: 'left', minWidth: '200px', width: '200px',
                                  border: `1px solid ${row.hasError ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.09)'}`,
                                }}
                              />
                              {row.isDupe && (
                                <span style={{
                                  fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.4rem',
                                  borderRadius: '4px', whiteSpace: 'nowrap',
                                  background: 'rgba(251,191,36,0.15)',
                                  border: '1px solid rgba(251,191,36,0.35)',
                                  color: '#fbbf24',
                                }}>{t('admin.results.import.already-imported')}</span>
                              )}
                            </div>
                          </td>
                          {/* Country */}
                          <td style={{ padding: '0.3rem 0.4rem' }}>
                            <input
                              value={row.country}
                              onChange={e => updateImportRow(row.idx, 'country', e.target.value)}
                              style={{ ...inputBase, textAlign: 'left', width: '90px' }}
                            />
                          </td>
                          {/* S1–S5 */}
                          {solveFields.map(field => (
                            <td key={field} style={{ padding: '0.3rem 0.2rem' }}>
                              <input
                                value={row[field]}
                                onChange={e => updateImportRow(row.idx, field, e.target.value)}
                                style={{ ...inputBase, width: '65px' }}
                              />
                            </td>
                          ))}
                          {/* Avg */}
                          <td style={{ padding: '0.3rem 0.35rem' }}>
                            <input
                              value={row.avg}
                              onChange={e => updateImportRow(row.idx, 'avg', e.target.value)}
                              style={{
                                ...inputBase, width: '68px',
                                fontWeight: 700, fontSize: '0.82rem',
                                color: dimmed ? 'var(--muted)' : '#2dd4bf',
                                border: dimmed ? '1px solid rgba(255,255,255,0.09)' : '1px solid rgba(45,212,191,0.2)',
                                background: dimmed ? 'rgba(255,255,255,0.05)' : 'rgba(45,212,191,0.06)',
                              }}
                            />
                          </td>
                          {/* Best */}
                          <td style={{ padding: '0.3rem 0.35rem' }}>
                            <input
                              value={row.best}
                              onChange={e => updateImportRow(row.idx, 'best', e.target.value)}
                              style={{
                                ...inputBase, width: '68px',
                                fontWeight: 700, fontSize: '0.82rem',
                                color: dimmed ? 'var(--muted)' : '#fbbf24',
                                border: dimmed ? '1px solid rgba(255,255,255,0.09)' : '1px solid rgba(251,191,36,0.2)',
                                background: dimmed ? 'rgba(255,255,255,0.05)' : 'rgba(251,191,36,0.06)',
                              }}
                            />
                          </td>
                          {/* Remove */}
                          <td style={{ padding: '0.3rem 0.5rem' }}>
                            <button
                              onClick={() => setImportRows(r => r.filter(x => x.idx !== row.idx))}
                              style={{
                                padding: '0.18rem 0.5rem', borderRadius: '5px', cursor: 'pointer',
                                fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 600,
                                background: 'rgba(239,68,68,0.12)',
                                border: '1px solid rgba(239,68,68,0.35)',
                                color: '#f87171',
                              }}
                            >{t('admin.results.import.remove')}</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Part 5: Import button */}
            {importRows.length > 0 && (() => {
              const toImport  = importRows.filter(r => r.checked && !r.isDupe);
              const dupeCount = importRows.filter(r => r.isDupe).length;
              const disabled  = importLoading || !compId || !importEventId || toImport.length === 0;
              const label = importLoading
                ? t('admin.results.import.importing')
                : dupeCount > 0
                  ? `${t('admin.results.import.title')}: ${toImport.length} (${dupeCount} ${t('admin.results.import.already-imported').toLowerCase()})`
                  : `${t('admin.results.import.title')}: ${toImport.length}`;
              return (
                <button
                  disabled={disabled}
                  onClick={doImport}
                  style={{
                    width: '100%', padding: '0.7rem', borderRadius: '10px',
                    fontSize: '0.95rem', fontWeight: 700,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    background: disabled ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.2)',
                    border: `1px solid ${disabled ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.5)'}`,
                    color: disabled ? 'rgba(74,222,128,0.4)' : '#4ade80',
                    marginBottom: '0.5rem',
                  }}
                >
                  {label}
                </button>
              );
            })()}

            {importMsg && (
              <div className={`msg ${importMsgType}`} style={{ display: 'block', marginTop: '0.5rem' }}>
                {importMsg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
