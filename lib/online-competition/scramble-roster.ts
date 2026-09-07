import type { Firestore } from 'firebase-admin/firestore';

/** One registered athlete, with everything the group-assignment UI and the
 *  auto-seeder need: which events they signed up for, when they registered
 *  (the seeding tiebreaker), and their per-event best single. */
export interface ScrambleRosterAthlete {
  uid: string;
  displayName: string;
  events: string[];
  /** epoch ms; null on older registration docs written before the field
   *  existed — treated as "registered last" by the seeder. */
  registeredAt: number | null;
  /** eventId -> best single in centiseconds, or null when the athlete has
   *  no approved result for that event yet. */
  prByEvent: Record<string, number | null>;
}

/** Registered athletes for one competition, joined against their
 *  onlineParticipants profile for displayName + stats.
 *
 *  Uses the same `collectionGroup('registrations')` + grandparent filter as
 *  GET /admin-competitions/[id]/registrations — see the long comment there
 *  for why the grandparent check is load-bearing (this database has an
 *  unrelated top-level `registrations` collection that the same query
 *  otherwise pulls in). */
export async function fetchScrambleRoster(
  db: Firestore,
  competitionId: string,
): Promise<ScrambleRosterAthlete[]> {
  const snap = await db.collectionGroup('registrations').get();
  const matches = snap.docs.filter(
    (d) => d.ref.parent.parent?.parent.id === 'onlineParticipants' && d.data().competitionId === competitionId,
  );
  if (matches.length === 0) return [];

  const uids = [...new Set(matches.map((d) => d.ref.parent.parent!.id))];
  const participantDocs = await db.getAll(
    ...uids.map((uid) => db.collection('onlineParticipants').doc(uid)),
  );
  const profileByUid = new Map(participantDocs.map((d) => [d.id, d.data() ?? {}]));

  const athletes: ScrambleRosterAthlete[] = matches.map((d) => {
    const uid = d.ref.parent.parent!.id;
    const data = d.data();
    const profile = profileByUid.get(uid) ?? {};
    const stats = (profile.stats ?? {}) as Record<string, { pr?: number | null } | undefined>;
    const prByEvent: Record<string, number | null> = {};
    for (const [eventId, rollup] of Object.entries(stats)) {
      prByEvent[eventId] = typeof rollup?.pr === 'number' ? rollup.pr : null;
    }
    return {
      uid,
      displayName: (profile.displayName as string | undefined) || uid.slice(0, 10),
      events: Array.isArray(data.events) ? data.events.filter((e: unknown) => typeof e === 'string') : [],
      registeredAt: data.registeredAt?.toMillis?.() ?? null,
      prByEvent,
    };
  });

  // Registration order — the seeder's tiebreaker and the order unranked
  // athletes are distributed in. Nulls last, uid as the final tiebreaker so
  // the whole pipeline is deterministic.
  athletes.sort(
    (a, b) =>
      (a.registeredAt ?? Number.MAX_SAFE_INTEGER) - (b.registeredAt ?? Number.MAX_SAFE_INTEGER) ||
      a.uid.localeCompare(b.uid),
  );
  return athletes;
}
