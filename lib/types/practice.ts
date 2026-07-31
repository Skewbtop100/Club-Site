import type { Timestamp } from 'firebase/firestore';

// ── Practice Log ──────────────────────────────────────────────────────────
//
// One informal daily Ao5 attempt per athlete per WCA event. Distinct from
// `Result` (competition results): no competitionId/round/group, and the
// "1 per athlete per event per day" rule is enforced in the service layer
// (see lib/firebase/services/practiceSessions.ts), not in Firestore rules.

export interface PracticeSession {
  id: string;
  athleteId: string;
  athleteName: string; // denormalized full name for display without extra lookups
  event: string; // WCA event id, reuse existing event id format from lib/wca-events.ts
  date: string; // YYYY-MM-DD, local club timezone (Ulaanbaatar)
  scramble: string; // the scramble used for this Ao5, generated same way as Timer does
  solves: number[]; // exactly 5 solve times in milliseconds, truncated (Math.floor);
                     // -1 represents DNF, same convention as existing competition results
  ao5: number | null; // computed average of 5 (drop best/worst, WCA rule), null if
                       // 2+ DNFs make it impossible
  judgeId: string | null; // uid of the athlete who judged (self-entry vs judged by peer)
  judgeName: string | null; // denormalized name of judge, null if self-entered
  enteredByAdmin: boolean; // true if an admin entered this on the athlete's behalf
  createdAt: Timestamp;
}
