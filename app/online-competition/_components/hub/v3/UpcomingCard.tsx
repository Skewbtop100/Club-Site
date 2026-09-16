'use client';

import Link from 'next/link';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { CompetitionRow } from './CompetitionList';
import { useNow } from './CompetitionCells';
import EmptyBlock from './EmptyBlock';

const COMPETITIONS = '/online-competition/competitions';

/** How many rows the hub shows before БҮГД →.
 *
 *  THREE. The section is a teaser under the hero, not a list: at 39px a row
 *  on a wide screen and 61px stacked, three come to ~120px and ~185px, so
 *  the section still reads as one block on a phone and does not push the
 *  hero off the top. Two looked like a list that had run out; four started
 *  competing with the page's actual subject. Anyone who wants the list has
 *  БҮГД → and the ТЭМЦЭЭН tab, both one tap away. */
const HOME_ROWS = 3;

/** The hub's УДАХГҮЙ БОЛОХ ТЭМЦЭЭН section.
 *
 *  These are the SAME rows as /competitions — CompetitionRow, imported, in
 *  its compact variant. They used to be a separate row layout in this file
 *  with its own seat-progress bar, its own registration countdown pill and
 *  its own event-icon treatment, all of which the competitions list had
 *  already dropped; the two drifted the moment one was redesigned.
 *
 *  What this file still owns is the framing: the heading, the БҮГД link, the
 *  cap, and the empty state. No filter chips and no search — three rows need
 *  neither, and a filter that narrowed a teaser to nothing would be worse
 *  than no filter at all. */
export default function UpcomingCard({
  competitions,
  counts,
}: {
  competitions: OnlineCompetition[];
  /** competitionId -> athlete count, for the capacity readout. null while
   *  the request is in flight or after it failed. */
  counts: Record<string, number> | null;
}) {
  // Shared with the competitions list, so the rows on both pages decide the
  // registration window against the same kind of clock (null until the first
  // client effect, so nothing time-dependent is painted during SSR).
  const now = useNow();
  const shown = competitions.slice(0, HOME_ROWS);

  return (
    <div className="oc-v3-card">
      <div className="oc-v3-card-head">
        <span className="oc-v3-label">Удахгүй болох тэмцээн</span>
        <Link href={COMPETITIONS} className="oc-v3-label-link">
          БҮГД →
        </Link>
      </div>

      {shown.length === 0 ? (
        <EmptyBlock text="Тэмцээн алга." />
      ) : (
        <div className="oc-v3-clist-rows">
          {shown.map((c) => (
            <CompetitionRow
              key={c.id}
              competition={c}
              count={counts ? counts[c.id] ?? 0 : null}
              now={now}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}
