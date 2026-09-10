'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, FieldLabel, INPUT_CLASS, MONO_INPUT_CLASS, SELECT_CLASS, SquareToggle } from '../../_components/ui';
import { ROUND_GAP_TEXT, type RoundGapEvent } from './RoundGapWarning';
import { uploadImageToCloudinary } from '@/lib/online-competition/cloudinary';
import { ONLINE_COMP_EVENTS, onlineCompEventLabel } from '@/lib/online-competition/events';
import {
  RESULT_FORMATS,
  cutoffPhaseFor,
  formatLabel,
  resolveResultFormat,
  type ResultFormat,
} from '@/lib/online-competition/ao5';
import { fmtTimeLimit, parseTimeLimit } from '@/lib/online-competition/time-utils';
import { evaluateReadiness, type Readiness } from '@/lib/online-competition/publish-readiness';
import { describeVideo, parseVideoUrl } from '@/lib/online-competition/video-url';
import { competitionFeeTotals, formatMnt } from '@/lib/online-competition/fees';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import {
  COMPETITION_FORMAT_OPTIONS,
  DEFAULT_COMPETITION_FORMAT,
  MAX_BLOCKS_PER_SECTION,
  MAX_SECTIONS,
  type OnlineCompetitionAdminView,
  type OnlineCompetitionAdvancement,
  type OnlineCompetitionBlock,
  type OnlineCompetitionBlockType,
  type OnlineCompetitionEventConfig,
  type OnlineCompetitionSection,
  type OnlineCompetitionStatus,
  type OnlineCompetitionWriteInput,
} from '@/lib/online-competition/types';

// ── Tabbed competition editor ────────────────────────────────────────────
// Replaces the old inline CompetitionForm, which was one long form rendered
// beneath the list (create) and the detail page (edit). This is its own
// route in both cases — /competitions/new and /competitions/[id]/edit —
// rendering the same component, exactly as the old form served both.
//
// Ерөнхий, Зураг, Төрөл, the custom sections and Хянах have content. Төлбөр
// and Хуваарь render their header and a placeholder line; they are
// deliberately CLICKABLE rather than disabled, so the shape of the
// finished flow is visible.

const ADMIN_COMPETITIONS = '/online-competition/admin/competitions';

/** One thing a save wants the admin to acknowledge before it goes ahead.
 *  `headline` is what is about to happen; `detail` is the specifics —
 *  which events, how many athletes. */
interface SaveWarning {
  headline: string;
  detail: string;
}

/** The fixed tabs, in order. Хянах is NOT here — it is always appended
 *  last, after however many custom sections exist. */
const FIXED_TABS = ['Ерөнхий', 'Зураг', 'Төрөл', 'Төлбөр', 'Хуваарь'];
const REVIEW_LABEL = 'Хянах';

/** The mockup's un-numbered Шагнал tab is GONE as a hardcoded placeholder:
 *  it was a stand-in for exactly this feature, and an admin who wants a
 *  Шагнал tab now adds one with "+". Leaving both would put two things
 *  called Шагнал in the same position, one of them permanently empty. */

interface TabDef {
  kind: 'fixed' | 'section' | 'review';
  label: string;
  /** The two-digit prefix, on fixed and review tabs only. */
  num?: string;
  /** Index into `sections`, on a section tab only. */
  sectionIndex?: number;
}

/** The whole strip, derived from the section list.
 *
 *  EVERY number is computed from the tab's own 1-based position, including
 *  the fixed ones — nothing is hardcoded. That is what keeps Хянах correct
 *  as sections come and go: it is last, so its number is the strip length,
 *  and with one custom section it reads 07 exactly as the mockup shows.
 *  Custom tabs occupy a position and consume a number without DISPLAYING
 *  one, which is likewise what the mockup does with Шагнал between 05 and
 *  07. Adding, deleting or reordering a section renumbers Хянах with no
 *  code change, because there is no literal to update. */
function buildTabs(sections: OnlineCompetitionSection[]): TabDef[] {
  const tabs: TabDef[] = [
    ...FIXED_TABS.map((label): TabDef => ({ kind: 'fixed', label })),
    ...sections.map((sec, i): TabDef => ({ kind: 'section', label: sec.title, sectionIndex: i })),
    { kind: 'review', label: REVIEW_LABEL },
  ];
  return tabs.map((t, i) =>
    t.kind === 'section' ? t : { ...t, num: String(i + 1).padStart(2, '0') },
  );
}

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

/** The statuses the СТАТУС control may offer, given the one it currently
 *  holds.
 *
 *  A DRAFT IS OFFERED NOTHING BUT DRAFT. Leaving draft is publishing, and
 *  publishing is Зарлах on Хянах, behind the readiness checklist — an
 *  admin who can also do it from this dropdown can announce a competition
 *  with no name, no start time and no events, which is precisely what the
 *  checklist exists to prevent. Making the option absent rather than
 *  disabling the whole control keeps every other Ерөнхий edit available
 *  while a competition is still a draft.
 *
 *  In the other direction the full list stays: publishing is reversible,
 *  and un-publishing back to Ноорог is a legitimate correction that needs
 *  no gate — nobody can be harmed by a competition leaving the public
 *  site. From there, Зарлах is again the only way out. */
function statusOptionsFor(current: OnlineCompetitionStatus) {
  return current === 'draft' ? STATUS_OPTIONS.filter((o) => o.value === 'draft') : STATUS_OPTIONS;
}

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

/** A stable id for a section or block.
 *
 *  Generated ONCE, when the thing is created, and never regenerated —
 *  which is the whole point. Reordering moves array ELEMENTS (see moveItem
 *  below), so an id travels with its content: a block dragged to the top
 *  keeps the id it was born with, and every React key, every future
 *  anchor, and every diff against the stored document stays pointed at
 *  the same block. Keying by array index instead would make "reorder" and
 *  "swap the contents of two blocks" indistinguishable.
 *
 *  crypto.randomUUID needs a secure context; the admin panel is always
 *  https or localhost, but the getRandomValues fallback costs two lines
 *  and removes the question. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Moves one element of an array to another index, returning a new array.
 *  The ELEMENT moves — it is never rebuilt — so ids and content travel
 *  together. Used by both the drag drop and the up/down buttons, so the
 *  two cannot disagree about what a move means. */
function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The typed base fee as a number, or null for "not set". Junk parses to
 *  null here and is refused by validate() before any save, so it can never
 *  reach the payload as a silent 0. */
function parseBaseFeeText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Everything about a competition's money, as one comparable string.
 *
 *  Used to answer "did this save change the fee" without a field-by-field
 *  diff that would need updating every time a fee field is added. Event
 *  order is normalised out (sorted by id) so reordering the Төрөл tab is
 *  not mistaken for a price change. */
function feeFingerprint(
  baseFeeMnt: number | null,
  events: { eventId: string; surchargeMnt?: number | null }[],
): string {
  const parts = events
    .map((e) => `${e.eventId}:${typeof e.surchargeMnt === 'number' && e.surchargeMnt > 0 ? e.surchargeMnt : 0}`)
    .sort();
  return `${baseFeeMnt ?? ''}|${parts.join(',')}`;
}

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
  // Төлбөр tab. RAW TEXT for the same reason the per-event surcharge is —
  // and, like the featured banner fields, NEVER cleared when `paid` is
  // switched off. The tab hides its contents; the values survive, in the
  // form and in Firestore alike.
  const [baseFee, setBaseFee] = useState('');
  // Зураг tab. Uploaded to Cloudinary the moment a file is chosen (see
  // ImageSlot), so these hold a real remote URL, not a local preview —
  // they then persist with every other field on the next save.
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [posterPublicId, setPosterPublicId] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerPublicId, setBannerPublicId] = useState<string | null>(null);
  const [unlimited, setUnlimited] = useState(true);
  const [participantLimit, setParticipantLimit] = useState('');

  // Owned by the custom-section tabs. Stored SHAPE, not a form shape:
  // unlike EventRow there is nothing here a number input can leave
  // half-typed, so the editor edits the stored objects directly and a save
  // sends them as they are.
  const [sections, setSections] = useState<OnlineCompetitionSection[]>([]);
  // Focus the title of a section the moment it is created, so the admin
  // types the name rather than hunting for the field. Holds the section id
  // (never an index — an index would go stale the instant anything moved).
  const [focusSectionId, setFocusSectionId] = useState<string | null>(null);
  // Non-null while a "delete this section" confirm is up; holds the id, so
  // the confirm survives a reorder happening behind it.
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<string | null>(null);

  // Owned by the Төрөл tab. Kept as EventRow (rounds as a string,
  // advancement keyed by fromRound) rather than the stored shape — see
  // EventRow's comment for why.
  const [events, setEvents] = useState<EventRow[]>([]);
  // Same: the status this competition had when loaded, so the round-gap
  // confirm can tell a transition INTO live from an already-live save.
  const [loadedStatus, setLoadedStatus] = useState<OnlineCompetitionStatus | null>(null);
  // Server-computed; empty for a competition that does not exist yet.
  const [lockedEventIds, setLockedEventIds] = useState<string[]>([]);
  // How many athletes have registered, and what the fee was when this
  // form loaded — the pair the fee-change warning compares against. Both
  // start at "nothing yet", which is correct for a new competition: it has
  // no registrants and no stored fee to change.
  const [registeredCount, setRegisteredCount] = useState(0);
  const [loadedFees, setLoadedFees] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  // Non-null while a save is waiting on the admin's confirmation.
  //
  // ONE panel holding N reasons, not one panel per reason. There are two
  // things that can want confirming on the same save — going live with no
  // round open, and changing the fee under people who have registered —
  // and asking twice in a row, where confirming the first only reveals a
  // second, is the shape that trains an admin to click through both
  // without reading either.
  const [confirmSave, setConfirmSave] = useState<{
    warnings: SaveWarning[];
    then: 'stay' | 'next';
    status: OnlineCompetitionStatus;
  } | null>(null);

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
        setBaseFee(c.baseFeeMnt !== null ? String(c.baseFeeMnt) : '');
        setPosterUrl(c.posterUrl);
        setPosterPublicId(c.posterPublicId);
        setBannerUrl(c.bannerUrl);
        setBannerPublicId(c.bannerPublicId);
        setUnlimited(c.participantLimit === null);
        setParticipantLimit(c.participantLimit != null ? String(c.participantLimit) : '');
        setEvents(c.events.map(toEventRow));
        setSections(c.sections ?? []);
        setRegisteredCount(c.registeredCount);
        setLoadedFees(feeFingerprint(c.baseFeeMnt, c.events));
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

    // An unparseable limit BLOCKS the save. Dropping it to "no limit"
    // would look like it saved while quietly removing the constraint —
    // the one outcome an admin would not check for.
    for (const row of events) {
      if (!parseTimeLimit(row.timeLimit).ok) {
        return `${onlineCompEventLabel(row.eventId)}: цагийн хязгаар буруу форматтай (жишээ: 10:00)`;
      }
      for (const round of cutoffRoundsFor(row)) {
        if (!parseTimeLimit(row.cutoffs[round] ?? '').ok) {
          return `${onlineCompEventLabel(row.eventId)} · раунд ${round}: шүүлтүүр буруу форматтай (жишээ: 1:00)`;
        }
      }
    }

    // The fee. Blocks the save rather than being coerced, for the reason
    // the time limit above does: an amount that quietly became "included
    // in the base" would look like it saved while changing what athletes
    // are charged — the one outcome an admin would not re-check.
    //
    // Only when Төлбөртэй. A Төлбөргүй competition may carry any leftover
    // fee text; it is hidden, it is not charged, and it must not stand
    // between the admin and their save.
    if (paid) {
      const baseText = baseFee.trim();
      if (baseText) {
        const n = Number(baseText);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
          return 'Суурь хураамж бүхэл тоо байх ёстой (жишээ: 15000)';
        }
      }
      for (const row of events) {
        const problem = surchargeErrorOf(row);
        if (problem === 'empty') {
          return `${onlineCompEventLabel(row.eventId)}: нэмэлт хураамжийн дүнг оруулна уу`;
        }
        if (problem === 'invalid') {
          return `${onlineCompEventLabel(row.eventId)}: нэмэлт хураамж 0-ээс их бүхэл тоо байх ёстой`;
        }
      }
    }

    // Custom sections. A title is required (a nameless tab cannot be
    // rendered), and a media block with no media is refused rather than
    // saved as a slot that renders nothing — the same stance the time
    // limit above takes, for the same reason: a save that quietly drops
    // what the admin built is the one outcome they would not check for.
    //
    // An EMPTY SECTION is deliberately NOT refused here — see the warning
    // rendered inside SectionTab.
    for (const [i, sec] of sections.entries()) {
      if (!sec.title.trim()) return `${i + 1}-р хэсгийн нэр хоосон байна`;
      for (const [j, block] of sec.blocks.entries()) {
        const at = `«${sec.title.trim()}» хэсгийн ${j + 1}-р блок`;
        if (block.type === 'image' && !block.imageUrl) return `${at}: зураг оруулаагүй байна`;
        if (block.type === 'video') {
          if (!block.videoUrl?.trim()) return `${at}: видео холбоос оруулаагүй байна`;
          if (parseVideoUrl(block.videoUrl) === null) {
            return `${at}: зөвхөн YouTube эсвэл Vimeo холбоос оруулна уу`;
          }
        }
      }
    }

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

  /** Appends a section and opens it with the title focused. The new tab
   *  lands immediately before Хянах, which is where buildTabs puts every
   *  section — so switching to `tabs.length - 1` of the OLD list is the
   *  new section's index. */
  function addSection() {
    if (sections.length >= MAX_SECTIONS) return;
    const id = newId();
    setSections((prev) => [...prev, { id, title: 'Шинэ хэсэг', blocks: [] }]);
    setTab(FIXED_TABS.length + sections.length);
    setFocusSectionId(id);
  }

  /** Replaces one section, by id rather than index — every block-level
   *  edit routes through this, so a reorder that happened between render
   *  and click cannot write to the wrong section. */
  const updateSection = useCallback((id: string, patch: Partial<OnlineCompetitionSection>) => {
    setSections((prev) => prev.map((sec) => (sec.id === id ? { ...sec, ...patch } : sec)));
  }, []);

  function deleteSection(id: string) {
    setConfirmDeleteSection(null);
    setSections((prev) => prev.filter((sec) => sec.id !== id));
    // Land on the tab before the deleted one rather than wherever the
    // index now points — which, for the last section, is Хянах.
    setTab((t) => Math.max(0, t - 1));
  }

  /** The warning this save should raise about its fee, if any.
   *
   *  RECOMMENDATION IMPLEMENTED HERE: warn, do not lock. resultFormat,
   *  timeLimitCs and cutoffs are locked because a saved result was DERIVED
   *  under them — change one and history silently becomes a different
   *  number. A fee derives nothing: no payment is recorded, no total is
   *  stored, nothing recomputes. Locking it would stop an admin fixing a
   *  typo in a fee nobody has paid, to protect a record that does not
   *  exist. But an athlete who registered expecting 15 000₮ should not
   *  quietly come to owe 20 000₮ either, so the admin is told, by name and
   *  number, before it happens — and may proceed, because a fee genuinely
   *  can need correcting after registration opens.
   *
   *  ONCE PAYMENT STATUS IS TRACKED this should become a LOCK, matching
   *  the scoring rules: at that point a fee change does re-derive
   *  something — an athlete's recorded 15 000₮ payment turns into a 5 000₮
   *  debt with no record of why. The shape to add then is the one
   *  writeCompetitionDoc already uses for the format lock: refuse
   *  server-side, inside the write transaction, when any PAID registration
   *  exists, and let the admin re-price only the unpaid ones.
   *
   *  Only fires for a competition that exists AND has registrants: a
   *  create has neither. */
  const feeChangeWarning = useCallback((): SaveWarning | null => {
    if (savedId === null || loadedFees === null || registeredCount === 0) return null;
    const now = feeFingerprint(parseBaseFeeText(baseFee), events.map(toEventConfig));
    if (now === loadedFees) return null;
    return {
      headline: 'Бүртгэл эхэлсний дараа хураамж өөрчлөгдөж байна.',
      detail: `${registeredCount} тамирчин одоогийн хураамжаар бүртгүүлсэн байна. Тэдэнд мэдэгдэх нь таны үүрэг.`,
    };
  }, [savedId, loadedFees, registeredCount, baseFee, events]);

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

  /** `nextStatus` is the status this save WRITES, which is not always the
   *  one in the form: Зарлах publishes a draft as 'upcoming' without the
   *  admin having touched the СТАТУС control (which, for a draft, no
   *  longer offers a way out — see GeneralTab). Defaults to the form's
   *  own value, so every other save path is unchanged. */
  async function doSave(then: 'stay' | 'next', nextStatus: OnlineCompetitionStatus = status) {
    setConfirmSave(null);
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
        status: nextStatus,
        season: season.trim(),
        format,
        featured,
        featuredHeading,
        featuredCtaLabel,
        featuredUntil: datetimeLocalToMs(featuredUntil),
        instructions,
        paid,
        baseFeeMnt: parseBaseFeeText(baseFee),
        posterUrl,
        posterPublicId,
        bannerUrl,
        bannerPublicId,
        // Sent as-is. Array order is the order, and validateCompetitionInput
        // refuses anything malformed rather than dropping it — so a section
        // that reaches the server either saves whole or fails loudly.
        sections,
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
      // Both, so a publish is reflected in the header line and the СТАТУС
      // control immediately, and a second save does not re-publish.
      setStatus(nextStatus);
      setLoadedStatus(nextStatus);
      // The saved fee is the new baseline: a second save that changes
      // nothing must not warn again.
      setLoadedFees(feeFingerprint(payload.baseFeeMnt, payload.events));
      setSavedNote(nextStatus === 'upcoming' && status === 'draft' ? 'Зарлагдлаа' : 'Хадгалагдлаа');
      // Bounded by the CURRENT strip length, which grows and shrinks with
      // the section list.
      if (then === 'next') setTab((t) => Math.min(t + 1, FIXED_TABS.length + sections.length));
    } catch {
      setError('Хадгалахад алдаа гарлаа');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(then: 'stay' | 'next', statusOverride?: OnlineCompetitionStatus) {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');

    // Only on the transition INTO live — a competition that is already live
    // is covered by the standing warnings on the list, detail and Раунд
    // удирдах screens. Sits BELOW the publish decision and above every
    // save: Нооргоор хадгалах and Дараах both reach it, because either can
    // be the save that flips a competition live once the СТАТУС control is
    // set to Явагдаж буй. Зарлах writes 'upcoming', never 'live', so it
    // never trips this — going live stays a separate, later act, still
    // guarded exactly as before.
    const nextStatus = statusOverride ?? status;
    const warnings: SaveWarning[] = [];

    // Fee first: it is about people who are already registered, which is
    // the more consequential of the two.
    const fee = feeChangeWarning();
    if (fee) warnings.push(fee);

    if (nextStatus === 'live' && loadedStatus !== 'live') {
      setSaving(true);
      const gaps = await eventsGoingLiveWithoutRound();
      setSaving(false);
      if (gaps.length > 0) {
        warnings.push({
          headline: ROUND_GAP_TEXT,
          detail: `Раунд нээгдээгүй төрөл: ${gaps.map((e) => e.label).join(', ')}`,
        });
      }
    }

    if (warnings.length > 0) {
      setConfirmSave({ warnings, then, status: nextStatus });
      return;
    }
    await doSave(then, nextStatus);
  }

  // Derived, never stored: the Хянах tab and the Зарлах button both read
  // this, and the button asks only `canPublish` — which requirements are
  // blocking is declared in publish-readiness.ts, not decided here.
  const readiness: Readiness = evaluateReadiness({
    name,
    startAt: datetimeLocalToMs(startAt),
    registrationDeadline: datetimeLocalToMs(registrationDeadline),
    posterUrl,
    bannerUrl,
    paid,
    baseFeeMnt: parseBaseFeeText(baseFee),
    // roundsOf() floors at 1, so a row edited in this form always has a
    // round; the roundless check guards a stored event that arrived with
    // none, not a state the Төрөл tab can produce.
    events: events.map((e) => ({
      eventId: e.eventId,
      label: onlineCompEventLabel(e.eventId),
      rounds: roundsOf(e),
      // The one editor-only fact the checklist needs: marked as costing
      // extra, amount not typed. surchargeErrorOf covers both an empty and
      // an unusable amount — either way the fee is unknowable.
      surchargeIncomplete: surchargeErrorOf(e) !== null,
    })),
  });
  const isDraft = status === 'draft';
  const tabs = buildTabs(sections);
  // Clamped, and every branch below reads THIS rather than `tab`: deleting
  // the last section while its own tab is open leaves the raw index one
  // past the end for a frame, and an unclamped read there is a crash.
  const tabIndex = Math.min(tab, tabs.length - 1);
  const activeTab = tabs[tabIndex];
  const onReviewTab = activeTab.kind === 'review';

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
        {tabs.map((t, i) => (
          <button
            // Section tabs key on the SECTION ID, not the label: two
            // sections may legitimately share a title, and a key that
            // changes as the admin types the title would remount the
            // button on every keystroke.
            key={t.kind === 'section' ? sections[t.sectionIndex!].id : t.label}
            type="button"
            role="tab"
            aria-selected={i === tab}
            className={`oc-cf-tab${i === tab ? ' oc-cf-tab-active' : ''}`}
            onClick={() => setTab(i)}
          >
            {t.kind === 'section' ? (
              // The volt ◆ sits exactly where a number would, so the strip
              // keeps one rhythm while saying "this one is yours".
              <span className="oc-cf-tab-dot" aria-hidden>
                ◆
              </span>
            ) : (
              <span className="oc-cf-tab-num" aria-hidden>
                {t.num}
              </span>
            )}
            <span className="oc-cf-tab-label">{t.label || 'Нэргүй хэсэг'}</span>
          </button>
        ))}
        <button
          type="button"
          className="oc-cf-tab-add"
          title={
            sections.length >= MAX_SECTIONS
              ? `Хамгийн ихдээ ${MAX_SECTIONS} хэсэг нэмэх боломжтой`
              : 'Нийтэд харагдах шинэ хэсэг нэмэх'
          }
          aria-label="Нийтэд харагдах шинэ хэсэг нэмэх"
          disabled={sections.length >= MAX_SECTIONS}
          onClick={addSection}
        >
          +
        </button>
      </div>

      <div style={{ paddingTop: 24 }}>
        {tabIndex === 0 ? (
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
        ) : tabIndex === 2 ? (
          <EventsTab events={events} setEvents={setEvents} lockedEventIds={lockedEventIds} />
        ) : tabIndex === 1 ? (
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
        ) : tabIndex === 3 ? (
          <FeesTab {...{ paid, baseFee, setBaseFee, events, setEvents }} />
        ) : activeTab.kind === 'section' ? (
          <SectionTab
            key={sections[activeTab.sectionIndex!].id}
            section={sections[activeTab.sectionIndex!]}
            autoFocusTitle={focusSectionId === sections[activeTab.sectionIndex!].id}
            onFocused={() => setFocusSectionId(null)}
            onChange={updateSection}
            confirmingDelete={confirmDeleteSection === sections[activeTab.sectionIndex!].id}
            onRequestDelete={() => setConfirmDeleteSection(sections[activeTab.sectionIndex!].id)}
            onCancelDelete={() => setConfirmDeleteSection(null)}
            onDelete={() => deleteSection(sections[activeTab.sectionIndex!].id)}
          />
        ) : onReviewTab ? (
          <ReviewTab
            {...{
              name,
              events,
              unlimited,
              participantLimit,
              posterUrl,
              bannerUrl,
              registrationOpensAt,
              registrationDeadline,
              startAt,
              endAt,
              paid,
              baseFee,
              readiness,
            }}
          />
        ) : (
          <div>
            <span className="oc-v3-label">{activeTab.label}</span>
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

      {/* Warnings, never blocks. Both of these describe something an admin
          may legitimately want to do — a staged opening (go live now, open
          round 1 when the field is ready), or a fee corrected after
          registration opened — so each one says what will happen and lets
          them proceed. They just can't do it unknowingly. */}
      {confirmSave && (
        <div className="oc-sc-warn" style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {confirmSave.warnings.map((w) => (
            <div key={w.headline} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>▲ {w.headline}</span>
              <span style={{ color: '#8A6A28' }}>{w.detail}</span>
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmSave(null)}>
              Буцах
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={saving}
              onClick={() => doSave(confirmSave.then, confirmSave.status)}
            >
              Харин хадгалах
            </Button>
          </div>
        </div>
      )}

      {/* The reason has to be READABLE, not a title attribute on a disabled
          button — a disabled button does not reliably show one, and the
          admin needs to know what to go fix. */}
      {onReviewTab && isDraft && readiness.blockedReason && (
        <p className="oc-cf-blocked" style={{ marginTop: 16, textAlign: 'right' }}>
          {readiness.blockedReason}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2" style={{ marginTop: 24 }}>
        {savedNote && (
          <span className="text-xs" style={{ color: 'var(--color-ink-soft)', marginRight: 'auto' }}>
            {savedNote}
          </span>
        )}
        {/* Нооргоор хадгалах never changes status — on every tab, including
            this one, it writes the form as it stands. Only Зарлах moves a
            draft out of 'draft'. */}
        <Button type="button" variant="outline" disabled={saving} onClick={() => handleSave('stay')}>
          {saving ? 'Хадгалж байна...' : 'Нооргоор хадгалах'}
        </Button>
        {onReviewTab ? (
          isDraft ? (
            <Button
              type="button"
              variant="primary"
              // The ONLY publish gate. It names no requirement — a fourth
              // one added to REQUIREMENT_SPECS as blocking disables this
              // button with no change here.
              disabled={saving || !readiness.canPublish}
              onClick={() => handleSave('stay', 'upcoming')}
            >
              {saving ? 'Хадгалж байна...' : 'Зарлах'}
            </Button>
          ) : (
            // Already announced. Not a disabled Зарлах — that reads as
            // "you may not publish" rather than "already published".
            <span className="oc-cf-published">Зарласан</span>
          )
        ) : (
          <Button type="button" variant="primary" disabled={saving} onClick={() => handleSave('next')}>
            Дараах
          </Button>
        )}
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
  /** RAW TEXT as typed ("10:00"), not centiseconds — a number input would
   *  destroy a half-written value on every keystroke, and the stored form
   *  is not what the admin reads or writes. Parsed at save; an
   *  unparseable value blocks the save with a message rather than being
   *  silently dropped to "no limit". */
  timeLimit: string;
  /** round number -> RAW cutoff text, same reasoning as timeLimit. Not
   *  pruned when the round count drops, so lowering and raising it again
   *  restores what was typed — the treatment advancement already gets. */
  cutoffs: Record<number, string>;
  /** Whether this event is covered by the base fee — the `Суурьд багтсан`
   *  toggle.
   *
   *  Held SEPARATELY from the amount rather than inferred from it being
   *  empty, because those are three states, not two: included, surcharged
   *  with an amount, and surcharged with the amount not typed yet. The
   *  third is the one an inferred flag cannot express, and it is exactly
   *  the one that has to BLOCK THE SAVE — an event the admin marked as
   *  costing extra, with no idea how much. */
  feeIncluded: boolean;
  /** RAW surcharge text as typed ("5000"), for the same reason timeLimit
   *  is text: a number input is legitimately empty or half-typed mid-edit,
   *  and a Number() on every keystroke would fight the admin.
   *
   *  NOT cleared when feeIncluded is switched back on — the input renders
   *  empty and disabled, but the text survives in state, so toggling back
   *  off restores what was typed. The same within-session undo advancement
   *  and cutoffs already get, for the same reason: an accidental click
   *  should not destroy a typed value. */
  surcharge: string;
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
    timeLimit: typeof e.timeLimitCs === 'number' ? fmtTimeLimit(e.timeLimitCs) : '',
    // null/absent = included in the base fee, which is the default for
    // every event stored before this field existed.
    feeIncluded: !(typeof e.surchargeMnt === 'number' && e.surchargeMnt > 0),
    surcharge: typeof e.surchargeMnt === 'number' && e.surchargeMnt > 0 ? String(e.surchargeMnt) : '',
    cutoffs: Object.fromEntries((e.cutoffs ?? []).map((c) => [c.round, fmtTimeLimit(c.cutoffCs)])),
    advancement,
  };
}

/** This row's surcharge as it will be STORED: null when the event is
 *  included in the base fee — whatever text is retained behind the
 *  disabled input — otherwise the parsed amount.
 *
 *  An unparseable amount returns null here, but validate() refuses the
 *  save before that can happen, so it is never silently downgraded to
 *  "included". The same contract parseTimeLimit has with an unparseable
 *  time limit. */
function surchargeOfRow(row: EventRow): number | null {
  if (row.feeIncluded) return null;
  const n = Number(row.surcharge.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Why this row's surcharge cannot be saved, or null if it can.
 *
 *  'empty'   — marked as costing extra, with no amount typed.
 *  'invalid' — an amount that is not a whole number above zero.
 *  An INCLUDED row is always fine, whatever text is retained behind its
 *  disabled input. */
function surchargeErrorOf(row: EventRow): 'empty' | 'invalid' | null {
  if (row.feeIncluded) return null;
  const text = row.surcharge.trim();
  if (!text) return 'empty';
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return 'invalid';
  return null;
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
    // validate() has already refused an unparseable value, so a failed
    // parse here can only mean empty -> no limit.
    timeLimitCs: (() => {
      const parsed = parseTimeLimit(row.timeLimit);
      return parsed.ok ? parsed.value : null;
    })(),
    // In-range, parseable, non-empty entries only. A blank round is "no
    // cutoff", not an error — and an out-of-range one (the round count was
    // lowered) is dropped rather than sent, exactly like advancement.
    cutoffs: cutoffRoundsFor(row)
      .map((round) => {
        const parsed = parseTimeLimit(row.cutoffs[round] ?? '');
        return parsed.ok && parsed.value !== null ? { round, cutoffCs: parsed.value } : null;
      })
      .filter((c): c is { round: number; cutoffCs: number } => c !== null),
    advancement,
    // null = included in the base fee. validate() has already refused an
    // unparseable amount, so a null here can only mean "included".
    surchargeMnt: surchargeOfRow(row),
  };
}

/** The rounds of this event that may carry a cutoff: all of them, but only
 *  when the format has an established cutoff phase (ao5/bo3). Empty
 *  otherwise, which is what hides the control. */
function cutoffRoundsFor(row: EventRow): number[] {
  if (cutoffPhaseFor(row.resultFormat) === null) return [];
  return Array.from({ length: roundsOf(row) }, (_, i) => i + 1);
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

  function setCutoff(index: number, round: number, text: string) {
    setEvents((prev) =>
      prev.map((row, i) => (i === index ? { ...row, cutoffs: { ...row.cutoffs, [round]: text } } : row)),
    );
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
    // feeIncluded: true — a NEW event is covered by the base fee until the
    // admin says otherwise on the Төлбөр tab. The opposite default would
    // silently raise the price of every competition that gains an event.
    setEvents((prev) => [
      ...prev,
      {
        eventId,
        rounds: '1',
        resultFormat: 'ao5',
        timeLimit: '',
        cutoffs: {},
        advancement: {},
        feeIncluded: true,
        surcharge: '',
      },
    ]);
    setPickerOpen(false);
  }

  return (
    <div>
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
        const cutoffRounds = cutoffRoundsFor(row);
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
                {/* Per-attempt maximum. Typed as a human time and stored as
                    centiseconds; empty means NO LIMIT, which is also the
                    default for every event that predates the field.
                    Deliberately not locked-looking when locked is false —
                    but it IS locked once results exist, for the same
                    reason the format is (see the lock in
                    admin-competitions.ts). */}
                <FieldLabel>ЛИМИТ</FieldLabel>
                <input
                  className={MONO_INPUT_CLASS}
                  value={row.timeLimit}
                  disabled={locked}
                  placeholder="10:00"
                  title={locked ? FORMAT_LOCKED_REASON : 'Жишээ: 10:00 · хоосон бол хязгааргүй'}
                  aria-label="Цагийн хязгаар"
                  onChange={(e) => update(i, { timeLimit: e.target.value })}
                  style={locked ? { opacity: 0.5 } : undefined}
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

            {/* One row per round that may carry a cutoff. Only shown for
                formats with an established cutoff phase — see
                cutoffPhaseFor; Mo3/Bo2/Bo1 are omitted deliberately rather
                than guessed at. */}
            {cutoffRounds.length > 0 && (
              <div className="oc-cf-adv">
                <FieldLabel>ШҮҮЛТҮҮР · ЭХНИЙ {cutoffPhaseFor(row.resultFormat)} ОРОЛДЛОГО</FieldLabel>
                {cutoffRounds.map((round) => (
                  <div key={round} className="oc-cf-adv-row">
                    <span className="oc-cf-adv-label">Раунд {round}</span>
                    <input
                      className={MONO_INPUT_CLASS}
                      value={row.cutoffs[round] ?? ''}
                      disabled={locked}
                      placeholder="1:00"
                      onChange={(e) => setCutoff(i, round, e.target.value)}
                      aria-label={`Раунд ${round} шүүлтүүр`}
                      title={locked ? FORMAT_LOCKED_REASON : 'Хоосон бол шүүлтүүргүй'}
                      style={locked ? { width: 110, flexShrink: 0, opacity: 0.5 } : { width: 110, flexShrink: 0 }}
                    />
                    <span className="oc-cf-adv-suffix">хоосон = шүүлтүүргүй</span>
                  </div>
                ))}
              </div>
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

// ── 04 Төлбөр ────────────────────────────────────────────────────────────

// The mockup's ТӨЛӨХ ХУГАЦАА and ДАНС are deliberately NOT here. The
// registration window (Ерөнхий) already bounds when payment can happen, so
// a second deadline would be a second source of truth for the same fact;
// and bank details are prose that changes per competition, which is what
// the custom sections exist for — the admin writes a "Төлбөр" section and
// owns the wording.

interface FeesTabProps {
  paid: boolean;
  baseFee: string;
  setBaseFee: (v: string) => void;
  events: EventRow[];
  setEvents: React.Dispatch<React.SetStateAction<EventRow[]>>;
}

/** The ХУРААМЖ cell's value on the Хянах tab.
 *
 *  Reads the same competitionFeeTotals the Төлбөр tab does, so the review
 *  can never quote a number the fee tab does not show. A range only when
 *  there is one — "15 000₮ – 15 000₮" for a competition with no surcharges
 *  would be noise. */
function feeSummary(paid: boolean, baseFee: string, events: EventRow[]): string {
  if (!paid) return 'Төлбөргүй';
  const base = parseBaseFeeText(baseFee);
  const totals = competitionFeeTotals(
    base,
    events.map((row) => ({ eventId: row.eventId, surchargeMnt: surchargeOfRow(row) })),
  );
  // Told apart from a real 0: a base fee of nothing is a legitimate
  // configuration (every event surcharged), and it must not read as
  // "unset" — nor the reverse.
  if (base === null && totals.maxMnt === 0) return 'Тохируулаагүй';
  return totals.maxMnt > totals.minMnt
    ? `${formatMnt(totals.minMnt)} – ${formatMnt(totals.maxMnt)}`
    : formatMnt(totals.minMnt);
}

function FeesTab(p: FeesTabProps) {
  // The tab itself is never hidden — an admin who opens it must be able to
  // learn WHY it is empty and where the switch is. A missing tab teaches
  // nothing.
  if (!p.paid) {
    return (
      <div>
        <span className="oc-v3-label">ХУРААМЖ</span>
        <p className="oc-cf-soon" style={{ marginTop: 10, maxWidth: 640, textWrap: 'pretty' }}>
          Энэ тэмцээн хураамжгүй. Ерөнхий хэсэгт «Төлбөртэй» сонгосноор хураамж тохируулна.
        </p>
      </div>
    );
  }

  const setRow = (index: number, patch: Partial<EventRow>) =>
    p.setEvents((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  // Derived from the STORED shape, via the same pure function the public
  // pages will use — so the admin's totals and the athlete's cannot drift
  // apart. surchargeOfRow resolves the toggle, so a retained amount behind
  // a re-ticked Суурьд багтсан never reaches the maths.
  const totals = competitionFeeTotals(
    parseBaseFeeText(p.baseFee),
    p.events.map((row) => ({ eventId: row.eventId, surchargeMnt: surchargeOfRow(row) })),
  );
  const includedLabels = totals.includedEventIds.map((id) => onlineCompEventLabel(id));

  return (
    <div>
      <div style={{ maxWidth: 280 }}>
        <FieldLabel>СУУРЬ ХУРААМЖ · ₮</FieldLabel>
        <input
          className={MONO_INPUT_CLASS}
          style={MT2}
          inputMode="numeric"
          placeholder="15000"
          value={p.baseFee}
          onChange={(e) => p.setBaseFee(e.target.value)}
        />
        <p className="oc-cf-hint" style={{ marginTop: 8 }}>
          Бүх бүртгүүлэгчийн төлөх дүн. Бүхэл тоо, аравтын оронгүй.
        </p>
      </div>

      <div style={{ marginTop: 28 }}>
        <FieldLabel>ТӨРӨЛ ТУС БҮР</FieldLabel>
        {p.events.length === 0 ? (
          <p className="oc-cf-soon" style={{ marginTop: 10 }}>
            Төрөл нэмээгүй байна. «Төрөл» хэсэгт төрөл нэмсний дараа энд нэмэлт хураамж тохируулна.
          </p>
        ) : (
          <>
            <div className="oc-cf-fee-list" style={{ marginTop: 10 }}>
              {/* Driven by `events` — the Төрөл tab's own list — so an event
                  added there appears here included, and an event removed
                  there takes its surcharge with it. There is no separate
                  fee list that could disagree with the event list, and no
                  orphan is possible: the surcharge lives ON the event. */}
              {p.events.map((row, i) => {
                const problem = surchargeErrorOf(row);
                return (
                  <div key={`${row.eventId}-${i}`} className="oc-cf-fee-row">
                    <span className="oc-cf-ev-icon" aria-hidden>
                      {hasWcaEventIcon(row.eventId) ? (
                        <WcaEventIcon eventId={row.eventId} size={16} />
                      ) : (
                        row.eventId.slice(0, 4).toUpperCase()
                      )}
                    </span>
                    <span className="oc-cf-fee-name">{onlineCompEventLabel(row.eventId)}</span>
                    <SquareToggle
                      checked={row.feeIncluded}
                      onChange={(v) => setRow(i, { feeIncluded: v })}
                      label="Суурьд багтсан"
                    />
                    <span className="oc-cf-fee-amount">
                      <span className="oc-cf-fee-amount-label">НЭМЭЛТ · ₮</span>
                      <input
                        className={MONO_INPUT_CLASS}
                        inputMode="numeric"
                        placeholder="5000"
                        disabled={row.feeIncluded}
                        aria-label={`${onlineCompEventLabel(row.eventId)} нэмэлт хураамж`}
                        // Renders EMPTY while included, but the state keeps
                        // what was typed — untick and it comes back.
                        value={row.feeIncluded ? '' : row.surcharge}
                        onChange={(e) => setRow(i, { surcharge: e.target.value })}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Named per row rather than only in the save error, so the
                admin sees which row is unfinished before they press save. */}
            {p.events.some((row) => surchargeErrorOf(row) !== null) && (
              <p className="oc-cf-fee-bad" style={{ marginTop: 10 }}>
                ▲ Дүн оруулаагүй эсвэл буруу төрөл байна:{' '}
                {p.events
                  .filter((row) => surchargeErrorOf(row) !== null)
                  .map((row) => onlineCompEventLabel(row.eventId))
                  .join(' · ')}
              </p>
            )}
            <p className="oc-cf-fee-included" style={{ marginTop: 12 }}>
              {includedLabels.length > 0
                ? `Суурь хураамжид багтсан: ${includedLabels.join(' · ')}`
                : 'Суурь хураамжид багтсан төрөл алга — бүх төрөл нэмэлт хураамжтай.'}
            </p>
          </>
        )}
      </div>

      <div className="oc-cf-sum" style={{ marginTop: 28 }}>
        <div className="oc-cf-sum-cell">
          <span className="oc-cf-sum-label">ХАМГИЙН БАГА</span>
          <span className="oc-cf-sum-value">{formatMnt(totals.minMnt)}</span>
        </div>
        <div className="oc-cf-sum-cell">
          <span className="oc-cf-sum-label">БҮХ ТӨРӨЛД ОРВОЛ</span>
          <span className="oc-cf-sum-value">{formatMnt(totals.maxMnt)}</span>
        </div>
      </div>
      <p className="oc-cf-hint" style={{ marginTop: 8 }}>
        Хамгийн бага = суурь хураамж. Бүх төрөлд орвол = суурь дээр бүх нэмэлт хураамж нэмсэн дүн.
      </p>
    </div>
  );
}

// ── Custom sections ──────────────────────────────────────────────────────
// One tab per admin-authored section. Everything here edits the STORED
// shape directly (OnlineCompetitionSection / OnlineCompetitionBlock) —
// there is no form-row intermediate like EventRow, because nothing in a
// section is a number that can be half-typed.

const BLOCK_KIND: { type: OnlineCompetitionBlockType; label: string }[] = [
  { type: 'text', label: '+ Текст' },
  { type: 'image', label: '+ Зураг' },
  { type: 'video', label: '+ Видео' },
];

/** A new block of the given type, with its payload field already present
 *  and empty. Built from one switch so a new type is added in exactly one
 *  place on the client, mirroring BLOCK_PAYLOAD_FIELDS on the server. */
function newBlock(type: OnlineCompetitionBlockType): OnlineCompetitionBlock {
  const id = newId();
  if (type === 'text') return { id, type, text: '' };
  if (type === 'image') return { id, type };
  return { id, type, videoUrl: '' };
}

interface SectionTabProps {
  section: OnlineCompetitionSection;
  autoFocusTitle: boolean;
  onFocused: () => void;
  onChange: (id: string, patch: Partial<OnlineCompetitionSection>) => void;
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}

function SectionTab(p: SectionTabProps) {
  const { section } = p;
  const titleRef = useRef<HTMLInputElement | null>(null);

  // Only for a section that was just created — onFocused clears the flag,
  // so switching back to this tab later does not steal focus from
  // wherever the admin actually clicked.
  const { autoFocusTitle, onFocused } = p;
  useEffect(() => {
    if (!autoFocusTitle) return;
    titleRef.current?.focus();
    titleRef.current?.select();
    onFocused();
  }, [autoFocusTitle, onFocused]);

  // ── drag state ───────────────────────────────────────────────────────
  // Plain HTML5 drag-and-drop, no library. `armed` is what makes the row
  // draggable ONLY when the pointer went down on the handle: with
  // `draggable` set unconditionally, a click-drag inside a textarea would
  // start a row drag instead of selecting text, which makes the text
  // blocks unusable. Pressing the handle arms the row, and dragend or
  // pointerup disarms it.
  const [armed, setArmed] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const setBlocks = (blocks: OnlineCompetitionBlock[]) => p.onChange(section.id, { blocks });

  /** The one move primitive. Drag-drop and the up/down buttons both land
   *  here, so the two paths cannot disagree — and both move the ELEMENT,
   *  which is what carries the id along with the content. */
  const move = (from: number, to: number) => {
    if (to < 0 || to >= section.blocks.length) return;
    setBlocks(moveItem(section.blocks, from, to));
  };

  const addBlock = (type: OnlineCompetitionBlockType) => {
    if (section.blocks.length >= MAX_BLOCKS_PER_SECTION) return;
    setBlocks([...section.blocks, newBlock(type)]);
  };

  const updateBlock = (id: string, patch: Partial<OnlineCompetitionBlock>) => {
    setBlocks(section.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBlock = (id: string) => setBlocks(section.blocks.filter((b) => b.id !== id));

  const full = section.blocks.length >= MAX_BLOCKS_PER_SECTION;

  return (
    <div>
      <div className="oc-cf-sec-head">
        <div style={{ flex: 1, minWidth: 220 }}>
          <FieldLabel>ХЭСГИЙН НЭР</FieldLabel>
          <input
            ref={titleRef}
            className={INPUT_CLASS}
            style={MT2}
            value={section.title}
            maxLength={40}
            onChange={(e) => p.onChange(section.id, { title: e.target.value })}
          />
        </div>
        <button type="button" className="oc-v3-ghost-btn oc-cf-sec-del" onClick={p.onRequestDelete}>
          ХЭСГИЙГ УСТГАХ
        </button>
      </div>

      {/* A section can hold a great deal of typed content, and deleting it
          takes all of it — so this one asks, unlike publishing, which is
          reversible. Inline rather than window.confirm, matching the
          round-gap confirmation. */}
      {p.confirmingDelete && (
        <div className="oc-sc-warn" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span>
            ▲ «{section.title.trim() || 'Нэргүй хэсэг'}» хэсгийг устгах уу?
            {section.blocks.length > 0 && ` ${section.blocks.length} блок хамт устана.`}
          </span>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={p.onCancelDelete}>
              Буцах
            </Button>
            <Button type="button" variant="primary" onClick={p.onDelete}>
              Устгах
            </Button>
          </div>
        </div>
      )}

      {/* Not a publish blocker and NOT dropped on save — see the note in
          the editor's validate(). Said here, where the admin can act on
          it, rather than on Хянах where it would be a checklist row for
          something that is not a requirement. */}
      {section.blocks.length === 0 && (
        <p className="oc-cf-sec-empty" style={{ marginTop: 12 }}>
          ▲ Хоосон хэсэг нийтэд хоосон таб болж харагдана. Агуулга нэмнэ үү, эсвэл хэсгийг устгана уу.
        </p>
      )}

      <div style={{ marginTop: 28 }}>
        <FieldLabel>АГУУЛГА</FieldLabel>
        <div className="oc-cf-sec-add" style={{ marginTop: 10 }}>
          {BLOCK_KIND.map((k) => (
            <button
              key={k.type}
              type="button"
              className="oc-v3-ghost-btn"
              disabled={full}
              title={full ? `Нэг хэсэгт хамгийн ихдээ ${MAX_BLOCKS_PER_SECTION} блок багтана` : undefined}
              onClick={() => addBlock(k.type)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="oc-cf-hint" style={{ marginTop: 8 }}>
          Зургийг эхэнд, дунд, сүүлд гэж чирээд байрлуулна.
        </p>
      </div>

      <div style={{ marginTop: 16 }}>
        {section.blocks.map((block, i) => (
          <div
            key={block.id}
            className={`oc-cf-blk${dragId === block.id ? ' oc-cf-blk-dragging' : ''}${
              overIndex === i && dragId !== null && dragId !== block.id ? ' oc-cf-blk-over' : ''
            }`}
            draggable={armed === block.id}
            onDragStart={(e) => {
              setDragId(block.id);
              e.dataTransfer.effectAllowed = 'move';
              // Firefox refuses to start a drag unless some data is set.
              e.dataTransfer.setData('text/plain', block.id);
            }}
            onDragOver={(e) => {
              if (dragId === null) return;
              // preventDefault is what marks this a valid drop target;
              // without it the browser refuses the drop outright.
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = section.blocks.findIndex((b) => b.id === dragId);
              if (from !== -1) move(from, i);
              setDragId(null);
              setOverIndex(null);
              setArmed(null);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverIndex(null);
              setArmed(null);
            }}
          >
            <div className="oc-cf-blk-grip">
              {/* Arming the row here, rather than making it permanently
                  draggable, is what keeps the textarea selectable. */}
              <span
                className="oc-cf-blk-handle"
                role="presentation"
                title="Чирж байрлуулах"
                onPointerDown={() => setArmed(block.id)}
                onPointerUp={() => setArmed(null)}
              >
                ⣿
              </span>
              {/* The reason both exist: HTML5 drag events never fire for a
                  touch drag, and this panel is used on a phone. These are
                  the only way to reorder there — not a convenience. */}
              <button
                type="button"
                className="oc-cf-blk-move"
                aria-label="Дээш зөөх"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                ▲
              </button>
              <button
                type="button"
                className="oc-cf-blk-move"
                aria-label="Доош зөөх"
                disabled={i === section.blocks.length - 1}
                onClick={() => move(i, i + 1)}
              >
                ▼
              </button>
            </div>

            <div className="oc-cf-blk-body">
              <BlockEditor block={block} onChange={(patch) => updateBlock(block.id, patch)} />
            </div>

            <button
              type="button"
              className="oc-cf-blk-x"
              aria-label="Блокыг устгах"
              onClick={() => removeBlock(block.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The per-type body of one block. Kept apart from the row chrome (grip,
 *  X, drag wiring) so adding a fourth block type touches only this switch
 *  and newBlock above. */
function BlockEditor({
  block,
  onChange,
}: {
  block: OnlineCompetitionBlock;
  onChange: (patch: Partial<OnlineCompetitionBlock>) => void;
}) {
  if (block.type === 'text') {
    return (
      <textarea
        className={INPUT_CLASS}
        rows={5}
        placeholder="Текст бичнэ үү"
        value={block.text ?? ''}
        onChange={(e) => onChange({ text: e.target.value })}
      />
    );
  }

  if (block.type === 'image') {
    return (
      <BlockImage
        url={block.imageUrl ?? null}
        onChange={(imageUrl, imagePublicId) =>
          // Both together, always — a stale publicId beside a new url
          // would point a future cleanup at the wrong Cloudinary asset.
          // undefined rather than null: these are optional fields on the
          // stored block, and Firestore refuses a null-vs-absent muddle.
          onChange({ imageUrl: imageUrl ?? undefined, imagePublicId: imagePublicId ?? undefined })
        }
      />
    );
  }

  return <BlockVideo url={block.videoUrl ?? ''} onChange={(videoUrl) => onChange({ videoUrl })} />;
}

/** An image block's upload slot.
 *
 *  Uses the SAME uploadImageToCloudinary and the SAME imageFileError rules
 *  as the Зураг tab's poster and banner — there is deliberately no second
 *  upload path. What differs is only the frame: a section image has no
 *  fixed ratio, so it renders at its natural one instead of in a 1:1 or
 *  16:5 box. */
function BlockImage({
  url,
  onChange,
}: {
  url: string | null;
  onChange: (url: string | null, publicId: string | null) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const uploading = progress !== null;

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
      // Same as the poster slot: a failed upload leaves whatever was
      // already there untouched.
      setError('Зураг илгээхэд алдаа гарлаа');
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a Cloudinary
        // url of unknown dimensions, shown only in the admin editor.
        <img src={url} alt="" className="oc-cf-blk-img" />
      ) : (
        <div className="oc-cf-blk-drop">ЗУРАГГҮЙ</div>
      )}
      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 10 }}>
        <label className="oc-v3-ghost-btn" style={uploading ? { opacity: 0.5, cursor: 'default' } : undefined}>
          {url ? 'ЗУРАГ СОЛИХ' : 'ЗУРАГ НЭМЭХ'}
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            className="oc-v3-file-input"
            disabled={uploading}
            onChange={(e) => {
              handleFile(e.target.files?.[0] ?? null);
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

/** A video block's url input, with the parse read back underneath.
 *
 *  An unrecognised url is NOT cleared, corrected or discarded — the typed
 *  text stays exactly as entered and an amber line says it was not
 *  understood. Silently emptying an admin's paste would leave them with no
 *  idea what went wrong, and "fixing" it would mean guessing at a link we
 *  could not parse. The save is what refuses it (validate(), and
 *  independently the server with the same parser), so an unparseable url
 *  can be left in place while the admin goes and finds the right one, but
 *  can never reach Firestore. */
function BlockVideo({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const trimmed = url.trim();
  const parsed = trimmed ? parseVideoUrl(trimmed) : null;

  return (
    <div>
      <input
        className={INPUT_CLASS}
        placeholder="https://youtube.com/watch?v=... эсвэл https://vimeo.com/..."
        value={url}
        onChange={(e) => onChange(e.target.value)}
      />
      {trimmed === '' ? (
        <p className="oc-cf-hint" style={{ marginTop: 8 }}>
          YOUTUBE ЭСВЭЛ VIMEO ХОЛБООС
        </p>
      ) : parsed ? (
        <p className="oc-cf-blk-parsed" style={{ marginTop: 8 }}>
          ✓ {describeVideo(parsed)}
        </p>
      ) : (
        <p className="oc-cf-blk-bad" style={{ marginTop: 8 }}>
          ▲ Холбоос танигдсангүй. Зөвхөн YouTube эсвэл Vimeo видеоны холбоос оруулна уу.
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
          {statusOptionsFor(p.status).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {p.status === 'draft' && (
          <p className="oc-cf-hint" style={{ marginTop: 8 }}>
            Зарлах товч «Хянах» табд байна.
          </p>
        )}
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

// ── 07 Хянах ─────────────────────────────────────────────────────────────

interface ReviewTabProps {
  name: string;
  events: EventRow[];
  unlimited: boolean;
  participantLimit: string;
  posterUrl: string | null;
  bannerUrl: string | null;
  registrationOpensAt: string;
  registrationDeadline: string;
  startAt: string;
  endAt: string;
  paid: boolean;
  baseFee: string;
  readiness: Readiness;
}

/** YYYY.MM.DD HH:mm — this is the tab where an admin verifies the exact
 *  moment registration closes, so unlike the list's fmtDate it keeps the
 *  time. Takes a datetime-local string because that is what the editor
 *  holds; an unset field is the empty string, which reads as "—". */
function fmtMoment(value: string): string {
  const ms = datetimeLocalToMs(value);
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function imagesSummary(posterUrl: string | null, bannerUrl: string | null): string {
  if (posterUrl && bannerUrl) return 'Постер · баннер';
  if (posterUrl) return 'Постер';
  if (bannerUrl) return 'Баннер';
  return 'Оруулаагүй';
}

/** Read-only overview + the readiness checklist. The publish button itself
 *  lives in the editor's shared footer, beside Нооргоор хадгалах, rather
 *  than in here — it is a save, and every save button belongs in one row.
 *
 *  ХУВААРЬ is in the mockup's grid but not here: that tab does not exist
 *  yet, and a cell that can only ever say "—" teaches the admin to ignore
 *  the grid. ХУРААМЖ arrived with the Төлбөр tab, as that note said it
 *  should. Add ХУВААРЬ with its own. */
function ReviewTab(p: ReviewTabProps) {
  const cells: { label: string; value: string }[] = [
    { label: 'НЭР', value: p.name.trim() || '—' },
    { label: 'ТӨРӨЛ', value: `${p.events.length} төрөл` },
    {
      label: 'ХЯЗГААР',
      value: p.unlimited
        ? 'Хязгааргүй'
        : // Mirrors the save's own coercion (Math.max(1, …)), so the grid
          // never promises a limit different from the one that is written.
          `${Math.max(1, parseInt(p.participantLimit, 10) || 0)} тамирчин`,
    },
    { label: 'ЗУРАГ', value: imagesSummary(p.posterUrl, p.bannerUrl) },
    { label: 'ХУРААМЖ', value: feeSummary(p.paid, p.baseFee, p.events) },
    { label: 'БҮРТГЭЛ', value: `${fmtMoment(p.registrationOpensAt)} → ${fmtMoment(p.registrationDeadline)}` },
    { label: 'ТЭМЦЭЭН', value: `${fmtMoment(p.startAt)} → ${fmtMoment(p.endAt)}` },
  ];

  return (
    <div>
      <div className="oc-cf-sum">
        {cells.map((c) => (
          <div key={c.label} className="oc-cf-sum-cell">
            <span className="oc-cf-sum-label">{c.label}</span>
            <span className="oc-cf-sum-value">{c.value}</span>
          </div>
        ))}
      </div>

      {/* Shown whatever the status. An admin editing an already-announced
          competition still wants to see that it has no poster — hiding the
          checklist after publishing would hide the one place those gaps
          are ever named. */}
      <div style={{ marginTop: 28 }}>
        <span className="oc-v3-label">ЗАРЛАХААС ӨМНӨ</span>
        <div className="oc-cf-check" style={{ marginTop: 10 }}>
          {p.readiness.requirements.map((r) => (
            <div key={r.key} className={`oc-cf-check-row${r.met ? ' oc-cf-check-row-ready' : ''}`}>
              <span className="oc-cf-check-mark" aria-hidden />
              <span className="oc-cf-check-label">{r.label}</span>
              <span className="oc-cf-check-status">{r.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
