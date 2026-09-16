'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { OnlineCompetition, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import { ONLINE_COMP_EVENTS, onlineCompEventLabel } from '@/lib/online-competition/events';
import { registrationWindow } from '@/lib/online-competition/registration-view';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import { fmtDate, splitStartDate } from './util';
import { useNow } from './CompetitionCells';
import EmptyBlock from './EmptyBlock';

const HUB = '/online-competition';

/** The event chips the filter ALWAYS offers, whether or not a competition
 *  currently uses them — so the filter reads as a deliberate set rather
 *  than as a side effect of whatever happens to be announced this month.
 *
 *  It is a floor, not the whole list: filterEventIds below adds every event
 *  that appears in the loaded competitions, so announcing a Megaminx
 *  competition puts a Megaminx chip here with NO code change. Editing this
 *  array is only needed to pin an event that nothing uses yet.
 *
 *  Every id here is a key of EVENT_ICON_MAP (lib/wca-event-icon.tsx), so
 *  every chip carries a real WCA glyph rather than the uppercase-code
 *  fallback — including the three added last: 444, 333oh and clock. */
const SEEDED_FILTER_EVENTS = ['333', '222', '444', '333oh', 'pyram', 'skewb', 'clock'];

/** Canonical display order — the platform's own event list, so the chips
 *  run in the same order as the admin form and the detail page. An id in no
 *  competition and not in ONLINE_COMP_EVENTS (a legacy doc) sorts last
 *  rather than being dropped.
 *
 *  string[], not the ScrambleableEventId[] the map infers: the ids being
 *  ranked come out of stored competition documents, which are free to hold
 *  an event this build no longer offers. */
const EVENT_ORDER: string[] = ONLINE_COMP_EVENTS.map((e) => e.id);

/** The competitions list, modelled on worldcubeassociation.org/competitions:
 *  an event filter and a name search over sections grouped by state, each
 *  section a heading line plus rows on 1px dividers.
 *
 *  NO PANEL AROUND ANYTHING — not a group, not a row — and the table is
 *  width-constrained and centred (.oc-v3-clist).
 *
 *  DISPLAY ONLY. Nothing here registers, opens or closes anything, and the
 *  filter and search are local state — no query, no URL, no refetch. */
export default function CompetitionList({
  competitions,
  counts,
}: {
  competitions: OnlineCompetition[];
  /** competitionId -> athlete count, from the athlete-counts route; null
   *  while that request is in flight or after it failed. The capacity
   *  readout then shows "—" rather than a fabricated 0 — except for a
   *  competition with no limit, which needs no count to be described. */
  counts: Record<string, number> | null;
}) {
  const now = useNow();
  /** Selected event ids. Empty means "no event filter", NOT "no events" —
   *  see `visible` below. Multi-select, because the question an athlete
   *  asks is "which of these can I enter", not "which is exactly this
   *  one". */
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  /** Phone only: the field is behind a magnifier at the end of the chip
   *  row. Above that breakpoint CSS shows the field unconditionally and
   *  this stays false, so it never steals focus on a desktop. */
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const filterEventIds = useMemo(() => {
    const ids = new Set(SEEDED_FILTER_EVENTS);
    for (const c of competitions) for (const e of c.events) ids.add(e.eventId);
    return [...ids].sort((a, b) => rank(a) - rank(b));
  }, [competitions]);

  const needle = query.trim().toLowerCase();
  const filtering = selected.length > 0 || needle !== '';

  // Filter and search NARROW EACH OTHER: a competition has to clear both.
  // Within the event filter the selected events are alternatives (has any
  // one of them), which is why an empty selection cannot mean "matches
  // nothing" — it means the filter is off.
  const visible = useMemo(
    () =>
      competitions.filter(
        (c) =>
          (selected.length === 0 || c.events.some((e) => selected.includes(e.eventId))) &&
          (needle === '' || c.name.toLowerCase().includes(needle)),
      ),
    [competitions, selected, needle],
  );

  const groups = GROUPS.map((group) => ({
    ...group,
    rows: visible
      .filter((c) => c.status === group.status)
      .sort((a, b) => {
        const at = a.startAt ? a.startAt.toMillis() : null;
        const bt = b.startAt ? b.startAt.toMillis() : null;
        // A competition with no start time sorts last in EVERY section —
        // not first in the descending one, which is what a single
        // Infinity/0 sentinel would have done.
        if (at === null || bt === null) return (at === null ? 1 : 0) - (bt === null ? 1 : 0);
        // Soonest first — and for a finished competition that means the
        // one that finished most recently, which is what someone looking
        // for results wants at the top (and what WCA's own past list
        // does). Flip `newestFirst` to read that section oldest-first.
        return group.newestFirst ? bt - at : at - bt;
      }),
  })).filter((group) => group.rows.length > 0);

  function toggle(eventId: string) {
    setSelected((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId],
    );
  }

  function clearAll() {
    setSelected([]);
    setQuery('');
    setSearchOpen(false);
  }

  return (
    <div className="oc-v3-clist">
      <div className="oc-v3-clist-bar">
        <div className="oc-v3-clist-filters" role="group" aria-label="Төрлөөр шүүх">
          {filterEventIds.map((eventId) => {
            const on = selected.includes(eventId);
            const label = onlineCompEventLabel(eventId);
            return (
              <button
                key={eventId}
                type="button"
                // Icon-only, as on WCA, so the strip stays one line on a
                // phone — which makes the accessible name the button's only
                // name, not a decoration.
                aria-pressed={on}
                aria-label={label}
                title={label}
                className={`oc-v3-evfilter${on ? ' oc-v3-evfilter-on' : ''}`}
                onClick={() => toggle(eventId)}
              >
                {hasWcaEventIcon(eventId) ? (
                  <WcaEventIcon eventId={eventId} size={18} />
                ) : (
                  eventId.toUpperCase()
                )}
              </button>
            );
          })}
        </div>

        {/* PHONE ONLY (display:none above the breakpoint, where the field is
            simply always there). Kept OUTSIDE the event-filter group — it
            does not filter by event — but immediately after it, so it reads
            as the last item of the chip row. Its border is what tells it
            apart from the bare event glyphs beside it.

            Closing CLEARS: a search still narrowing the list from behind a
            collapsed icon is a list lying about what it contains. */}
        <button
          type="button"
          className={`oc-v3-clist-searchtoggle${
            searchOpen || query !== '' ? ' oc-v3-clist-searchtoggle-on' : ''
          }`}
          aria-expanded={searchOpen}
          aria-label="Тэмцээний нэрээр хайх"
          title="Тэмцээний нэрээр хайх"
          onClick={() => {
            if (searchOpen) {
              setQuery('');
              setSearchOpen(false);
            } else {
              setSearchOpen(true);
            }
          }}
        >
          <MagnifierGlyph />
        </button>

        <div className={`oc-v3-clist-search${searchOpen ? ' oc-v3-clist-search-open' : ''}`}>
          <input
            ref={searchRef}
            type="search"
            className="oc-v3-input oc-v3-clist-searchinput"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Escape clears without leaving the field, the convention for a
            // search box; the ✕ and ЦЭВЭРЛЭХ are the pointer routes.
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="Тэмцээний нэрээр хайх"
            aria-label="Тэмцээний нэрээр хайх"
          />
          {query !== '' && (
            <button
              type="button"
              className="oc-v3-clist-searchclear"
              aria-label="Хайлтыг цэвэрлэх"
              onClick={() => setQuery('')}
            >
              ✕
            </button>
          )}
        </div>

        {/* Appears only when something is actually filtering, so the bar
            carries no dead control in its resting state. */}
        {filtering && (
          <button type="button" className="oc-v3-clist-reset" onClick={clearAll}>
            Цэвэрлэх
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        filtering ? (
          /* Distinct from "there are no competitions": the list is not
             empty, this filter's answer is. So it says so, and offers the
             way back rather than leaving the reader to find the controls
             that did it. */
          <EmptyBlock
            text="Шүүлтэд тохирох тэмцээн алга."
            hint={
              <button type="button" className="oc-v3-clist-reset" onClick={clearAll}>
                Шүүлтийг цэвэрлэх
              </button>
            }
          />
        ) : (
          <EmptyBlock text="Тэмцээн алга." />
        )
      ) : (
        groups.map((group) => (
          <section key={group.status} className="oc-v3-group">
            {/* A line of text and a number — not .oc-v3-card-head, whose
                15px of padding and two border edges cost more height than a
                row does. */}
            <h2 className="oc-v3-group-head">
              <span className="oc-v3-label">{group.label}</span>
              <span className="oc-v3-group-count">{group.rows.length}</span>
            </h2>

            {/* Column headings, one set per section, as on WCA. Each is
                aligned the way its own column's content is — ОГНОО over a
                left-aligned date, ТӨРЛҮҮД centred over centred icons —
                because a heading that does not sit over its column is worse
                than no heading. Hidden below the breakpoint, where a row
                becomes a stack. */}
            <div className="oc-v3-clist-head">
              <span className="oc-v3-th">Огноо</span>
              <span className="oc-v3-th">Тэмцээн</span>
              <span className="oc-v3-th oc-v3-th-center">Төрлүүд</span>
              <span className="oc-v3-th">Тамирчин</span>
              <span />
            </div>

            {group.rows.map((c) => (
              <CompetitionRow key={c.id} competition={c} count={counts ? counts[c.id] ?? 0 : null} now={now} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

const GROUPS: { status: OnlineCompetitionStatus; label: string; newestFirst: boolean }[] = [
  { status: 'live', label: 'Явагдаж буй', newestFirst: false },
  { status: 'upcoming', label: 'Удахгүй', newestFirst: false },
  { status: 'finished', label: 'Дууссан', newestFirst: true },
];

function rank(eventId: string): number {
  const i = EVENT_ORDER.indexOf(eventId);
  return i < 0 ? EVENT_ORDER.length : i;
}

/** How full a competition is.
 *
 *  THE LIMIT IS NOT FROM THE COUNT ENDPOINT. participantLimit is a field on
 *  the competition document, already in hand from fetchAllCompetitions the
 *  moment the row renders; /athlete-counts returns only the taken numbers.
 *  Nothing was added server-side for this.
 *
 *  Which is also why `unlimited` outranks `unknown`: a competition with no
 *  cap is fully described by the document alone, so it must not sit behind
 *  a "—" waiting for a count it does not need. */
type Capacity =
  | { kind: 'unknown' }
  | { kind: 'unlimited' }
  | { kind: 'limited'; taken: number; limit: number; fraction: number; full: boolean };

function capacityOf(limit: number | null | undefined, taken: number | null): Capacity {
  // null/absent is "unlimited" by the schema (see OnlineCompetition). A
  // non-positive number is not a real cap either, and dividing by it below
  // would not end well.
  if (limit == null || limit <= 0) return { kind: 'unlimited' };
  if (taken === null) return { kind: 'unknown' };
  const fraction = Math.min(1, Math.max(0, taken / limit));
  return { kind: 'limited', taken, limit, fraction, full: taken >= limit };
}

/** ONE row of the competitions list — date, name, events, capacity, and
 *  (wide only) the register action.
 *
 *  EXPORTED because the hub's УДАХГҮЙ БОЛОХ ТЭМЦЭЭН section renders the same
 *  rows. It is the row that is reusable, not CompetitionList: that component
 *  also owns the filter bar, the search, the state grouping and the section
 *  headings, none of which a three-row teaser on the home page wants. Three
 *  suppression props would have left a component whose behaviour depended on
 *  a combination nobody reads.
 *
 *  `compact` is the home page's variant: no register action (the row is
 *  already a link to the competition, and БҮГД → leads to the full list) and
 *  a narrower grid, so the rows fit the hub's left column beside a live card
 *  without overflowing it. */
export function CompetitionRow({
  competition: c,
  count,
  now,
  compact = false,
}: {
  competition: OnlineCompetition;
  count: number | null;
  now: number | null;
  compact?: boolean;
}) {
  // The SAME check the registration panel makes — status, opening time and
  // deadline — so a row cannot offer БҮРТГҮҮЛЭХ for a competition whose
  // window has not opened. `now` is null until the first client effect, so
  // nothing time-dependent is painted during SSR.
  const open =
    now !== null &&
    registrationWindow(
      {
        status: c.status,
        registrationOpensAtMs: c.registrationOpensAt ? c.registrationOpensAt.toMillis() : null,
        registrationDeadlineMs: c.registrationDeadline ? c.registrationDeadline.toMillis() : null,
      },
      now,
    ).open;

  const date = splitStartDate(c.startAt);
  const capacity = capacityOf(c.participantLimit, count);

  return (
    <div className={`oc-v3-clist-row${compact ? ' oc-v3-clist-row-compact' : ''}`}>
      {/* The whole row is the link: one absolutely-positioned anchor over
          it, so a tap anywhere opens the competition and a screen reader
          hears ONE link named after it — not an anchor per cell.
          Deliberately not the name element itself with a stretched
          ::after: the name needs `overflow: hidden` for its desktop
          ellipsis, and that clips its own pseudo-element back to the cell.
          Out of flow, so it occupies no grid cell. */}
      <Link
        href={`${HUB}/${c.id}/details`}
        className="oc-v3-clist-rowlink"
        aria-label={c.name}
      />

      {/* Two renderings of one date, one hidden per layout — the wide row
          wants it on a single line in its own column, the stacked row wants
          a tile down the left edge, and a single element cannot be both
          without fighting over which of the year and the month-day comes
          first in the DOM. `display: none` keeps the hidden one out of the
          accessibility tree too, so neither is read twice. */}
      <span className="oc-v3-clist-date">
        <span className="oc-v3-clist-date-wide">{fmtDate(c.startAt)}</span>
        <span className="oc-v3-clist-date-tile">
          <span className="oc-v3-clist-date-day">{date ? date.monthDay : '—'}</span>
          {date && <span className="oc-v3-clist-date-year">{date.year}</span>}
        </span>
      </span>

      <div className="oc-v3-clist-name-cell">
        <span className="oc-v3-clist-name">{c.name}</span>
      </div>

      {/* Events and the capacity readout are ONE group. Stacked, it sits in
          the name's column directly under it — indented past the date tile,
          so it reads as belonging to the name. Wide, `display: contents`
          dissolves this wrapper so the two are still their own grid
          columns. */}
      <div className="oc-v3-clist-meta">
        <div className="oc-v3-clist-events">
          {c.events.length === 0 ? (
            <span className="oc-v3-row-meta">—</span>
          ) : (
            c.events.map((e) => (
              <span key={e.eventId} className="oc-v3-clist-ev" role="img" aria-label={e.label} title={e.label}>
                {hasWcaEventIcon(e.eventId) ? (
                  <WcaEventIcon eventId={e.eventId} size={17} />
                ) : (
                  e.eventId.toUpperCase()
                )}
              </span>
            ))
          )}
        </div>

        {/* WIDE ONLY — the stacked row shows the ring instead. TAKEN OF THE
            LIMIT, not the bare registered count this column used to show: a
            number on its own says nothing about whether there is room left,
            which is the only reason to look at it. */}
        <span className="oc-v3-clist-cap">
          {capacity.kind === 'unlimited' ? (
            /* A coloured marker, not a dash — "no limit" is a fact about
               the competition, and the dash it used to share with "not
               loaded yet" read as a failure. */
            <span className="oc-v3-clist-cap-inf" title="Хязгааргүй">
              ∞
            </span>
          ) : capacity.kind === 'unknown' ? (
            <span className="oc-v3-clist-cap-none">—</span>
          ) : (
            <>
              <span className={capacity.full ? 'oc-v3-clist-cap-full' : undefined}>
                {capacity.taken}
              </span>
              <span className="oc-v3-clist-cap-limit"> / {capacity.limit}</span>
            </>
          )}
        </span>
      </div>

      {/* STACKED ONLY. Level with the name, at the row's right end. */}
      <span className="oc-v3-clist-ringcell">
        <CapacityRing capacity={capacity} />
      </span>

      {/* WIDE ONLY (display:none below the breakpoint), and never in the
          compact variant. A stacked row is itself the link to the page where
          registering happens, so a second control repeating that trip is
          what it does not need — and on the home page neither is a teaser's
          job. Not rendered rather than hidden, so it occupies no grid cell
          at any width. */}
      {!compact && (
      <div className="oc-v3-clist-action-cell">
        {open ? (
          <Link href={`${HUB}/${c.id}/details`} className="oc-v3-clist-action" style={{ color: '#DFFF4F' }}>
            Бүртгүүлэх
          </Link>
        ) : (
          <Link href={`${HUB}/${c.id}/details`} className="oc-v3-clist-action">
            Дэлгэрэнгүй
          </Link>
        )}
      </div>
      )}
    </div>
  );
}

// ── The capacity ring ───────────────────────────────────────────────────
// A FACEIT-style badge: a track, an arc for how full the competition is,
// and the taken count in the middle. SVG rather than a round div with a
// conic-gradient background, because the arc has to stop on an exact
// fraction — a dash offset is arithmetic where a gradient stop is a guess —
// and because one <text> centres reliably where absolute positioning inside
// a 34px circle does not.
const RING_SIZE = 34;
const RING_R = 14;
const RING_C = 2 * Math.PI * RING_R;
const RING_TRACK = '#2A2A31';
const RING_ARC = '#DFFF4F';

function CapacityRing({ capacity }: { capacity: Capacity }) {
  // An unlimited competition gets the COMPLETE TRACK AND NO ARC: there is
  // no fraction of "no limit" to fill, and a full volt ring would say the
  // exact opposite of what is true. The ∞ inside carries the volt instead,
  // so the badge still reads as a deliberate state and not a failed one.
  const label =
    capacity.kind === 'unlimited'
      ? 'Хязгааргүй'
      : capacity.kind === 'unknown'
        ? 'Тамирчны тоо тодорхойгүй'
        : `${capacity.taken} / ${capacity.limit} тамирчин`;
  const center =
    capacity.kind === 'unlimited' ? '∞' : capacity.kind === 'unknown' ? '—' : String(capacity.taken);
  const centerColor =
    capacity.kind === 'unlimited'
      ? RING_ARC
      : capacity.kind === 'unknown'
        ? '#4A4740'
        : capacity.full
          ? RING_ARC
          : '#F4F1EA';

  return (
    <svg
      className="oc-v3-clist-ring"
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      role="img"
      aria-label={label}
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        fill="none"
        stroke={RING_TRACK}
        strokeWidth={3}
      />
      {capacity.kind === 'limited' && capacity.fraction > 0 && (
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_R}
          fill="none"
          stroke={RING_ARC}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - capacity.fraction)}
          // From twelve o'clock, clockwise — a dash starts at three o'clock
          // otherwise.
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      )}
      <text
        x={RING_SIZE / 2}
        y={RING_SIZE / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={centerColor}
        style={{
          font: `700 ${capacity.kind === 'unlimited' ? 14 : 12}px var(--oc-font-mono), monospace`,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {center}
      </text>
    </svg>
  );
}

/** The search toggle's glyph. Drawn rather than borrowed: @cubing/icons is
 *  the only icon set in the project and it ships cube events, not UI
 *  symbols, and the "⌕" character renders at wildly different weights
 *  across platforms. */
function MagnifierGlyph() {
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" fill="none" aria-hidden focusable="false">
      <circle cx={6.2} cy={6.2} r={4.4} stroke="currentColor" strokeWidth={1.6} />
      <path d="M9.6 9.6 L13.2 13.2" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}
