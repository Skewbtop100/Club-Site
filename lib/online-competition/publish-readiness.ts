// ── Publish readiness ───────────────────────────────────────────────────
// What the Хянах tab checks before a draft may be announced, as a pure
// function of the editor's current values. No React, no fetch, no clock —
// so it is unit-tested directly (tests/competition-fields/readiness.test.cjs)
// instead of through the component.
//
// The load-bearing idea here is that BLOCKING-NESS IS A PROPERTY OF THE
// REQUIREMENT, declared once in REQUIREMENT_SPECS, not an if-statement at
// the publish button. The button asks `canPublish` and never names a
// requirement; adding a fourth requirement (Хуваарь, Хураамж) means adding
// one spec entry and deciding its `blocking` flag there — the button, the
// checklist and the disabled-reason all follow automatically.

/** Exactly the editor state the checklist reads, in stored shapes rather
 *  than form shapes: ms timestamps, resolved round counts, resolved event
 *  labels. The caller converts; this module has no opinion on how a
 *  datetime-local string or a half-typed round count becomes one. */
export interface ReadinessInput {
  name: string;
  /** ms, or null when unset. */
  startAt: number | null;
  registrationDeadline: number | null;
  posterUrl: string | null;
  bannerUrl: string | null;
  /** The Төлбөргүй / Төлбөртэй toggle. When false the fee requirement is
   *  met outright — a free competition has nothing to configure. */
  paid: boolean;
  /** Whole tugrik, or null when unset. Only consulted when `paid`. */
  baseFeeMnt: number | null;
  /** `label` is supplied by the caller (onlineCompEventLabel) so this
   *  module stays free of the event catalogue — an incomplete event is
   *  named in the status word, and "3x3x3" is more use than "333".
   *
   *  `surchargeIncomplete` is an EDITOR-level fact with no stored
   *  equivalent: an event marked as costing extra whose amount has not
   *  been typed yet. In storage that state cannot exist (surchargeMnt is
   *  either a positive number or null-for-included), so the caller
   *  supplies it, the same way it supplies `label`. */
  events: { eventId: string; label: string; rounds: number; surchargeIncomplete?: boolean }[];
}

export type ReadinessKey = 'general' | 'images' | 'events' | 'fee';

interface RequirementSpec {
  key: ReadinessKey;
  /** The checklist row's own text. */
  label: string;
  /** Names the requirement inside the disabled-publish reason, where the
   *  row label's verb ("бөглөгдсөн") would read as a claim that it IS. */
  shortLabel: string;
  /** Whether an unmet state stops the publish.
   *
   *  Ерөнхий, Төрөл and Хураамж are blocking: without a name, a start
   *  time, an event, or — for a paid competition — a fee an athlete can
   *  read, there is nothing they could meaningfully register for. Зураг is
   *  not — a competition with no poster is ugly, not broken, so it shows
   *  amber and publishes anyway. */
  blocking: boolean;
  /** null when met; otherwise the missing PARTS, each already worded so
   *  it names what is absent. Joined into the status word by evaluate(). */
  missing: (input: ReadinessInput) => string[];
}

const REQUIREMENT_SPECS: RequirementSpec[] = [
  {
    key: 'general',
    label: 'Ерөнхий мэдээлэл бөглөгдсөн',
    shortLabel: 'Ерөнхий мэдээлэл',
    blocking: true,
    missing: (i) => {
      const out: string[] = [];
      if (!i.name.trim()) out.push('НЭР');
      if (i.startAt === null) out.push('ЭХЛЭХ ЦАГ');
      if (i.registrationDeadline === null) out.push('БҮРТГЭЛ ХААХ ЦАГ');
      return out;
    },
  },
  {
    key: 'images',
    label: 'Постер ба баннер орсон',
    shortLabel: 'Постер ба баннер',
    blocking: false,
    missing: (i) => {
      const out: string[] = [];
      if (!i.posterUrl) out.push('ПОСТЕР');
      if (!i.bannerUrl) out.push('БАННЕР');
      return out;
    },
  },
  {
    key: 'events',
    label: 'Төрөл ба раунд тохирсон',
    shortLabel: 'Төрөл ба раунд',
    blocking: true,
    missing: (i) => {
      if (i.events.length === 0) return ['ТӨРӨЛ ОРООГҮЙ'];
      // An event configured with no round cannot be entered either, and
      // naming which one saves the admin a hunt through the Төрөл tab.
      const roundless = i.events.filter((e) => e.rounds < 1);
      if (roundless.length > 0) {
        return [`${roundless.map((e) => e.label).join(' · ')} РАУНДГҮЙ`];
      }
      return [];
    },
  },
  {
    key: 'fee',
    label: 'Хураамж тохирсон',
    shortLabel: 'Хураамж',
    // Blocking: a paid competition with no fee set means an athlete
    // cannot know what they owe before they commit to entering.
    blocking: true,
    missing: (i) => {
      // A free competition has nothing to configure, so it is met
      // outright — not "vacuously passed", genuinely done. Any fee values
      // retained behind the toggle are irrelevant: nothing is charged.
      if (!i.paid) return [];
      const out: string[] = [];
      if (i.baseFeeMnt === null) out.push('СУУРЬ ХУРААМЖ ДУТУУ');
      // Named the way Төрөл names round-less events, for the same reason:
      // an admin should not have to open the tab to find out which row.
      const noAmount = i.events.filter((e) => e.surchargeIncomplete === true);
      if (noAmount.length > 0) out.push(`${noAmount.map((e) => e.label).join(' · ')} ДҮНГҮЙ`);
      return out;
    },
  },
];

/** The status word for a met requirement — one place, so the checklist and
 *  any future caller cannot disagree about it. */
export const READY_WORD = 'БЭЛЭН';

export interface ReadinessRequirement {
  key: ReadinessKey;
  label: string;
  shortLabel: string;
  blocking: boolean;
  met: boolean;
  /** Right-aligned status word: READY_WORD, or what is missing. */
  status: string;
}

export interface Readiness {
  /** In declaration order — the checklist renders this list as-is. */
  requirements: ReadinessRequirement[];
  /** True when every BLOCKING requirement is met. An unmet non-blocking
   *  one leaves this true by design. */
  canPublish: boolean;
  /** Why the publish button is disabled, or null when it is not. Built
   *  from the same specs, so it always names the actual offenders. */
  blockedReason: string | null;
}

export function evaluateReadiness(input: ReadinessInput): Readiness {
  const requirements: ReadinessRequirement[] = REQUIREMENT_SPECS.map((spec) => {
    const missing = spec.missing(input);
    // "НЭР · ЭХЛЭХ ЦАГ ДУТУУ" — the field names carry the information and
    // ДУТУУ is said once, rather than repeated per field.
    const status = missing.length === 0 ? READY_WORD : joinMissing(missing);
    return {
      key: spec.key,
      label: spec.label,
      shortLabel: spec.shortLabel,
      blocking: spec.blocking,
      met: missing.length === 0,
      status,
    };
  });

  const blockers = requirements.filter((r) => r.blocking && !r.met);
  return {
    requirements,
    canPublish: blockers.length === 0,
    blockedReason:
      blockers.length === 0
        ? null
        : `Зарлах боломжгүй: ${blockers.map((r) => `${r.shortLabel} — ${r.status}`).join(' · ')}`,
  };
}

/** Every state word a spec may use to word a part in full. A part ending
 *  in one of these says what is wrong by itself; anything else is a bare
 *  field name wanting a trailing ДУТУУ. */
const SELF_WORDED = /(?:ОРООГҮЙ|РАУНДГҮЙ|ДҮНГҮЙ|ДУТУУ)$/;

/** Joins the missing parts into one status word.
 *
 *  Bare field names ("НЭР", "ЭХЛЭХ ЦАГ") share a single trailing ДУТУУ, so
 *  it is said once rather than per field. A part already worded in full
 *  ("ТӨРӨЛ ОРООГҮЙ", "4x4x4 ДҮНГҮЙ") suppresses it.
 *
 *  Keyed on the LAST part, not on the joined string: the fee requirement
 *  can produce both kinds at once ("СУУРЬ ХУРААМЖ ДУТУУ" plus
 *  "4x4x4 ДҮНГҮЙ"), and testing the whole string would append a second
 *  ДУТУУ to a list that already ends in a state word. */
function joinMissing(missing: string[]): string {
  const joined = missing.join(' · ');
  return SELF_WORDED.test(missing[missing.length - 1]) ? joined : `${joined} ДУТУУ`;
}
