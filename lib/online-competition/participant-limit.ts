// ── The participant limit ───────────────────────────────────────────────
// Pure — no Firestore — so the arithmetic that decides whether an approval
// fits is unit-tested directly
// (tests/competition-fields/participant-limit.test.cjs). The transaction
// that makes it atomic is applyRegistrationPatch in admin-registrations.ts.
//
// `participantLimit` was displayed from the beginning and enforced by
// nothing: the review table showed "70/64" when an admin approved past it,
// honestly and uselessly.

export interface LimitCheckInput {
  /** uids currently approved for this competition. */
  approvedUids: string[];
  /** uids this patch is about to approve. */
  patchUids: string[];
  /** null = unlimited. */
  limit: number | null;
}

export type LimitCheck =
  | { ok: true }
  | {
      ok: false;
      /** Approved right now. May already exceed the limit — see below. */
      approved: number;
      limit: number;
      /** Places left, never negative. 0 when the competition is full or
       *  already over. */
      remaining: number;
      /** How many of the selected athletes are not already approved, i.e.
       *  how many places this patch actually needs. */
      needed: number;
    };

/** Would approving these athletes exceed the limit?
 *
 *  Counted over the UNION, not by adding: re-approving someone who is
 *  already approved takes no place, so a bulk that happens to include them
 *  is not refused for a place it does not need.
 *
 *  ALREADY OVER THE LIMIT is a state this has to handle rather than
 *  assume away — a competition could have been approved past its limit
 *  before any of this existed, or had its limit lowered afterwards.
 *  `remaining` clamps at 0 and any further approval is refused; nothing
 *  here un-approves anyone, because taking a place back from an athlete
 *  who was told they were in is a decision for a person, not a
 *  side effect of arithmetic.
 *
 *  UNLIMITED NEVER REFUSES. */
export function checkApprovalLimit(input: LimitCheckInput): LimitCheck {
  if (input.limit === null) return { ok: true };

  const approvedSet = new Set(input.approvedUids);
  const approved = approvedSet.size;
  const needed = input.patchUids.filter((uid) => !approvedSet.has(uid)).length;
  if (needed === 0) return { ok: true };

  const after = approved + needed;
  if (after <= input.limit) return { ok: true };

  return {
    ok: false,
    approved,
    limit: input.limit,
    remaining: Math.max(0, input.limit - approved),
    needed,
  };
}

/** What the admin is told. Mongolian, and it names the next step: the
 *  waitlist exists for exactly this, and a refusal that only says "no"
 *  leaves them to work out what to do with the athletes they selected. */
export function limitRefusalMessage(check: Extract<LimitCheck, { ok: false }>): string {
  const head =
    check.remaining === 0
      ? `Оролцогчийн тоо дүүрсэн байна (${check.approved}/${check.limit}).`
      : `Орон тоо хүрэлцэхгүй байна: ${check.remaining} орон зай үлдсэн, ${check.needed} тамирчин сонгосон.`;
  return `${head} Сонгосон тамирчдаа ХҮЛЭЭЛГЭНД шилжүүлж, орон тоо гармагц баталгаажуулж болно.`;
}
