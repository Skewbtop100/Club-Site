// ── Public registration panel: derived state ────────────────────────────
// Whether registration is open, what the athlete owes for a selection,
// and what a not-yet-approved profile should be told. Pure — no React,
// no Firestore, no clock of its own (callers pass `nowMs`) — and unit-
// tested in tests/competition-fields/registration-view.test.cjs.
//
// EVERY GATE HERE IS CLIENT-SIDE. firestore.rules for
// onlineParticipants/{uid}/registrations checks only that the writer owns
// the document, that competitionId matches, that `events` is a non-empty
// list, and the note's length. It does NOT check the deadline, the
// competition's status, the athlete's profile status, or the participant
// limit. These functions make the panel honest; they do not make the data
// safe from a hand-crafted write. See the handover note on hardening.

import { athleteFeeMnt, formatMnt, surchargeOf } from './fees';
import type {
  OnlineCompetitionEventConfig,
  OnlineCompetitionStatus,
  OnlineParticipantProfileStatus,
} from './types';

// ── is registration open? ──────────────────────────────────────────────

export type RegistrationWindow =
  | { open: true }
  | { open: false; reason: 'finished' | 'deadline-passed' };

/** Open unless the competition has finished or its deadline has passed.
 *
 *  'live' is not closed by status alone: a competition's deadline must be
 *  on or before its start (validateCompetitionInput refuses otherwise), so
 *  a live competition is past its deadline in practice and the deadline
 *  rule closes it. Only when an admin left the deadline UNSET does a live
 *  competition stay open — and in that case "no closing time" is what the
 *  admin configured, so that is what the panel honours.
 *
 *  A draft never reaches this panel: fetchCompetition returns null for
 *  one. The deadline is "passed" from the exact millisecond it names, the
 *  same instant the header's countdown reaches БҮРТГЭЛ ХААГДСАН, so the
 *  two can never disagree about whether it is open. */
export function registrationWindow(
  competition: { status: OnlineCompetitionStatus; registrationDeadlineMs: number | null },
  nowMs: number,
): RegistrationWindow {
  if (competition.status === 'finished') return { open: false, reason: 'finished' };
  if (competition.registrationDeadlineMs !== null && nowMs >= competition.registrationDeadlineMs) {
    return { open: false, reason: 'deadline-passed' };
  }
  return { open: true };
}

// ── the fee for a selection ────────────────────────────────────────────

export type FeeView =
  | { show: false }
  | { show: true; totalMnt: null; note: string }
  | { show: true; totalMnt: number; total: string; breakdown: string };

/** What the fee block shows for the athlete's CURRENT selection.
 *
 *  The total comes from athleteFeeMnt — its first caller — so the number
 *  an athlete sees here is the same arithmetic the admin Төлбөр tab and
 *  the detail page's ХУРААМЖ cells use.
 *
 *  The breakdown names only what CHANGES the total: the base fee, then
 *  each selected event that costs extra. Included events are not listed
 *  one by one — they add nothing, and a line naming six free events would
 *  bury the one that costs money.
 *
 *  `paid` is the gate, never baseFeeMnt being set: fee fields persist
 *  when an admin switches a competition back to Төлбөргүй. A paid
 *  competition with no base fee set says so instead of showing a number
 *  it does not have. */
export function feeView(
  paid: boolean,
  baseFeeMnt: number | null,
  events: Pick<OnlineCompetitionEventConfig, 'eventId' | 'label' | 'surchargeMnt'>[],
  selectedIds: string[],
): FeeView {
  if (!paid) return { show: false };
  if (baseFeeMnt === null) {
    return { show: true, totalMnt: null, note: 'Хураамжийн дүн удахгүй зарлагдана.' };
  }
  const totalMnt = athleteFeeMnt(baseFeeMnt, events, selectedIds);
  const selected = new Set(selectedIds);
  const extras = events
    .filter((e) => selected.has(e.eventId) && surchargeOf(e) !== null)
    .map((e) => `${e.label} +${formatMnt(surchargeOf(e)!)}`);
  const breakdown =
    extras.length > 0
      ? `Суурь ${formatMnt(baseFeeMnt)} · ${extras.join(' · ')}`
      : `Суурь ${formatMnt(baseFeeMnt)} · сонгосон төрлүүд суурьд багтсан`;
  return { show: true, totalMnt, total: formatMnt(totalMnt), breakdown };
}

// ── an athlete whose profile is not approved ───────────────────────────

export interface ProfileGateCopy {
  title: string;
  body: string;
  /** The link's label, or null when there is nothing for the athlete to
   *  do but wait. */
  action: string | null;
}

/** What each not-approved profile state is told.
 *
 *  These used to be ONE message for three different situations — "fill in
 *  your profile and have an admin verify it" — which told an athlete who
 *  had already submitted to fill it in again, and told a rejected athlete
 *  nothing about why. Same gate, same place in the flow; the copy now
 *  says which of the three it is. */
export function profileGateCopy(
  status: Exclude<OnlineParticipantProfileStatus, 'approved'>,
  rejectionReason: string | null,
): ProfileGateCopy {
  if (status === 'pending') {
    return {
      title: 'Профайл хянагдаж байна',
      body: 'Таны профайлыг админ шалгаж байна. Баталгаажсаны дараа энэ тэмцээнд бүртгүүлэх боломжтой болно.',
      action: null,
    };
  }
  if (status === 'rejected') {
    const reason = typeof rejectionReason === 'string' && rejectionReason.trim() ? rejectionReason.trim() : null;
    return {
      title: 'Профайл баталгаажаагүй',
      body: reason
        ? `Шалтгаан: ${reason}. Профайлаа засаад дахин илгээнэ үү.`
        : 'Профайлаа засаад дахин илгээнэ үү.',
      action: 'Профайл засах →',
    };
  }
  return {
    title: 'Профайл бөглөөгүй байна',
    body: 'Тэмцээнд бүртгүүлэхийн тулд эхлээд профайлаа бөглөж, админаар баталгаажуулах шаардлагатай.',
    action: 'Профайл бөглөх →',
  };
}
