import { NextResponse } from 'next/server';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { isCompetingRegistration } from '@/lib/online-competition/registration-shape';
import { normalizeStoredEvents } from '@/lib/online-competition/competition-shape';
import { normalizeCompetitionStatus } from '@/lib/online-competition/admin-competitions';
import { resolveResultFormat, type ResultFormat } from '@/lib/online-competition/ao5';
import { toRosterAthlete, type RosterAthlete } from '@/lib/online-competition/roster-view';

// ── The public athlete roster ───────────────────────────────────────────
// GET /api/online-competition/competitions/{id}/roster
//
// PUBLIC, no auth — and it has to be a route rather than a client read,
// because neither half of what it joins is publicly readable:
//   onlineParticipants/{uid}          read: if isSignedIn()
//   onlineParticipants/{uid}/registrations/{id}  read: OWNER ONLY
// and Firestore rules cannot project fields, so "let anyone read
// registrations" would publish the free-text `note` whose placeholder asks
// for a contact phone number. The Admin SDK reads both and this file
// decides, field by field, what crosses the boundary.
//
// WHAT IT RANKS BY: each athlete's LIFETIME personal best, from the
// onlineParticipants stats rollup. NOT results in this competition —
// nothing here reads onlineSubmissions or round-results, which is why the
// tab means something before the competition has started.

/** The whole response. Everything per-athlete is built by toRosterAthlete
 *  (roster-view.ts), whose returned keys are asserted by its unit test. */
export interface CompetitionRoster {
  competitionId: string;
  /** The competition's configured events, in configured order — the
   *  filter buttons, and nothing beyond them. */
  events: { eventId: string; label: string; format: ResultFormat }[];
  athletes: RosterAthlete[];
  /** Approved registrations. What the ТАМИРЧИН cell has been showing as
   *  "—" since the beginning, because it was not publicly readable. */
  approvedCount: number;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getOnlineCompAdminDb();

  const compSnap = await db.collection('onlineCompetitions').doc(id).get();
  if (!compSnap.exists) {
    return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404 });
  }
  // A draft is unannounced and is not publicly readable anywhere else
  // (fetchAllCompetitions filters it out, firestore.rules denies it); its
  // roster must not be the one public thing about it.
  if (normalizeCompetitionStatus(compSnap.get('status')) === 'draft') {
    return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404 });
  }

  const events = normalizeStoredEvents(compSnap.get('events')).map((e) => ({
    eventId: e.eventId,
    label: e.label,
    format: resolveResultFormat(e.resultFormat),
  }));
  const formatByEvent: Record<string, ResultFormat> = {};
  for (const e of events) formatByEvent[e.eventId] = e.format;
  const eventIds = new Set(events.map((e) => e.eventId));

  // The same unfiltered collection-group read every other caller uses. A
  // filtered one needs a COLLECTION_GROUP index this project does not have
  // — see countRegistrationsFor in admin-competitions.ts, which took the
  // editor down in production by assuming otherwise.
  const snap = await db.collectionGroup('registrations').get();
  const matches = snap.docs.filter(
    (d) =>
      // Only documents under onlineParticipants: this database has an
      // unrelated top-level `registrations` collection.
      d.ref.parent.parent?.parent.id === 'onlineParticipants' &&
      d.data().competitionId === id &&
      // APPROVED ONLY (D7). A pending registration may still be refused,
      // and publishing it announces an entry that may not happen.
      isCompetingRegistration(d.data().status),
  );

  const uids = [...new Set(matches.map((d) => d.ref.parent.parent!.id))];
  const profiles =
    uids.length > 0
      ? await db.getAll(...uids.map((uid) => db.collection('onlineParticipants').doc(uid)))
      : [];
  const profileByUid = new Map(profiles.map((p) => [p.id, (p.data() ?? {}) as Record<string, unknown>]));

  const athletes: RosterAthlete[] = matches.map((d) => {
    const uid = d.ref.parent.parent!.id;
    const registered = Array.isArray(d.data().events)
      ? (d.data().events as unknown[]).filter((e): e is string => typeof e === 'string')
      : [];
    return toRosterAthlete({
      uid,
      profile: profileByUid.get(uid) ?? {},
      // Only events this competition actually configures: a stale event id
      // left on a registration is not part of this roster.
      events: registered.filter((e) => eventIds.has(e)),
      formatByEvent,
    });
  });

  const payload: CompetitionRoster = {
    competitionId: id,
    events,
    athletes,
    approvedCount: athletes.length,
  };

  // Cached at the edge, not in the browser. `s-maxage=60` because the
  // inputs move slowly — an approval is an admin action and a personal
  // best changes only when the points recompute runs — while
  // `stale-while-revalidate` keeps a newly approved athlete from waiting a
  // full minute behind a cold cache. No `max-age`, so an athlete who
  // reloads after being approved sees themselves rather than their own
  // browser's copy.
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
