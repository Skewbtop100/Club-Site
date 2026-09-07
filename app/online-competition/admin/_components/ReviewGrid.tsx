'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type {
  OnlineCompetitionAdminView,
  OnlineSubmissionAdminView,
} from '@/lib/online-competition/types';
import type { RegistrationAdminView } from '@/app/api/online-competition/admin-competitions/[id]/registrations/route';
import { computeAo5, type AttemptTime } from '@/lib/online-competition/ao5';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import SubmissionDetailPanel from './SubmissionDetailPanel';

const ATTEMPTS = [1, 2, 3, 4, 5];

// ── How attempts map to storage ──────────────────────────────────────────
// The solve flow writes one onlineSubmissions doc per attempt with
// `round: i + 1` (see the createSubmission call in
// app/online-competition/[competitionId]/solve/[eventId]/page.tsx), so a
// submission's `round` IS its attempt index 1-5 — not a competition round.
// The five attempt columns below therefore key off `round`, which is also
// what makes the Ao5 columns computable at all. There is currently no
// field anywhere that distinguishes one competition round from another,
// which is why the round tab strip has exactly one entry; see the comment
// on ROUNDS below.
const ROUNDS = [1];

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
/** Effective time for Ao5: +2 adds 200 centiseconds, DNF is a DNF. */
function effectiveTime(s: OnlineSubmissionAdminView): AttemptTime {
  if (isDnf(s)) return 'DNF';
  return s.penalty === '+2' ? s.reportedTime + 200 : s.reportedTime;
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
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  // Default the event to the competition's first configured one.
  useEffect(() => {
    setEventId(competition?.events[0]?.eventId ?? null);
    setSelected(null);
  }, [competition]);

  const load = useCallback(async () => {
    if (!competitionId) return;
    const [regs, subs] = await Promise.all([
      fetch(`/api/online-competition/admin-competitions/${competitionId}/registrations`)
        .then((r) => (r.ok ? r.json() : { registrations: [] }))
        .then((d: { registrations: RegistrationAdminView[] }) => d.registrations ?? [])
        .catch(() => []),
      fetch(`/api/online-competition/submissions?status=all&competitionId=${competitionId}`)
        .then((r) => (r.ok ? r.json() : { submissions: [] }))
        .then((d: { submissions: OnlineSubmissionAdminView[] }) => d.submissions ?? [])
        .catch(() => []),
    ]);
    setRegistrations(regs);
    setSubmissions(subs);
  }, [competitionId]);

  useEffect(() => {
    setSubmissions(null);
    load();
  }, [load]);

  const rows: AthleteRow[] = useMemo(() => {
    if (!eventId || submissions === null) return [];
    const forEvent = submissions.filter((s) => s.event === eventId);
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
    // DUPLICATE SLOTS: nothing stops an athlete re-running the solve flow,
    // and each run writes a fresh doc for rounds 1-5 with no field marking
    // which run it belongs to. Real data has up to 10 submissions sharing
    // one (uid, event, round) slot. A five-column grid can only show one
    // per slot, so the cell shows the OLDEST still-pending submission
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
      const key = `${s.uid}#${s.round}`;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key)!.push(s);
    }
    for (const [key, list] of bySlot) {
      const [uid, roundStr] = key.split('#');
      const roundNum = Number(roundStr);
      const sorted = [...list].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      const shown = sorted.find((x) => x.status === 'pending') ?? sorted[sorted.length - 1];
      const row = byUid.get(uid)!;
      row.attempts.set(roundNum, shown);
      row.slotCounts.set(roundNum, list.length);
    }
    return [...byUid.values()];
  }, [registrations, submissions, eventId]);

  const selectedSubmission = useMemo(
    () => (selected ? (submissions ?? []).find((s) => s.id === selected) ?? null : null),
    [selected, submissions],
  );
  const selectedRow = useMemo(
    () => (selectedSubmission ? rows.find((r) => r.uid === selectedSubmission.uid) ?? null : null),
    [selectedSubmission, rows],
  );

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

        {ROUNDS.map((r) => (
          <button
            key={r}
            type="button"
            className={`oc-rv-tab${r === round ? ' oc-rv-tab-active' : ''}`}
            onClick={() => setRound(r)}
          >
            РАУНД {r}
          </button>
        ))}

        <span style={{ flex: 1 }} />
        <span className="oc-rv-finish" aria-disabled="true">
          РАУНД ДУУСГАХ (Удахгүй)
        </span>
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
          rows.map((row) => (
            <GridRow
              key={row.uid}
              row={row}
              selected={selected}
              busy={busy}
              onOpen={setSelected}
              onBulk={() => bulkApprove(row)}
            />
          ))
        )}
      </div>

      {/* ── Inline detail panel ────────────────────────────────────── */}
      {selectedSubmission && (
        <SubmissionDetailPanel
          submission={selectedSubmission}
          athleteName={selectedRow?.name ?? selectedSubmission.uid.slice(0, 10)}
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
}: {
  row: AthleteRow;
  selected: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onBulk: () => void;
}) {
  const submitted = [...row.attempts.values()];
  const decided = submitted.filter(isDecided);

  // Ao5/single are computed from DECIDED attempts only — an undecided time
  // isn't a result yet. Needs all five decided to be a real Ao5.
  const decidedByAttempt = ATTEMPTS.map((a) => {
    const s = row.attempts.get(a);
    return s && isDecided(s) ? effectiveTime(s) : null;
  });
  const allDecided = decidedByAttempt.every((t) => t !== null);
  const ao5 = allDecided ? computeAo5(decidedByAttempt as AttemptTime[]).ao5 : undefined;
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

      <span>
        {untouched && submitted.length > 0 ? (
          <button type="button" className="oc-rv-bulk" disabled={busy} onClick={onBulk}>
            БАТАЛГААЖУУЛАХ
          </button>
        ) : submitted.length === 0 ? (
          <span className="oc-rv-await">ИЛГЭЭГЭЭГҮЙ</span>
        ) : (
          <span className="oc-rv-await">ХЯНАЛТ ХҮЛЭЭЖ</span>
        )}
      </span>
    </div>
  );
}
