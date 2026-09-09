'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, FieldLabel, INPUT_CLASS, MONO_INPUT_CLASS, SELECT_CLASS, SquareToggle } from '../../_components/ui';
import { ROUND_GAP_TEXT, type RoundGapEvent } from './RoundGapWarning';
import {
  COMPETITION_FORMAT_OPTIONS,
  DEFAULT_COMPETITION_FORMAT,
  type OnlineCompetitionAdminView,
  type OnlineCompetitionEventConfig,
  type OnlineCompetitionStatus,
  type OnlineCompetitionWriteInput,
} from '@/lib/online-competition/types';

// ── Tabbed competition editor ────────────────────────────────────────────
// Replaces the old inline CompetitionForm, which was one long form rendered
// beneath the list (create) and the detail page (edit). This is its own
// route in both cases — /competitions/new and /competitions/[id]/edit —
// rendering the same component, exactly as the old form served both.
//
// Only Ерөнхий has content in this changeset. The other six render their
// header and a placeholder line; they are deliberately CLICKABLE rather
// than disabled, so the shape of the finished flow is visible.

const ADMIN_COMPETITIONS = '/online-competition/admin/competitions';

interface TabDef {
  /** The mockup's two-digit prefix. Шагнал has none, so it is optional —
   *  the numbering in the mockup skips it and resumes at 07 for Хянах. */
  num?: string;
  label: string;
}

const TABS: TabDef[] = [
  { num: '01', label: 'Ерөнхий' },
  { num: '02', label: 'Зураг' },
  { num: '03', label: 'Төрөл' },
  { num: '04', label: 'Төлбөр' },
  { num: '05', label: 'Хуваарь' },
  { label: 'Шагнал' },
  { num: '07', label: 'Хянах' },
];

const PAID_OPTIONS: { value: boolean; label: string }[] = [
  { value: false, label: 'Төлбөргүй' },
  { value: true, label: 'Төлбөртэй' },
];

const STATUS_OPTIONS: { value: OnlineCompetitionStatus; label: string }[] = [
  { value: 'draft', label: 'Ноорог' },
  { value: 'upcoming', label: 'Удахгүй болох' },
  { value: 'live', label: 'Явагдаж буй' },
  { value: 'finished', label: 'Дууссан' },
];

/** Header line, right-aligned: status, then whether the public site can
 *  see it. Only 'draft' is unannounced — every other status is, by
 *  definition, on the public site (see fetchAllCompetitions' filter).
 *  Record<OnlineCompetitionStatus, …> so a new status cannot render blank. */
const HEADER_STATUS: Record<OnlineCompetitionStatus, string> = {
  draft: 'НООРОГ · ЗАРЛААГҮЙ',
  upcoming: 'УДАХГҮЙ БОЛОХ · ЗАРЛАСАН',
  live: 'ЯВАГДАЖ БУЙ · ЗАРЛАСАН',
  finished: 'ДУУССАН · ЗАРЛАСАН',
};

// `mt-2` etc. are Tailwind classes that app/globals.css's unlayered
// `* { margin: 0; padding: 0; }` reset silently zeroes (unlayered always
// beats Tailwind's layered utilities) — inline `style` is used throughout
// this file instead, since inline styles always win regardless of layers.
// Carried over from CompetitionForm, where the same constraint applied.
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

export default function CompetitionEditor({ competitionId }: { competitionId: string | null }) {
  const router = useRouter();

  // ── loading ────────────────────────────────────────────────────────────
  // A new competition has nothing to fetch, so it starts ready.
  const [loading, setLoading] = useState(competitionId !== null);
  const [loadError, setLoadError] = useState('');

  // ── the record's own identity, once it has one ─────────────────────────
  // Starts null for a create and is filled in by the first successful save,
  // which is what turns subsequent saves into updates instead of creating a
  // second competition.
  const [savedId, setSavedId] = useState<string | null>(competitionId);

  const [tab, setTab] = useState(0);

  // ── Ерөнхий fields ─────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<OnlineCompetitionStatus>('draft');
  const [season, setSeason] = useState('');
  const [registrationOpensAt, setRegistrationOpensAt] = useState('');
  const [registrationDeadline, setRegistrationDeadline] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [format, setFormat] = useState(DEFAULT_COMPETITION_FORMAT);
  const [featured, setFeatured] = useState(false);
  // Held independently of `featured`, and never cleared when it is
  // unticked — the fields hide, their values survive, in the form and in
  // Firestore alike (see the field comments in types.ts).
  const [featuredHeading, setFeaturedHeading] = useState('');
  const [featuredCtaLabel, setFeaturedCtaLabel] = useState('');
  const [featuredUntil, setFeaturedUntil] = useState('');
  const [instructions, setInstructions] = useState('');
  const [paid, setPaid] = useState(false);
  const [unlimited, setUnlimited] = useState(true);
  const [participantLimit, setParticipantLimit] = useState('');

  // Not edited here — the Төрөл tab owns it. Held in state and sent back
  // untouched so saving from this tab cannot wipe a competition's events.
  const [events, setEvents] = useState<OnlineCompetitionEventConfig[]>([]);
  // Same: the status this competition had when loaded, so the round-gap
  // confirm can tell a transition INTO live from an already-live save.
  const [loadedStatus, setLoadedStatus] = useState<OnlineCompetitionStatus | null>(null);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  // Non-null while the "going live with no round open" confirmation is up;
  // holds the affected events so the dialog can name them, and the action
  // to run if the admin proceeds.
  const [confirmGaps, setConfirmGaps] = useState<{ events: RoundGapEvent[]; then: 'stay' | 'next' } | null>(null);

  useEffect(() => {
    if (competitionId === null) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/online-competition/admin-competitions/${competitionId}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json() as Promise<{ competition: OnlineCompetitionAdminView }>;
      })
      .then(({ competition: c }) => {
        if (cancelled) return;
        setName(c.name);
        setDescription(c.description);
        setStatus(c.status);
        setLoadedStatus(c.status);
        setSeason(c.season);
        setRegistrationOpensAt(msToDatetimeLocal(c.registrationOpensAt));
        setRegistrationDeadline(msToDatetimeLocal(c.registrationDeadline));
        setStartAt(msToDatetimeLocal(c.startAt));
        setEndAt(msToDatetimeLocal(c.endAt));
        setFormat(c.format || DEFAULT_COMPETITION_FORMAT);
        setFeatured(c.featured);
        setFeaturedHeading(c.featuredHeading);
        setFeaturedCtaLabel(c.featuredCtaLabel);
        setFeaturedUntil(msToDatetimeLocal(c.featuredUntil));
        setInstructions(c.instructions);
        setPaid(c.paid);
        setUnlimited(c.participantLimit === null);
        setParticipantLimit(c.participantLimit != null ? String(c.participantLimit) : '');
        setEvents(c.events);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError('Тэмцээний мэдээллийг ачааллаж чадсангүй');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId]);

  /** Ерөнхий-tab rules. Every date check is conditional on BOTH values
   *  being set — a draft is expected to be half-filled, and "Нооргоор
   *  хадгалах" has to work on any subset. Only the name is unconditional. */
  function validate(): string | null {
    if (!name.trim()) return 'Нэрээ оруулна уу';

    const opens = datetimeLocalToMs(registrationOpensAt);
    const deadline = datetimeLocalToMs(registrationDeadline);
    const start = datetimeLocalToMs(startAt);
    const end = datetimeLocalToMs(endAt);

    if (opens !== null && deadline !== null && opens >= deadline) {
      return 'Бүртгэл нээгдэх цаг хаагдах цагаас өмнө байх ёстой';
    }
    if (deadline !== null && start !== null && deadline > start) {
      return 'Бүртгэл хаах цаг эхлэх цагаас өмнө байх ёстой';
    }
    if (start !== null && end !== null && start >= end) {
      return 'Тэмцээн эхлэх цаг дуусах цагаас өмнө байх ёстой';
    }
    return null;
  }

  /** The events this save would leave unsolvable — configured, but with no
   *  round open. Uses the server's own answer (computed with the solve
   *  gate's findLiveRound) rather than guessing from round counts.
   *
   *  A competition that doesn't exist yet cannot have an open round, so
   *  every one of its events counts; for an existing one, an event ADDED
   *  since the server last saw it has no round open by construction, so it
   *  counts too.
   *
   *  Carried over from CompetitionForm unchanged apart from reading
   *  `events` (already the stored shape here) instead of form rows. */
  const eventsGoingLiveWithoutRound = useCallback(async (): Promise<RoundGapEvent[]> => {
    const formEvents: RoundGapEvent[] = [];
    for (const e of events) {
      if (!formEvents.some((x) => x.eventId === e.eventId)) {
        formEvents.push({ eventId: e.eventId, label: e.label });
      }
    }
    if (savedId === null) return formEvents;
    try {
      const res = await fetch(`/api/online-competition/admin-competitions/${savedId}`);
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
  }, [events, savedId]);

  async function doSave(then: 'stay' | 'next') {
    setConfirmGaps(null);
    setError('');
    setSavedNote('');
    setSaving(true);
    try {
      const payload: OnlineCompetitionWriteInput = {
        name: name.trim(),
        description,
        startAt: datetimeLocalToMs(startAt),
        registrationDeadline: datetimeLocalToMs(registrationDeadline),
        registrationOpensAt: datetimeLocalToMs(registrationOpensAt),
        endAt: datetimeLocalToMs(endAt),
        participantLimit: unlimited ? null : Math.max(1, parseInt(participantLimit, 10) || 0),
        // Untouched by this tab — see the `events` state comment.
        events,
        status,
        season: season.trim(),
        format,
        featured,
        featuredHeading,
        featuredCtaLabel,
        featuredUntil: datetimeLocalToMs(featuredUntil),
        instructions,
        paid,
      };
      const url = savedId
        ? `/api/online-competition/admin-competitions/${savedId}`
        : '/api/online-competition/admin-competitions';
      const res = await fetch(url, {
        method: savedId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('failed');

      if (savedId === null) {
        // First save of a new competition. Adopt the id and swap the URL to
        // the edit route, so a second "Нооргоор хадгалах" updates this
        // competition instead of creating another one — and so a reload
        // (or the browser back button) lands on a real record.
        const { id } = (await res.json()) as { id: string };
        setSavedId(id);
        router.replace(`${ADMIN_COMPETITIONS}/${id}/edit`);
      }
      setLoadedStatus(status);
      setSavedNote('Хадгалагдлаа');
      if (then === 'next') setTab((t) => Math.min(t + 1, TABS.length - 1));
    } catch {
      setError('Хадгалахад алдаа гарлаа');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(then: 'stay' | 'next') {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');

    // Only on the transition INTO live — a competition that is already live
    // is covered by the standing warnings on the list, detail and Раунд
    // удирдах screens. Applies to BOTH save buttons: either one can be the
    // save that flips a competition live.
    if (status === 'live' && loadedStatus !== 'live') {
      setSaving(true);
      const gaps = await eventsGoingLiveWithoutRound();
      setSaving(false);
      if (gaps.length > 0) {
        setConfirmGaps({ events: gaps, then });
        return;
      }
    }
    await doSave(then);
  }

  if (loading) return <p className="oc-v3-status">Ачааллаж байна...</p>;
  if (loadError) return <p className="text-sm text-[#E8543C]">{loadError}</p>;

  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <Link href={ADMIN_COMPETITIONS} className="oc-v3-back-link">
          ← Тэмцээнүүд
        </Link>
      </div>

      <div className="oc-cf-header">
        <span className="oc-cf-name">{name.trim() || 'Шинэ тэмцээн'}</span>
        <span className="oc-cf-status">{HEADER_STATUS[status]}</span>
      </div>

      <div className="oc-cf-tabs" role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={i === tab}
            className={`oc-cf-tab${i === tab ? ' oc-cf-tab-active' : ''}`}
            onClick={() => setTab(i)}
          >
            {t.num && (
              <span className="oc-cf-tab-num" aria-hidden>
                {t.num}
              </span>
            )}
            <span className="oc-cf-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ paddingTop: 24 }}>
        {tab === 0 ? (
          <GeneralTab
            {...{
              name,
              setName,
              status,
              setStatus,
              registrationOpensAt,
              setRegistrationOpensAt,
              registrationDeadline,
              setRegistrationDeadline,
              startAt,
              setStartAt,
              endAt,
              setEndAt,
              participantLimit,
              setParticipantLimit,
              unlimited,
              setUnlimited,
              format,
              setFormat,
              featured,
              setFeatured,
              featuredHeading,
              setFeaturedHeading,
              featuredCtaLabel,
              setFeaturedCtaLabel,
              featuredUntil,
              setFeaturedUntil,
              instructions,
              setInstructions,
              paid,
              setPaid,
              season,
              setSeason,
              description,
              setDescription,
            }}
          />
        ) : (
          <div>
            <span className="oc-v3-label">{TABS[tab].label}</span>
            <p className="oc-cf-soon" style={{ marginTop: 10 }}>
              Энэ хэсэг удахгүй нэмэгдэнэ.
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-[#E8543C]" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}

      {/* Warning, not a block: a staged opening (go live now, open round 1
          when the field is ready) is a legitimate thing to do, so the admin
          can proceed — they just can't do it unknowingly. */}
      {confirmGaps && (
        <div className="oc-sc-warn" style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span>▲ {ROUND_GAP_TEXT}</span>
          <span style={{ color: '#8A6A28' }}>
            Раунд нээгдээгүй төрөл: {confirmGaps.events.map((e) => e.label).join(', ')}
          </span>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmGaps(null)}>
              Буцах
            </Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => doSave(confirmGaps.then)}>
              Харин хадгалах
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2" style={{ marginTop: 24 }}>
        {savedNote && (
          <span className="text-xs" style={{ color: 'var(--color-ink-soft)', marginRight: 'auto' }}>
            {savedNote}
          </span>
        )}
        {/* No publish button here by design — publishing belongs on the
            Хянах tab behind its readiness checklist. Saving from this tab
            never changes a draft's status on its own. */}
        <Button type="button" variant="outline" disabled={saving} onClick={() => handleSave('stay')}>
          {saving ? 'Хадгалж байна...' : 'Нооргоор хадгалах'}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={saving || tab === TABS.length - 1}
          onClick={() => handleSave('next')}
        >
          Дараах
        </Button>
      </div>
    </div>
  );
}

// ── 01 Ерөнхий ───────────────────────────────────────────────────────────

interface GeneralTabProps {
  name: string;
  setName: (v: string) => void;
  status: OnlineCompetitionStatus;
  setStatus: (v: OnlineCompetitionStatus) => void;
  registrationOpensAt: string;
  setRegistrationOpensAt: (v: string) => void;
  registrationDeadline: string;
  setRegistrationDeadline: (v: string) => void;
  startAt: string;
  setStartAt: (v: string) => void;
  endAt: string;
  setEndAt: (v: string) => void;
  participantLimit: string;
  setParticipantLimit: (v: string) => void;
  unlimited: boolean;
  setUnlimited: (v: boolean) => void;
  format: string;
  setFormat: (v: string) => void;
  featured: boolean;
  setFeatured: (v: boolean) => void;
  featuredHeading: string;
  setFeaturedHeading: (v: string) => void;
  featuredCtaLabel: string;
  setFeaturedCtaLabel: (v: string) => void;
  featuredUntil: string;
  setFeaturedUntil: (v: string) => void;
  instructions: string;
  setInstructions: (v: string) => void;
  paid: boolean;
  setPaid: (v: boolean) => void;
  season: string;
  setSeason: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
}

function GeneralTab(p: GeneralTabProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[18px]">
      <div>
        <FieldLabel>НЭР</FieldLabel>
        <input className={INPUT_CLASS} style={MT2} value={p.name} onChange={(e) => p.setName(e.target.value)} maxLength={80} />
      </div>

      <div>
        <FieldLabel>СТАТУС</FieldLabel>
        <select
          className={SELECT_CLASS}
          style={MT2}
          value={p.status}
          onChange={(e) => p.setStatus(e.target.value as OnlineCompetitionStatus)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <FieldLabel>БҮРТГЭЛ НЭЭГДЭХ</FieldLabel>
        <input
          type="datetime-local"
          className={MONO_INPUT_CLASS}
          style={MT2}
          value={p.registrationOpensAt}
          onChange={(e) => p.setRegistrationOpensAt(e.target.value)}
        />
      </div>

      <div>
        <FieldLabel>БҮРТГЭЛ ХААГДАХ</FieldLabel>
        <input
          type="datetime-local"
          className={MONO_INPUT_CLASS}
          style={MT2}
          value={p.registrationDeadline}
          onChange={(e) => p.setRegistrationDeadline(e.target.value)}
        />
      </div>

      <div>
        <FieldLabel>ТЭМЦЭЭН ЭХЛЭХ</FieldLabel>
        <input
          type="datetime-local"
          className={MONO_INPUT_CLASS}
          style={MT2}
          value={p.startAt}
          onChange={(e) => p.setStartAt(e.target.value)}
        />
      </div>

      <div>
        <FieldLabel>ТЭМЦЭЭН ДУУСАХ</FieldLabel>
        <input
          type="datetime-local"
          className={MONO_INPUT_CLASS}
          style={MT2}
          value={p.endAt}
          onChange={(e) => p.setEndAt(e.target.value)}
        />
      </div>

      <div>
        <FieldLabel>ТАМИРЧНЫ ХЯЗГААР</FieldLabel>
        <div className="flex items-center gap-3" style={MT2}>
          <input
            type="number"
            min={1}
            className={`${MONO_INPUT_CLASS} disabled:opacity-40`}
            value={p.participantLimit}
            onChange={(e) => p.setParticipantLimit(e.target.value)}
            disabled={p.unlimited}
          />
          <SquareToggle checked={p.unlimited} onChange={p.setUnlimited} label="Хязгааргүй" />
        </div>
      </div>

      <div>
        <FieldLabel>ХЭЛБЭР</FieldLabel>
        <select className={SELECT_CLASS} style={MT2} value={p.format} onChange={(e) => p.setFormat(e.target.value)}>
          {COMPETITION_FORMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        {/* СЕЗОН is not in the mockup but is load-bearing: the season-points
            recompute refuses to run without it ("Энэ тэмцээнд сезон
            тохируулаагүй байна" on the list). It stays on this tab. */}
        <FieldLabel>СЕЗОН</FieldLabel>
        <input
          className={INPUT_CLASS}
          style={MT2}
          value={p.season}
          onChange={(e) => p.setSeason(e.target.value)}
          placeholder="2026-spring"
          maxLength={40}
        />
      </div>

      <div>
        {/* The toggle ONLY. Amount, bank account, payment deadline and
            per-event surcharges are the Төлбөр tab's, and have no fields
            yet. Same .oc-v3-seg control as ХҮЙС on the athlete profile,
            with the two-column modifier. */}
        <FieldLabel>БҮРТГЭЛИЙН ХУРААМЖ</FieldLabel>
        <div className="oc-v3-seg oc-v3-seg-2" style={MT2} role="radiogroup" aria-label="Бүртгэлийн хураамж">
          {PAID_OPTIONS.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={p.paid === o.value}
              className={`oc-v3-seg-btn${p.paid === o.value ? ' oc-v3-seg-btn-active' : ''}`}
              onClick={() => p.setPaid(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-full">
        <div className="oc-cf-featured-row">
          <SquareToggle
            checked={p.featured}
            onChange={p.setFeatured}
            label="Вэбний эхэнд өргөн баннераар байрлуулах"
          />
          <span className="oc-cf-hint">Баннер зурагтайгаа нүүр хуудсын хамгийн дээр харагдана.</span>
        </div>

        {/* Revealed by the checkbox, and UNMOUNTED when it is off rather
            than hidden with CSS — but the state lives in the parent, so
            unticking and re-ticking restores every value. Nothing is
            cleared on unticking, here or on save. */}
        {p.featured && (
          <div className="oc-cf-subfields">
            <div>
              <FieldLabel>ОНЦЛОХ ГАРЧИГ</FieldLabel>
              <input
                className={INPUT_CLASS}
                style={MT2}
                value={p.featuredHeading}
                onChange={(e) => p.setFeaturedHeading(e.target.value)}
                placeholder="СЕЗОН 3 · БҮРТГЭЛ НЭЭЛТТЭЙ"
                maxLength={80}
              />
            </div>
            <div>
              <FieldLabel>CTA БИЧВЭР</FieldLabel>
              <input
                className={INPUT_CLASS}
                style={MT2}
                value={p.featuredCtaLabel}
                onChange={(e) => p.setFeaturedCtaLabel(e.target.value)}
                placeholder="Бүртгүүлэх"
                maxLength={40}
              />
            </div>
            <div>
              <FieldLabel>ХАРАГДАХ ХУГАЦАА</FieldLabel>
              <input
                type="datetime-local"
                className={MONO_INPUT_CLASS}
                style={MT2}
                value={p.featuredUntil}
                onChange={(e) => p.setFeaturedUntil(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="col-span-full">
        <FieldLabel>ТАЙЛБАР</FieldLabel>
        <textarea
          className={INPUT_CLASS}
          style={MT2}
          rows={3}
          value={p.description}
          onChange={(e) => p.setDescription(e.target.value)}
        />
      </div>

      {/* Deliberately NOT inside the featured block: instructions are
          public competition copy, shown on the detail page whether or not
          the competition is featured. Last on the tab, after Тайлбар. */}
      <div className="col-span-full">
        <FieldLabel>ЗААВАР · НИЙТЭД ХАРАГДАХ</FieldLabel>
        <textarea
          className={INPUT_CLASS}
          style={MT2}
          rows={5}
          value={p.instructions}
          onChange={(e) => p.setInstructions(e.target.value)}
        />
        <p className="oc-cf-hint" style={{ marginTop: 8 }}>
          Тэмцээний хуудсын ерөнхий хэсэгт «Заавар» гэж харагдана.
        </p>
      </div>
    </div>
  );
}
