'use client';

import { useState } from 'react';
import { Button, FieldLabel, INPUT_CLASS, MONO_INPUT_CLASS, SELECT_CLASS, SquareToggle } from '../../_components/ui';
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

const STATUS_OPTIONS: { value: OnlineCompetitionStatus; label: string }[] = [
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
  const [status, setStatus] = useState<OnlineCompetitionStatus>(competition?.status ?? 'upcoming');
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
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
      style={{ marginTop: 20, border: '1px solid #16140F', background: '#FFFDF8', borderRadius: 2 }}
    >
      <div className="flex items-center justify-between" style={{ padding: '15px 18px', borderBottom: '1px solid #DCD6C8' }}>
        <h2 className="font-[family-name:var(--oc-font-heading)] text-lg font-semibold text-[#16140F]">
          {competition ? 'Тэмцээн засах' : 'Шинэ тэмцээн нэмэх'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className="text-[#8A8474] transition hover:text-[#16140F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16140F]"
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
                <div key={i} className="flex items-center gap-2">
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
                    className="shrink-0 border border-[#DCD6C8] bg-transparent text-[#B22E1D] transition hover:border-[#D8402C] hover:bg-[#FDE8E4] disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16140F]"
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
              className="w-full text-sm text-[#8A8474] transition hover:text-[#16140F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16140F]"
              style={{ border: '1px dashed #DCD6C8', borderRadius: 2, marginTop: 8, paddingTop: 8, paddingBottom: 8 }}
            >
              + Төрөл нэмэх
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-[#D8402C]" style={{ marginTop: 16 }}>
            {error}
          </p>
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
