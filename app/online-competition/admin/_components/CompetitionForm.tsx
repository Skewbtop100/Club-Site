'use client';

import { useState } from 'react';
import { Button, FieldLabel, INPUT_CLASS, MONO_INPUT_CLASS, SELECT_CLASS, SquareToggle } from '../../_components/ui';
import { ROUND_GAP_TEXT, type RoundGapEvent } from './RoundGapWarning';
import type {
  OnlineCompetitionAdminView,
  OnlineCompetitionStatus,
  OnlineCompetitionWriteInput,
} from '@/lib/online-competition/types';

const EVENT_OPTIONS = [
  { eventId: '333', label: '3x3x3' },
  { eventId: '222', label: '2x2x2' },
  { eventId: '444', label: '4x4x4' },
  { eventId: '333oh', label: '3x3x3 нэг гар' },
  { eventId: 'pyram', label: 'Пирамид' },
];

// The third of the three lists that must enumerate every
// OnlineCompetitionStatus (see the type's own comment). Unlike the two
// VALID_STATUSES arrays this one is compiler-checked only for the value
// TYPE, not for completeness — a missing entry just means the admin can
// never select that status, which for 'draft' would mean no way back out
// of, or into, the unpublished state.
const STATUS_OPTIONS: { value: OnlineCompetitionStatus; label: string }[] = [
  { value: 'draft', label: 'Ноорог' },
  { value: 'upcoming', label: 'Удахгүй болох' },
  { value: 'live', label: 'Явагдаж буй' },
  { value: 'finished', label: 'Дууссан' },
];

interface EventRow {
  eventId: string;
  rounds: string;
}

// `mt-2` etc. are Tailwind classes that app/globals.css's unlayered
// `* { margin: 0; padding: 0; }` reset silently zeroes (unlayered always
// beats Tailwind's layered utilities) — used as inline `style` throughout
// this file instead, since inline styles always win regardless of layers.
const MT2: React.CSSProperties = { marginTop: 8 };

function msToDatetimeLocal(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToMs(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

export default function CompetitionForm({
  competition,
  onClose,
  onSaved,
}: {
  competition: OnlineCompetitionAdminView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(competition?.name ?? '');
  const [description, setDescription] = useState(competition?.description ?? '');
  const [startAt, setStartAt] = useState(msToDatetimeLocal(competition?.startAt ?? null));
  const [registrationDeadline, setRegistrationDeadline] = useState(
    msToDatetimeLocal(competition?.registrationDeadline ?? null),
  );
  // A NEW competition starts as a draft — it is not public until an admin
  // moves it on. Editing an existing one keeps whatever it already is.
  const [status, setStatus] = useState<OnlineCompetitionStatus>(competition?.status ?? 'draft');
  const [season, setSeason] = useState(competition?.season ?? '');
  const [unlimited, setUnlimited] = useState(competition ? competition.participantLimit === null : true);
  const [participantLimit, setParticipantLimit] = useState(
    competition?.participantLimit != null ? String(competition.participantLimit) : '',
  );
  const [events, setEvents] = useState<EventRow[]>(
    competition && competition.events.length > 0
      ? competition.events.map((e) => ({ eventId: e.eventId, rounds: String(e.rounds) }))
      : [{ eventId: '333', rounds: '1' }],
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Non-null while the "going live with no round open" confirmation is up;
  // holds the affected events so the dialog can name them.
  const [confirmGaps, setConfirmGaps] = useState<RoundGapEvent[] | null>(null);

  function updateRow(index: number, patch: Partial<EventRow>) {
    setEvents((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setEvents((prev) => [...prev, { eventId: '333', rounds: '1' }]);
  }

  function removeRow(index: number) {
    setEvents((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function validate(): string | null {
    if (!name.trim()) return 'Нэрээ оруулна уу';
    if (!startAt) return 'Эхлэх цагийг сонгоно уу';
    const startMs = datetimeLocalToMs(startAt);
    const deadlineMs = datetimeLocalToMs(registrationDeadline);
    if (deadlineMs !== null && startMs !== null && deadlineMs > startMs) {
      return 'Бүртгэл хаах цаг эхлэх цагаас өмнө байх ёстой';
    }
    if (events.length === 0) return 'Дор хаяж нэг төрөл нэмнэ үү';
    for (const row of events) {
      const rounds = parseInt(row.rounds, 10);
      if (!row.eventId || !Number.isFinite(rounds) || rounds < 1) {
        return 'Раунд тоо 1-ээс их байх ёстой';
      }
    }
    return null;
  }

  /** The events this save would leave unsolvable — configured, but with no
   *  round open. Uses the server's own answer (computed with the solve
   *  gate's findLiveRound) rather than guessing from round counts.
   *
   *  A competition that doesn't exist yet cannot have an open round, so
   *  every one of its events counts; for an existing one, an event ADDED
   *  in this very edit has no round open by construction, so it counts
   *  too even though the server has never seen it. */
  async function eventsGoingLiveWithoutRound(): Promise<RoundGapEvent[]> {
    const formEvents: RoundGapEvent[] = [];
    for (const row of events) {
      const opt = EVENT_OPTIONS.find((o) => o.eventId === row.eventId) ?? EVENT_OPTIONS[0];
      if (!formEvents.some((e) => e.eventId === opt.eventId)) {
        formEvents.push({ eventId: opt.eventId, label: opt.label });
      }
    }
    if (!competition) return formEvents;
    try {
      const res = await fetch(`/api/online-competition/admin-competitions/${competition.id}`);
      if (!res.ok) throw new Error('failed');
      const d = (await res.json()) as { competition: OnlineCompetitionAdminView };
      const gapIds = new Set((d.competition.eventsWithoutLiveRound ?? []).map((e) => e.eventId));
      const storedIds = new Set(d.competition.events.map((e) => e.eventId));
      return formEvents.filter((e) => gapIds.has(e.eventId) || !storedIds.has(e.eventId));
    } catch {
      // A failed lookup must not stand between the admin and their save —
      // this is a warning, not a precondition.
      return [];
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');

    // Only on the transition INTO live — a competition that is already
    // live is covered by the standing warnings on the list, detail and
    // Раунд удирдах screens.
    if (status === 'live' && competition?.status !== 'live' && confirmGaps === null) {
      setSaving(true);
      const gaps = await eventsGoingLiveWithoutRound();
      setSaving(false);
      if (gaps.length > 0) {
        setConfirmGaps(gaps);
        return;
      }
    }
    await doSave();
  }

  async function doSave() {
    setConfirmGaps(null);
    setError('');
    setSaving(true);
    try {
      const payload: OnlineCompetitionWriteInput = {
        name: name.trim(),
        description,
        startAt: datetimeLocalToMs(startAt),
        registrationDeadline: datetimeLocalToMs(registrationDeadline),
        participantLimit: unlimited ? null : Math.max(1, parseInt(participantLimit, 10) || 0),
        events: events.map((row) => {
          const opt = EVENT_OPTIONS.find((o) => o.eventId === row.eventId) ?? EVENT_OPTIONS[0];
          return { eventId: opt.eventId, label: opt.label, rounds: parseInt(row.rounds, 10) };
        }),
        status,
        season: season.trim(),
      };
      const url = competition
        ? `/api/online-competition/admin-competitions/${competition.id}`
        : '/api/online-competition/admin-competitions';
      const res = await fetch(url, {
        method: competition ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('failed');
      onSaved();
    } catch {
      setError('Хадгалахад алдаа гарлаа');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ marginTop: 20, border: '1px solid #1C1C21', background: '#0D0D10', borderRadius: 2 }}
    >
      <div className="flex items-center justify-between" style={{ padding: '15px 18px', borderBottom: '1px solid #1C1C21' }}>
        <h2 className="font-[family-name:var(--oc-font-heading)] text-lg font-semibold text-[#F4F1EA]">
          {competition ? 'Тэмцээн засах' : 'Шинэ тэмцээн нэмэх'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className="oc-adm-mini-btn text-[#6E6A62] transition hover:text-[#E8543C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DFFF4F]"
          style={{ border: 'none', background: 'transparent', font: '500 14px var(--oc-font-mono), monospace', cursor: 'pointer' }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: '20px 18px' }}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[18px]">
          <div>
            <FieldLabel>НЭР</FieldLabel>
            <input className={INPUT_CLASS} style={MT2} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>

          <div className="col-span-full">
            <FieldLabel>ТАЙЛБАР</FieldLabel>
            <textarea
              className={INPUT_CLASS}
              style={MT2}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <FieldLabel>ЭХЛЭХ ЦАГ</FieldLabel>
            <input
              type="datetime-local"
              className={MONO_INPUT_CLASS}
              style={MT2}
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          </div>

          <div>
            <FieldLabel>БҮРТГЭЛ ХААХ</FieldLabel>
            <input
              type="datetime-local"
              className={MONO_INPUT_CLASS}
              style={MT2}
              value={registrationDeadline}
              onChange={(e) => setRegistrationDeadline(e.target.value)}
            />
          </div>

          <div>
            <FieldLabel>СТАТУС</FieldLabel>
            <select
              className={SELECT_CLASS}
              style={MT2}
              value={status}
              onChange={(e) => setStatus(e.target.value as OnlineCompetitionStatus)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel>СЕЗОН</FieldLabel>
            <input
              className={INPUT_CLASS}
              style={MT2}
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="2026-spring"
              maxLength={40}
            />
          </div>

          <div>
            <FieldLabel>ТАМИРЧНЫ ХЯЗГААР</FieldLabel>
            <div className="flex items-center gap-3" style={MT2}>
              <input
                type="number"
                min={1}
                className={`${MONO_INPUT_CLASS} disabled:opacity-40`}
                value={participantLimit}
                onChange={(e) => setParticipantLimit(e.target.value)}
                disabled={unlimited}
              />
              <SquareToggle checked={unlimited} onChange={setUnlimited} label="Хязгааргүй" />
            </div>
          </div>

          <div className="col-span-full">
            <FieldLabel>ТӨРӨЛ · РАУНД</FieldLabel>
            <div className="flex flex-col gap-2" style={MT2}>
              {events.map((row, i) => (
                <div key={i} className="oc-adm-event-row flex items-center gap-2">
                  <select className={SELECT_CLASS} value={row.eventId} onChange={(e) => updateRow(i, { eventId: e.target.value })}>
                    {EVENT_OPTIONS.map((o) => (
                      <option key={o.eventId} value={o.eventId}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    className={MONO_INPUT_CLASS}
                    style={{ width: 74, flexShrink: 0 }}
                    value={row.rounds}
                    onChange={(e) => updateRow(i, { rounds: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    disabled={events.length === 1}
                    aria-label="Устгах"
                    className="oc-adm-event-del shrink-0 border border-[#2A2A31] bg-transparent text-[#E8543C] transition hover:border-[#E8543C] hover:bg-[#1A0D0A] disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DFFF4F]"
                    style={{
                      borderRadius: 2,
                      font: '500 12px var(--oc-font-mono), monospace',
                      paddingLeft: 12,
                      paddingRight: 12,
                      paddingTop: 10,
                      paddingBottom: 10,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              className="oc-adm-add-row w-full text-sm text-[#6E6A62] transition hover:text-[#DFFF4F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DFFF4F]"
              style={{ border: '1px dashed #2A2A31', borderRadius: 2, marginTop: 8, paddingTop: 8, paddingBottom: 8 }}
            >
              + Төрөл нэмэх
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-[#E8543C]" style={{ marginTop: 16 }}>
            {error}
          </p>
        )}

        {/* Warning, not a block: a staged opening (go live now, open
            round 1 when the field is ready) is a legitimate thing to do,
            so the admin can proceed — they just can't do it unknowingly. */}
        {confirmGaps && (
          <div
            className="oc-sc-warn"
            style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <span>
              ▲ {ROUND_GAP_TEXT}
            </span>
            <span style={{ color: '#8A6A28' }}>
              Раунд нээгдээгүй төрөл: {confirmGaps.map((e) => e.label).join(', ')}
            </span>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmGaps(null)}>
                Буцах
              </Button>
              <Button type="button" variant="primary" disabled={saving} onClick={doSave}>
                Харин хадгалах
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2" style={{ marginTop: 20 }}>
          <Button type="button" variant="outline" onClick={onClose}>
            Болих
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            Хадгалах
          </Button>
        </div>
      </div>
    </form>
  );
}
