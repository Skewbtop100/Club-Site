// Points service — single source of truth for awarding/deducting points.
//
// Every change goes through a Firestore runTransaction so the user's
// `points` balance and the corresponding `pointTransactions` row are
// written atomically (the row's `balanceAfter` is the user balance after
// the same transaction). Idempotent variants (daily login, solve daily
// limit, achievement, multiplayer-match) carry per-feature dedupe state
// on the user doc so re-firing the same award is a no-op.

import {
  collection, doc, getDocs, limit as fsLimit, onSnapshot,
  orderBy, query, runTransaction, serverTimestamp, Timestamp,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { pointTransactionsCol } from './firebase/collections';
import type { PointReason, PointTransaction } from './types';

// ── Earn rules ────────────────────────────────────────────────────────────
//
// Single declarative table of every way to earn points. UI surfaces (e.g.
// the eventual point store / earn page) should render from this list so
// amounts and descriptions stay in sync with the actual award sites.
export interface EarnRule {
  reason: PointReason;
  amount: number;
  description: string;
  /** Daily cap; only meaningful for repeating actions like 'solve'. */
  dailyLimit?: number;
}

const EARN_RULES: EarnRule[] = [
  { reason: 'daily_login',    amount:   5, description: 'Өдөр тутмын бонус' },
  { reason: 'solve',          amount:   1, description: 'Solve хийсний шагнал', dailyLimit: 50 },
  { reason: 'pb_set',         amount:  20, description: 'Шинэ хувийн рекорд (PB)' },
  { reason: 'mp_played',      amount:  10, description: 'Multiplayer тоглолт' },
  { reason: 'mp_won',         amount:  25, description: 'Multiplayer хожсон' },
  { reason: 'achievement',    amount:  50, description: 'Амжилт нээсэн' },
  { reason: 'athlete_linked', amount: 100, description: 'Тамирчинтай холбогдсон' },
  { reason: 'admin_grant',    amount:   0, description: 'Админ олгосон' },
];

export function getEarnRules(): EarnRule[] {
  return EARN_RULES.slice();
}

export function getEarnRule(reason: PointReason): EarnRule | undefined {
  return EARN_RULES.find(r => r.reason === reason);
}

// ── Generic award / deduct ────────────────────────────────────────────────
//
// `amount` must be POSITIVE for awardPoints and POSITIVE for deductPoints
// (the negative sign is applied internally). `metadata` is stored on the
// transaction doc and is the right place for any feature-specific context
// (matchId, event, previousBest, etc).
export interface AwardResult { balance: number }

export async function awardPoints(
  uid: string,
  amount: number,
  reason: PointReason | string,
  description: string,
  metadata: Record<string, unknown> = {},
): Promise<AwardResult> {
  if (!uid) throw new Error('awardPoints: uid is required');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('awardPoints: amount must be > 0');
  }
  return runTransaction(db, async t => {
    const userRef = doc(db, 'users', uid);
    const snap = await t.get(userRef);
    if (!snap.exists()) throw new Error(`awardPoints: user ${uid} not found`);
    const data = snap.data();
    const current = typeof data.points === 'number' ? data.points : 0;
    const newBalance = current + amount;
    t.update(userRef, { points: newBalance });
    const txRef = doc(collection(db, 'pointTransactions'));
    t.set(txRef, {
      uid,
      amount,
      reason,
      description,
      timestamp: serverTimestamp(),
      balanceAfter: newBalance,
      metadata,
    });
    return { balance: newBalance };
  });
}

export async function deductPoints(
  uid: string,
  amount: number,
  reason: PointReason | string,
  description: string,
  metadata: Record<string, unknown> = {},
): Promise<AwardResult> {
  if (!uid) throw new Error('deductPoints: uid is required');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('deductPoints: amount must be > 0');
  }
  return runTransaction(db, async t => {
    const userRef = doc(db, 'users', uid);
    const snap = await t.get(userRef);
    if (!snap.exists()) throw new Error(`deductPoints: user ${uid} not found`);
    const data = snap.data();
    const current = typeof data.points === 'number' ? data.points : 0;
    if (current < amount) {
      throw new Error(`deductPoints: insufficient balance (${current} < ${amount})`);
    }
    const newBalance = current - amount;
    t.update(userRef, { points: newBalance });
    const txRef = doc(collection(db, 'pointTransactions'));
    t.set(txRef, {
      uid,
      amount: -amount,
      reason,
      description,
      timestamp: serverTimestamp(),
      balanceAfter: newBalance,
      metadata,
    });
    return { balance: newBalance };
  });
}

// ── Reads ─────────────────────────────────────────────────────────────────

export async function getRecentTransactions(
  uid: string,
  max = 20,
): Promise<PointTransaction[]> {
  if (!uid) return [];
  const q = query(
    pointTransactionsCol,
    where('uid', '==', uid),
    orderBy('timestamp', 'desc'),
    fsLimit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

export function subscribeRecentTransactions(
  uid: string,
  onData: (rows: PointTransaction[]) => void,
  options: { limit?: number; onError?: (err: Error) => void } = {},
): () => void {
  const q = query(
    pointTransactionsCol,
    where('uid', '==', uid),
    orderBy('timestamp', 'desc'),
    fsLimit(options.limit ?? 20),
  );
  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => d.data())),
    err => options.onError?.(err),
  );
}

export function tsToMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return null;
}

// ── Local-date helpers ────────────────────────────────────────────────────
//
// Daily-bonus / daily-solve-limit gates compare against *local* calendar
// days (so a user's "today" doesn't roll over at unexpected UTC times).
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function tsValueToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'number') return new Date(value);
  return null;
}

// ── Idempotent variants ───────────────────────────────────────────────────
//
// Each of these checks a per-feature dedupe field on users/{uid} inside
// the transaction so concurrent callers can't double-award.

export interface IdempotentResult { awarded: boolean; balance: number }

/**
 * Daily login bonus — fires once per local calendar day per user. Marker
 * lives at users/{uid}.lastDailyBonus (a Timestamp).
 */
export async function awardDailyLoginIfNew(uid: string): Promise<IdempotentResult> {
  if (!uid) throw new Error('awardDailyLoginIfNew: uid is required');
  const rule = getEarnRule('daily_login')!;
  const today = ymd(new Date());
  return runTransaction(db, async t => {
    const userRef = doc(db, 'users', uid);
    const snap = await t.get(userRef);
    if (!snap.exists()) {
      // User doc not yet provisioned (race with auth-context upsert) —
      // bail without awarding; the next login will catch up.
      return { awarded: false, balance: 0 };
    }
    const data = snap.data();
    const last = tsValueToDate(data.lastDailyBonus);
    if (last && ymd(last) === today) {
      return { awarded: false, balance: data.points ?? 0 };
    }
    const current = typeof data.points === 'number' ? data.points : 0;
    const newBalance = current + rule.amount;
    t.update(userRef, {
      points: newBalance,
      lastDailyBonus: serverTimestamp(),
    });
    const txRef = doc(collection(db, 'pointTransactions'));
    t.set(txRef, {
      uid,
      amount: rule.amount,
      reason: 'daily_login',
      description: rule.description,
      timestamp: serverTimestamp(),
      balanceAfter: newBalance,
      metadata: {},
    });
    return { awarded: true, balance: newBalance };
  });
}

/**
 * Per-solve point — capped at `dailyLimit` per local calendar day. Counter
 * lives at users/{uid}.solvesToday + lastSolveDate. If the date has
 * rolled over, the counter resets to 1.
 */
export async function awardSolvePointIfUnderLimit(uid: string): Promise<IdempotentResult> {
  if (!uid) throw new Error('awardSolvePointIfUnderLimit: uid is required');
  const rule = getEarnRule('solve')!;
  const limit = rule.dailyLimit ?? 50;
  const today = ymd(new Date());
  return runTransaction(db, async t => {
    const userRef = doc(db, 'users', uid);
    const snap = await t.get(userRef);
    if (!snap.exists()) return { awarded: false, balance: 0 };
    const data = snap.data();
    const lastDate = tsValueToDate(data.lastSolveDate);
    const sameDay = lastDate ? ymd(lastDate) === today : false;
    const todaySoFar = sameDay ? (typeof data.solvesToday === 'number' ? data.solvesToday : 0) : 0;
    if (todaySoFar >= limit) {
      return { awarded: false, balance: data.points ?? 0 };
    }
    const current = typeof data.points === 'number' ? data.points : 0;
    const newBalance = current + rule.amount;
    t.update(userRef, {
      points: newBalance,
      solvesToday: todaySoFar + 1,
      lastSolveDate: serverTimestamp(),
    });
    const txRef = doc(collection(db, 'pointTransactions'));
    t.set(txRef, {
      uid,
      amount: rule.amount,
      reason: 'solve',
      description: rule.description,
      timestamp: serverTimestamp(),
      balanceAfter: newBalance,
      metadata: {},
    });
    return { awarded: true, balance: newBalance };
  });
}

/**
 * PB award — caller is responsible for actually detecting the PB. This
 * helper just wraps awardPoints with the canonical reason/amount and
 * captures `event`, `ms`, and `previousBest` in metadata.
 */
export async function awardPbPoints(
  uid: string,
  event: string,
  ms: number,
  previousBest: number | null,
): Promise<AwardResult> {
  const rule = getEarnRule('pb_set')!;
  return awardPoints(uid, rule.amount, 'pb_set', rule.description, {
    event, ms, previousBest,
  });
}

/**
 * Multiplayer match — combines mp_played (always) with mp_won (rank-1
 * bonus) into ONE Firestore transaction. Two separate `pointTransactions`
 * rows are written so the ledger reflects both reasons distinctly, but
 * the user's points field is incremented just once with the total. Marker
 * lives at users/{uid}.awardedMatches (string[]) — idempotent on matchId.
 */
export interface MatchAwardResult extends IdempotentResult {
  amount: number;
  won: boolean;
}

export async function awardMpMatchIfNew(
  uid: string,
  matchId: string,
  finalRank: number,
  event: string,
): Promise<MatchAwardResult> {
  if (!uid) throw new Error('awardMpMatchIfNew: uid is required');
  if (!matchId) throw new Error('awardMpMatchIfNew: matchId is required');
  const playedRule = getEarnRule('mp_played')!;
  const wonRule = getEarnRule('mp_won')!;
  const won = finalRank === 1;
  const total = playedRule.amount + (won ? wonRule.amount : 0);
  return runTransaction(db, async t => {
    const userRef = doc(db, 'users', uid);
    const snap = await t.get(userRef);
    if (!snap.exists()) return { awarded: false, balance: 0, amount: 0, won: false };
    const data = snap.data();
    const awarded: string[] = Array.isArray(data.awardedMatches) ? data.awardedMatches : [];
    if (awarded.includes(matchId)) {
      return { awarded: false, balance: data.points ?? 0, amount: 0, won: false };
    }
    const current = typeof data.points === 'number' ? data.points : 0;
    const balanceAfterPlayed = current + playedRule.amount;
    const newBalance = current + total;
    t.update(userRef, {
      points: newBalance,
      awardedMatches: [...awarded, matchId],
    });
    const playedTxRef = doc(collection(db, 'pointTransactions'));
    t.set(playedTxRef, {
      uid,
      amount: playedRule.amount,
      reason: 'mp_played',
      description: playedRule.description,
      timestamp: serverTimestamp(),
      balanceAfter: balanceAfterPlayed,
      metadata: { matchId, finalRank, event },
    });
    if (won) {
      const wonTxRef = doc(collection(db, 'pointTransactions'));
      t.set(wonTxRef, {
        uid,
        amount: wonRule.amount,
        reason: 'mp_won',
        description: wonRule.description,
        timestamp: serverTimestamp(),
        balanceAfter: newBalance,
        metadata: { matchId, finalRank, event },
      });
    }
    return { awarded: true, balance: newBalance, amount: total, won };
  });
}

/**
 * Achievement unlock — idempotent on achievementId via
 * users/{uid}.awardedAchievements. The caller (the multiplayer hub or
 * future achievement screens) decides WHEN an achievement transitioned
 * locked → unlocked; this helper just persists the award once.
 */
export async function awardAchievementIfNew(
  uid: string,
  achievementId: string,
  achievementName: string,
): Promise<IdempotentResult> {
  if (!uid) throw new Error('awardAchievementIfNew: uid is required');
  const rule = getEarnRule('achievement')!;
  return runTransaction(db, async t => {
    const userRef = doc(db, 'users', uid);
    const snap = await t.get(userRef);
    if (!snap.exists()) return { awarded: false, balance: 0 };
    const data = snap.data();
    const awarded: string[] = Array.isArray(data.awardedAchievements) ? data.awardedAchievements : [];
    if (awarded.includes(achievementId)) {
      return { awarded: false, balance: data.points ?? 0 };
    }
    const current = typeof data.points === 'number' ? data.points : 0;
    const newBalance = current + rule.amount;
    t.update(userRef, {
      points: newBalance,
      awardedAchievements: [...awarded, achievementId],
    });
    const txRef = doc(collection(db, 'pointTransactions'));
    t.set(txRef, {
      uid,
      amount: rule.amount,
      reason: 'achievement',
      description: `Амжилт нээгдлээ: ${achievementName}`,
      timestamp: serverTimestamp(),
      balanceAfter: newBalance,
      metadata: { achievementId },
    });
    return { awarded: true, balance: newBalance };
  });
}

/**
 * Athlete-linked award — fired by the admin-side approval batch. Sets
 * users/{uid}.athleteLinkedToastPending = true so the next login can
 * surface a celebratory toast. Award itself is NOT idempotent here — the
 * approval flow guarantees it runs once per linkage.
 */
export async function awardAthleteLinked(uid: string): Promise<AwardResult> {
  if (!uid) throw new Error('awardAthleteLinked: uid is required');
  const rule = getEarnRule('athlete_linked')!;
  return runTransaction(db, async t => {
    const userRef = doc(db, 'users', uid);
    const snap = await t.get(userRef);
    if (!snap.exists()) throw new Error(`awardAthleteLinked: user ${uid} not found`);
    const data = snap.data();
    const current = typeof data.points === 'number' ? data.points : 0;
    const newBalance = current + rule.amount;
    t.update(userRef, {
      points: newBalance,
      athleteLinkedToastPending: true,
    });
    const txRef = doc(collection(db, 'pointTransactions'));
    t.set(txRef, {
      uid,
      amount: rule.amount,
      reason: 'athlete_linked',
      description: rule.description,
      timestamp: serverTimestamp(),
      balanceAfter: newBalance,
      metadata: {},
    });
    return { balance: newBalance };
  });
}

/**
 * Read-and-clear the athlete-linked toast flag. Called from auth-context
 * on every successful sign-in; returns true exactly once after admin
 * approval.
 */
export async function consumeAthleteLinkedToast(uid: string): Promise<boolean> {
  if (!uid) return false;
  return runTransaction(db, async t => {
    const userRef = doc(db, 'users', uid);
    const snap = await t.get(userRef);
    if (!snap.exists()) return false;
    const data = snap.data();
    if (data.athleteLinkedToastPending !== true) return false;
    t.update(userRef, { athleteLinkedToastPending: false });
    return true;
  });
}
