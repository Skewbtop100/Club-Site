import { FieldValue } from 'firebase-admin/firestore';
import { getOnlineCompAdminDb } from './firebase-admin';
import { collectRoundResults } from './round-results';
import { roundKey } from './scrambles';
import { fmtCentiseconds } from './time-utils';
import { getEvent } from '../wca-events';
import { ONLINE_NOTIFICATIONS, type OnlineCompetitionEventConfig } from './types';

// ── Server-only writer for onlineNotifications ────────────────────────────
// Every notification this platform sends originates here, with the Admin
// SDK. The trigger runs behind the password-cookie admin gate, where there
// is no Firebase Auth identity for security rules to check, so
// firestore.rules denies `create` on this collection to every client —
// exactly as it does for onlineSubmissions.status/penalty.
//
// The client-side half (subscribe / markRead / markAllRead / formatting)
// lives in ./notifications.ts. Neither file imports the other: the shared
// collection name sits in ./types.ts, which pulls in no Firebase SDK at
// all, so this module never drags the client app into a server route and
// ./notifications.ts never drags firebase-admin into a client bundle.
//
// ── When a notification is sent ─────────────────────────────────────────
// Once per athlete, when their ROUND is finalised — not per judge
// decision. Judging a five-attempt round is five separate writes; hanging
// a notification on each would tell an athlete five times about one round,
// four of those while the result was still incomplete and meaningless.

/** Where a notification row sends the athlete. Deliberately the full
 *  in-app path, not a bare '/dashboard': the comp.* rewrite (middleware.ts)
 *  passes /online-competition/* straight through, so this is the one form
 *  that resolves on BOTH the subdomain and the club site's own
 *  /online-competition path — same reasoning as HubNav's DASHBOARD
 *  constant, where a bare '/dashboard' would land on the club's unrelated
 *  dashboard. */
const DASHBOARD_HREF = '/online-competition/dashboard';

// Two independent markers on onlineCompetitions/{id}/roundState/{event}_{round}.
// They are separate because a round can end in two steps: an admin may
// close it (results known, cut not yet decided) and advance it later. One
// marker would have let the close suppress the advancement announcement —
// the message athletes care about most.
/** Set once this round's finishers have been told their result. */
const RESULTS_MARKER = 'resultsNotifiedAt';
/** Set once this round's qualifiers have been told they advanced. */
const ADVANCED_MARKER = 'advancedNotifiedAt';

/** Event display name, from the same source the admin panel renders:
 *  the competition's own stored `label` (types.ts keeps it redundantly so
 *  the name list can change independently of stored eventIds), falling
 *  back to the shared WCA event map and finally the raw id. */
function eventName(events: OnlineCompetitionEventConfig[], eventId: string): string {
  return events.find((e) => e.eventId === eventId)?.label ?? getEvent(eventId)?.name ?? eventId;
}

/** Announce a finalised round to every athlete who finished it.
 *
 *  Called from BOTH paths that move a round to 'done' — closing it
 *  (admin-rounds) and committing qualifiers (admin-rounds/qualify) —
 *  because either can be the moment a round actually ends.
 *
 *  NEVER THROWS. A notification is a courtesy; the round transition that
 *  triggered it has already committed, and a Firestore hiccup here must
 *  not turn a successful close or advance into a failure the admin sees.
 *  Failures are logged and swallowed.
 *
 *  ── What each path sends ─────────────────────────────────────────────
 *  ШАЛГАРУУЛАХ with no prior close: one notification each — qualifiers
 *  get 'round_advanced' carrying their time, placement AND the
 *  advancement line; everyone else gets 'round_result'. Both markers are
 *  claimed, because advancement was announced in that same message.
 *
 *  ХААХ then ШАЛГАРУУЛАХ: the close sends 'round_result' to every
 *  finisher and claims RESULTS_MARKER only. The later advance sees that
 *  marker, sends no results, and instead sends a short 'round_advanced'
 *  to the QUALIFIERS ALONE — deliberately without time or placement,
 *  since they already received both and repeating them reads as a
 *  duplicate. Non-qualifiers get nothing the second time.
 *
 *  ── Idempotency ──────────────────────────────────────────────────────
 *  One transaction reads both markers, decides which of the two
 *  announcements is still owed, and writes those notifications AND their
 *  marker in a single atomic commit. So:
 *    * closing an already-closed round sends nothing,
 *    * re-running ШАЛГАРУУЛАХ once both markers are set sends nothing,
 *    * two concurrent calls cannot both win — the loser's transaction
 *      retries, re-reads the markers, and returns having written nothing,
 *    * a mid-way failure writes neither notifications nor marker, so the
 *      next transition can still send them.
 *  Markers are per (event, round), which is exactly the roundState doc's
 *  own granularity.
 */
export async function notifyRoundFinalised(params: {
  competitionId: string;
  eventId: string;
  round: number;
  /** Athletes advancing to the next round. Empty when the round was merely
   *  closed — closing deliberately computes no cut. */
  qualifiedUids?: string[];
}): Promise<void> {
  const { competitionId, eventId, round } = params;
  // Deduplicated, order preserved — the short advancement notices are
  // written in the order the qualifier list gives them.
  const qualifiedUids = [...new Set(params.qualifiedUids ?? [])];
  const qualified = new Set(qualifiedUids);

  try {
    const db = getOnlineCompAdminDb();
    const roundRef = db
      .collection('onlineCompetitions')
      .doc(competitionId)
      .collection('roundState')
      .doc(roundKey(eventId, round));

    // Cheap pre-check so the common "nothing owed" case costs one read
    // instead of a transaction plus a full ranking pass. The transaction
    // below re-reads both markers, and is what actually guarantees this.
    const pre = await roundRef.get();
    const preResults = !!pre.get(RESULTS_MARKER);
    const preAdvanced = !!pre.get(ADVANCED_MARKER);
    if (preResults && (preAdvanced || qualified.size === 0)) return;

    const compSnap = await db.collection('onlineCompetitions').doc(competitionId).get();
    const comp = compSnap.data();
    const competitionName = typeof comp?.name === 'string' ? comp.name : 'Тэмцээн';
    const label = eventName((comp?.events ?? []) as OnlineCompetitionEventConfig[], eventId);
    const roundLabel = `Раунд ${round}`;
    const contextLabel = competitionName.toUpperCase();

    // Only the results announcement needs the standings; the
    // advancement-only path notifies a known uid list and prints no
    // numbers, so it skips this entirely.
    const results = preResults ? [] : await collectRoundResults(db, competitionId, eventId, round);

    // Placement is the athlete's index in the FULL standings. It used to
    // be their index among result-havers only, because DNF-result athletes
    // had no placement to print. They do now — WCA ranks them below
    // everyone with a result, on their single — so every finisher gets a
    // number, and these indices still match the standings exactly because
    // nothing is filtered out of them.
    const placementByUid = new Map<string, number>();
    results.forEach((r, i) => placementByUid.set(r.uid, i + 1));

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(roundRef);
      const resultsDone = !!snap.get(RESULTS_MARKER);
      const advancedDone = !!snap.get(ADVANCED_MARKER);
      const announceAdvanced = !advancedDone && qualified.size > 0;
      const marker: Record<string, unknown> = {};

      if (!resultsDone && results.length > 0) {
        // ── Results announcement (both ШАЛГАРУУЛАХ-first and ХААХ) ──
        for (const r of results) {
          // A DNF result still has no TIME to print, but it does now have
          // a placement, so the old "байр эзлээгүй" (took no place) copy
          // would be wrong. Prints DNF in place of the time and the real
          // placement beside it.
          const body =
            r.value === null
              ? `${label} · ${roundLabel} дүн: DNF · ${placementByUid.get(r.uid)}-р байр`
              : `${label} · ${roundLabel} дүн: ${fmtCentiseconds(r.value)} · ${placementByUid.get(r.uid)}-р байр`;

          // Advancing folds into this message rather than adding a second
          // one — one notification per athlete when both are announced
          // together.
          const advanced = r.value !== null && announceAdvanced && qualified.has(r.uid);

          tx.create(db.collection(ONLINE_NOTIFICATIONS).doc(), {
            uid: r.uid,
            type: advanced ? 'round_advanced' : 'round_result',
            title: advanced ? `${body} — дараагийн раундад шалгарлаа` : body,
            contextLabel,
            href: DASHBOARD_HREF,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        marker[RESULTS_MARKER] = FieldValue.serverTimestamp();
        // Claimed only when advancement actually went out in these
        // messages; with no qualifiers it stays unclaimed so a later
        // ШАЛГАРУУЛАХ can still announce the cut.
        if (announceAdvanced) marker[ADVANCED_MARKER] = FieldValue.serverTimestamp();
      } else if (announceAdvanced) {
        // ── Advancement-only (ХААХ already sent the results) ─────────
        // Qualifiers alone, and no time or placement: they were in the
        // result notification this athlete already has.
        for (const uid of qualifiedUids) {
          tx.create(db.collection(ONLINE_NOTIFICATIONS).doc(), {
            uid,
            type: 'round_advanced',
            title: `${label} · ${roundLabel} — дараагийн раундад шалгарлаа`,
            contextLabel,
            href: DASHBOARD_HREF,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        marker[ADVANCED_MARKER] = FieldValue.serverTimestamp();
      }

      // Nothing owed, or nobody finished the round. In the latter case the
      // marker is deliberately NOT claimed: judging can continue after a
      // round is closed, so leaving it unmade lets a later transition
      // announce the results once they exist. Nothing was written, so
      // there is nothing to duplicate.
      if (Object.keys(marker).length === 0) return;
      tx.set(roundRef, marker, { merge: true });
    });
  } catch (err) {
    console.error(
      `[online-competition] round-finalised notification failed for ` +
        `${competitionId}/${eventId} round ${round} — the round transition itself is unaffected:`,
      err,
    );
  }
}
