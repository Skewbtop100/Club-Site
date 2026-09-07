// ── Тест өгөгдөл — seed/wipe fixture data ───────────────────────────────
// Pure definitions shared by the admin API route and the admin UI. No
// Firestore, no DOM.
//
// ══ How test data is identified — the safety mechanism ═════════════════
// Every document this feature creates gets a DOCUMENT ID beginning with
// `testdata-`, and the wipe selects on that id prefix and nothing else.
//
// The id prefix is the load-bearing part; the `isTestData: true` field
// written alongside it is descriptive only (it makes a doc obvious in the
// Firebase console) and is NEVER what the wipe queries on. That ordering
// is deliberate:
//
//   * A doc id is assigned once at creation and cannot be changed by any
//     later write, so a real doc can never drift into looking like test
//     data. A boolean field can — one bad merge, one mis-scoped update,
//     and a real athlete's doc carries `isTestData: true` and gets wiped.
//   * onlineParticipants is keyed by Firebase Auth uid, which is 28
//     characters of [A-Za-z0-9] and never contains a hyphen. A
//     `testdata-` id therefore cannot collide with any real athlete's
//     document, now or ever.
//
// ══ Why `testdata-` and not `test-` ════════════════════════════════════
// This database already contains a REAL competition whose id is
// `test-comp-1` — despite the name, it holds real athletes' real
// submissions. A `test-` prefix would match and destroy it. Every
// selector in this feature uses the full `testdata-` prefix, and the wipe
// asserts it per-document before issuing a delete.

/** The one true marker. Changing this invalidates every existing seed. */
export const TEST_DATA_PREFIX = 'testdata-';

/** Guard used before every single delete in the wipe. */
export function isTestDataId(id: string): boolean {
  return id.startsWith(TEST_DATA_PREFIX);
}

/** Season tag for the seeded finished competition, so season-points and
 *  rank pages have data to show. Prefixed like everything else so its
 *  onlineSeasonPoints subtree is wipeable by the same rule. */
export const TEST_SEASON = `${TEST_DATA_PREFIX}season-2026`;

export const TEST_COMPETITION_IDS = {
  upcoming: `${TEST_DATA_PREFIX}comp-upcoming`,
  live: `${TEST_DATA_PREFIX}comp-live`,
  finished: `${TEST_DATA_PREFIX}comp-finished`,
} as const;

export interface TestCompetitionSpec {
  id: string;
  name: string;
  description: string;
  status: 'upcoming' | 'live' | 'finished';
  /** Days from now for startAt — negative is in the past. */
  startOffsetDays: number;
  registrationOffsetDays: number;
  participantLimit: number | null;
  events: { eventId: string; label: string; rounds: number }[];
  season: string;
}

// "[ТЕСТ]" leads every name so these are unmistakable in the public hub,
// the competitions list, every admin dropdown and the rank page.
export const TEST_COMPETITIONS: TestCompetitionSpec[] = [
  {
    id: TEST_COMPETITION_IDS.upcoming,
    name: '[ТЕСТ] Удахгүй болох тэмцээн',
    description: 'Тест өгөгдөл. Бүртгэл нээлттэй, эхлээгүй тэмцээн.',
    status: 'upcoming',
    startOffsetDays: 14,
    registrationOffsetDays: 10,
    participantLimit: 40,
    events: [
      { eventId: '333', label: '3x3x3', rounds: 2 },
      { eventId: '222', label: '2x2x2', rounds: 1 },
    ],
    season: TEST_SEASON,
  },
  {
    id: TEST_COMPETITION_IDS.live,
    name: '[ТЕСТ] Явагдаж буй тэмцээн',
    description: 'Тест өгөгдөл. 1-р раунд нээлттэй, бодох боломжтой.',
    status: 'live',
    startOffsetDays: -1,
    registrationOffsetDays: -2,
    participantLimit: null,
    events: [
      { eventId: '333', label: '3x3x3', rounds: 3 },
      { eventId: '222', label: '2x2x2', rounds: 2 },
      { eventId: '333oh', label: '3x3x3 нэг гар', rounds: 1 },
    ],
    season: TEST_SEASON,
  },
  {
    id: TEST_COMPETITION_IDS.finished,
    name: '[ТЕСТ] Дууссан тэмцээн',
    description: 'Тест өгөгдөл. Дүн гарсан, шүүгдсэн илгээмжүүдтэй.',
    status: 'finished',
    startOffsetDays: -30,
    registrationOffsetDays: -35,
    participantLimit: 30,
    events: [
      { eventId: '333', label: '3x3x3', rounds: 2 },
      { eventId: '222', label: '2x2x2', rounds: 1 },
    ],
    season: TEST_SEASON,
  },
];

export type TestProfileStatus = 'incomplete' | 'pending' | 'approved' | 'rejected';

export interface TestAthleteSpec {
  /** Suffix only; the full uid is TEST_DATA_PREFIX + this. */
  slug: string;
  displayName: string;
  lastName: string;
  firstName: string;
  gender: 'male' | 'female';
  dateOfBirth: string;
  profileStatus: TestProfileStatus;
  /** Best single per event, centiseconds. Ao5 is derived from it. */
  pr: Record<string, number>;
}

/** 20 athletes with real-looking Mongolian names, a deliberate spread of
 *  profile states (13 approved / 3 pending / 2 incomplete / 2 rejected)
 *  and non-uniform per-event times so leaderboards, rank pages and
 *  dashboard stats all show a genuine distribution rather than a flat
 *  line. Times are in centiseconds. */
export const TEST_ATHLETES: TestAthleteSpec[] = [
  { slug: 'bat',      displayName: 'Батбаяр Ганзориг',    lastName: 'Ганзориг', firstName: 'Батбаяр',   gender: 'male',   dateOfBirth: '2003-04-12', profileStatus: 'approved',   pr: { '333': 684,  '222': 172, '333oh': 1240 } },
  { slug: 'saraa',    displayName: 'Сарантуяа Болд',      lastName: 'Болд',     firstName: 'Сарантуяа', gender: 'female', dateOfBirth: '2005-09-03', profileStatus: 'approved',   pr: { '333': 731,  '222': 195 } },
  { slug: 'temuulen', displayName: 'Тэмүүлэн Отгонбаяр',  lastName: 'Отгонбаяр', firstName: 'Тэмүүлэн', gender: 'male',   dateOfBirth: '2001-01-28', profileStatus: 'approved',   pr: { '333': 795,  '222': 210, '333oh': 1455 } },
  { slug: 'nomin',    displayName: 'Номин-Эрдэнэ Цэрэн',  lastName: 'Цэрэн',    firstName: 'Номин-Эрдэнэ', gender: 'female', dateOfBirth: '2007-06-17', profileStatus: 'approved', pr: { '333': 842,  '222': 233 } },
  { slug: 'ganbat',   displayName: 'Ганбат Дорж',         lastName: 'Дорж',     firstName: 'Ганбат',    gender: 'male',   dateOfBirth: '1999-11-05', profileStatus: 'approved',   pr: { '333': 903,  '222': 241, '333oh': 1602 } },
  { slug: 'anu',      displayName: 'Ануужин Мөнх',        lastName: 'Мөнх',     firstName: 'Ануужин',   gender: 'female', dateOfBirth: '2006-02-21', profileStatus: 'approved',   pr: { '333': 967,  '222': 258 } },
  { slug: 'enkhjin',  displayName: 'Энхжин Баатар',       lastName: 'Баатар',   firstName: 'Энхжин',    gender: 'female', dateOfBirth: '2004-07-30', profileStatus: 'approved',   pr: { '333': 1024, '222': 264, '333oh': 1718 } },
  { slug: 'tsogt',    displayName: 'Цогтбаатар Наран',    lastName: 'Наран',    firstName: 'Цогтбаатар', gender: 'male',  dateOfBirth: '2002-12-09', profileStatus: 'approved',   pr: { '333': 1088, '222': 287 } },
  { slug: 'khulan',   displayName: 'Хулан Ундрах',        lastName: 'Ундрах',   firstName: 'Хулан',     gender: 'female', dateOfBirth: '2008-03-14', profileStatus: 'approved',   pr: { '333': 1156, '222': 301 } },
  { slug: 'munkhbat', displayName: 'Мөнхбат Сүхээ',       lastName: 'Сүхээ',    firstName: 'Мөнхбат',   gender: 'male',   dateOfBirth: '2000-08-25', profileStatus: 'approved',   pr: { '333': 1213, '222': 318, '333oh': 1955 } },
  { slug: 'oyunaa',   displayName: 'Оюунтуяа Ганболд', lastName: 'Ганболд', firstName: 'Оюунтуяа', gender: 'female', dateOfBirth: '2003-05-19', profileStatus: 'approved', pr: { '333': 1302, '222': 342 } },
  { slug: 'erdene',   displayName: 'Эрдэнэбат Лхагва',    lastName: 'Лхагва',   firstName: 'Эрдэнэбат', gender: 'male',   dateOfBirth: '1998-10-02', profileStatus: 'approved',   pr: { '333': 1421, '222': 366 } },
  { slug: 'solongo',  displayName: 'Солонго Батжаргал',   lastName: 'Батжаргал', firstName: 'Солонго',  gender: 'female', dateOfBirth: '2009-01-11', profileStatus: 'approved',   pr: { '333': 1588, '222': 401 } },
  { slug: 'amgalan',  displayName: 'Амгалан Жаргал',      lastName: 'Жаргал',   firstName: 'Амгалан',   gender: 'male',   dateOfBirth: '2005-04-04', profileStatus: 'pending',    pr: { '333': 1044 } },
  { slug: 'delgermaa',displayName: 'Дэлгэрмаа Түвшин',    lastName: 'Түвшин',   firstName: 'Дэлгэрмаа', gender: 'female', dateOfBirth: '2007-11-23', profileStatus: 'pending',    pr: { '333': 1197, '222': 295 } },
  { slug: 'bilguun',  displayName: 'Билгүүн Энхтөр',      lastName: 'Энхтөр',   firstName: 'Билгүүн',   gender: 'male',   dateOfBirth: '2010-06-08', profileStatus: 'pending',    pr: {} },
  { slug: 'urangoo',  displayName: 'Урангоо Чимэд',       lastName: 'Чимэд',    firstName: 'Урангоо',   gender: 'female', dateOfBirth: '2006-09-27', profileStatus: 'incomplete', pr: {} },
  { slug: 'zorigt',   displayName: 'Зоригт Пүрэв',        lastName: 'Пүрэв',    firstName: 'Зоригт',    gender: 'male',   dateOfBirth: '2002-02-16', profileStatus: 'incomplete', pr: { '333': 1332 } },
  { slug: 'tuvshin',  displayName: 'Түвшинжаргал Алтан',  lastName: 'Алтан',    firstName: 'Түвшинжаргал', gender: 'male', dateOfBirth: '2001-07-07', profileStatus: 'rejected',  pr: { '333': 1477 } },
  { slug: 'sodnom',   displayName: 'Содномдаржаа Баяр',   lastName: 'Баяр',     firstName: 'Содномдаржаа', gender: 'male', dateOfBirth: '1997-03-30', profileStatus: 'rejected',  pr: { '333': 1655, '222': 430 } },
];

/** Which athletes (by index) register into which competition, and for
 *  which events. Deliberately uneven and overlapping — 8 upcoming, 12
 *  live, 15 finished — so nothing downstream can accidentally depend on
 *  "everyone is in everything". */
export const TEST_REGISTRATIONS: Record<keyof typeof TEST_COMPETITION_IDS, { index: number; events: string[] }[]> = {
  upcoming: [0, 1, 2, 3, 4, 5, 13, 16].map((index) => ({
    index,
    events: index % 3 === 0 ? ['333', '222'] : ['333'],
  })),
  live: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 17].map((index) => ({
    index,
    events: index % 4 === 0 ? ['333', '222', '333oh'] : index % 2 === 0 ? ['333', '222'] : ['333'],
  })),
  finished: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 19].map((index) => ({
    index,
    events: index % 3 === 0 ? ['333', '222'] : ['333'],
  })),
};

export interface WipeCounts {
  competitions: number;
  participants: number;
  registrations: number;
  submissions: number;
  roundState: number;
  qualifiers: number;
  scrambleData: number;
  groupAssignments: number;
  seasonPoints: number;
  cloudinaryDeleted: number;
}

export interface SeedCounts {
  competitions: number;
  participants: number;
  registrations: number;
  submissions: number;
  roundState: number;
}
