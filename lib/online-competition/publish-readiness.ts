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
  /** `label` is supplied by the caller (onlineCompEventLabel) so this
   *  module stays free of the event catalogue — an incomplete event is
   *  named in the status word, and "3x3x3" is more use than "333". */
  events: { eventId: string; label: string; rounds: number }[];
}

export type ReadinessKey = 'general' | 'images' | 'events';

interface RequirementSpec {
  key: ReadinessKey;
  /** The checklist row's own text. */
  label: string;
  /** Names the requirement inside the disabled-publish reason, where the
   *  row label's verb ("бөглөгдсөн") would read as a claim that it IS. */
  shortLabel: string;
  /** Whether an unmet state stops the publish.
   *
   *  Ерөнхий and Төрөл are blocking: without a name, a start time or an
   *  event there is nothing an athlete could register for. Зураг is not —
   *  a competition with no poster is ugly, not broken, so it shows amber
   *  and publishes anyway. */
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

/** The events entry already words itself in full ("ТӨРӨЛ ОРООГҮЙ"); the
 *  field-name entries want a single trailing ДУТУУ. Distinguished by
 *  whether a part already ends in a state word, which keeps the specs
 *  writing plain field names in the common case. */
function joinMissing(missing: string[]): string {
  const joined = missing.join(' · ');
  return /(?:ОРООГҮЙ|РАУНДГҮЙ)$/.test(joined) ? joined : `${joined} ДУТУУ`;
}
