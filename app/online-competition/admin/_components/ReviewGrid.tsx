'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type {
  OnlineCompetitionAdminView,
  OnlineSubmissionAdminView,
} from '@/lib/online-competition/types';
import type { RegistrationAdminView } from '@/lib/online-competition/admin-registrations';
import type { ScramblesOverview } from '@/app/api/online-competition/admin-scrambles/route';
import { roundKey } from '@/lib/online-competition/scrambles';
import {
  attemptsForFormat,
  computeResult,
  effectiveAttemptTime,
  resolveResultFormat,
  type AttemptTime,
  type ResultFormat,
} from '@/lib/online-competition/ao5';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import SubmissionDetailPanel from './SubmissionDetailPanel';

// Attempt columns are PER EVENT, derived from that event's resultFormat —
// a Bo3 event shows three columns, not five with two permanently empty.
//
// Safe to key off the single selected event because this grid only ever
// shows one at a time: `eventId` is state, the tab row sets it, and every
// row is filtered `s.event === eventId`. If it ever showed mixed events,
// this would have to move onto the row.
function attemptColumns(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

// ── How attempts map to storage ──────────────────────────────────────────
// A submission carries TWO numbers and they are not the same thing:
//   `attempt`          — the ATTEMPT INDEX 1-5 within one run (stored on
//                        the document as `round`; the admin GET mapper
//                        renames it, precisely so nothing in here can read
//                        a number called "round" and take it for a
//                        competition round)
//   `competitionRound` — the competition round that run belongs to
// The attempt columns below key off `attempt`, which is what makes the Ao5
// columns computable. The round TABS key off `competitionRound`, and rows
// are filtered to the selected round.
//
// The tabs used to be a hardcoded `const ROUNDS = [1]`, on the stated
// grounds that no field distinguished one competition round from another.
// One did — `competitionRound`, resolved once per run from the round-access
// gate — it simply never reached the client: the admin GET mapper dropped
// it. It is in OnlineSubmissionAdminView now.
function roundsForEvent(count: number): number[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => i + 1);
}

export interface AthleteRow {
  uid: string;
  name: string;
  /** attempt number -> the submission currently shown in that cell */
  attempts: Map<number, OnlineSubmissionAdminView>;
  /** attempt number -> how many submissions share that slot (see the
   *  duplicate note below); 1 for the ordinary case. */
  slotCounts: Map<number, number>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function isDecided(s: OnlineSubmissionAdminView): boolean {
  return s.status !== 'pending';
}
function isDnf(s: OnlineSubmissionAdminView): boolean {
  return s.isDnf === true || s.penalty === 'DNF';
}
/** Effective time, via THE shared rule (ao5.ts) rather than a local copy.
 *
 *  This used to be a fourth independent implementation of "+2 adds 200cs,
 *  DNF is a DNF". Harmless while that was the whole rule; not harmless now
 *  that a time limit is part of it — the judge's Дундаж column would have
 *  shown an average the standings disagreed with, for exactly the solves
 *  a limit is meant to catch. */
function effectiveTime(s: OnlineSubmissionAdminView, timeLimitCs: number | null): AttemptTime {
  return effectiveAttemptTime(
    { status: s.status, reportedTime: s.reportedTime, isDnf: s.isDnf, penalty: s.penalty },
    timeLimitCs,
  );
}

export default function ReviewGrid() {
  const searchParams = useSearchParams();
  const preselect = searchParams.get('competitionId');

  const [competitions, setCompetitions] = useState<OnlineCompetitionAdminView[] | null>(null);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [round, setRound] = useState<number>(1);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [registrations, setRegistrations] = useState<RegistrationAdminView[]>([]);
  const [submissions, setSubmissions] = useState<OnlineSubmissionAdminView[] | null>(null);
  // Imported scrambles + group assignments for this competition, used only
  // to label the detail panel. Null when the competition has none (or the
  // fetch failed) — the panel then shows its original "not assigned" note.
  const [scrambles, setScrambles] = useState<ScramblesOverview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The uid whose reset confirm bar is open — at most one at a time. Keyed
  // by uid rather than a boolean so switching rows can't leave a confirm
  // armed against the athlete the admin just navigated away from.
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetNote, setResetNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/online-competition/admin-competitions')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { competitions: OnlineCompetitionAdminView[] }) => {
        if (cancelled) return;
        const list = d.competitions ?? [];
        setCompetitions(list);
        // Preselect from ?competitionId= (the competition detail page's
        // "Бичлэг шүүх →" link), else the live competition, else the most
        // recently starting one.
        const byParam = preselect ? list.find((c) => c.id === preselect) : undefined;
        const live = list.find((c) => c.status === 'live');
        const recent = [...list].sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0))[0];
        setCompetitionId((byParam ?? live ?? recent)?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setCompetitions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [preselect]);

  const competition = competitions?.find((c) => c.id === competitionId) ?? null;
  const eventConfig = competition?.events.find((e) => e.eventId === eventId) ?? null;
  // What the competition CONFIGURES, not what has been solved: a round
  // with no submissions yet still deserves a tab to watch fill up.
  const rounds = roundsForEvent(eventConfig?.rounds ?? 1);

  // Default the event to the competition's first configured one.
  useEffect(() => {
    setEventId(competition?.events[0]?.eventId ?? null);
    setRound(1);
    setSelected(null);
  }, [competition]);

  // A round's tab can disappear when the event changes (a 1-round event
  // after a 3-round one), and a selection from the round being left would
  // otherwise keep a panel open over a grid that no longer contains it.
  useEffect(() => {
    setRound(1);
    setSelected(null);
  }, [eventId]);

  // An armed reset names a specific event and round in its confirm text,
  // so it must not survive either changing. Same for the note, which
  // reports on a scope that is no longer on screen.
  useEffect(() => {
    setResetting(null);
    setResetNote(null);
  }, [competitionId, eventId, round]);

  const load = useCallback(async () => {
    if (!competitionId) return;
    const [regs, subs, scr] = await Promise.all([
      fetch(`/api/online-competition/admin-competitions/${competitionId}/registrations`)
        .then((r) => (r.ok ? r.json() : { registrations: [] }))
        .then((d: { registrations: RegistrationAdminView[] }) => d.registrations ?? [])
        .catch(() => []),
      fetch(`/api/online-competition/submissions?status=all&competitionId=${competitionId}`)
        .then((r) => (r.ok ? r.json() : { submissions: [] }))
        .then((d: { submissions: OnlineSubmissionAdminView[] }) => d.submissions ?? [])
        .catch(() => []),
      fetch(`/api/online-competition/admin-scrambles?competitionId=${competitionId}`)
        .then((r) => (r.ok ? (r.json() as Promise<ScramblesOverview>) : null))
        .catch(() => null),
    ]);
    setRegistrations(regs);
    setSubmissions(subs);
    setScrambles(scr);
  }, [competitionId]);

  useEffect(() => {
    setSubmissions(null);
    load();
  }, [load]);

  const rows: AthleteRow[] = useMemo(() => {
    if (!eventId || submissions === null) return [];
    // This event AND this round. Before competitionRound reached the
    // client, two rounds of the same event landed in the same five cells
    // and showed up as duplicate slots.
    const forEvent = submissions.filter((s) => s.event === eventId && s.competitionRound === round);
    const byUid = new Map<string, AthleteRow>();

    // Registered athletes first, in registration order.
    for (const r of registrations) {
      if (!r.events.includes(eventId)) continue;
      byUid.set(r.uid, {
        uid: r.uid,
        name: r.displayName || r.uid.slice(0, 10),
        attempts: new Map(),
        slotCounts: new Map(),
      });
    }
    // Then anyone who has submissions but no registration — legacy
    // anonymous solve-page sessions predate the registration flow, and
    // hiding their attempts would hide real work from the judge.
    //
    // DUPLICATE SLOTS: still possible, and still meaningful. Filtering by
    // competitionRound removes the commonest cause — two ROUNDS of the
    // same event colliding in one set of five cells — but not duplicates
    // WITHIN a round. Historical runs made before the solve flow filed to
    // a deterministic id (submission-id.ts) wrote a fresh document per
    // attempt on every re-run, and the redo button that produced them was
    // only removed later; real data has up to 10 submissions in one
    // (uid, event, round, attempt) slot. Nothing new can create one — a
    // re-file now lands on the same document — so this is a view of
    // history, not of something the flow still does.
    //
    // A five-column grid can only show one per slot, so the cell shows the
    // OLDEST still-pending submission
    // (falling back to the newest decided one when the slot is fully
    // judged): deciding a cell surfaces the next undecided submission in
    // the same slot, so the judge can still work the whole backlog to
    // zero instead of 30-odd submissions becoming unreachable. The cell
    // also carries a "xN" marker whenever a slot holds more than one.
    const bySlot = new Map<string, OnlineSubmissionAdminView[]>();
    for (const s of forEvent) {
      if (!byUid.has(s.uid)) {
        byUid.set(s.uid, { uid: s.uid, name: s.uid.slice(0, 10), attempts: new Map(), slotCounts: new Map() });
      }
      const key = `${s.uid}#${s.attempt}`;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key)!.push(s);
    }
    for (const [key, list] of bySlot) {
      const [uid, attemptStr] = key.split('#');
      const attemptNum = Number(attemptStr);
      const sorted = [...list].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      const shown = sorted.find((x) => x.status === 'pending') ?? sorted[sorted.length - 1];
      const row = byUid.get(uid)!;
      row.attempts.set(attemptNum, shown);
      row.slotCounts.set(attemptNum, list.length);
    }
    return [...byUid.values()];
  }, [registrations, submissions, eventId, round]);

  const selectedSubmission = useMemo(
    () => (selected ? (submissions ?? []).find((s) => s.id === selected) ?? null : null),
    [selected, submissions],
  );
  const selectedRow = useMemo(
    () => (selectedSubmission ? rows.find((r) => r.uid === selectedSubmission.uid) ?? null : null),
    [selectedSubmission, rows],
  );

  // The selected athlete's real group for the event+round currently in
  // view. `round` here is the competition round the toolbar selects; the
  // attempt index is `attempt` on the submission — see the storage note at
  // the top of this file.
  const selectedGroupLabel = useMemo(() => {
    if (!selectedSubmission || !eventId || !scrambles) return null;
    const key = roundKey(eventId, round);
    const index = scrambles.assignments[key]?.[selectedSubmission.uid];
    if (typeof index !== 'number') return null;
    const data = scrambles.scrambleData.find((d) => d.eventId === eventId && d.round === round);
    return data?.groups[index]?.label ?? null;
  }, [selectedSubmission, eventId, round, scrambles]);

  /** Optimistic local patch, matching the pattern the old dashboard used. */
  const patch = useCallback((id: string, next: Partial<OnlineSubmissionAdminView>) => {
    setSubmissions((prev) => (prev ?? []).map((s) => (s.id === id ? { ...s, ...next } : s)));
  }, []);

  const review = useCallback(
    async (submissionId: string, action: 'approve' | 'approve_plus2' | 'dnf') => {
      const res = await fetch('/api/online-competition/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, action }),
      });
      if (!res.ok) throw new Error('review failed');
      patch(submissionId, {
        status: action === 'dnf' ? 'rejected' : 'approved',
        penalty: action === 'approve_plus2' ? '+2' : action === 'dnf' ? 'DNF' : null,
      });
    },
    [patch],
  );

  /** Same DELETE endpoint the old card-list dashboard used. Drops the
   *  row's attempt locally so the grid updates without a refetch. */
  const remove = useCallback(
    async (submissionId: string) => {
      const res = await fetch(`/api/online-competition/submissions/${submissionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      setSubmissions((prev) => (prev ?? []).filter((s) => s.id !== submissionId));
      setSelected(null);
    },
    [],
  );

  /** Everything this athlete has filed for the event AND round currently
   *  in view — the exact scope the reset endpoint deletes, including the
   *  duplicates hidden behind a cell (row.attempts shows one per slot).
   *  Used for the confirm's counts, so the number the admin agrees to is
   *  the number that actually goes. */
  const scopedFor = useCallback(
    (uid: string) => {
      const mine = (submissions ?? []).filter(
        (s) => s.uid === uid && s.event === eventId && s.competitionRound === round,
      );
      return { total: mine.length, judged: mine.filter(isDecided).length };
    },
    [submissions, eventId, round],
  );

  /** Deletes one athlete's attempts for the selected event and round, so
   *  the round can be solved again from attempt 1.
   *
   *  Scoped identically on both sides: the request carries the four
   *  fields, and the optimistic local drop below filters on the same
   *  three the grid itself filters on — nothing else in the loaded set
   *  can be removed by a reset of this row. */
  const resetAttempts = useCallback(
    async (row: AthleteRow) => {
      if (!competitionId || !eventId) return;
      setBusy(true);
      setResetNote(null);
      try {
        const res = await fetch('/api/online-competition/admin-reset-attempts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ competitionId, uid: row.uid, event: eventId, competitionRound: round }),
        });
        if (!res.ok) throw new Error('reset failed');
        const data = (await res.json()) as {
          deleted: number;
          judged: number;
          videosDeleted: number;
          videosFailed: number;
        };
        setSubmissions((prev) =>
          (prev ?? []).filter(
            (s) => !(s.uid === row.uid && s.event === eventId && s.competitionRound === round),
          ),
        );
        setSelected(null);
        setResetting(null);
        // Says what happened rather than just "done": how many went, how
        // many of those a judge had ruled on, whether any video outlived
        // its document, and that nothing downstream has recomputed.
        setResetNote(
          `${row.name}: ${data.deleted} оролдлого устгагдлаа` +
            (data.judged > 0 ? ` (${data.judged} нь шүүгдсэн байсан)` : '') +
            `. Бичлэг: ${data.videosDeleted} устсан` +
            (data.videosFailed > 0 ? `, ${data.videosFailed} устгаж чадсангүй — гараар шалгана уу` : '') +
            '. Оноо, статистик хуучирсан хэвээр — "Онооны тооцоо шинэчлэх" товчийг дарна уу.',
        );
      } catch (err) {
        console.error('ReviewGrid: resetting the athlete’s attempts failed:', err);
        setResetNote('Устгаж чадсангүй. Дахин оролдоно уу.');
      } finally {
        setBusy(false);
      }
    },
    [competitionId, eventId, round],
  );

  /** Bulk-approve every submitted attempt for one athlete. Deliberately
   *  the same POST the detail panel makes, once per attempt, so the
   *  Firestore writes and audit trail are byte-identical to approving
   *  each attempt individually. */
  const bulkApprove = useCallback(
    async (row: AthleteRow) => {
      setBusy(true);
      try {
        // Every still-pending submission this athlete has for the selected
        // event — including the duplicates hidden behind a cell — so the
        // button's promise ("approve all of this athlete's attempts")
        // holds even when a slot has more than one.
        const mine = (submissions ?? []).filter(
          (s) => s.uid === row.uid && s.event === eventId && s.status === 'pending',
        );
        for (const s of mine) {
          await review(s.id, 'approve');
        }
      } finally {
        setBusy(false);
      }
    },
    [review, submissions, eventId],
  );

  // The selected event's format decides how many attempt columns to draw
  // and how the Дундаж column is computed. Falls back to Ao5 for a legacy
  // event with no stored format (resolveResultFormat's rule).
  const resultFormat = resolveResultFormat(
    competition?.events.find((e) => e.eventId === eventId)?.resultFormat,
  );
  const attemptCount = attemptsForFormat(resultFormat);
  const selectedEvent = competition?.events.find((e) => e.eventId === eventId);
  const timeLimitCs = typeof selectedEvent?.timeLimitCs === 'number' ? selectedEvent.timeLimitCs : null;
  const ATTEMPTS = attemptColumns(attemptCount);

  if (competitions === null) return <p className="oc-v3-status">Ачааллаж байна...</p>;
  if (competitions.length === 0) return <p className="oc-v3-status">Тэмцээн алга.</p>;

  const events = competition?.events ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Top bar ────────────────────────────────────────────────── */}
      <div className="oc-rv-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <h1 className="oc-v3-title">Шүүлт</h1>
          <div className="oc-rv-picker">
            <button type="button" className="oc-rv-picker-btn" onClick={() => setPickerOpen((v) => !v)}>
              {competition?.name ?? 'Тэмцээн сонгох'}
              <span className="oc-v3-tab-caret" aria-hidden>
                ▼
              </span>
            </button>
            {pickerOpen && (
              <div className="oc-rv-menu">
                {competitions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`oc-v3-menu-item${c.id === competitionId ? ' oc-v3-menu-item-active' : ''}`}
                    onClick={() => {
                      setCompetitionId(c.id);
                      setPickerOpen(false);
                    }}
                  >
                    <span aria-hidden style={{ color: c.id === competitionId ? '#DFFF4F' : '#3A3A42' }}>
                      {c.id === competitionId ? '●' : '○'}
                    </span>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {competition?.status === 'live' && (
          <span className="oc-v3-chip oc-v3-chip-pending">
            <span className="oc-v3-dot" aria-hidden />
            {competition.name} · ЯВАГДАЖ БУЙ
          </span>
        )}
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="oc-rv-toolbar">
        <button type="button" className="oc-rv-iconbtn oc-rv-iconbtn-active" aria-label="Хүснэгт харагдац">
          ▦
        </button>
        {/* Only one view mode is specced; the second icon is a visual
            placeholder, deliberately inert. */}
        <span className="oc-rv-iconbtn" aria-hidden title="Удахгүй">
          ▤
        </span>

        <span style={{ width: 1, height: 22, background: '#2A2A31' }} aria-hidden />

        {events.map((e) => (
          <button
            key={e.eventId}
            type="button"
            className={`oc-rv-tab${e.eventId === eventId ? ' oc-rv-tab-active' : ''}`}
            onClick={() => {
              setEventId(e.eventId);
              setSelected(null);
            }}
          >
            {e.label}
          </button>
        ))}

        <span style={{ width: 1, height: 22, background: '#2A2A31' }} aria-hidden />

        {rounds.map((r) => (
          <button
            key={r}
            type="button"
            className={`oc-rv-tab${r === round ? ' oc-rv-tab-active' : ''}`}
            onClick={() => {
              setRound(r);
              // The open panel belongs to the round being left.
              setSelected(null);
            }}
          >
            РАУНД {r}
          </button>
        ))}

        <span style={{ flex: 1 }} />
        {/* Round state lives on its own page — this links there with the
            current competition preselected rather than duplicating
            open/close/advance controls inside the review grid. */}
        <Link
          href={`/online-competition/admin/rounds${competitionId ? `?competitionId=${encodeURIComponent(competitionId)}` : ''}`}
          className="oc-rv-tab"
          style={{ textDecoration: 'none' }}
        >
          РАУНД УДИРДАХ →
        </Link>
      </div>

      {/* ── Grid ───────────────────────────────────────────────────── */}
      <div className="oc-rv-grid">
        <div className="oc-rv-head">
          <span className="oc-rv-th">Нэр</span>
          {ATTEMPTS.map((a) => (
            <span key={a} className="oc-rv-th" style={{ textAlign: 'center' }}>
              {a}
            </span>
          ))}
          <span className="oc-rv-th" style={{ textAlign: 'center' }}>
            Дундаж
          </span>
          <span className="oc-rv-th" style={{ textAlign: 'center' }}>
            Сингл
          </span>
          <span className="oc-rv-th">Шийдвэр</span>
        </div>

        {submissions === null ? (
          <p className="oc-v3-status">Ачааллаж байна...</p>
        ) : rows.length === 0 ? (
          <p className="oc-v3-status">Энэ төрөлд тамирчин алга.</p>
        ) : (
          rows.map((row) => {
            const scope = scopedFor(row.uid);
            return (
              <div key={row.uid}>
                <GridRow
                  row={row}
                  selected={selected}
                  busy={busy}
                  onOpen={setSelected}
                  onBulk={() => bulkApprove(row)}
                  onReset={() => {
                    setResetNote(null);
                    setResetting(row.uid);
                  }}
                  resetCount={scope.total}
                  attemptCount={attemptCount}
                  resultFormat={resultFormat}
                  timeLimitCs={timeLimitCs}
                />
                {/* The confirm is a full-width bar UNDER the row, not
                    inline in the 132px decision column: it has to name the
                    athlete, the event, the round and the count, and that
                    sentence is the whole safety mechanism — cramming it
                    into a cell would truncate the part that says what is
                    about to be destroyed. */}
                {resetting === row.uid && (
                  <div className="oc-rv-reset-confirm">
                    <span className="oc-rv-reset-text">
                      <strong style={{ color: '#F4F1EA' }}>{row.name}</strong> тамирчны{' '}
                      <strong style={{ color: '#F4F1EA' }}>{eventConfig?.label ?? eventId}</strong> төрлийн{' '}
                      <strong style={{ color: '#F4F1EA' }}>{round}-р раундын</strong>{' '}
                      <strong style={{ color: '#F4F1EA' }}>{scope.total}</strong> оролдлого устана
                      {scope.judged > 0 && ` (${scope.judged} нь шүүгдсэн — тэдгээр нь ч бас устана)`}. Бичлэг
                      эргэж сэргэхгүй. Бүртгэл, зөвшөөрөл, бусад раунд хэвээр үлдэнэ.
                    </span>
                    <button
                      type="button"
                      className="oc-rv-reset-yes"
                      disabled={busy}
                      onClick={() => resetAttempts(row)}
                    >
                      ТИЙМ, УСТГА
                    </button>
                    <button
                      type="button"
                      className="oc-rv-reset-no"
                      disabled={busy}
                      onClick={() => setResetting(null)}
                    >
                      ҮГҮЙ
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {resetNote && (
        <p className="oc-rv-reset-note" role="status">
          {resetNote}
        </p>
      )}

      {/* ── Inline detail panel ────────────────────────────────────── */}
      {selectedSubmission && (
        <SubmissionDetailPanel
          submission={selectedSubmission}
          athleteName={selectedRow?.name ?? selectedSubmission.uid.slice(0, 10)}
          groupLabel={selectedGroupLabel}
          onClose={() => setSelected(null)}
          onReview={review}
          onDelete={remove}
        />
      )}
    </div>
  );
}

function GridRow({
  row,
  selected,
  busy,
  onOpen,
  onBulk,
  onReset,
  resetCount,
  attemptCount,
  resultFormat,
  timeLimitCs,
}: {
  row: AthleteRow;
  selected: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onBulk: () => void;
  onReset: () => void;
  /** Attempts this athlete has for the event+round in view, duplicates
   *  included. Zero hides the reset control — there is nothing to reset. */
  resetCount: number;
  /** From the selected event's resultFormat — see attemptColumns. */
  attemptCount: number;
  resultFormat: ResultFormat;
  /** null = no limit. Applied to the Дундаж column so the judge sees the
   *  same number the standings will. */
  timeLimitCs: number | null;
}) {
  const submitted = [...row.attempts.values()];
  const decided = submitted.filter(isDecided);
  const ATTEMPTS = attemptColumns(attemptCount);

  // The result and the single are computed from DECIDED attempts only — an
  // undecided time isn't a result yet. Needs every attempt of the event's
  // format decided before the average column shows anything.
  const decidedByAttempt = ATTEMPTS.map((a) => {
    const s = row.attempts.get(a);
    return s && isDecided(s) ? effectiveTime(s, timeLimitCs) : null;
  });
  const allDecided = decidedByAttempt.every((t) => t !== null);
  const ao5 = allDecided ? computeResult(decidedByAttempt as AttemptTime[], resultFormat).value : undefined;
  const numeric = decidedByAttempt.filter((t): t is number => typeof t === 'number');
  const single = numeric.length > 0 ? Math.min(...numeric) : null;

  const untouched = decided.length === 0;

  return (
    <div className="oc-rv-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span className="oc-rv-initials" aria-hidden>
          {initials(row.name)}
        </span>
        <span
          style={{
            font: '500 13px var(--oc-font-heading), sans-serif',
            color: '#F4F1EA',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.name}
        </span>
      </div>

      {ATTEMPTS.map((a) => {
        const s = row.attempts.get(a);
        if (!s) {
          return (
            <span key={a} className="oc-rv-cell oc-rv-cell-empty">
              —
            </span>
          );
        }
        const cls = [
          'oc-rv-cell',
          isDnf(s) ? 'oc-rv-cell-dnf' : !isDecided(s) ? 'oc-rv-cell-pending' : '',
          s.id === selected ? 'oc-rv-cell-selected' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const dupes = row.slotCounts.get(a) ?? 1;
        return (
          <button
            key={a}
            type="button"
            className={cls}
            onClick={() => onOpen(s.id)}
            title={dupes > 1 ? `${dupes} илгээмж энэ нүдэнд` : undefined}
          >
            {isDnf(s) ? 'DNF' : `${fmtCentiseconds(s.reportedTime)}${s.penalty === '+2' ? '+' : ''}`}
            {dupes > 1 && (
              <span style={{ marginLeft: 4, font: '500 9px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
                x{dupes}
              </span>
            )}
          </button>
        );
      })}

      <span className={`oc-rv-avg${ao5 ? ' oc-rv-avg-real' : ''}`}>
        {ao5 === undefined ? '—' : ao5 === null ? 'DNF' : fmtCentiseconds(ao5)}
      </span>
      <span className="oc-rv-avg">{single === null ? '—' : fmtCentiseconds(single)}</span>

      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        {untouched && submitted.length > 0 ? (
          <button type="button" className="oc-rv-bulk" disabled={busy} onClick={onBulk}>
            БАТАЛГААЖУУЛАХ
          </button>
        ) : submitted.length === 0 ? (
          <span className="oc-rv-await">ИЛГЭЭГЭЭГҮЙ</span>
        ) : (
          <span className="oc-rv-await">ХЯНАЛТ ХҮЛЭЭЖ</span>
        )}
        {/* Reset lives here, under the decision control, because this row
            IS the scope: one athlete, the event tab above, the round tab
            above. Quiet by default (a muted link, not a button competing
            with БАТАЛГААЖУУЛАХ) — it destroys work, so it should be found
            when looked for, not pressed on the way past. Hidden entirely
            when the athlete has nothing filed for this round. */}
        {resetCount > 0 && (
          <button type="button" className="oc-rv-reset" disabled={busy} onClick={onReset}>
            ОРОЛДЛОГО ДАХИН ЭХЛҮҮЛЭХ
          </button>
        )}
      </span>
    </div>
  );
}
