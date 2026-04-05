// ============================================================
//  Cube MN — Translation Dictionary (EN / MN)
//  Usage:
//    t('key')        — returns translated string for current lang
//    applyLang(lang) — applies lang to all [data-i18n] elements
//    initLang()      — reads localStorage and applies saved lang
// ============================================================

window.I18N = {
  en: {
    // ── NAV ──────────────────────────────────────────────────
    'nav.rankings':     'Rankings',
    'nav.records':      'Records',
    'nav.competitions': 'Competitions',
    'nav.live':         'Live',
    'nav.athletes':     'Athletes',
    'nav.sign-in':      'Sign In',
    'nav.sign-out':     'Sign Out',
    'nav.my-profile':       '🐣 My Profile',
    'nav.my-profile-short': 'My Profile',
    'nav.admin':            '⚡ Admin',
    'nav.admin-short':      'Admin Dashboard',
    'nav.homepage':         '⌂ Homepage',
    'gs.placeholder':       'Search…',
    'gs.type.athlete':      'Athlete',
    'gs.type.competition':  'Competition',
    'gs.no-results':        'No results',

    // ── HERO ─────────────────────────────────────────────────
    'hero.badge':           'WCA-Style Competition Platform',
    'hero.subtitle':        'COMPETITION PORTAL',
    'hero.desc':            "Official results, live standings, athlete rankings, and competition management for Mongolia's competitive speedcubing community.",
    'hero.btn-rankings':    'View Rankings',
    'hero.btn-competitions':'Competitions',
    'hero.scroll':          'Scroll',

    // ── STATS BAR ────────────────────────────────────────────
    'stats.athletes':        'Athletes',
    'stats.competitions':    'Competitions',
    'stats.events-supported':'Events Supported',

    // ── SECTION TAGS / TITLES / DESCS ────────────────────────
    'section-tag.leaderboard':   'LEADERBOARD',
    'section-title.rankings':    'Event Rankings',
    'section-desc.rankings':     'Best single and average results across all WCA events. Ranked by single time, lowest first.',
    'section-tag.records':       'RECORDS',
    'section-title.records':     'Club Records',
    'section-desc.records':      'The best single and average ever recorded in each WCA event within our club competitions.',
    'section-tag.competitions':  'COMPETITIONS',
    'section-title.competitions':'Competition Schedule',
    'section-tag.live':          'LIVE',
    'section-title.live':        'Live Results',
    'section-tag.athletes':      'ATHLETES',
    'section-title.athletes':    'Club Athletes',
    'section-desc.athletes':     'Our competitive speedcubers.',

    // ── LOGIN MODAL ──────────────────────────────────────────
    'login.tab-admin':       'Admin',
    'login.tab-athlete':     'Athlete',
    'login.admin-heading':   'Admin Sign In',
    'login.athlete-heading': 'Athlete Sign In',
    'login.username':        'Username',
    'login.password':        'Password',
    'login.admin-btn':       'Sign In',
    'login.athlete-btn':     'Sign In',
    'login.spinner':         'Checking credentials…',

    // ── ADMIN TABS ───────────────────────────────────────────
    'tab.athletes':    '👤 Athletes',
    'tab.competitions':'🏆 Competitions',
    'tab.results':     '✎ Results Entry',
    'tab.comp-results':'📋 Competition Results',
    'tab.history':     '📄 History',
    'tab.users':       '🔑 Users',

    // ── ADMIN HEADER ─────────────────────────────────────────
    'admin.title':    'Admin Dashboard',
    'admin.subtitle': 'Cube MN Competition Management',

    // ── ADMIN ATHLETES FORM ──────────────────────────────────
    'admin.form.add-title':  'Add Athlete',
    'admin.form.all-title':  'All Athletes',
    'admin.form.wca-id':     'WCA ID',
    'admin.form.last-name':  'Last Name (Овог) *',
    'admin.form.full-name':  'Full Name *',
    'admin.form.birth-date': 'Birth Date *',
    'admin.form.image-url':  'Profile Image URL',
    'admin.form.add-btn':    'Add Athlete',
    'admin.form.cancel-btn': 'Cancel Edit',

    // ── LIVE RESULTS ─────────────────────────────────────────
    'live.empty-heading':     'No live competition right now',
    'live.empty-sub':         'When a competition goes live, real-time results will appear here.',

    // ── COMPETITION RESULTS OVERLAY ───────────────────────────
    'cro.club-athletes':      'Club Athletes',
    'cro.no-club-results':    'No club athlete results',

    // ── RESULTS ENTRY ────────────────────────────────────────
    'result.saved':           'Saved',
    'result.save-failed':     'Save failed',
    're.title':               'Results Entry',
    're.comp-label':          'Competition',
    're.prompt':              'Select a competition above to start entering results.',
    're.comp-select':         '— Select Competition —',
    're.athlete-select':      '— Athlete —',
    're.event-select':        '— Event —',

    // ── ATHLETE DASHBOARD ─────────────────────────────────────
    'dash.loading':           'Loading your profile…',
    'dash.personal-records':  'Personal Records',
    'dash.comp-history':      'Competition History',
    'dash.no-results':        'No published results yet. Compete to see your stats here!',
    'dash.stat.competitions': 'Competitions',
    'dash.stat.events':       'Events',
    'dash.stat.solves':       'Solves',
    'dash.col.event':         'Event',
    'dash.col.single':        'Single',
    'dash.col.average':       'Average',
    'dash.col.round':         'Rnd',
    'dash.col.group':         'Grp',
    'dash.meta.wca-id':       'WCA ID',
    'dash.meta.country':      'Country',
    'dash.meta.born':         'Born',
    'dash.btn.homepage':      '⌂ Homepage',
    'dash.btn.signout':       'Sign Out',

    // ── ANALYTICS ────────────────────────────────────────────
    'tab.analytics':           '📊 Analytics',
    'an.filter.comp':          'Competition',
    'an.filter.event':         'Event',
    'an.filter.athlete':       'Athlete',
    'an.filter.from':          'From',
    'an.filter.to':            'To',
    'an.btn.analyze':          '↻ Analyze',
    'an.loading':              'Loading analytics data…',
    'an.subtab.leaders':       'Leaderboards',
    'an.subtab.insights':      'Smart Insights',
    'an.subtab.charts':        'Charts',
    'an.chart.medals':         'Medal Distribution by Athlete',
    'an.chart.dnf':            'DNF Rate by Athlete',
    'an.chart.records':        'Club Record Breaks by Athlete',
    'an.chart.comps':          'Competitions Entered',
    'an.card.total-athletes':  'Total Athletes',
    'an.card.competitions':    'Competitions',
    'an.card.results':         'Results',
    'an.card.total-medals':    'Total Medals',
    'an.card.club-records':    'Club Records Set',
    'an.card.dnf-rate':        'Overall DNF Rate',
    'an.card.active-sub':      'active (6 mo)',
    'an.card.all-time':        'all time',
    'an.card.all-entries':     'all entries',
    'an.card.cumulative':      'cumulative',
    'an.card.of-solves':       'of {n} solves',
    'an.lb.most-comps':        'Most Competitions',
    'an.lb.most-medals':       'Most Medals',
    'an.lb.most-records':      'Most Club Records',
    'an.lb.most-results':      'Most Results',
    'an.lb.best-consistency':  'Best Consistency (3x3)',
    'an.lb.most-improved':     'Most Improved (3x3)',
    'an.lb.highest-dnf':       'Highest DNF Rate',
    'an.lb.medal-breakdown':   'Medal Breakdown',
    'an.lb.no-data':           'No data',
    'an.ins.high-dnf.title':   'Athletes With High DNF Rate',
    'an.ins.high-dnf.badge':   'DNF Risk',
    'an.ins.high-dnf.empty':   'No athletes with concerning DNF rates.',
    'an.ins.rising.title':     'Rising Stars (Fastest 3x3 Improvement)',
    'an.ins.rising.badge':     '⬆ Rising',
    'an.ins.rising.empty':     'No fast-improving athletes detected yet.',
    'an.ins.potential.title':  'Close to Breaking Club Record',
    'an.ins.potential.badge':  '⚡ Potential',
    'an.ins.potential.empty':  'No athletes within striking range of club records.',
    'an.ins.unstable.title':   'Inconsistent Performers (High Variance)',
    'an.ins.unstable.badge':   '⚠ Unstable',
    'an.ins.unstable.empty':   'All tracked athletes are performing consistently.',
    'an.ins.develop.title':    'Active Athletes Without a Medal Yet',
    'an.ins.develop.badge':    '📈 Develop',
    'an.ins.develop.empty':    'All active athletes have earned at least one medal.',
    'an.detail.dnf-of':        '{pct}% DNF — {dnf} of {total} solves',
    'an.detail.improvement':   '+{pct}% improvement over {n} competitions',
    'an.detail.record-gap':    '{ev}: PB {pb} — record {rec} ({gap}% gap)',
    'an.detail.unstable':      'CV {cv}% — improving but erratic across {n} competitions',
    'an.detail.no-medals':     '{n} competitions, {r} results — no medals yet',
    'an.medal.suffix':         '🏅',
    'an.consistency.suffix':   '% CV',
    'an.chart.lbl.gold':       'Gold',
    'an.chart.lbl.silver':     'Silver',
    'an.chart.lbl.bronze':     'Bronze',
    'an.chart.lbl.dnf-rate':   'DNF Rate %',
    'an.chart.lbl.records':    'Records',
    'an.chart.lbl.comps':      'Competitions',
    'an.subtab.athletes':      'Club Athletes',
    'an.athletes.empty':       'No athletes found.',
    'an.profile.back':         '← Back',
    'an.profile.pb-title':     'Personal Bests',
    'an.profile.history-title':'Competition History',
    'an.profile.comps':        'Comps',
    'an.profile.events':       'Events',
    'an.profile.solves':       'Solves',
    'an.profile.gold':         'Gold',
    'an.profile.silver':       'Silver',
    'an.profile.bronze':       'Bronze',
    'an.profile.no-results':   'No published results for this athlete.',
    'an.profile.event':        'Event',
    'an.profile.single':       'Single',
    'an.profile.average':      'Average',
    'an.profile.competition':  'Competition',
    'an.profile.round':        'Round',
    'an.profile.place':        'Place',
  },

  mn: {
    // ── NAV ──────────────────────────────────────────────────
    'nav.rankings':     'Рейтинг',
    'nav.records':      'Рекорд',
    'nav.competitions': 'Тэмцээн',
    'nav.live':         'Шууд',
    'nav.athletes':     'Тамирчид',
    'nav.sign-in':      'Нэвтрэх',
    'nav.sign-out':     'Гарах',
    'nav.my-profile':       '🐣 Миний профайл',
    'nav.my-profile-short': 'Миний профайл',
    'nav.admin':            '⚡ Админ',
    'nav.admin-short':      'Админ хянах самбар',
    'nav.homepage':         '⌂ Нүүр хуудас',
    'gs.placeholder':       'Хайх…',
    'gs.type.athlete':      'Тамирчин',
    'gs.type.competition':  'Тэмцээн',
    'gs.no-results':        'Хайлт олдсонгүй',

    // ── HERO ─────────────────────────────────────────────────
    'hero.badge':           'WCA Загварын Тэмцээний Платформ',
    'hero.subtitle':        'ТЭМЦЭЭНИЙ ПОРТАЛ',
    'hero.desc':            'Монголын speedcubing нийгэмлэгийн албан ёсны үр дүн, шууд дамжуулалт, тамирчдын рейтинг болон тэмцээн удирдлага.',
    'hero.btn-rankings':    'Рейтинг үзэх',
    'hero.btn-competitions':'Тэмцээнүүд',
    'hero.scroll':          'Доош',

    // ── STATS BAR ────────────────────────────────────────────
    'stats.athletes':        'Тамирчид',
    'stats.competitions':    'Тэмцээн',
    'stats.events-supported':'Дэд тэмцээн',

    // ── SECTION TAGS / TITLES / DESCS ────────────────────────
    'section-tag.leaderboard':   'РЕЙТИНГ',
    'section-title.rankings':    'Дэд тэмцээний рейтинг',
    'section-desc.rankings':     'Бүх WCA дэд тэмцээний хамгийн сайн нэг болон дундаж үр дүн.',
    'section-tag.records':       'РЕКОРД',
    'section-title.records':     'Клубын рекорд',
    'section-desc.records':      'Клубын тэмцээнд тогтоосон хамгийн сайн нэг болон дундаж үр дүн.',
    'section-tag.competitions':  'ТЭМЦЭЭН',
    'section-title.competitions':'Тэмцээний хуваарь',
    'section-tag.live':          'ШУУД',
    'section-title.live':        'Шууд үр дүн',
    'section-tag.athletes':      'ТАМИРЧИД',
    'section-title.athletes':    'Клубын тамирчид',
    'section-desc.athletes':     'Манай өрсөлдөгч speedcuber-ууд.',

    // ── LOGIN MODAL ──────────────────────────────────────────
    'login.tab-admin':       'Админ',
    'login.tab-athlete':     'Тамирчин',
    'login.admin-heading':   'Админ нэвтрэх',
    'login.athlete-heading': 'Тамирчин нэвтрэх',
    'login.username':        'Нэвтрэх нэр',
    'login.password':        'Нууц үг',
    'login.admin-btn':       'Нэвтрэх',
    'login.athlete-btn':     'Нэвтрэх',
    'login.spinner':         'Шалгаж байна…',

    // ── ADMIN TABS ───────────────────────────────────────────
    'tab.athletes':    '👤 Тамирчид',
    'tab.competitions':'🏆 Тэмцээн',
    'tab.results':     '✎ Үр дүн оруулах',
    'tab.comp-results':'📋 Тэмцээний үр дүн',
    'tab.history':     '📄 Түүх',
    'tab.users':       '🔑 Хэрэглэгчид',

    // ── ADMIN HEADER ─────────────────────────────────────────
    'admin.title':    'Админ хянах самбар',
    'admin.subtitle': 'Cube MN тэмцээн удирдлага',

    // ── ADMIN ATHLETES FORM ──────────────────────────────────
    'admin.form.add-title':  'Тамирчин нэмэх',
    'admin.form.all-title':  'Бүх тамирчид',
    'admin.form.wca-id':     'WCA ID',
    'admin.form.last-name':  'Овог *',
    'admin.form.full-name':  'Бүтэн нэр *',
    'admin.form.birth-date': 'Төрсөн огноо *',
    'admin.form.image-url':  'Профайл зургийн холбоос',
    'admin.form.add-btn':    'Тамирчин нэмэх',
    'admin.form.cancel-btn': 'Цуцлах',

    // ── LIVE RESULTS ─────────────────────────────────────────
    'live.empty-heading':     'Одоогоор шууд тэмцээн байхгүй байна',
    'live.empty-sub':         'Тэмцээн шууд болох үед үр дүн энд харагдана.',

    // ── COMPETITION RESULTS OVERLAY ───────────────────────────
    'cro.club-athletes':      'Клубын тамирчид',
    'cro.no-club-results':    'Клубын тамирчдын үр дүн байхгүй',

    // ── RESULTS ENTRY ────────────────────────────────────────
    'result.saved':           'Хадгаллаа',
    'result.save-failed':     'Хадгалж чадсангүй',
    're.title':               'Үр дүн оруулах',
    're.comp-label':          'Тэмцааний',
    're.prompt':              'Үр дүнг оруулахын тулд дээрх тэмцаанийг сонгоно уу.',
    're.comp-select':         '— Тэмцааний сонгох —',
    're.athlete-select':      '— Тамирчид —',
    're.event-select':        '— Төрөл —',

    // ── ATHLETE DASHBOARD ─────────────────────────────────────
    'dash.loading':           'Профайл ачаалж байна…',
    'dash.personal-records':  'Хувийн рекорд',
    'dash.comp-history':      'Тэмцээний түүх',
    'dash.no-results':        'Одоогоор үр дүн байхгүй байна. Тэмцээнд оролцоорой!',
    'dash.stat.competitions': 'Тэмцээн',
    'dash.stat.events':       'Дэд тэмцээн',
    'dash.stat.solves':       'Оролдлого',
    'dash.col.event':         'Дэд тэмцээн',
    'dash.col.single':        'Нэг оролдлого',
    'dash.col.average':       'Дундаж',
    'dash.col.round':         'Үе',
    'dash.col.group':         'Бүлэг',
    'dash.meta.wca-id':       'WCA ID',
    'dash.meta.country':      'Улс',
    'dash.meta.born':         'Төрсөн',
    'dash.btn.homepage':      '⌂ Нүүр хуудас',
    'dash.btn.signout':       'Гарах',

    // ── ANALYTICS ────────────────────────────────────────────
    'tab.analytics':           '📊 Аналитик',
    'an.filter.comp':          'Тэмцээн',
    'an.filter.event':         'Дэд тэмцээн',
    'an.filter.athlete':       'Тамирчин',
    'an.filter.from':          'Эхлэх',
    'an.filter.to':            'Дуусах',
    'an.btn.analyze':          '↻ Шинжлэх',
    'an.loading':              'Аналитик өгөгдөл ачаалж байна…',
    'an.subtab.leaders':       'Дээд жагсаалт',
    'an.subtab.insights':      'Ухаалаг дүн шинжилгээ',
    'an.subtab.charts':        'Графикүүд',
    'an.chart.medals':         'Тамирчдын медалийн хуваарилалт',
    'an.chart.dnf':            'Тамирчдын DNF хувь',
    'an.chart.records':        'Тамирчдын клубын рекорд',
    'an.chart.comps':          'Оролцсон тэмцээн',
    'an.card.total-athletes':  'Нийт тамирчид',
    'an.card.competitions':    'Тэмцээн',
    'an.card.results':         'Үр дүн',
    'an.card.total-medals':    'Нийт медаль',
    'an.card.club-records':    'Клубын рекорд',
    'an.card.dnf-rate':        'Нийт DNF хувь',
    'an.card.active-sub':      'идэвхтэй (6 сар)',
    'an.card.all-time':        'нийт',
    'an.card.all-entries':     'нийт оруулга',
    'an.card.cumulative':      'нийт',
    'an.card.of-solves':       '{n} оролдлогын',
    'an.lb.most-comps':        'Хамгийн олон тэмцээн',
    'an.lb.most-medals':       'Хамгийн олон медаль',
    'an.lb.most-records':      'Хамгийн олон клубын рекорд',
    'an.lb.most-results':      'Хамгийн олон үр дүн',
    'an.lb.best-consistency':  'Хамгийн тогтвортой (3x3)',
    'an.lb.most-improved':     'Хамгийн их дэвшил (3x3)',
    'an.lb.highest-dnf':       'Хамгийн өндөр DNF хувь',
    'an.lb.medal-breakdown':   'Медалийн задаргаа',
    'an.lb.no-data':           'Өгөгдөл байхгүй',
    'an.ins.high-dnf.title':   'Өндөр DNF хувьтай тамирчид',
    'an.ins.high-dnf.badge':   'DNF Эрсдэл',
    'an.ins.high-dnf.empty':   'Асуудалтай DNF хувьтай тамирчин байхгүй байна.',
    'an.ins.rising.title':     'Өсөн гарч буй одод (3x3 хамгийн хурдан дэвшил)',
    'an.ins.rising.badge':     '⬆ Өсөн гарч байна',
    'an.ins.rising.empty':     'Хурдан дэвшиж буй тамирчин илрэхгүй байна.',
    'an.ins.potential.title':  'Клубын рекорд дөхсөн тамирчид',
    'an.ins.potential.badge':  '⚡ Боломжтой',
    'an.ins.potential.empty':  'Клубын рекордод ойр байгаа тамирчин байхгүй.',
    'an.ins.unstable.title':   'Тогтворгүй гүйцэтгэлтэй тамирчид (Өндөр хэлбэлзэл)',
    'an.ins.unstable.badge':   '⚠ Тогтворгүй',
    'an.ins.unstable.empty':   'Бүх тамирчид тогтвортой гүйцэтгэлтэй байна.',
    'an.ins.develop.title':    'Медалгүй идэвхтэй тамирчид',
    'an.ins.develop.badge':    '📈 Хөгжүүлэх',
    'an.ins.develop.empty':    'Бүх идэвхтэй тамирчид медаль хүртсэн байна.',
    'an.detail.dnf-of':        '{pct}% DNF — {dnf} нь {total} оролдлогын',
    'an.detail.improvement':   '+{pct}% дэвшил — {n} тэмцээнд',
    'an.detail.record-gap':    '{ev}: Хувийн рекорд {pb} — Рекорд {rec} ({gap}% зөрүү)',
    'an.detail.unstable':      'CV {cv}% — {n} тэмцээнд тогтворгүй',
    'an.detail.no-medals':     '{n} тэмцээн, {r} үр дүн — медаль байхгүй',
    'an.medal.suffix':         '🏅',
    'an.consistency.suffix':   '% CV',
    'an.chart.lbl.gold':       'Алт',
    'an.chart.lbl.silver':     'Мөнгө',
    'an.chart.lbl.bronze':     'Хүрэл',
    'an.chart.lbl.dnf-rate':   'DNF хувь %',
    'an.chart.lbl.records':    'Рекорд',
    'an.chart.lbl.comps':      'Тэмцээн',
    'an.subtab.athletes':      'Клубын тамирчид',
    'an.athletes.empty':       'Тамирчид байхгүй байна.',
    'an.profile.back':         '← Буцах',
    'an.profile.pb-title':     'Хувийн рекорд',
    'an.profile.history-title':'Тэмцээний түүх',
    'an.profile.comps':        'Тэмцээн',
    'an.profile.events':       'Дэд тэмцээн',
    'an.profile.solves':       'Оролдлого',
    'an.profile.gold':         'Алт',
    'an.profile.silver':       'Мөнгө',
    'an.profile.bronze':       'Хүрэл',
    'an.profile.no-results':   'Нийтэлсэн үр дүн байхгүй байна.',
    'an.profile.event':        'Дэд тэмцээн',
    'an.profile.single':       'Нэг оролдлого',
    'an.profile.average':      'Дундаж',
    'an.profile.competition':  'Тэмцээн',
    'an.profile.round':        'Үе',
    'an.profile.place':        'Байр',
  }
};

// Returns translated string for the current language
function t(key) {
  var lang = localStorage.getItem('cubeLang') || 'en';
  var dict = window.I18N[lang] || window.I18N.en;
  return dict[key] !== undefined ? dict[key] : (window.I18N.en[key] !== undefined ? window.I18N.en[key] : key);
}

// Applies a language: updates all [data-i18n] elements + [data-i18n-ph] placeholders
function applyLang(lang) {
  if (!window.I18N[lang]) lang = 'en';
  localStorage.setItem('cubeLang', lang);
  document.documentElement.setAttribute('data-lang', lang);
  var dict = window.I18N[lang];
  var fallback = window.I18N.en;
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    var tr = dict[key] !== undefined ? dict[key] : fallback[key];
    if (tr !== undefined) el.textContent = tr;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-ph');
    var tr = dict[key] !== undefined ? dict[key] : fallback[key];
    if (tr !== undefined) el.placeholder = tr;
  });
  document.querySelectorAll('.lang-opt').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
  });
}

// Call once on page load to apply the saved language
function initLang() {
  applyLang(localStorage.getItem('cubeLang') || 'en');
}
