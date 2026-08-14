'use client';

import { useState } from 'react';
import { saveResult } from '@/lib/firebase/services/results';
import { fmtTime, parseTime, getMinPlausibleSolveCs } from '@/lib/time-utils';
import { calcAo5, bestOf, timeToRawDigits, formatRawDigits } from '@/lib/results-entry-helpers';
import { useLang } from '@/lib/i18n';
import type { Result } from '@/lib/types';

type Penalty = 'none' | '+2' | 'dnf';

interface EditorState {
  solves: string[];
  penalties: Penalty[];
  currentSolveIdx: number;
  rawInput: string;
  selectedChip: number | null;
  editReturnIdx: number | null;
  postEditMode: boolean;
  msg: string;
  msgType: string;
  needsConfirm: boolean;
}

/** Reconstructs editable state from a saved Result.
 *  DNF is always exact (solves[i] === -1 is unambiguous). A +2 solve is only
 *  exactly recoverable if `penalties` was stored (added after this result may
 *  have been saved) — otherwise it falls back to showing the final (already
 *  +2'd) value as if it were a plain solve, which the admin can re-flag.
 */
function seedFromResult(result: Result): { solves: string[]; penalties: Penalty[] } {
  const stored = result.solves ?? [];
  const storedPenalties = result.penalties;
  const solves: string[] = [];
  const penalties: Penalty[] = [];
  for (let i = 0; i < 5; i++) {
    const v = stored[i] ?? null;
    const pen: Penalty = storedPenalties?.[i] ?? (v === -1 ? 'dnf' : 'none');
    penalties.push(pen);
    if (pen === 'dnf' || v === null) {
      solves.push('');
    } else {
      const raw = pen === '+2' ? v - 200 : v;
      solves.push(fmtTime(raw));
    }
  }
  return { solves, penalties };
}

function computeResult(solves: string[], penalties: Penalty[]) {
  const parsed = solves.map((s, i) => {
    if (penalties[i] === 'dnf') return -1;
    const v = parseTime(s); if (v === null) return null;
    return penalties[i] === '+2' ? (v < 0 ? v : v + 200) : v;
  });
  return { single: bestOf(parsed), average: calcAo5(parsed), parsed };
}

interface Props {
  result: Result;
  athleteName: string;
  eventName: string;
  onClose: () => void;
}

export default function PracticeEditModal({ result, athleteName, eventName, onClose }: Props) {
  const { t } = useLang();
  const [state, setState] = useState<EditorState>(() => {
    const { solves, penalties } = seedFromResult(result);
    return {
      solves, penalties,
      currentSolveIdx: 5, rawInput: '',
      selectedChip: null, editReturnIdx: null, postEditMode: false,
      msg: '', msgType: '', needsConfirm: false,
    };
  });
  const [saving, setSaving] = useState(false);

  function patch(p: Partial<EditorState>) {
    setState(prev => ({ ...prev, ...p }));
  }

  function setPenaltyCurrent(pen: Penalty) {
    setState(prev => {
      const idx = prev.currentSolveIdx;
      if (idx >= 5) return prev;
      const ps = [...prev.penalties];
      ps[idx] = ps[idx] === pen ? 'none' : pen;
      return { ...prev, penalties: ps };
    });
  }

  function advanceSolve() {
    setState(prev => {
      const idx = prev.currentSolveIdx;
      if (idx >= 5) return prev;
      const newSolves = [...prev.solves];
      newSolves[idx] = prev.penalties[idx] === 'dnf' ? '' : formatRawDigits(prev.rawInput);
      const nextIdx = prev.editReturnIdx !== null ? prev.editReturnIdx : idx + 1;
      return { ...prev, solves: newSolves, currentSolveIdx: nextIdx, rawInput: '', editReturnIdx: null, selectedChip: null, needsConfirm: false };
    });
  }

  function startEditSolve(solveIdx: number) {
    setState(prev => ({
      ...prev,
      currentSolveIdx: solveIdx,
      rawInput: prev.penalties[solveIdx] === 'dnf' ? '' : timeToRawDigits(prev.solves[solveIdx]),
      editReturnIdx: 5,
      selectedChip: null,
      postEditMode: false,
    }));
  }

  async function save(force = false) {
    const { single, average, parsed } = computeResult(state.solves, state.penalties);

    const minCs = getMinPlausibleSolveCs(result.eventId);
    const hasImplausibleSolve = parsed.some(v => v !== null && v > 0 && v < minCs);
    if (!force && hasImplausibleSolve) {
      patch({ msg: t('admin.results.msg.implausible'), msgType: 'warn', needsConfirm: true });
      return;
    }

    setSaving(true);
    try {
      // Preserve everything about the original doc except the solve data —
      // same docId (setDoc overwrites, no duplicate), and submittedAt stays
      // pinned to when it was originally logged so the displayed date
      // doesn't jump to "now" just because it was corrected.
      const { id: _omit, ...rest } = result;
      await saveResult(result.id, {
        ...rest,
        single, average, solves: parsed, penalties: state.penalties,
        submittedAt: result.submittedAt,
      });
      onClose();
    } catch (e: unknown) {
      patch({ msg: t('admin.msg.error-prefix') + (e instanceof Error ? e.message : String(e)), msgType: 'error', needsConfirm: false });
    } finally {
      setSaving(false);
    }
  }

  const curIdx = state.currentSolveIdx;
  const curPenalty = curIdx < 5 ? state.penalties[curIdx] : 'none';
  const preview = curIdx < 5 && curPenalty !== 'dnf' ? formatRawDigits(state.rawInput) : '';
  const canAdvance = curPenalty === 'dnf' || state.rawInput.length > 0;
  const isEditingOneSolve = curIdx < 5;
  const { single, average } = computeResult(state.solves, state.penalties);

  return (
    <div className="pem-overlay" onClick={onClose}>
      <div className="pem-modal" onClick={e => e.stopPropagation()}>
        <div className="pem-header">
          <div>
            <div className="pem-title">{athleteName}</div>
            <div className="pem-subtitle">{eventName} · {result.practiceDate}</div>
          </div>
          <button className="pem-close" onClick={onClose}>✕</button>
        </div>

        <div className="pem-body">
          {isEditingOneSolve ? (
            <>
              <div className="pem-solve-label">
                {t('admin.results.solve-prefix')} {curIdx + 1} {t('admin.results.solve-of')}
              </div>
              {result.scrambles?.[curIdx] && (
                <div className="pem-scramble">{result.scrambles[curIdx]}</div>
              )}
              <input
                type="text" inputMode="numeric" pattern="[0-9]*"
                value={curPenalty === 'dnf' ? '' : state.rawInput}
                placeholder={curPenalty === 'dnf' ? 'DNF' : '0'}
                readOnly={curPenalty === 'dnf'}
                onChange={e => patch({ rawInput: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                onKeyDown={e => { if (e.key === 'Enter' && canAdvance) { e.preventDefault(); advanceSolve(); } }}
                className="pem-input"
                style={{
                  background: curPenalty === 'dnf' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${curPenalty === 'dnf' ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.13)'}`,
                  color: curPenalty === 'dnf' ? '#f87171' : 'var(--text)',
                }}
              />
              <div className="pem-preview">{curPenalty === 'dnf' ? 'DNF' : (preview ? `→ ${preview}` : '')}</div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button className={`pem-pen-btn${curPenalty === '+2' ? ' active-plus2' : ''}`} onClick={() => setPenaltyCurrent('+2')}>+2</button>
                <button className={`pem-pen-btn${curPenalty === 'dnf' ? ' active-dnf' : ''}`} onClick={() => setPenaltyCurrent('dnf')}>DNF</button>
                <button className="pem-next-btn" disabled={!canAdvance} onClick={() => canAdvance && advanceSolve()}>
                  {t('admin.results.update')}
                </button>
              </div>
            </>
          ) : (
            <>
              {state.postEditMode && <div className="pem-tap-hint">{t('admin.results.tap-edit')}</div>}
              <div className="pem-chip-row">
                {state.solves.map((sv, i) => (
                  <div
                    key={i}
                    className={`pem-chip${state.postEditMode ? ' tappable' : ''}`}
                    onClick={() => state.postEditMode && startEditSolve(i)}
                  >
                    <div className="pem-chip-label">S{i + 1}</div>
                    <div className={`pem-chip-val${state.penalties[i] === 'dnf' ? ' dnf' : ''}`}>
                      {state.penalties[i] === 'dnf' ? 'DNF' : (sv || '—')}
                      {state.penalties[i] === '+2' ? '+' : ''}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pem-calc-row">
                <div>
                  <div className="pem-calc-label">{t('admin.results.single')}</div>
                  <div className={`pem-calc-value${single < 0 ? ' dnf' : ''}`}>{fmtTime(single)}</div>
                </div>
                <div>
                  <div className="pem-calc-label">{t('admin.results.ao5')}</div>
                  <div className={`pem-calc-value${average !== null && average < 0 ? ' dnf' : ''}`}>{fmtTime(average)}</div>
                </div>
              </div>

              {/* Scrambles used — read-only, for transparency/verification */}
              {result.scrambles?.some(s => s) && (
                <div className="pem-scramble-list">
                  {result.scrambles.map((s, i) => s ? (
                    <div key={i} className="pem-scramble-row">
                      <span className="pem-scramble-idx">S{i + 1}</span>
                      <span className="pem-scramble-text">{s}</span>
                    </div>
                  ) : null)}
                </div>
              )}

              {state.postEditMode ? (
                <button className="pem-btn pem-btn-secondary" onClick={() => patch({ postEditMode: false })}>
                  {t('admin.btn.cancel')}
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className="pem-btn pem-btn-save" disabled={saving} onClick={() => save()}>
                    {saving ? t('admin.cr.edit.saving') : t('admin.btn.save')}
                  </button>
                  <button className="pem-btn pem-btn-secondary" onClick={() => patch({ postEditMode: true })}>
                    {t('admin.btn.edit')}
                  </button>
                </div>
              )}

              {state.needsConfirm && (
                <button className="pem-btn pem-btn-confirm" onClick={() => save(true)}>
                  {t('admin.results.btn.confirm-anyway')}
                </button>
              )}
            </>
          )}

          {state.msg && <div className={`pem-msg ${state.msgType}`}>{state.msg}</div>}
        </div>
      </div>

      <style>{`
        .pem-overlay {
          position: fixed; inset: 0; z-index: 3000;
          background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; padding: 1rem;
        }
        .pem-modal {
          width: 100%; max-width: 380px;
          background: var(--bg); border: 1px solid rgba(124,58,237,0.25);
          border-radius: 16px; overflow: hidden;
        }
        .pem-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 1rem 1.2rem; border-bottom: 1px solid rgba(124,58,237,0.2);
        }
        .pem-title { font-size: 1rem; font-weight: 700; color: var(--text); }
        .pem-subtitle { font-size: 0.78rem; color: var(--muted); margin-top: 0.15rem; }
        .pem-close {
          background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
          color: var(--muted); cursor: pointer; padding: 0.3rem 0.55rem;
        }
        .pem-body { padding: 1.1rem 1.2rem; }
        .pem-solve-label {
          font-size: 0.72rem; font-weight: 700; color: var(--muted);
          text-transform: uppercase; letter-spacing: 0.08em; text-align: center; margin-bottom: 0.5rem;
        }
        .pem-input {
          width: 100%; box-sizing: border-box; font-size: 2rem; font-weight: 700; text-align: center;
          padding: 0.6rem 0.5rem; border-radius: 10px; margin-bottom: 0.3rem; min-height: 62px;
          font-family: inherit; outline: none;
        }
        .pem-preview { font-size: 0.82rem; color: var(--muted); text-align: center; min-height: 1.3em; margin-bottom: 0.5rem; }
        .pem-scramble {
          font-family: monospace; font-size: 0.82rem; line-height: 1.5; letter-spacing: 0.02em;
          color: var(--text); text-align: center; margin-bottom: 0.6rem;
          padding: 0.5rem 0.7rem; border-radius: 8px;
          background: rgba(124,58,237,0.06); border: 1px solid rgba(124,58,237,0.18);
        }
        .pem-scramble-list { margin-bottom: 0.9rem; }
        .pem-scramble-row {
          display: flex; gap: 0.5rem; align-items: baseline;
          padding: 0.3rem 0.1rem; border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .pem-scramble-row:last-child { border-bottom: none; }
        .pem-scramble-idx { flex-shrink: 0; font-size: 0.68rem; font-weight: 700; color: var(--muted); width: 1.4rem; }
        .pem-scramble-text { font-family: monospace; font-size: 0.75rem; color: var(--muted); line-height: 1.4; }
        .pem-pen-btn, .pem-next-btn {
          flex: 1; padding: 0.6rem 0; border-radius: 8px; font-size: 0.88rem; font-family: inherit;
          font-weight: 600; cursor: pointer; min-height: 46px;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: var(--muted);
        }
        .pem-pen-btn.active-plus2 { background: rgba(251,191,36,0.18); border-color: rgba(251,191,36,0.5); color: #fbbf24; }
        .pem-pen-btn.active-dnf { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.45); color: #f87171; }
        .pem-next-btn { flex: 2; font-weight: 700; background: rgba(124,58,237,0.22); border-color: rgba(124,58,237,0.5); color: #a78bfa; }
        .pem-next-btn:disabled { cursor: not-allowed; opacity: 0.4; }
        .pem-tap-hint { font-size: 0.7rem; font-weight: 700; color: #a78bfa; text-transform: uppercase; letter-spacing: 0.08em; text-align: center; margin-bottom: 0.4rem; }
        .pem-chip-row { display: flex; gap: 0.3rem; margin-bottom: 0.8rem; }
        .pem-chip {
          flex: 1; text-align: center; padding: 0.4rem 0.2rem; border-radius: 8px; font-size: 0.72rem;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
        }
        .pem-chip.tappable { cursor: pointer; }
        .pem-chip.tappable:hover { border-color: rgba(124,58,237,0.4); background: rgba(124,58,237,0.08); }
        .pem-chip-label { color: rgba(255,255,255,0.35); margin-bottom: 2px; }
        .pem-chip-val { font-weight: 600; color: var(--text); }
        .pem-chip-val.dnf { color: #f87171; }
        .pem-calc-row { display: flex; gap: 0.6rem; margin-bottom: 0.9rem; }
        .pem-calc-row > div { flex: 1; text-align: center; background: rgba(255,255,255,0.03); border-radius: 8px; padding: 0.5rem; }
        .pem-calc-label { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.2rem; }
        .pem-calc-value { font-family: monospace; font-weight: 700; font-size: 1.05rem; color: var(--text); }
        .pem-calc-value.dnf { color: #f87171; }
        .pem-btn {
          flex: 1; min-height: 46px; border-radius: 10px; font-size: 0.9rem; font-weight: 700;
          cursor: pointer; font-family: inherit;
        }
        .pem-btn-save { background: rgba(34,197,94,0.2); border: 1px solid rgba(34,197,94,0.5); color: #4ade80; }
        .pem-btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
        .pem-btn-secondary { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: var(--muted); }
        .pem-btn-confirm { width: 100%; margin-top: 0.5rem; background: rgba(251,191,36,0.15); border: 1px solid rgba(251,191,36,0.5); color: #fbbf24; }
        .pem-msg { margin-top: 0.6rem; padding: 0.5rem 0.7rem; border-radius: 8px; font-size: 0.82rem; }
        .pem-msg.error { background: rgba(239,68,68,0.12); color: #f87171; }
        .pem-msg.warn { background: rgba(251,191,36,0.12); color: #fbbf24; }
      `}</style>
    </div>
  );
}
