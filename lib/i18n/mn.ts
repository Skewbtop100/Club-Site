import type { TranslationKey } from './en';

const mn: Partial<Record<TranslationKey, string>> = {
  // NAV
  'nav.rankings': 'Эрэмбэ',
  'nav.records': 'Рекорд',
  'nav.competitions': 'Тэмцээн',
  'nav.live': 'Шууд',
  'nav.athletes': 'Тамирчид',
  'nav.sign-in': 'Нэвтрэх',
  'nav.sign-out': 'Гарах',
  'nav.my-profile': '🐣 Миний профайл',
  'nav.my-profile-short': 'Миний профайл',
  'nav.admin': '⚡ Админ',
  'nav.admin-short': 'Админ хянах самбар',
  'nav.homepage': '⌂ Нүүр хуудас',
  'nav.home': 'Нүүр',
  'nav.competition': 'Тэмцээн',
  'nav.timer': 'Таймер',
  'nav.algorithms': 'Алгоритм',
  'nav.gallery': 'Галерей',
  'nav.coming-soon': 'Тун удахгүй',

  // HERO
  'hero.badge': 'WCA Загварын Тэмцээний Платформ',
  'hero.subtitle': 'Үзүүлэлтийн Портал',
  'hero.desc':
    'Монголын speedcubing нийгэмлэгийн албан ёсны үр дүн, шууд дамжуулалт, тамирчдын эрэмбэ болон тэмцээн удирдлага.',
  'hero.btn-rankings': 'Эрэмбэ харах',
  'hero.btn-competitions': 'Тэмцээнүүд',
  'hero.scroll': 'Доош',

  // STATS
  'stats.athletes': 'Тамирчид',
  'stats.competitions': 'Тэмцээн',
  'stats.events-supported': 'Дэд тэмцээн',

  // SECTIONS
  'section-tag.leaderboard': 'ЭРЭМБЭ',
  'section-title.rankings': 'Үйл явдлын эрэмбэ',
  'section-desc.rankings': 'Бүх WCA дэд тэмцээний хамгийн сайн нэг болон дундаж үр дүн.',
  'section-tag.records': 'РЕКОРД',
  'section-title.records': 'Клубын рекордууд',
  'section-desc.records': 'Клубын тэмцээнд тогтоосон хамгийн сайн нэг болон дундаж үр дүн.',
  'section-tag.competitions': 'ТЭМЦЭЭН',
  'section-title.competitions': 'Тэмцээний хуваарь',
  'section-tag.live': 'ШУУД',
  'section-title.live': 'Шууд үр дүн',
  'section-tag.athletes': 'ТАМИРЧИД',
  'section-title.athletes': 'Клубын тамирчид',
  'section-desc.athletes': 'Манай өрсөлдөгч speedcuber-ууд.',

  // RESULTS
  'result.saved': 'Хадгаллаа',
  'result.save-failed': 'Хадгалж чадсангүй',

  // ATHLETE DASHBOARD
  'dash.loading': 'Профайл ачаалж байна…',
  'dash.personal-records': 'Хувийн рекорд',
  'dash.comp-history': 'Тэмцээний түүх',
  'dash.no-results': 'Одоогоор үр дүн байхгүй байна. Тэмцээнд оролцоорой!',
  'dash.stat.competitions': 'Тэмцээн',
  'dash.stat.events': 'Дэд тэмцээн',
  'dash.stat.solves': 'Оролдлого',

  // LIVE
  'live.empty-heading': 'Одоогоор шууд тэмцээн байхгүй байна',
  'live.empty-sub': 'Тэмцээн шууд болох үед үр дүн энд харагдана.',

  // COMMON
  'common.back': '← Буцах',
  'common.loading': 'Ачааллаж байна...',
  'common.no-data': 'Мэдээлэл алга',

  // RANKINGS TABLE
  'rankings.single': 'Нэг',
  'rankings.average': 'Дундаж',
  'rankings.athlete': 'Тамирчин',
  'rankings.competition': 'Тэмцээн',
  'rankings.date': 'Огноо',
  'rankings.no-results': 'Энэ дэд тэмцээнд үр дүн байхгүй байна.',
  'rankings.show-less': 'Хураах ↑',
  'rankings.show-all': 'Бүгдийг харах ↓',

  // RECORDS
  'records.single-record': 'Нэгийн рекорд',
  'records.average-record': 'Дундажийн рекорд',
  'records.history-title': 'Рекордын түүх',
  'records.no-history': 'Энэ дэд тэмцээнд рекорд байхгүй байна.',
  'records.first-record': 'Анхны рекорд!',
  'records.current-record': 'Одоогийн рекорд',
  'records.no-previous': 'Өмнөх рекорд алга — энэ нь анхны рекорд!',

  // COMPETITIONS
  'comp.upcoming': 'Болох',
  'comp.live-tab': 'Шууд',
  'comp.finished': 'Дууссан',
  'comp.status.live': 'ШУУД',
  'comp.status.upcoming': '● БОЛОХ',
  'comp.status.finished': '✓ ДУУССАН',
  'comp.no-upcoming': 'Болох тэмцээн байхгүй.',
  'comp.no-live': 'Шууд тэмцээн байхгүй.',
  'comp.no-finished': 'Дууссан тэмцээн байхгүй.',
  'comp.view-results': 'Үр дүн үзэх',
  'comp.view-live': 'Шууд үр дүн үзэх',
  'comp.assignments': 'Томилгоо',
  'comp.no-assignments': 'Энэ тэмцээний томилгоо одоогоор байхгүй байна.',
  'comp.no-results': 'Үр дүн байхгүй байна.',
  'comp.club-event': 'Клубын тэмцээн:',
  'comp.live-indicator': 'ШУУД',

  // ATHLETES SECTION
  'athletes.no-athletes': 'Тамирчид бүртгэгдээгүй байна.',
  'athletes.best-333': 'Хамгийн сайн 3x3: ',
  'athletes.no-results': 'Үр дүн байхгүй',
  'athletes.profile': 'Тамирчны профайл',
  'athletes.personal-bests': 'Хувийн рекорд',
  'athletes.comp-history': 'Тэмцээний түүх',
  'athletes.no-comp-results': 'Үр дүн байхгүй байна. Анхны тэмцээндээ оролцоорой!',
  'athletes.stat.comps': 'Тэмцээн',
  'athletes.stat.events': 'Дэд тэмцээн',
  'athletes.stat.solves': 'Оролдлого',
  'athletes.stat.gold': 'Алт',
  'athletes.stat.silver': 'Мөнгө',
  'athletes.stat.bronze': 'Хүрэл',

  // THEME / LANG
  'theme.dark': '🌑 Харанхуй',
  'theme.light': '☀ Гэрэл',
  'theme.purple': '💜 Ягаан',
  'lang.label': 'Хэл',
  'theme.label': 'Загвар',
};

export default mn;
