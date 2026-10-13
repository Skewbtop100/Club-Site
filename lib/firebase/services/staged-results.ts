import {
  getDoc,
  onSnapshot,
  query,
  where,
  runTransaction,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { competitionPrivateCol, competitionStagedResultsDoc, resultDoc } from '@/lib/firebase/collections';
import { getResultsByComp } from '@/lib/firebase/services/results';
import { buildStagedEvent, planStagedSync, type StagedEvent, type StagedSyncPlan } from '@/lib/staged-reveal';
import type { ParsedResultRound } from '@/lib/results-import';
import type { Athlete, Competition, Result } from '@/lib/types';

// Staged import of a past competition's results —
// competitions/{id}/private/importedResults_{eventId}, admin-only
// (firestore.rules). Rows sit there unseen and are revealed gradually as
// ordinary public imported results; the rules of that are in
// lib/staged-reveal.ts, this file only reads and writes. Admin screens only.

const KIND = 'importedResults';

/** Real-time subscription to every event's staged rows of a competition,
 *  keyed by eventId. */
export function subscribeStagedEvents(
  compId: string,
  onData: (events: Record<string, StagedEvent>) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    query(competitionPrivateCol(compId), where('kind', '==', KIND)),
    (snap) => {
      const events: Record<string, StagedEvent> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as StagedEvent;
        if (data.eventId) events[data.eventId] = { eventId: data.eventId, rounds: data.rounds || {} };
      });
      onData(events);
    },
    (err) => onError?.(err),
  );
}

/** Club athletes registered for this competition (any event) — the pool an
 *  imported name is matched against. */
function competitionClubAthletes(comp: Competition, athletes: Athlete[]): Athlete[] {
  const ids = new Set((comp.athletes || []).map(a => a.id));
  return athletes.filter(a => ids.has(a.id));
}

/**
 * Bring one event's staged rows in line with the competition as it stands:
 * mark eliminations, reveal whatever the current state calls for. Safe to
 * call at any time and as often as you like — see planStagedSync. Returns
 * null when the event has no staged import (nothing read beyond that one
 * document).
 *
 * `results` should be the competition's current result documents; leave it
 * out to have them fetched. `comp` must carry the roundStatus you want
 * applied (pass the updated one right after changing it).
 */
export async function syncStagedEvent(opts: {
  comp: Competition;
  eventId: string;
  results?: Result[];
  forceRounds?: number[];
}): Promise<StagedSyncPlan | null> {
  const { comp, eventId } = opts;
  const ref = competitionStagedResultsDoc(comp.id, eventId);
  // Always the stored copy, never a subscription's: the flags written below
  // replace the document, so they must be computed from what is really there.
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const staged: StagedEvent = { eventId, rounds: (snap.data().rounds as StagedEvent['rounds']) || {} };

  const plan = planStagedSync({
    comp, eventId, staged,
    results: opts.results ?? await getResultsByComp(comp.id),
    advancement: comp.eventConfig?.[eventId]?.advancement,
    roundStatus: comp.roundStatus,
    registeredClubIds: (comp.athletes || []).filter(a => a.events.includes(eventId)).map(a => a.id),
    forceRounds: opts.forceRounds,
  });
  if (!plan.changed && plan.reveals.length === 0) return plan;

  // Result documents first, in batches under Firestore's 500-write limit; the
  // flags go out with the last batch. If an earlier batch lands and a later
  // one fails, the next sync sees those documents and treats their rows as
  // revealed — the deterministic ids make the retry overwrite, not duplicate.
  const now = Timestamp.now();
  const CHUNK = 400;
  for (let i = 0; i === 0 || i < plan.reveals.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const result of plan.reveals.slice(i, i + CHUNK)) {
      batch.set(resultDoc(result.id), { ...result, submittedAt: now } as Result);
    }
    if (i + CHUNK >= plan.reveals.length) {
      batch.set(ref, { kind: KIND, eventId, rounds: plan.staged.rounds, updatedAt: now });
    }
    await batch.commit();
  }
  return plan;
}

/**
 * Stage freshly parsed rounds of one event, then sync. Re-importing replaces
 * only the unrevealed rows of the rounds present in `parsed`; revealed rows
 * and other rounds are untouched (buildStagedEvent). The sync that follows
 * is what reveals everything at once when no club athlete is expected.
 */
export async function saveStagedImport(
  comp: Competition,
  eventId: string,
  parsed: ParsedResultRound[],
  athletes: Athlete[],
): Promise<StagedSyncPlan | null> {
  const ref = competitionStagedResultsDoc(comp.id, eventId);
  const clubAthletes = competitionClubAthletes(comp, athletes);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists()
      ? { eventId, rounds: (snap.data().rounds as StagedEvent['rounds']) || {} }
      : undefined;
    const next = buildStagedEvent(existing, eventId, parsed, clubAthletes);
    tx.set(ref, { kind: KIND, eventId, rounds: next.rounds, updatedAt: Timestamp.now() });
  });
  return syncStagedEvent({ comp, eventId });
}
