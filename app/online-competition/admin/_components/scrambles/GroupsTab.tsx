'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import type { ScrambleRosterAthlete } from '@/lib/online-competition/scramble-roster';
import { roundKey, type ScrambleRoundData } from '@/lib/online-competition/scrambles';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { EventChips, eventLabel, roundTitle } from './shared';

// ── Tab 04 · Групп ───────────────────────────────────────────────────────
// The snake-seeded group assignment, unchanged underneath — this is the
// mockup's table over the same auto-assign / manual-move API routes.
//
// Assignment is stored per event+round, so one section renders per round
// of the selected event, each with its own controls. There is no hidden
// round picker: every imported round of the event is on screen.

type Metric = 'single' | 'average';

const COLUMNS = '44px minmax(150px, 1.6fr) 92px 92px 84px 104px';
const MIN_WIDTH = 720;

export default function GroupsTab({
  competitionId,
  competition,
  scrambleData,
  assignments,
  autoAssignments,
  athletes,
  onChanged,
}: {
  competitionId: string | null;
  competition: OnlineCompetitionAdminView | null;
  scrambleData: ScrambleRoundData[];
  assignments: Record<string, Record<string, number>>;
  autoAssignments: Record<string, Record<string, number>>;
  athletes: ScrambleRosterAthlete[];
  onChanged: () => Promise<void>;
}) {
  const choices = useMemo(() => {
    const ids = [...new Set(scrambleData.map((d) => d.eventId))];
    return ids.map((eventId) => ({
      eventId,
      label: eventLabel(competition, eventId),
      count: scrambleData.filter((d) => d.eventId === eventId).length,
    }));
  }, [scrambleData, competition]);

  const [eventId, setEventId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('single');

  useEffect(() => {
    setEventId((current) =>
      current && choices.some((c) => c.eventId === current) ? current : (choices[0]?.eventId ?? null),
    );
  }, [choices]);

  if (scrambleData.length === 0) {
    return (
      <p className="oc-sc-empty">
        Холилт импортлогдоогүй байна. Групп үүсгэхийн тулд эхлээд &quot;Файл&quot; хэсгээс JSON файлаа оруулна уу.
      </p>
    );
  }

  const rounds = scrambleData.filter((d) => d.eventId === eventId);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <EventChips choices={choices} value={eventId} onChange={setEventId} />
        <span style={{ flex: 1 }} />
        <div className="oc-sc-seg" role="group" aria-label="Эрэмбэлэх үзүүлэлт">
          <button
            type="button"
            className={`oc-sc-segbtn${metric === 'single' ? ' oc-sc-segbtn-active' : ''}`}
            aria-pressed={metric === 'single'}
            onClick={() => setMetric('single')}
          >
            СИНГЛ
          </button>
          <button
            type="button"
            className={`oc-sc-segbtn${metric === 'average' ? ' oc-sc-segbtn-active' : ''}`}
            aria-pressed={metric === 'average'}
            onClick={() => setMetric('average')}
          >
            ДУНДАЖ
          </button>
        </div>
      </div>

      {rounds.map((round) => (
        <RoundSection
          key={roundKey(round.eventId, round.round)}
          competitionId={competitionId}
          competition={competition}
          round={round}
          assignments={assignments[roundKey(round.eventId, round.round)] ?? {}}
          autoAssignments={autoAssignments[roundKey(round.eventId, round.round)] ?? {}}
          athletes={athletes}
          metric={metric}
          onChanged={onChanged}
        />
      ))}
    </>
  );
}

function RoundSection({
  competitionId,
  competition,
  round,
  assignments,
  autoAssignments,
  athletes,
  metric,
  onChanged,
}: {
  competitionId: string | null;
  competition: OnlineCompetitionAdminView | null;
  round: ScrambleRoundData;
  assignments: Record<string, number>;
  autoAssignments: Record<string, number>;
  athletes: ScrambleRosterAthlete[];
  metric: Metric;
  onChanged: () => Promise<void>;
}) {
  // Local overlay on the server's map so a manual move repaints
  // immediately instead of waiting on a refetch.
  const [local, setLocal] = useState<Record<string, number>>(assignments);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLocal(assignments);
  }, [assignments]);

  const statOf = useCallback(
    (a: ScrambleRosterAthlete) =>
      (metric === 'single' ? a.prByEvent[round.eventId] : a.ao5ByEvent[round.eventId]) ?? null,
    [metric, round.eventId],
  );

  // Only athletes registered for THIS event — the same filter the server's
  // seeder applies.
  const rows = useMemo(() => {
    const eligible = athletes.filter((a) => a.events.includes(round.eventId));
    return [...eligible].sort((x, y) => {
      const sx = statOf(x);
      const sy = statOf(y);
      if ((sx === null) !== (sy === null)) return sx === null ? 1 : -1;
      if (sx !== null && sy !== null && sx !== sy) return sx - sy;
      return (x.registeredAt ?? 0) - (y.registeredAt ?? 0) || x.uid.localeCompare(y.uid);
    });
  }, [athletes, round.eventId, statOf]);

  const groupCount = round.groups.length;
  const assignedCount = rows.filter((a) => {
    const i = local[a.uid];
    return typeof i === 'number' && i >= 0 && i < groupCount;
  }).length;
  const manualCount = rows.filter((a) => isManual(a.uid, local, autoAssignments)).length;
  const hasAuto = Object.keys(autoAssignments).length > 0;

  async function post(mode: 'auto' | 'revert') {
    if (!competitionId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-scrambles/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId, eventId: round.eventId, round: round.round, mode }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        assignments?: Record<string, number>;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? 'Хуваарилахад алдаа гарлаа.');
        return;
      }
      setLocal(data.assignments ?? {});
      setConfirming(false);
      await onChanged();
    } catch {
      setError('Хуваарилахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setBusy(false);
    }
  }

  async function move(uid: string, groupIndex: number) {
    if (!competitionId) return;
    const previous = local[uid];
    setLocal((prev) => ({ ...prev, [uid]: groupIndex }));
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-scrambles/assign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId, eventId: round.eventId, round: round.round, uid, groupIndex }),
      });
      if (!res.ok) throw new Error('failed');
      await onChanged();
    } catch {
      // Put the athlete back — the table must never show a group the
      // server didn't accept.
      setLocal((prev) => {
        const next = { ...prev };
        if (typeof previous === 'number') next[uid] = previous;
        else delete next[uid];
        return next;
      });
      setError('Группыг өөрчилж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="oc-sc-scrsec">
      <div className="oc-sc-scrhead">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h3 className="oc-sc-scrtitle">{roundTitle(competition, round.eventId, round.round)}</h3>
          <span className="oc-sc-mono">
            {groupCount} групп · {assignedCount}/{rows.length} тамирчин
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {confirming ? (
            <>
              <span style={{ font: '400 11px var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
                Гараар хийсэн өөрчлөлтүүд устана. Үргэлжлүүлэх үү?
              </span>
              <button type="button" className="oc-sc-btn oc-sc-btn-danger" disabled={busy} onClick={() => post('auto')}>
                ТИЙМ
              </button>
              <button type="button" className="oc-sc-btn" disabled={busy} onClick={() => setConfirming(false)}>
                ҮГҮЙ
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="oc-sc-btn oc-sc-btn-primary"
                disabled={busy}
                // Re-seeding overwrites hand edits, so it takes the same
                // two-step confirm used elsewhere in the admin — but only
                // once there is something to lose.
                onClick={() => (manualCount > 0 ? setConfirming(true) : post('auto'))}
              >
                {busy ? 'ХУВААРИЛЖ БАЙНА...' : 'АВТОМАТААР ХУВААРИЛАХ'}
              </button>
              <button
                type="button"
                className="oc-sc-btn"
                disabled={busy || !hasAuto || manualCount === 0}
                title={
                  !hasAuto
                    ? 'Эхлээд автоматаар хуваарилна уу'
                    : manualCount === 0
                      ? 'Гараар өөрчилсөн зүйл алга'
                      : undefined
                }
                onClick={() => post('revert')}
              >
                ГАРААР ОРУУЛСНЫГ БУЦААХ
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <p className="oc-sc-msg-err">{error}</p>}

        {rows.length === 0 ? (
          <p className="oc-sc-empty">Энэ төрөлд бүртгүүлсэн тамирчин алга.</p>
        ) : (
          <>
            <div className="oc-sc-table">
              <div className="oc-sc-thead" style={{ gridTemplateColumns: COLUMNS, minWidth: MIN_WIDTH }}>
                <span className="oc-sc-th">#</span>
                <span className="oc-sc-th">Тамирчин</span>
                <span className="oc-sc-th" style={{ textAlign: 'right' }}>
                  Сингл
                </span>
                <span className="oc-sc-th" style={{ textAlign: 'right' }}>
                  Дундаж
                </span>
                <span className="oc-sc-th">Групп</span>
                <span className="oc-sc-th">Төлөв</span>
              </div>
              {rows.map((a, i) => {
                const index = local[a.uid];
                const inGroup = typeof index === 'number' && index >= 0 && index < groupCount;
                const manual = isManual(a.uid, local, autoAssignments);
                const pr = a.prByEvent[round.eventId] ?? null;
                const ao5 = a.ao5ByEvent[round.eventId] ?? null;
                return (
                  <div key={a.uid} className="oc-sc-trow" style={{ gridTemplateColumns: COLUMNS, minWidth: MIN_WIDTH }}>
                    <span className="oc-sc-num oc-sc-num-dim">{i + 1}</span>
                    <span className="oc-sc-name" title={a.displayName}>
                      {a.displayName}
                    </span>
                    <span
                      className={`oc-sc-num${metric === 'single' ? '' : ' oc-sc-num-dim'}`}
                      style={{ textAlign: 'right' }}
                    >
                      {pr === null ? '—' : fmtCentiseconds(pr)}
                    </span>
                    <span
                      className={`oc-sc-num${metric === 'average' ? '' : ' oc-sc-num-dim'}`}
                      style={{ textAlign: 'right' }}
                    >
                      {ao5 === null ? '—' : fmtCentiseconds(ao5)}
                    </span>
                    <select
                      className="oc-sc-select"
                      aria-label={`${a.displayName} — групп`}
                      disabled={busy}
                      value={inGroup ? String(index) : ''}
                      onChange={(e) => {
                        if (e.target.value === '') return;
                        move(a.uid, Number(e.target.value));
                      }}
                    >
                      {!inGroup && <option value="">—</option>}
                      {round.groups.map((g, gi) => (
                        <option key={g.label} value={gi}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                    <span>
                      {!inGroup ? (
                        <span className="oc-sc-badge">ХУВААРИЛААГҮЙ</span>
                      ) : manual ? (
                        <span className="oc-sc-badge oc-sc-badge-manual">ГАРААР</span>
                      ) : (
                        <span className="oc-sc-badge">АВТОМАТ</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="oc-sc-foot">
              {rows.length} ТАМИРЧИН · {groupCount} ГРУПП · {manualCount} ГАРААР ӨӨРЧИЛСӨН ·
              АВТОМАТ ХУВААРИЛАЛТ ҮРГЭЛЖ СИНГЛЭЭР ЭРЭМБЭЛНЭ
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/** An athlete counts as hand-placed when their current group differs from
 *  the last auto-assignment's — including being in a group the auto-run
 *  never placed them in at all. Derived rather than stored as a flag, so
 *  it can't drift out of sync with the assignment it describes. */
function isManual(
  uid: string,
  current: Record<string, number>,
  auto: Record<string, number>,
): boolean {
  const now = current[uid];
  if (typeof now !== 'number') return false;
  return auto[uid] !== now;
}
