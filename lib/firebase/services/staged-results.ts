import {
  onSnapshot,
  query,
  where,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { competitionPrivateCol, competitionStagedResultsDoc } from '@/lib/firebase/collections';
import { buildStagedEvent, type StagedEvent } from '@/lib/staged-reveal';
import type { ParsedResultRound } from '@/lib/results-import';
import type { Athlete, Competition } from '@/lib/types';

// Staged import of a past competition's results —
// competitions/{id}/private/importedResults_{eventId}, admin-only
// (firestore.rules). Rows sit there unseen and are revealed gradually as
// ordinary public imported results.
//
// Staging (the admin's paste) is written from here. The REVEAL is not: it
// runs on the server (app/api/staged/sync → lib/server/staged-sync.ts), so
// that judges, who trigger it with every club result they save, never need
// to read or write the staged rows.

const KIND = 'importedResults';

/** Real-time subscription to every event's staged rows of a competition,
 *  keyed by eventId. Admin only — the rules refuse anyone else. */
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

export interface StagedSyncOutcome {
  /** Whether the event has a staged import at all (admins only — a judge is
   *  told nothing about the import and always gets `false`/0 here). */
  staged: boolean;
  /** Rows revealed by this call. */
  revealed: number;
}

/**
 * Ask the server to bring one event's staged rows in line with the
 * competition as it stands: mark eliminations, reveal whatever the current
 * state calls for. Safe to call at any time and as often as you like, as an
 * admin or as a judge of that competition; a no-op for events without a
 * staged import. `forceRounds` ("reveal all now") is honoured for admins only.
 */
export async function syncStagedEvent(
  competitionId: string, eventId: string, forceRounds?: number[],
): Promise<StagedSyncOutcome> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const res = await fetch('/api/staged/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ competitionId, eventId, ...(forceRounds?.length ? { forceRounds } : {}) }),
  });
  const body = await res.json().catch(() => ({})) as { staged?: boolean; revealed?: number; error?: string; detail?: string };
  if (!res.ok) throw new Error(body.detail || body.error || `staged sync failed (${res.status})`);
  return { staged: !!body.staged, revealed: body.revealed ?? 0 };
}

/**
 * Stage freshly parsed rounds of one event (admin), then sync. Re-importing
 * replaces only the unrevealed rows of the rounds present in `parsed`;
 * revealed rows and other rounds are untouched (buildStagedEvent). The sync
 * that follows is what reveals everything at once when no club athlete is
 * expected.
 */
export async function saveStagedImport(
  comp: Competition,
  eventId: string,
  parsed: ParsedResultRound[],
  athletes: Athlete[],
): Promise<StagedSyncOutcome> {
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
  return syncStagedEvent(comp.id, eventId);
}
