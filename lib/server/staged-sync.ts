// Server side of the staged-import reveal (see lib/staged-reveal.ts for the
// rules). Runs with the Admin SDK from app/api/staged/sync so that judges —
// who trigger a reveal every time they save a club result — need no access
// at all to the staged documents: they hold every imported result that has
// NOT been revealed yet.
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { planStagedSync, type StagedEvent, type RoundResultLite } from '../staged-reveal';
import type { AdvancementConfig, CompetitionAthlete } from '../types';

const KIND = 'importedResults';

/**
 * Bring one event's staged rows in line with the competition as it stands
 * now and write whatever that reveals. Everything is read fresh here —
 * nothing the caller says about results or round status is trusted.
 * Idempotent; safe to call concurrently (deterministic result ids).
 * Returns null when the event has no staged import.
 */
export async function runStagedSync(
  competitionId: string, eventId: string, forceRounds: number[] = [],
): Promise<{ revealed: number } | null> {
  const db = adminDb();
  const stagedRef = db.doc(`competitions/${competitionId}/private/importedResults_${eventId}`);
  const stagedSnap = await stagedRef.get();
  if (!stagedSnap.exists) return null;

  const [compSnap, resultsSnap] = await Promise.all([
    db.doc(`competitions/${competitionId}`).get(),
    db.collection('results').where('competitionId', '==', competitionId).where('eventId', '==', eventId).get(),
  ]);
  if (!compSnap.exists) return null;
  const comp = compSnap.data() || {};
  const staged: StagedEvent = { eventId, rounds: (stagedSnap.get('rounds') as StagedEvent['rounds']) || {} };
  const results = resultsSnap.docs.map(d => ({ ...d.data(), id: d.id }) as RoundResultLite);

  const plan = planStagedSync({
    comp: { id: competitionId, name: comp.name as string | undefined },
    eventId, staged, results,
    advancement: comp.eventConfig?.[eventId]?.advancement as Record<string, AdvancementConfig> | undefined,
    roundStatus: comp.roundStatus as Record<string, string> | undefined,
    registeredClubIds: ((comp.athletes || []) as CompetitionAthlete[]).filter(a => a.events?.includes(eventId)).map(a => a.id),
    forceRounds,
  });
  if (!plan.changed && plan.reveals.length === 0) return { revealed: 0 };

  // Result documents first, in batches under Firestore's 500-write limit; the
  // flags go out with the last batch. If an earlier batch lands and a later
  // one fails, the next sync sees those documents and treats their rows as
  // revealed — the deterministic ids make a retry overwrite, not duplicate.
  const now = Timestamp.now();
  const CHUNK = 400;
  for (let i = 0; i === 0 || i < plan.reveals.length; i += CHUNK) {
    const batch = db.batch();
    for (const { id, ...result } of plan.reveals.slice(i, i + CHUNK)) {
      batch.set(db.doc(`results/${id}`), { ...result, submittedAt: now });
    }
    if (i + CHUNK >= plan.reveals.length) {
      batch.set(stagedRef, { kind: KIND, eventId, rounds: plan.staged.rounds, updatedAt: now });
    }
    await batch.commit();
  }
  return { revealed: plan.reveals.length };
}
