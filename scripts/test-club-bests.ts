// Standalone correctness check for lib/club-bests.ts (the personal-bests /
// club-records summary and the PR/TR badges derived from it). No test runner
// in this project — plain script, like scripts/test-scramble-import.ts. Run via:
//   npx tsc lib/club-bests.ts scripts/test-club-bests.ts \
//     --outDir .tmp-test-build --module commonjs --target es2020 --esModuleInterop --skipLibCheck
//   node .tmp-test-build/scripts/test-club-bests.js

import { computeClubBests, computeLocalBadges, type ClubBests } from '../lib/club-bests';

let failures = 0;

function check(label: string, pass: boolean, detail?: unknown) {
  if (pass) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}`);
    if (detail !== undefined) console.log('      got: ' + JSON.stringify(detail));
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), actual);
}

const CLUB = new Set(['A', 'B', 'C', 'D']);
let seq = 0;
/** A club result; `over` overrides anything. */
const res = (athleteId: string, single: number | null, average: number | null, over: Record<string, unknown> = {}) => ({
  id: `r${++seq}`, athleteId, eventId: '333', competitionId: 'live', round: 1,
  single, average, status: 'published', source: 'entry', ...over,
});
/** "TR+PR" / "PR" / "" for one value of one result. */
const tag = (badges: ReturnType<typeof computeLocalBadges>, id: string, type: 'single' | 'average') => {
  const b = badges[id]?.[type];
  return [b?.tr ? 'TR' : '', b?.pr ? 'PR' : ''].filter(Boolean).join('+');
};

// ═══ The summary ═════════════════════════════════════════════════════════════

{
  const results = [
    res('A', 900, 1000, { competitionId: 'old1' }),
    res('A', 850, 1100, { competitionId: 'old2' }),            // better single, worse average
    res('B', 800, 950, { competitionId: 'old1' }),
    res('A', 100, 100, { competitionId: 'live' }),               // live competition — not counted
    res('A', 700, 700, { competitionId: 'old1', source: 'imported' }),
    res('A', 700, 700, { competitionId: 'old1', source: 'import' }),
    res('', 600, 600, { competitionId: 'old1', source: 'imported' }),
    res('Z', 500, 500, { competitionId: 'old1' }),               // not on the roster
    res('A', 650, 650, { competitionId: 'old1', status: 'draft' }),
    res('A', 640, 640, { competitionId: 'old1', isPlaceholder: true }),
    res('B', -1, -1, { competitionId: 'old2' }),                 // DNF
    res('B', -2, null, { competitionId: 'old2' }),               // DNS / no average
    res('C', 55, 60, { competitionId: 'old1' }),                 // implausibly fast for 3x3 (floor 3.00)
    res('C', 45, 60, { competitionId: 'old1', eventId: '222' }), // fine for 2x2 (floor 0.30)
    res('D', 1500, null, { competitionId: 'old2', eventId: '666' }),
  ];
  const bests = computeClubBests(results, new Set(['old1', 'old2']), CLUB);
  eq('summary: per-athlete best single and average, each taken separately', bests.athletes.A['333'], { s: 850, a: 1000 });
  eq('summary: club best per event (the TR)', bests.club['333'], { s: 800, a: 950 });
  eq('summary: a live competition, imported rows, non-roster athletes, drafts and placeholders are not counted',
    [bests.athletes.A['333'].s, 'Z' in bests.athletes, '' in bests.athletes], [850, false, false]);
  eq('summary: DNF/DNS never become a best', bests.athletes.B['333'], { s: 800, a: 950 });
  eq('summary: an implausibly fast time is ignored; the per-event floor lets a real 2x2 time through',
    [bests.athletes.C['333'], bests.athletes.C['222']], [undefined, { s: 45, a: 60 }]);
  eq('summary: no average → only the single is stored (no null/undefined keys)', [bests.athletes.D['666'], bests.club['666']], [{ s: 1500 }, { s: 1500 }]);
  check('summary: values are integer centiseconds exactly as stored (nothing rounded)',
    Object.values(bests.athletes).every(ev => Object.values(ev).every(p => Object.values(p).every(v => Number.isInteger(v)))));
  eq('summary: nothing finished → empty', computeClubBests(results, new Set(), CLUB), { athletes: {}, club: {} });
}

// ═══ PR / TR badges ══════════════════════════════════════════════════════════

const BESTS: ClubBests = {
  athletes: {
    A: { '333': { s: 800, a: 900 } },
    B: { '333': { s: 850, a: 950 } },
    // C and D have no previous results at all
  },
  club: { '333': { s: 800, a: 900 } },
};

{
  // Final slower than round 1 → no PR in the final.
  const r1 = res('B', 780, 840), fin = res('B', 790, 860, { round: 2 });
  const b = computeLocalBadges([fin, r1], BESTS, CLUB); // given out of order on purpose
  eq('final slower than R1: round 1 is the PR (and TR)…', [tag(b, r1.id, 'single'), tag(b, r1.id, 'average')], ['TR+PR', 'TR+PR']);
  eq('…and the slower final gets nothing, although it beats the pre-competition best', [tag(b, fin.id, 'single'), tag(b, fin.id, 'average')], ['', '']);

  const fin2 = res('B', 770, 845, { round: 2 });
  const b2 = computeLocalBadges([r1, fin2], BESTS, CLUB);
  eq('single and average are judged separately: faster single in the final, slower average',
    [tag(b2, fin2.id, 'single'), tag(b2, fin2.id, 'average')], ['TR+PR', '']);

  const tieFin = res('B', 780, 840, { round: 2 });
  eq('a final that TIES the round-1 value counts (beat or tie)',
    [tag(computeLocalBadges([r1, tieFin], BESTS, CLUB), tieFin.id, 'single'), tag(computeLocalBadges([r1, tieFin], BESTS, CLUB), tieFin.id, 'average')], ['TR+PR', 'TR+PR']);
}

{
  // Two club athletes beat the TR in the same round → only the best gets it.
  const a = res('A', 750, 880), b = res('B', 760, 870);
  const badges = computeLocalBadges([a, b], BESTS, CLUB);
  eq('same round, both under the old TR single (8.00): only the faster gets TR; the other still has a PR',
    [tag(badges, a.id, 'single'), tag(badges, b.id, 'single')], ['TR+PR', 'PR']);
  eq('…and separately for the average, where the other athlete is the faster one',
    [tag(badges, a.id, 'average'), tag(badges, b.id, 'average')], ['PR', 'TR+PR']);
  const swapped = computeLocalBadges([b, a], BESTS, CLUB);
  eq('entry order within a round does not matter', [swapped[a.id], swapped[b.id]], [badges[a.id], badges[b.id]]);
}

{
  // Tie for the round's best → both get TR.
  const a = res('A', 750, 880), b = res('B', 750, 880), c = res('C', 760, 890);
  const badges = computeLocalBadges([a, b, c], BESTS, CLUB);
  eq('tie for the best of the round: both share the TR', [tag(badges, a.id, 'single'), tag(badges, b.id, 'single')], ['TR+PR', 'TR+PR']);
  eq('…for the average too', [tag(badges, a.id, 'average'), tag(badges, b.id, 'average')], ['TR+PR', 'TR+PR']);
  eq('the third, also under the old TR but not the best, gets PR only', tag(badges, c.id, 'single'), 'PR');
  const tieOld = res('A', 800, 900);
  eq('tying the EXISTING club record counts as TR', [tag(computeLocalBadges([tieOld], BESTS, CLUB), tieOld.id, 'single'), tag(computeLocalBadges([tieOld], BESTS, CLUB), tieOld.id, 'average')], ['TR+PR', 'TR+PR']);
}

{
  // Athlete with no previous bests → PR.
  const c = res('C', 1200, 1300);
  const badges = computeLocalBadges([c], BESTS, CLUB);
  eq('no previous bests: first result is a PR (not a TR — the club best is faster)', [tag(badges, c.id, 'single'), tag(badges, c.id, 'average')], ['PR', 'PR']);
  const c2 = res('C', 1250, 1250, { round: 2 });
  const b2 = computeLocalBadges([c, c2], BESTS, CLUB);
  eq('…and from then on their own round 1 is the bar', [tag(b2, c2.id, 'single'), tag(b2, c2.id, 'average')], ['', 'PR']);
  const first = res('D', 4000, 4500, { eventId: '555' });
  eq('an event the club has no record in at all: the first result is TR and PR',
    tag(computeLocalBadges([first], BESTS, CLUB), first.id, 'single'), 'TR+PR');
}

{
  // TR across rounds: a later round must beat the earlier rounds' best too.
  const r1a = res('A', 750, 880), r2b = res('B', 760, 870, { round: 2 }), r2a = res('A', 740, 885, { round: 2 });
  const badges = computeLocalBadges([r1a, r2b, r2a], BESTS, CLUB);
  eq('round 2: single — A improves on round 1\'s TR and takes it again; B (best average of round 2) takes the average TR',
    [tag(badges, r2a.id, 'single'), tag(badges, r2b.id, 'single'), tag(badges, r2a.id, 'average'), tag(badges, r2b.id, 'average')],
    ['TR+PR', 'PR', '', 'TR+PR']);
  const slowRound = res('B', 790, 890, { round: 2 });
  const b3 = computeLocalBadges([r1a, slowRound], BESTS, CLUB);
  eq('a later round whose best is under the OLD TR but slower than round 1 sets no TR (still a PR for B)',
    [tag(b3, slowRound.id, 'single'), tag(b3, slowRound.id, 'average')], ['PR', 'PR']);
}

{
  // What never gets a badge.
  const dnf = res('A', -1, -1), imp = res('', 500, 500, { source: 'imported' }), ph = res('B', null, null, { isPlaceholder: true, status: 'draft' });
  const typo = res('C', 55, 60), other = res('Z', 500, 500), slow = res('A', 900, 1000);
  const badges = computeLocalBadges([dnf, imp, ph, typo, other, slow], BESTS, CLUB);
  eq('DNF, imported rows, placeholders, implausible times, non-roster athletes and slower results: no badges', badges, {});
  const real = res('B', 780, 840);
  eq('an imported row faster than everyone does not take the round\'s TR from a club athlete',
    tag(computeLocalBadges([imp, real], BESTS, CLUB), real.id, 'single'), 'TR+PR');
  eq('a typo\'d 0.55 does not take the TR either', tag(computeLocalBadges([typo, real], BESTS, CLUB), real.id, 'single'), 'TR+PR');
  eq('no summary loaded (null) → no badges at all, rather than everything looking like a first PR', computeLocalBadges([real], null, CLUB), {});
  const ev2 = res('A', 100, 120, { eventId: '222' });
  eq('events are independent: a 2x2 result is judged against 2x2 bests only',
    tag(computeLocalBadges([ev2, slow], BESTS, CLUB), ev2.id, 'single'), 'TR+PR');
  const before = JSON.stringify(BESTS);
  computeLocalBadges([real, res('A', 700, 800)], BESTS, CLUB);
  eq('the summary passed in is not mutated', JSON.stringify(BESTS), before);
}

console.log(failures === 0 ? '\nAll club-bests checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
