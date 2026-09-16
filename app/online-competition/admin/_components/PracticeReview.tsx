'use client';

import { useCallback, useEffect, useState } from 'react';
import { resolveVideoSrc } from '@/lib/online-competition/video-source';
import ScramblePreview from '@/components/shared/ScramblePreview';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import {
  PRACTICE_REFUSAL_REASONS,
  practiceReviewValid,
  type PracticeDecision,
} from '@/lib/online-competition/practice';
import type { AdminPracticeResponse, AdminPracticeRow } from '@/app/api/online-competition/admin-practice/route';

// ── Туршилтын шүүлт ─────────────────────────────────────────────────────
// ITS OWN SCREEN, not a tab of Шүүлт, and the difference is not cosmetic.
// That queue is built around a competition: it preselects one, fetches its
// registrations, its submissions and its scrambles overview, groups rows by
// event and round, and bulk-approves a round at a time. A practice run has
// no competition, no round, no roster and no ranking — it would be a row
// with every one of those columns empty, and "bulk approve this round" over
// unrelated athletes' practice runs is not an operation that means anything.
//
// THE QUESTION HERE IS ONE QUESTION: did this athlete scramble and solve
// correctly? So there is no time entry, no +2 and no DNF. The athlete's own
// typed time is shown because it is theirs to see, and it decides nothing.
//
// ── THE EVIDENCE: THE VIDEO AND THE SCRAMBLE, SIDE BY SIDE ──
// The 2D diagram is what makes the one question quick: comparing a cube on
// video against a picture of the state the scramble should produce is a
// glance, and comparing it against twenty moves of notation is not.
//
// It is the SAME component the competition review panel uses —
// components/shared/ScramblePreview, unmodified, at visualization="2D" —
// and it needs exactly the two things a practice run already stores: the
// scramble text and the event. Nothing was added to the document for it.
//
// The arrangement follows that panel's: side by side, stacking into one
// column at the SAME 1100px it stacks at, so an admin moving between the
// two screens meets the same break.
//
// THERE ARE NO JUMP BUTTONS, and they are not omitted for want of screen
// space: a practice run stores no marks. See the report on this changeset —
// adding the recorder fields is its own change.

const DECISIONS: { key: PracticeDecision; label: string; tone: string }[] = [
  { key: 'correct', label: 'ЗӨВ', tone: '#4FD07A' },
  { key: 'incorrect', label: 'БУРУУ', tone: '#E8543C' },
  { key: 'redo', label: 'ДАХИН ИЛГЭЭХ', tone: '#E0A020' },
];

const STATUS_LABEL: Record<string, string> = {
  pending: 'ХЯНАГДААГҮЙ',
  correct: 'ЗӨВ',
  incorrect: 'БУРУУ',
  redo: 'ДАХИН ИЛГЭЭХ',
};

function fmtWhen(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function PracticeReview() {
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const [data, setData] = useState<AdminPracticeResponse | null>(null);
  const [error, setError] = useState('');
  /** Which run is open. One at a time: each carries a video file. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Per-run draft reason, so switching between rows does not lose typing. */
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/online-competition/admin-practice?status=${scope}`);
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as AdminPracticeResponse);
    } catch (err) {
      console.error('PracticeReview: loading the queue failed:', err);
      setError('Туршилтын бичлэгүүдийг ачааллаж чадсангүй');
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(run: AdminPracticeRow, decision: PracticeDecision) {
    const reason = reasons[run.id] ?? '';
    // THE SAME CHECK THE ROUTE MAKES, from the same function — so the button
    // is disabled for exactly the reasons the server would refuse.
    if (!practiceReviewValid(decision, reason)) {
      setRowError({ id: run.id, text: 'Татгалзах шалтгааныг бичнэ үү.' });
      return;
    }
    setBusyId(run.id);
    setRowError(null);
    try {
      const res = await fetch('/api/online-competition/admin-practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: run.id, decision, reason: reason.trim() || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setRowError({ id: run.id, text: body?.error ?? 'Хадгалж чадсангүй' });
        return;
      }
      setOpenId(null);
      await load();
    } catch (err) {
      console.error('PracticeReview: the decision failed:', err);
      setRowError({ id: run.id, text: 'Хадгалж чадсангүй' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="oc-rd-tabs" role="tablist" aria-label="Шүүлтийн хүрээ">
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'pending'}
          className={`oc-rd-tab${scope === 'pending' ? ' oc-rd-tab-on' : ''}`}
          onClick={() => setScope('pending')}
        >
          ХЯНАГДААГҮЙ
          {data && scope === 'pending' && (
            <span style={{ marginLeft: 6, color: '#6E6A62' }}>{data.runs.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'all'}
          className={`oc-rd-tab${scope === 'all' ? ' oc-rd-tab-on' : ''}`}
          onClick={() => setScope('all')}
        >
          БҮГД
        </button>
      </div>

      {error ? (
        <p className="oc-sc-msg-err">{error}</p>
      ) : data === null ? (
        <p className="oc-v3-status">Ачааллаж байна...</p>
      ) : data.runs.length === 0 ? (
        <p className="oc-sc-empty">
          {scope === 'pending' ? 'Хянах бичлэг алга.' : 'Туршилтын бичлэг алга.'}
        </p>
      ) : (
        <div className="oc-sc-card">
          {data.runs.map((run) => {
            const src = resolveVideoSrc({ videoKey: run.videoKey });
            const open = openId === run.id;
            const reason = reasons[run.id] ?? '';
            return (
              <div key={run.id} className="oc-practice-adm-row">
                <div className="oc-practice-adm-head">
                  <span className="oc-practice-adm-name">{run.displayName}</span>
                  <span className="oc-practice-adm-meta">
                    {run.event.toUpperCase()} ·{' '}
                    {run.isDnf ? 'DNF' : run.timeCs !== null ? fmtCentiseconds(run.timeCs) : 'цаг бичээгүй'} ·{' '}
                    {fmtWhen(run.createdAtMs)}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span className="oc-practice-adm-status">
                    {STATUS_LABEL[run.status] ?? run.status}
                  </span>
                  <button
                    type="button"
                    className="oc-sc-btn"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : run.id)}
                  >
                    {open ? 'ХААХ' : 'ҮЗЭХ'}
                  </button>
                </div>

                {run.status === 'incorrect' && run.reason && (
                  <p className="oc-practice-adm-reason">Шалтгаан: {run.reason}</p>
                )}

                {open && (
                  <div className="oc-practice-adm-body">
                    {/* THE VIDEO AND THE SCRAMBLE, SIDE BY SIDE. The
                        comparison IS the review, so the two things being
                        compared are next to each other rather than one
                        above the other. */}
                    <div className="oc-practice-adm-evidence">
                      <div className="oc-practice-adm-videobox">
                        {src === null ? (
                          <p className="oc-sc-msg-err">Бичлэг байхгүй (устсан эсвэл тохируулаагүй).</p>
                        ) : (
                          <video
                            className="oc-practice-adm-video"
                            src={src}
                            controls
                            playsInline
                            preload="metadata"
                          />
                        )}
                      </div>

                      {/* THE SCRAMBLE THE ATHLETE WAS SHOWN, as notation AND
                          as the state it produces. Without it the review
                          question is unanswerable — "did they apply this
                          scramble" needs the scramble; without the diagram
                          it is answerable but slow. */}
                      <div className="oc-practice-adm-scramble">
                        <span className="oc-adm-sublabel">ХОЛИЛТ</span>
                        <code>{run.scramble || '—'}</code>
                        {/* Definite width AND height, as the competition
                            panel's own comment says: ScramblePreview sizes
                            its player to 100% of the container, so an
                            auto-height box gives it nothing to resolve
                            against. */}
                        {run.scramble && (
                          <div className="oc-practice-adm-diagram">
                            <ScramblePreview eventId={run.event} scramble={run.scramble} visualization="2D" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="oc-practice-adm-reasons">
                      <span className="oc-adm-sublabel">ТАТГАЛЗАХ ШАЛТГААН</span>
                      <div className="oc-practice-adm-chips">
                        {PRACTICE_REFUSAL_REASONS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            className="oc-sc-btn"
                            onClick={() => setReasons((p) => ({ ...p, [run.id]: r }))}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <textarea
                        className="oc-v3-input"
                        rows={2}
                        maxLength={data.reasonMax}
                        value={reason}
                        placeholder="Эсвэл өөрөө бичнэ үү"
                        onChange={(e) => setReasons((p) => ({ ...p, [run.id]: e.target.value }))}
                      />
                    </div>

                    <div className="oc-practice-adm-actions">
                      {DECISIONS.map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          className="oc-sc-btn"
                          style={{ borderColor: d.tone, color: d.tone }}
                          disabled={busyId === run.id || !practiceReviewValid(d.key, reason)}
                          title={
                            practiceReviewValid(d.key, reason)
                              ? undefined
                              : 'Татгалзахын тулд шалтгаан бичнэ үү'
                          }
                          onClick={() => decide(run, d.key)}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <p className="oc-practice-adm-note">
                      ДАХИН ИЛГЭЭХ нь тамирчны 10 бичлэгт тооцогдохгүй — өөр бичлэг хийх боломж нэмэгдэнэ.
                    </p>

                    {rowError?.id === run.id && <p className="oc-sc-msg-err">{rowError.text}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
