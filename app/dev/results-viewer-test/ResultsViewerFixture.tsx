'use client';

import { useState } from 'react';
import { CompetitionResultsView } from '@/components/shared/CompetitionResultsViewer';
import type { Athlete, Competition, Result, WcaRecords } from '@/lib/types';
import type { ClubBests } from '@/lib/club-bests';

// Dev-only fixture page for the live results viewer's layout (like the other
// app/dev/* pages): renders CompetitionResultsView with made-up data and no
// Firestore, so it can be checked — and screenshotted — at any width without
// a real competition. `?embedded=1` shows the judge page's embedded mode.
//
// The fixture deliberately contains the awkward cases: very long names with
// a local-script name, m:ss times, DNF/DNS, a 3-attempt event, an imported
// row matching a club athlete, club rows, a record, and next-round
// placeholders.

const ATHLETES: Athlete[] = [
  { id: 'c1', name: 'Тэмүүлэн', lastName: 'Цэрэндагва' },
  { id: 'c2', name: 'Orgil', lastName: 'Otgonbayar' },
  { id: 'c3', name: 'Urin-Uchralt', lastName: 'Bilguun' },
];

const COMP: Competition = {
  id: 'fixture', name: 'Mongolian Championship Mirror Open 2026 — Ulaanbaatar', status: 'live',
  events: { '333': true, '222': true, '666': true, '333bf': true },
  eventConfig: {
    '333': { rounds: 2, groups: 2, advancement: { '1': { type: 'fixed', value: 8 } } },
    '222': { rounds: 1, groups: 1 },
    '666': { rounds: 1, groups: 1 },
    '333bf': { rounds: 1, groups: 1 },
  },
  roundStatus: { '333_r1': 'complete', '333_r2': 'ongoing' },
};

const IMPORTED: [string, string, string][] = [
  ['Maximilian Alexander von Hohenzollern-Sigmaringen', '', 'Germany'],
  ['Orgil Otgonbayar', 'Отгонбаяр Оргил', 'Mongolia'],
  ['Jargalbayar Martsaikhan', 'Жаргалбаяр Марцайхан', 'Mongolia'],
  ['Yiheng Wang', '王艺衡', 'China'],
  ['Tymon Kolasiński', '', 'Poland'],
  ['Xuanyi Geng', '耿暄一', 'China'],
  ['Ruihang Xu', '许瑞航', 'China'],
  ['Luke Garrett', '', 'United States'],
  ['Matty Hiroto Inaba', '稲葉 仁人', 'United States'],
  ['Leo Borromeo', '', 'Philippines'],
  ['Bill Wang', '', 'Canada'],
  ['Zayn Khanani', '', 'United States'],
  ['Twan Dullemond', '', 'Netherlands'],
  ['Temuulen Tserendagva-Batbayar Ganzorigiin', 'Цэрэндагва Тэмүүлэн', 'Mongolia'],
];

function ao5(solves: number[]): number {
  if (solves.filter(v => v < 0).length >= 2) return -1;
  const sorted = [...solves].sort((a, b) => (a < 0 ? 1 : b < 0 ? -1 : a - b)).slice(1, 4);
  return sorted.some(v => v < 0) ? -1 : Math.round(sorted.reduce((s, v) => s + v, 0) / 3);
}
const best = (solves: number[]) => { const v = solves.filter(x => x > 0); return v.length ? Math.min(...v) : -1; };

function row(id: string, over: Partial<Result> & { solves: number[] }): Result {
  return {
    id, competitionId: 'fixture', eventId: '333', round: 1, athleteId: '', status: 'published', source: 'entry',
    single: best(over.solves), average: over.solves.length === 5 ? ao5(over.solves) : null, ...over,
  };
}

const RESULTS: Result[] = [
  // 3x3 round 1 — club
  row('r1c1', { athleteId: 'c1', solves: [744, 732, 722, 822, 730], judgeAthleteId: 'c2', judgeName: 'Orgil Otgonbayar', group: 1 }),
  row('r1c2', { athleteId: 'c2', solves: [905, 841, 990, 1005, 880], judgeAthleteId: 'c1', judgeName: 'Тэмүүлэн Цэрэндагва', group: 2 }),
  row('r1c3', { athleteId: 'c3', solves: [-1, -1, 8699, 7113, 3726], judgeAthleteId: 'c1', judgeName: 'Тэмүүлэн Цэрэндагва', group: 1 }),
  // 3x3 round 1 — imported
  ...IMPORTED.map(([name, localName, country], i): Result => row(`r1i${i}`, {
    source: 'imported', athleteName: name, ...(localName ? { localName } : {}), country,
    ...(name === 'Orgil Otgonbayar' ? { matchedClubAthleteId: 'c2' } : {}),
    solves: i === 12 ? [-1, -1, -1, -2, -2] : [686 + i * 47, 672 + i * 51, 577 + i * 44, 914 + i * 39, 608 + i * 55],
  })),
  // 3x3 round 2 — two results, the rest qualified but not competed yet
  row('r2c1', { round: 2, athleteId: 'c1', solves: [701, 688, 655, 790, 712], judgeAthleteId: 'c2', judgeName: 'Orgil Otgonbayar', group: 1 }),
  row('r2i0', { round: 2, source: 'imported', athleteName: IMPORTED[0][0], country: 'Germany', solves: [690, 702, 644, 801, 733] }),
  ...['c2', ''].map((athleteId, i): Result => ({
    id: `r2ph${i}`, competitionId: 'fixture', eventId: '333', round: 2, athleteId,
    athleteName: athleteId ? '' : IMPORTED[3][0], single: null, average: null, solves: [],
    status: 'draft', source: athleteId ? 'entry' : 'imported', isPlaceholder: true,
  })),
  // 6x6 — three attempts, m:ss
  row('s6a', { eventId: '666', source: 'imported', athleteName: 'Max Park', country: 'United States', solves: [5903, 6104, 6250], average: 6086 }),
  row('s6b', { eventId: '666', athleteId: 'c1', solves: [13950, 14520, 15001], average: 14490, judgeName: 'Orgil Otgonbayar' }),
];

// A threshold the club's best average beats, so a badge is on screen.
const WCA_RECORDS: WcaRecords = { '333': { average: { NR: { value: 7.5 } }, single: { NR: { value: 7.0 } } } };

// Bests "before this competition": c2 improves on theirs (PR), c1 holds the
// club record and beats it (TR, shown as NR where the threshold above applies).
const CLUB_BESTS: ClubBests = {
  athletes: { c1: { '333': { s: 740, a: 760 }, '666': { s: 14500, a: 15000 } }, c2: { '333': { s: 900, a: 1000 } } },
  club: { '333': { s: 740, a: 760 }, '666': { s: 14500, a: 15000 } },
};

export default function ResultsViewerFixture() {
  const [open, setOpen] = useState(true);
  const embedded = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('embedded');
  if (!open) {
    return <div style={{ padding: '1rem' }}><button className="btn-sm-primary" onClick={() => setOpen(true)}>Open viewer</button></div>;
  }
  return (
    <div style={embedded ? { padding: '1rem', background: 'var(--bg)', minHeight: '100vh' } : undefined}>
      <CompetitionResultsView
        comp={COMP} results={RESULTS} athletes={ATHLETES} wcaRecords={WCA_RECORDS} clubBests={CLUB_BESTS}
        loading={false} isLive embedded={embedded} onClose={() => setOpen(false)}
      />
    </div>
  );
}
