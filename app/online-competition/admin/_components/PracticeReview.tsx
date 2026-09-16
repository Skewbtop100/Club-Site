'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import {
  PRACTICE_RUN_LIMIT,
  practiceReviewValid,
  spendsAllowance,
  type PracticeDecision,
} from '@/lib/online-competition/practice';
import type { AdminPracticeResponse, AdminPracticeRow } from '@/app/api/online-competition/admin-practice/route';
import PracticeRunPanel, { PRACTICE_STATUS_TONE } from './PracticeRunPanel';
import { practicePendingCount, practiceReviewRows } from '@/lib/online-competition/practice-review-rows';

// ── Туршилтын шүүлт ─────────────────────────────────────────────────────
// ONE ROW PER ATHLETE, their runs laid out across it — the judging grid's
// shape, because the unit an admin works in is an athlete and not a file.
// Ten runs as ten rows put the same person in ten places, so "this one was
// already refused for exactly this" took ten rows of reading to notice.
//
// WHAT REUSES FROM ReviewGrid, AND WHAT COULD NOT:
//   · THE INTERACTION reuses whole: a grid of cells, one cell per attempt,
//     clicking a cell opens the detail panel below the grid, the open cell
//     outlined. Same states, same colours, same place.
//   · THE CELL AND HEADING CLASSES reuse literally — .oc-rv-cell and its
//     -pending/-dnf/-selected variants, .oc-rv-initials, .oc-rv-th,
//     .oc-rv-avg — so a cell means the same thing on both screens.
//   · THE ROW TEMPLATE COULD NOT. `.oc-rv-row` is
//     `minmax(180px,1.4fr) repeat(5,78px) 92px 92px 132px`: five fixed
//     attempt columns, an average and a single. A practice athlete has
//     between zero and ten runs (more, counting redos, which do not spend
//     one of the ten) and no average, no single and no ranking at all. So
//     the runs sit in ONE flexible track that wraps, and the row keeps the
//     name column and a used-of-ten column on either side of it.
//   · GridRow ITSELF COULD NOT BE REUSED: ReviewGrid exports AthleteRow but
//     not GridRow, and exporting it would mean editing the competition
//     review path — which is not authorised (only the JUMPS extraction
//     was). It is reported rather than done.
//
// THE QUESTION HERE IS STILL ONE QUESTION: did this athlete scramble and
// solve correctly? There is no time entry, no +2 and no DNF. The athlete's
// own typed time shows because it is theirs to see, and it decides nothing.

/** Initials, the same two-letter fallback the judging grid draws. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** What a cell shows. A run with no typed time is a real run with a real
 *  video — it files deliberately — so it gets a dash rather than being
 *  drawn as empty. */
function cellLabel(run: AdminPracticeRow): string {
  if (run.isDnf) return 'DNF';
  return run.timeCs !== null ? fmtCentiseconds(run.timeCs) : '—:—';
}

/** THE CELL'S STATE, mapped onto the judging grid's own classes where they
 *  mean the same thing: `pending` is amber there and here, and a refusal is
 *  the red a DNF is. `correct` and `redo` have no counterpart there, so they
 *  are practice's own — .oc-rv-cell keeps the geometry either way. */
function cellClass(run: AdminPracticeRow, selected: string | null): string {
  const state =
    run.status === 'pending'
      ? 'oc-rv-cell-pending'
      : run.status === 'incorrect'
        ? 'oc-rv-cell-dnf'
        : run.status === 'correct'
          ? 'oc-pg-cell-ok'
          : 'oc-pg-cell-redo';
  return ['oc-rv-cell', 'oc-pg-cell', state, run.id === selected ? 'oc-rv-cell-selected' : '']
    .filter(Boolean)
    .join(' ');
}

export default function PracticeReview() {
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const [data, setData] = useState<AdminPracticeResponse | null>(null);
  const [error, setError] = useState('');
  /** Which run is open. One at a time: each carries a video file. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Per-run draft reason, so moving between runs does not lose typing. */
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

  /** The athlete whose run is open. Read from the runs rather than the
   *  rows — the rows depend on it. */
  const heldUid = useMemo(
    () => (openId && data ? data.runs.find((r) => r.id === openId)?.uid ?? null : null),
    [openId, data],
  );

  /** ONE ROW PER ATHLETE, every run of theirs across it — see
   *  practice-review-rows for which athletes appear and when a row leaves. */
  const rows = useMemo(
    () => (data === null ? [] : practiceReviewRows(data.runs, scope, heldUid)),
    [data, scope, heldUid],
  );

  /** THE QUEUE THE PANEL'S ‹ › MOVE THROUGH: every run on the rows in view,
   *  in the order they are drawn, so moving on lands where the eye would. */
  const queue = useMemo(() => rows.flatMap((r) => r.runs), [rows]);
  const queueIndex = openId ? queue.findIndex((r) => r.id === openId) : -1;
  const openRun = queueIndex >= 0 ? queue[queueIndex] : null;

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
      const body = (await res.json().catch(() => null)) as
        | { error?: string; run?: Partial<AdminPracticeRow> }
        | null;
      if (!res.ok) {
        setRowError({ id: run.id, text: body?.error ?? 'Хадгалж чадсангүй' });
        return;
      }
      // THE COMPETITION GRID'S WAY: patch the one run in place, no reload,
      // and leave the panel open on it. The cell recolours under the admin
      // and the decision is seen to land — where a reload used to close the
      // panel and, for an athlete's last pending run, take their whole row
      // (and the history that explained the decision) off the screen in the
      // same click. The route answers with the run as stored; the status and
      // reason are taken from it, the name from what is already here.
      const stored = body?.run;
      setData((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              runs: prev.runs.map((r) =>
                r.id === run.id
                  ? {
                      ...r,
                      status: stored?.status ?? decision,
                      reason: stored?.reason ?? (decision === 'incorrect' ? reason.trim() : null),
                      reviewedAtMs: stored?.reviewedAtMs ?? Date.now(),
                      expiresAtMs: stored?.expiresAtMs ?? r.expiresAtMs,
                    }
                  : r,
              ),
            },
      );
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
          onClick={() => {
            setScope('pending');
            // The open panel belongs to the scope being left.
            setOpenId(null);
          }}
        >
          ХЯНАГДААГҮЙ
          {/* The number of runs WAITING, not the number of rows: a row can
              carry several. */}
          {data && <span style={{ marginLeft: 6, color: '#6E6A62' }}>{practicePendingCount(data.runs)}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'all'}
          className={`oc-rd-tab${scope === 'all' ? ' oc-rd-tab-on' : ''}`}
          onClick={() => {
            setScope('all');
            setOpenId(null);
          }}
        >
          БҮГД
        </button>
      </div>

      {error ? (
        <p className="oc-sc-msg-err">{error}</p>
      ) : data === null ? (
        <p className="oc-v3-status">Ачааллаж байна...</p>
      ) : rows.length === 0 ? (
        <p className="oc-sc-empty">
          {scope === 'pending' ? 'Хянах бичлэг алга.' : 'Туршилтын бичлэг алга.'}
        </p>
      ) : (
        <div className="oc-pg-grid">
          <div className="oc-pg-head">
            <span className="oc-rv-th">Нэр</span>
            <span className="oc-rv-th">Бичлэгүүд</span>
            <span className="oc-rv-th" style={{ textAlign: 'center' }}>
              Ашигласан
            </span>
          </div>

          {rows.map((row) => (
            <div key={row.uid} className="oc-pg-row">
              <div className="oc-pg-who">
                <span className="oc-rv-initials" aria-hidden>
                  {initials(row.name)}
                </span>
                <span className="oc-pg-name">{row.name}</span>
              </div>

              {/* THE RUNS, ACROSS THE ROW, oldest first. A wrapping track
                  rather than fixed columns: there is no fixed number of
                  them, and a redo does not spend one of the ten, so an
                  athlete can hold more documents than the limit. */}
              <div className="oc-pg-runs">
                {row.runs.map((run, i) => (
                  <button
                    key={run.id}
                    type="button"
                    className={cellClass(run, openId)}
                    onClick={() => setOpenId(openId === run.id ? null : run.id)}
                    title={`#${i + 1} · ${run.event.toUpperCase()}${spendsAllowance(run.status) ? '' : ' · 10-д тооцогдохгүй'}`}
                  >
                    {cellLabel(run)}
                  </button>
                ))}
              </div>

              <span className="oc-rv-avg" style={{ color: row.used >= PRACTICE_RUN_LIMIT ? '#E8543C' : undefined }}>
                {row.used} / {PRACTICE_RUN_LIMIT}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── The panel, under the grid, as the judging panel sits under
          its own ─────────────────────────────────────────────────────── */}
      {openRun && data && (
        <PracticeRunPanel
          run={openRun}
          reason={reasons[openRun.id] ?? ''}
          onReason={(text) => setReasons((p) => ({ ...p, [openRun.id]: text }))}
          busy={busyId === openRun.id}
          error={rowError?.id === openRun.id ? rowError.text : null}
          reasonMax={data.reasonMax}
          hasPrev={queueIndex > 0}
          hasNext={queueIndex >= 0 && queueIndex < queue.length - 1}
          onPrev={() => queueIndex > 0 && setOpenId(queue[queueIndex - 1].id)}
          onNext={() =>
            queueIndex >= 0 && queueIndex < queue.length - 1 && setOpenId(queue[queueIndex + 1].id)
          }
          onClose={() => setOpenId(null)}
          onDecide={(decision) => void decide(openRun, decision)}
        />
      )}

      {/* The legend, because four statuses in one colour language is one
          more than a colour alone can carry. */}
      {rows.length > 0 && (
        <div className="oc-pg-legend">
          {(['pending', 'correct', 'incorrect', 'redo'] as const).map((s) => (
            <span key={s} className="oc-pg-legend-item">
              <span className="oc-pg-legend-dot" style={{ background: PRACTICE_STATUS_TONE[s] }} aria-hidden />
              {s === 'pending' ? 'ХЯНАГДААГҮЙ' : s === 'correct' ? 'ЗӨВ' : s === 'incorrect' ? 'БУРУУ' : 'ДАХИН ИЛГЭЭХ'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
