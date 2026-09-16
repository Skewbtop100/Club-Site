'use client';

import Link from 'next/link';
import type { OnlineCompetition, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import { registrationWindow } from '@/lib/online-competition/registration-view';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import { fmtDate } from './util';
import { useNow } from './CompetitionCells';
import EmptyBlock from './EmptyBlock';

const HUB = '/online-competition';

/** The competitions list, modelled on worldcubeassociation.org/competitions:
 *  one section per state with a count in its header, and inside a section
 *  one row per competition carrying only date, name, events and athlete
 *  count.
 *
 *  Replaces AllCompetitionsTable, which put a seat-progress bar and a
 *  registration countdown in every row. Both are gone: the bar's filled
 *  portion was always empty (no public registered count existed, so it
 *  asserted nothing) and the countdown duplicated the detail page's own,
 *  much larger one.
 *
 *  DISPLAY ONLY. Nothing here registers, opens or closes anything — the
 *  БҮРТГҮҮЛЭХ action is a link to the detail page, where the panel and
 *  firestore.rules both still decide what is allowed. */
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

  // A section per state, in the order WCA shows them. `draft` has no
  // section: fetchAllCompetitions filters drafts out server-side, and a
  // status this list has no bucket for is dropped rather than shown under
  // a heading that does not describe it.
  const groups = GROUPS.map((group) => ({
    ...group,
    rows: competitions
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

  if (groups.length === 0) {
    return (
      <div className="oc-v3-card">
        <EmptyBlock text="Тэмцээн алга." />
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.status} className="oc-v3-card">
          <div className="oc-v3-card-head">
            <span className="oc-v3-label">{group.label}</span>
            <span className="oc-v3-count-badge">{group.rows.length}</span>
          </div>

          {/* Column headings, one set per section, as on WCA. Hidden below
              the breakpoint, where each row is a card instead. */}
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
      ))}
    </>
  );
}

const GROUPS: { status: OnlineCompetitionStatus; label: string; newestFirst: boolean }[] = [
  { status: 'live', label: 'Явагдаж буй', newestFirst: false },
  { status: 'upcoming', label: 'Удахгүй', newestFirst: false },
  { status: 'finished', label: 'Дууссан', newestFirst: true },
];

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
  // window has not opened. The old row only looked at the deadline and did
  // exactly that. `now` is null until the first client effect, so nothing
  // time-dependent is painted during SSR.
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
      <span className="oc-v3-clist-date">{fmtDate(c.startAt)}</span>

      <div className="oc-v3-clist-name-cell">
        <Link href={`${HUB}/${c.id}/details`} className="oc-v3-clist-name">
          {c.name}
        </Link>
      </div>

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

      {/* Desktop: the bare number under the ТАМИРЧИН heading. On a card the
          heading is gone, so the unit comes with it — but never on the "—"
          a count that has not arrived renders as. */}
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

      <div className="oc-v3-clist-action-cell">
        {/* A plain text action, not the full-width volt block this column
            used to be. Every row keeps one: a closed or finished
            competition still has a page worth opening. */}
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
