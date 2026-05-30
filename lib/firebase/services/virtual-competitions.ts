import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  Timestamp,
  increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VirtualCompetition {
  id: string;
  name: string;
  date: string;
  location?: string;
  description?: string;
  imageUrl?: string;
  events: string[];
  status: 'draft' | 'published' | 'closed';
  createdAt: Timestamp;
  createdBy: string;
  publishedAt?: Timestamp;
  participantCount?: number;
}

export interface HistoricalResult {
  athleteName: string;
  country?: string;
  times: number[];
  penalties?: ('none' | '+2' | 'dnf')[];
  best: number;
  average: number;
  rank?: number;
}

export interface RoundGroup {
  name: string;          // "A", "B", "C"
  scrambles: string[];   // main solves (1–5)
  extraScrambles: string[];
}

export interface VirtualRound {
  id: string;
  eventId: string;
  roundNumber: number;
  roundName: string;
  scrambles: string[];
  format: 'avg5' | 'mo3' | 'bo1' | 'bo3';
  advancementType: 'fixed' | 'percentage' | 'final';
  advancementValue?: number;
  historicalResults: HistoricalResult[];
  groups?: RoundGroup[];
  createdAt: Timestamp;
}

export interface VirtualParticipant {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  registeredAt: Timestamp;
  registeredEvents: string[];
}

export interface ParticipantSolve {
  index: number;
  ms: number;
  penalty: 'none' | '+2' | 'dnf';
  scramble: string;
  completedAt: number;
}

export interface ParticipantRoundResult {
  uid: string;
  eventId: string;
  roundNumber: number;
  solves: ParticipantSolve[];
  best: number;
  average: number;
  rank?: number;
  advanced: boolean;
  completedAt: Timestamp;
}

// NOTE: Legacy results live at virtualCompetitions/{compId}/participantResults/{uid}_{eventId}_{roundNum}.
// New writes go to attempts/{attemptId}/results/{eventId}_{roundNum} AND the legacy location.
// Reads on the compete hub use the attempt subcollection; old data falls back to the legacy location.
export interface CompetitionAttempt {
  id: string;
  compId: string;
  uid: string;
  displayName: string;
  photoURL?: string | null;
  registeredEvents: string[];
  attemptNumber: number;
  startedAt: Timestamp;
  finishedAt?: Timestamp;
  status: 'in_progress' | 'finished';
}

export interface CombinedResult {
  type: 'historical' | 'participant';
  name: string;
  uid?: string;
  country?: string;
  times: number[];
  penalties?: string[];
  best: number;
  average: number;
  rank: number;
}

// ─── Collection/document refs ─────────────────────────────────────────────────

const competitionsCol = () => collection(db, 'virtualCompetitions');
const competitionDoc = (id: string) => doc(db, 'virtualCompetitions', id);
const roundsCol = (compId: string) =>
  collection(db, 'virtualCompetitions', compId, 'rounds');
const participantsCol = (compId: string) =>
  collection(db, 'virtualCompetitions', compId, 'participants');
const participantDoc = (compId: string, uid: string) =>
  doc(db, 'virtualCompetitions', compId, 'participants', uid);
const resultsCol = (compId: string) =>
  collection(db, 'virtualCompetitions', compId, 'participantResults');
const resultDoc = (compId: string, docId: string) =>
  doc(db, 'virtualCompetitions', compId, 'participantResults', docId);
const attemptsCol = (compId: string) =>
  collection(db, 'virtualCompetitions', compId, 'attempts');
const attemptDoc = (compId: string, attemptId: string) =>
  doc(db, 'virtualCompetitions', compId, 'attempts', attemptId);
const attemptResultsCol = (compId: string, attemptId: string) =>
  collection(db, 'virtualCompetitions', compId, 'attempts', attemptId, 'results');
const attemptResultDoc = (compId: string, attemptId: string, resultId: string) =>
  doc(db, 'virtualCompetitions', compId, 'attempts', attemptId, 'results', resultId);

// ─── Admin: competition CRUD ──────────────────────────────────────────────────

export async function createVirtualCompetition(
  data: Omit<VirtualCompetition, 'id' | 'createdAt' | 'createdBy' | 'status'>,
  adminUid: string,
): Promise<string> {
  try {
    const id = `vc_${Date.now().toString(36)}`;
    await setDoc(competitionDoc(id), {
      ...data,
      id,
      status: 'draft',
      createdAt: Timestamp.now(),
      createdBy: adminUid,
      participantCount: 0,
    } satisfies VirtualCompetition);
    return id;
  } catch (err) {
    console.error('[virtualCompetitions] createVirtualCompetition failed', err);
    throw err;
  }
}

export async function updateVirtualCompetition(
  compId: string,
  updates: Partial<VirtualCompetition>,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(competitionDoc(compId), updates as any);
  } catch (err) {
    console.error('[virtualCompetitions] updateVirtualCompetition failed', err);
    throw err;
  }
}

export async function deleteVirtualCompetition(compId: string): Promise<void> {
  try {
    await deleteDoc(competitionDoc(compId));
  } catch (err) {
    console.error('[virtualCompetitions] deleteVirtualCompetition failed', err);
    throw err;
  }
}

export async function publishVirtualCompetition(compId: string): Promise<void> {
  try {
    await updateDoc(competitionDoc(compId), {
      status: 'published',
      publishedAt: Timestamp.now(),
    });
  } catch (err) {
    console.error('[virtualCompetitions] publishVirtualCompetition failed', err);
    throw err;
  }
}

export async function closeVirtualCompetition(compId: string): Promise<void> {
  try {
    await updateDoc(competitionDoc(compId), { status: 'closed' });
  } catch (err) {
    console.error('[virtualCompetitions] closeVirtualCompetition failed', err);
    throw err;
  }
}

// ─── Admin: round management ──────────────────────────────────────────────────

export async function addRound(
  compId: string,
  round: Omit<VirtualRound, 'id' | 'createdAt'>,
): Promise<string> {
  try {
    const id = `${round.eventId}_${round.roundNumber}`;
    await setDoc(doc(roundsCol(compId), id), {
      ...round,
      id,
      createdAt: Timestamp.now(),
    } satisfies VirtualRound);
    return id;
  } catch (err) {
    console.error('[virtualCompetitions] addRound failed', err);
    throw err;
  }
}

export async function updateRound(
  compId: string,
  roundId: string,
  updates: Partial<VirtualRound>,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(doc(roundsCol(compId), roundId), updates as any);
  } catch (err) {
    console.error('[virtualCompetitions] updateRound failed', err);
    throw err;
  }
}

export async function deleteRound(compId: string, roundId: string): Promise<void> {
  try {
    await deleteDoc(doc(roundsCol(compId), roundId));
  } catch (err) {
    console.error('[virtualCompetitions] deleteRound failed', err);
    throw err;
  }
}

export async function importHistoricalResults(
  compId: string,
  roundId: string,
  results: HistoricalResult[],
): Promise<void> {
  try {
    await updateDoc(doc(roundsCol(compId), roundId), { historicalResults: results });
  } catch (err) {
    console.error('[virtualCompetitions] importHistoricalResults failed', err);
    throw err;
  }
}

// ─── Public read ──────────────────────────────────────────────────────────────

// NOTE: requires composite Firestore index — status (in) + date (desc)
export function subscribePublishedCompetitions(
  callback: (comps: VirtualCompetition[]) => void,
): () => void {
  const q = query(
    competitionsCol(),
    where('status', 'in', ['published', 'closed']),
    orderBy('date', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VirtualCompetition)),
    (err) => console.error('[virtualCompetitions] subscribePublishedCompetitions error', err),
  );
}

export function subscribeAllCompetitions(
  callback: (comps: VirtualCompetition[]) => void,
): () => void {
  const q = query(competitionsCol(), orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VirtualCompetition)),
    (err) => console.error('[virtualCompetitions] subscribeAllCompetitions error', err),
  );
}

export async function getCompetition(compId: string): Promise<VirtualCompetition | null> {
  try {
    const snap = await getDoc(competitionDoc(compId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as VirtualCompetition;
  } catch (err) {
    console.error('[virtualCompetitions] getCompetition failed', err);
    throw err;
  }
}

// NOTE: requires composite Firestore index — eventId (asc) + roundNumber (asc)
export async function getRounds(compId: string): Promise<VirtualRound[]> {
  try {
    const q = query(roundsCol(compId), orderBy('eventId'), orderBy('roundNumber'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VirtualRound);
  } catch (err) {
    console.error('[virtualCompetitions] getRounds failed', err);
    throw err;
  }
}

export async function getRound(compId: string, roundId: string): Promise<VirtualRound | null> {
  try {
    const snap = await getDoc(doc(roundsCol(compId), roundId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as VirtualRound;
  } catch (err) {
    console.error('[virtualCompetitions] getRound failed', err);
    throw err;
  }
}

// ─── Participant management ───────────────────────────────────────────────────

export async function registerForCompetition(
  compId: string,
  user: { uid: string; displayName: string; photoURL?: string | null },
  events: string[],
): Promise<void> {
  try {
    const pRef = participantDoc(compId, user.uid);
    const existing = await getDoc(pRef);
    const isNew = !existing.exists();

    await setDoc(pRef, {
      uid: user.uid,
      displayName: user.displayName,
      photoURL: user.photoURL ?? null,
      registeredAt: isNew ? Timestamp.now() : (existing.data() as VirtualParticipant).registeredAt,
      registeredEvents: events,
    } satisfies VirtualParticipant);

    if (isNew) {
      await updateDoc(competitionDoc(compId), { participantCount: increment(1) });
    }
  } catch (err) {
    console.error('[virtualCompetitions] registerForCompetition failed', err);
    throw err;
  }
}

export async function unregisterFromCompetition(compId: string, uid: string): Promise<void> {
  try {
    const pRef = participantDoc(compId, uid);
    const existing = await getDoc(pRef);
    if (!existing.exists()) return;
    await deleteDoc(pRef);
    await updateDoc(competitionDoc(compId), { participantCount: increment(-1) });
  } catch (err) {
    console.error('[virtualCompetitions] unregisterFromCompetition failed', err);
    throw err;
  }
}

export async function getParticipant(
  compId: string,
  uid: string,
): Promise<VirtualParticipant | null> {
  try {
    const snap = await getDoc(participantDoc(compId, uid));
    if (!snap.exists()) return null;
    return snap.data() as VirtualParticipant;
  } catch (err) {
    console.error('[virtualCompetitions] getParticipant failed', err);
    throw err;
  }
}

export function subscribeParticipants(
  compId: string,
  callback: (participants: VirtualParticipant[]) => void,
): () => void {
  return onSnapshot(
    participantsCol(compId),
    (snap) => callback(snap.docs.map((d) => d.data() as VirtualParticipant)),
    (err) => console.error('[virtualCompetitions] subscribeParticipants error', err),
  );
}

// ─── Result submission ────────────────────────────────────────────────────────

export async function submitRoundResult(
  compId: string,
  result: Omit<ParticipantRoundResult, 'rank' | 'advanced'>,
  attemptId?: string,
): Promise<void> {
  try {
    const { uid, eventId, roundNumber, solves } = result;
    const roundSnap = await getDoc(doc(roundsCol(compId), `${eventId}_${roundNumber}`));
    const round = roundSnap.data() as VirtualRound | undefined;
    const format: VirtualRound['format'] = round?.format ?? 'avg5';

    const best = computeBest(solves);
    const average = computeAverage(solves, format);

    // Compute advancement against historical results
    let advanced = false;
    if (round && round.advancementType !== 'final' && round.advancementValue != null) {
      const hist = round.historicalResults ?? [];
      const rank = computeRank({ best, average, format }, hist);
      const total = hist.length + 1;
      const threshold =
        round.advancementType === 'fixed'
          ? round.advancementValue
          : Math.floor((total * round.advancementValue) / 100);
      advanced = rank <= threshold;
    }

    const resultData: ParticipantRoundResult = {
      uid, eventId, roundNumber, solves, best, average, advanced,
      completedAt: Timestamp.now(),
    };

    // Always write to legacy location (backward compat + live leaderboard)
    const docId = `${uid}_${eventId}_${roundNumber}`;
    await setDoc(resultDoc(compId, docId), resultData);

    // Also write to attempt subcollection when attemptId is provided
    if (attemptId) {
      await setDoc(attemptResultDoc(compId, attemptId, `${eventId}_${roundNumber}`), resultData);
    }
  } catch (err) {
    console.error('[virtualCompetitions] submitRoundResult failed', err);
    throw err;
  }
}

export async function getMyResult(
  compId: string,
  uid: string,
  eventId: string,
  roundNumber: number,
): Promise<ParticipantRoundResult | null> {
  try {
    const snap = await getDoc(resultDoc(compId, `${uid}_${eventId}_${roundNumber}`));
    if (!snap.exists()) return null;
    return snap.data() as ParticipantRoundResult;
  } catch (err) {
    console.error('[virtualCompetitions] getMyResult failed', err);
    throw err;
  }
}

export async function getMyResults(
  compId: string,
  uid: string,
): Promise<ParticipantRoundResult[]> {
  try {
    const q = query(resultsCol(compId), where('uid', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ParticipantRoundResult);
  } catch (err) {
    console.error('[virtualCompetitions] getMyResults failed', err);
    throw err;
  }
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

// Combines historical results (from the round doc) with live participant results.
// Subscribes to three sources; any update triggers a re-merge and re-rank.
//
// NOTE: requires composite index on participantResults — eventId (asc) + roundNumber (asc)
export function subscribeRoundLeaderboard(
  compId: string,
  eventId: string,
  roundNumber: number,
  callback: (combined: CombinedResult[]) => void,
): () => void {
  let historicalResults: HistoricalResult[] = [];
  let participantResults: ParticipantRoundResult[] = [];
  let participantNames = new Map<string, string>();

  function buildAndEmit() {
    const eff = (v: number) => (v === -1 ? Infinity : v);

    const historical: CombinedResult[] = historicalResults.map((h) => ({
      type: 'historical',
      name: h.athleteName,
      country: h.country,
      times: h.times,
      penalties: h.penalties as string[] | undefined,
      best: h.best,
      average: h.average,
      rank: 0,
    }));

    const participant: CombinedResult[] = participantResults.map((p) => ({
      type: 'participant',
      name: participantNames.get(p.uid) ?? p.uid,
      uid: p.uid,
      times: p.solves.map((s) => s.ms),
      penalties: p.solves.map((s) => s.penalty),
      best: p.best,
      average: p.average,
      rank: 0,
    }));

    const combined = [...historical, ...participant];
    combined.sort((a, b) => {
      const da = eff(a.average) - eff(b.average);
      if (da !== 0) return da;
      return eff(a.best) - eff(b.best);
    });
    combined.forEach((r, i) => { r.rank = i + 1; });
    callback(combined);
  }

  const unsubRound = onSnapshot(
    doc(roundsCol(compId), `${eventId}_${roundNumber}`),
    (snap) => {
      historicalResults = (snap.data() as VirtualRound | undefined)?.historicalResults ?? [];
      buildAndEmit();
    },
    (err) => console.error('[virtualCompetitions] leaderboard round error', err),
  );

  const unsubParticipants = onSnapshot(
    participantsCol(compId),
    (snap) => {
      participantNames = new Map(
        snap.docs.map((d) => {
          const p = d.data() as VirtualParticipant;
          return [p.uid, p.displayName];
        }),
      );
      buildAndEmit();
    },
    (err) => console.error('[virtualCompetitions] leaderboard participants error', err),
  );

  const unsubResults = onSnapshot(
    query(
      resultsCol(compId),
      where('eventId', '==', eventId),
      where('roundNumber', '==', roundNumber),
    ),
    (snap) => {
      participantResults = snap.docs.map((d) => d.data() as ParticipantRoundResult);
      buildAndEmit();
    },
    (err) => console.error('[virtualCompetitions] leaderboard results error', err),
  );

  return () => {
    unsubRound();
    unsubParticipants();
    unsubResults();
  };
}

// ─── Helper functions ─────────────────────────────────────────────────────────

function effectiveMs(ms: number, penalty: 'none' | '+2' | 'dnf'): number {
  if (penalty === 'dnf') return Infinity;
  return penalty === '+2' ? ms + 2000 : ms;
}

export function computeBest(solves: ParticipantSolve[]): number {
  let best = Infinity;
  for (const s of solves) {
    const eff = effectiveMs(s.ms, s.penalty);
    if (eff < best) best = eff;
  }
  return best === Infinity ? -1 : best;
}

export function computeAverage(
  solves: ParticipantSolve[],
  format: 'avg5' | 'mo3' | 'bo1' | 'bo3',
): number {
  if (format === 'bo1') {
    if (solves.length === 0) return -1;
    const eff = effectiveMs(solves[0].ms, solves[0].penalty);
    return eff === Infinity ? -1 : eff;
  }

  if (format === 'bo3') {
    return computeBest(solves);
  }

  if (format === 'mo3') {
    if (solves.length < 3) return -1;
    const effs = solves.slice(0, 3).map((s) => effectiveMs(s.ms, s.penalty));
    if (effs.some((v) => v === Infinity)) return -1;
    return Math.round(effs.reduce((a, b) => a + b, 0) / 3);
  }

  // avg5
  if (solves.length < 5) return -1;
  const effs = solves.slice(0, 5).map((s) => effectiveMs(s.ms, s.penalty));
  const dnfs = effs.filter((v) => v === Infinity).length;
  if (dnfs >= 2) return -1;
  const sorted = [...effs].sort((a, b) => a - b);
  const middle = sorted.slice(1, 4);
  return Math.round(middle.reduce((a, b) => a + b, 0) / 3);
}

// ─── Attempt management ───────────────────────────────────────────────────────

export async function createAttempt(
  compId: string,
  user: { uid: string; displayName: string; photoURL?: string | null },
  events: string[],
): Promise<string> {
  try {
    const existingSnap = await getDocs(
      query(attemptsCol(compId), where('uid', '==', user.uid)),
    );
    const attemptNumber = existingSnap.size + 1;
    const attemptId = `${user.uid}_${compId}_${Date.now().toString(36)}`;
    await setDoc(attemptDoc(compId, attemptId), {
      id: attemptId,
      compId,
      uid: user.uid,
      displayName: user.displayName,
      photoURL: user.photoURL ?? null,
      registeredEvents: events,
      attemptNumber,
      startedAt: Timestamp.now(),
      status: 'in_progress',
    } satisfies CompetitionAttempt);
    return attemptId;
  } catch (err) {
    console.error('[virtualCompetitions] createAttempt failed', err);
    throw err;
  }
}

export async function getActiveAttempt(
  compId: string,
  uid: string,
): Promise<CompetitionAttempt | null> {
  try {
    const q = query(
      attemptsCol(compId),
      where('uid', '==', uid),
      where('status', '==', 'in_progress'),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as CompetitionAttempt;
  } catch (err) {
    console.error('[virtualCompetitions] getActiveAttempt failed', err);
    throw err;
  }
}

export async function getMyAttempts(
  compId: string,
  uid: string,
): Promise<CompetitionAttempt[]> {
  try {
    const q = query(attemptsCol(compId), where('uid', '==', uid));
    const snap = await getDocs(q);
    const attempts = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CompetitionAttempt));
    return attempts.sort((a, b) => b.startedAt.toMillis() - a.startedAt.toMillis());
  } catch (err) {
    console.error('[virtualCompetitions] getMyAttempts failed', err);
    throw err;
  }
}

// Queries across all competitions using collection group.
// Requires Firestore to allow collectionGroup('attempts') queries (configure in console if needed).
export async function getAllMyAttempts(
  uid: string,
): Promise<{ comp: VirtualCompetition; attempt: CompetitionAttempt }[]> {
  try {
    // Get all published/closed competitions, then fetch attempts per competition
    const compsSnap = await getDocs(
      query(competitionsCol(), where('status', 'in', ['published', 'closed'])),
    );
    const comps = compsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as VirtualCompetition));

    const results: { comp: VirtualCompetition; attempt: CompetitionAttempt }[] = [];
    await Promise.all(
      comps.map(async (comp) => {
        const snap = await getDocs(
          query(attemptsCol(comp.id), where('uid', '==', uid)),
        );
        for (const d of snap.docs) {
          results.push({ comp, attempt: { id: d.id, ...d.data() } as CompetitionAttempt });
        }
      }),
    );

    return results.sort(
      (a, b) => b.attempt.startedAt.toMillis() - a.attempt.startedAt.toMillis(),
    );
  } catch (err) {
    console.error('[virtualCompetitions] getAllMyAttempts failed', err);
    throw err;
  }
}

export async function getAttemptById(
  compId: string,
  attemptId: string,
): Promise<CompetitionAttempt | null> {
  try {
    const snap = await getDoc(attemptDoc(compId, attemptId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as CompetitionAttempt;
  } catch (err) {
    console.error('[virtualCompetitions] getAttemptById failed', err);
    throw err;
  }
}

export async function finishAttempt(compId: string, attemptId: string): Promise<void> {
  try {
    await updateDoc(attemptDoc(compId, attemptId), {
      status: 'finished',
      finishedAt: Timestamp.now(),
    });
  } catch (err) {
    console.error('[virtualCompetitions] finishAttempt failed', err);
    throw err;
  }
}

export async function canFinishAttempt(
  compId: string,
  attemptId: string,
): Promise<{ canFinish: boolean; missing: { eventId: string; roundNumber: number; roundName: string }[] }> {
  try {
    const [attemptSnap, allRounds, resultsSnap] = await Promise.all([
      getDoc(attemptDoc(compId, attemptId)),
      getRounds(compId),
      getDocs(attemptResultsCol(compId, attemptId)),
    ]);

    if (!attemptSnap.exists()) return { canFinish: false, missing: [] };
    const attempt = { id: attemptSnap.id, ...attemptSnap.data() } as CompetitionAttempt;
    const resultMap = new Map(
      resultsSnap.docs.map((d) => {
        const r = d.data() as ParticipantRoundResult;
        return [`${r.eventId}_${r.roundNumber}`, r];
      }),
    );

    const missing: { eventId: string; roundNumber: number; roundName: string }[] = [];

    for (const eventId of attempt.registeredEvents) {
      const eventRounds = allRounds
        .filter((r) => r.eventId === eventId)
        .sort((a, b) => a.roundNumber - b.roundNumber);

      for (const round of eventRounds) {
        const result = resultMap.get(`${eventId}_${round.roundNumber}`);
        if (!result) {
          missing.push({ eventId, roundNumber: round.roundNumber, roundName: round.roundName });
          break;
        }
        if (round.advancementType === 'final') break;
        if (!result.advanced) break;
      }
    }

    return { canFinish: missing.length === 0, missing };
  } catch (err) {
    console.error('[virtualCompetitions] canFinishAttempt failed', err);
    throw err;
  }
}

export async function getMyResultsForAttempt(
  compId: string,
  attemptId: string,
): Promise<ParticipantRoundResult[]> {
  try {
    const snap = await getDocs(attemptResultsCol(compId, attemptId));
    return snap.docs.map((d) => d.data() as ParticipantRoundResult);
  } catch (err) {
    console.error('[virtualCompetitions] getMyResultsForAttempt failed', err);
    throw err;
  }
}

export async function getMyResultForAttempt(
  compId: string,
  attemptId: string,
  eventId: string,
  roundNumber: number,
): Promise<ParticipantRoundResult | null> {
  try {
    const snap = await getDoc(attemptResultDoc(compId, attemptId, `${eventId}_${roundNumber}`));
    if (!snap.exists()) return null;
    return snap.data() as ParticipantRoundResult;
  } catch (err) {
    console.error('[virtualCompetitions] getMyResultForAttempt failed', err);
    throw err;
  }
}

export function computeRank(
  result: { best: number; average: number; format: string },
  allResults: { best: number; average: number }[],
): number {
  const eff = (v: number) => (v === -1 ? Infinity : v);
  const myAvg = eff(result.average);
  const myBest = eff(result.best);

  let rank = 1;
  for (const r of allResults) {
    const rAvg = eff(r.average);
    const rBest = eff(r.best);
    if (rAvg < myAvg || (rAvg === myAvg && rBest < myBest)) {
      rank++;
    }
  }
  return rank;
}
