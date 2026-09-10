'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import type { ScrambleRosterAthlete } from '@/lib/online-competition/scramble-roster';
import { roundKey, type ScrambleRoundData } from '@/lib/online-competition/scrambles';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { eventLabel } from './shared';

// ── Tab 04 · Групп ───────────────────────────────────────────────────────
// The snake-seeded group assignment, organised by ROUND. A round tab strip
// selects one round at a time and only that round's per-event tables are
// rendered — stacking every round at once made three near-identical blocks
// read as repetition. The strip reuses the review grid's `.oc-rv-tab`
// classes so the two admin pages present rounds the same way.
//
// Inside the selected round there is one table per event holding scrambles
// for it, so a single-round event appears only under Раунд 1 while a
// three-round event has a table in each of the three tabs. Assignment is
// stored per event+round, so each table maps exactly onto one
// groupAssignments doc and keeps its own controls — the auto-assign /
// manual-move / revert logic below is untouched by this layout.
//
// Every round is fully assignable right now. A future round-advancement
// feature is expected to gate later rounds behind "previous round
// finished", but that feature does not exist yet and nothing here
// restricts Раунд 2/3 in the meantime.
//
// The event filter chips that used to sit at the top were REMOVED with
// this reorganisation rather than repurposed as scroll anchors: the round
// sections already list every event, so a chip that hides events would
// contradict the structure, and one event can now appear in several round
// sections, which makes "jump to event X" ambiguous about which round is
// meant. The Сингл/Дундаж control stays — it applies to every table at
// once. (The chips remain in ./shared for the Холилт tab, which still
// shows one event at a time.)

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
  const [metric, setMetric] = useState<Metric>('single');
  const [round, setRound] = useState<number | null>(null);

  // Rounds that exist anywhere in the imported data, ascending — a round
  // with no scrambles for any event simply has no tab.
  const rounds = useMemo(
    () => [...new Set(scrambleData.map((d) => d.round))].sort((a, b) => a - b),
    [scrambleData],
  );

  // Round 1 on load (rounds[0] is the lowest that exists, normally 1), and
  // recover the same way if the selected round disappears — a competition
  // switch, or a re-import that dropped it.
  useEffect(() => {
    setRound((current) => (current !== null && rounds.includes(current) ? current : (rounds[0] ?? null)));
  }, [rounds]);

  if (scrambleData.length === 0) {
    return (
      <p className="oc-sc-empty">
        Холилт импортлогдоогүй байна. Групп үүсгэхийн тулд эхлээд &quot;Файл&quot; хэсгээс JSON файлаа оруулна уу.
      </p>
    );
  }

  return (
    <>
      {/* Round tabs + the ranking control share one toolbar, the same
          arrangement the review grid uses. `.oc-rv-toolbar` wraps rather
          than scrolls, so a narrow screen drops the ranking control to its
          own line instead of overflowing. */}
      <div className="oc-rv-toolbar" role="tablist" aria-label="Раунд">
        {rounds.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={r === round}
            className={`oc-rv-tab${r === round ? ' oc-rv-tab-active' : ''}`}
            onClick={() => setRound(r)}
          >
            РАУНД {r}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="oc-sc-mono">Эрэмбэлэх үзүүлэлт</span>
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

      {/* Only the selected round's tables. Keyed by event+round, so
          switching rounds remounts the tables rather than reusing one
          round's local assignment state under another's data. */}
      {scrambleData
        .filter((d) => d.round === round)
        .map((data) => (
          <EventGroupTable
            key={roundKey(data.eventId, data.round)}
            competitionId={competitionId}
            competition={competition}
            round={data}
            assignments={assignments[roundKey(data.eventId, data.round)] ?? {}}
            autoAssignments={autoAssignments[roundKey(data.eventId, data.round)] ?? {}}
            athletes={athletes}
            metric={metric}
            onChanged={onChanged}
          />
        ))}
    </>
  );
}

/** One event's assignment table for one round — the whole of the previous
 *  flat-table implementation, moved under a round heading. */
function EventGroupTable({
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
    } catch (err) {
      console.error('GroupsTab: assigning groups failed:', err);
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
    } catch (err) {
      console.error('GroupsTab: moving the athlete between groups failed:', err);
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
          <h3 className="oc-sc-scrtitle">{eventLabel(competition, round.eventId)}</h3>
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
