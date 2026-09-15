import type { Firestore } from 'firebase-admin/firestore';
import { normalizeStoredEvents } from './competition-shape';
import { lookupGroupScramble } from './group-scramble';
import { competeGateCopy } from './registration-view';
import { normalizeRegistrationStatus } from './registration-shape';
import { ROUND_ACCESS_MESSAGE, resolveRoundAccess } from './round-access';
import { planResume, runShapeFor, type FiledAttempt, type ResumePlan } from './run-resume';
import type { OnlineRegistrationStatus } from './types';

// ── Who may be given a scramble, and for which attempt ──────────────────
// Server-only. Everything the scramble route decides lives here, so it can
// be exercised against the emulator (tests/competition-fields/
// scramble-gate.test.cjs) without the Next route around it. The pure
// decisions are unit-tested on their own (scramble-gate-decisions.test.cjs).
//
// THE GATE, in order — every step fails closed:
//   1. REGISTRATION. Approved, and for this event. Read with the Admin SDK
//      from onlineParticipants/{uid}/registrations/{competitionId}. A read
//      that throws is NOT caught here: the route turns it into a 500 and
//      serves nothing.
//   2. ROUND ACCESS. resolveRoundAccess — the live round, and for round 2+
//      the previous round's qualifier list.
//   3. THE ATTEMPT. Derived from what the athlete has already FILED, with
//      planResume — the same function the solve page resumes a run with.
//      The client's `attempt` parameter never chooses a scramble; see
//      decideScrambleAttempt for the one thing it is still used for.
//   4. THE SCRAMBLE for that attempt (official group, or random).
// Then the route records a RUN TICKET (recordScrambleServed) — the only
// thing firestore.rules consults when a submission is created.

// ── Run tickets ──────────────────────────────────────────────────────────
// onlineCompetitions/{cid}/runTickets/{uid}__{event}__r{round}
//   { uid, eventId, competitionRound, servedThrough, updatedAt }
// Written ONLY here, with the Admin SDK; denied to every client. A
// submission may be created only for a (uid, event, round) with a ticket,
// and only for an attempt <= servedThrough — so its competitionRound is
// one the gate admitted this athlete to, and its attempt is one whose
// scramble the gate actually served.
//
// The id format is repeated in firestore.rules (runTicketOk), which cannot
// import it; the rules test pins the two together.
export const RUN_TICKETS = 'runTickets';

export function runTicketId(uid: string, eventId: string, round: number): string {
  return `${uid}__${eventId}__r${round}`;
}

// ── Pure decisions ───────────────────────────────────────────────────────

export type RegistrationGate =
  | { ok: true }
  | { ok: false; error: 'not-registered' | 'event-not-registered' | 'registration-not-approved'; message: string };

/** Approved, and for this event — or why not. `registration` is null when
 *  the document does not exist. The status is normalised first, so the
 *  legacy stored 'registered' counts as approved, exactly as everywhere
 *  else (registration-shape.ts). */
export function registrationGate(
  registration: { status: unknown; events: unknown } | null,
  eventId: string,
): RegistrationGate {
  if (!registration) {
    return { ok: false, error: 'not-registered', message: 'Та энэ тэмцээнд бүртгүүлээгүй байна.' };
  }
  const status: OnlineRegistrationStatus = normalizeRegistrationStatus(registration.status);
  const gate = competeGateCopy(status);
  if (gate) return { ok: false, error: 'registration-not-approved', message: gate.message };
  const events = Array.isArray(registration.events) ? registration.events : [];
  if (!events.includes(eventId)) {
    return { ok: false, error: 'event-not-registered', message: 'Та энэ төрөлд бүртгүүлээгүй байна.' };
  }
  return { ok: true };
}

export type AttemptDecision =
  | { kind: 'serve'; attempt: number }
  /** The client is one attempt ahead: it asked for N+1 while attempt N is
   *  still uploading (the solve page fetches the next scramble as soon as
   *  an attempt is QUEUED for filing). Wait for N to land, then decide
   *  again. */
  | { kind: 'wait'; attempt: number }
  | { kind: 'refuse'; error: 'run-complete' | 'no-live-round' | 'attempt-mismatch'; nextAttempt: number };

/** Which attempt's scramble may be served, from the athlete's own filings.
 *
 *  THE ATTEMPT IS plan.nextAttempt AND NOTHING ELSE. `requested` (the
 *  client's `attempt` parameter) can never select a different scramble:
 *    · absent, or equal to the next attempt -> serve the next attempt;
 *    · exactly one ahead                     -> wait for the filing;
 *    · anything else                         -> refuse, serve nothing.
 *  It is still read because serving attempt N to a client that believes it
 *  is starting N+1 would show the athlete a scramble they already solved. */
export function decideScrambleAttempt(plan: ResumePlan, requested: number | null): AttemptDecision {
  if (plan.kind === 'no-live-round') return { kind: 'refuse', error: 'no-live-round', nextAttempt: plan.nextAttempt };
  if (plan.kind === 'complete') return { kind: 'refuse', error: 'run-complete', nextAttempt: plan.nextAttempt };
  const next = plan.nextAttempt;
  if (requested === null || requested === next) return { kind: 'serve', attempt: next };
  if (requested === next + 1) return { kind: 'wait', attempt: requested };
  return { kind: 'refuse', error: 'attempt-mismatch', nextAttempt: next };
}

/** The `attempt` query parameter: a positive integer, or null. */
export function parseRequestedAttempt(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : NaN;
}

// ── The gate ─────────────────────────────────────────────────────────────

export type ScrambleGateResult =
  | {
      ok: true;
      round: number;
      attempt: number;
      /** null: this round has no official scrambles (or the lookup threw) —
       *  the route generates a random one. */
      official: { scramble: string; groupLabel: string } | null;
    }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409;
      error: string;
      /** Mongolian, for the athlete. Always present: the solve page shows
       *  a refusal's message in place of the run. */
      message: string;
      liveRound?: number | null;
      nextAttempt?: number;
    };

export interface ScrambleGateDeps {
  /** How long to wait for the previous attempt's filing to land. */
  waitForFilingMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MESSAGES = {
  'run-complete': 'Энэ раундын бүх оролдлого хадгалагдсан байна.',
  'attempt-mismatch': 'Оролдлогын дугаар таарахгүй байна. Хуудсаа сэргээнэ үү.',
  'previous-attempt-unfiled':
    'Өмнөх оролдлого хадгалагдаж дуусаагүй байна. Хадгалагдсаны дараа «Дахин оролдох» дарна уу.',
  'event-not-configured': 'Энэ төрөл тэмцээнд байхгүй байна.',
  'bad-attempt': 'Оролдлогын дугаар буруу байна.',
} as const;

/** Every attempt this athlete has filed for the competition and event, any
 *  status, across rounds — the same set the solve page resumes from
 *  (fetchMyFiledAttempts), read with the same single-field query. */
export async function fetchFiledAttempts(
  db: Firestore,
  uid: string,
  competitionId: string,
  eventId: string,
): Promise<FiledAttempt[]> {
  const snap = await db.collection('onlineSubmissions').where('uid', '==', uid).get();
  const out: FiledAttempt[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.competitionId !== competitionId || data.event !== eventId) continue;
    if (typeof data.round !== 'number' || typeof data.competitionRound !== 'number') continue;
    out.push({
      submissionId: d.id,
      attempt: data.round,
      competitionRound: data.competitionRound,
      reportedTime: typeof data.reportedTime === 'number' ? data.reportedTime : 0,
      isDnf: data.isDnf === true,
    });
  }
  return out;
}

export async function authorizeScrambleRequest(
  db: Firestore,
  input: { competitionId: string; eventId: string; uid: string; requestedAttempt: number | null },
  deps: ScrambleGateDeps = {},
): Promise<ScrambleGateResult> {
  const { competitionId, eventId, uid, requestedAttempt } = input;
  const waitForFilingMs = deps.waitForFilingMs ?? 15_000;
  const pollMs = deps.pollMs ?? 1_000;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  if (Number.isNaN(requestedAttempt)) {
    return { ok: false, status: 400, error: 'bad-attempt', message: MESSAGES['bad-attempt'] };
  }

  // 1. REGISTRATION. Not caught: a failed read must refuse, never admit.
  const regSnap = await db
    .collection('onlineParticipants')
    .doc(uid)
    .collection('registrations')
    .doc(competitionId)
    .get();
  const gate = registrationGate(
    regSnap.exists ? { status: regSnap.get('status'), events: regSnap.get('events') } : null,
    eventId,
  );
  if (!gate.ok) return { ok: false, status: 403, error: gate.error, message: gate.message };

  // 2. ROUND ACCESS.
  const access = await resolveRoundAccess(db, competitionId, eventId, uid);
  if (!access.allowed || access.liveRound === null) {
    const reason = access.reason === 'ok' ? 'no-live-round' : access.reason;
    return {
      ok: false,
      status: reason === 'not-qualified' ? 403 : 409,
      error: reason,
      message: ROUND_ACCESS_MESSAGE[reason],
      liveRound: access.liveRound,
    };
  }
  const round = access.liveRound;

  // 3. THE ATTEMPT, from the athlete's filings.
  const compSnap = await db.collection('onlineCompetitions').doc(competitionId).get();
  const event = normalizeStoredEvents(compSnap.get('events')).find((e) => e.eventId === eventId);
  if (!compSnap.exists || !event) {
    return { ok: false, status: 404, error: 'event-not-configured', message: MESSAGES['event-not-configured'] };
  }
  const shape = runShapeFor(event, round);

  const deadline = now() + waitForFilingMs;
  let decision: AttemptDecision;
  for (;;) {
    const plan = planResume(await fetchFiledAttempts(db, uid, competitionId, eventId), round, shape);
    decision = decideScrambleAttempt(plan, requestedAttempt);
    if (decision.kind !== 'wait') break;
    if (now() >= deadline) {
      return {
        ok: false,
        status: 409,
        error: 'previous-attempt-unfiled',
        message: MESSAGES['previous-attempt-unfiled'],
        nextAttempt: plan.nextAttempt,
      };
    }
    await sleep(pollMs);
  }
  if (decision.kind === 'refuse') {
    return {
      ok: false,
      status: 409,
      error: decision.error,
      message: decision.error === 'no-live-round' ? ROUND_ACCESS_MESSAGE['no-live-round'] : MESSAGES[decision.error],
      nextAttempt: decision.nextAttempt,
    };
  }
  const attempt = decision.attempt;

  // 4. THE SCRAMBLE for that attempt.
  try {
    const official = await lookupGroupScramble(db, { competitionId, eventId, round, uid, attempt });
    if (official && 'outOfRange' in official) {
      return {
        ok: false,
        status: 400,
        error: `Attempt ${attempt} is out of range for this round (${official.max} scrambles).`,
        message: 'Энэ раундад ийм олон оролдлого байхгүй байна.',
      };
    }
    // NO GROUP IN AN OFFICIAL ROUND — refused, not served randomly.
    if (official && 'noGroup' in official) {
      return {
        ok: false,
        status: 403,
        error: 'No group assignment for this athlete in an official round.',
        message: 'Та группэд хуваарилагдаагүй байна. Зохион байгуулагчид хандана уу.',
      };
    }
    if (official) return { ok: true, round, attempt, official };
  } catch (e) {
    // Unchanged trade-off: a THROWN group lookup falls back to random, so
    // an Admin SDK blip does not stop every athlete solving. The attempt
    // and the athlete's eligibility were already decided above, and a
    // throw here cannot change either.
    console.error('Group scramble lookup failed, falling back to random:', e);
  }
  return { ok: true, round, attempt, official: null };
}

/** Records that this athlete was served `attempt` in `round` — the ticket
 *  firestore.rules requires before a submission for it can be created.
 *
 *  servedThrough is SET, not maxed: it only ever moves backwards when an
 *  admin resets the athlete's attempts (the next attempt becomes 1 again),
 *  and then it should. Throws on failure; the route must not hand out a
 *  scramble whose attempt could not then be filed. */
export async function recordScrambleServed(
  db: Firestore,
  input: { competitionId: string; uid: string; eventId: string; round: number; attempt: number },
): Promise<void> {
  const { competitionId, uid, eventId, round, attempt } = input;
  await db
    .collection('onlineCompetitions')
    .doc(competitionId)
    .collection(RUN_TICKETS)
    .doc(runTicketId(uid, eventId, round))
    .set({ uid, eventId, competitionRound: round, servedThrough: attempt, updatedAt: new Date() }, { merge: true });
}
