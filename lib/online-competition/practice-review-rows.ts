// ── The practice review grid's rows ─────────────────────────────────────
// PURE. The runs the admin route sent, the tab, and which athlete's run is
// open, in; the rows to draw, out. No React, no Firestore — so which rows
// appear, which runs they carry and when a row leaves are unit-tested
// (tests/competition-fields/practice-review-rows.test.cjs) instead of being
// found out on the admin screen.
//
// THE TWO RULES THIS EXISTS TO PIN:
//
//   A ROW CARRIES EVERY RUN THE ATHLETE HAS, decided or not, on both tabs.
//   The tab picks which ATHLETES appear, never which of their runs. "Tried
//   five times, wrong every time" is only visible if all five are drawn.
//
//   ON ХЯНАГДААГҮЙ A ROW LEAVES ONCE NOTHING OF ITS IS PENDING — but not
//   while the admin is looking at it. The athlete whose run is open in the
//   panel is HELD: deciding their last pending run recolours the cell and
//   leaves the row where it is, the way the competition grid leaves a judged
//   attempt on screen with its panel still open. The row goes when the panel
//   moves to another athlete or closes.

import { practiceAllowance, type PracticeRunStatus } from './practice';

/** The fields the grid reads. AdminPracticeRow satisfies it. */
export interface PracticeReviewRun {
  id: string;
  uid: string;
  displayName: string;
  status: PracticeRunStatus;
  createdAtMs: number | null;
}

export interface PracticeReviewRow<R extends PracticeReviewRun> {
  uid: string;
  name: string;
  /** Oldest first, so the row reads left to right as the athlete's history
   *  — the same direction attempt 1 to attempt 5 reads in. */
  runs: R[];
  pending: number;
  /** Of the ten — practiceAllowance, the same count the athlete's page and
   *  the filing route use. */
  used: number;
}

export function practiceReviewRows<R extends PracticeReviewRun>(
  runs: readonly R[],
  scope: 'pending' | 'all',
  /** The athlete whose run is open in the panel, or null. */
  heldUid: string | null,
): PracticeReviewRow<R>[] {
  const byUid = new Map<string, R[]>();
  for (const run of runs) {
    const list = byUid.get(run.uid) ?? [];
    list.push(run);
    byUid.set(run.uid, list);
  }

  const rows = [...byUid.entries()].map(([uid, list]) => {
    const ordered = [...list].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
    return {
      uid,
      name: ordered[ordered.length - 1]?.displayName ?? uid.slice(0, 10),
      runs: ordered,
      pending: ordered.filter((r) => r.status === 'pending').length,
      used: practiceAllowance(ordered.map((r) => r.status)).used,
    };
  });

  const shown = scope === 'pending' ? rows.filter((r) => r.pending > 0 || r.uid === heldUid) : rows;

  // Waiting first, then the longest-standing athlete at the top: a queue is
  // worked from its head. THE HELD ATHLETE COUNTS AS WAITING, so deciding
  // their last run does not throw the row to the bottom of the list under
  // the admin's cursor on either tab.
  const waiting = (r: PracticeReviewRow<R>) => (r.pending > 0 || r.uid === heldUid ? 1 : 0);
  const oldest = (r: PracticeReviewRow<R>) => r.runs[0]?.createdAtMs ?? Infinity;
  return shown.sort((a, b) => waiting(b) - waiting(a) || oldest(a) - oldest(b) || a.uid.localeCompare(b.uid));
}

/** How many runs are waiting. Counted from the runs held on screen rather
 *  than from the load's own number, so a decision updates the tab's count
 *  without a reload. Complete on both tabs: every pending run's athlete is
 *  in scope, and the route sends every run of every athlete in scope. */
export function practicePendingCount(runs: readonly PracticeReviewRun[]): number {
  return runs.filter((r) => r.status === 'pending').length;
}
