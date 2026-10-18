// Standalone correctness check for the results-entry round rules
// (lib/round-progress.ts), the scramble-derived group count
// (lib/scramble-import.ts groupOptions) and DNS handling (ranking,
// advancement, records). No test runner in this project — plain script, like
// scripts/test-judge.ts. Every fixture is in-memory with a testdata- prefix;
// nothing here reads or writes Firestore. Run via `npm run test:rounds`.

import {
  athleteEventIds, isRegisteredFor, registrationsMap, roundStateFor, openRound,
  missingAthletes, buildDnsResult, clubResultId, roundKey,
} from '../lib/round-progress';
import { groupOptions } from '../lib/scramble-import';
import { compareRoundResults, isDnsResult, DNS_VALUE } from '../lib/results-entry-helpers';
import { computeAdvancing } from '../lib/staged-reveal';
import { computeClubBests } from '../lib/club-bests';
import type { Competition, Result } from '../lib/types';

let failures = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`PASS  ${label}`);
  else { failures++; console.log(`FAIL  ${label}\n      expected ${e}\n      got      ${a}`); }
}

// ── fixtures ────────────────────────────────────────────────────────────────

const COMP = 'testdata-comp-rounds';
const A = 'testdata-ath-a', B = 'testdata-ath-b', C = 'testdata-ath-c', D = 'testdata-ath-d';

function comp(over: Partial<Competition> = {}): Competition {
  return {
    id: COMP, name: 'testdata Rounds Open', status: 'live',
    events: { '333': true, '222': true, '444': true },
    athletes: [
      { id: A, name: 'Alpha', events: ['333', '444'] },
      { id: B, name: 'Bravo', events: ['333'] },
      { id: C, name: 'Charlie', events: ['222', '333'] },
    ],
    eventConfig: {
      '333': { rounds: 3, advancement: { '1': { type: 'fixed', value: 2 }, '2': { type: 'fixed', value: 1 } } },
      '222': { rounds: 1 },
      '444': { rounds: 2, groups: 3, advancement: { '1': { type: 'percent', value: 50 } } },
    },
    roundStatus: {},
    ...over,
  };
}

let seq = 0;
function res(athleteId: string, round: number, avg: number | null, over: Partial<Result> = {}): Result {
  const single = avg === null ? null : avg - 50;
  return {
    id: `testdata-res-${++seq}`, competitionId: COMP, eventId: '333', athleteId, athleteName: athleteId,
    round, single, average: avg, solves: avg === null ? [] : [avg, avg, avg, avg, avg],
    status: 'published', source: 'entry', ...over,
  };
}
const placeholder = (athleteId: string, round: number, over: Partial<Result> = {}) =>
  res(athleteId, round, null, { single: null, status: 'draft', isPlaceholder: true, ...over });

const ORDER = ['333', '222', '444'];

// ── CHANGE 1: event dropdown filtered to the athlete's events ──────────────

eq('events: athlete sees only their registered events, in competition order', athleteEventIds(comp(), A, ORDER), ['333', '444']);
eq('events: another athlete, other list', athleteEventIds(comp(), C, ORDER), ['333', '222']);
eq('events: no athlete chosen yet → every competition event', athleteEventIds(comp(), '', ORDER), ORDER);
eq('events: athlete not on the roster → none', athleteEventIds(comp(), 'testdata-stranger', ORDER), []);
eq('events: competition without a roster (legacy) → every event', athleteEventIds(comp({ athletes: undefined }), A, ORDER), ORDER);
eq('events: registration ignores events the competition dropped', athleteEventIds(comp(), A, ['333']), ['333']);
eq('registered: yes / no / legacy',
  [isRegisteredFor(comp(), A, '444'), isRegisteredFor(comp(), B, '444'), isRegisteredFor(comp({ athletes: undefined }), B, '444')],
  [true, false, true]);
eq('registrationsMap: athleteId → eventId → true (what firestore.rules reads)',
  registrationsMap(comp().athletes!), { [A]: { '333': true, '444': true }, [B]: { '333': true }, [C]: { '222': true, '333': true } });

// ── CHANGE 2: only the current round is open ───────────────────────────────

{
  const c = comp();
  eq('round: no result yet → round 1 open', roundStateFor(c, [], A, '333'), { kind: 'open', round: 1 });
  eq('round: not registered for the event → locked', roundStateFor(c, [], B, '444'), { kind: 'not-registered' });

  const r1 = [res(A, 1, 900), res(B, 1, 1000), res(C, 1, 1100)];
  eq('round: finished round 1, not yet complete → waiting (round 1 locked)', roundStateFor(c, r1, A, '333'), { kind: 'waiting', round: 1 });
  eq('round: a placeholder alone does not open round 2 while round 1 is ongoing',
    roundStateFor(c, [...r1, placeholder(A, 2)], A, '333'), { kind: 'waiting', round: 1 });

  const done1 = comp({ roundStatus: { [roundKey('333', 1)]: 'complete' } });
  const adv = [...r1, placeholder(A, 2), placeholder(B, 2)];
  eq('round: round 1 complete + advanced → round 2 open', roundStateFor(done1, adv, A, '333'), { kind: 'open', round: 2 });
  eq('round: round 1 complete, did not advance → "Дараагийн раундад шалгараагүй"', roundStateFor(done1, adv, C, '333'), { kind: 'not-advanced', round: 1 });
  eq('round: openRound() of a locked state is null', [openRound(roundStateFor(done1, adv, C, '333')), openRound(roundStateFor(done1, adv, A, '333'))], [null, 2]);

  const r2 = [...adv.filter(r => !(r.athleteId === A && r.round === 2)), res(A, 2, 880)];
  eq('round: finished round 2 → waiting on round 2', roundStateFor(done1, r2, A, '333'), { kind: 'waiting', round: 2 });
  const done2 = comp({ roundStatus: { '333_r1': 'complete', '333_r2': 'complete' } });
  eq('round: round 2 completed without their result → missed (locked)', roundStateFor(done2, r2, B, '333'), { kind: 'missed', round: 2 });
  const final = [...r2, res(A, 3, 870)];
  eq('round: result in the final round → finished, nothing open',
    roundStateFor(comp({ roundStatus: { '333_r1': 'complete', '333_r2': 'complete' } }), final, A, '333'), { kind: 'finished', round: 3 });
  eq('round: a single-round event, entered → finished', roundStateFor(c, [res(C, 1, 500, { eventId: '222' })], C, '222'), { kind: 'finished', round: 1 });
  eq('round: round 1 completed before they competed → missed',
    roundStateFor(comp({ roundStatus: { '444_r1': 'complete' } }), r1, A, '444'), { kind: 'missed', round: 1 });
  eq('round: other competitions\' results are ignored',
    roundStateFor(c, [res(A, 1, 900, { competitionId: 'testdata-other' })], A, '333'), { kind: 'open', round: 1 });
  const withD = comp({ roundStatus: { '333_r1': 'complete' }, athletes: [...comp().athletes!, { id: D, name: 'Delta', events: ['333'] }] });
  eq('round: registered DNS athlete, round 1 complete → did not advance',
    roundStateFor(withD, [res(D, 1, null, { solves: [-2, -2, -2, -2, -2], single: -2, dns: true })], D, '333'), { kind: 'not-advanced', round: 1 });
}

// ── CHANGE 3: group count from imported scrambles ──────────────────────────

{
  const grp = { main: ['R U'], extra: [] };
  eq('groups: event-round with 3 imported scramble groups → 3', groupOptions(undefined, { A: grp, B: grp, C: grp }), [1, 2, 3]);
  eq('groups: no scrambles imported → 1', groupOptions(undefined, undefined), [1]);
  eq('groups: legacy stored value used only when nothing is imported', [groupOptions(3), groupOptions(3, { A: grp, B: grp })], [[1, 2, 3], [1, 2]]);
  eq('groups: round with an empty import record → fallback', groupOptions(undefined, {}), [1]);
}

// ── CHANGE 4: Mark Round Complete — missing club athletes ──────────────────

{
  const c = comp();
  eq('missing: round 1, nobody entered → every registered athlete', missingAthletes(c, [], '333', 1), [A, B, C]);
  eq('missing: round 1, some entered', missingAthletes(c, [res(A, 1, 900), res(C, 1, 1000)], '333', 1), [B]);
  eq('missing: imported rows never count (and never satisfy anyone)',
    missingAthletes(c, [res('', 1, 700, { source: 'imported', athleteName: 'Alpha' }), res(A, 1, 900), res(B, 1, 900)], '333', 1), [C]);
  eq('missing: an athlete registered for another event is not expected', missingAthletes(c, [], '222', 1), [C]);
  eq('missing: round 2 = only those who advanced into it (placeholders)',
    missingAthletes(c, [res(A, 1, 900), res(B, 1, 950), res(C, 1, 1000), placeholder(A, 2), placeholder(C, 2), res(C, 2, 990)], '333', 2), [A]);
  eq('missing: imported placeholders (imported athletes who advanced) are excluded',
    missingAthletes(c, [placeholder('', 2, { source: 'imported', athleteName: 'Ext' })], '333', 2), []);
  eq('missing: a DNS counts as resolved',
    missingAthletes(c, [res(A, 1, 900), res(C, 1, 900), { ...buildDnsResult(c, '333', 1, B, 'Bravo').data, id: 'x' }], '333', 1), []);
  eq('missing: everyone in → nothing to warn about', missingAthletes(c, [res(A, 1, 1), res(B, 1, 1), res(C, 1, 1)], '333', 1), []);
}

// ── CHANGE 5: DNS ───────────────────────────────────────────────────────────

{
  const c = comp();
  const dns = buildDnsResult(c, '333', 1, B, 'Bravo');
  eq('dns: overwrites the deterministic result id (replaces a placeholder)', dns.id, clubResultId(COMP, '333', 1, B));
  eq('dns: all attempts DNS, no average, published club entry',
    [dns.data.solves, dns.data.single, dns.data.average, dns.data.status, dns.data.source, dns.data.dns, dns.data.isPlaceholder],
    [[-2, -2, -2, -2, -2], DNS_VALUE, null, 'published', 'entry', true, undefined]);
  eq('dns: isDnsResult — flag, all-DNS solves, not a DNF or a mix',
    [isDnsResult(dns.data), isDnsResult({ solves: [-2, -2, -2, -2, -2] }), isDnsResult({ solves: [-1, -1, -1, -1, -1] }), isDnsResult({ solves: [-2, 900, -2, -2, -2] }), isDnsResult({ solves: [] })],
    [true, true, false, false, false]);

  const dnsRow: Result = { ...dns.data, id: dns.id };
  const dnfRow = res(C, 1, -1, { single: -1, solves: [-1, -1, -1, -1, -1] });
  const slow = res(A, 1, 2000);
  const ranked = [dnsRow, dnfRow, slow].sort(compareRoundResults).map(r => r.athleteId);
  eq('dns: ranked last — behind a time AND behind a DNF', ranked, [A, C, B]);
  eq('dns: still last for single-ranked events', [{ ...dnsRow, eventId: '444bf' }, { ...dnfRow, eventId: '444bf' }].sort(compareRoundResults).map(r => r.athleteId), [C, B]);

  // Fixed 2 advance from 3 entries where one is DNS: only the two who competed.
  const field = [res(A, 1, 900), dnsRow, res(C, 1, 1000)];
  eq('dns: never advances, even when the cut has room', computeAdvancing(field, { type: 'fixed', value: 3 }).map(r => r.athleteId), [A, C]);
  // 50% of the field that competed (2) = 1 — the DNS doesn't grow the field.
  eq('dns: not counted in a percent rule\'s field size', computeAdvancing(field, { type: 'percent', value: 50 }).map(r => r.athleteId), [A]);

  // Records / PR: a finished competition with only a DNS for B → no best for B.
  const bests = computeClubBests([dnsRow, res(A, 1, 900)], new Set([COMP]), new Set([A, B, C]));
  eq('dns: no PR / club best from a DNS', [bests.athletes[B] ?? null, bests.athletes[A]?.['333']], [null, { s: 850, a: 900 }]);
  eq('dns: never the club record', bests.club['333'], { s: 850, a: 900 });
}

console.log(failures === 0 ? '\nAll round-progress checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
