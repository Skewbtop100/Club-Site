'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import type { ScramblesOverview } from '@/app/api/online-competition/admin-scrambles/route';
import type { ScrambleRosterAthlete } from '@/lib/online-competition/scramble-roster';
import {
  parseTnoodleJson,
  roundKey,
  type ParseResult,
  type ScrambleRoundData,
} from '@/lib/online-competition/scrambles';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';

// ── Холилт ба групп ──────────────────────────────────────────────────────
// Two jobs on one page: import a competition's official WCA/TNoodle
// scramble JSON, then seed its registered athletes into the groups that
// import created. Every write goes through the admin-cookie-gated
// /api/online-competition/admin-scrambles routes — this component never
// touches Firestore directly.
//
// Styling follows the same rule as the rest of the admin section: literal
// inline styles or `.oc-*` classes from theme.css, never a Tailwind class
// assembled at runtime, and never a margin/padding utility that
// globals.css's unlayered `* { margin: 0 }` reset would silently zero.

const GAP16: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };

function eventLabel(competition: OnlineCompetitionAdminView | null, eventId: string): string {
  return competition?.events.find((e) => e.eventId === eventId)?.label ?? eventId.toUpperCase();
}

function roundTitle(competition: OnlineCompetitionAdminView | null, eventId: string, round: number): string {
  return `${eventLabel(competition, eventId)} · Раунд ${round}`;
}

export default function ScramblesManager() {
  const [competitions, setCompetitions] = useState<OnlineCompetitionAdminView[] | null>(null);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [overview, setOverview] = useState<ScramblesOverview | null>(null);
  const [loadError, setLoadError] = useState('');

  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/online-competition/admin-competitions')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { competitions: OnlineCompetitionAdminView[] }) => {
        if (cancelled) return;
        const list = d.competitions ?? [];
        setCompetitions(list);
        // Same preference order the review grid uses: the live competition,
        // else the most recently starting one.
        const live = list.find((c) => c.status === 'live');
        const recent = [...list].sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0))[0];
        setCompetitionId((live ?? recent)?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setCompetitions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const competition = competitions?.find((c) => c.id === competitionId) ?? null;

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoadError('');
    try {
      const res = await fetch(
        `/api/online-competition/admin-scrambles?competitionId=${encodeURIComponent(competitionId)}`,
      );
      if (!res.ok) throw new Error('failed');
      setOverview((await res.json()) as ScramblesOverview);
    } catch {
      setOverview(null);
      setLoadError('Холилтын мэдээллийг ачааллаж чадсангүй');
    }
  }, [competitionId]);

  useEffect(() => {
    setOverview(null);
    resetImport();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  function resetImport() {
    setFileName('');
    setFileText('');
    setParsed(null);
    setSavedMsg('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSavedMsg('');
    setFileName(file.name);
    const text = await file.text();
    setFileText(text);
    // Parsed here purely for the preview; the server re-parses the same
    // text with the same function before writing anything.
    try {
      setParsed(parseTnoodleJson(JSON.parse(text)));
    } catch {
      setParsed({ ok: false, error: 'JSON файлыг уншиж чадсангүй (буруу форматтай).' });
    }
  }

  async function handleSave() {
    if (!competitionId || !fileText) return;
    setSaving(true);
    setSavedMsg('');
    try {
      const res = await fetch('/api/online-competition/admin-scrambles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId, fileText }),
      });
      const data = (await res.json().catch(() => ({}))) as { saved?: number; error?: string };
      if (!res.ok) {
        setParsed({ ok: false, error: data.error ?? 'Хадгалахад алдаа гарлаа.' });
        return;
      }
      await load();
      resetImport();
      setSavedMsg(`${data.saved ?? 0} раундын холилт хадгалагдлаа.`);
    } catch {
      setParsed({ ok: false, error: 'Хадгалахад алдаа гарлаа. Дахин оролдоно уу.' });
    } finally {
      setSaving(false);
    }
  }

  if (competitions === null) return <p className="oc-v3-status">Ачааллаж байна...</p>;
  if (competitions.length === 0) return <p className="oc-v3-status">Тэмцээн алга.</p>;

  return (
    <div style={GAP16}>
      {/* ── Top bar: competition selector ──────────────────────────── */}
      <div className="oc-rv-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <h1 className="oc-v3-title">Холилт ба групп</h1>
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

      {/* ── Import ─────────────────────────────────────────────────── */}
      <section className="oc-sc-card">
        <div className="oc-sc-cardhead">
          <span className="oc-v3-label">Холилт импортлох</span>
          <span className="oc-sc-mono">WCA TNOODLE · JSON</span>
        </div>
        <div className="oc-sc-cardbody" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="oc-sc-hint">
            TNoodle-ээс татсан албан ёсны холилтын JSON файлыг оруулна. Раунд бүрийн scrambleSet тус бүр нэг
            групп болно — групп бүр өөрийн 5 холилттой.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label className="oc-sc-file">
              ФАЙЛ СОНГОХ
              <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleFile} />
            </label>
            {fileName && <span className="oc-sc-mono">{fileName}</span>}
            {fileName && (
              <button type="button" className="oc-sc-btn" onClick={resetImport} disabled={saving}>
                ЦУЦЛАХ
              </button>
            )}
          </div>

          {savedMsg && <p className="oc-sc-msg-ok">{savedMsg}</p>}

          {parsed && !parsed.ok && <p className="oc-sc-msg-err">{parsed.error}</p>}

          {parsed && parsed.ok && (
            <>
              <div style={{ borderTop: '1px solid #1C1C21', paddingTop: 4 }}>
                {parsed.rounds.map((r) => (
                  <div key={roundKey(r.eventId, r.round)} className="oc-sc-prevrow">
                    <span className="oc-sc-prevname">{roundTitle(competition, r.eventId, r.round)}</span>
                    <span className="oc-sc-prevcount">{r.groupCount} ГРУПП</span>
                  </div>
                ))}
              </div>
              {parsed.warnings.length > 0 && (
                <div className="oc-sc-warn">
                  ДАРААХ РАУНДУУД АЛГАСАГДАНА:
                  {parsed.warnings.map((w) => (
                    <span key={`${w.eventId}_${w.round}`} style={{ display: 'block' }}>
                      · {roundTitle(competition, w.eventId, w.round)} — {w.reason}
                    </span>
                  ))}
                </div>
              )}
              <div>
                <button
                  type="button"
                  className="oc-sc-btn oc-sc-btn-primary"
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? 'ХАДГАЛЖ БАЙНА...' : 'ХАДГАЛАХ'}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── Imported rounds + group assignment ─────────────────────── */}
      {loadError && <p className="oc-v3-status-error">{loadError}</p>}

      {overview === null && !loadError ? (
        <p className="oc-v3-status">Ачааллаж байна...</p>
      ) : overview && overview.scrambleData.length === 0 ? (
        <section className="oc-sc-card">
          <div className="oc-sc-cardbody">
            <p className="oc-sc-hint">
              Энэ тэмцээнд холилт импортлогдоогүй байна. Импортлох хүртэл тамирчид санамсаргүй үүсгэсэн холилтоор
              бодно.
            </p>
          </div>
        </section>
      ) : (
        overview?.scrambleData.map((round) => (
          <RoundCard
            key={roundKey(round.eventId, round.round)}
            competitionId={competitionId!}
            competition={competition}
            round={round}
            assignments={overview.assignments[roundKey(round.eventId, round.round)] ?? {}}
            athletes={overview.athletes}
            onChanged={load}
          />
        ))
      )}
    </div>
  );
}

// ── One imported event+round ─────────────────────────────────────────────

function RoundCard({
  competitionId,
  competition,
  round,
  assignments,
  athletes,
  onChanged,
}: {
  competitionId: string;
  competition: OnlineCompetitionAdminView | null;
  round: ScrambleRoundData;
  assignments: Record<string, number>;
  athletes: ScrambleRosterAthlete[];
  onChanged: () => Promise<void>;
}) {
  // Local overlay on top of the server's assignments so a manual move
  // repaints immediately instead of waiting on a refetch.
  const [local, setLocal] = useState<Record<string, number>>(assignments);
  const [busy, setBusy] = useState(false);
  const [confirmingReassign, setConfirmingReassign] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLocal(assignments);
  }, [assignments]);

  const eligible = useMemo(
    () => athletes.filter((a) => a.events.includes(round.eventId)),
    [athletes, round.eventId],
  );

  // An assignment can point past the last group if a later import shrank
  // the round — those athletes drop into the unassigned bucket rather than
  // vanishing, and the card says so.
  const columns = useMemo(() => {
    const cols: ScrambleRosterAthlete[][] = round.groups.map(() => []);
    const unassigned: ScrambleRosterAthlete[] = [];
    let stale = 0;
    for (const a of eligible) {
      const idx = local[a.uid];
      if (typeof idx === 'number' && idx >= 0 && idx < cols.length) {
        cols[idx].push(a);
      } else {
        if (typeof idx === 'number') stale++;
        unassigned.push(a);
      }
    }
    // Fastest first inside each column, matching how the seeder built it.
    const byPr = (x: ScrambleRosterAthlete, y: ScrambleRosterAthlete) => {
      const px = x.prByEvent[round.eventId] ?? null;
      const py = y.prByEvent[round.eventId] ?? null;
      if ((px === null) !== (py === null)) return px === null ? 1 : -1;
      if (px !== null && py !== null && px !== py) return px - py;
      return (x.registeredAt ?? 0) - (y.registeredAt ?? 0);
    };
    cols.forEach((c) => c.sort(byPr));
    return { cols, unassigned, stale };
  }, [eligible, local, round.groups, round.eventId]);

  const assignedCount = eligible.length - columns.unassigned.length;

  async function runAutoAssign() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-scrambles/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId, eventId: round.eventId, round: round.round }),
      });
      const data = (await res.json().catch(() => ({}))) as { assignments?: Record<string, number>; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Хуваарилахад алдаа гарлаа.');
        return;
      }
      setLocal(data.assignments ?? {});
      setConfirmingReassign(false);
      await onChanged();
    } catch {
      setError('Хуваарилахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setBusy(false);
    }
  }

  async function move(uid: string, groupIndex: number) {
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
    } catch {
      // Put the athlete back where they were — the grid must never show a
      // group the server didn't accept.
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

  const hasAssignments = assignedCount > 0;

  return (
    <section className="oc-sc-card">
      <div className="oc-sc-cardhead">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span className="oc-v3-label">{roundTitle(competition, round.eventId, round.round)}</span>
          <span className="oc-sc-mono">
            {round.groupCount} ГРУПП · {assignedCount}/{eligible.length} ТАМИРЧИН
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!hasAssignments ? (
            <button type="button" className="oc-sc-btn oc-sc-btn-primary" disabled={busy} onClick={runAutoAssign}>
              {busy ? 'ХУВААРИЛЖ БАЙНА...' : 'ТАМИРЧДЫГ ХУВААРИЛАХ'}
            </button>
          ) : confirmingReassign ? (
            <>
              <span style={{ font: '400 11px var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
                Гараар хийсэн өөрчлөлтүүд устана. Үргэлжлүүлэх үү?
              </span>
              <button type="button" className="oc-sc-btn oc-sc-btn-danger" disabled={busy} onClick={runAutoAssign}>
                ТИЙМ
              </button>
              <button
                type="button"
                className="oc-sc-btn"
                disabled={busy}
                onClick={() => setConfirmingReassign(false)}
              >
                ҮГҮЙ
              </button>
            </>
          ) : (
            <button
              type="button"
              className="oc-sc-btn"
              disabled={busy}
              onClick={() => setConfirmingReassign(true)}
            >
              ДАХИН АВТОМАТААР ХУВААРИЛАХ
            </button>
          )}
        </div>
      </div>

      <div className="oc-sc-cardbody" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <p className="oc-sc-msg-err">{error}</p>}
        {columns.stale > 0 && (
          <div className="oc-sc-warn">
            {columns.stale} тамирчин байхгүй болсон группэд хуваарилагдсан байна (холилт дахин импортлогдсон
            байж магадгүй) — дахин хуваарилна уу.
          </div>
        )}

        {eligible.length === 0 ? (
          <p className="oc-sc-hint">Энэ төрөлд бүртгүүлсэн тамирчин алга.</p>
        ) : (
          <>
            <div
              className="oc-sc-groups"
              style={{ gridTemplateColumns: `repeat(${round.groups.length}, minmax(200px, 1fr))` }}
            >
              {round.groups.map((group, gi) => (
                <div key={group.label} className="oc-sc-groupcol">
                  <div className="oc-sc-grouphead">
                    <span className="oc-sc-grouplabel">ГРУПП {group.label}</span>
                    <span className="oc-sc-mono">{columns.cols[gi].length}</span>
                  </div>
                  {columns.cols[gi].length === 0 ? (
                    <p className="oc-sc-emptycol">ХООСОН</p>
                  ) : (
                    columns.cols[gi].map((a) => (
                      <AthleteRow
                        key={a.uid}
                        athlete={a}
                        eventId={round.eventId}
                        groups={round.groups.map((g) => g.label)}
                        value={gi}
                        busy={busy}
                        onMove={move}
                      />
                    ))
                  )}
                </div>
              ))}
            </div>

            {columns.unassigned.length > 0 && (
              <div className="oc-sc-groupcol">
                <div className="oc-sc-grouphead">
                  <span className="oc-sc-grouplabel" style={{ color: '#9A958A' }}>
                    ХУВААРИЛАГДААГҮЙ
                  </span>
                  <span className="oc-sc-mono">{columns.unassigned.length}</span>
                </div>
                {columns.unassigned.map((a) => (
                  <AthleteRow
                    key={a.uid}
                    athlete={a}
                    eventId={round.eventId}
                    groups={round.groups.map((g) => g.label)}
                    value={null}
                    busy={busy}
                    onMove={move}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function AthleteRow({
  athlete,
  eventId,
  groups,
  value,
  busy,
  onMove,
}: {
  athlete: ScrambleRosterAthlete;
  eventId: string;
  groups: string[];
  /** null when the athlete isn't in any group yet. */
  value: number | null;
  busy: boolean;
  onMove: (uid: string, groupIndex: number) => void;
}) {
  const pr = athlete.prByEvent[eventId] ?? null;
  return (
    <div className="oc-sc-athlete">
      <span className="oc-sc-athletename" title={athlete.displayName}>
        {athlete.displayName}
      </span>
      <span className="oc-sc-athletepr">{pr === null ? '—' : fmtCentiseconds(pr)}</span>
      <select
        className="oc-sc-select"
        aria-label={`${athlete.displayName} — групп`}
        disabled={busy}
        value={value === null ? '' : String(value)}
        onChange={(e) => {
          if (e.target.value === '') return;
          onMove(athlete.uid, Number(e.target.value));
        }}
      >
        {value === null && <option value="">—</option>}
        {groups.map((label, i) => (
          <option key={label} value={i}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
