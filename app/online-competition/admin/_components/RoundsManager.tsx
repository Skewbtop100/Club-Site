'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import type { RoundAdminView, RoundsSummary } from '@/app/api/online-competition/admin-rounds/route';
import type { QualifyResponse } from '@/app/api/online-competition/admin-rounds/qualify/route';
import type { QualifierMethod, RoundRanking } from '@/lib/online-competition/rounds';
import { roundKey } from '@/lib/online-competition/scrambles';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import RoundGapWarning, { type RoundGapEvent } from './RoundGapWarning';
import RoundStatusHeader, { fmtWindow } from './RoundStatusHeader';
import RoundAthleteTable from './RoundAthleteTable';

// ── Раунд удирдах ────────────────────────────────────────────────────────
// Open / close / advance each event's rounds. Every write goes through the
// admin-cookie-gated /api/online-competition/admin-rounds routes; this
// component never touches Firestore.
//
// Styling follows the rest of the admin section: literal inline styles or
// `.oc-*` classes from theme.css, no runtime-assembled Tailwind, and no
// margin/padding utility that globals.css's unlayered reset would zero.

/** The round transition went through; the announcement did not. */
const NOTIFY_FAILED_TEXT =
  'Раунд шинэчлэгдсэн, гэхдээ тамирчдад дүн / шалгаралтын мэдэгдэл ИЛГЭЭГДСЭНГҮЙ.';

const STATUS_LABEL = {
  closed: 'ХААЛТТАЙ',
  live: 'ЯВАГДАЖ БУЙ',
  done: 'ДУУССАН',
} as const;

function fmtTime(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function RoundsManager() {
  const searchParams = useSearchParams();
  const preselect = searchParams.get('competitionId');

  const [competitions, setCompetitions] = useState<OnlineCompetitionAdminView[] | null>(null);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rounds, setRounds] = useState<RoundAdminView[] | null>(null);
  /** What is running now and what is next, from the same response as the
   *  rows — see RoundStatusHeader, which reads the numbers off `rounds`
   *  rather than fetching its own. */
  const [summary, setSummary] = useState<RoundsSummary | null>(null);
  /** The round whose athlete table is open, as `event_round`. One at a
   *  time: two open tables is two payloads for a question about one round. */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  // Events with no round open at all, straight from the API (computed
  // there with the solve gate's own liveRoundsForEvent) — never derived
  // from `rounds` here, which would be a second copy of that rule.
  const [gaps, setGaps] = useState<RoundGapEvent[]>([]);
  // Events with MORE than one live round, same source. The gate admits
  // nobody to such an event until one round is closed.
  const [conflicts, setConflicts] = useState<{ eventId: string; label: string; rounds: number[] }[]>([]);
  const [loadError, setLoadError] = useState('');
  /** Set when opening a round also announced the competition — the side
   *  effect said out loud, rather than discovered on the public site. */
  const [announced, setAnnounced] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    key: string;
    message: string;
    /** Named athletes behind a refusal, when there are any — the
     *  round-start check returns who is unassigned, and the admin's
     *  next click is to assign exactly these people. */
    unassigned?: { uid: string; displayName: string }[];
  } | null>(null);
  const [qualifyKey, setQualifyKey] = useState<string | null>(null);
  /** A close or cut went through but its athlete notifications did not —
   *  or the resend's outcome. Keyed by round so it sits under that row. */
  const [notifyNote, setNotifyNote] = useState<{ key: string; ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/online-competition/admin-competitions')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { competitions: OnlineCompetitionAdminView[] }) => {
        if (cancelled) return;
        const list = d.competitions ?? [];
        setCompetitions(list);
        // Preselect from ?competitionId= (the review grid's round link),
        // else the live competition, else the most recently starting one.
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

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoadError('');
    try {
      const res = await fetch(
        `/api/online-competition/admin-rounds?competitionId=${encodeURIComponent(competitionId)}`,
      );
      if (!res.ok) throw new Error('failed');
      const d = (await res.json()) as {
        rounds: RoundAdminView[];
        summary?: RoundsSummary;
        eventsWithoutLiveRound?: RoundGapEvent[];
        eventsWithConflictingLiveRounds?: { eventId: string; label: string; rounds: number[] }[];
      };
      setRounds(d.rounds ?? []);
      setSummary(d.summary ?? null);
      setGaps(d.eventsWithoutLiveRound ?? []);
      setConflicts(d.eventsWithConflictingLiveRounds ?? []);
    } catch (err) {
      console.error('RoundsManager: loading rounds failed:', err);
      setRounds(null);
      setSummary(null);
      setGaps([]);
      setConflicts([]);
      setLoadError('Раундын мэдээллийг ачааллаж чадсангүй');
    }
  }, [competitionId]);

  useEffect(() => {
    setRounds(null);
    setSummary(null);
    setDetailKey(null);
    setGaps([]);
    setQualifyKey(null);
    setRowError(null);
    setNotifyNote(null);
    load();
  }, [load]);

  async function toggle(row: RoundAdminView, action: 'open' | 'close' | 'reset') {
    // БУЦААХ undoes a round so the cut before it can be redone. The server
    // refuses it if anything was filed in the round; asked first regardless,
    // because it discards this round's own cut.
    if (action === 'reset') {
      const ok = window.confirm(
        `${row.label} · ${row.round}-р раундыг НЭЭГЭЭГҮЙ төлөвт буцаах уу? ` +
          `Энэ раундын шалгаруулалт устна. Оролдлого бүртгэгдсэн бол буцаахгүй.`,
      );
      if (!ok) return;
    }
    // ── CLOSING GUARD ──
    // Closing stops new attempts, so an athlete part-way through a round
    // loses the rest of it. The numbers are the row's own — the same ones
    // the header and the athlete table show — so this warning can never
    // name a different figure from the screen behind it.
    //
    // It names BOTH, because they are different problems with different
    // fixes: unfinished athletes need more time, unjudged submissions need
    // a judge, and closing does not block either from being resolved
    // afterwards. Only asked when there is something to say; a round
    // everyone has finished closes on one click, as it did before.
    if (action === 'close' && (row.incomplete > 0 || row.pendingSubmissions > 0)) {
      const parts: string[] = [];
      if (row.incomplete > 0) {
        parts.push(
          `${row.incomplete} тамирчин оролдлогоо дуусгаагүй` +
            (row.notStarted > 0 ? ` (${row.notStarted} нь огт эхлээгүй)` : ''),
        );
      }
      if (row.pendingSubmissions > 0) {
        parts.push(`${row.pendingSubmissions} тайлалт шүүгдээгүй`);
      }
      const ok = window.confirm(
        `${row.label} · ${row.round}-р раунд:\n${parts.join('\n')}\n\n` +
          `Хаавал тамирчид шинэ оролдлого хийж чадахгүй. ` +
          `Шүүгдээгүй тайлалтыг дараа шүүх боломжтой. Хаах уу?`,
      );
      if (!ok) return;
    }
    const key = roundKey(row.eventId, row.round);
    // OPENING A ROUND ANNOUNCES THE COMPETITION. An upcoming competition
    // becomes live in the same transaction (round-open.ts), because every
    // athlete-facing surface reads competition.status and an open round in
    // an "upcoming" competition is reachable only by typing the solve URL.
    // Asked first: it is a public change, and an admin opening a round to
    // test something should not publish the competition by accident.
    if (action === 'open' && competition && competition.status === 'upcoming') {
      const ok = window.confirm(
        `«${competition.name}» тэмцээн ЯВАГДАЖ БУЙ болж, нийтэд харагдана. ` +
          `${row.label} · ${row.round}-р раундыг нээх үү?`,
      );
      if (!ok) return;
    }
    setBusyKey(key);
    setRowError(null);
    setAnnounced('');
    setNotifyNote(null);
    try {
      const res = await fetch('/api/online-competition/admin-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId, eventId: row.eventId, round: row.round, action }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        announcedLive?: boolean;
        notified?: boolean;
        unassigned?: { uid: string; displayName: string }[];
      };
      if (!res.ok) {
        setRowError({
          key,
          message: data.error ?? 'Үйлдэл амжилтгүй боллоо.',
          unassigned: data.unassigned,
        });
        return;
      }
      if (data.announcedLive) {
        setAnnounced('Тэмцээн ЯВАГДАЖ БУЙ болж, нийтэд харагдаж эхэллээ.');
      }
      if (action === 'close' && data.notified === false) {
        setNotifyNote({ key, ok: false, message: NOTIFY_FAILED_TEXT });
      }
      await load();
    } catch (err) {
      console.error('RoundsManager: the round open/close action failed:', err);
      setRowError({ key, message: 'Үйлдэл амжилтгүй боллоо. Дахин оролдоно уу.' });
    } finally {
      setBusyKey(null);
    }
  }

  /** МЭДЭГДЭЛ ДАХИН ИЛГЭЭХ — the same idempotent send the close or cut
   *  made, which only sends what is still owed. */
  async function resendNotifications(row: RoundAdminView) {
    const key = roundKey(row.eventId, row.round);
    setBusyKey(key);
    try {
      const res = await fetch('/api/online-competition/admin-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId, eventId: row.eventId, round: row.round, action: 'notify' }),
      });
      const data = (await res.json().catch(() => ({}))) as { notified?: boolean; error?: string };
      if (res.ok && data.notified) {
        setNotifyNote({ key, ok: true, message: 'Мэдэгдэл тамирчдад илгээгдлээ.' });
      } else {
        setNotifyNote({ key, ok: false, message: data.error ?? `${NOTIFY_FAILED_TEXT} Дахин оролдлого ч амжилтгүй боллоо.` });
      }
    } catch (err) {
      console.error('RoundsManager: resending notifications failed:', err);
      setNotifyNote({ key, ok: false, message: `${NOTIFY_FAILED_TEXT} Сервертэй холбогдож чадсангүй.` });
    } finally {
      setBusyKey(null);
    }
  }

  if (competitions === null) return <p className="oc-v3-status">Ачааллаж байна...</p>;
  if (competitions.length === 0) return <p className="oc-v3-status">Тэмцээн алга.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="oc-rv-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <h1 className="oc-v3-title">Раунд удирдах</h1>
            <p className="oc-rd-note" style={{ marginTop: 5 }}>
              НЭЭХ · ХААХ · ШАЛГАРУУЛАХ
            </p>
          </div>
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
      </div>

      {loadError && <p className="oc-v3-status-error">{loadError}</p>}
      {announced && (
        <p
          role="status"
          style={{
            marginBottom: 12,
            border: '1px solid #2A2A31',
            borderLeft: '2px solid #DFFF4F',
            background: '#0F0F13',
            padding: '10px 12px',
            font: '500 11px var(--oc-font-heading), sans-serif',
            color: '#F4F1EA',
          }}
        >
          {announced}
        </p>
      )}

      {/* One line per event with no round open, at the top of the panel —
          the ОНГОЙЛОХ button that fixes each one is in the rows
          directly below. Rendered per event rather than as a single
          combined line so an admin scanning a multi-event competition can
          match each warning to its own row. */}
      {gaps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {gaps.map((g) => (
            <RoundGapWarning key={g.eventId} events={[g]} />
          ))}
        </div>
      )}

      {/* Two live rounds of one event: every athlete in it is refused until
          one is closed. openRound no longer allows this, so it only shows
          for a state left over from before. */}
      {conflicts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {conflicts.map((c) => (
            <div key={c.eventId} className="oc-sc-warn" style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <span aria-hidden>▲</span>
              <span>
                {c.label}: {c.rounds.map((r) => `${r}-р`).join(', ')} раунд зэрэг нээлттэй — тамирчид эвлүүлэлт хийж
                чадахгүй. Нэгийг нь хаана уу.
              </span>
            </div>
          ))}
        </div>
      )}

      {/* WHAT IS RUNNING NOW — above everything, because it is the answer
          to the question an admin opens this page with. */}
      {rounds !== null && rounds.length > 0 && (
        <RoundStatusHeader summary={summary} rounds={rounds} onOpenDetail={setDetailKey} />
      )}

      {rounds === null && !loadError ? (
        <p className="oc-v3-status">Ачааллаж байна...</p>
      ) : rounds && rounds.length === 0 ? (
        <p className="oc-sc-empty">Энэ тэмцээнд төрөл тохируулаагүй байна.</p>
      ) : (
        <div className="oc-sc-card">
          {rounds?.map((row) => {
            const key = roundKey(row.eventId, row.round);
            return (
              <div key={key}>
                <div className="oc-rd-row">
                  <div className="oc-rd-main">
                    <span className="oc-sc-icon" aria-hidden>
                      {row.eventId.toUpperCase().slice(0, 5)}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="oc-rd-name">
                        {row.label} · Раунд {row.round}
                      </span>
                      <span className="oc-rd-sub">
                        {row.qualifierCount > 0
                          ? `${row.qualifierCount} ТАМИРЧИН ШАЛГАРСАН`
                          : row.round > 1 && !row.canOpen
                            ? `${row.round - 1}-Р РАУНД ШАЛГАРУУЛААГҮЙ`
                            : 'ШАЛГАРУУЛААГҮЙ'}
                      </span>
                    </span>
                  </div>

                  {/* THE PROGRAMME'S SLOT, not when it was opened —
                      openedAt is below, as the smaller of the two. What an
                      admin checks against the clock is the schedule. */}
                  <span className="oc-rd-time" title="Хуваарийн цаг">
                    {row.scheduledStartMs !== null
                      ? fmtWindow(row.scheduledStartMs, row.scheduledEndMs)
                      : '—'}
                  </span>

                  {/* PARTICIPANTS AND THE THREE NUMBERS. complete +
                      incomplete is always participants; the pending count
                      is submissions, so it is labelled apart. */}
                  <span className="oc-rd-nums" title="Тамирчин · дуусгасан / дуусгаагүй · шүүгдээгүй тайлалт">
                    <span style={{ color: '#F4F1EA' }}>{row.participants}</span>
                    <span style={{ color: '#2A2A31' }}>|</span>
                    <span style={{ color: '#4FD07A' }}>{row.complete}</span>
                    <span style={{ color: '#2A2A31' }}>/</span>
                    <span style={{ color: row.incomplete > 0 ? '#F4F1EA' : '#4A4740' }}>
                      {row.incomplete}
                    </span>
                    {row.pendingSubmissions > 0 && (
                      <>
                        <span style={{ color: '#2A2A31' }}>|</span>
                        <span style={{ color: '#DFFF4F' }}>▲{row.pendingSubmissions}</span>
                      </>
                    )}
                  </span>

                  <span
                    className={`oc-rd-badge${row.status === 'live' ? ' oc-rd-badge-live' : row.status === 'done' ? ' oc-rd-badge-done' : ''}`}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>

                  <div className="oc-rd-actions">
                    {row.status === 'live' ? (
                      <button
                        type="button"
                        className="oc-sc-btn oc-rd-close"
                        disabled={busyKey === key}
                        onClick={() => toggle(row, 'close')}
                      >
                        РАУНД ХААХ
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="oc-sc-btn oc-rd-open"
                        disabled={busyKey === key || !row.canOpen}
                        title={row.canOpen ? undefined : 'Өмнөх раундаа эхлээд шалгаруулна уу'}
                        onClick={() => toggle(row, 'open')}
                      >
                        РАУНД НЭЭХ
                      </button>
                    )}
                    {row.status !== 'live' && (row.status === 'done' || row.openedAt !== null) && (
                      <button
                        type="button"
                        className="oc-sc-btn"
                        disabled={busyKey === key}
                        title="Раундыг нээгээгүй төлөвт буцаах — өмнөх раундын шалгаруулалтыг дахин хийхэд"
                        onClick={() => toggle(row, 'reset')}
                      >
                        БУЦААХ
                      </button>
                    )}
                    <button
                      type="button"
                      className="oc-sc-btn"
                      aria-expanded={detailKey === key}
                      onClick={() => setDetailKey(detailKey === key ? null : key)}
                    >
                      ТАМИРЧИД
                    </button>
                    <button
                      type="button"
                      className="oc-sc-btn"
                      disabled={busyKey === key}
                      onClick={() => setQualifyKey(qualifyKey === key ? null : key)}
                    >
                      ШАЛГАРУУЛАХ
                    </button>
                  </div>
                </div>

                {detailKey === key && (
                  <RoundAthleteTable
                    competitionId={competitionId as string}
                    eventId={row.eventId}
                    round={row.round}
                  />
                )}

                {rowError?.key === key && (
                  <div style={{ padding: '0 14px 12px' }}>
                    <p className="oc-sc-msg-err">{rowError.message}</p>
                    {/* NAMES, NOT A COUNT. "3 athletes are unassigned"
                        leaves the admin to find out which three; the list
                        IS the next action. Wraps rather than scrolls, and
                        falls back to the uid for an athlete with no
                        display name so nobody is silently omitted. */}
                    {rowError.unassigned && rowError.unassigned.length > 0 && (
                      <ul
                        style={{
                          margin: '8px 0 0',
                          padding: 0,
                          listStyle: 'none',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 6,
                        }}
                      >
                        {rowError.unassigned.map((a) => (
                          <li
                            key={a.uid}
                            style={{
                              border: '1px solid #2A2A31',
                              padding: '4px 8px',
                              font: '500 10px var(--oc-font-mono), monospace',
                              color: '#F4F1EA',
                            }}
                          >
                            {a.displayName || a.uid.slice(0, 10)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {notifyNote?.key === key && (
                  <div style={{ padding: '0 14px 12px' }}>
                    {notifyNote.ok ? (
                      <p role="status" style={{ font: '500 11px var(--oc-font-heading), sans-serif', color: '#4FD07A' }}>
                        {notifyNote.message}
                      </p>
                    ) : (
                      <div className="oc-sc-warn" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span>{notifyNote.message}</span>
                        <button
                          type="button"
                          className="oc-sc-btn"
                          disabled={busyKey === key}
                          onClick={() => resendNotifications(row)}
                        >
                          МЭДЭГДЭЛ ДАХИН ИЛГЭЭХ
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {qualifyKey === key && competitionId && (
                  <div style={{ padding: '0 14px 14px' }}>
                    <QualifyForm
                      competitionId={competitionId}
                      row={row}
                      onDone={async (notified) => {
                        setQualifyKey(null);
                        if (!notified) setNotifyNote({ key, ok: false, message: NOTIFY_FAILED_TEXT });
                        await load();
                      }}
                      onCancel={() => setQualifyKey(null)}
                    />
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

/** Inline ШАЛГАРУУЛАХ form: pick a method + value, preview who advances,
 *  then commit. The preview is a real server-side ranking, not a guess —
 *  and the commit re-ranks rather than posting the previewed uids back, so
 *  the list can't be tampered with in the browser. */
function QualifyForm({
  competitionId,
  row,
  onDone,
  onCancel,
}: {
  competitionId: string;
  row: RoundAdminView;
  /** After a commit; `notified` false means the cut is in but athletes
   *  were not told. */
  onDone: (notified: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  // Prefill precedence: what this round was LAST CUT TO wins over the
  // plan, so re-running ШАЛГАРУУЛАХ on an already-committed round defaults
  // to what actually happened rather than to an intention that may have
  // been edited since. The plan only fills in a round never qualified yet.
  // Both are only ever defaults — the admin sees them and can change them,
  // and the value that gets used is the one submitted (the route refuses a
  // request that omits it; see the comment there).
  const [method, setMethod] = useState<QualifierMethod>(
    row.qualifierMethod ?? row.plannedMethod ?? 'count',
  );
  const [value, setValue] = useState<string>(
    row.qualifierValue != null
      ? String(row.qualifierValue)
      : row.plannedValue != null
        ? String(row.plannedValue)
        : '',
  );
  const [preview, setPreview] = useState<QualifyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(mode: 'preview' | 'commit') {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-rounds/qualify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitionId,
          eventId: row.eventId,
          round: row.round,
          method,
          value: Number(value),
          mode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as QualifyResponse & { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Шалгаруулахад алдаа гарлаа.');
        return;
      }
      if (mode === 'commit') {
        await onDone(data.notified !== false);
        return;
      }
      setPreview(data);
    } catch (err) {
      console.error('RoundsManager: the qualify action failed:', err);
      setError('Шалгаруулахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setBusy(false);
    }
  }

  const qualifiedUids = new Set(preview?.qualifiers.map((q) => q.uid) ?? []);

  return (
    <div className="oc-rd-form">
      <div className="oc-rd-formrow">
        <span className="oc-sc-mono">Шалгаруулах арга</span>
        <select
          className="oc-sc-select"
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as QualifierMethod);
            setPreview(null);
          }}
        >
          <option value="count">Тоогоор</option>
          <option value="percent">Хувиар</option>
        </select>
        <input
          className="oc-rd-input"
          type="number"
          min={1}
          max={method === 'percent' ? 100 : undefined}
          inputMode="numeric"
          placeholder={method === 'percent' ? '%' : 'тоо'}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setPreview(null);
          }}
        />
        <button
          type="button"
          className="oc-sc-btn"
          disabled={busy || value.trim() === ''}
          onClick={() => send('preview')}
        >
          {busy && !preview ? 'ТООЦООЛЖ БАЙНА...' : 'УРЬДЧИЛАН ХАРАХ'}
        </button>
        <button type="button" className="oc-sc-btn" disabled={busy} onClick={onCancel}>
          ЦУЦЛАХ
        </button>
      </div>

      {error && <p className="oc-sc-msg-err">{error}</p>}

      {preview && (
        <>
          <p className="oc-sc-hint">
            {preview.ranked.length} тамирчин дүүргэсэн · {preview.qualifiers.length} тамирчин шалгарна.
            {preview.ranked.length === 0 &&
              ' Бүрэн шүүгдсэн дүн байхгүй тул шалгарах тамирчин алга.'}
          </p>

          {preview.ranked.length > 0 && (
            <div className="oc-rd-preview">
              {preview.ranked.map((r: RoundRanking, i) => {
                const inCut = qualifiedUids.has(r.uid);
                return (
                  <div key={r.uid} className={`oc-rd-prow${inCut ? '' : ' oc-rd-prow-out'}`}>
                    <span className="oc-sc-num oc-sc-num-dim">{i + 1}</span>
                    <span className="oc-sc-name">{r.displayName}</span>
                    <span className="oc-sc-num" style={{ textAlign: 'right' }}>
                      {/* A DNF-result athlete is in the standings now, so
                          the preview shows them — ranked, on their single,
                          and marked ШАЛГАРАХГҮЙ because selectQualifiers
                          can never include them. */}
                      {r.value === null ? 'DNF' : fmtCentiseconds(r.value)}
                    </span>
                    <span className={`oc-rd-badge${inCut ? ' oc-rd-badge-done' : ''}`}>
                      {inCut ? 'ШАЛГАРНА' : 'ШАЛГАРАХГҮЙ'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="oc-rd-formrow">
            <button
              type="button"
              className="oc-sc-btn oc-sc-btn-primary"
              disabled={busy}
              onClick={() => send('commit')}
            >
              {busy ? 'ХАДГАЛЖ БАЙНА...' : 'БАТАЛГААЖУУЛАХ'}
            </button>
            <span className="oc-sc-hint">
              Баталгаажуулснаар энэ раунд дуусч, дараагийн раунд нээх боломжтой болно.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
