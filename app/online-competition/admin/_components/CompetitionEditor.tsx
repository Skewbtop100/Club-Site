'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, FieldLabel, INPUT_CLASS, MONO_INPUT_CLASS, SELECT_CLASS, SquareToggle } from '../../_components/ui';
import { ROUND_GAP_TEXT, type RoundGapEvent } from './RoundGapWarning';
import { uploadImageToCloudinary } from '@/lib/online-competition/cloudinary';
import { ONLINE_COMP_EVENTS, onlineCompEventLabel } from '@/lib/online-competition/events';
import { RESULT_FORMATS, formatLabel, resolveResultFormat, type ResultFormat } from '@/lib/online-competition/ao5';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import {
  COMPETITION_FORMAT_OPTIONS,
  DEFAULT_COMPETITION_FORMAT,
  type OnlineCompetitionAdminView,
  type OnlineCompetitionAdvancement,
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
  // Зураг tab. Uploaded to Cloudinary the moment a file is chosen (see
  // ImageSlot), so these hold a real remote URL, not a local preview —
  // they then persist with every other field on the next save.
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [posterPublicId, setPosterPublicId] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerPublicId, setBannerPublicId] = useState<string | null>(null);
  const [unlimited, setUnlimited] = useState(true);
  const [participantLimit, setParticipantLimit] = useState('');

  // Owned by the Төрөл tab. Kept as EventRow (rounds as a string,
  // advancement keyed by fromRound) rather than the stored shape — see
  // EventRow's comment for why.
  const [events, setEvents] = useState<EventRow[]>([]);
  // Same: the status this competition had when loaded, so the round-gap
  // confirm can tell a transition INTO live from an already-live save.
  const [loadedStatus, setLoadedStatus] = useState<OnlineCompetitionStatus | null>(null);
  // Server-computed; empty for a competition that does not exist yet.
  const [lockedEventIds, setLockedEventIds] = useState<string[]>([]);

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
        setPosterUrl(c.posterUrl);
        setPosterPublicId(c.posterPublicId);
        setBannerUrl(c.bannerUrl);
        setBannerPublicId(c.bannerPublicId);
        setUnlimited(c.participantLimit === null);
        setParticipantLimit(c.participantLimit != null ? String(c.participantLimit) : '');
        setEvents(c.events.map(toEventRow));
        setLockedEventIds(c.lockedEventIds ?? []);
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
        formEvents.push({ eventId: e.eventId, label: onlineCompEventLabel(e.eventId) });
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

  // url and publicId always move together — a stale publicId beside a new
  // url would point cleanup at the wrong asset.
  const setPoster = useCallback((url: string | null, publicId: string | null) => {
    setPosterUrl(url);
    setPosterPublicId(publicId);
  }, []);
  const setBanner = useCallback((url: string | null, publicId: string | null) => {
    setBannerUrl(url);
    setBannerPublicId(publicId);
  }, []);

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
        events: events.map(toEventConfig),
        status,
        season: season.trim(),
        format,
        featured,
        featuredHeading,
        featuredCtaLabel,
        featuredUntil: datetimeLocalToMs(featuredUntil),
        instructions,
        paid,
        posterUrl,
        posterPublicId,
        bannerUrl,
        bannerPublicId,
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
        ) : tab === 2 ? (
          <EventsTab events={events} setEvents={setEvents} lockedEventIds={lockedEventIds} />
        ) : tab === 1 ? (
          <ImagesTab
            {...{
              posterUrl,
              posterPublicId,
              setPoster,
              bannerUrl,
              bannerPublicId,
              setBanner,
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

// ── 03 Төрөл ─────────────────────────────────────────────────────────────

/** One event while it is being edited.
 *
 *  `rounds` is a STRING because a number input is legitimately empty or
 *  half-typed mid-edit; it becomes a number only at save.
 *
 *  `advancement` is keyed by fromRound rather than being an array, and is
 *  DELIBERATELY NOT PRUNED when the round count drops. Take a 3-round
 *  event with "Раунд 2 → Финал" set to 12, then change it to 2 rounds:
 *  that transition no longer exists and its row disappears, but the entry
 *  stays in this map. Change back to 3 and the 12 is still there. Only
 *  in-range entries are sent (toEventConfig filters), so an orphan never
 *  reaches Firestore and never survives a reload — it is a within-session
 *  undo, the same treatment the featured banner fields get on Ерөнхий. */
interface EventRow {
  eventId: string;
  rounds: string;
  resultFormat: ResultFormat;
  advancement: Record<number, { method: 'count' | 'percent'; value: string }>;
}

function toEventRow(e: OnlineCompetitionEventConfig): EventRow {
  const advancement: EventRow['advancement'] = {};
  for (const a of e.advancement ?? []) {
    advancement[a.fromRound] = { method: a.method, value: String(a.value) };
  }
  return {
    eventId: e.eventId,
    rounds: String(e.rounds),
    resultFormat: resolveResultFormat(e.resultFormat),
    advancement,
  };
}

function toEventConfig(row: EventRow): OnlineCompetitionEventConfig {
  const rounds = roundsOf(row);
  const advancement: OnlineCompetitionAdvancement[] = [];
  // In-range and actually filled in. A blank value is "not planned yet",
  // not an error — a draft is allowed to be half-specified.
  for (const fromRound of transitionsFor(rounds)) {
    const entry = row.advancement[fromRound];
    if (!entry || entry.value.trim() === '') continue;
    const value = Number(entry.value);
    if (!Number.isFinite(value)) continue;
    advancement.push({ fromRound, method: entry.method, value });
  }
  return {
    eventId: row.eventId,
    // Re-resolved from the shared list at save time so a relabelled event
    // updates, but falls back to the id for an event no longer offered.
    label: onlineCompEventLabel(row.eventId),
    rounds,
    resultFormat: row.resultFormat,
    advancement,
  };
}

/** Parsed round count, floored at 1 — an empty or junk input must not
 *  produce NaN rounds or a negative transition list. */
function roundsOf(row: EventRow): number {
  const n = parseInt(row.rounds, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** The fromRound of every transition this event has: 1..rounds-1. A
 *  single-round event has none. */
function transitionsFor(rounds: number): number[] {
  return Array.from({ length: Math.max(0, rounds - 1) }, (_, i) => i + 1);
}

/** "Раунд 1 → Раунд 2" / "Раунд 2 → Финал" — the last transition's target
 *  is the final. */
function transitionLabel(fromRound: number, rounds: number): string {
  const to = fromRound + 1;
  return `Раунд ${fromRound} → ${to >= rounds ? 'Финал' : `Раунд ${to}`}`;
}

const FORMAT_LOCKED_REASON = 'Үзүүлэлт орсон тул формат солих боломжгүй.';

// Step D added ranking and qualification, so a non-Ao5 round can now be
// judged, ranked and advanced. What remains is the cross-competition
// scoring: seasonPoints.ts and athleteStats.ts still require exactly five
// judged attempts, so a non-Ao5 event contributes no season points and
// produces no athlete stats (PR, best average) at all. That is step E.
const FORMAT_UNSUPPORTED_WARNING =
  'Ao5-аас өөр формат: тэмцээн явуулж, шүүж, эрэмбэлж, шалгаруулах боломжтой. ' +
  'Гэвч улирлын оноо болон тамирчны статистик хараахан тооцогдохгүй.';

function EventsTab({
  events,
  setEvents,
  lockedEventIds,
}: {
  events: EventRow[];
  setEvents: React.Dispatch<React.SetStateAction<EventRow[]>>;
  /** Events whose format the server will refuse to change, because a
   *  judged submission already exists for them. Comes down with the
   *  competition itself (OnlineCompetitionAdminView.lockedEventIds), so
   *  disabling the control costs no extra round trip. */
  lockedEventIds: string[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerWrapRef = useRef<HTMLDivElement | null>(null);

  const used = new Set(events.map((e) => e.eventId));
  const allAdded = ONLINE_COMP_EVENTS.every((o) => used.has(o.id));
  const unsupported = events.filter((e) => e.resultFormat !== 'ao5');

  // Close on an outside click or Escape. Both listeners are only attached
  // while the picker is open, so a closed picker costs nothing.
  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!pickerWrapRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  function update(index: number, patch: Partial<EventRow>) {
    setEvents((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function setAdvancement(
    index: number,
    fromRound: number,
    patch: Partial<{ method: 'count' | 'percent'; value: string }>,
  ) {
    setEvents((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const current = row.advancement[fromRound] ?? { method: 'count' as const, value: '' };
        return { ...row, advancement: { ...row.advancement, [fromRound]: { ...current, ...patch } } };
      }),
    );
  }

  function addEvent(eventId: string) {
    setEvents((prev) => [...prev, { eventId, rounds: '1', resultFormat: 'ao5', advancement: {} }]);
    setPickerOpen(false);
  }

  return (
    <div>
      {unsupported.length > 0 && (
        <div className="oc-sc-warn" style={{ marginBottom: 14, display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <span aria-hidden>▲</span>
          <span>{FORMAT_UNSUPPORTED_WARNING}</span>
          <span style={{ color: '#8A6A28' }}>
            ·{' '}
            {unsupported
              .map((e) => `${onlineCompEventLabel(e.eventId)}: ${formatLabel(e.resultFormat)}`)
              .join(', ')}
          </span>
        </div>
      )}

      {events.length === 0 && (
        <p className="oc-cf-soon" style={{ marginBottom: 12 }}>
          Төрөл нэмээгүй байна. Тэмцээнийг нийтлэхийн тулд дор хаяж нэг төрөл нэмнэ үү.
        </p>
      )}

      {events.map((row, i) => {
        const rounds = roundsOf(row);
        const transitions = transitionsFor(rounds);
        const known = ONLINE_COMP_EVENTS.some((o) => o.id === row.eventId);
        const locked = lockedEventIds.includes(row.eventId);
        return (
          <div key={i} className="oc-cf-ev">
            <div className="oc-cf-ev-grid">
              <div className="oc-cf-ev-cell">
                <FieldLabel>ТӨРӨЛ</FieldLabel>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span className="oc-cf-ev-icon" aria-hidden>
                    {hasWcaEventIcon(row.eventId) ? (
                      <WcaEventIcon eventId={row.eventId} size={16} />
                    ) : (
                      row.eventId.slice(0, 4).toUpperCase()
                    )}
                  </span>
                  <select
                    className={SELECT_CLASS}
                    style={{ minWidth: 0 }}
                    value={row.eventId}
                    onChange={(e) => update(i, { eventId: e.target.value })}
                    aria-label="Төрөл"
                  >
                    {/* An event chosen on another row is disabled, not
                        hidden: hiding it would make the list jump around
                        as rows are edited. */}
                    {ONLINE_COMP_EVENTS.map((o) => (
                      <option key={o.id} value={o.id} disabled={o.id !== row.eventId && used.has(o.id)}>
                        {o.label}
                      </option>
                    ))}
                    {/* A competition may hold an event this build no
                        longer offers (the list shrank, or the doc predates
                        it). Without this option the select would silently
                        snap to another event and the next save would
                        rewrite it. */}
                    {!known && (
                      <option value={row.eventId}>{onlineCompEventLabel(row.eventId)} (дэмжигдэхгүй)</option>
                    )}
                  </select>
                </span>
              </div>

              <div className="oc-cf-ev-cell">
                <FieldLabel>РАУНД</FieldLabel>
                <input
                  type="number"
                  min={1}
                  className={`${MONO_INPUT_CLASS} oc-cf-steppers`}
                  value={row.rounds}
                  onChange={(e) => update(i, { rounds: e.target.value })}
                  aria-label="Раундын тоо"
                />
              </div>

              <div className="oc-cf-ev-cell">
                {/* A real control now. It is NOT yet honoured by the solve
                    flow or any scorer — the attempt count is still
                    hardcoded to 5 in eight places; see attemptsForFormat's
                    warning in ao5.ts for the list. That is why selecting
                    anything but Ao5 raises the amber notice below. */}
                <FieldLabel>ФОРМАТ</FieldLabel>
                <select
                  className={SELECT_CLASS}
                  value={row.resultFormat}
                  disabled={locked}
                  title={locked ? FORMAT_LOCKED_REASON : undefined}
                  onChange={(e) => update(i, { resultFormat: e.target.value as ResultFormat })}
                  aria-label="Формат"
                  style={locked ? { opacity: 0.5 } : undefined}
                >
                  {RESULT_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {formatLabel(f)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="oc-cf-ev-cell">
                {/* TODO: ЛИМИТ is laid out but deliberately inert — there
                    is NO schema field and nothing to store yet. A time
                    limit only means something once it is ENFORCED, which
                    needs the solve flow to compare against it and the
                    review route to apply the DNF; neither exists. Storing
                    a number that changes nothing would be worse than an
                    empty column. When it lands: centiseconds (matching
                    reportedTime), not a "10:00" display string. */}
                <FieldLabel>ЛИМИТ</FieldLabel>
                <input
                  className={MONO_INPUT_CLASS}
                  value=""
                  readOnly
                  disabled
                  placeholder="—"
                  title="Хугацааны хязгаар удахгүй"
                  aria-label="Хугацааны хязгаар (удахгүй)"
                  style={{ opacity: 0.4 }}
                />
              </div>

              <div className="oc-cf-ev-cell">
                <button
                  type="button"
                  onClick={() => setEvents((prev) => prev.filter((_, x) => x !== i))}
                  aria-label="Төрөл устгах"
                  className="oc-adm-event-del shrink-0 border border-[#2A2A31] bg-transparent text-[#E8543C] transition hover:border-[#E8543C] hover:bg-[#1A0D0A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DFFF4F]"
                  style={{
                    borderRadius: 2,
                    font: '500 12px var(--oc-font-mono), monospace',
                    padding: '12px 13px',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {locked && (
              <p className="oc-cf-locked" style={{ marginTop: 8 }}>
                {FORMAT_LOCKED_REASON}
              </p>
            )}

            {/* One row per transition, derived from the round count. A
                single-round event has none. */}
            {transitions.length > 0 && (
              <div className="oc-cf-adv">
                <FieldLabel>ДАРААХ РАУНДАД ОРОХ ТООНЫ ХЯЗГААР</FieldLabel>
                {transitions.map((fromRound) => {
                  const entry = row.advancement[fromRound] ?? { method: 'count' as const, value: '' };
                  return (
                    <div key={fromRound} className="oc-cf-adv-row">
                      <span className="oc-cf-adv-label">{transitionLabel(fromRound, rounds)}</span>

                      <span className="oc-cf-seg" role="radiogroup" aria-label="Шалгаруулах арга">
                        {(['count', 'percent'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={entry.method === m}
                            className={`oc-cf-seg-btn${entry.method === m ? ' oc-cf-seg-btn-active' : ''}`}
                            onClick={() => setAdvancement(i, fromRound, { method: m })}
                          >
                            {m === 'count' ? '#' : '%'}
                          </button>
                        ))}
                      </span>

                      <input
                        type="number"
                        min={1}
                        max={entry.method === 'percent' ? 100 : undefined}
                        className={MONO_INPUT_CLASS}
                        style={{ width: 84, flexShrink: 0 }}
                        value={entry.value}
                        onChange={(e) => setAdvancement(i, fromRound, { value: e.target.value })}
                        aria-label={transitionLabel(fromRound, rounds)}
                      />

                      <span className="oc-cf-adv-suffix">
                        {entry.method === 'count' ? 'тамирчин' : '% бүртгэлээс'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* The button OPENS A PICKER. It used to add whichever event
          happened to be unused, which meant the admin's first action on
          every new event was to correct it. */}
      <div className="oc-cf-picker-wrap" ref={pickerWrapRef}>
        <button
          type="button"
          disabled={allAdded}
          aria-expanded={pickerOpen}
          aria-haspopup="listbox"
          onClick={() => setPickerOpen((v) => !v)}
          className="oc-adm-add-row w-full text-sm text-[#6E6A62] transition hover:text-[#DFFF4F] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DFFF4F]"
          style={{ border: '1px dashed #2A2A31', borderRadius: 2, paddingTop: 8, paddingBottom: 8 }}
        >
          {allAdded ? 'Бүх төрөл нэмэгдсэн' : '+ Төрөл нэмэх'}
        </button>

        {pickerOpen && !allAdded && (
          <div className="oc-cf-picker" role="listbox" aria-label="Төрөл сонгох">
            {/* Added events stay in the list, disabled and marked, rather
                than being filtered out — so the list is the same length
                every time it opens and an event's position never moves. */}
            {ONLINE_COMP_EVENTS.map((o) => {
              const added = used.has(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={added}
                  disabled={added}
                  className="oc-cf-picker-row"
                  onClick={() => addEvent(o.id)}
                >
                  <span className="oc-cf-ev-icon" aria-hidden>
                    {hasWcaEventIcon(o.id) ? (
                      <WcaEventIcon eventId={o.id} size={16} />
                    ) : (
                      o.id.slice(0, 4).toUpperCase()
                    )}
                  </span>
                  <span>{o.label}</span>
                  {added && <span className="oc-cf-picker-added">НЭМСЭН</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 02 Зураг ─────────────────────────────────────────────────────────────

// Enforced before a byte is uploaded. The athlete profile photo picker does
// NOT do this — it accepts image/* and validates nothing — so these two
// rules are new here rather than copied. They are cheap and the failure
// they prevent (a 30MB HEIC that uploads for a minute and then renders
// nowhere) is worth a divergence.
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png'];
const IMAGE_ACCEPT = 'image/jpeg,image/png';

function imageFileError(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Зөвхөн JPG эсвэл PNG файл оруулна уу';
  if (file.size > IMAGE_MAX_BYTES) return 'Зургийн хэмжээ 4MB-аас бага байх ёстой';
  return null;
}

interface ImagesTabProps {
  posterUrl: string | null;
  posterPublicId: string | null;
  setPoster: (url: string | null, publicId: string | null) => void;
  bannerUrl: string | null;
  bannerPublicId: string | null;
  setBanner: (url: string | null, publicId: string | null) => void;
}

function ImagesTab(p: ImagesTabProps) {
  return (
    <div>
      <div className="oc-cf-images">
        <ImageSlot
          kind="poster"
          url={p.posterUrl}
          caption="ПОСТЕР · 1:1 · 1200×1200"
          emptyLabel="ЗУРАГГҮЙ"
          onChange={p.setPoster}
        />
        <ImageSlot
          kind="banner"
          url={p.bannerUrl}
          caption="БАННЕР · 16:5 · 1920×600 · НҮҮР ХУУДСАНД ХАРАГДАНА"
          emptyLabel="БАННЕР ЗУРАГГҮЙ"
          onChange={p.setBanner}
        />
      </div>

      <div style={{ marginTop: 28 }}>
        <FieldLabel>ЗУРГИЙН ШААРДЛАГА</FieldLabel>
        <p className="oc-cf-soon" style={{ marginTop: 10, maxWidth: 640, textWrap: 'pretty' }}>
          Постер нүүр хуудсын тэмцээний ерөнхий мэдээлэл хэсэгт, баннер нүүр хуудсын дээд хэсэгт
          харагдана. JPG эсвэл PNG, 4MB хүртэл.
        </p>
      </div>
    </div>
  );
}

/** One image: preview-or-drop-area, caption, change + remove buttons.
 *
 *  Uploads on SELECT, not on form save. The athlete profile defers its
 *  upload to submit, but it has exactly one image and one submit button;
 *  here an upload has to be a discrete action so a failure can leave the
 *  previously saved image untouched, which is what "keep the existing
 *  image on failure" requires. The url only reaches Firestore on the next
 *  save, like every other field on this form.
 *
 *  Nothing is cropped or resized before upload — the file goes to
 *  Cloudinary exactly as chosen, matching the athlete verification photo.
 *  The caption states the target ratio; render sites use object-fit. */
function ImageSlot({
  kind,
  url,
  caption,
  emptyLabel,
  onChange,
}: {
  kind: 'poster' | 'banner';
  url: string | null;
  caption: string;
  emptyLabel: string;
  onChange: (url: string | null, publicId: string | null) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function handleFile(file: File | null) {
    if (!file) return;
    const invalid = imageFileError(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    setProgress(0);
    try {
      const uploaded = await uploadImageToCloudinary(file, setProgress);
      onChange(uploaded.secureUrl, uploaded.publicId);
    } catch {
      // Deliberately does NOT call onChange — a failed upload leaves
      // whatever image was already there in place.
      setError('Зураг илгээхэд алдаа гарлаа');
    } finally {
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  return (
    <div>
      <div
        className={`oc-cf-drop oc-cf-drop-${kind}${url ? ' oc-cf-drop-filled' : ''}`}
        style={url ? { backgroundImage: `url(${url})` } : undefined}
        aria-hidden={!!url}
      >
        {url ? '' : emptyLabel}
      </div>

      <p className="oc-cf-imgcap" style={{ marginTop: 8 }}>
        {caption}
      </p>

      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 10 }}>
        {/* A label, not a button, wrapping a visually-hidden input — the
            same pattern as ФАЙЛ СОНГОХ on the athlete profile. */}
        <label className="oc-v3-ghost-btn" style={uploading ? { opacity: 0.5, cursor: 'default' } : undefined}>
          {url ? 'ЗУРАГ СОЛИХ' : 'ЗУРАГ НЭМЭХ'}
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            className="oc-v3-file-input"
            disabled={uploading}
            onChange={(e) => {
              handleFile(e.target.files?.[0] ?? null);
              // Reset so choosing the SAME file again after an error still
              // fires a change event.
              e.target.value = '';
            }}
          />
        </label>
        {url && (
          <button
            type="button"
            className="oc-v3-ghost-btn"
            disabled={uploading}
            onClick={() => {
              setError('');
              onChange(null, null);
            }}
          >
            УСТГАХ
          </button>
        )}
      </div>

      {uploading && (
        <p style={{ marginTop: 8, font: '400 11px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
          Зураг илгээж байна... {progress}%
        </p>
      )}
      {error && (
        <p className="text-sm text-[#E8543C]" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
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
