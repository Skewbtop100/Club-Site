'use client';

// Shared core of the Practice Log feature — one Ao5 attempt per athlete per
// WCA event per day. Used both by the self-entry page (app/practice, mode
// 'self') and the admin judge-entry tab (components/admin/PracticeEntryTab,
// mode 'admin'); the caller is responsible for picking `athleteId`/
// `athleteName` (self profile lookup vs admin athlete picker).
//
// The solve-entry UX (digit-by-digit input, +2/DNF chips, tap-to-edit prior
// solves) mirrors components/admin/ResultsEntryTab.tsx's PanelState pattern,
// copied and trimmed to a single event/day/panel rather than imported —
// ResultsEntryTab's helpers are file-private and this feature intentionally
// doesn't touch Competition code.

import { useEffect, useMemo, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { WCA_EVENTS } from '@/lib/wca-events';
import { generateScramble } from '@/lib/scramble';
import { parseTime } from '@/lib/time-utils';
import { fmtMs } from '@/lib/timer-engine';
import { useLang, type TranslationKey } from '@/lib/i18n';
import { getAthletes } from '@/lib/firebase/services/athletes';
import {
  createPracticeSession,
  getTodaysSessionForAthleteEvent,
  getPracticeHistoryForAthleteEvent,
  getPracticeStreak,
  computeAo5,
  todayInClubTz,
} from '@/lib/firebase/services/practiceSessions';
import { getPracticeBadges, type PracticeBadge } from '@/lib/practiceBadges';
import type { Athlete } from '@/lib/types';
import type { PracticeSession } from '@/lib/types/practice';

type Penalty = 'none' | '+2' | 'dnf';

interface EntryState {
  solves: string[];        // formatted centisecond-precision strings, e.g. "1:11.11"
  penalties: Penalty[];
  currentSolveIdx: number;
  rawInput: string;
  editReturnIdx: number | null;
  selectedChip: number | null;
}

function emptyEntry(): EntryState {
  return {
    solves: ['', '', '', '', ''],
    penalties: ['none', 'none', 'none', 'none', 'none'],
    currentSolveIdx: 0,
    rawInput: '',
    editReturnIdx: null,
    selectedChip: null,
  };
}

/** "8.11" → "811", "1:11.11" → "11111" — recover raw digits for re-editing. */
function timeToRawDigits(timeStr: string): string {
  return timeStr.replace(/[^0-9]/g, '');
}

/** "11" → "0.11", "1111" → "11.11", "11111" → "1:11.11" */
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

const BADGE_LABEL_KEY: Record<PracticeBadge, TranslationKey> = {
  new_pr: 'practice.badge.new_pr',
  streak_7: 'practice.badge.streak_7',
  streak_30: 'practice.badge.streak_30',
};

function fullAthleteName(a: Athlete): string {
  return `${a.name || ''}${a.lastName ? ' ' + a.lastName : ''}`.trim();
}

/** Entered solves → centiseconds, -1 for DNF, +2 penalty applied. */
function computeParsedCs(e: EntryState): number[] {
  return e.solves.map((s, i) => {
    if (e.penalties[i] === 'dnf') return -1;
    const v = parseTime(s);
    if (v === null) return -1;
    return e.penalties[i] === '+2' ? v + 200 : v;
  });
}

export default function PracticeEntryPanel({
  athleteId,
  athleteName,
  mode,
  onEventChange,
  onTodayChange,
}: {
  athleteId: string;
  athleteName: string;
  mode: 'self' | 'admin';
  // Optional hooks so a parent (e.g. /practice) can drive a comparison
  // widget / leaderboard for whichever event is currently active, without
  // duplicating the event-selection or today's-session state in two places.
  onEventChange?: (event: string) => void;
  onTodayChange?: (session: PracticeSession | null) => void;
}) {
  const { t } = useLang();

  const [event, setEvent] = useState('');
  const [checking, setChecking] = useState(false);
  const [existing, setExisting] = useState<PracticeSession | null>(null);
  const [justSaved, setJustSaved] = useState<PracticeSession | null>(null);
  const [savedBadges, setSavedBadges] = useState<PracticeBadge[]>([]);
  const [scramble, setScramble] = useState('');
  const [entry, setEntry] = useState<EntryState>(emptyEntry());

  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [judgeQuery, setJudgeQuery] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    getAthletes().then(setAthletes).catch(() => {});
  }, []);

  // Re-check "already recorded today" whenever the event (or, in admin
  // mode, the selected athlete) changes.
  useEffect(() => {
    setEntry(emptyEntry());
    setJudgeQuery('');
    setErrorMsg('');
    setJustSaved(null);
    setSavedBadges([]);
    setExisting(null);
    onTodayChange?.(null);
    if (!event || !athleteId) return;
    let cancelled = false;
    setChecking(true);
    getTodaysSessionForAthleteEvent(athleteId, event)
      .then((session) => {
        if (cancelled) return;
        setExisting(session);
        onTodayChange?.(session);
        if (!session) setScramble(generateScramble(event));
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [event, athleteId]);

  const display = existing ?? justSaved;
  const allEntered = entry.currentSolveIdx >= 5 && entry.editReturnIdx === null;
  const isEditMode = entry.editReturnIdx !== null;
  const curIdx = entry.currentSolveIdx;
  const curPenalty: Penalty = curIdx < 5 ? entry.penalties[curIdx] : 'none';
  const preview = curIdx < 5 && curPenalty !== 'dnf' ? formatRawDigits(entry.rawInput) : '';
  const canAdvance = curPenalty === 'dnf' || entry.rawInput.length > 0;

  const matchedJudge = useMemo(() => {
    const trimmed = judgeQuery.trim().toLowerCase();
    if (!trimmed) return null;
    return athletes.find((a) => fullAthleteName(a).toLowerCase() === trimmed) ?? null;
  }, [judgeQuery, athletes]);

  function updateEntry(patch: Partial<EntryState>) {
    setEntry((prev) => ({ ...prev, ...patch }));
  }

  function setPenalty(pen: Penalty) {
    setEntry((prev) => {
      const idx = prev.currentSolveIdx;
      if (idx >= 5) return prev;
      const ps = [...prev.penalties];
      ps[idx] = ps[idx] === pen ? 'none' : pen;
      return { ...prev, penalties: ps };
    });
  }

  function advanceSolve() {
    setEntry((prev) => {
      const idx = prev.currentSolveIdx;
      if (idx >= 5) return prev;
      const newSolves = [...prev.solves];
      newSolves[idx] = prev.penalties[idx] === 'dnf' ? '' : formatRawDigits(prev.rawInput);
      const nextIdx = prev.editReturnIdx !== null ? prev.editReturnIdx : idx + 1;
      return { ...prev, solves: newSolves, currentSolveIdx: nextIdx, rawInput: '', editReturnIdx: null, selectedChip: null };
    });
  }

  function startEditPriorSolve(solveIdx: number, returnTo?: number) {
    setEntry((prev) => ({
      ...prev,
      currentSolveIdx: solveIdx,
      rawInput: prev.penalties[solveIdx] === 'dnf' ? '' : timeToRawDigits(prev.solves[solveIdx]),
      editReturnIdx: returnTo !== undefined ? returnTo : prev.currentSolveIdx,
      selectedChip: null,
    }));
  }

  async function handleSave() {
    setErrorMsg('');
    const trimmedJudge = judgeQuery.trim();
    if (!trimmedJudge) {
      setErrorMsg(t('practice.judge-required'));
      return;
    }
    setSaving(true);
    try {
      const parsedCs = computeParsedCs(entry);
      const msSolves = parsedCs.map((v) => (v === -1 ? -1 : Math.floor(v * 10)));
      const ao5 = computeAo5(msSolves);
      const data = {
        athleteId,
        athleteName,
        event,
        date: todayInClubTz(),
        scramble,
        solves: msSolves,
        ao5,
        judgeId: matchedJudge ? matchedJudge.id : null,
        judgeName: matchedJudge ? fullAthleteName(matchedJudge) : trimmedJudge,
        enteredByAdmin: mode === 'admin',
      };
      const id = await createPracticeSession(data);
      const saved: PracticeSession = { id, ...data, createdAt: Timestamp.now() };
      setJustSaved(saved);
      onTodayChange?.(saved);

      // Badges are derived, not stored — recompute from history + streak
      // right after the write. A failure here shouldn't blow up the save
      // that already succeeded, so it's a soft best-effort follow-up.
      try {
        const [eventHistory, streak] = await Promise.all([
          getPracticeHistoryForAthleteEvent(athleteId, event),
          getPracticeStreak(athleteId),
        ]);
        setSavedBadges(getPracticeBadges(saved, eventHistory, streak.currentStreak));
      } catch {
        setSavedBadges([]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already recorded/i.test(msg)) {
        setErrorMsg(t('practice.already-recorded-error'));
        const fresh = await getTodaysSessionForAthleteEvent(athleteId, event).catch(() => null);
        if (fresh) { setExisting(fresh); onTodayChange?.(fresh); }
      } else {
        setErrorMsg(`${t('practice.error-prefix')}${msg}`);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!athleteId) return null;

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />{t('practice.title')}</div>

      <div className="form-group" style={{ maxWidth: 320 }}>
        <label>{t('practice.event-label')}</label>
        <select className="compact-select" value={event} onChange={(e) => { setEvent(e.target.value); onEventChange?.(e.target.value); }}>
          <option value="">{t('practice.select-event')}</option>
          {WCA_EVENTS.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {!event && (
        <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
          {t('practice.select-event-prompt')}
        </div>
      )}

      {event && checking && (
        <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
          {t('practice.checking')}
        </div>
      )}

      {/* ── Already recorded today: read-only ─────────────────────────── */}
      {event && !checking && display && (
        <div className="compact-panel" style={{ maxWidth: 420 }}>
          <div className="msg success" style={{ display: 'block', marginBottom: '0.7rem' }}>
            {t('practice.already-recorded-title')}
            {display.enteredByAdmin && ` · ${t('practice.entered-by-admin')}`}
          </div>

          {justSaved && savedBadges.length > 0 && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.7rem',
            }}>
              {savedBadges.map((b) => (
                <span key={b} style={{
                  fontSize: '0.78rem', fontWeight: 700, padding: '0.3rem 0.65rem', borderRadius: 999,
                  background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.45)',
                  color: '#fbbf24',
                }}>
                  {t(BADGE_LABEL_KEY[b])}
                </span>
              ))}
            </div>
          )}

          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.2rem' }}>
            {t('practice.scramble')}
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.5,
            padding: '0.6rem 0.75rem', borderRadius: 8, marginBottom: '0.7rem',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
          }}>
            {display.scramble}
          </div>

          <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.7rem', flexWrap: 'wrap' }}>
            {display.solves.map((v, i) => (
              <div key={i} style={{
                flex: 1, minWidth: 56, textAlign: 'center', padding: '0.35rem 0.2rem',
                borderRadius: 6, fontSize: '0.75rem',
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              }}>
                <div style={{ color: 'var(--muted)', marginBottom: 2 }}>S{i + 1}</div>
                <div style={{ fontWeight: 600, color: v === -1 ? '#f87171' : 'var(--text)' }}>
                  {fmtMs(v, v === -1)}
                </div>
              </div>
            ))}
          </div>

          <div className="compact-calc-row" style={{ marginBottom: '0.6rem' }}>
            <div className="calc-item">
              <div className="calc-label">{t('practice.ao5')}</div>
              <div className={`calc-value${display.ao5 === null ? ' dnf' : ' accent'}`}>
                {fmtMs(display.ao5 ?? 0, display.ao5 === null)}
              </div>
            </div>
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            {t('practice.judge-label')}: <strong style={{ color: 'var(--text)' }}>{display.judgeName ?? '—'}</strong>
          </div>
        </div>
      )}

      {/* ── New entry ──────────────────────────────────────────────────── */}
      {event && !checking && !display && (
        <div className="compact-panel" style={{ maxWidth: 420 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.2rem' }}>
            {t('practice.scramble')}
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.5,
            padding: '0.6rem 0.75rem', borderRadius: 8, marginBottom: '0.8rem',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
          }}>
            {scramble}
          </div>

          {!allEntered ? (
            <div>
              <div style={{
                fontSize: '0.72rem', fontWeight: 700,
                color: isEditMode ? '#a78bfa' : 'var(--muted)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                textAlign: 'center', marginBottom: '0.4rem',
              }}>
                {isEditMode ? `${t('practice.editing-solve')} ${curIdx + 1}` : `${t('practice.solve')} ${curIdx + 1} ${t('practice.solve-of')}`}
              </div>

              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={curPenalty === 'dnf' ? '' : entry.rawInput}
                placeholder={curPenalty === 'dnf' ? 'DNF' : '0'}
                readOnly={curPenalty === 'dnf'}
                onChange={(e) => updateEntry({ rawInput: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                onKeyDown={(e) => { if (e.key === 'Enter' && canAdvance) { e.preventDefault(); advanceSolve(); } }}
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

              <div style={{ fontSize: '0.82rem', color: 'var(--muted)', textAlign: 'center', minHeight: '1.3em', marginBottom: '0.5rem' }}>
                {curPenalty === 'dnf' ? 'DNF' : (preview ? `→ ${preview}` : '')}
              </div>

              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  onClick={() => setPenalty('+2')}
                  style={{
                    flex: 1, padding: '0.6rem 0', borderRadius: '8px', fontSize: '0.88rem',
                    fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', minHeight: '48px',
                    background: curPenalty === '+2' ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${curPenalty === '+2' ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    color: curPenalty === '+2' ? '#fbbf24' : 'var(--muted)',
                  }}
                >+2</button>
                <button
                  onClick={() => setPenalty('dnf')}
                  style={{
                    flex: 1, padding: '0.6rem 0', borderRadius: '8px', fontSize: '0.88rem',
                    fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', minHeight: '48px',
                    background: curPenalty === 'dnf' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${curPenalty === 'dnf' ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.1)'}`,
                    color: curPenalty === 'dnf' ? '#f87171' : 'var(--muted)',
                  }}
                >DNF</button>
                <button
                  onClick={() => canAdvance && advanceSolve()}
                  style={{
                    flex: 2, padding: '0.6rem 0', borderRadius: '8px', fontSize: '0.9rem',
                    fontFamily: 'inherit', fontWeight: 700, minHeight: '48px',
                    cursor: canAdvance ? 'pointer' : 'not-allowed',
                    background: canAdvance ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.06)',
                    border: `1px solid ${canAdvance ? 'rgba(124,58,237,0.5)' : 'rgba(124,58,237,0.15)'}`,
                    color: canAdvance ? '#a78bfa' : 'rgba(167,139,250,0.3)',
                  }}
                >
                  {isEditMode ? t('practice.update') : curIdx === 4 ? t('practice.done') : t('practice.next')}
                </button>
              </div>

              {/* Entered-so-far chips */}
              {(() => {
                const completedCount = entry.editReturnIdx !== null ? entry.editReturnIdx : curIdx;
                if (completedCount === 0) return null;
                return (
                  <div style={{ display: 'flex', gap: '0.2rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    {entry.solves.slice(0, completedCount).map((sv, i) => {
                      const isSelected = entry.selectedChip === i;
                      const isBeingEdited = entry.editReturnIdx !== null && curIdx === i;
                      return (
                        <div key={i} style={{ flex: 1, minWidth: '44px', position: 'relative' }}>
                          <div
                            onClick={() => updateEntry({ selectedChip: isSelected ? null : i })}
                            style={{
                              textAlign: 'center', padding: '0.28rem 0.15rem', borderRadius: '6px',
                              fontSize: '0.65rem', cursor: 'pointer',
                              background: isBeingEdited ? 'rgba(124,58,237,0.18)' : isSelected ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)',
                              border: `1px solid ${isBeingEdited ? 'rgba(124,58,237,0.5)' : isSelected ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}`,
                            }}
                          >
                            <div style={{ color: 'rgba(255,255,255,0.3)', marginBottom: '1px' }}>S{i + 1}</div>
                            <div style={{ color: entry.penalties[i] === 'dnf' ? '#f87171' : 'var(--text)', fontWeight: 600 }}>
                              {entry.penalties[i] === 'dnf' ? 'DNF' : (sv || '—')}{entry.penalties[i] === '+2' ? '+' : ''}
                            </div>
                          </div>
                          {isSelected && !isBeingEdited && (
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditPriorSolve(i); }}
                              style={{
                                position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                                marginTop: '2px', zIndex: 10, padding: '0.18rem 0.45rem', borderRadius: '5px',
                                fontSize: '0.62rem', fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
                                fontFamily: 'inherit', background: 'rgba(124,58,237,0.85)',
                                border: '1px solid rgba(124,58,237,0.9)', color: '#fff',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                              }}
                            >Edit</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div>
              {/* Summary */}
              <div style={{ display: 'flex', gap: '0.2rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                {entry.solves.map((sv, i) => (
                  <div key={i} style={{
                    flex: 1, minWidth: '44px', textAlign: 'center', padding: '0.3rem 0.15rem',
                    borderRadius: '6px', fontSize: '0.68rem',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                  }} onClick={() => startEditPriorSolve(i, 5)}>
                    <div style={{ color: 'var(--muted)', marginBottom: 2 }}>S{i + 1}</div>
                    <div style={{ color: entry.penalties[i] === 'dnf' ? '#f87171' : 'var(--text)', fontWeight: 600 }}>
                      {entry.penalties[i] === 'dnf' ? 'DNF' : (sv || '—')}{entry.penalties[i] === '+2' ? '+' : ''}
                    </div>
                  </div>
                ))}
              </div>

              <div className="compact-calc-row" style={{ marginBottom: '0.7rem' }}>
                {(() => {
                  const parsedCs = computeParsedCs(entry);
                  const msSolves = parsedCs.map((v) => (v === -1 ? -1 : Math.floor(v * 10)));
                  const ao5 = computeAo5(msSolves);
                  return (
                    <div className="calc-item">
                      <div className="calc-label">{t('practice.ao5')}</div>
                      <div className={`calc-value${ao5 === null ? ' dnf' : ' accent'}`}>{fmtMs(ao5 ?? 0, ao5 === null)}</div>
                    </div>
                  );
                })()}
              </div>

              {/* Judge combobox */}
              <div className="form-group">
                <label>{t('practice.judge-label')}</label>
                <input
                  type="text"
                  list="practice-judge-roster"
                  value={judgeQuery}
                  onChange={(e) => setJudgeQuery(e.target.value)}
                  placeholder={t('practice.judge-placeholder')}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '0.55rem 0.7rem', borderRadius: 8,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.13)',
                    color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.88rem', outline: 'none',
                  }}
                />
                <datalist id="practice-judge-roster">
                  {athletes.map((a) => <option key={a.id} value={fullAthleteName(a)} />)}
                </datalist>
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  width: '100%', minHeight: '50px', borderRadius: '10px',
                  fontSize: '1rem', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  background: saving ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.2)',
                  border: `1px solid ${saving ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.5)'}`,
                  color: saving ? 'rgba(74,222,128,0.4)' : '#4ade80',
                }}
              >
                {saving ? t('practice.saving') : t('practice.btn-save')}
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="msg error" style={{ display: 'block', marginTop: '0.6rem' }}>{errorMsg}</div>
          )}
        </div>
      )}
    </div>
  );
}
