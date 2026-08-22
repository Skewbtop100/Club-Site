'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeCompetitions, ensureDailyPracticeCompetition, DAILY_PRACTICE_COMPETITION_ID } from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { saveResult, getResultsByComp, subscribeResultsByComp } from '@/lib/firebase/services/results';
import { fmtTime, parseTime, getMinPlausibleSolveCs, todayDateStr } from '@/lib/time-utils';
import { calcAo5, bestOf, timeToRawDigits, formatRawDigits } from '@/lib/results-entry-helpers';
import { WCA_EVENTS } from '@/lib/wca-events';
import ScramblePreview from '@/components/shared/ScramblePreview';
import { useLang, type TranslationKey } from '@/lib/i18n';
import type { Athlete, Competition, Result } from '@/lib/types';

interface PanelState {
  id: number; athleteId: string; eventId: string; round: number; group: number;
  solves: string[]; penalties: ('none' | '+2' | 'dnf')[];
  currentSolveIdx: number; rawInput: string;
  selectedChip: number | null;   // which prior-solve chip is showing Edit button (during entry)
  editReturnIdx: number | null;  // where to return after editing a prior solve
  postEditMode: boolean;         // in all-entered view: chips are directly tappable to edit
  msg: string; msgType: string;
  /** True once submit() has flagged an implausibly fast solve and is
   *  waiting on a second, explicit "confirm anyway" click before saving. */
  needsConfirm: boolean;
  /** WCA-quality scramble per solve slot (Daily Practice only), parallel to
   *  `solves`. Populated lazily as the admin reaches each slot. */
  scrambles: string[];
  /** True while a scramble is being generated for the current solve slot. */
  scrambleLoading: boolean;
  /** Inspection timer, kept per-panel so starting it on one panel can't
   *  affect another's — each panel renders and drives its own timer. */
  timerMs: number; timerRunning: boolean; timerStopped: boolean;
}

/** A discard/switch action gated behind the confirm modal below — set
 *  whenever the targeted panel has entered-but-unsaved progress. */
interface PendingConfirm {
  kind: 'clear-panel' | 'remove-panel' | 'switch-event' | 'switch-athlete';
  panelId: number;
  /** New eventId/athleteId to apply once confirmed (switch-* kinds only). */
  nextValue?: string;
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
  /** True when importRound >= 2 and this athlete was not in the prior round's
   *  advancing list. Import is still allowed; this is a soft warning. */
  notAdvancing: boolean;
  checked: boolean;
}

// ── shared advancement helpers (kept local; mirror logic in CompResultsTab) ──

function reWcaSort(a: { single: number | null; average: number | null }, b: typeof a): number {
  const score = (r: typeof a): [number, number] => {
    const avg = r.average != null && r.average > 0 ? r.average : null;
    const sng = r.single  != null && r.single  > 0 ? r.single  : null;
    return [avg ?? Infinity, sng ?? Infinity];
  };
  const [pa, sa] = score(a), [pb, sb] = score(b);
  return pa !== pb ? pa - pb : sa - sb;
}

interface AdvLite { type: 'fixed' | 'percent'; value: number }

function reComputeAdvancingNames(
  priorRoundResults: { athleteId?: string; athleteName?: string; single: number | null; average: number | null; status?: string; isPlaceholder?: boolean }[],
  advCfg: AdvLite | undefined,
  athleteIdToFullName: Record<string, string>,
): Set<string> {
  if (!advCfg) return new Set();
  const sorted = [...priorRoundResults]
    .filter(r => !r.isPlaceholder && r.status !== 'withdrawn')
    .sort(reWcaSort);
  const rawCount = advCfg.type === 'fixed' ? advCfg.value : Math.floor(sorted.length * advCfg.value / 100);
  const count = Math.min(Math.max(0, rawCount), sorted.length);
  const advancing = sorted.slice(0, count);
  const names = new Set<string>();
  for (const r of advancing) {
    const fullName = (r.athleteId && athleteIdToFullName[r.athleteId]) || r.athleteName || '';
    if (fullName) names.add(fullName.trim().toLowerCase());
  }
  return names;
}

/** The solve-entry portion of a panel's state — everything that needs to
 *  reset when the admin starts a fresh attempt (a new panel, or an existing
 *  panel's athlete/event changing mid-flow). Athlete/event/round/group are
 *  deliberately excluded: callers decide what to do with those separately. */
function freshSolveState(): Omit<PanelState, 'id' | 'athleteId' | 'eventId' | 'round' | 'group'> {
  return {
    solves: ['', '', '', '', ''], penalties: ['none', 'none', 'none', 'none', 'none'],
    currentSolveIdx: 0, rawInput: '',
    selectedChip: null, editReturnIdx: null, postEditMode: false,
    msg: '', msgType: '', needsConfirm: false,
    scrambles: ['', '', '', '', ''], scrambleLoading: false,
    timerMs: 0, timerRunning: false, timerStopped: false,
  };
}

function emptyPanel(id: number): PanelState {
  return { id, athleteId: '', eventId: '', round: 1, group: 1, ...freshSolveState() };
}

/** True once the admin has entered at least one solve (or is mid-edit on
 *  one) — the signal for "discarding this needs a confirmation." */
function panelHasProgress(p: PanelState): boolean {
  return p.currentSolveIdx > 0 || p.solves.some(s => s !== '');
}

function getRoundNames(totalRounds: number, t: (k: TranslationKey) => string): string[] {
  if (totalRounds <= 1) return [t('admin.round.final')];
  if (totalRounds === 2) return [t('admin.round.first'), t('admin.round.final')];
  if (totalRounds === 3) return [t('admin.round.first'), t('admin.round.second'), t('admin.round.final')];
  return [t('admin.round.first'), t('admin.round.second'), t('admin.round.semi'), t('admin.round.final')];
}

export default function ResultsEntryTab() {
  const { t } = useLang();
  const [athletes, setAthletes]   = useState<Athlete[]>([]);
  const [comps, setComps]         = useState<Competition[]>([]);
  const [compId, setCompId]       = useState('');
  const [panels, setPanels]       = useState<PanelState[]>([emptyPanel(0)]);
  // Panel 0 already exists at mount, so the next fresh id starts at 1. A
  // counter (not panels.length) so ids stay unique even after removing a
  // panel from the middle of the array — reusing .length could collide with
  // a still-live panel's id.
  const nextPanelIdRef = useRef(1);
  const [compResults, setCompResults] = useState<Result[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

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

  // Inspection timer state. showTimer is the one genuinely global bit — a
  // toolbar toggle for whether every panel shows its timer widget at all.
  // The ticking itself is per-panel: timerMs/timerRunning/timerStopped live
  // on PanelState, and these refs are keyed by panel id so each panel's
  // interval/accumulator/beep-milestone tracking is fully independent —
  // starting Panel 1's timer used to also tick Panel 2's because all of this
  // used to be single top-level state shared by every panel's widget.
  const [showTimer, setShowTimer]       = useState(false);
  const timerIntervalRefs = useRef<Record<number, ReturnType<typeof setInterval> | null>>({});
  const timerStartRefs    = useRef<Record<number, number>>({});
  const timerAccRefs      = useRef<Record<number, number>>({});
  const lastMilestoneRefs = useRef<Record<number, number>>({});

  useEffect(() => {
    getAthletes().then(setAthletes);
    ensureDailyPracticeCompetition().catch(() => {});
    const unsub = subscribeCompetitions((data) => setComps(data));
    return unsub;
  }, []);

  useEffect(() => {
    if (!compId) { setCompResults([]); return; }
    const unsub = subscribeResultsByComp(compId, setCompResults);
    return unsub;
  }, [compId]);
  useEffect(() => {
    return () => { Object.values(timerIntervalRefs.current).forEach(id => { if (id) clearInterval(id); }); };
  }, []);

  // Daily Practice: generate a WCA-quality scramble for whichever solve slot
  // is currently active, per panel. Fetched from /api/scramble (server-side,
  // via cstimer_module — the actual csTimer scrambler) rather than generated
  // client-side: cubing/scramble's client-side Web Worker instantiation fails
  // under Next.js's bundler (a known, unresolved cubing.js/Next.js issue —
  // see the route for details), and cstimer_module has no worker involved.
  // Guarded by `scrambles[idx]` already being set, so this is safe to re-run
  // on every panels change (re-typing a solve doesn't re-trigger it) — it
  // only fires for genuinely new, not-yet-scrambled slots.
  const isDailyPracticeCompId = compId === DAILY_PRACTICE_COMPETITION_ID;
  // Tracks (panelId:eventId:slotIdx) combos already attempted (in flight or
  // failed) — a ref, not state, so it can't itself trigger a re-run. Without
  // this, a failed generation reset `scrambleLoading` to false, which changed
  // `panels` and re-ran this effect, which saw the exact same "eligible for a
  // scramble" state and retried immediately — an infinite fail/retry loop
  // that tripped React's "Maximum update depth exceeded" guard.
  const scrambleAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isDailyPracticeCompId) return;
    panels.forEach(p => {
      const idx = p.currentSolveIdx;
      if (!p.athleteId || !p.eventId || idx >= 5) return;
      if (p.scrambles[idx]) return;
      const key = `${p.id}:${p.eventId}:${idx}`;
      if (scrambleAttemptedRef.current.has(key)) return;
      scrambleAttemptedRef.current.add(key);
      updatePanel(p.id, { scrambleLoading: true });
      const eventIdAtFetch = p.eventId;
      fetch(`/api/scramble?event=${encodeURIComponent(eventIdAtFetch)}`)
        .then(res => {
          if (!res.ok) throw new Error(`scramble API returned ${res.status}`);
          return res.json() as Promise<{ scramble?: string; error?: string }>;
        })
        .then(data => {
          if (!data.scramble) throw new Error(data.error || 'empty scramble response');
          setPanels(prev => prev.map(pp => {
            // Bail if the panel moved on (different event/slot) while this was in flight.
            if (pp.id !== p.id || pp.eventId !== eventIdAtFetch || pp.currentSolveIdx !== idx) return pp;
            const scrs = [...pp.scrambles];
            scrs[idx] = data.scramble!;
            return { ...pp, scrambles: scrs, scrambleLoading: false };
          }));
        })
        .catch((err) => {
          console.error('[ResultsEntryTab] scramble generation failed', err);
          updatePanel(p.id, { scrambleLoading: false });
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, isDailyPracticeCompId]);

  function updatePanel(id: number, patch: Partial<PanelState>) {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  // Discard/remove a panel — used by both the "Clear"/"×" per-panel controls
  // and the top toolbar's "Remove" button, after panelHasProgress() has
  // already been confirmed (or found nothing to confirm).
  function doClearPanel(panelId: number) {
    for (const key of [...scrambleAttemptedRef.current]) {
      if (key.startsWith(`${panelId}:`)) scrambleAttemptedRef.current.delete(key);
    }
    resetTimer(panelId);
    updatePanel(panelId, { ...emptyPanel(panelId) });
  }

  function doRemovePanel(panelId: number) {
    if (panels.length <= 1) return;
    for (const key of [...scrambleAttemptedRef.current]) {
      if (key.startsWith(`${panelId}:`)) scrambleAttemptedRef.current.delete(key);
    }
    resetTimer(panelId);
    setPanels(prev => prev.filter(p => p.id !== panelId));
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
      return { ...p, solves: newSolves, currentSolveIdx: nextIdx, rawInput: '', editReturnIdx: null, selectedChip: null, needsConfirm: false };
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

  async function submit(panelId: number, force = false) {
    const panel = panels.find(p => p.id === panelId)!;
    if (!panel.athleteId || !compId || !panel.eventId) {
      updatePanel(panelId, { msg: t('admin.results.msg.fill'), msgType: 'error' }); return;
    }

    const isDailyPractice = compId === DAILY_PRACTICE_COMPETITION_ID;
    const today = todayDateStr();

    // Daily Practice: a second same-day Ao5 for this athlete+event is a hard
    // block, not a silent overwrite. Corrections now happen only through the
    // Daily Practice management tab's Edit flow — re-submitting here used to
    // quietly overwrite the existing entry, which made it too easy to lose
    // the original without meaning to.
    if (isDailyPractice) {
      const alreadyToday = compResults.some(r =>
        r.competitionId === compId &&
        r.eventId === panel.eventId &&
        r.athleteId === panel.athleteId &&
        !r.isPlaceholder &&
        r.practiceDate === today,
      );
      if (alreadyToday) {
        updatePanel(panelId, { msg: t('admin.results.msg.practice-already-recorded'), msgType: 'error', needsConfirm: false });
        return;
      }
    }

    const { single, average, parsed } = computeResult(panel);

    // Any solve entered under the practical minimum (dropped-digit typos
    // like "0.55" instead of "5.55") gets a warning + a required second
    // confirmation instead of silently being saved as a new "best". The
    // floor is per-event — 2x2x2/Pyraminx/Skewb/Square-1/Clock have real
    // WRs well under 3s, so they use a lower floor than 3x3x3-scale events.
    const minCs = getMinPlausibleSolveCs(panel.eventId);
    const hasImplausibleSolve = parsed.some(v => v !== null && v > 0 && v < minCs);
    if (!force && hasImplausibleSolve) {
      updatePanel(panelId, { msg: t('admin.results.msg.implausible'), msgType: 'warn', needsConfirm: true });
      return;
    }

    const comp = comps.find(c => c.id === compId);
    const ath  = athletes.find(a => a.id === panel.athleteId);
    // Daily Practice always writes round 1, date-stamped in the docId — that's
    // what enforces "one Ao5 per athlete per event per day". A same-day
    // resubmission is blocked above now, so this path only ever creates a
    // fresh doc (today's) or a real competition's round doc.
    const docId = isDailyPractice
      ? `${DAILY_PRACTICE_COMPETITION_ID}_${panel.eventId}_r1_${panel.athleteId}_${today}`
      : `${compId}_${panel.eventId}_r${panel.round}_${panel.athleteId}`;

    // Detect whether a non-placeholder result already exists for this
    // (comp, event, round, athlete) — that means we're updating, not creating.
    // Placeholder rows are auto-generated and don't count as a "real" prior
    // result. For Daily Practice this can now only ever be false (a same-day
    // match is blocked above, and the practiceDate check excludes past days),
    // so the "Updated" message below is effectively real-competition-only.
    const existing = compResults.find(r =>
      r.competitionId === compId &&
      r.eventId === panel.eventId &&
      (r.round || 1) === panel.round &&
      r.athleteId === panel.athleteId &&
      !r.isPlaceholder &&
      (!isDailyPractice || r.practiceDate === today),
    );

    // Daily Practice's competition doc has one generic name ("Daily Practice")
    // shared across every day — the result itself gets a date-stamped name
    // instead, so it reads as a specific day's practice everywhere it's
    // displayed (Rankings/Records just render whatever's stored here, no
    // separate competition-name lookup that would override it).
    const competitionName = isDailyPractice
      ? `${t('admin.results.daily-practice-label')} - ${today}`
      : comp?.name || '';

    try {
      await saveResult(docId, {
        athleteId: panel.athleteId, athleteName: ath?.name || '',
        competitionId: compId, competitionName,
        eventId: panel.eventId, round: panel.round,
        single: single < 0 ? single : single, average,
        solves: parsed, status: 'published', source: 'entry',
        penalties: panel.penalties,
        ...(isDailyPractice ? { practiceDate: today, scrambles: panel.scrambles } : {}),
      });
      const fullName = `${ath?.name || ''}${ath?.lastName ? ' ' + ath.lastName : ''}`.trim() || panel.athleteId;
      const msg = existing
        ? `✓ ${t('admin.results.msg.updated-for')} ${fullName} — ${t('admin.results.single')}: ${fmtTime(single)} Ao5: ${fmtTime(average)}`
        : `✓ ${t('result.saved')}! ${t('admin.results.single')}: ${fmtTime(single)} Ao5: ${fmtTime(average)}`;
      updatePanel(panelId, { msg, msgType: 'success', needsConfirm: false });
    } catch (e: unknown) {
      updatePanel(panelId, { msg: t('admin.msg.error-prefix') + (e instanceof Error ? e.message : String(e)), msgType: 'error', needsConfirm: false });
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

  function tapTimer(panelId: number) {
    const panel = panels.find(p => p.id === panelId);
    if (!panel) return;
    if (panel.timerRunning) {
      const ref = timerIntervalRefs.current[panelId];
      if (ref) { clearInterval(ref); timerIntervalRefs.current[panelId] = null; }
      updatePanel(panelId, { timerRunning: false, timerStopped: true });
    } else {
      timerStartRefs.current[panelId] = Date.now() - (timerAccRefs.current[panelId] || 0);
      updatePanel(panelId, { timerRunning: true, timerStopped: false });
      timerIntervalRefs.current[panelId] = setInterval(() => {
        const elapsed = Date.now() - timerStartRefs.current[panelId];
        timerAccRefs.current[panelId] = elapsed;
        updatePanel(panelId, { timerMs: elapsed });
        const s = elapsed / 1000;
        const lastMilestone = lastMilestoneRefs.current[panelId] || 0;
        if (s >= 8  && lastMilestone < 8)  { lastMilestoneRefs.current[panelId] = 8;  playBeep(880,  0.18); }
        if (s >= 12 && lastMilestone < 12) { lastMilestoneRefs.current[panelId] = 12; playBeep(1100, 0.18); }
        if (s >= 17) {
          const ref = timerIntervalRefs.current[panelId];
          if (ref) clearInterval(ref);
          timerIntervalRefs.current[panelId] = null;
          updatePanel(panelId, { timerRunning: false, timerStopped: true });
        }
      }, 30);
    }
  }

  function resetTimer(panelId: number) {
    const ref = timerIntervalRefs.current[panelId];
    if (ref) clearInterval(ref);
    delete timerIntervalRefs.current[panelId];
    delete timerStartRefs.current[panelId];
    delete timerAccRefs.current[panelId];
    delete lastMilestoneRefs.current[panelId];
    updatePanel(panelId, { timerMs: 0, timerRunning: false, timerStopped: false });
  }

  // Stops every panel's timer without touching panel state — used when the
  // whole `panels` array is being thrown away (competition switch), so
  // there's no single panel left to updatePanel() against.
  function resetAllTimers() {
    Object.values(timerIntervalRefs.current).forEach(id => { if (id) clearInterval(id); });
    timerIntervalRefs.current = {};
    timerStartRefs.current = {};
    timerAccRefs.current = {};
    lastMilestoneRefs.current = {};
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
      return { idx: i, name, country, s1, s2, s3, s4, s5, avg, best, hasError: !name, isDupe: false, notAdvancing: false, checked: true };
    });
  }

  function updateImportRow(idx: number, field: keyof Omit<ImportRow, 'idx' | 'hasError' | 'isDupe' | 'checked'>, value: string) {
    setImportRows(prev => prev.map(r => r.idx === idx ? { ...r, [field]: value } : r));
  }

  function toggleImportRow(idx: number) {
    setImportRows(prev => prev.map(r =>
      r.idx === idx && !r.isDupe && !r.notAdvancing ? { ...r, checked: !r.checked } : r,
    ));
  }

  async function checkAndSetRows() {
    const parsed = parseImportText(importText);
    if (!parsed.length) { setImportRows([]); return; }
    setCheckLoading(true);
    try {
      let dupeNames = new Set<string>();
      let advancingNames = new Set<string>();

      if (compId && importEventId) {
        const existing = await getResultsByComp(compId);
        const filtered = existing.filter(r =>
          r.eventId === importEventId &&
          r.round === importRound &&
          r.source === 'imported',
        );
        dupeNames = new Set(filtered.map(r => (r.athleteName || '').trim().toLowerCase()));

        // For round >= 2, build the advancing-names set from the prior round.
        if (importRound >= 2) {
          const advCfg = selComp?.eventConfig?.[importEventId]?.advancement?.[String(importRound - 1)] as AdvLite | undefined;
          const priorRound = existing.filter(r =>
            r.eventId === importEventId && (r.round || 1) === importRound - 1,
          );
          const idToFullName: Record<string, string> = {};
          athletes.forEach(a => {
            idToFullName[a.id] = `${a.name || ''}${a.lastName ? ' ' + a.lastName : ''}`.trim();
          });
          advancingNames = reComputeAdvancingNames(priorRound, advCfg, idToFullName);
        }
      }

      setImportRows(parsed.map(row => {
        const lowerName = row.name.trim().toLowerCase();
        const isDupe = dupeNames.has(lowerName);
        // notAdvancing is only meaningful when we have an advancing list AND the
        // row's name isn't in it. For round 1, advancingNames is empty → false.
        const notAdvancing = advancingNames.size > 0 && !advancingNames.has(lowerName);
        return { ...row, isDupe, notAdvancing, checked: !isDupe && !notAdvancing };
      }));
    } finally {
      setCheckLoading(false);
    }
  }

  async function doImport() {
    // Hard skip non-advancing rows for round 2+. Round 1 has notAdvancing=false
    // for all rows (advancingNames was empty), so no-op there.
    const skippedNonAdvancing = importRows.filter(r => r.notAdvancing);
    const toImport = importRows.filter(r => r.checked && !r.isDupe && !r.notAdvancing);

    if (!compId || !importEventId || toImport.length === 0) {
      // Even if there's nothing to import, still surface the skip summary so
      // the admin understands why nothing was imported.
      if (skippedNonAdvancing.length > 0) {
        const names = skippedNonAdvancing.map(r => r.name).join(', ');
        setImportMsg(
          `${t('admin.results.import.summary-skipped')} ${skippedNonAdvancing.length} ${t('admin.results.import.summary-skipped-reason')} ${names}`,
        );
        setImportMsgType('warn');
      }
      return;
    }

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
      // Build summary: imported count, then skipped (non-advancing) line listing names.
      let summary = `✓ ${t('admin.results.import.summary-imported')} ${toImport.length} ${t('admin.results.import.summary-results-suffix')}`;
      if (skippedNonAdvancing.length > 0) {
        const names = skippedNonAdvancing.map(r => r.name).join(', ');
        summary += `\n${t('admin.results.import.summary-skipped')} ${skippedNonAdvancing.length} ${t('admin.results.import.summary-skipped-reason')} ${names}`;
      }
      setImportMsg(summary);
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
  const isDailyPracticeSelected = !!selComp?.isDailyPractice;
  const evList      = selComp?.events ? WCA_EVENTS.filter(e => (selComp.events as Record<string,boolean>)?.[e.id]) : WCA_EVENTS;
  // Daily Practice is pinned first and given a date-stamped label below —
  // everywhere else it sorts/reads like any other live competition.
  const liveComps   = [...comps.filter(c => c.status === 'live' || c.status === 'upcoming')]
    .sort((a, b) => (a.isDailyPractice ? -1 : b.isDailyPractice ? 1 : 0));
  // Bulk-paste import assumes a real competition's round/group/source shape —
  // not offered for Daily Practice.
  const importableComps = liveComps.filter(c => !c.isDailyPractice);
  const compAthletes = selComp?.athletes;
  const eventConfig = selComp?.eventConfig || {};
  const todayLabel = todayDateStr();

  // Apply an event/athlete switch, resetting the panel's solve-entry state
  // so a finished event's solves can't linger under the new selection —
  // callers (the dropdowns below, and resolvePendingConfirm) decide whether
  // that reset needs confirming first via panelHasProgress().
  function doSwitchEvent(panelId: number, newEventId: string) {
    resetTimer(panelId);
    updatePanel(panelId, { eventId: newEventId, round: 1, group: 1, ...freshSolveState() });
  }

  function doSwitchAthlete(panelId: number, newAthleteId: string, panel: PanelState) {
    resetTimer(panelId);
    const patch: Partial<PanelState> = { athleteId: newAthleteId, ...freshSolveState() };
    // Switching athletes can make the currently-selected event invalid (the
    // new athlete may already have today's Daily Practice entry for it) —
    // clear it rather than leave a now-disabled option selected.
    if (isDailyPracticeSelected && panel.eventId) {
      const alreadyLogged = compResults.some(r =>
        r.athleteId === newAthleteId &&
        r.eventId === panel.eventId &&
        !r.isPlaceholder &&
        r.practiceDate === todayLabel,
      );
      if (alreadyLogged) patch.eventId = '';
    }
    updatePanel(panelId, patch);
  }

  function resolvePendingConfirm() {
    if (!pendingConfirm) return;
    const { kind, panelId, nextValue } = pendingConfirm;
    if (kind === 'clear-panel') doClearPanel(panelId);
    else if (kind === 'remove-panel') doRemovePanel(panelId);
    else if (nextValue !== undefined) {
      const panel = panels.find(p => p.id === panelId);
      if (panel && kind === 'switch-event') doSwitchEvent(panelId, nextValue);
      else if (panel && kind === 'switch-athlete') doSwitchAthlete(panelId, nextValue, panel);
    }
    setPendingConfirm(null);
  }

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />{t('admin.results.title')}</div>

      {/* Competition selector + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ maxWidth: '340px', marginBottom: 0, flex: 1, minWidth: '200px' }}>
          <label>{t('admin.results.competition')}</label>
          <select value={compId} onChange={e => { setCompId(e.target.value); setPanels([emptyPanel(0)]); nextPanelIdRef.current = 1; resetAllTimers(); setShowTimer(false); }}>
            <option value="">{t('admin.results.select-comp')}</option>
            {liveComps.map(c => (
              <option key={c.id} value={c.id}>
                {c.isDailyPractice ? `⭐ ${t('admin.results.daily-practice-label')} - ${todayLabel}` : c.name}
              </option>
            ))}
          </select>
        </div>
        {compId && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', paddingTop: '1.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{t('admin.results.panels')} <strong>{panels.length}</strong></span>
            <button className="btn-xs" onClick={() => setPanels(p => [...p, emptyPanel(nextPanelIdRef.current++)])}>{t('admin.results.add-panel')}</button>
            <button className="btn-xs" onClick={() => {
              if (panels.length <= 1) return;
              const last = panels[panels.length - 1];
              if (panelHasProgress(last)) setPendingConfirm({ kind: 'remove-panel', panelId: last.id });
              else doRemovePanel(last.id);
            }}>{t('admin.results.remove-panel')}</button>
            <button
              className="btn-xs"
              onClick={() => { if (showTimer) { panels.forEach(p => resetTimer(p.id)); setShowTimer(false); } else setShowTimer(true); }}
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
          {panels.map((panel, panelIdx) => {
            const cfg        = eventConfig[panel.eventId] || { rounds: 1, groups: 1 };
            const roundNames = getRoundNames(cfg.rounds, t);
            const groupCount = cfg.groups;
            // In edit mode we're not "all entered" even if currentSolveIdx reached 5
            const allEntered = panel.currentSolveIdx >= 5 && panel.editReturnIdx === null;
            const { single, average } = computeResult(panel);

            // Show all registered athletes for this comp+event. Round-level
            // gating happens on the round dropdown below.
            const panelAthletes = compAthletes
              ? athletes.filter(a => {
                  const ca = compAthletes.find(x => x.id === a.id);
                  if (!ca) return false;
                  if (!panel.eventId) return true;
                  return ca.events.includes(panel.eventId);
                })
              : athletes;

            // Rounds where this athlete already has a real (non-placeholder)
            // result for this comp+event. Used to disable those round options.
            // Not used for Daily Practice (Round/Group are hidden there), but
            // still date-scoped for correctness if that ever changes.
            const completedRounds = new Set<number>(
              panel.athleteId && panel.eventId
                ? compResults
                    .filter(r =>
                      r.competitionId === compId &&
                      r.athleteId === panel.athleteId &&
                      r.eventId === panel.eventId &&
                      !r.isPlaceholder &&
                      (!isDailyPracticeSelected || r.practiceDate === todayLabel),
                    )
                    .map(r => r.round || 1)
                : [],
            );

            // Events this athlete already has a Daily Practice entry for today —
            // disabled in the dropdown so a duplicate can't even be selected.
            // submit()'s hard block is the backstop; this is the discoverable UX.
            const practiceLoggedEventIds = new Set<string>(
              isDailyPracticeSelected && panel.athleteId
                ? compResults
                    .filter(r =>
                      r.athleteId === panel.athleteId &&
                      !r.isPlaceholder &&
                      r.practiceDate === todayLabel,
                    )
                    .map(r => r.eventId)
                : [],
            );

            const curIdx     = panel.currentSolveIdx;
            const curPenalty = curIdx < 5 ? panel.penalties[curIdx] : 'none';
            const preview    = curIdx < 5 && curPenalty !== 'dnf' ? formatRawDigits(panel.rawInput) : '';
            const canAdvance = curPenalty === 'dnf' || panel.rawInput.length > 0;
            const isEditMode = panel.editReturnIdx !== null;

            return (
              <div className="compact-panel" key={panel.id}>
                <div className="compact-panel-header">
                  <span className="compact-panel-title">{t('admin.results.panel')} {panelIdx + 1}</span>
                  <div className="compact-panel-actions">
                    <button className="btn-xs" onClick={() => {
                      if (panelHasProgress(panel)) setPendingConfirm({ kind: 'clear-panel', panelId: panel.id });
                      else doClearPanel(panel.id);
                    }}>{t('admin.results.clear')}</button>
                    <button
                      className="btn-xs"
                      disabled={panels.length <= 1}
                      aria-label={t('admin.results.panel.close')}
                      title={t('admin.results.panel.close')}
                      onClick={() => {
                        if (panels.length <= 1) return;
                        if (panelHasProgress(panel)) setPendingConfirm({ kind: 'remove-panel', panelId: panel.id });
                        else doRemovePanel(panel.id);
                      }}
                      style={{
                        color: panels.length <= 1 ? undefined : '#f87171',
                        borderColor: panels.length <= 1 ? undefined : 'rgba(239,68,68,0.35)',
                        background: panels.length <= 1 ? undefined : 'rgba(239,68,68,0.08)',
                        lineHeight: 1, fontWeight: 700,
                      }}
                    >×</button>
                  </div>
                </div>

                {/* Athlete — switching mid-entry (progress made, not all 5 solves
                    done) discards those solves, so it's gated the same as the
                    Event dropdown below; switching after a completed entry (or
                    with nothing entered yet) applies immediately. */}
                <select className="compact-select" value={panel.athleteId}
                  onChange={e => {
                    const newAthleteId = e.target.value;
                    if (panelHasProgress(panel) && !allEntered) {
                      setPendingConfirm({ kind: 'switch-athlete', panelId: panel.id, nextValue: newAthleteId });
                    } else {
                      doSwitchAthlete(panel.id, newAthleteId, panel);
                    }
                  }}>
                  <option value="">{t('admin.results.select-athlete')}</option>
                  {[...panelAthletes].sort((a,b) => a.name.localeCompare(b.name)).map(a => (
                    <option key={a.id} value={a.id}>{`${a.name || ''}${a.lastName ? ' ' + a.lastName : ''}`}</option>
                  ))}
                </select>

                {/* Event — same mid-entry confirmation as Athlete above. A
                    completed entry (allEntered) switches straight through, since
                    that's the normal "move to the next event" flow. */}
                <select className="compact-select" value={panel.eventId}
                  onChange={e => {
                    const newEventId = e.target.value;
                    if (panelHasProgress(panel) && !allEntered) {
                      setPendingConfirm({ kind: 'switch-event', panelId: panel.id, nextValue: newEventId });
                    } else {
                      doSwitchEvent(panel.id, newEventId);
                    }
                  }}>
                  <option value="">{t('admin.results.select-event')}</option>
                  {evList.map(e => {
                    const isLogged = practiceLoggedEventIds.has(e.id);
                    return (
                      <option key={e.id} value={e.id} disabled={isLogged}>
                        {e.name}{isLogged ? ` (${t('admin.results.already-logged-today')})` : ''}
                      </option>
                    );
                  })}
                </select>

                {/* Round + Group — not meaningful for Daily Practice (always round 1, no groups) */}
                {!isDailyPracticeSelected && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.2rem', paddingLeft: '0.1rem' }}>{t('admin.results.round')}</div>
                      <select className="compact-select" value={panel.round} style={{ marginBottom: 0 }}
                        onChange={e => updatePanel(panel.id, { round: Number(e.target.value) })}>
                        {roundNames.map((name, idx) => {
                          const roundNum = idx + 1;
                          const isLocked = completedRounds.has(roundNum);
                          return (
                            <option key={idx} value={roundNum} disabled={isLocked}>
                              {name}{isLocked ? ' 🔒' : ''}
                            </option>
                          );
                        })}
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
                )}

                {/* ── Inspection Timer (shown when toggled from toolbar) ────── */}
                <div style={{ marginBottom: showTimer ? '0.4rem' : 0 }}>
                  {showTimer && (() => {
                    const color  = timerColor(panel.timerMs);
                    const isDnf  = panel.timerMs / 1000 >= 17;
                    const isPlus2 = panel.timerMs / 1000 >= 15 && !isDnf;
                    return (
                      <div
                        onClick={() => !panel.timerStopped && tapTimer(panel.id)}
                        style={{
                          borderRadius: '10px', overflow: 'hidden',
                          border: `1px solid ${color === '#f8fafc' ? 'rgba(255,255,255,0.1)' : color + '55'}`,
                          cursor: panel.timerStopped ? 'default' : 'pointer',
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
                            {fmtInspection(panel.timerMs)}
                          </div>
                          {isDnf && <div style={{ fontSize: '0.95rem', fontWeight: 700, color, marginTop: '0.4rem' }}>{t('admin.results.dnf-label')}</div>}
                          {isPlus2 && <div style={{ fontSize: '0.95rem', fontWeight: 700, color, marginTop: '0.4rem' }}>{t('admin.results.plus2-label')}</div>}
                          {!panel.timerStopped && (
                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.5rem' }}>
                              {panel.timerRunning ? t('admin.results.tap-to-stop') : t('admin.results.tap-to-start')}
                            </div>
                          )}
                        </div>
                        {panel.timerStopped && (
                          <div style={{ display: 'flex', justifyContent: 'center', padding: '0.45rem', background: 'rgba(0,0,0,0.25)' }}>
                            <button
                              onClick={e => { e.stopPropagation(); resetTimer(panel.id); }}
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

                    {/* Scramble — Daily Practice only; read aloud to the athlete before they solve */}
                    {isDailyPracticeSelected && panel.eventId && (
                      <div style={{
                        marginBottom: '0.6rem', padding: '0.55rem 0.8rem', borderRadius: '10px',
                        background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)',
                        textAlign: 'center', minHeight: '2.3rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {panel.scrambleLoading ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{t('admin.results.scramble-loading')}</span>
                        ) : panel.scrambles[curIdx] ? (
                          <span style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text)', letterSpacing: '0.02em', lineHeight: 1.5 }}>
                            {panel.scrambles[curIdx]}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{t('admin.results.scramble-unavailable')}</span>
                        )}
                      </div>
                    )}

                    {/* Cube-state diagram for the scramble above — lets the judge
                        visually verify the cube was scrambled correctly, rather
                        than reading raw notation. Only mounted once a scramble
                        string actually exists (skipped during loading/failure,
                        same guard as the text above), and unmounts along with the
                        text once the admin moves off this solve slot. */}
                    {isDailyPracticeSelected && panel.eventId && panel.scrambles[curIdx] && (
                      <div style={{
                        marginBottom: '0.6rem', height: '140px',
                        borderRadius: '10px', overflow: 'hidden',
                        background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)',
                        display: 'flex',
                      }}>
                        <ScramblePreview eventId={panel.eventId} scramble={panel.scrambles[curIdx]} />
                      </div>
                    )}

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

                    {panel.needsConfirm && (
                      <button
                        onClick={() => submit(panel.id, true)}
                        style={{
                          width: '100%', minHeight: '44px', borderRadius: '10px',
                          fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                          fontFamily: 'inherit', marginTop: '0.4rem',
                          background: 'rgba(251,191,36,0.15)',
                          border: '1px solid rgba(251,191,36,0.5)',
                          color: '#fbbf24',
                        }}
                      >
                        {t('admin.results.btn.confirm-anyway')}
                      </button>
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
                <select value={compId} onChange={e => { setCompId(e.target.value); setPanels([emptyPanel(0)]); nextPanelIdRef.current = 1; resetAllTimers(); setShowTimer(false); }}>
                  <option value="">{t('admin.results.select-comp')}</option>
                  {importableComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                              disabled={row.isDupe || row.notAdvancing}
                              onChange={() => toggleImportRow(row.idx)}
                              style={{ cursor: (row.isDupe || row.notAdvancing) ? 'not-allowed' : 'pointer', accentColor: '#a78bfa' }}
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
                              {row.notAdvancing && !row.isDupe && (
                                <span
                                  title={t('admin.results.import.not-advancing')}
                                  style={{
                                    fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.4rem',
                                    borderRadius: '4px', whiteSpace: 'nowrap',
                                    background: 'rgba(251,191,36,0.15)',
                                    border: '1px solid rgba(251,191,36,0.45)',
                                    color: '#fbbf24',
                                  }}
                                >⚠ {t('admin.results.import.not-advancing')}</span>
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
              <div className={`msg ${importMsgType}`} style={{ display: 'block', marginTop: '0.5rem', whiteSpace: 'pre-line' }}>
                {importMsg}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Discard/switch confirmation — shared by "Clear", the per-panel "×",
          the top toolbar's "Remove", and switching Athlete/Event mid-entry. */}
      {pendingConfirm && (() => {
        const isSwitch = pendingConfirm.kind === 'switch-event' || pendingConfirm.kind === 'switch-athlete';
        return (
          <div onClick={() => setPendingConfirm(null)} className="wca-modal-backdrop">
            <div onClick={e => e.stopPropagation()} className="wca-modal" style={{ borderColor: 'rgba(239,68,68,0.35)' }}>
              <div className="wca-modal-title">
                {isSwitch ? t('admin.results.confirm.switch-title') : t('admin.results.confirm.discard-title')}
              </div>
              <div className="wca-modal-sub" style={{ marginBottom: '1.25rem' }}>
                {isSwitch ? t('admin.results.confirm.switch-body') : t('admin.results.confirm.discard-body')}
              </div>
              <div className="wca-modal-actions">
                <button onClick={() => setPendingConfirm(null)} className="wca-modal-btn">
                  {t('admin.btn.cancel')}
                </button>
                <button
                  onClick={resolvePendingConfirm} className="wca-modal-btn danger"
                  style={{ background: 'rgba(239,68,68,0.75)', borderColor: 'rgba(239,68,68,0.6)' }}
                >
                  {t('admin.results.confirm.discard-btn')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
