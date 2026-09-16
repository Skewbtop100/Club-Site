// ── Public registration panel: derived state ────────────────────────────
// Whether registration is open, what the athlete owes for a selection,
// and what a not-yet-approved profile should be told. Pure — no React,
// no Firestore, no clock of its own (callers pass `nowMs`) — and unit-
// tested in tests/competition-fields/registration-view.test.cjs.
//
// THE WINDOW IS ALSO ENFORCED ON THE SERVER. firestore.rules for
// onlineParticipants/{uid}/registrations refuses a registration (or a
// change of events or note) unless the competition is public and the
// server's clock is inside its registration window — the same rule
// registrationWindow applies below, so the panel shows what the server
// will accept. The rules still do NOT check the athlete's profile status
// or the participant limit; those gates remain client-side.

import { athleteFeeMnt, formatMnt, surchargeOf } from './fees';
import type {
  OnlineCompetitionEventConfig,
  OnlineCompetitionStatus,
  OnlineParticipantProfileStatus,
  OnlineRegistrationStatus,
} from './types';

// ── is registration open? ──────────────────────────────────────────────

export type RegistrationWindow =
  | { open: true }
  | { open: false; reason: 'not-yet-open'; opensAtMs: number }
  | { open: false; reason: 'finished' | 'deadline-passed' | 'not-public' | 'no-window' };

/** Open only while the competition is public and the clock is inside
 *  [registrationOpensAt, registrationDeadline) — exactly what
 *  firestore.rules accepts (windowOpenFor), and failing closed the same way:
 *
 *    finished                          -> 'finished'
 *    any status but upcoming or live   -> 'not-public'
 *    either time unset                 -> 'no-window'
 *    at or after the deadline          -> 'deadline-passed'
 *    before the opening time           -> 'not-yet-open' (with when)
 *
 *  An unset time used to mean "no limit". It no longer does: a competition
 *  whose admin has not set the window has not opened registration.
 *
 *  Both boundaries are the millisecond named: open FROM registrationOpensAt,
 *  closed FROM registrationDeadline — the same instant the header's
 *  countdown reaches БҮРТГЭЛ ХААГДСАН. The panel's clock is the athlete's,
 *  the rules' is the server's; if the two differ, the server wins and the
 *  panel says so when a save is refused. */
export function registrationWindow(
  competition: {
    status: OnlineCompetitionStatus;
    registrationOpensAtMs: number | null;
    registrationDeadlineMs: number | null;
  },
  nowMs: number,
): RegistrationWindow {
  if (competition.status === 'finished') return { open: false, reason: 'finished' };
  if (competition.status !== 'upcoming' && competition.status !== 'live') return { open: false, reason: 'not-public' };
  const opens = competition.registrationOpensAtMs;
  const closes = competition.registrationDeadlineMs;
  if (opens === null || closes === null) return { open: false, reason: 'no-window' };
  if (nowMs >= closes) return { open: false, reason: 'deadline-passed' };
  if (nowMs < opens) return { open: false, reason: 'not-yet-open', opensAtMs: opens };
  return { open: true };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2026.09.16 23:00", in the viewer's own time zone. */
export function fmtRegistrationMoment(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The countdown on the disabled button: "2 ӨДӨР 03:14:09", or "03:14:09"
 *  inside the last day. Rounded UP to the second, so it reads 00:00:01 —
 *  never 00:00:00 — while registration is still closed. */
export function opensInLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const days = Math.floor(total / 86_400);
  const clock = `${pad2(Math.floor((total % 86_400) / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
  return days > 0 ? `${days} ӨДӨР ${clock}` : clock;
}

/** What a panel that cannot register says. `savedLine` is for an athlete
 *  who already holds a registration: their summary stays, read-only. The
 *  finished and deadline wording is the closed state as it already was. */
export function registrationClosedCopy(
  w: Exclude<RegistrationWindow, { open: true }>,
): { title: string; body: string; savedLine: string } {
  switch (w.reason) {
    case 'not-yet-open': {
      const at = fmtRegistrationMoment(w.opensAtMs);
      return {
        title: 'Бүртгэл нээгдээгүй',
        body: `Бүртгэл ${at}-д нээгдэнэ.`,
        savedLine: `Бүртгэл ${at}-д нээгдэнэ. Сонголтоо тэр үеэс өөрчилж болно.`,
      };
    }
    case 'finished':
      return {
        title: 'Бүртгэл хаагдсан',
        body: 'Тэмцээн дууссан тул бүртгэл хаагдсан.',
        savedLine: 'Тэмцээн дууссан тул бүртгэл хаагдсан. Сонголтоо өөрчлөх боломжгүй.',
      };
    case 'deadline-passed':
      return {
        title: 'Бүртгэл хаагдсан',
        body: 'Бүртгэлийн хугацаа дууссан.',
        savedLine: 'Бүртгэлийн хугацаа дууссан. Сонголтоо өөрчлөх боломжгүй.',
      };
    case 'no-window':
      return {
        title: 'Бүртгэл нээгдээгүй',
        body: 'Зохион байгуулагч бүртгэлийн хугацааг хараахан зарлаагүй байна.',
        savedLine: 'Бүртгэлийн хугацаа зарлагдаагүй тул сонголтоо одоогоор өөрчлөх боломжгүй.',
      };
    case 'not-public':
      return {
        title: 'Бүртгэл хаагдсан',
        body: 'Энэ тэмцээнд одоогоор бүртгүүлэх боломжгүй.',
        savedLine: 'Энэ тэмцээнд одоогоор сонголтоо өөрчлөх боломжгүй.',
      };
  }
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
      // A LINK, where this used to be null. There is still nothing for the
      // athlete to FIX — the label reads харах, not засах — but leaving the
      // gate with no way out at all is part of what made this read as a
      // broken page: the athlete saw the refusal and had nowhere to go to
      // see what they had actually submitted.
      action: 'Профайл харах →',
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

// ── the standing notice, before anything is attempted ──────────────────

export interface VerificationNoticeCopy {
  /** Uppercase chip word — which of the three states this is. */
  label: string;
  /** One line: what is true now, AND what it prevents. */
  body: string;
  action: string;
}

/** The notice an unverified athlete carries on every hub page, so the rule
 *  arrives BEFORE they try to register rather than as the reason a button
 *  refused them.
 *
 *  Same three states as profileGateCopy, deliberately in the same module so
 *  the standing notice and the one at the point of failure cannot drift
 *  apart. The difference is placement and scope: this one is general ("you
 *  cannot enter competitions"), profileGateCopy's is about the one
 *  competition in front of the athlete.
 *
 *  EVERY state names the consequence. That was the omission this exists to
 *  fix — an athlete could read "хянагдаж байна" and still have no idea it
 *  was what stopped them registering. */
export function verificationNoticeCopy(
  status: Exclude<OnlineParticipantProfileStatus, 'approved'>,
  rejectionReason: string | null,
): VerificationNoticeCopy {
  if (status === 'pending') {
    return {
      label: 'ХЯНАГДАЖ БАЙНА',
      body: 'Админ таны профайлыг шалгаж байна. Баталгаажих хүртэл тэмцээнд бүртгүүлэх боломжгүй.',
      action: 'Профайл харах →',
    };
  }
  if (status === 'rejected') {
    const reason = typeof rejectionReason === 'string' && rejectionReason.trim() ? rejectionReason.trim() : null;
    return {
      label: 'БАТАЛГААЖААГҮЙ',
      body: reason
        ? `Профайл баталгаажсангүй. Шалтгаан: ${reason}. Засаад дахин илгээнэ үү — баталгаажих хүртэл тэмцээнд бүртгүүлэх боломжгүй.`
        : 'Профайл баталгаажсангүй. Засаад дахин илгээнэ үү — баталгаажих хүртэл тэмцээнд бүртгүүлэх боломжгүй.',
      action: 'Профайл засах →',
    };
  }
  return {
    label: 'ПРОФАЙЛ БӨГЛӨӨГҮЙ',
    body: 'Тэмцээнд бүртгүүлэхийн тулд профайлаа бөглөж, админаар баталгаажуулна. Баталгаажих хүртэл тэмцээнд бүртгүүлэх боломжгүй.',
    action: 'Профайл бөглөх →',
  };
}

// ── the athlete's own registration status ──────────────────────────────

export type StatusTone = 'amber' | 'green' | 'muted' | 'red';

export interface RegistrationStatusCopy {
  /** The badge word(s), uppercase — the short form, for chips with no room
   *  for a sentence (the sidebar, the hub row, the dashboard lock chip). */
  label: string;
  /** The same state said in full, uppercase — the Бүртгүүлэх panel's heading
   *  and the banner at the top of the details page. A pending registration
   *  is a REQUEST, and neither form may read as if it were complete. */
  headline: string;
  /** A short line after the label, or null. */
  detail: string | null;
  tone: StatusTone;
  /** Whether the panel offers БҮРТГЭЛЭЭ ЗАСАХ. An edit never changes the
   *  status, so for a cancelled or rejected registration editing events
   *  would change nothing that matters — and would look like it did. */
  canEdit: boolean;
}

/** What the athlete is told about their registration's review status —
 *  one wording for the Бүртгүүлэх panel, the sidebar, the dashboard and the
 *  hub card, so the four cannot say different things.
 *
 *  Nothing here promises a notification: there is no mechanism that tells
 *  a waitlisted athlete they got a place. The copy says who acts, not that
 *  the athlete will hear about it. */
export function registrationStatusCopy(status: OnlineRegistrationStatus): RegistrationStatusCopy {
  switch (status) {
    case 'pending':
      return {
        label: 'ХҮСЭЛТ ИЛГЭЭСЭН',
        headline: 'ТА БҮРТГҮҮЛЭХ ХҮСЭЛТ ИЛГЭЭСЭН',
        detail: 'Зохион байгуулагч хянаж байна',
        tone: 'amber',
        canEdit: true,
      };
    case 'waitlisted':
      return {
        label: 'ХҮЛЭЭЛГИЙН ЖАГСААЛТАД',
        headline: 'ТА ХҮЛЭЭЛГИЙН ЖАГСААЛТАД БАЙНА',
        detail: 'Орон тоо гарвал зохион байгуулагч баталгаажуулна',
        tone: 'amber',
        canEdit: true,
      };
    case 'approved':
      return { label: 'БҮРТГЭЛ БАТАЛГААЖСАН', headline: 'БҮРТГЭЛ БАТАЛГААЖСАН', detail: null, tone: 'green', canEdit: true };
    case 'cancelled':
      return {
        label: 'ЦУЦЛАГДСАН',
        headline: 'БҮРТГЭЛ ЦУЦЛАГДСАН',
        detail: 'Асуух зүйл байвал зохион байгуулагчтай холбогдоно уу',
        tone: 'muted',
        canEdit: false,
      };
    case 'rejected':
      return {
        label: 'ТАТГАЛЗСАН',
        headline: 'БҮРТГЭЛЭЭС ТАТГАЛЗСАН',
        detail: 'Асуух зүйл байвал зохион байгуулагчтай холбогдоно уу',
        tone: 'red',
        canEdit: false,
      };
  }
}

/** Each tone's ink — the same values as theme.css's .oc-rs-* badge rules,
 *  for text that is not a badge (the panel heading). */
export const STATUS_TONE_COLOR: Record<StatusTone, string> = {
  amber: '#E0A020',
  green: '#4FD07A',
  muted: '#6E6A62',
  red: '#E8543C',
};


/** Why this athlete cannot start solving, or null when they can.
 *
 *  APPROVED ONLY (D7) — the same rule the roster and the ТАМИРЧИН count
 *  use. The dashboard asks this instead of hiding the button silently: a
 *  pending athlete who finds Эхлүүлэх gone needs to know it is the review
 *  and not a bug, and a rejected one needs to know it is not coming back.
 *
 *  ── THIS IS A UI COURTESY, NOT A CONTROL ──
 *  Nothing here stops anyone. The solve page does not read a registration,
 *  and firestore.rules lets any signed-in athlete write their own
 *  onlineSubmissions doc, so an athlete who opens the solve URL directly
 *  still solves and still submits. The server-side gate is PR-3.
 *
 *  `label` is the status badge's own word, so the row chip and the badge
 *  above it cannot disagree. */
export function competeGateCopy(status: OnlineRegistrationStatus): { label: string; message: string } | null {
  if (status === 'approved') return null;
  const { label } = registrationStatusCopy(status);
  switch (status) {
    case 'pending':
      return { label, message: 'Бүртгэл баталгаажаагүй тул эхлүүлэх боломжгүй. Зохион байгуулагч хянаж байна.' };
    case 'waitlisted':
      return {
        label,
        message: 'Хүлээлгийн жагсаалтад байгаа тул эхлүүлэх боломжгүй. Орон тоо гарч баталгаажсаны дараа нээгдэнэ.',
      };
    case 'cancelled':
      return { label, message: 'Бүртгэл цуцлагдсан тул энэ тэмцээнд оролцохгүй.' };
    case 'rejected':
      return { label, message: 'Бүртгэлээс татгалзсан тул энэ тэмцээнд оролцохгүй.' };
  }
}
