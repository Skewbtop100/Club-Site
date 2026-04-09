const en = {
  // NAV
  'nav.rankings': 'Rankings',
  'nav.records': 'Records',
  'nav.competitions': 'Competitions',
  'nav.live': 'Live',
  'nav.athletes': 'Athletes',
  'nav.sign-in': 'Sign In',
  'nav.sign-out': 'Sign Out',
  'nav.my-profile': '🐣 My Profile',
  'nav.my-profile-short': 'My Profile',
  'nav.admin': '⚡ Admin',
  'nav.admin-short': 'Admin Dashboard',
  'nav.homepage': '⌂ Homepage',

  // HERO
  'hero.badge': 'WCA-Style Competition Platform',
  'hero.subtitle': 'COMPETITION PORTAL',
  'hero.desc':
    "Official results, live standings, athlete rankings, and competition management for Mongolia's competitive speedcubing community.",
  'hero.btn-rankings': 'View Rankings',
  'hero.btn-competitions': 'Competitions',
  'hero.scroll': 'Scroll',

  // STATS
  'stats.athletes': 'Athletes',
  'stats.competitions': 'Competitions',
  'stats.events-supported': 'Events Supported',

  // SECTIONS
  'section-tag.leaderboard': 'LEADERBOARD',
  'section-title.rankings': 'Event Rankings',
  'section-desc.rankings':
    'Best single and average results across all WCA events. Ranked by single time, lowest first.',
  'section-tag.records': 'RECORDS',
  'section-title.records': 'Club Records',
  'section-desc.records':
    'The best single and average ever recorded in each WCA event within our club competitions.',
  'section-tag.competitions': 'COMPETITIONS',
  'section-title.competitions': 'Competition Schedule',
  'section-tag.live': 'LIVE',
  'section-title.live': 'Live Results',
  'section-tag.athletes': 'ATHLETES',
  'section-title.athletes': 'Club Athletes',
  'section-desc.athletes': 'Our competitive speedcubers.',

  // RESULTS
  'result.saved': 'Saved',
  'result.save-failed': 'Save failed',

  // ATHLETE DASHBOARD
  'dash.loading': 'Loading your profile…',
  'dash.personal-records': 'Personal Records',
  'dash.comp-history': 'Competition History',
  'dash.no-results': 'No published results yet. Compete to see your stats here!',
  'dash.stat.competitions': 'Competitions',
  'dash.stat.events': 'Events',
  'dash.stat.solves': 'Solves',

  // LIVE
  'live.empty-heading': 'No live competition right now',
  'live.empty-sub': 'When a competition goes live, real-time results will appear here.',

  // THEME / LANG
  'theme.dark': '🌑 Dark',
  'theme.light': '☀ Light',
  'theme.purple': '💜 Purple',
  'lang.label': 'Language',
  'theme.label': 'Theme',
} as const;

export type TranslationKey = keyof typeof en;
export default en;
