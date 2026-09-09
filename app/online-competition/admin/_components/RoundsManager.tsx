'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import type { RoundAdminView } from '@/app/api/online-competition/admin-rounds/route';
import type { QualifyResponse } from '@/app/api/online-competition/admin-rounds/qualify/route';
import type { QualifierMethod, RoundRanking } from '@/lib/online-competition/rounds';
import { roundKey } from '@/lib/online-competition/scrambles';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import RoundGapWarning, { type RoundGapEvent } from './RoundGapWarning';

// ── Раунд удирдах ────────────────────────────────────────────────────────
// Open / close / advance each event's rounds. Every write goes through the
// admin-cookie-gated /api/online-competition/admin-rounds routes; this
// component never touches Firestore.
//
// Styling follows the rest of the admin section: literal inline styles or
// `.oc-*` classes from theme.css, no runtime-assembled Tailwind, and no
// margin/padding utility that globals.css's unlayered reset would zero.

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
  // Events with no round open at all, straight from the API (computed
  // there with the solve gate's own findLiveRound) — never derived from
  // `rounds` here, which would be a second copy of that rule.
  const [gaps, setGaps] = useState<RoundGapEvent[]>([]);
  const [loadError, setLoadError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  const [qualifyKey, setQualifyKey] = useState<string | null>(null);

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
        eventsWithoutLiveRound?: RoundGapEvent[];
      };
      setRounds(d.rounds ?? []);
      setGaps(d.eventsWithoutLiveRound ?? []);
    } catch {
      setRounds(null);
      setGaps([]);
      setLoadError('Раундын мэдээллийг ачааллаж чадсангүй');
    }
  }, [competitionId]);

  useEffect(() => {
    setRounds(null);
    setGaps([]);
    setQualifyKey(null);
    setRowError(null);
    load();
  }, [load]);

  async function toggle(row: RoundAdminView, action: 'open' | 'close') {
    const key = roundKey(row.eventId, row.round);
    setBusyKey(key);
    setRowError(null);
    try {
      const res = await fetch('/api/online-competition/admin-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId, eventId: row.eventId, round: row.round, action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRowError({ key, message: data.error ?? 'Үйлдэл амжилтгүй боллоо.' });
        return;
      }
      await load();
    } catch {
      setRowError({ key, message: 'Үйлдэл амжилтгүй боллоо. Дахин оролдоно уу.' });
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

                  <span className="oc-rd-time">{fmtTime(row.openedAt)}</span>

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

                {rowError?.key === key && (
                  <p className="oc-sc-msg-err" style={{ padding: '0 14px 12px' }}>
                    {rowError.message}
                  </p>
                )}

                {qualifyKey === key && competitionId && (
                  <div style={{ padding: '0 14px 14px' }}>
                    <QualifyForm
                      competitionId={competitionId}
                      row={row}
                      onDone={async () => {
                        setQualifyKey(null);
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
  onDone: () => Promise<void>;
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
        await onDone();
        return;
      }
      setPreview(data);
    } catch {
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
