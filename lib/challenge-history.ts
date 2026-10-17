// Coach challenge history (docs/challenge-plan.md, phase 5) — the pure
// helpers behind the history pages: how a session ended, its shown end time,
// its blocks with their solves, solve / block text, and the coach's
// per-challenge ordering. No firebase / React imports, so the unit tests
// (scripts/test-challenge.ts) run them under plain tsc.
import { METRIC_LABEL, METRIC_N } from './challenge';
import { fmtMs, PENALTY_ADD } from './solve-stats';
import type {
  AssignmentStatus, ChallengeMetric, ChallengeSessionRecord, SessionSolve,
} from './types/challenge';

export type EndReason = 'running' | 'student' | 'time' | 'coach' | 'completed';

/** How the history labels each end. */
export const END_REASON_TEXT: Record<EndReason, string> = {
  running: 'Явагдаж байна',
  student: 'дуусгасан',
  time: 'цаг дууссан',
  coach: 'багш зогсоосон',
  completed: 'биелсэн',
};

type SessionTimes = Pick<ChallengeSessionRecord, 'status' | 'endedBy' | 'endsAt' | 'endedAt'>;

/**
 * Why a session ended. 'ended' without `endedBy` (closed before phase 5
 * recorded it) reads as the student's own end. A session still marked
 * active past its end time is shown as ended by time — every reader treats
 * it as closed, and the next server action closes it as 'auto-closed'.
 */
export function endReason(s: SessionTimes, nowMs: number): EndReason {
  switch (s.status) {
    case 'completed': return 'completed';
    case 'auto-closed': return 'time';
    case 'ended': return s.endedBy === 'coach' ? 'coach' : 'student';
    default: return s.endsAt > nowMs ? 'running' : 'time';
  }
}

/** The end time to show: the end time itself when it closed by time (the
 *  cron or a lazy close may record `endedAt` much later), else `endedAt`;
 *  null while it runs. */
export function shownEndMs(s: SessionTimes, nowMs: number): number | null {
  const r = endReason(s, nowMs);
  if (r === 'running') return null;
  if (r === 'time') return s.endsAt;
  return s.endedAt ?? s.endsAt;
}

/** One solve as the timer shows it: "1.95", "3.95+" (with the +2), "DNF". */
export function solveText(s: Pick<SessionSolve, 'ms' | 'penalty'>): string {
  if (s.penalty === 'dnf') return 'DNF';
  const t = fmtMs(s.ms + PENALTY_ADD[s.penalty]);
  return s.penalty === '+2' ? `${t}+` : t;
}

/** A block's result line: "Ao5 1.87 ✓", "Mo3 DNF ✗". */
export function blockText(metric: ChallengeMetric, b: { resultMs: number | null; pass: boolean }): string {
  return `${METRIC_LABEL[metric]} ${b.resultMs === null ? 'DNF' : fmtMs(b.resultMs)} ${b.pass ? '✓' : '✗'}`;
}

export interface HistoryBlock {
  /** 1-based. */
  index: number;
  resultMs: number | null;
  pass: boolean;
  solves: SessionSolve[];
}

/**
 * A session's scored blocks, in order, each with its own solves, plus the
 * solves of an unfinished last block (never scored, decision 5). Results
 * come from the server's stored `blocks`, not recomputed, so the history
 * always matches the stats rolled up from it.
 */
export function sessionBlocks(s: Pick<ChallengeSessionRecord, 'template' | 'solves' | 'blocks'>):
  { blocks: HistoryBlock[]; leftover: SessionSolve[] } {
  const n = METRIC_N[s.template.metric] ?? 1;
  const solves = [...s.solves].sort((a, b) => a.seq - b.seq);
  const blocks = s.blocks.map((b, i) => ({
    index: i + 1, resultMs: b.resultMs, pass: b.pass, solves: solves.slice(i * n, (i + 1) * n),
  }));
  return { blocks, leftover: solves.slice(s.blocks.length * n) };
}

export interface OverviewRow {
  studentName: string;
  status: AssignmentStatus;
  completedAt: number | null;
}

const STATUS_ORDER: Record<AssignmentStatus, number> = { completed: 0, 'in-progress': 1, assigned: 2, archived: 3 };

/** The coach's per-challenge list: completed first, earliest completion on
 *  top; then active, then not yet started; names alphabetical within. */
export function sortOverview<T extends OverviewRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (a.status === 'completed' ? (a.completedAt ?? Infinity) - (b.completedAt ?? Infinity) : 0) ||
    a.studentName.localeCompare(b.studentName, 'mn'));
}
