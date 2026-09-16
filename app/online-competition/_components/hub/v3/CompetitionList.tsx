'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { OnlineCompetition, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import { ONLINE_COMP_EVENTS, onlineCompEventLabel } from '@/lib/online-competition/events';
import { registrationWindow } from '@/lib/online-competition/registration-view';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import { fmtDate } from './util';
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
 *  array is only needed to pin an event that nothing uses yet. */
const SEEDED_FILTER_EVENTS = ['333', '222', 'skewb', 'pyram'];

/** Canonical display order — the platform's own event list, so the chips
 *  run in the same order as the admin form and the detail page. An id in no
 *  competition and not in ONLINE_COMP_EVENTS (a legacy doc) sorts last
 *  rather than being dropped. */
/** string[], not the ScrambleableEventId[] the map infers: the ids being
 *  ranked come out of stored competition documents, which are free to hold
 *  an event this build no longer offers. */
const EVENT_ORDER: string[] = ONLINE_COMP_EVENTS.map((e) => e.id);

/** The competitions list, modelled on worldcubeassociation.org/competitions:
 *  an event filter and a name search over sections grouped by state, each
 *  section a heading line plus rows on 1px dividers.
 *
 *  NO PANEL AROUND ANYTHING — not a group, not a row. And the table is
 *  width-CONSTRAINED (.oc-v3-clist), because five columns stretched across
 *  a 1600px monitor put the athlete count a hand's width from the name it
 *  belongs to; WCA's own columns sit close together on the left.
 *
 *  DISPLAY ONLY. Nothing here registers, opens or closes anything, and the
 *  filter and search are local state — no query, no URL, no refetch. */
export default function CompetitionList({
  competitions,
  counts,
}: {
  competitions: OnlineCompetition[];
  /** competitionId -> athlete count, from the athlete-counts route; null
   *  while that request is in flight or after it failed, which renders as
   *  "—" rather than a fabricated 0. */
  counts: Record<string, number> | null;
}) {
  const now = useNow();
  /** Selected event ids. Empty means "no event filter", NOT "no events" —
   *  see `visible` below. Multi-select, because the question an athlete
   *  asks is "which of these can I enter", not "which is exactly this
   *  one". */
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');

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
                  <WcaEventIcon eventId={eventId} size={17} />
                ) : (
                  eventId.toUpperCase()
                )}
              </button>
            );
          })}
        </div>

        <div className="oc-v3-clist-search">
          <input
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

            {/* Column headings, one set per section, as on WCA. Hidden below
                the breakpoint, where a row becomes a stack. */}
            <div className="oc-v3-clist-head">
              <span className="oc-v3-th">Огноо</span>
              <span className="oc-v3-th">Тэмцээн</span>
              <span className="oc-v3-th">Төрлүүд</span>
              <span className="oc-v3-th">Тамирчин</span>
              <span />
            </div>

            {group.rows.map((c) => (
              <Row key={c.id} competition={c} count={counts ? counts[c.id] ?? 0 : null} now={now} />
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

function Row({
  competition: c,
  count,
  now,
}: {
  competition: OnlineCompetition;
  count: number | null;
  now: number | null;
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

  return (
    <div className="oc-v3-clist-row">
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

      <span className="oc-v3-clist-date">{fmtDate(c.startAt)}</span>

      <div className="oc-v3-clist-name-cell">
        <span className="oc-v3-clist-name">{c.name}</span>
      </div>

      {/* Events and the athlete count are ONE group, not two columns a
          stacked row leaves at opposite edges. `display: contents` on
          desktop dissolves this wrapper back into the row's grid, so the
          two are still their own columns there — the alternative was
          rendering them twice. */}
      <div className="oc-v3-clist-meta">
        <div className="oc-v3-clist-events">
          {c.events.length === 0 ? (
            <span className="oc-v3-row-meta">—</span>
          ) : (
            c.events.map((e) => (
              <span key={e.eventId} className="oc-v3-clist-ev" role="img" aria-label={e.label} title={e.label}>
                {hasWcaEventIcon(e.eventId) ? (
                  <WcaEventIcon eventId={e.eventId} size={15} />
                ) : (
                  e.eventId.toUpperCase()
                )}
              </span>
            ))
          )}
        </div>

        {/* Desktop reads the unit off the ТАМИРЧИН column heading. Stacked,
            that heading is gone, so the unit comes with the number — but
            never on the "—" a count that has not arrived renders as. */}
        <span className="oc-v3-clist-count">
          {count === null ? (
            '—'
          ) : (
            <>
              {count}
              <span className="oc-v3-clist-count-unit"> тамирчин</span>
            </>
          )}
        </span>
      </div>

      {/* DESKTOP ONLY (display:none below the breakpoint). A stacked row is
          itself the link to the page where registering happens, so a second
          control repeating that trip is what it does not need; the start
          date takes this corner there instead. */}
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
    </div>
  );
}
