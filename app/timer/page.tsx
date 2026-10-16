'use client';

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import TimerProfileMenu from '@/components/timer/TimerProfileMenu';
import ScramblePreview from '@/components/shared/ScramblePreview';
import { generateScramble, generateSeededScramble } from '@/lib/scramble';
import { isValidSharedCode, randomSharedCode, sharedSeedKey } from '@/lib/shared-scramble';
import { useSmartTimer } from './useSmartTimer';
import { type QiyiPacket } from './useQiyiTimer';
import { useWakeLock } from './useWakeLock';
import { monotonePath, segmentsOf, type Pt } from './monotonePath';
import { useAuth } from '@/lib/auth-context';
import { useLang, type Lang } from '@/lib/i18n';
import { awardSolvePointIfUnderLimit, awardAo5PbIfEligible } from '@/lib/points';
import { showToast, useToastVariant } from '@/lib/toast';
import { TIMER_FEATURES, COMING_SOON_TOAST, type TimerFeature } from '@/lib/timer-features';
import {
  trackPresence, updatePresenceEvent,
} from '@/lib/firebase/services/presence';
import { WcaEventIcon } from '@/lib/wca-event-icon';
import {
  useTimer,
  fmtMs,
  isDnf,
  finalMs,
  avgOfN,
  calcStats,
  PENALTY_ADD,
  clampHoldTimeMs,
  DEFAULT_HOLD_TIME_MS,
  type Penalty,
  type Solve,
  type Precision,
  type Stats,
  type TimerState,
} from '@/lib/timer-engine';


// ── Themes ───────────────────────────────────────────────────────────────────
// Five presets. Each defines the full palette the rest of the file reads via
// the module-level mutable `C` below. The user picks a theme in Settings →
// Display; the chosen id is persisted under THEME_KEY and applied by mutating
// `C` in-place inside TimerPage so module-scope helpers (ModalShell,
// SessionsPanel, etc.) that reference `C.xxx` re-read the new palette on the
// next React render. `borderHi` is derived from `accent` at 0.4 opacity per
// theme; `warn` mirrors `warning`; `orange` is shared inspection-time semantic
// colour and stays constant across themes (the 8s / 12s / 15s warnings always
// read the same).
type ThemeId = 'black' | 'white' | 'ocean' | 'forest' | 'rose';

interface ThemeColors {
  bg: string;
  card: string;
  cardAlt: string;
  border: string;
  borderHi: string;
  text: string;
  muted: string;
  mutedDim: string;
  accent: string;
  accent2: string;
  accentDim: string;
  success: string;
  danger: string;
  warning: string;
  warn: string;
  orange: string;
}

interface Theme {
  id: ThemeId;
  name: string;
  preview: string;  // hex colour shown in the picker tile
  colors: ThemeColors;
  // Optional vertical-gradient background for vibrant themes. When set,
  // the page wrapper paints this instead of `colors.bg` (which still
  // doubles as the document body's solid fallback so overscroll on
  // mobile blends in). Black/white use plain bg.
  bgGradient?: string;
  // Optional backdrop-filter value for card elements on this theme.
  cardBlur?: string;
}

// Shared semantic constants that don't change per theme. Inspection-time
// warning is always orange→red regardless of accent so the visual rhythm
// stays consistent for users tracking 8s/12s/15s thresholds.
const ORANGE_WARNING = '#f97316';

// Monochrome design tokens. There is deliberately no accent colour: the
// `accent` slot is the primary text colour and `accentDim` is the
// surface-selected fill, so "selected" / "primary" reads through contrast,
// not hue. `cardAlt` = surface hover/selected, `borderHi` = selected border.
// Colour is reserved for semantics: success (PB / best) and danger (DNF/+2).
const THEMES: Record<ThemeId, Theme> = {
  black: {
    id: 'black',
    name: 'Black',
    preview: '#0B0B0C',
    colors: {
      bg: '#0B0B0C',
      card: '#141416',
      cardAlt: '#1C1C1F',
      border: '#232326',
      borderHi: '#3A3A3F',
      text: '#EDEDED',
      muted: '#8B8B90',
      // Tertiary: the dimmest grey that still clears 4.5:1 for small text
      // on page (#0B0B0C), surface (#141416) and selected (#1C1C1F).
      mutedDim: '#848489',
      accent: '#EDEDED',
      accent2: '#EDEDED',
      accentDim: '#1C1C1F',
      success: '#34D399',
      danger: '#E5484D',
      warning: '#fbbf24',
      warn: '#fbbf24',
      orange: ORANGE_WARNING,
    },
  },
  white: {
    id: 'white',
    name: 'White',
    preview: '#ffffff',
    colors: {
      bg: '#ffffff',
      card: '#f5f5f7',
      cardAlt: '#ebebed',
      border: 'rgba(0,0,0,0.1)',
      borderHi: 'rgba(0,0,0,0.25)',
      text: '#111111',
      muted: 'rgba(0,0,0,0.55)',
      mutedDim: 'rgba(0,0,0,0.3)',
      accent: '#111111',
      accent2: '#111111',
      accentDim: 'rgba(0,0,0,0.06)',
      success: '#059669',
      danger: '#dc2626',
      warning: '#d97706',
      warn: '#d97706',
      orange: ORANGE_WARNING,
    },
  },
  ocean: {
    id: 'ocean',
    name: 'Blue',
    preview: '#2541e0',
    bgGradient: 'linear-gradient(180deg, #1a2fb8 0%, #2541e0 45%, #16259e 100%)',
    cardBlur: 'blur(12px)',
    colors: {
      bg: '#2541e0',
      card: 'rgba(255,255,255,0.10)',
      cardAlt: 'rgba(255,255,255,0.15)',
      border: 'rgba(255,255,255,0.16)',
      borderHi: 'rgba(255,255,255,0.55)',
      text: '#ffffff',
      muted: 'rgba(255,255,255,0.82)',
      mutedDim: 'rgba(255,255,255,0.58)',
      accent: '#ffffff',
      accent2: '#dbeafe',
      accentDim: 'rgba(255,255,255,0.18)',
      success: '#86efac',
      danger: '#fecaca',
      warning: '#fde047',
      warn: '#fde047',
      orange: ORANGE_WARNING,
    },
  },
  forest: {
    id: 'forest',
    name: 'Red',
    preview: '#d62a1a',
    bgGradient: 'linear-gradient(180deg, #a81d14 0%, #d62a1a 45%, #8e1610 100%)',
    cardBlur: 'blur(12px)',
    colors: {
      bg: '#d62a1a',
      card: 'rgba(255,255,255,0.10)',
      cardAlt: 'rgba(255,255,255,0.15)',
      border: 'rgba(255,255,255,0.16)',
      borderHi: 'rgba(255,255,255,0.55)',
      text: '#ffffff',
      muted: 'rgba(255,255,255,0.82)',
      mutedDim: 'rgba(255,255,255,0.58)',
      accent: '#ffffff',
      accent2: '#fecaca',
      accentDim: 'rgba(255,255,255,0.18)',
      success: '#86efac',
      danger: '#fff',
      warning: '#fde047',
      warn: '#fde047',
      orange: ORANGE_WARNING,
    },
  },
  rose: {
    id: 'rose',
    name: 'Pink',
    preview: '#d01f5e',
    bgGradient: 'linear-gradient(180deg, #a01548 0%, #d01f5e 45%, #8e1240 100%)',
    cardBlur: 'blur(12px)',
    colors: {
      bg: '#d01f5e',
      card: 'rgba(255,255,255,0.10)',
      cardAlt: 'rgba(255,255,255,0.15)',
      border: 'rgba(255,255,255,0.16)',
      borderHi: 'rgba(255,255,255,0.55)',
      text: '#ffffff',
      muted: 'rgba(255,255,255,0.82)',
      mutedDim: 'rgba(255,255,255,0.58)',
      accent: '#ffffff',
      accent2: '#fce7f3',
      accentDim: 'rgba(255,255,255,0.18)',
      success: '#86efac',
      danger: '#fecaca',
      warning: '#fde047',
      warn: '#fde047',
      orange: ORANGE_WARNING,
    },
  },
};

// Single corner radius for cards/buttons, smaller one for chips.
const RADIUS = 10;
const RADIUS_SM = 8;

const DEFAULT_THEME_ID: ThemeId = 'black';
const THEME_KEY = 'pv.timer.theme';

// Module-level mutable palette. Initialised from the default theme and
// re-synced inside TimerPage when the user picks a new one. Existing code
// throughout this file reads C.accent / C.card / etc. unchanged — the
// indirection is the whole reason this object is mutable rather than a fresh
// reference each theme switch (module-scope helpers like ModalShell capture
// the binding once at definition time).
const C: ThemeColors = { ...THEMES[DEFAULT_THEME_ID].colors };

/** Neutral ghost button (event picker, New Scramble, …): surface-selected
 *  fill, primary text, no border; callers step the fill to C.border on
 *  hover. `pressed` keeps the hover shade while a popover is open. */
function ghostButtonStyle(pressed: boolean): React.CSSProperties {
  return {
    background: pressed ? C.border : C.cardAlt,
    color: C.text,
    border: 'none',
    borderRadius: RADIUS,
    padding: '0.45rem 1rem',
    fontSize: '0.85rem', fontWeight: 500, fontFamily: 'inherit',
    cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center',
    transition: 'background 0.15s ease',
  };
}

// ── Events ──────────────────────────────────────────────────────────────────
interface EventDef { id: string; name: string; short: string }

// Event IDs that get tucked away inside the picker's collapsible
// "special events" accordion — blindfolded variants, multi-blind, and
// fewest-moves. The remaining IDs render in the always-visible primary
// grid. Single source of truth; both TimerPage and EventPickerSheet
// reference this.
const SPECIAL_EVENT_IDS = ['333bld', '444bld', '555bld', '333mbf', '333fm'];

const EVENTS: EventDef[] = [
  { id: '333',     name: '3x3x3 Cube',       short: '3x3'   },
  { id: '222',     name: '2x2x2 Cube',       short: '2x2'   },
  { id: '444',     name: '4x4x4 Cube',       short: '4x4'   },
  { id: '555',     name: '5x5x5 Cube',       short: '5x5'   },
  { id: '666',     name: '6x6x6 Cube',       short: '6x6'   },
  { id: '777',     name: '7x7x7 Cube',       short: '7x7'   },
  { id: '333oh',   name: '3x3 One-Handed',   short: '3OH'   },
  { id: '333bld',  name: '3x3 Blindfolded',  short: '3BLD'  },
  { id: '444bld',  name: '4x4 Blindfolded',  short: '4BLD'  },
  { id: '555bld',  name: '5x5 Blindfolded',  short: '5BLD'  },
  { id: '333mbf',  name: '3x3 Multi-Blind',  short: 'MBF'   },
  { id: '333fm',   name: '3x3 Fewest Moves', short: 'FMC'   },
  { id: 'pyram',   name: 'Pyraminx',         short: 'Pyra'  },
  { id: 'skewb',   name: 'Skewb',            short: 'Skewb' },
  { id: 'sq1',     name: 'Square-1',         short: 'Sq-1'  },
  { id: 'clock',   name: 'Clock',            short: 'Clock' },
  { id: 'minx',    name: 'Megaminx',         short: 'Mega'  },
];

// generateScramble/SCRAMBOW_TYPE live in @/lib/scramble (shared with the
// Practice Log feature). The TwistyPlayer puzzle-id map now lives in
// components/shared/ScramblePreview.tsx — ResultsEntryTab's Daily Practice
// flow needs the same cube-state preview, keyed off lib/wca-events.ts's
// ids rather than this page's own local EVENTS ids above.

// Solve types, fmtMs, isDnf, finalMs, avgOfN, calcStats, useTimer, and the
// Penalty / Precision / Stats / TimerState types all live in
// @/lib/timer-engine — see that module's header for the rationale and the
// list of consumers (solo + multiplayer).

// Scale the big timer display down based on text length so multi-minute
// times ("11:23.456" — 9 chars) don't overflow on narrow viewports. The
// brackets target the four common shapes:
//   ≤ 5  "12.34"      (sub-minute, default cs)
//   6-7  "1:23.45"    (single-digit minutes)
//   8-9  "11:23.456"  (multi-digit minutes / ms precision)
//   10+  pathological cases — keep readable.
// Sub-minute base sizes are unchanged; longer strings step down.
function getTimerFontSize(text: string, isMobile: boolean): string {
  const len = text.length;
  if (isMobile) {
    if (len <= 5) return 'clamp(3.5rem, 22vw, 7rem)';
    if (len <= 7) return 'clamp(2.8rem, 17vw, 5.5rem)';
    if (len <= 9) return 'clamp(2.2rem, 13vw, 4.5rem)';
    return 'clamp(1.8rem, 11vw, 3.8rem)';
  }
  if (len <= 5) return 'clamp(4rem, 16vw, 11rem)';
  if (len <= 7) return 'clamp(3.2rem, 12vw, 8.5rem)';
  if (len <= 9) return 'clamp(2.6rem, 10vw, 7rem)';
  return 'clamp(2.2rem, 8vw, 6rem)';
}

// Sort modes for the Solves list. The same enum drives both the desktop
// sidebar list and the mobile Solves tab — see the `sortedSolves`
// useMemo below for the comparator details. DNFs always settle to the
// extreme of the sort (end for fastest, start for slowest); newest /
// oldest fall back to creation order on missing timestamps.
type SortMode = 'newest' | 'oldest' | 'fastest' | 'slowest';
const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Шинэ → Хуучин',
  oldest: 'Хуучин → Шинэ',
  fastest: 'Хурдан → Удаан',
  slowest: 'Удаан → Хурдан',
};
// Sort modes presented in the dropdown grouped by what they sort on —
// date vs duration. Groups render with section headers in the popup so
// the user can scan to the relevant axis quickly.
const SORT_GROUPS: { header: string; options: SortMode[] }[] = [
  { header: 'Он сар өдөр', options: ['newest', 'oldest'] },
  { header: 'Хугацаа',     options: ['fastest', 'slowest'] },
];

// Format a solve's completion timestamp as "YYYY-MM-DD  HH:mm" in the
// user's local timezone. Older solves saved before `ts` was added (and
// any future code path that omits it) get a dash placeholder rather
// than an inaccurate auto-filled value.
function formatSolveTime(epoch: number | undefined): string {
  if (!epoch) return 'Тодорхойгүй';
  const d = new Date(epoch);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}  ${hh}:${min}`;
}

// Compact "M/D" date label rendered in the corner of each solve row in
// place of the old #N chronological index. Returns an empty string for
// legacy solves missing the timestamp so the UI just shows an empty
// corner rather than a placeholder.
function formatSolveDate(epoch: number | undefined): string {
  if (!epoch) return '';
  const d = new Date(epoch);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

// Build the text payload for the Solve Detail "Share" button. Plain
// "Label: value" lines in Mongolian — easier to read in chat clients
// that strip emoji or render them inconsistently. Date and comment
// lines are omitted when empty so the output never carries an
// awkward trailing "Сэтгэгдэл:" with no value. Penalty is folded into
// the time via finalMs() so a +2 reads as the post-penalty value.
function buildSolveShareText(solve: Solve, precision: Precision): string {
  const lines: string[] = [];
  if (solve.ts) {
    const d = new Date(solve.ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    lines.push(`Огноо: ${yyyy}-${mm}-${dd} ${hh}:${min}`);
  }
  // Use isDnf() so a DNF solve shares as "DNF" rather than a time.
  lines.push(`Эвлүүлэлт: ${fmtMs(finalMs(solve), isDnf(solve), precision)}`);
  if (solve.scramble) {
    lines.push(`Холилт: ${solve.scramble}`);
  }
  const cmt = solve.comment?.trim();
  if (cmt) {
    lines.push(`Сэтгэгдэл: ${cmt}`);
  }
  return lines.join('\n');
}

// Small clock SVG used next to the timestamp in the Solve Detail view.
// Inline (rather than from lib/icons.tsx) to keep the timer module
// self-contained — same convention as the other one-off icons here.
function IconClock() {
  return (
    <svg
      width={14} height={14} viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <circle cx={12} cy={12} r={10} />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// Mobile scramble font sizing. The static sm/md/lg buckets we expose in
// Settings overflow on Megaminx (~250 chars) and look stranded on 2x2
// (~15 chars), so the user preference is now a *multiplier* on top of an
// auto-fit base derived from scramble length. Buckets tuned against a
// 380px viewport (iPhone SE width) so 6x6 / 7x7 / Megaminx wrap without
// pushing the timer below the fold.
function getScrambleFontSize(
  scramble: string,
  userPref: 'sm' | 'md' | 'lg',
): number {
  const len = scramble.length;
  let basePx: number;
  if (len < 30)        basePx = 24;  // 2x2, Skewb, Pyraminx
  else if (len < 60)   basePx = 22;  // 3x3, Clock
  else if (len < 100)  basePx = 19;  // 4x4, Sq-1
  else if (len < 160)  basePx = 17;  // 5x5
  else if (len < 240)  basePx = 15;  // 6x6, 7x7
  else                 basePx = 13;  // Megaminx, MBF
  const multiplier = userPref === 'sm' ? 0.85
                   : userPref === 'lg' ? 1.15
                   : 1.0;
  // Round to the nearest 0.5px — keeps multi-event sessions from jittering
  // by sub-pixel deltas as the user swipes between scrambles of similar
  // lengths.
  return Math.round(basePx * multiplier * 2) / 2;
}

// Desktop scramble uses a viewport-clamped font instead of the px-bucket
// auto-fit (the column is wide enough that long scrambles don't need a
// length-aware base). The user's sm/md/lg preference still applies — same
// three-step ramp as mobile, just expressed as `clamp(...)` strings.
function getDesktopScrambleFontSize(pref: 'sm' | 'md' | 'lg'): string {
  if (pref === 'sm') return 'clamp(0.9rem, 2.0vw, 1.4rem)';
  if (pref === 'lg') return 'clamp(1.15rem, 2.8vw, 2rem)';
  return 'clamp(1rem, 2.4vw, 1.7rem)';
}

// avgOfN, calcStats, useTimer — all imported from @/lib/timer-engine.

// ── Main page ───────────────────────────────────────────────────────────────

// Shared-scramble mode: { code, per-event index }. Absent = normal random.
const SHARED_KEY = 'pv.timer.shared.v1';
const SHARED_INDEX_MAX = 9999;
// Remembered view of the preview/tools panel: 'preview' | 'shared'.
const TOOLS_TAB_KEY = 'pv.timer.toolsTab';
interface SharedMode {
  code: string;
  /** eventId → current scramble number (1-based); missing = #1. */
  indexes: Record<string, number>;
}
function clampSharedIndex(n: number): number {
  return Math.min(SHARED_INDEX_MAX, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1)));
}
/** Validates persisted shared mode; anything malformed → null (normal mode). */
function parseSharedMode(raw: string): SharedMode | null {
  const p = JSON.parse(raw) as { code?: unknown; indexes?: unknown };
  if (typeof p.code !== 'string' || !isValidSharedCode(p.code)) return null;
  const indexes: Record<string, number> = {};
  if (p.indexes && typeof p.indexes === 'object') {
    for (const [ev, n] of Object.entries(p.indexes as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isFinite(n)) indexes[ev] = clampSharedIndex(n);
    }
  }
  return { code: p.code, indexes };
}

const STORAGE_KEY = 'pv.timer.session.v1';
const PREFS_KEY = 'pv.timer.prefs.v1';
const SESSIONS_KEY = 'pv.timer.sessions.v2';

// Alt+key → event id. Uses KeyboardEvent.code so the mapping is layout-stable.
const ALT_EVENT_KEYS: Record<string, string> = {
  Digit1: 'sq1',
  Digit2: '222',
  Digit3: '333',
  Digit4: '444',
  Digit5: '555',
  Digit6: '666',
  Digit7: '777',
  KeyS:   'skewb',
  KeyM:   'minx',
  KeyC:   'clock',
  KeyP:   'pyram',
};

interface Session {
  id: string;
  name: string;
  createdAt: number;
  solves: Solve[];
}
type SessionStore = Record<string /* eventId */, { sessions: Session[]; currentId: string }>;

const newSessionId = () => `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
// Smart digit-only parser: last 2 digits = centiseconds, next 2 = seconds,
// remaining = minutes. Examples:
//   "1221"   → 12.21s   (12s 21cs)
//   "122"    → 1.22s    (1s 22cs)
//   "12211"  → 1:22.11
//   "122111" → 12:21.11
// Module-level so the inline manual-entry input (a top-level component)
// can call it without prop-drilling.
function parseManualTime(raw: string): number | null {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return null;
  let s = d;
  const csStr  = s.length >= 2 ? s.slice(-2) : s.padStart(2, '0');
  s = s.length >= 2 ? s.slice(0, -2) : '';
  const secStr = s.length >= 2 ? s.slice(-2) : s;
  s = s.length >= 2 ? s.slice(0, -2) : '';
  const minStr = s;
  const cs  = parseInt(csStr, 10) || 0;
  const sec = parseInt(secStr || '0', 10) || 0;
  const min = parseInt(minStr || '0', 10) || 0;
  return (min * 60 + sec) * 1000 + cs * 10;
}

function makeDefaultSession(solves: Solve[] = []): Session {
  return { id: newSessionId(), name: 'Default', createdAt: Date.now(), solves };
}

export default function TimerPage() {
  const router = useRouter();
  const { user } = useAuth();
  // Monochrome toasts while the timer is open (other pages keep theirs).
  useToastVariant('mono');
  const [eventId, setEventId] = useState<string>('333');
  // Empty initial value so server and client first-render match. The
  // existing eventId-change effect runs on mount and fills in the real
  // scramble — generating one in the useState initializer would call
  // Math.random() and produce different markup on the server vs the
  // client (React hydration error #418).
  const [randomScramble, setScramble] = useState<string>('');

  // ── Shared scramble code ────────────────────────────────────────────────
  // While a code is active, the displayed scramble is a pure function of
  // (code, event, index) — see lib/shared-scramble.ts — so everyone with
  // the same code sees the same #1, #2, … per event. The random scramble
  // above keeps updating underneath and is shown again on "Гарах".
  // Persisted to SHARED_KEY on every change (inside the state updater, so
  // there's no load/save effect race on mount).
  const [shared, setShared] = useState<SharedMode | null>(null);
  const updateShared = useCallback((fn: (prev: SharedMode | null) => SharedMode | null) => {
    setShared(prev => {
      const next = fn(prev);
      try {
        if (next) localStorage.setItem(SHARED_KEY, JSON.stringify(next));
        else localStorage.removeItem(SHARED_KEY);
      } catch { /* storage unavailable — mode just won't survive refresh */ }
      return next;
    });
  }, []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SHARED_KEY);
      if (raw) setShared(parseSharedMode(raw));
    } catch { /* ignore */ }
  }, []);
  const sharedCode = shared?.code ?? null;
  const sharedIndex = shared ? (shared.indexes[eventId] ?? 1) : null;
  const sharedScramble = useMemo(
    () => (sharedCode && sharedIndex != null
      ? generateSeededScramble(eventId, sharedSeedKey(sharedCode, eventId, sharedIndex))
      : ''),
    [sharedCode, eventId, sharedIndex],
  );
  const scramble = sharedCode ? sharedScramble : randomScramble;
  /** Moves the current event's shared index to `to` (clamped to 1…MAX). */
  const setSharedIndexTo = useCallback((to: number) => {
    updateShared(prev => prev && {
      ...prev,
      indexes: { ...prev.indexes, [eventId]: clampSharedIndex(to) },
    });
  }, [eventId, updateShared]);
  const stepShared = useCallback((delta: number) => {
    updateShared(prev => prev && {
      ...prev,
      indexes: { ...prev.indexes, [eventId]: clampSharedIndex((prev.indexes[eventId] ?? 1) + delta) },
    });
  }, [eventId, updateShared]);
  // Sessions store: per-event list of sessions, plus the active session id.
  // `solves` derives from the active session.
  const [sessions, setSessions] = useState<SessionStore>({});
  const [hoveredSolveId, setHoveredSolveId] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  // Desktop uses an inline dropdown anchored under the picker pill rather
  // than the mobile bottom sheet — separate state so we can mount one or
  // the other (never both) and never end up with a dangling open flag if
  // the viewport changes mid-interaction.
  const [desktopEventPickerOpen, setDesktopEventPickerOpen] = useState(false);
  // Trigger button ref + its measured rect, captured at open time so the
  // portal-rendered dropdown (mounted at document.body, escaping any
  // parent stacking context / overflow clipping) can position itself
  // with `position: fixed` against the pill's actual screen location.
  const eventPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const [eventPickerTriggerRect, setEventPickerTriggerRect] = useState<DOMRect | null>(null);
  const [detailSolveId, setDetailSolveId] = useState<string | null>(null);
  // Solve Detail modal — inline comment editor toggle + draft text.
  // Reset whenever the modal closes so a fresh open seeds cleanly from
  // the next solve's comment field.
  const [detailCommentOpen, setDetailCommentOpen] = useState(false);
  const [detailCommentDraft, setDetailCommentDraft] = useState('');
  // Comment-edit modal — when set, the inline comment editor is open
  // for that solve id. The action-row's 💬 button and the keyboard 'C'
  // shortcut both target the most-recent solve through this state.
  const [commentSolveId, setCommentSolveId] = useState<string | null>(null);
  // Delete-confirm dialog — Material-style compact confirmation that
  // appears when the user clicks ✕ or presses X. The actual deletion
  // only fires after they tap "УСТГАХ".
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // Timer preferences
  const [inspectionEnabled, setInspectionEnabled] = useState(true);
  const [precision, setPrecision] = useState<Precision>('cs');
  const [holdToStart, setHoldToStart] = useState(true); // long-press arming
  // How long the user must hold SPACE / touch before the timer arms (ms).
  // Default DEFAULT_HOLD_TIME_MS (550) = WCA Stackmat standard.
  // Configurable in Settings → Timer.
  const [holdTimeMs, setHoldTimeMs] = useState(DEFAULT_HOLD_TIME_MS);
  // When true, the running clock is replaced by a static placeholder so
  // the user can't watch the time tick during a solve. The actual elapsed
  // ms keeps counting in useTimer; only the display string changes.
  const [hideTimeWhileRunning, setHideTimeWhileRunning] = useState(false);
  // After 4 valid solves, show the BEST/WORST possible Ao5 the next solve
  // could produce. Useful for milestone awareness ("a 12s solve here drops
  // me below my PB Ao5"). Default on — it's purely additive UI.
  const [showAo5Projection, setShowAo5Projection] = useState(true);
  const [scrambleFontSize, setScrambleFontSize] = useState<'sm' | 'md' | 'lg'>('md');
  // Where the next solve's time comes from. 'default' = keyboard/touch
  // arming; 'manual' = type digits straight into the timer area;
  // 'bluetooth' = the connected smart timer drives the value (same
  // runtime path as 'default' — the distinction is informational so the
  // user knows what to expect). Persisted via PREFS_KEY.
  type TimeEntryMode = 'default' | 'manual' | 'bluetooth';
  const [timeEntryMode, setTimeEntryMode] = useState<TimeEntryMode>('default');
  // QiYi diagnostic mode — when on, surfaces the last 10 raw BLE packets
  // received from the timer in a fixed overlay so the user can confirm
  // data is arriving even when the parser silently drops it. Only useful
  // for unknown firmware variants (e.g. QY-Timer-V2-3650).
  const [qiyiDebugMode, setQiyiDebugMode] = useState(false);
  // Active colour theme. Persisted under THEME_KEY (separate from PREFS_KEY
  // so the picker can write/read without going through the prefs migration
  // path). Synced to module-level `C` during render below.
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  // Mutate the module-level palette in place every render so that
  // module-scope helper components (which captured the `C` binding at file
  // load) read the active theme's colours on this same render pass.
  Object.assign(C, THEMES[themeId].colors);
  // Default false to match SSR; updated after mount. 900px breakpoint
  // puts iPad portrait (768) on mobile layout and iPad landscape
  // (1024) on desktop.
  const [isMobile, setIsMobile] = useState(false);
  // True for the iPad-portrait / large-Android slice (≥700 px AND on
  // the mobile layout). Used to opt these tablets into a small inline
  // cube preview between the scramble and the timer — phones stay
  // clean and desktop already has the full sidebar preview.
  const [isTablet, setIsTablet] = useState(false);
  // Set true once the `check()` below has run so layout-dependent JSX
  // (desktop vs mobile vs tablet-with-cube) waits for breakpoint
  // detection. Without this gate the SSR/first-paint isMobile=false
  // briefly renders the desktop tree on iPad before the effect flips
  // it to mobile — visible as a "duplicate scramble" / missing cube
  // flash during hydration.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setIsMobile(w < 900);
      setIsTablet(w >= 700 && w < 1024);
    };
    check();
    // Defensive cleanup of any inline overflow leaked from a previous
    // page (multiplayer's racing-screen / modal effects use the snapshot-
    // and-restore pattern, which can leave body/html stuck at 'hidden'
    // when nested or interrupted by a route change). /timer reapplies
    // its own scrolling locks via the page-scoped `<style>` rule below
    // and the running-solve effect, so clearing inline values here is
    // safe — we just want a known starting point on every mount.
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
    setMounted(true);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Mobile tab navigation + entry modals
  const [mobileTab, setMobileTab] = useState<'timer' | 'solves' | 'stats' | 'tools'>('timer');
  const [mobileSearch, setMobileSearch] = useState('');

  // Solves-list sort mode. Persisted via PREFS_KEY so the user's choice
  // survives reloads. Used by both the desktop sidebar list and the
  // mobile Solves tab — same state drives both renders. Each
  // `<SortPicker />` instance owns its own open/close state.
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  // Inline manual-entry input value — only used when timeEntryMode==='manual'.
  // The legacy modal that prompted for a time has been removed; users
  // who want to type a time directly do so via the timer area itself
  // after picking "Гараар" in Settings.
  const [manualInline, setManualInline] = useState('');
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [cubeFullscreenOpen, setCubeFullscreenOpen] = useState(false);
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  type SettingsSection = 'timer' | 'shortcuts' | 'display';
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('timer');
  // Mobile accordion: which section bodies are open. Defaults to Timer.
  const [mobileExpanded, setMobileExpanded] = useState<Set<SettingsSection>>(() => new Set(['timer']));
  const toggleMobileSection = (s: SettingsSection) =>
    setMobileExpanded(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  // Two-step Alt+D confirmation for clearing the session.
  const [clearPending, setClearPending] = useState(false);
  const clearTimeoutRef = useRef<number | null>(null);
  // Mobile Solves tab — long-press to enter multi-select.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSolveIds, setSelectedSolveIds] = useState<Set<string>>(() => new Set());
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);

  // ── Derived solves + setSolves wrapper ──
  // Source of truth is `sessions`. `solves` is the active session's array.
  const currentSession = useMemo<Session | null>(() => {
    const ev = sessions[eventId];
    if (!ev) return null;
    return ev.sessions.find(s => s.id === ev.currentId) ?? ev.sessions[0] ?? null;
  }, [sessions, eventId]);
  const solves: Solve[] = currentSession?.solves ?? [];

  const setSolves = useCallback(
    (updater: Solve[] | ((prev: Solve[]) => Solve[])) => {
      setSessions(prev => {
        const ev = prev[eventId];
        if (!ev) return prev;
        const cur = ev.sessions.find(s => s.id === ev.currentId) ?? ev.sessions[0];
        if (!cur) return prev;
        const next = typeof updater === 'function'
          ? (updater as (p: Solve[]) => Solve[])(cur.solves)
          : updater;
        const list = ev.sessions.map(s => s.id === cur.id ? { ...s, solves: next } : s);
        return { ...prev, [eventId]: { sessions: list, currentId: cur.id } };
      });
    },
    [eventId],
  );

  // Ensure the active event always has at least one session.
  useEffect(() => {
    setSessions(prev => {
      const ev = prev[eventId];
      if (ev && ev.sessions.length > 0) return prev;
      const ds = makeDefaultSession();
      return { ...prev, [eventId]: { sessions: [ds], currentId: ds.id } };
    });
  }, [eventId]);

  const switchSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const ev = prev[eventId];
      if (!ev) return prev;
      if (!ev.sessions.some(s => s.id === sessionId)) return prev;
      return { ...prev, [eventId]: { ...ev, currentId: sessionId } };
    });
  }, [eventId]);

  const createSession = useCallback((rawName: string) => {
    const name = rawName.trim() || `Session ${Date.now().toString(36).slice(-4)}`;
    const ds = makeDefaultSession();
    ds.name = name;
    setSessions(prev => {
      const ev = prev[eventId];
      const list = ev ? [...ev.sessions, ds] : [ds];
      return { ...prev, [eventId]: { sessions: list, currentId: ds.id } };
    });
  }, [eventId]);

  const deleteSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const ev = prev[eventId];
      if (!ev) return prev;
      // Refuse to delete the last remaining session.
      if (ev.sessions.length <= 1) return prev;
      const list = ev.sessions.filter(s => s.id !== sessionId);
      const currentId = ev.currentId === sessionId ? list[0].id : ev.currentId;
      return { ...prev, [eventId]: { sessions: list, currentId } };
    });
  }, [eventId]);

  const renameSession = useCallback((sessionId: string, rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    setSessions(prev => {
      const ev = prev[eventId];
      if (!ev) return prev;
      const list = ev.sessions.map(s => (s.id === sessionId ? { ...s, name } : s));
      return { ...prev, [eventId]: { ...ev, sessions: list } };
    });
  }, [eventId]);

  // Refresh "X mins ago" labels every 30s
  useEffect(() => {
    const id = setInterval(() => forceTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load session from localStorage on mount
  // Load sessions store on mount, with one-time migration from v1 storage.
  const sessionsLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { store?: SessionStore; currentEventId?: string };
        if (parsed?.store && typeof parsed.store === 'object') setSessions(parsed.store);
        if (parsed?.currentEventId && EVENTS.some(e => e.id === parsed.currentEventId)) {
          setEventId(parsed.currentEventId);
          setScramble(generateScramble(parsed.currentEventId));
        }
      } else {
        // Migrate from the old single-session format.
        const old = localStorage.getItem(STORAGE_KEY);
        if (old) {
          const parsedOld = JSON.parse(old) as { solves?: Solve[]; eventId?: string };
          const oldEvent = parsedOld.eventId && EVENTS.some(e => e.id === parsedOld.eventId)
            ? parsedOld.eventId : '333';
          const oldSolves = Array.isArray(parsedOld.solves) ? parsedOld.solves : [];
          const ds = makeDefaultSession(oldSolves);
          setSessions({ [oldEvent]: { sessions: [ds], currentId: ds.id } });
          setEventId(oldEvent);
          setScramble(generateScramble(oldEvent));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[solve-load] failed', msg);
      setSaveError('Load: ' + msg.slice(0, 120));
    }
    sessionsLoadedRef.current = true;
  }, []);

  // Persist sessions store + active event whenever they change.
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionsLoadedRef.current) return;
    try {
      const payload = JSON.stringify({ store: sessions, currentEventId: eventId });
      localStorage.setItem(SESSIONS_KEY, payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[solve-save] localStorage FAILED', msg);
      setSaveError('LS: ' + msg.slice(0, 120));
    }
  }, [sessions, eventId]);
  useEffect(() => {
    if (!saveError) return;
    const t = setTimeout(() => setSaveError(null), 8000);
    return () => clearTimeout(t);
  }, [saveError]);

  // Load preferences on mount
  const prefsLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          inspectionEnabled?: boolean;
          showMs?: boolean;          // legacy (boolean) — migrated to `precision`
          precision?: Precision;
          holdToStart?: boolean;
          holdTimeMs?: number;
          hideTimeWhileRunning?: boolean;
          showAo5Projection?: boolean;
          scrambleFontSize?: 'sm' | 'md' | 'lg';
          qiyiDebugMode?: boolean;
          timeEntryMode?: TimeEntryMode;
          sortMode?: SortMode;
        };
        if (typeof parsed.inspectionEnabled === 'boolean') setInspectionEnabled(parsed.inspectionEnabled);
        if (parsed.precision === 'cs' || parsed.precision === 'ms') {
          setPrecision(parsed.precision);
        } else if (typeof parsed.showMs === 'boolean') {
          // legacy: showMs=true meant "show .00", which maps to centiseconds.
          setPrecision('cs');
        }
        if (typeof parsed.holdToStart === 'boolean')       setHoldToStart(parsed.holdToStart);
        if (typeof parsed.holdTimeMs === 'number' && Number.isFinite(parsed.holdTimeMs)) {
          // Clamp to slider range (200–1000 ms) so old / corrupted values
          // can't push the timer into a useless state.
          setHoldTimeMs(clampHoldTimeMs(parsed.holdTimeMs));
        }
        if (typeof parsed.hideTimeWhileRunning === 'boolean') setHideTimeWhileRunning(parsed.hideTimeWhileRunning);
        if (typeof parsed.showAo5Projection === 'boolean')    setShowAo5Projection(parsed.showAo5Projection);
        if (parsed.scrambleFontSize === 'sm' || parsed.scrambleFontSize === 'md' || parsed.scrambleFontSize === 'lg') {
          setScrambleFontSize(parsed.scrambleFontSize);
        }
        if (typeof parsed.qiyiDebugMode === 'boolean') setQiyiDebugMode(parsed.qiyiDebugMode);
        if (parsed.timeEntryMode === 'default' || parsed.timeEntryMode === 'manual' || parsed.timeEntryMode === 'bluetooth') {
          setTimeEntryMode(parsed.timeEntryMode);
        }
        if (parsed.sortMode === 'newest' || parsed.sortMode === 'oldest'
            || parsed.sortMode === 'fastest' || parsed.sortMode === 'slowest') {
          setSortMode(parsed.sortMode);
        }
      }
    } catch { /* ignore */ }
    prefsLoadedRef.current = true;
  }, []);

  // Persist preferences (skip the very first render before load completes)
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ inspectionEnabled, precision, holdToStart, holdTimeMs, hideTimeWhileRunning, showAo5Projection, scrambleFontSize, qiyiDebugMode, timeEntryMode, sortMode }));
    } catch { /* ignore */ }
  }, [inspectionEnabled, precision, holdToStart, holdTimeMs, hideTimeWhileRunning, showAo5Projection, scrambleFontSize, qiyiDebugMode, timeEntryMode, sortMode]);

  // Load/persist active theme. Kept in its own slot rather than inside
  // PREFS_KEY so an older device with stale prefs JSON doesn't accidentally
  // wipe a freshly-picked theme on the next save.
  const themeLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(THEME_KEY);
      if (raw && raw in THEMES) setThemeId(raw as ThemeId);
    } catch { /* ignore */ }
    themeLoadedRef.current = true;
  }, []);
  useEffect(() => {
    if (!themeLoadedRef.current) return;
    try { localStorage.setItem(THEME_KEY, themeId); } catch { /* ignore */ }
  }, [themeId]);

  // Mirror the theme's bg onto <body> and <html> so the overscroll /
  // rubber-band area on mobile, and any 100vh measurement gap, blend with
  // the page instead of showing the user-agent default (white) or the
  // previous theme's bg. The page wrapper paints any bgGradient on top;
  // body/html use the solid colour so the rubber-band area stays a clean
  // single tone rather than a tiled gradient peeking past the edge.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const bg = THEMES[themeId].colors.bg;
    const prevBody = document.body.style.background;
    const prevHtml = document.documentElement.style.background;
    document.body.style.background = bg;
    document.documentElement.style.background = bg;
    return () => {
      document.body.style.background = prevBody;
      document.documentElement.style.background = prevHtml;
    };
  }, [themeId]);

  // Stats — recomputed on every solves change
  const stats = useMemo(() => calcStats(solves), [solves]);

  // Sorted solves for the Solves list views. We sort on `s.ts` (the
  // existing completion timestamp) for newest/oldest, and on `finalMs`
  // for fastest/slowest. DNFs always settle to the extreme of a value
  // sort (end for fastest, start for slowest) so they never pretend to
  // be a 0-ms result. The sorted array is the render order; rendering
  // code still resolves the chronological "#N" badge from the unsorted
  // `solves` so the index never changes when the user re-sorts.
  const sortedSolves = useMemo(() => {
    const arr = solves.slice();
    switch (sortMode) {
      case 'newest':
        return arr.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
      case 'oldest':
        return arr.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
      case 'fastest':
        return arr.sort((a, b) => {
          const aDnf = a.penalty === 'dnf';
          const bDnf = b.penalty === 'dnf';
          if (aDnf && !bDnf) return 1;
          if (!aDnf && bDnf) return -1;
          if (aDnf && bDnf) return 0;
          return finalMs(a) - finalMs(b);
        });
      case 'slowest':
        return arr.sort((a, b) => {
          const aDnf = a.penalty === 'dnf';
          const bDnf = b.penalty === 'dnf';
          if (aDnf && !bDnf) return -1;
          if (!aDnf && bDnf) return 1;
          if (aDnf && bDnf) return 0;
          return finalMs(b) - finalMs(a);
        });
    }
  }, [solves, sortMode]);

  // Chronological-position lookup. Built once per `solves` change so the
  // hot inner loops (desktop + mobile rows) don't pay an O(n) findIndex
  // per row. Maps each solve's id → its 1-based position in the unsorted
  // array (1 = first solve ever made; N = most recent).
  const chronologicalIndexById = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < solves.length; i++) m.set(solves[i].id, i + 1);
    return m;
  }, [solves]);

  // Ao5 projection — given the trailing 4 valid solves, what's the
  // best/worst Ao5 the next solve could produce?
  //   best  = next solve hypothetically perfect (0 ms) → drops as the
  //           best, worst of the four drops as the worst, average the
  //           remaining 3 fastest = (t1 + t2 + t3) / 3
  //   worst = next solve hypothetically DNF → DNF drops as the worst,
  //           fastest of the four drops as the best, average the
  //           remaining 3 slowest = (t2 + t3 + t4) / 3
  // Returns null when projection isn't meaningful (fewer than 4 solves,
  // any DNF in the trailing window, or the user has it toggled off).
  const ao5Projection = useMemo(() => {
    if (!showAo5Projection) return null;
    if (solves.length < 4) return null;
    // Show only on solves 4, 9, 14, 19… — i.e. right before a 5-solve
    // window completes. Once the Ao5 lands (5, 10, 15…) it disappears
    // until the next "4 since reset" milestone, so the projection never
    // overlaps with the just-formed real Ao5 in the side panel.
    if (solves.length % 5 !== 4) return null;
    const trailingFour = solves.slice(-4);
    if (trailingFour.some(isDnf)) return null;
    const [t1, t2, t3, t4] = trailingFour.map(finalMs).sort((a, b) => a - b);
    return {
      best:  (t1 + t2 + t3) / 3,
      worst: (t2 + t3 + t4) / 3,
    };
  }, [solves, showAo5Projection]);
  const sessionEvent = useMemo(() => EVENTS.find(e => e.id === eventId) ?? EVENTS[0], [eventId]);

  // Presence: register the user as online in /presence/timer/{uid}.
  // Runs once on login; event changes are handled by the second effect.
  useEffect(() => {
    if (!user?.uid || !user.displayName) return;
    const eventName = sessionEvent?.name ?? eventId;
    return trackPresence(
      user.uid,
      user.displayName,
      user.photoURL ?? null,
      eventId,
      eventName,
    );
    // intentionally omit eventId / sessionEvent — initial write captures the
    // current event; subsequent changes go through updatePresenceEvent below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.displayName, user?.photoURL]);

  // Update the presence record whenever the active event changes.
  useEffect(() => {
    if (!user?.uid) return;
    const eventName = sessionEvent?.name ?? eventId;
    updatePresenceEvent(user.uid, eventId, eventName);
  }, [eventId, user?.uid, sessionEvent?.name]);

  // Commit a solve to the active session and immediately roll a new scramble
  // so the timer is ready for the next attempt. Inline scramble generation
  // here is more reliable than a length-comparison effect, which got out of
  // sync when switching events/sessions changed `solves.length` without a
  // new solve actually being added.
  //
  // Awards (logged-in users only, all best-effort):
  //   * 1 pt per solve, capped at 50/day. Lifetime totalSolves still
  //     increments past the cap.
  //   * 20 pt for a new Ao5 PB — but only after the user has accumulated
  //     ≥100 lifetime solves. Single-solve PBs no longer award (UI still
  //     highlights them; this is just about the points).
  const onSolveCommit = useCallback((ms: number, penalty: Penalty) => {
    let candidateAo5: number | null = null;
    setSolves(prev => {
      const next: Solve[] = [
        ...prev,
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ms, penalty,
          scramble, event: eventId, ts: Date.now(),
          ...(sharedCode && sharedIndex != null ? { sharedCode, sharedIndex } : {}),
        },
      ];
      // Ao5-PB candidate detection. Walk every rolling 5-solve window
      // ending at `next[i]` for the current event; the candidate is the
      // window's Ao5 ONLY if it ties or beats every prior window's Ao5.
      // (Ties don't actually award — `awardAo5PbIfEligible` requires
      // strictly less than the persisted per-event best — but they're
      // cheap to surface here so we don't false-negative.)
      const eventSolves = next.filter(s => s.event === eventId);
      if (eventSolves.length >= 5) {
        let bestPriorAo5: number | null = null;
        for (let i = 4; i < eventSolves.length; i++) {
          const window = eventSolves.slice(i - 4, i + 1);
          const ao = avgOfN(window, 5);
          if (ao === null) continue;
          if (i < eventSolves.length - 1) {
            if (bestPriorAo5 === null || ao < bestPriorAo5) bestPriorAo5 = ao;
          } else {
            // Latest window — same one that includes the just-committed
            // solve. Surface as a candidate iff it's at least as good as
            // every prior (the service will reject if not strictly
            // better than the persisted best).
            if (bestPriorAo5 === null || ao <= bestPriorAo5) candidateAo5 = ao;
          }
        }
      }
      return next;
    });
    // Shared mode: the next scramble is simply the next index.
    if (sharedCode) stepShared(1);
    else setScramble(generateScramble(eventId));

    const uid = user?.uid;
    if (!uid) return;
    // Solve point + lifetime counter. No toast (would be spammy at 50/day).
    awardSolvePointIfUnderLimit(uid).catch(err =>
      console.warn('[points] solve award failed', err),
    );
    // Ao5-PB award — service is responsible for the threshold + global
    // per-event best comparison. We pass the candidate ms; the
    // transaction either awards, returns 'below_threshold' (silent), or
    // returns 'not_better' (silent).
    if (candidateAo5 !== null) {
      awardAo5PbIfEligible(uid, eventId, candidateAo5)
        .then(r => {
          if (r.awarded) showToast({ msg: 'Ao5 PB! +20 💎', tone: 'success' });
          else if (r.reason === 'below_threshold') {
            console.log(
              `[points] Ao5 PB candidate (${eventId}, ${candidateAo5}ms) — below threshold (${r.totalSolves}/${r.threshold} solves)`,
            );
          }
        })
        .catch(err => console.warn('[points] Ao5 PB award failed', err));
    }
  }, [scramble, eventId, user?.uid, sharedCode, sharedIndex, stepShared]);

  const timer = useTimer(onSolveCommit, holdTimeMs);

  // Keep the screen on while the user is actively solving (inspecting /
  // armed / running). We deliberately drop the lock on 'stopped' and 'idle'
  // so the device can save power between solves. Browser auto-releases on
  // tab hide; the hook re-acquires when the user returns and is still in
  // an active state.
  useWakeLock(
    timer.state === 'inspecting' || timer.state === 'armed' || timer.state === 'running',
  );

  // Lock the document scroll during an active solve so that pulling /
  // bouncing on the timer area on iPad / iPhone doesn't drift the
  // viewport away from the digits. The lock applies in 'inspecting',
  // 'armed', and 'running'; it lifts the moment the timer is back to
  // 'idle' or 'stopped'. Restored on unmount in case the user
  // navigates away mid-solve.
  useEffect(() => {
    const active = timer.state === 'inspecting' || timer.state === 'armed' || timer.state === 'running';
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [timer.state]);

  // Cooldown after a solve completes. The action row (✕ / ⊘ / +2 / 💬)
  // appears the instant timer.state flips to 'stopped' — but the touch
  // that stopped the timer is still mid-flight, and if the user's finger
  // lifts on top of a freshly rendered button it triggers an unwanted
  // action (DNF / +2 / Delete). Render the buttons immediately but keep
  // them visually-dim and pointerEvents:'none' for a brief window so the
  // lift-off can't fire on them; flip to armed=true once the touch is
  // safely over.
  // 600 ms post-stop cooldown that gates the TIMER-AREA's tap-to-start
  // behaviour. While the cooldown is running, an accidental tap near
  // (but not on) an action button is absorbed instead of starting a
  // new solve and dismissing the row. The action buttons themselves
  // stay interactive throughout — `actionsArmed` does NOT disable the
  // row anymore, only the surrounding tap-to-arm surface.
  const [actionsArmed, setActionsArmed] = useState(false);
  useEffect(() => {
    if (timer.state !== 'stopped') {
      setActionsArmed(false);
      return;
    }
    setActionsArmed(false);
    const id = window.setTimeout(() => setActionsArmed(true), 600);
    return () => window.clearTimeout(id);
  }, [timer.state]);

  // Wallclock timestamp captured when the timer enters the 'running'
  // state. The fullscreen tap-to-stop overlay (mounted below) uses this
  // to drop taps inside the first 50 ms of a run — the SAME touch that
  // fired fireRunning / startRunning could otherwise bubble straight
  // back into the overlay and stop the timer at 0.0s.
  const runStartedAtRef = useRef<number>(0);
  const mobileTimerRef = useRef<HTMLElement>(null);
  const gestureDelayRef = useRef<number | null>(null);
  useEffect(() => {
    if (timer.state === 'running') runStartedAtRef.current = Date.now();
  }, [timer.state]);

  // Tap-to-stop overlay lifecycle. The overlay stays mounted while the
  // timer is running AND for ~300 ms after it stops — long enough to
  // swallow the lingering touchend/click events from the same touch
  // that stopped the timer. Without this trailing window, the user's
  // lift-off used to bleed through to whatever sat underneath (the
  // mobile bottom nav, especially), changing tabs the moment they
  // stopped a solve. The overlay handlers themselves only call
  // `timer.stop()` while state is actually 'running'; during the
  // post-stop window the overlay is inert except for absorbing input.
  const [overlayActive, setOverlayActive] = useState(false);
  const overlayTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    if (timer.state === 'running') {
      if (overlayTimeoutRef.current != null) {
        window.clearTimeout(overlayTimeoutRef.current);
        overlayTimeoutRef.current = null;
      }
      setOverlayActive(true);
    } else {
      if (overlayTimeoutRef.current != null) {
        window.clearTimeout(overlayTimeoutRef.current);
      }
      overlayTimeoutRef.current = window.setTimeout(() => {
        setOverlayActive(false);
        overlayTimeoutRef.current = null;
      }, 300);
    }
    return () => {
      if (overlayTimeoutRef.current != null) {
        window.clearTimeout(overlayTimeoutRef.current);
        overlayTimeoutRef.current = null;
      }
    };
  }, [timer.state]);

  // ── Bluetooth timer (GAN + QiYi) ────────────────────────────────────────
  // Both brands feed the same set of callbacks, so the rest of the page
  // doesn't care which protocol is driving the solve. The active brand is
  // selected in Settings; only one connection is live at a time.
  const ganTimerRef = useRef(timer);
  ganTimerRef.current = timer;
  const [ganDisplayMs, setGanDisplayMs] = useState(0);
  const ganStartTimeRef = useRef<number | null>(null);
  const ganIntervalRef = useRef<number | null>(null);

  const stopGanInterval = useCallback(() => {
    if (ganIntervalRef.current != null) {
      window.clearInterval(ganIntervalRef.current);
      ganIntervalRef.current = null;
    }
    ganStartTimeRef.current = null;
  }, []);

  const handleBtSolveStart = useCallback(() => {
    ganStartTimeRef.current = Date.now();
    setGanDisplayMs(0);
    if (ganIntervalRef.current != null) {
      window.clearInterval(ganIntervalRef.current);
    }
    ganIntervalRef.current = window.setInterval(() => {
      const start = ganStartTimeRef.current;
      if (start != null) setGanDisplayMs(Date.now() - start);
    }, 10);
    ganTimerRef.current.startRunning();
  }, []);
  const handleBtSolveStop = useCallback((finalMs: number) => {
    stopGanInterval();
    setGanDisplayMs(finalMs);
    ganTimerRef.current.finishExternal(finalMs);
  }, [stopGanInterval]);
  const handleBtIdle = useCallback(() => {
    stopGanInterval();
    setGanDisplayMs(0);
    ganTimerRef.current.reset();
  }, [stopGanInterval]);

  // Single Bluetooth timer facade — opens one combined picker, detects
  // brand from the chosen device's name, and routes to the right
  // protocol underneath. Replaces the previous setup where the user
  // had to manually pick GAN vs QiYi before connecting. `gan` keeps
  // its name purely for downstream-call-site continuity.
  const gan = useSmartTimer({
    onSolveStart: handleBtSolveStart,
    onSolveStop: handleBtSolveStop,
    onIdle: handleBtIdle,
  });
  const ganConnected = gan.state === 'connected';
  // Human-readable label for whichever brand is currently connected.
  // Falls back to the persisted last-connected brand so the
  // "Last: GAN HALO-…" hint reads correctly between sessions.
  const connectedTimerName: string | null = ganConnected
    ? `${gan.brand === 'qiyi' ? 'QiYi' : 'GAN'} Timer`
    : null;

  // Safety net: clear the interval on unmount or if the connection drops.
  useEffect(() => {
    if (!ganConnected) stopGanInterval();
    return () => stopGanInterval();
  }, [ganConnected, stopGanInterval]);

  // Scramble history — last 10 scrambles for the active event, newest
  // first. Swipe (mobile) or ← → arrow keys (desktop) move through it.
  // Reset whenever the event changes since cross-event history would
  // confuse the "previous" semantic.
  const [scrambleHistory, setScrambleHistory] = useState<string[]>([]);
  // Index into scrambleHistory representing what's currently displayed.
  // 0 = newest (also `scramble`); -1 = uninitialised / first generate.
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const SCRAMBLE_HISTORY_MAX = 10;

  // In shared mode "new" / "next" / "previous" just move the shared
  // index (the scramble itself is derived from it); the random history
  // below is only used in normal mode.
  const newScramble = useCallback(() => {
    if (sharedCode) { stepShared(1); return; }
    const next = generateScramble(eventId);
    setScramble(next);
    setScrambleHistory(prev => {
      const dedup = prev[0] === next ? prev : [next, ...prev];
      return dedup.slice(0, SCRAMBLE_HISTORY_MAX);
    });
    setHistoryIdx(0);
  }, [eventId, sharedCode, stepShared]);
  // Swipe-right / ← arrow: walk back through history. Caps at the
  // oldest entry (no auto-generate of a "back" scramble — that would be
  // meaningless, you'd just be peeking at a fresh random instead).
  const goPrevScramble = useCallback(() => {
    if (sharedCode) { stepShared(-1); return; }
    setHistoryIdx(idx => {
      const next = Math.min(idx + 1, scrambleHistory.length - 1);
      if (next === idx) return idx;
      const target = scrambleHistory[next];
      if (target) setScramble(target);
      return next;
    });
  }, [scrambleHistory, sharedCode, stepShared]);
  // Swipe-left / → arrow: forward. If we're at the newest entry already
  // (idx === 0), generate a fresh one. Otherwise walk towards 0.
  const goNextScramble = useCallback(() => {
    if (sharedCode) { stepShared(1); return; }
    if (historyIdx <= 0) {
      newScramble();
      return;
    }
    setHistoryIdx(idx => {
      const next = Math.max(0, idx - 1);
      const target = scrambleHistory[next];
      if (target) setScramble(target);
      return next;
    });
  }, [historyIdx, scrambleHistory, newScramble, sharedCode, stepShared]);

  // Shared-mode ("Ижил холилт") entry / exit — used by the tools panel
  // (desktop right panel, mobile enlarged preview) and the active bar.
  const enterSharedMode = useCallback((code: string) => {
    if (!isValidSharedCode(code)) return;
    updateShared(prev => (prev?.code === code ? prev : { code, indexes: {} }));
  }, [updateShared]);

  // Which view the preview/tools panel shows; remembered across visits.
  const [toolsTab, setToolsTabState] = useState<ToolsTab>('preview');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOOLS_TAB_KEY);
      if (saved === 'preview' || saved === 'shared') setToolsTabState(saved);
    } catch { /* ignore */ }
  }, []);
  const setToolsTab = useCallback((tab: ToolsTab) => {
    setToolsTabState(tab);
    try { localStorage.setItem(TOOLS_TAB_KEY, tab); } catch { /* ignore */ }
  }, []);
  const leaveSharedMode = useCallback(() => {
    updateShared(() => null);
    // Back to normal: start from a fresh random scramble.
    const fresh = generateScramble(eventId);
    setScramble(fresh);
    setScrambleHistory([fresh]);
    setHistoryIdx(0);
  }, [updateShared, eventId]);

  // When event changes (dropdown, Alt+key, etc.), regenerate scramble
  // and reset history — cross-event history would mix puzzle types.
  useEffect(() => {
    const fresh = generateScramble(eventId);
    setScramble(fresh);
    setScrambleHistory([fresh]);
    setHistoryIdx(0);
  }, [eventId]);

  // ── Solve action handlers ────────────────────────────────────────────────
  // (Declared before the keyboard useEffect so the D/X/2/C shortcuts
  //  can call togglePenaltyOnLast / deleteLastSolve without a TDZ
  //  binding violation.)
  const deleteSolve = useCallback((id: string) => {
    setSolves(prev => prev.filter(s => s.id !== id));
  }, [setSolves]);
  const setSolvePenalty = useCallback((id: string, p: Penalty) => {
    setSolves(prev => prev.map(s => s.id === id ? { ...s, penalty: p } : s));
  }, [setSolves]);
  // Comment is stored as `undefined` when cleared so the field doesn't
  // serialize as an empty string in JSON snapshots / exports. Trimmed
  // before save to keep accidental whitespace out of the data.
  const setSolveComment = useCallback((id: string, comment: string) => {
    const trimmed = comment.trim();
    setSolves(prev => prev.map(s => {
      if (s.id !== id) return s;
      const next: Solve = { ...s };
      if (trimmed) next.comment = trimmed;
      else delete next.comment;
      return next;
    }));
  }, [setSolves]);

  // Whenever the Solve Detail modal closes (or swaps to a different
  // solve), drop the inline comment-panel state so a fresh open seeds
  // from that solve's own comment rather than the previous one.
  useEffect(() => {
    setDetailCommentOpen(false);
    setDetailCommentDraft('');
  }, [detailSolveId]);

  // Share the targeted solve via the Web Share API on supported devices
  // (iOS / Android / some desktop browsers); fall back to clipboard on
  // anything else, with a toast confirming the copy. Selection-cancel
  // (AbortError) is silent — the user explicitly dismissed the sheet.
  const onShareSolve = useCallback(async (solve: Solve) => {
    const text = buildSolveShareText(solve, precision);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        showToast({ msg: 'Хуулагдлаа ✓', tone: 'success' });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[timer] share solve failed', err);
      try {
        await navigator.clipboard.writeText(text);
        showToast({ msg: 'Хуулагдлаа ✓', tone: 'success' });
      } catch {
        showToast({ msg: 'Хуулж чадсангүй', tone: 'error' });
      }
    }
  }, [precision]);

  // Inline action-row helpers — operate on the most-recent solve, which
  // is what the buttons under the timer display target. The DNF / +2
  // buttons SET the penalty (the action row only renders when penalty
  // is 'none', so there's no toggle path through the buttons). Reverting
  // happens via the dedicated undo arrow (`undoPenaltyOnLast`). The
  // keyboard-shortcut path uses togglePenaltyOnLast so D/2 keep their
  // press-twice-to-cancel behavior.
  const lastSolve: Solve | undefined = solves[solves.length - 1];
  const setPenaltyOnLast = useCallback((p: '+2' | 'dnf') => {
    if (!lastSolve) return;
    setSolvePenalty(lastSolve.id, p);
    // No toast — the big-timer display already swaps to "DNF" / "<time>+"
    // and the action row collapses to just an undo arrow. The visual
    // change IS the feedback.
  }, [lastSolve, setSolvePenalty]);
  const undoPenaltyOnLast = useCallback(() => {
    if (!lastSolve) return;
    setSolvePenalty(lastSolve.id, 'none');
  }, [lastSolve, setSolvePenalty]);
  const togglePenaltyOnLast = useCallback((p: '+2' | 'dnf') => {
    if (!lastSolve) return;
    const next: Penalty = lastSolve.penalty === p ? 'none' : p;
    setSolvePenalty(lastSolve.id, next);
    // No toast — display swap is the feedback (same rationale as
    // setPenaltyOnLast).
  }, [lastSolve, setSolvePenalty]);
  const confirmDeleteLastSolve = useCallback(() => {
    if (!lastSolve) return;
    deleteSolve(lastSolve.id);
    timer.reset();
    setDeleteConfirmOpen(false);
    // No toast — closing the dialog + the timer flipping back to idle
    // makes the deletion unambiguous.
  }, [lastSolve, deleteSolve, timer]);
  // Public delete trigger used by the X keyboard shortcut — opens the
  // confirmation dialog rather than deleting straight away. Kept under
  // the same name as before so the keydown handler doesn't have to
  // change shape.
  const deleteLastSolve = useCallback(() => {
    if (!lastSolve) return;
    setDeleteConfirmOpen(true);
  }, [lastSolve]);

  // ── Keyboard handlers ────────────────────────────────────────────────────
  // SPACE: state machine driver
  // ESC: cancel/reset current attempt
  // D:   toggle DNF on last solve (when stopped)
  // X:   delete last solve (when stopped)
  // 2:   toggle +2 on last solve (when stopped)
  // C:   open comment editor for last solve (when stopped)
  // N:   new scramble (when idle)
  const spaceHeldRef = useRef(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        // In manual-entry mode SPACE is reserved for the numeric input
        // (and shouldn't arm anything). If the user happens to be in
        // an input/textarea, also let SPACE through for normal typing.
        if (timeEntryMode === 'manual') return;
        const tgt = e.target as HTMLElement | null;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
        e.preventDefault();
        if (spaceHeldRef.current) return;
        spaceHeldRef.current = true;
        // GAN timer takes over the timer state machine when connected.
        if (ganConnected) return;
        if (timer.state === 'running') {
          timer.stop();
          return;
        }
        if (timer.state === 'idle' || timer.state === 'stopped') {
          if (inspectionEnabled) {
            timer.beginInspection();
          } else if (holdToStart) {
            timer.startArming();
          } else {
            timer.startRunning();
          }
          return;
        }
        if (timer.state === 'inspecting') {
          if (holdToStart) timer.startArming();
          else timer.startRunning();
          return;
        }
      }
      // Quick-action shortcuts that mirror the buttons under the timer
      // display. Only fire when a solve has just finished (state ===
      // 'stopped'), no modifiers are pressed, no other modal owns
      // focus, and the user isn't typing in an input.
      if (
        !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey
        && timer.state === 'stopped'
        && solves.length > 0
        && !settingsOpen && !detailSolveId && commentSolveId == null
        && !sessionPanelOpen && !cubeFullscreenOpen
      ) {
        const target = e.target as HTMLElement | null;
        const inEditable = !!target && (
          target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
        );
        if (!inEditable) {
          if (e.code === 'KeyD') {
            e.preventDefault();
            togglePenaltyOnLast('dnf');
            return;
          }
          if (e.code === 'KeyX') {
            e.preventDefault();
            deleteLastSolve();
            return;
          }
          // '2' on the top number row OR numpad — both produce e.code
          // 'Digit2' / 'Numpad2'.
          if (e.code === 'Digit2' || e.code === 'Numpad2') {
            e.preventDefault();
            togglePenaltyOnLast('+2');
            return;
          }
          if (e.code === 'KeyC') {
            e.preventDefault();
            const last = solves[solves.length - 1];
            if (last) setCommentSolveId(last.id);
            return;
          }
        }
      }

      // Scramble navigation: ← previous, → next/new, N = new.
      // Only when timer isn't actively armed/running, no modifier keys,
      // and not focused on an editable element. Mirrors the mobile
      // swipe gesture so desktop users have parity.
      if (
        !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey
        && (timer.state === 'idle' || timer.state === 'stopped')
        && !settingsOpen && !detailSolveId && commentSolveId == null
        && !sessionPanelOpen && !cubeFullscreenOpen
      ) {
        const tgt = e.target as HTMLElement | null;
        const inEditable = !!tgt && (
          tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable
        );
        if (!inEditable) {
          if (e.code === 'ArrowLeft') {
            e.preventDefault();
            goPrevScramble();
            return;
          }
          if (e.code === 'ArrowRight') {
            e.preventDefault();
            goNextScramble();
            return;
          }
          if (e.code === 'KeyN') {
            e.preventDefault();
            newScramble();
            return;
          }
        }
      }

      // Alt+key combinations: event switching + session clear.
      // Only handle when timer isn't running to avoid disrupting an active solve.
      if (e.altKey && !e.metaKey && !e.ctrlKey && (timer.state === 'idle' || timer.state === 'stopped')) {
        // Alt+D — two-step clear current session
        if (e.code === 'KeyD') {
          e.preventDefault();
          if (clearPending) {
            setSolves([]);
            setClearPending(false);
            if (clearTimeoutRef.current != null) {
              window.clearTimeout(clearTimeoutRef.current);
              clearTimeoutRef.current = null;
            }
          } else {
            setClearPending(true);
            if (clearTimeoutRef.current != null) {
              window.clearTimeout(clearTimeoutRef.current);
            }
            clearTimeoutRef.current = window.setTimeout(() => {
              setClearPending(false);
              clearTimeoutRef.current = null;
            }, 3000);
          }
          return;
        }
        // Alt+1..7 / S / M / C / P — switch event
        const target = ALT_EVENT_KEYS[e.code];
        if (target) {
          e.preventDefault();
          setEventId(target);
          return;
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault();
        spaceHeldRef.current = false;
        if (timer.state === 'armed') {
          timer.fireRunning();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    timer, inspectionEnabled, holdToStart, clearPending, setSolves, ganConnected,
    // Quick-action shortcut deps — keep handler current with the latest
    // last-solve / modal state so D/X/2/C hit the right target.
    solves, togglePenaltyOnLast, deleteLastSolve,
    settingsOpen, detailSolveId, commentSolveId,
    sessionPanelOpen, cubeFullscreenOpen,
    timeEntryMode,
    goPrevScramble, goNextScramble, newScramble,
  ]);

  // Clear any pending Alt+D timeout on unmount.
  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current != null) {
        window.clearTimeout(clearTimeoutRef.current);
        clearTimeoutRef.current = null;
      }
    };
  }, []);

  // Mobile: tap timer area. Disabled while a GAN timer is connected.
  // Also disabled in 'manual' mode — the timer area is an input field
  // there, and the user's tap goes into the input, not into arming.
  const onTimerTouchStart = useCallback((e: React.TouchEvent) => {
    if (timeEntryMode === 'manual') return;
    if (ganConnected) return;
    if (timer.state === 'running') { timer.stop(); return; }
    // Cooldown window after a solve ends: the action row (✕ / DNF / +2
    // / 💬) is now visible and the user is most likely aiming at one
    // of those buttons. Drop taps that bubble up here from the timer
    // section's surrounding area until the cooldown clears, so a
    // mistap doesn't transition state out of 'stopped' and dismiss the
    // row. After the cooldown, taps on the timer area resume their
    // normal "start a new solve" semantics.
    if (timer.state === 'stopped' && !actionsArmed) return;
    // When a two-finger gesture is possible (stopped + lastSolve on
    // mobile), delay the timer transition by 80ms so the second finger
    // has time to land. If a second finger arrives, the native gesture
    // handler cancels this timeout. The 80ms sits on top of the 600ms
    // actionsArmed cooldown so total latency from solve-stop to earliest
    // possible next start is 680ms — imperceptible to the user who is
    // already reviewing their time during that window.
    if (isMobile && timer.state === 'stopped' && lastSolve && actionsArmed) {
      if (e.touches.length >= 2) {
        if (gestureDelayRef.current != null) {
          window.clearTimeout(gestureDelayRef.current);
          gestureDelayRef.current = null;
        }
        return;
      }
      if (gestureDelayRef.current != null) window.clearTimeout(gestureDelayRef.current);
      gestureDelayRef.current = window.setTimeout(() => {
        gestureDelayRef.current = null;
        if (inspectionEnabled) timer.beginInspection();
        else if (holdToStart) timer.startArming();
        else timer.startRunning();
      }, 80);
      return;
    }
    if (timer.state === 'idle' || timer.state === 'stopped') {
      if (inspectionEnabled) {
        timer.beginInspection();
      } else if (holdToStart) {
        timer.startArming();
      } else {
        timer.startRunning();
      }
      return;
    }
    if (timer.state === 'inspecting') {
      if (holdToStart) timer.startArming();
      else timer.startRunning();
    }
  }, [timer, inspectionEnabled, holdToStart, ganConnected, timeEntryMode, actionsArmed, lastSolve, isMobile]);

  const onTimerTouchEnd = useCallback(() => {
    if (timeEntryMode === 'manual') return;
    if (timer.state === 'armed') timer.fireRunning();
  }, [timer, timeEntryMode]);

  // ── Two-finger gesture shortcuts (mobile only) ───────────────────────
  // Tap = open delete confirm, swipe-up = toggle +2, swipe-down = toggle DNF.
  // Native listeners with passive:false so preventDefault blocks pinch-zoom.
  //
  // Refs keep the native handler reading fresh React state without
  // re-attaching listeners on every render / state change.
  const twoFingerRef = useRef<{
    startTime: number;
    startY1: number; startY2: number;
    lastY1: number; lastY2: number;
  } | null>(null);
  const timerStateRef = useRef(timer.state);
  timerStateRef.current = timer.state;
  const lastSolveRef = useRef(lastSolve);
  lastSolveRef.current = lastSolve;
  const deleteLastSolveRef = useRef(deleteLastSolve);
  deleteLastSolveRef.current = deleteLastSolve;
  const togglePenaltyRef = useRef(togglePenaltyOnLast);
  togglePenaltyRef.current = togglePenaltyOnLast;

  useEffect(() => {
    const el = mobileTimerRef.current;
    if (!el || !isMobile) return;

    const onStart = (e: TouchEvent) => {
      const canGesture = timerStateRef.current === 'stopped' && !!lastSolveRef.current;
      if (e.touches.length === 2 && canGesture) {
        e.preventDefault();
        if (gestureDelayRef.current != null) {
          window.clearTimeout(gestureDelayRef.current);
          gestureDelayRef.current = null;
        }
        twoFingerRef.current = {
          startTime: Date.now(),
          startY1: e.touches[0].clientY,
          startY2: e.touches[1].clientY,
          lastY1: e.touches[0].clientY,
          lastY2: e.touches[1].clientY,
        };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!twoFingerRef.current || e.touches.length < 2) return;
      e.preventDefault();
      twoFingerRef.current.lastY1 = e.touches[0].clientY;
      twoFingerRef.current.lastY2 = e.touches[1].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      if (!twoFingerRef.current) return;
      if (e.touches.length > 0) return;
      const g = twoFingerRef.current;
      twoFingerRef.current = null;

      const avgStartY = (g.startY1 + g.startY2) / 2;
      const avgEndY = (g.lastY1 + g.lastY2) / 2;
      const deltaY = avgEndY - avgStartY;
      const duration = Date.now() - g.startTime;

      const SWIPE_THRESHOLD = 50;
      const TAP_DURATION_MAX = 300;
      const TAP_MOVEMENT_MAX = 10;

      if (Math.abs(deltaY) < TAP_MOVEMENT_MAX && duration < TAP_DURATION_MAX) {
        deleteLastSolveRef.current();
        showToast({ msg: '✕ Устгах уу?', tone: 'info' });
      } else if (deltaY < -SWIPE_THRESHOLD) {
        togglePenaltyRef.current('+2');
        showToast({ msg: '+2 applied', tone: 'info' });
      } else if (deltaY > SWIPE_THRESHOLD) {
        togglePenaltyRef.current('dnf');
        showToast({ msg: 'DNF applied', tone: 'info' });
      }
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [isMobile, mobileTab]);

  // Inline-manual-entry commit. Same parser + same `finishExternal`
  // path as the legacy modal — `onSolveCommit` runs as if a real solve
  // finished, which appends the solve and rolls a fresh scramble. The
  // input clears so the user can type the next time straight away.
  const commitManualInline = useCallback(() => {
    const ms = parseManualTime(manualInline);
    if (ms == null) return;
    timer.finishExternal(ms);
    setManualInline('');
  }, [manualInline, timer]);

  // ── Mobile multi-select (Solves tab) ─────────────────────────────────────
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedSolveIds(new Set());
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressFiredRef.current = false;
  }, []);

  const startSolveLongPress = (id: string, e: React.TouchEvent) => {
    const t = e.touches[0];
    longPressOriginRef.current = { x: t.clientX, y: t.clientY };
    longPressFiredRef.current = false;
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      setSelectMode(true);
      setSelectedSolveIds(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      longPressTimerRef.current = null;
    }, 500);
  };

  const moveSolveLongPress = (e: React.TouchEvent) => {
    const origin = longPressOriginRef.current;
    if (!origin || longPressTimerRef.current == null) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - origin.x) > 8 || Math.abs(t.clientY - origin.y) > 8) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const endSolveLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  };

  const handleSolveCardClick = (id: string) => {
    if (longPressFiredRef.current) {
      // Long-press already added this card to selection — swallow the click.
      longPressFiredRef.current = false;
      return;
    }
    if (selectMode) {
      setSelectedSolveIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      return;
    }
    setDetailSolveId(id);
  };

  const selectAllVisible = (ids: string[]) => {
    setSelectedSolveIds(new Set(ids));
  };

  const confirmDeleteSelected = () => {
    const count = selectedSolveIds.size;
    if (count === 0) return;
    if (!confirm(`Delete ${count} solve${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setSolves(prev => prev.filter(s => !selectedSolveIds.has(s.id)));
    exitSelectMode();
  };

  // Leave select-mode when navigating away from the Solves tab.
  useEffect(() => {
    if (mobileTab !== 'solves' && (selectMode || selectedSolveIds.size > 0)) {
      exitSelectMode();
    }
    // exitSelectMode is stable; selectedSolveIds + selectMode read in body
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileTab]);

  // Smart digit-only parser: last 2 digits = centiseconds, next 2 = seconds,
  // remaining = minutes. Examples:
  //   "1221"   → 12.21s   (12s 21cs)
  //   "122"    → 1.22s    (1s 22cs)
  //   "12211"  → 1:22.11


  // ── PB detection (for the most recent solve) ─────────────────────────────
  const lastSolveIsPB = useMemo(() => {
    if (solves.length < 2) return solves.length === 1 && !isDnf(solves[0]);
    const last = solves[solves.length - 1];
    if (isDnf(last)) return false;
    const prevBest = Math.min(...solves.slice(0, -1).filter(s => !isDnf(s)).map(finalMs));
    return finalMs(last) < prevBest;
  }, [solves]);

  // Display string for the big timer. After a solve finishes the
  // display reflects the most-recent solve's penalty state so DNF and
  // +2 toggles produce immediate, full-screen feedback (no need to
  // navigate to the Solves tab to verify the change took).
  const timerDisplay = (() => {
    if (timer.state === 'inspecting') {
      const sec = Math.max(-2, timer.inspectionMs / 1000);
      if (sec >= 0) return Math.ceil(sec).toString();
      return sec <= -2 ? 'DNF' : '+2';
    }
    if (timer.state === 'armed') return precision === 'ms' ? '0.000' : '0.00';
    // "Hide time while running" — replaces the live ticking digits with a
    // static placeholder so the user can't peek at the clock mid-solve.
    // Applied above the ganConnected branch so BT-driven displays are
    // also masked. Stopped/inspecting/armed are unaffected: the final
    // result, inspection countdown, and arm prompt all stay visible.
    if (timer.state === 'running' && hideTimeWhileRunning) {
      return 'Solving...';
    }
    if (timer.state === 'stopped' && lastSolve) {
      if (lastSolve.penalty === 'dnf') return 'DNF';
      if (lastSolve.penalty === '+2') return `${fmtMs(lastSolve.ms + 2000, false, precision)}+`;
    }
    // When the GAN timer is the source of truth, show its independent
    // counter so the display keeps ticking even if the rAF loop didn't.
    if (ganConnected) return fmtMs(ganDisplayMs, false, precision);
    return fmtMs(timer.displayMs, false, precision);
  })();

  // Color of the big timer. Red → green progression while arming gives
  // the user a clear "not yet / now" cue; white during running keeps the
  // counting digits readable; a 300ms green pulse on stop confirms the
  // commit (PB stays green afterwards via lastSolveIsPB).
  const timerColor = (() => {
    if (timer.state === 'inspecting') {
      const s = timer.inspectionMs / 1000;
      if (s <= -2) return C.danger;
      if (s <= 0)  return C.danger;
      if (s <= 3)  return C.orange;
      if (s <= 7)  return C.warn;
      return C.text;
    }
    if (timer.state === 'armed') {
      return timer.armedReady ? C.success : C.danger;
    }
    // BT live-state cue: only fires when the device is the input source.
    // 'handsOn' (pads just pressed, GAN) → red, 'getSet' (held long
    // enough on either GAN or QiYi) → green. 'running' falls through to
    // the default white. We deliberately ignore QiYi 'inspection' here
    // — the local timer state machine owns the inspection color path.
    if (ganConnected) {
      if (gan.liveState === 'handsOn') return C.danger;
      if (gan.liveState === 'getSet')  return C.success;
    }
    if (timer.state === 'stopped') {
      // Highlight DNF in red so the post-solve display reads as a
      // failed solve, not a regular result that happens to say "DNF".
      if (lastSolve?.penalty === 'dnf') return C.danger;
      if (timer.stopFlashing) return C.success;
      if (lastSolveIsPB) return C.success;
    }
    return C.text;
  })();

  // ── Render ───────────────────────────────────────────────────────────────
  // Focus mode: fade the surrounding chrome (sidebars, scramble, stats,
  // nav, BT indicator, Ao5 projection) for the entire inspection →
  // armed → running cycle so the UI never flashes back into view as
  // the user holds to arm. The 'armed' state in particular is brief
  // but visually disruptive without this — leaving it out caused the
  // chrome to pop in for a split second between countdown and the
  // running timer.
  const focusMode =
    timer.state === 'inspecting' ||
    timer.state === 'armed' ||
    timer.state === 'running';

  // Focus-mode centring: while timing, the digits (with the "Inspection"
  // label riding along) are translated so their centre sits exactly on
  // the viewport centre. A transform never affects layout, so nothing
  // jumps, and it animates via the wrapper's transition. The base
  // (untransformed) position is the measured rect minus the transform
  // currently applied — read from the computed style so a measurement
  // taken mid-animation still yields the right target. Re-measured
  // whenever the display text changes (font steps down for long times)
  // and on resize.
  const focusShiftRef = useRef<HTMLDivElement | null>(null);
  const focusDigitsRef = useRef<HTMLDivElement | null>(null);
  const [focusShift, setFocusShift] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [viewportTick, setViewportTick] = useState(0);
  useEffect(() => {
    const onResize = () => setViewportTick(t => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useLayoutEffect(() => {
    if (!focusMode) {
      setFocusShift(s => (s.x === 0 && s.y === 0 ? s : { x: 0, y: 0 }));
      return;
    }
    const wrap = focusShiftRef.current;
    const digits = focusDigitsRef.current;
    if (!wrap || !digits) return;
    const r = digits.getBoundingClientRect();
    const t = getComputedStyle(wrap).transform;
    const applied = new DOMMatrixReadOnly(t && t !== 'none' ? t : undefined);
    const x = window.innerWidth / 2 - (r.left + r.width / 2 - applied.m41);
    const y = window.innerHeight / 2 - (r.top + r.height / 2 - applied.m42);
    setFocusShift(s => (Math.abs(s.x - x) < 0.5 && Math.abs(s.y - y) < 0.5 ? s : { x, y }));
  }, [focusMode, timerDisplay, isMobile, viewportTick]);
  const focusShiftStyle: React.CSSProperties = {
    transform: `translate(${focusShift.x}px, ${focusShift.y}px)`,
    transition: 'transform 0.15s ease',
  };


  return (
    <div className={`timer-page ${focusMode ? 'focus-mode' : ''}`} style={{
      height: '100vh', overflow: 'hidden',
      background: THEMES[themeId].bgGradient ?? C.bg,
      color: C.text,
      display: 'flex',
      transition: 'background-color 0.25s ease, color 0.25s ease',
    }}>
      {/* Storage error banner */}
      {saveError && (
        <div style={{
          position: 'fixed', top: 8, left: 8, right: 8,
          background: 'rgba(245,158,11,0.92)', color: '#1a1300',
          padding: '0.5rem 0.75rem', borderRadius: 8,
          fontSize: '0.75rem', fontFamily: '"JetBrains Mono", monospace',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          <span style={{ flex: 1, textAlign: 'center' }}>Хадгалах алдаа: {saveError}</span>
          <button
            onClick={() => setSaveError(null)}
            style={{
              background: 'none', border: 'none', color: '#1a1300',
              fontSize: '1rem', lineHeight: 1, cursor: 'pointer',
              padding: '0 0.25rem', flexShrink: 0,
            }}
            aria-label="Close"
          >✕</button>
        </div>
      )}

      {/* Fullscreen tap-to-stop overlay. Mounted on `overlayActive`
          rather than `timer.state === 'running'` so it lingers ~300 ms
          past the stop, absorbing the lift-off / click events from the
          same touch that stopped the timer. Without this trailing
          window, the user's stop-tap used to fire a click on whatever
          sat behind the overlay — most often the mobile bottom-nav
          tab. Skipped when a Bluetooth smart timer drives the engine
          (the device controls start/stop via its own events) and in
          manual entry mode (there's no running state to stop there).
          z-index 9998 sits above the page content but is comfortably
          below the ModalShell stack so an open modal still receives
          taps. */}
      {overlayActive && !ganConnected && timeEntryMode !== 'manual' && (
        <div
          aria-label="Tap to stop timer"
          role="button"
          onTouchStart={e => {
            e.preventDefault();
            e.stopPropagation();
            // Only stop while the timer is actually running. During
            // the 300 ms post-stop window the overlay is inert — its
            // job there is purely to swallow the touchend/click from
            // the same gesture that stopped the timer a moment ago.
            if (timer.state !== 'running') return;
            // 50 ms guard against the SAME touch that started the run
            // (inspecting→armed→running) bubbling back in and stopping
            // the timer immediately at 0.0 s.
            if (Date.now() - runStartedAtRef.current < 50) return;
            timer.stop();
          }}
          onTouchEnd={e => {
            // Absorb the lift-off so it can't translate into a click on
            // an element underneath the overlay.
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDown={e => {
            e.preventDefault();
            e.stopPropagation();
            if (timer.state !== 'running') return;
            if (Date.now() - runStartedAtRef.current < 50) return;
            timer.stop();
          }}
          onClick={e => {
            // A click event still synthesises from touch on most
            // mobile browsers — absorb that too so the bottom nav
            // can't be activated by the stop tap.
            e.preventDefault();
            e.stopPropagation();
          }}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 9998,
            background: 'transparent',
            cursor: 'pointer',
            touchAction: 'manipulation',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
        />
      )}

      {mounted && !isMobile && (
      <div className="pv-grid" style={{
        position: 'relative', zIndex: 1,
        display: 'flex',
        gap: '1.25rem',
        padding: '0.85rem',
        width: '100%',
        height: '100%',
        maxWidth: '1600px', margin: '0 auto',
      }}>
        {/* ── LEFT SIDEBAR (Settings + Session History) ─────────────────── */}
        <aside className="pv-sidebar" style={{
          flex: '0 0 260px',
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: RADIUS,
          display: 'flex', flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {/* Top: Settings cog + profile avatar — exit lives in the
              Settings panel, solve count moved to the Performance panel
              on the right. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.9rem 1rem 0.7rem',
          }}>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
              style={{
                width: 36, height: 36, borderRadius: RADIUS,
                background: 'transparent', border: 'none',
                color: C.muted, cursor: 'pointer', fontSize: '1.05rem',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = C.cardAlt;
                e.currentTarget.style.color = C.text;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = C.muted;
              }}
            >⚙</button>
            {/* Race — matches the cog's 36×36 icon-only style. Icon-only
                because the sidebar is 260px wide and a labeled button
                would push the avatar off the row. Tooltip carries the
                action name. While racing is closed (TIMER_FEATURES) it
                renders dimmed with a small "Удахгүй" label and only
                toasts on click. */}
            {TIMER_FEATURES.racing ? (
              <button
                onClick={() => router.push('/timer/multiplayer')}
                aria-label="Multiplayer Racing"
                title="Multiplayer Racing"
                style={{
                  width: 36, height: 36, borderRadius: RADIUS,
                  background: 'transparent', border: 'none',
                  color: C.muted, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = C.cardAlt; e.currentTarget.style.color = C.text; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted; }}
              >
                <IconUsers size={18} />
              </button>
            ) : (
              <button
                onClick={() => showToast({ msg: COMING_SOON_TOAST })}
                aria-disabled="true"
                aria-label="Multiplayer Racing — Удахгүй"
                title="Multiplayer Racing — Удахгүй"
                style={{
                  height: 36, borderRadius: RADIUS, padding: '0 0.35rem',
                  background: 'transparent', border: 'none',
                  color: C.mutedDim, cursor: 'default',
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  fontFamily: 'inherit',
                }}
              >
                <IconUsers size={18} />
                <span style={{ fontSize: '0.62rem', fontWeight: 500 }}>Удахгүй</span>
              </button>
            )}
            <GanButton
              state={gan.state}
              onConnect={gan.connect}
              onDisconnect={gan.disconnect}
              size={36}
              iconSize={16}
            />
            <div style={{ marginLeft: 'auto' }}>
              <TimerProfileMenu size={32} redirectAfterLogin="/timer" align="right" />
            </div>
          </div>
          {/* Inset divider — sits clear of the sidebar's outer border so the
              header reads as its own slot rather than running edge-to-edge. */}
          <div style={{ height: 1, background: C.border, margin: '0 0.85rem 0.4rem' }} />

          {/* Session selector — clickable name with dropdown panel */}
          <div style={{ position: 'relative', padding: '0.4rem 0.7rem 0.5rem' }}>
            <button
              onClick={() => setSessionDropdownOpen(o => !o)}
              aria-expanded={sessionDropdownOpen}
              aria-haspopup="listbox"
              style={{
                width: '100%',
                // Fill only — it sits inside the sidebar panel, so no
                // second border.
                // Affordance is the hover/open shade — no chevron.
                background: sessionDropdownOpen ? C.border : C.cardAlt,
                border: 'none',
                borderRadius: RADIUS,
                padding: '0.55rem 0.7rem',
                display: 'grid', gridTemplateColumns: 'auto 1fr',
                alignItems: 'center', gap: '0.55rem',
                cursor: 'pointer', fontFamily: 'inherit',
                color: C.text, textAlign: 'left',
                transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = C.border; }}
              onMouseLeave={e => { if (!sessionDropdownOpen) e.currentTarget.style.background = C.cardAlt; }}
            >
              <span style={{
                color: sessionDropdownOpen ? C.text : C.muted,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 0.15s ease',
              }}>
                {/* Inline folder glyph — matches the IconBase look used elsewhere
                    in the file without pulling in a new icon component. */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              </span>
              <span style={{
                fontSize: '0.9rem', fontWeight: 600,
                color: C.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                transition: 'color 0.15s ease',
              }}>
                {currentSession?.name ?? 'Default'}
              </span>
            </button>

            {sessionDropdownOpen && (
              <SessionsPanel
                mode="sidebar"
                list={sessions[eventId]?.sessions ?? []}
                currentId={sessions[eventId]?.currentId}
                precision={precision}
                onSwitch={switchSession}
                onCreate={createSession}
                onRename={renameSession}
                onDelete={deleteSession}
                onClose={() => setSessionDropdownOpen(false)}
              />
            )}
          </div>

          {/* Solves list header — count + sort pill. Sits above the
              scroll container so the pill stays put while the list
              scrolls beneath. */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.4rem 0.7rem 0.5rem', gap: '0.5rem',
          }}>
            <span style={{
              fontSize: '0.78rem',
              color: C.muted, fontWeight: 600,
            }}>
              Эвлүүлэлт ({solves.length})
            </span>
            {solves.length > 1 && (
              <SortPicker sortMode={sortMode} onChange={setSortMode} />
            )}
          </div>

          {/* Scrollable solve list */}
          <div className="pv-solves-list" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 0.5rem 0.5rem' }}>
            {solves.length === 0 ? (
              <div style={{ padding: '1.5rem 0.5rem', textAlign: 'center', color: C.mutedDim, fontSize: '0.78rem' }}>
                Press SPACE to start your first solve.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {sortedSolves.map((s, i) => {
                  // Chronological position from the unsorted `solves`
                  // array so the # badge means "first solve I ever
                  // made was #1" regardless of the current sort.
                  const idx = chronologicalIndexById.get(s.id) ?? 0;
                  const dnf = isDnf(s);
                  // PB detection still uses chronological order: a solve
                  // is a PB if it beat every valid solve that came
                  // BEFORE it, not every solve currently rendered above.
                  const priorSet = solves.slice(0, idx - 1).filter(x => !isDnf(x));
                  const priorBest = priorSet.length ? Math.min(...priorSet.map(finalMs)) : Infinity;
                  const isPB = !dnf && finalMs(s) < priorBest;
                  const hovered  = hoveredSolveId === s.id;
                  // One neutral row fill (no border — rows sit inside the
                  // sidebar panel); hover steps one shade lighter. PB is
                  // signalled by green time text + "PB" badge only.
                  const rowBg = hovered ? C.border : C.cardAlt;
                  return (
                    <div
                      key={s.id}
                      onMouseEnter={() => setHoveredSolveId(s.id)}
                      onMouseLeave={() => setHoveredSolveId(prev => prev === s.id ? null : prev)}
                      onClick={() => setDetailSolveId(s.id)}
                      style={{
                        position: 'relative',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0.5rem 0.7rem',
                        minHeight: 48,
                        borderRadius: RADIUS,
                        background: rowBg,
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      {/* Date pinned to the top-left corner via absolute
                          positioning so it never affects the centered
                          time group below. Empty for legacy solves
                          missing `ts` (no placeholder). */}
                      <span style={{
                        position: 'absolute', top: 6, left: 8,
                        fontSize: '0.65rem', fontWeight: 500,
                        color: C.mutedDim,
                        fontVariantNumeric: 'tabular-nums',
                        pointerEvents: 'none',
                      }}>{formatSolveDate(s.ts)}</span>

                      {/* Top-right corner stack — state badges (PB / +2
                          / DNF) on top, comment indicator below. Plain
                          colored text per badge type, no pill chrome.
                          Hidden during hover so the delete × can claim
                          the same corner without overlap. */}
                      {(isPB || s.penalty === '+2' || dnf || (s.comment && s.comment.trim())) && (
                        <div style={{
                          position: 'absolute', top: 6, right: 8,
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'flex-end', gap: 2,
                          fontSize: '0.65rem', fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          pointerEvents: 'none',
                          opacity: hovered ? 0 : 1,
                          transition: 'opacity 0.18s ease',
                        }}>
                          {(isPB || s.penalty === '+2' || dnf) && (
                            <div style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                            }}>
                              {isPB && !dnf && <span style={{ color: C.success }}>PB</span>}
                              {s.penalty === '+2' && !dnf && <span style={{ color: C.danger }}>+2</span>}
                              {dnf && <span style={{ color: C.danger }}>DNF</span>}
                            </div>
                          )}
                          {s.comment && s.comment.trim() && (
                            <span
                              aria-label="Has comment"
                              style={{ display: 'inline-flex', color: C.muted }}
                            >
                              <IconComment size={11} />
                            </span>
                          )}
                        </div>
                      )}

                      {/* Hover-revealed delete × pinned to the same
                          top-right slot. Inversely tied to the badge
                          opacity so badges and × never compete for the
                          corner — info on rest, action on hover. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSolve(s.id); }}
                        aria-label="Delete solve"
                        title="Delete"
                        style={{
                          position: 'absolute', top: 4, right: 6,
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: C.mutedDim, fontSize: '0.85rem',
                          padding: 0, lineHeight: 1,
                          opacity: hovered ? 1 : 0,
                          transition: 'opacity 0.18s ease, color 0.15s ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = C.text; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = C.mutedDim; }}
                      >×</button>

                      {/* Centered row — time only. With PB/+2 lifted
                          to the corner, a PB solve and a non-PB solve
                          render the time at the exact same horizontal
                          position. */}
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: '100%',
                      }}>
                        <span style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: '1.05rem', fontWeight: 700,
                          color: dnf ? C.danger : isPB ? C.success : C.text,
                          fontVariantNumeric: 'tabular-nums',
                          letterSpacing: '-0.005em',
                        }}>
                          {fmtMs(finalMs(s), dnf, precision)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </aside>

        {/* ── CENTER PANEL ─────────────────────────────────────────────── */}
        <main style={{
          flex: '1 1 auto', minWidth: 0,
          display: 'flex', flexDirection: 'column', gap: '1.25rem',
          height: '100%', overflow: 'hidden',
        }}>
          <section className="pv-scramble" style={{
              // Height = content (picker row + scramble); never squeezed —
              // the timer card below takes whatever space is left.
              flexShrink: 0,
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: RADIUS, padding: '1.25rem 1.5rem',
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            }}>
              {/* Picker row — event picker pill + "New Scramble" pill,
                  centered as a pair. The event picker carries the
                  EventPickerDropdown panel anchored to its wrapper.
                  No side reservation needed: the Race / BT strip now
                  lives in main's reserved header band above this
                  scramble box, not floating over it. */}
              <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                gap: '1rem', marginBottom: '0.85rem',
                flexWrap: 'wrap',
              }}>
                <div style={{ position: 'relative' }}>
                  <button
                    ref={eventPickerTriggerRef}
                    onClick={() => {
                      if (!desktopEventPickerOpen && eventPickerTriggerRef.current) {
                        setEventPickerTriggerRect(eventPickerTriggerRef.current.getBoundingClientRect());
                      }
                      setDesktopEventPickerOpen(o => !o);
                    }}
                    aria-haspopup="dialog"
                    aria-expanded={desktopEventPickerOpen}
                    aria-label="Pick event"
                    style={{
                      ...ghostButtonStyle(desktopEventPickerOpen),
                      gap: '0.5rem',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.border; }}
                    onMouseLeave={e => { if (!desktopEventPickerOpen) e.currentTarget.style.background = C.cardAlt; }}
                  >
                    <WcaEventIcon eventId={eventId} size={18} />
                    <span>{sessionEvent.name}</span>
                  </button>
                  {desktopEventPickerOpen && eventPickerTriggerRect && (
                    <EventPickerDropdown
                      currentEventId={eventId}
                      onSelect={setEventId}
                      onClose={() => setDesktopEventPickerOpen(false)}
                      triggerRect={eventPickerTriggerRect}
                    />
                  )}
                </div>
                <button
                  onClick={newScramble}
                  aria-label="New Scramble"
                  style={{ ...ghostButtonStyle(false), gap: '0.45rem' }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.border)}
                  onMouseLeave={e => (e.currentTarget.style.background = C.cardAlt)}
                >
                  <IconRefresh size={16} /> New Scramble
                </button>
              </div>

            <div
              className="pv-scramble-text"
              style={{
                fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
                fontSize: getDesktopScrambleFontSize(scrambleFontSize),
                fontWeight: 500, lineHeight: 1.7,
                letterSpacing: '0.02em', color: C.text,
                textAlign: 'center', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                // Card height = content. One line (1.7em = this line-height)
                // only so the card never collapses while the scramble is
                // momentarily empty on load.
                minHeight: '1.7em',
              }}
            >
              {scramble}
            </div>
          </section>

          {/* Main timer. Border + background are constant across every
              timer state — the only colour cue tied to arming lives on
              the digits themselves (red → green → white via timerColor).
              Earlier versions tinted the border/background and that
              read as "the whole panel flashes" on tablets, which was
              noisy. */}
          <section
            onTouchStart={onTimerTouchStart}
            onTouchEnd={onTimerTouchEnd}
            // Suppress the long-press / right-click context menu so
            // Android's Circle-to-Search and the desktop browser's
            // native menu can't pop up over a solve in progress. The
            // tap-to-arm flow is unaffected — context menu fires on
            // long-press / right-click only.
            onContextMenu={e => e.preventDefault()}
            className="pv-timer-card"
            style={{
              flex: '1 1 auto', minHeight: 0,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: RADIUS, padding: '1.5rem 1.5rem',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              touchAction: 'manipulation',
              cursor: 'pointer', textAlign: 'center',
              position: 'relative',
            }}
          >
            {connectedTimerName && (
              <div className="pv-bt-indicator" style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                fontSize: '0.72rem',
                color: C.muted, marginBottom: '0.5rem', fontWeight: 500,
              }}>
                <span style={{ color: C.success, display: 'inline-flex' }}><IconBluetooth size={12} /></span>
                {connectedTimerName} connected
              </div>
            )}
            {/* Label + digits shift to the viewport centre in focus mode. */}
            <div ref={focusShiftRef} style={focusShiftStyle}>
            {timer.state === 'inspecting' && (
              <div style={{ fontSize: '0.75rem', color: C.warn, marginBottom: '0.6rem', fontWeight: 600 }}>
                Inspection
              </div>
            )}
            {timeEntryMode === 'manual' ? (
              <ManualInlineInput
                value={manualInline}
                onChange={setManualInline}
                onCommit={commitManualInline}
                fontSize={getTimerFontSize(timerDisplay, false)}
                isMobile={false}
              />
            ) : (
              <>
                {ao5Projection && (timer.state === 'idle' || timer.state === 'stopped') && (
                  <div className="pv-ao5-inline" style={{
                    display: 'flex', gap: '1.5rem', justifyContent: 'center',
                    marginBottom: '0.4rem', pointerEvents: 'none',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '1.15rem', fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums', lineHeight: 1,
                  }}>
                    <span style={{ color: C.success }}>{fmtMs(ao5Projection.best, false, precision)}</span>
                    <span style={{ color: C.danger }}>{fmtMs(ao5Projection.worst, false, precision)}</span>
                  </div>
                )}
                <div ref={focusDigitsRef} className="pv-timer-digits" style={{
                  fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
                  fontSize: getTimerFontSize(timerDisplay, false),
                  fontWeight: 700, lineHeight: 0.95,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.01em',
                  color: timerColor,
                  transition: `color ${timer.state === 'stopped' ? 0.3 : 0.12}s, font-size 0.12s`,
                }}>
                  {timerDisplay}
                </div>
              </>
            )}
            </div>
            {/* Action row visibility is now opacity-driven so the fade
                between 'stopped' (visible) and 'armed' / 'inspecting'
                / 'running' (hidden) is smooth. The wrapper stays
                mounted as long as `lastSolve` exists — so an
                accidental arm-and-release cycle doesn't unmount the
                inner SolveActionRow and re-trigger its entrance
                animation; instead the wrapper's opacity ramps from
                1 → 0 → 1 across the cycle. visibility:hidden also
                blocks pointer events on the way out without affecting
                layout, so the timer digits don't jump as the row
                appears or hides.

                Keying the inner row on `lastSolve.id` means a NEW
                solve replaces the old one with a fresh mount → the
                pv-actionrow-fade entrance plays once per real solve,
                not on every armed/stopped flicker. */}
            {lastSolve && (() => {
              const showActionRow = timer.state === 'stopped' || timer.state === 'idle';
              return (
                <div
                  aria-hidden={!showActionRow}
                  style={{
                    opacity: showActionRow ? 1 : 0,
                    visibility: showActionRow ? 'visible' : 'hidden',
                    pointerEvents: showActionRow ? 'auto' : 'none',
                    transition: 'opacity 0.2s ease, visibility 0.2s ease',
                  }}
                >
                  {lastSolve.penalty === 'none' ? (
                    <SolveActionRow
                      key={lastSolve.id}
                      solve={lastSolve}
                      isMobile={isMobile}
                      disabled={false}
                      onDelete={() => setDeleteConfirmOpen(true)}
                      onSetPenalty={setPenaltyOnLast}
                      onOpenComment={() => setCommentSolveId(lastSolve.id)}
                    />
                  ) : (
                    <UndoActionRow
                      key={lastSolve.id}
                      isMobile={isMobile}
                      disabled={false}
                      onUndo={undoPenaltyOnLast}
                    />
                  )}
                </div>
              );
            })()}
            <div className="pv-instruction" style={{ fontSize: '0.72rem', fontWeight: 400, color: C.muted, marginTop: '1.25rem', minHeight: '1.1rem' }}>
              {ganConnected && timer.state !== 'running' && timer.state !== 'inspecting' && timer.state !== 'armed' && 'Use the GAN timer pads'}
              {timer.state === 'inspecting' && 'Hold SPACE to arm, release to start'}
              {timer.state === 'armed' && !timer.armedReady && (
                <span style={{ color: C.danger, fontWeight: 600 }}>Hold…</span>
              )}
              {timer.state === 'armed' && timer.armedReady && (
                <span style={{ color: C.success, fontWeight: 600 }}>Release to start</span>
              )}
              {!ganConnected && timer.state === 'running' && 'Press SPACE / tap to stop'}
            </div>

          </section>

        </main>

        {/* ── RIGHT PANEL ───────────────────────────────────────────────── */}
        <aside className="pv-right-panel" style={{
          flex: '0 0 280px', minWidth: 0,
          display: 'flex', flexDirection: 'column', gap: '0.75rem',
          height: '100%', overflow: 'hidden',
        }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '-0.25rem' }}>Performance</div>

          {(() => {
            // Trend comparison: each rolling average vs. its value one window
            // ago. Lower = faster = "improving" (down-arrow, green).
            const prevAo5  = avgOfN(solves.slice(0, -5), 5);
            const prevAo12 = avgOfN(solves.slice(0, -12), 12);
            // Same calculation as the mobile stats column's Ao100.
            const ao100Desktop = avgOfN(solves, 100);
            const validNow = solves.filter(s => !isDnf(s));
            const validCnt = validNow.length;
            const worstMs  = validCnt ? Math.max(...validNow.map(finalMs)) : null;
            const gapFromMean = stats.pbMs != null && stats.mean != null
              ? (stats.mean - stats.pbMs) / 1000
              : null;
            return (
              <>
                {/* PB card — plain surface, large green time */}
                <DesktopPbCard
                  pbMs={stats.pbMs}
                  gapFromMean={gapFromMean}
                  precision={precision}
                />

                {/* 2x2 stats in ONE surface: Ao5 | Ao12 / Mean | Ao100.
                    The 1px grid gap over a border-coloured background
                    draws the dividers between cells. */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1,
                  background: C.border, border: `1px solid ${C.border}`,
                  borderRadius: RADIUS, overflow: 'hidden',
                }}>
                  <DesktopStatCard
                    label="Ao5"
                    value={stats.ao5  == null ? '—' : fmtMs(stats.ao5,  false, precision)}
                    trend={trendDir(stats.ao5,  prevAo5)}
                  />
                  <DesktopStatCard
                    label="Ao12"
                    value={stats.ao12 == null ? '—' : fmtMs(stats.ao12, false, precision)}
                    trend={trendDir(stats.ao12, prevAo12)}
                  />
                  <DesktopStatCard
                    label="Mean"
                    value={fmtMs(stats.mean, false, precision)}
                  />
                  <DesktopStatCard
                    label="Ao100"
                    value={ao100Desktop == null ? '—' : fmtMs(ao100Desktop, false, precision)}
                  />
                </div>

                {/* Session chart — last 20 solves (DNFs skipped), no axes */}
                <div style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: RADIUS, overflow: 'hidden',
                }}>
                  <SmoothChart
                    values={solves.slice(-20).map(s => isDnf(s) ? null : finalMs(s))}
                    height={88}
                    c={C}
                  />
                </div>

                {/* Session info: count + best/worst on a compact row */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  fontSize: '0.7rem', color: C.muted,
                  padding: '0 0.1rem',
                }}>
                  <span>
                    <span style={{ color: C.text, fontWeight: 700 }}>{validCnt}</span>
                    {' '}solve{validCnt === 1 ? '' : 's'} this session
                  </span>
                  <span style={{ display: 'inline-flex', gap: '0.6rem', fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums' }}>
                    <span><span style={{ color: C.mutedDim }}>best</span>{' '}<span style={{ color: C.success }}>{fmtMs(stats.pbMs, false, precision)}</span></span>
                    <span><span style={{ color: C.mutedDim }}>worst</span>{' '}<span style={{ color: C.text }}>{worstMs == null ? '—' : fmtMs(worstMs, false, precision)}</span></span>
                  </span>
                </div>
              </>
            );
          })()}

          {/* Tools panel — pinned to the bottom of the right panel.
              "Холилтын зураг" (scramble preview, default) | "Ижил холилт"
              (shared scramble code). marginTop: auto pushes it past the
              stat cards; aspect-ratio keeps it square between the
              180–280px size bounds. */}
          <div className="pv-tools-panel" style={{
            marginTop: 'auto',
            width: '100%',
            maxWidth: 280,
            aspectRatio: '1 / 1',
            minHeight: 180,
            maxHeight: 280,
            alignSelf: 'center',
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: RADIUS, padding: '0.5rem',
            display: 'flex', flexDirection: 'column',
            flexShrink: 0,
          }}>
            <div style={{ paddingBottom: '0.35rem' }}>
              <ToolsViewMenu value={toolsTab} onChange={setToolsTab} sharedActive={!!sharedCode} />
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              {toolsTab === 'preview' ? (
                <ScramblePreview eventId={eventId} scramble={scramble} />
              ) : (
                <SharedCodeTools
                  code={sharedCode}
                  index={sharedIndex}
                  onEnter={enterSharedMode}
                  onLeave={leaveSharedMode}
                  onStep={stepShared}
                  onJump={setSharedIndexTo}
                />
              )}
            </div>
          </div>

        </aside>
      </div>
      )}

      {/* Mobile root wrapper — gets the `timer-page` class so the layout-
          level lockdown CSS (no text selection, no long-press callout)
          applies on phones the same way it does for the desktop branch
          above. */}
      {mounted && isMobile && (() => {
        // The Solves tab honors the user's sort choice from PREFS_KEY;
        // search filtering is applied AFTER the sort so the matching
        // subset stays in their chosen order.
        const q = mobileSearch.trim().toLowerCase();
        const solvesFiltered = !q ? sortedSolves : sortedSolves.filter(s => {
          const time = fmtMs(finalMs(s), isDnf(s), precision).toLowerCase();
          const date = new Date(s.ts).toLocaleString().toLowerCase();
          return time.includes(q) || date.includes(q) || s.scramble.toLowerCase().includes(q);
        });

        // Identify the best solve id for grid styling (PB text + badge)
        const validSolves = solves.filter(s => !isDnf(s));
        const bestId = validSolves.length
          ? validSolves.reduce((a, b) => finalMs(a) <= finalMs(b) ? a : b).id : null;

        // Extra averages for the Stats tab
        const ao50 = avgOfN(solves, 50);
        const ao100 = avgOfN(solves, 100);
        // Total solve count includes DNFs — a DNF is still a completed
        // attempt under WCA rules; only the time itself is invalidated.
        const totalCount = solves.length;

        // Chart series for Stats tab
        const chartSolves = solves;
        const chartSeries = (() => {
          const all: (number | null)[] = [];
          const best: (number | null)[] = [];
          const ao5s: (number | null)[] = [];
          const ao12s: (number | null)[] = [];
          const pbIndices: number[] = [];
          let runningBest: number | null = null;
          chartSolves.forEach((s, i) => {
            if (isDnf(s)) {
              all.push(null);
            } else {
              const v = finalMs(s);
              all.push(v);
              if (runningBest == null || v < runningBest) {
                runningBest = v;
                pbIndices.push(i);
              }
            }
            best.push(runningBest);
            ao5s.push(avgOfN(chartSolves.slice(0, i + 1), 5));
            ao12s.push(avgOfN(chartSolves.slice(0, i + 1), 12));
          });
          return { all, best, ao5s, ao12s, pbIndices };
        })();

        // Bottom-edge handling differs by platform: iOS draws a home
        // indicator inside the web viewport so we need to pad past it,
        // but Android puts the gesture/button bar OUTSIDE the viewport,
        // so adding env(safe-area-inset-bottom) there leaves a black
        // strip below the bottom nav. Detect once and apply selectively.
        const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

        // Shared mobile header — capsule (Settings, GAN, event picker,
        // session +, avatar) plus the scramble row. Lifted out of the
        // Timer-tab body so every tab sees the same header at the top
        // of the screen; tab switches only swap the body underneath.
        // Rendered once just above the tab-body branches below.
        const sharedMobileHeader = (
          <>
            <div className="pv-mobile-header" style={{
              flexShrink: 0,
              margin: '0.7rem 0.7rem 0.5rem',
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: RADIUS, padding: '0.45rem 0.55rem',
              display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: '0.45rem',
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
              position: 'relative', zIndex: 10,
            }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <button
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Settings"
                  style={{
                    width: 36, height: 36, borderRadius: RADIUS,
                    background: 'transparent', border: 'none',
                    color: C.muted, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                ><IconSettings size={20} /></button>
                <GanButton
                  state={gan.state}
                  onConnect={gan.connect}
                  onDisconnect={gan.disconnect}
                  size={36}
                  iconSize={18}
                />
              </div>
              {/* Middle column hosts the event picker + session
                  subtitle. The picker is irrelevant on Tools (it's a
                  utility tab — no event/session context drives the
                  content), so we hide its contents while keeping the
                  grid column allocated so the avatar / + cluster on
                  the right stays pinned at column 3. */}
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                {mobileTab !== 'tools' && (
                  <>
                    <button
                      onClick={() => setEventPickerOpen(true)}
                      aria-label="Төрөл сонгох"
                      style={{
                        width: '100%', appearance: 'none',
                        background: 'transparent', color: C.text,
                        border: 'none', borderRadius: 999,
                        padding: '0.15rem 0.7rem 0 0.7rem',
                        fontSize: '0.92rem', fontWeight: 600, fontFamily: 'inherit',
                        cursor: 'pointer', textAlign: 'center',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        gap: '0.45rem',
                      }}
                    >
                      <WcaEventIcon eventId={eventId} size={18} />
                      <span>{sessionEvent.name}</span>
                    </button>
                    <div
                      title={currentSession?.name ?? 'Default'}
                      style={{
                        fontSize: '0.65rem', color: C.muted,
                        fontWeight: 500,
                        lineHeight: 1, paddingBottom: '0.2rem',
                        maxWidth: '140px', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {currentSession?.name ?? 'Default'}
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <button
                  onClick={() => { setNewSessionName(''); setSessionPanelOpen(true); }}
                  aria-label="Шинэ session"
                  title="Шинэ session"
                  style={{
                    width: 36, height: 36, borderRadius: RADIUS,
                    background: 'transparent', border: 'none',
                    color: C.muted, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.cardAlt; e.currentTarget.style.color = C.text; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted; }}
                ><IconPlus size={18} /></button>
                <TimerProfileMenu
                  size={36}
                  redirectAfterLogin="/timer"
                  align="right"
                />
              </div>
            </div>

            {/* Scramble row only appears on the Timer tab. On Solves
                / Stats / Tools the long move sequence eats vertical
                space without serving the tab's purpose — the event
                picker in the capsule above is enough context. */}
            {mobileTab === 'timer' && (
              <div className="pv-scramble" style={{ flexShrink: 0 }}>
                <SwipeScrambleRow
                  scramble={scramble}
                  scrambleFontPx={getScrambleFontSize(scramble, scrambleFontSize)}
                  onNext={goNextScramble}
                  onPrev={goPrevScramble}
                />
              </div>
            )}
          </>
        );

        return (
          <div className="timer-page" style={{
            position: 'relative', zIndex: 1,
            // Root is exactly the viewport, with a flex-column children
            // arrangement so the footer (stats + nav) sits in normal flow
            // below a scrollable main content area — no fixed positioning,
            // no padding hacks, no z-index stacking. The top safe-area
            // inset keeps content clear of the iOS notch when running
            // standalone with viewport-fit: cover. dvh tracks the visible
            // viewport on iOS so the URL-bar dynamics don't expose a strip
            // of empty space below the bottom nav. maxHeight pins the
            // ceiling so a momentary content overflow can't push the
            // root past the visible viewport on Android either.
            height: '100dvh',
            maxHeight: '100dvh',
            width: '100%',
            display: 'flex', flexDirection: 'column',
            background: C.bg, color: C.text,
            overflow: 'hidden',
            paddingTop: 'env(safe-area-inset-top)',
          }}>
            {/* Page-scoped global lock. Setting overflow:hidden on
                <html>/<body> here (rather than in globals.css) keeps the
                rule from leaking out to the rest of the site, which
                relies on normal document scrolling. overscroll-behavior
                kills the rubber-band scroll some Android browsers do at
                the top/bottom of the document even with overflow:hidden. */}
            <style>{`
              html, body {
                height: 100%;
                overscroll-behavior: none;
                overflow: hidden;
              }
            `}</style>
            {/* ── MAIN: tab content area, locked to the viewport.
                Each tab manages its own internal scroll where needed
                (e.g. the solves list). At the page level there is no
                scrolling — the screen is fully locked to 100dvh and the
                bottom nav stays in flex flow with flexShrink: 0. */}
            <main style={{
              flex: 1, minHeight: 0,
              overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
            {sharedMobileHeader}
            {/* ── TIMER TAB ─────────────────────────────────────────────── */}
            {mobileTab === 'timer' && (
              <div style={{
                flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column',
              }}>
                {/* Big timer area. Background stays transparent across
                    every state — only the digit colour swaps red→green→
                    white during arming, since the background flash was
                    visually noisy on tablets where the timer area takes
                    a large share of the viewport. */}
                <section
                  ref={mobileTimerRef}
                  onTouchStart={onTimerTouchStart}
                  onTouchEnd={onTimerTouchEnd}
                  // Same long-press / context-menu suppression as the
                  // desktop section above. Critical on Android, where
                  // a hold-tap during inspection would otherwise pop up
                  // Circle-to-Search and steal focus from the solve.
                  onContextMenu={e => e.preventDefault()}
                  className="pv-timer-card"
                  style={{
                    flex: '1 1 auto', minHeight: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', textAlign: 'center',
                    touchAction: 'manipulation',
                    margin: '0 0.7rem',
                    background: 'transparent',
                    position: 'relative',
                  }}
                >
                  {connectedTimerName && (
                    <div className="pv-bt-indicator" style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                      fontSize: '0.72rem',
                      color: C.muted, marginBottom: '0.5rem', fontWeight: 500,
                    }}>
                      <span style={{ color: C.success, display: 'inline-flex' }}><IconBluetooth size={12} /></span>
                      {connectedTimerName} connected
                    </div>
                  )}
                  {/* Label + digits shift to the viewport centre in focus mode. */}
                  <div ref={focusShiftRef} style={focusShiftStyle}>
                  {timer.state === 'inspecting' && (
                    <div style={{ fontSize: '0.75rem', color: C.warn, marginBottom: '0.6rem', fontWeight: 600 }}>
                      Inspection
                    </div>
                  )}
                  {timeEntryMode === 'manual' ? (
                    <ManualInlineInput
                      value={manualInline}
                      onChange={setManualInline}
                      onCommit={commitManualInline}
                      fontSize={getTimerFontSize(timerDisplay, true)}
                      isMobile
                    />
                  ) : (
                    <>
                      {ao5Projection && (timer.state === 'idle' || timer.state === 'stopped') && (
                        <div className="pv-ao5-inline" style={{
                          display: 'flex', gap: '1.5rem', justifyContent: 'center',
                          marginBottom: '0.4rem', pointerEvents: 'none',
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: '1.15rem', fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
                        }}>
                          <span style={{ color: C.success }}>{fmtMs(ao5Projection.best, false, precision)}</span>
                          <span style={{ color: C.danger }}>{fmtMs(ao5Projection.worst, false, precision)}</span>
                        </div>
                      )}
                      <div ref={focusDigitsRef} className="pv-timer-digits" style={{
                        fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
                        fontSize: getTimerFontSize(timerDisplay, true),
                        fontWeight: 700, lineHeight: 0.95,
                        fontVariantNumeric: 'tabular-nums',
                        color: timerColor,
                        transition: `color ${timer.state === 'stopped' ? 0.3 : 0.12}s, font-size 0.12s`,
                      }}>
                        {timerDisplay}
                      </div>
                    </>
                  )}
                  </div>
                  {/* Same opacity/visibility wrapper as the desktop
                      branch — see the comment there for the rationale. */}
                  {lastSolve && (() => {
                    const showActionRow = timer.state === 'stopped' || timer.state === 'idle';
                    return (
                      <div
                        aria-hidden={!showActionRow}
                        style={{
                          opacity: showActionRow ? 1 : 0,
                          visibility: showActionRow ? 'visible' : 'hidden',
                          pointerEvents: showActionRow ? 'auto' : 'none',
                          transition: 'opacity 0.2s ease, visibility 0.2s ease',
                        }}
                      >
                        {lastSolve.penalty === 'none' ? (
                          <SolveActionRow
                            key={lastSolve.id}
                            solve={lastSolve}
                            isMobile={isMobile}
                            disabled={false}
                            onDelete={() => setDeleteConfirmOpen(true)}
                            onSetPenalty={setPenaltyOnLast}
                            onOpenComment={() => setCommentSolveId(lastSolve.id)}
                          />
                        ) : (
                          <UndoActionRow
                            key={lastSolve.id}
                            isMobile={isMobile}
                            disabled={false}
                            onUndo={undoPenaltyOnLast}
                          />
                        )}
                      </div>
                    );
                  })()}
                  <div className="pv-instruction" style={{ fontSize: '0.7rem', color: C.muted, marginTop: '0.7rem', minHeight: '1rem' }}>
                    {ganConnected && timer.state !== 'running' && timer.state !== 'inspecting' && timer.state !== 'armed' && 'Use the GAN timer pads'}
                    {timer.state === 'inspecting' && 'Hold to arm, release to start'}
                    {timer.state === 'armed' && !timer.armedReady && (
                      <span style={{ color: C.danger, fontWeight: 600 }}>Hold…</span>
                    )}
                    {timer.state === 'armed' && timer.armedReady && (
                      <span style={{ color: C.success, fontWeight: 600 }}>Release to start</span>
                    )}
                    {!ganConnected && timer.state === 'running' && 'Tap to stop'}
                  </div>
                </section>
              </div>
            )}

            {/* ── SOLVES TAB ────────────────────────────────────────────── */}
            {mobileTab === 'solves' && (
              <div style={{
                flex: '1 1 auto', minHeight: 0,
                display: 'flex', flexDirection: 'column',
              }}>
                {/* The shared mobile header above already shows event /
                    session / scramble, so the Solves body skips its own
                    title row and goes straight to a search + ⋮ menu
                    line. Select mode replaces this row with the bulk
                    action bar. */}
                {selectMode ? (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr auto auto',
                    alignItems: 'center', gap: '0.4rem',
                    padding: '0.5rem 0.7rem 0.4rem',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <button
                      onClick={exitSelectMode}
                      aria-label="Cancel select"
                      style={{
                        width: 34, height: 34, borderRadius: RADIUS_SM,
                        background: 'transparent', border: 'none',
                        color: C.text, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    ><IconClose size={16} /></button>
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: C.text }}>
                      {selectedSolveIds.size} selected
                    </div>
                    <button
                      onClick={() => selectAllVisible(solvesFiltered.map(x => x.id))}
                      style={{
                        padding: '0.4rem 0.7rem', borderRadius: RADIUS_SM,
                        fontSize: '0.74rem', fontWeight: 500, fontFamily: 'inherit',
                        background: C.cardAlt, color: C.text,
                        border: 'none', cursor: 'pointer',
                      }}
                    >Select all</button>
                    <button
                      onClick={confirmDeleteSelected}
                      disabled={selectedSolveIds.size === 0}
                      aria-label="Delete selected"
                      style={{
                        padding: '0.4rem 0.6rem', borderRadius: RADIUS_SM,
                        fontSize: '0.74rem', fontWeight: 500, fontFamily: 'inherit',
                        background: C.cardAlt,
                        color: C.danger,
                        opacity: selectedSolveIds.size === 0 ? 0.45 : 1,
                        border: 'none',
                        cursor: selectedSolveIds.size === 0 ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      }}
                    ><IconTrash size={14} />Delete</button>
                  </div>
                ) : (
                  /* Search bar with the ⋮ menu pinned to its right edge
                     as a trailing accessory. Sort options live inside
                     that menu so the search row stays the only chrome
                     above the grid. */
                  <div style={{ padding: '0.5rem 0.85rem 0.6rem' }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                      gap: '0.4rem', alignItems: 'center',
                      background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: RADIUS, padding: '0.25rem 0.45rem 0.25rem 0.85rem',
                    }}>
                      <span style={{ color: C.muted, display: 'inline-flex' }}><IconSearch size={16} /></span>
                      <input
                        value={mobileSearch}
                        onChange={e => setMobileSearch(e.target.value)}
                        placeholder="Search solves..."
                        style={{
                          background: 'transparent', border: 'none', outline: 'none',
                          color: C.text, fontFamily: 'inherit', fontSize: '16px',
                          width: '100%',
                        }}
                      />
                      <SortPicker sortMode={sortMode} onChange={setSortMode} />
                    </div>
                  </div>
                )}

                {/* Solves grid (3 columns) */}
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 0.85rem 1rem' }}>
                  {solvesFiltered.length === 0 ? (
                    <div style={{
                      fontSize: '0.85rem', color: C.mutedDim, textAlign: 'center',
                      padding: '2rem 0',
                    }}>
                      {q ? 'No solves match your search.' : 'Tap the Timer tab to start your first solve.'}
                    </div>
                  ) : (
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '0.5rem',
                    }}>
                      {solvesFiltered.map((s, idx) => {
                        const dnf = isDnf(s);
                        const isBest  = !dnf && s.id === bestId  && validSolves.length > 1;
                        const selected = selectedSolveIds.has(s.id);
                        const hasComment = !!(s.comment && s.comment.trim());

                        // Every card is the same plain surface; only the
                        // selected state changes the frame. PB / DNF / +2
                        // are signalled through text colour alone.
                        const cardBg = selected ? C.cardAlt : C.card;
                        const cardBorder = selected ? C.borderHi : C.border;

                        return (
                          <button
                            key={s.id}
                            onClick={() => handleSolveCardClick(s.id)}
                            onTouchStart={(e) => startSolveLongPress(s.id, e)}
                            onTouchMove={moveSolveLongPress}
                            onTouchEnd={endSolveLongPress}
                            onTouchCancel={endSolveLongPress}
                            style={{
                              position: 'relative',
                              textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                              background: cardBg,
                              border: `1px solid ${cardBorder}`,
                              borderRadius: RADIUS,
                              padding: '0.35rem 0.5rem 0.45rem',
                              display: 'flex', flexDirection: 'column', alignItems: 'stretch',
                              gap: '0.15rem',
                              minWidth: 0,
                              // Makes the card a size container so the time
                              // below can scale with the card's width (cqw).
                              containerType: 'inline-size',
                              transition: 'transform 0.12s, border-color 0.12s, background 0.12s',
                            }}
                          >
                            {/* Header line, in normal flow so it can never
                                sit on top of the time: date on the left,
                                state badges (PB / +2 / DNF), comment icon,
                                or the select checkbox on the right. Fixed
                                height keeps every card's time on the same
                                baseline whether or not badges are present.
                                Date is empty for legacy solves without `ts`. */}
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              gap: '0.25rem', height: 16, minWidth: 0,
                              fontSize: '0.62rem',
                              fontVariantNumeric: 'tabular-nums',
                              pointerEvents: 'none',
                            }}>
                              <span style={{
                                fontWeight: 500, color: C.mutedDim,
                                whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0,
                              }}>{formatSolveDate(s.ts)}</span>

                              {selectMode ? (
                                <span style={{
                                  flexShrink: 0,
                                  width: 16, height: 16, borderRadius: 999,
                                  background: selected ? C.text : 'transparent',
                                  border: `1px solid ${selected ? C.text : C.borderHi}`,
                                  color: selected ? C.bg : 'transparent',
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  {selected && <IconCheck size={11} />}
                                </span>
                              ) : (isBest || s.penalty === '+2' || dnf || hasComment) && (
                                <span style={{
                                  flexShrink: 0,
                                  display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                  fontWeight: 600,
                                }}>
                                  {isBest && !dnf && <span style={{ color: C.success }}>PB</span>}
                                  {s.penalty === '+2' && !dnf && <span style={{ color: C.danger }}>+2</span>}
                                  {dnf && <span style={{ color: C.danger }}>DNF</span>}
                                  {hasComment && (
                                    <span aria-label="Has comment" style={{
                                      display: 'inline-flex', color: C.muted,
                                    }}>
                                      <IconComment size={11} />
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>

                            {/* Time line. Font scales with the card's
                                content width (19cqw ≈ 8 monospace chars,
                                e.g. "1:03.604"), clamped so it never gets
                                tiny or oversized. */}
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              width: '100%', minWidth: 0,
                            }}>
                              <span style={{
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: 'clamp(0.72rem, 19cqw, 1.15rem)', fontWeight: 700,
                                whiteSpace: 'nowrap',
                                color: dnf ? C.danger
                                     : isBest ? C.success
                                     : C.text,
                                fontVariantNumeric: 'tabular-nums',
                                lineHeight: 1.1,
                              }}>
                                {fmtMs(finalMs(s), dnf, precision)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── STATS TAB ─────────────────────────────────────────────── */}
            {mobileTab === 'stats' && (
              <div style={{
                flex: '1 1 auto', minHeight: 0,
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Header — title only. The old × close button used to
                    router.push('/'), which sent users back to the
                    marketing homepage; the bottom nav already covers
                    tab switching, so nothing else needs to live here. */}
                <div style={{
                  display: 'flex', alignItems: 'center',
                  padding: '0.7rem 0.85rem 0.4rem',
                }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }}>Stats</div>
                </div>

                {/* Chart card — fixed 160px plot height, fills the width,
                    last 50 solves only */}
                <div style={{ padding: '0 0.7rem 0.5rem', flex: '0 0 auto' }}>
                  <div style={{
                    background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: RADIUS, padding: '0.6rem',
                    display: 'flex', flexDirection: 'column', gap: '0.4rem',
                  }}>
                    <SmoothChart
                      values={chartSeries.all.slice(-50)}
                      trends={[
                        { values: chartSeries.ao5s.slice(-50) },
                        { values: chartSeries.ao12s.slice(-50), dashed: true },
                      ]}
                      height={160}
                      axis
                      c={C}
                    />
                    <div style={{
                      display: 'flex', flexWrap: 'wrap', gap: '0.75rem',
                      fontSize: '0.68rem', color: C.muted,
                      paddingTop: '0.3rem', borderTop: `1px solid ${C.border}`,
                    }}>
                      <ChartLegendItem swatch="line" color={C.muted} label="Solves" />
                      <ChartLegendItem swatch="line" color={C.text} opacity={0.6} label="Ao5" />
                      <ChartLegendItem swatch="dashed" color={C.text} opacity={0.4} label="Ao12" />
                      <ChartLegendItem swatch="dot" color={C.success} label="Best" />
                    </div>
                  </div>
                </div>

                {/* 2x2 main stats grid */}
                <div style={{
                  padding: '0 0.7rem 0.5rem',
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem',
                }}>
                  <MobileStatCard label="Best" value={fmtMs(stats.best, false, precision)} accent={C.success} />
                  <MobileStatCard label="Mean" value={fmtMs(stats.mean, false, precision)} />
                  <MobileStatCard label="Ao5"  value={stats.ao5  == null ? '—' : fmtMs(stats.ao5,  false, precision)} />
                  <MobileStatCard label="Ao12" value={stats.ao12 == null ? '—' : fmtMs(stats.ao12, false, precision)} />
                </div>

                {/* Compact secondary row: Ao50 | Ao100 | Count | σ */}
                <div style={{
                  padding: '0 0.7rem 0.6rem',
                  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem',
                }}>
                  <MobileStatMini label="Ao50"  value={ao50  == null ? '—' : fmtMs(ao50,  false, precision)} />
                  <MobileStatMini label="Ao100" value={ao100 == null ? '—' : fmtMs(ao100, false, precision)} />
                  <MobileStatMini label="Count" value={String(totalCount)} />
                  <MobileStatMini label="σ"     value={stats.stdDev == null ? '—' : (stats.stdDev / 1000).toFixed(2)} />
                </div>
              </div>
            )}

            {/* ── COMMUNITY TAB (internal id: 'tools') ───────────────────── */}
            {mobileTab === 'tools' && (
              <ToolsTab
                onNavigate={(path) => router.push(path)}
                solveCount={totalCount}
                currentUserId={user?.uid}
              />
            )}

            </main>

            {/* ── FOOTER: stats bar (timer tab only) + bottom nav.
                Both live in normal flow at the column tail with flex-shrink: 0
                so they never get clipped or covered. */}
            <div style={{ flexShrink: 0 }}>
              {mobileTab === 'timer' && (() => {
                const last12 = solves.slice(-12).reverse();
                // Frameless columns that blend into the page. No fixed
                // aspect-ratio/height: the row is as tall as its tallest
                // in-flow column (cube square or stats list), so the stats
                // never clip. The last-solves list is absolutely positioned
                // so it fills that height and scrolls instead of growing it.
                return (
                  <div className="pv-mobile-stats" style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 6, padding: '0.25rem 0.75rem 0.4rem',
                  }}>
                    {/* Left column: last solves, scrollable */}
                    <div style={{ position: 'relative', minWidth: 0 }}>
                      <div className="pv-last12" style={{
                        position: 'absolute', inset: 0, overflowY: 'auto',
                        display: 'flex', flexDirection: 'column',
                        // Soft fade on the bottom edge so the row cut by the
                        // scroll boundary reads as "more below", not clipped.
                        maskImage: 'linear-gradient(to bottom, #000 calc(100% - 14px), transparent)',
                        WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 14px), transparent)',
                      }}>
                        {last12.length === 0 ? (
                          <div style={{
                            fontSize: '0.72rem', color: C.muted,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            height: '100%',
                          }}>—</div>
                        ) : last12.map((s, i) => {
                          const idx = solves.length - i;
                          const dnf = isDnf(s);
                          const timeStr = dnf ? 'DNF' : fmtMs(finalMs(s), false, precision) + (s.penalty === '+2' ? '+' : '');
                          return (
                            <div
                              key={s.id}
                              onClick={() => setDetailSolveId(s.id)}
                              style={{
                                display: 'flex', alignItems: 'baseline', gap: '0.25rem',
                                padding: '0.04rem 0',
                                cursor: 'pointer',
                              }}
                            >
                              <span style={{
                                fontSize: '0.58rem', color: C.muted,
                                fontVariantNumeric: 'tabular-nums',
                                minWidth: '1.2rem', textAlign: 'right',
                              }}>{idx}.</span>
                              <span style={{
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: '0.72rem', fontWeight: 600,
                                fontVariantNumeric: 'tabular-nums',
                                color: dnf ? C.danger : C.text, lineHeight: 1.3,
                              }}>{timeStr}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Center column: cube preview, centered */}
                    <button
                      onClick={() => setCubeFullscreenOpen(true)}
                      aria-label="Enlarge cube"
                      style={{
                        position: 'relative',
                        background: 'none', border: 'none', padding: 0, minWidth: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', fontFamily: 'inherit',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      {/* "Ижил холилт" is active — the only on-screen hint
                          now that there's no bar above the scramble. */}
                      {/* Top-right corner; top: 4 centres the 7px dot on
                          the row's first text line (≈15px tall), the same
                          top line the side columns start on. */}
                      {sharedCode && (
                        <span style={{ position: 'absolute', top: 4, right: 2, display: 'inline-flex' }}>
                          <SharedActiveDot />
                        </span>
                      )}
                      {/* Square-1's SVG viewBox is fit tightly to the drawing,
                          so it takes the full card; the 3D players keep 80%. */}
                      <div style={{ width: eventId === 'sq1' ? '100%' : '80%', aspectRatio: '1 / 1', display: 'flex' }}>
                        <ScramblePreview eventId={eventId} scramble={scramble} />
                      </div>
                    </button>

                    {/* Right column: stats, right-aligned. Top-anchored so
                        its first row shares the top line with the last-
                        solves list (left) and the cube card's dot (middle). */}
                    <div style={{
                      minWidth: 0,
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
                    }}>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto auto',
                        columnGap: '0.35rem', rowGap: '0.05rem',
                        justifyContent: 'end',
                      }}>
                        {([
                          ['Mean',  fmtMs(stats.mean, false, precision)],
                          ['Best',  fmtMs(stats.best, false, precision)],
                          ['Ao5',   fmtMs(stats.ao5,  false, precision)],
                          ['Ao12',  fmtMs(stats.ao12, false, precision)],
                          ['Ao100', fmtMs(ao100,      false, precision)],
                          ['Count', String(totalCount)],
                        ] as const).map(([label, val]) => (
                          <Fragment key={label}>
                            <span style={{
                              fontSize: '0.62rem', color: C.muted,
                              textAlign: 'right', lineHeight: 1.25,
                            }}>{label}:</span>
                            <span style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: '0.7rem', fontWeight: 600,
                              fontVariantNumeric: 'tabular-nums',
                              textAlign: 'right', lineHeight: 1.25,
                              color: val === '—' ? C.muted : C.text,
                            }}>{val}</span>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <nav className="pv-mobile-nav" style={{
                // iOS: 56 px of tab content plus the home-indicator inset
                // below it, so the buttons sit above the indicator and the
                // background color extends to the screen edge.
                // Android (and everywhere else): just 56 px — the gesture
                // bar lives outside the web viewport, and adding the inset
                // there would leave a black strip below the nav.
                height: isIOS ? 'calc(56px + env(safe-area-inset-bottom))' : '56px',
                paddingBottom: isIOS ? 'env(safe-area-inset-bottom)' : 0,
                boxSizing: 'border-box',
                flexShrink: 0,
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                background: C.card, borderTop: `1px solid ${C.border}`,
                backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
              }}>
                <BottomTab label="Timer"      icon={<IconStopwatch size={20} />} active={mobileTab === 'timer'}  onClick={() => setMobileTab('timer')} C={C} />
                <BottomTab label="Solves"     icon={<IconList size={20} />}      active={mobileTab === 'solves'} onClick={() => setMobileTab('solves')} C={C} />
                <BottomTab label="Stats"      icon={<IconChart size={20} />}     active={mobileTab === 'stats'}  onClick={() => setMobileTab('stats')} C={C} />
                <BottomTab label="Community"  icon={<IconUsers size={20} />}     active={mobileTab === 'tools'}  onClick={() => setMobileTab('tools')} C={C} />
              </nav>
            </div>

          </div>
        );
      })()}

      {/* Alt+D confirmation toast — shown for ~3s after the first press. */}
      {clearPending && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)',
            zIndex: 9700,
            background: C.card, border: `1px solid ${C.border}`,
            color: C.text,
            borderRadius: RADIUS,
            padding: '0.55rem 1rem',
            fontSize: '0.82rem', fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}
        >
          Clear session?
          <kbd style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.7rem', fontWeight: 600,
            padding: '0.15rem 0.45rem', borderRadius: RADIUS_SM,
            background: C.cardAlt, color: C.text,
            border: 'none',
          }}>Alt+D</kbd>
          <span style={{ color: C.muted }}>again to confirm</span>
        </div>
      )}

      {/* Cube fullscreen modal (mobile — tap on the cube preview) */}
      {cubeFullscreenOpen && (
        <div
          onClick={() => setCubeFullscreenOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9500,
            background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.5rem',
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setCubeFullscreenOpen(false); }}
            aria-label="Close"
            style={{
              position: 'absolute', top: '1rem', right: '1rem',
              width: 38, height: 38, borderRadius: RADIUS,
              background: C.cardAlt, border: 'none',
              color: C.text, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          ><IconClose size={18} /></button>
          {/* Enlarged preview doubles as the mobile tools sheet:
              "Холилтын зураг" (preview) | "Ижил холилт" (shared code),
              picked from the header menu. */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(86vw, 80vh, 480px)',
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: RADIUS, padding: '0.75rem',
              display: 'flex', flexDirection: 'column', gap: '0.6rem',
            }}
          >
            <ToolsViewMenu value={toolsTab} onChange={setToolsTab} sharedActive={!!sharedCode} />
            <div style={{ width: '100%', aspectRatio: '1 / 1', display: 'flex' }}>
              {toolsTab === 'preview' ? (
                <ScramblePreview eventId={eventId} scramble={scramble} />
              ) : (
                <SharedCodeTools
                  code={sharedCode}
                  index={sharedIndex}
                  onEnter={enterSharedMode}
                  onLeave={leaveSharedMode}
                  onStep={stepShared}
                  onJump={setSharedIndexTo}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sessions panel modal (mobile + button in header) */}
      {sessionPanelOpen && (
        <SessionsPanel
          mode="modal"
          list={sessions[eventId]?.sessions ?? []}
          currentId={sessions[eventId]?.currentId}
          precision={precision}
          onSwitch={switchSession}
          onCreate={createSession}
          onRename={renameSession}
          onDelete={deleteSession}
          onClose={() => setSessionPanelOpen(false)}
        />
      )}

      {/* Event picker — shared bottom sheet for both desktop and mobile.
          Mounts whenever any event-button (mobile capsule or the
          desktop centered pill above the scramble) sets
          eventPickerOpen=true. The native <select> previously used on
          desktop has been retired in favour of this single picker so
          the event identity reads from one source. */}
      {eventPickerOpen && (
        <EventPickerSheet
          currentEventId={eventId}
          onSelect={setEventId}
          onClose={() => setEventPickerOpen(false)}
        />
      )}

      {/* Settings: desktop sidebar modal + mobile bottom-sheet accordion */}
      {settingsOpen && (
        <SettingsPanel
          isMobile={isMobile}
          C={C}
          onClose={() => setSettingsOpen(false)}
          onExit={() => router.push('/')}
          section={settingsSection}
          setSection={setSettingsSection}
          mobileExpanded={mobileExpanded}
          toggleMobileSection={toggleMobileSection}
          // Timer
          inspectionEnabled={inspectionEnabled} setInspectionEnabled={setInspectionEnabled}
          holdToStart={holdToStart} setHoldToStart={setHoldToStart}
          holdTimeMs={holdTimeMs} setHoldTimeMs={setHoldTimeMs}
          hideTimeWhileRunning={hideTimeWhileRunning} setHideTimeWhileRunning={setHideTimeWhileRunning}
          showAo5Projection={showAo5Projection} setShowAo5Projection={setShowAo5Projection}
          precision={precision} setPrecision={setPrecision}
          timeEntryMode={timeEntryMode} setTimeEntryMode={setTimeEntryMode}
          // Bluetooth
          gan={gan}
          qiyiDebugMode={qiyiDebugMode}
          setQiyiDebugMode={setQiyiDebugMode}
          // Display
          scrambleFontSize={scrambleFontSize} setScrambleFontSize={setScrambleFontSize}
          themeId={themeId} setThemeId={setThemeId}
        />
      )}

      {/* QiYi DEBUG MODE overlay — last 10 raw BLE packets. Visible
          only when QiYi was the auto-detected brand AND the user has
          flipped the toggle in Settings → Bluetooth. Lets the user
          verify data is actually arriving from unfamiliar firmware
          (e.g. V2-3650). */}
      {gan.brand === 'qiyi' && qiyiDebugMode && (
        <QiyiDebugOverlay packets={gan.recentPackets} C={C} />
      )}

      {/* Solve detail modal — shows time, full scramble, and penalty editor */}
      {detailSolveId && (() => {
        const s = solves.find(x => x.id === detailSolveId);
        if (!s) return null;
        const dnf = isDnf(s);
        const hasComment = !!(s.comment && s.comment.trim());
        // Action-row buttons follow a single 5-up grid so OK/+2/DNF read
        // as the same kind of affordance as 💬 / share — equal sizing,
        // 0.4rem gap. Penalty buttons get tone tints when active.
        const penaltyOpts: { value: Penalty; label: string; color: string }[] = [
          { value: 'none', label: 'OK',  color: C.text   },
          { value: '+2',   label: '+2',  color: C.danger },
          { value: 'dnf',  label: 'DNF', color: C.danger },
        ];
        return (
          <ModalShell onClose={() => setDetailSolveId(null)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Time block — no microlabel above so the time itself is
                  the first prominent content. Reserves a tiny right
                  inset so the absolute close × in the header doesn't
                  visually crowd large multi-minute times. */}
              <div style={{ paddingRight: '2.25rem' }}>
                <div style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '2.5rem', fontWeight: 800,
                  color: dnf ? C.danger : C.text,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.1,
                }}>
                  {fmtMs(finalMs(s), dnf, precision)}
                </div>
                {s.penalty === '+2' && !dnf && (
                  <div style={{ fontSize: '0.75rem', color: C.warn, marginTop: '0.25rem' }}>+2 penalty applied</div>
                )}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  fontSize: '0.78rem', color: C.muted,
                  marginTop: '0.55rem',
                }}>
                  <IconClock />
                  <span>{formatSolveTime(s.ts)}</span>
                  {s.sharedCode && s.sharedIndex != null && (
                    <span
                      title="Ижил холилт код · scramble дугаар"
                      style={{
                        marginLeft: '0.25rem',
                        padding: '0.05rem 0.45rem', borderRadius: RADIUS_SM,
                        background: C.cardAlt, color: C.muted,
                        fontFamily: '"JetBrains Mono", monospace', fontSize: '0.72rem',
                      }}
                    >{s.sharedCode} #{s.sharedIndex}</span>
                  )}
                </div>
              </div>

              {/* Scramble — kept identifiable by its mono+box treatment;
                  no microlabel since the modal trimmed all section
                  headers per the redesign. */}
              <div style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '0.92rem', lineHeight: 1.6,
                color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: C.cardAlt,
                borderRadius: RADIUS_SM, padding: '0.75rem 0.85rem',
              }}>
                {s.scramble}
              </div>

              {/* Action row — 5 equal-sized buttons:
                    [OK] [+2] [DNF] [💬] [↗]
                  Penalty buttons set s.penalty via setSolvePenalty;
                  💬 toggles the inline comment editor below the row;
                  ↗ shares via Web Share API (clipboard fallback). */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '0.4rem',
              }}>
                {penaltyOpts.map(o => {
                  const active = s.penalty === o.value;
                  return (
                    <button
                      key={o.value}
                      onClick={() => setSolvePenalty(s.id, o.value)}
                      aria-pressed={active}
                      style={{
                        height: 44, borderRadius: RADIUS,
                        background: active ? C.cardAlt : 'transparent',
                        border: `1px solid ${active ? C.borderHi : C.border}`,
                        color: active ? o.color : C.muted,
                        fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit',
                        cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
                      }}
                    >
                      {o.label}
                    </button>
                  );
                })}
                <button
                  onClick={() => {
                    setDetailCommentDraft(s.comment ?? '');
                    setDetailCommentOpen(o => !o);
                  }}
                  aria-label={hasComment ? 'Edit comment' : 'Add comment'}
                  aria-pressed={detailCommentOpen}
                  title={hasComment ? 'Edit comment' : 'Add comment'}
                  style={{
                    position: 'relative',
                    height: 44, borderRadius: RADIUS,
                    background: detailCommentOpen ? C.cardAlt : 'transparent',
                    border: `1px solid ${detailCommentOpen ? C.borderHi : C.border}`,
                    color: detailCommentOpen ? C.text : C.muted,
                    cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
                  }}
                >
                  <IconComment size={18} />
                  {hasComment && (
                    // Corner dot signalling "comment exists" —
                    // visible whether the panel is open or not.
                    <span aria-hidden="true" style={{
                      position: 'absolute', top: 6, right: 6,
                      width: 6, height: 6, borderRadius: 999,
                      background: C.text,
                    }} />
                  )}
                </button>
                <button
                  onClick={() => onShareSolve(s)}
                  aria-label="Share solve"
                  title="Share"
                  style={{
                    height: 44, borderRadius: RADIUS,
                    background: 'transparent',
                    border: `1px solid ${C.border}`,
                    color: C.muted,
                    cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.background = C.cardAlt; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = 'transparent'; }}
                >
                  <IconShareOut size={18} />
                </button>
              </div>

              {/* Inline comment editor — only renders when the 💬 button
                  is toggled on. Saves via setSolveComment; cancel just
                  collapses the panel without committing the draft. */}
              {detailCommentOpen && (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '0.5rem',
                }}>
                  <textarea
                    value={detailCommentDraft}
                    onChange={e => setDetailCommentDraft(e.target.value)}
                    placeholder="Тайлбар..."
                    rows={3}
                    style={{
                      width: '100%', resize: 'vertical', minHeight: 64,
                      background: C.cardAlt, color: C.text,
                      border: `1px solid ${C.border}`, borderRadius: RADIUS_SM,
                      padding: '0.5rem 0.65rem',
                      fontFamily: 'inherit', fontSize: '0.9rem', lineHeight: 1.5,
                      outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
                    <button
                      onClick={() => setDetailCommentOpen(false)}
                      style={{
                        padding: '0.4rem 0.85rem', borderRadius: RADIUS,
                        background: 'transparent', color: C.muted,
                        border: 'none',
                        fontSize: '0.78rem', fontWeight: 500, fontFamily: 'inherit',
                        cursor: 'pointer',
                      }}
                    >Болих</button>
                    <button
                      onClick={() => {
                        setSolveComment(s.id, detailCommentDraft);
                        setDetailCommentOpen(false);
                      }}
                      style={{
                        padding: '0.4rem 0.85rem', borderRadius: RADIUS,
                        background: C.cardAlt, color: C.text,
                        border: `1px solid ${C.borderHi}`,
                        fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                        cursor: 'pointer',
                      }}
                    >Хадгалах</button>
                  </div>
                </div>
              )}

              {/* Subtle Delete affordance, separated from the action row
                  so the destructive action doesn't sit next to the
                  reversible penalty buttons. The modal's own × close
                  in the corner covers the dismiss path. */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { deleteSolve(s.id); setDetailSolveId(null); }}
                  style={{
                    padding: '0.45rem 0.85rem', borderRadius: RADIUS,
                    fontSize: '0.78rem', fontWeight: 500, fontFamily: 'inherit',
                    background: 'transparent', color: C.danger,
                    border: 'none', cursor: 'pointer',
                  }}
                >Delete</button>
              </div>
            </div>
          </ModalShell>
        );
      })()}

      {/* Comment editor — opens from the inline action row under the
          timer (or the Solve Detail modal). Saves to the targeted solve's
          `comment` field. */}
      {commentSolveId && (() => {
        const s = solves.find(x => x.id === commentSolveId);
        if (!s) return null;
        return (
          <CommentModal
            initialComment={s.comment ?? ''}
            onCancel={() => setCommentSolveId(null)}
            onSave={(text) => {
              setSolveComment(s.id, text);
              setCommentSolveId(null);
            }}
          />
        );
      })()}

      {/* Delete confirmation — Material-style compact dialog. The X
          button under the timer (and the X keyboard shortcut) routes
          through this so accidental taps don't lose data. */}
      {deleteConfirmOpen && lastSolve && (
        <DeleteConfirmDialog
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={confirmDeleteLastSolve}
        />
      )}

      <style>{`
        .pv-grid > main > section { box-sizing: border-box; }

        /* Hide the default scrollbar on the desktop sidebar's solve list
           (the light track clashes with the dark theme). Scroll still
           works — only the visual track/thumb is hidden. */
        .pv-solves-list, .pv-last12 {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .pv-solves-list::-webkit-scrollbar,
        .pv-last12::-webkit-scrollbar {
          display: none;
        }

        @media (max-width: 1100px) {
          .pv-grid { flex-direction: column !important; height: auto !important; overflow: auto !important; }
          .pv-grid > aside { flex: 0 0 auto !important; height: auto !important; max-height: 60vh; }
        }
        @media (max-width: 700px) {
          .pv-grid { padding: 0.75rem !important; gap: 0.75rem !important; }
        }
        @keyframes pv-ble-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }
        @keyframes pv-actionrow-fade {
          0%   { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes pv-dialog-fade {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes pv-dialog-pop {
          0%   { opacity: 0; transform: scale(0.94); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes pv-scramble-fade {
          0%   { opacity: 0.35; }
          100% { opacity: 1; }
        }

        /* Frosted-glass card treatment for vivid themes. --pv-card-blur is
           set to the theme's cardBlur value (e.g. blur(12px)) or 'none'. */
        .timer-page {
          --pv-card-blur: ${THEMES[themeId].cardBlur ?? 'none'};
        }
        .timer-page .pv-sidebar,
        .timer-page .pv-right-panel,
        .timer-page .pv-scramble,
        .timer-page .pv-mobile-header,
        .timer-page .pv-mobile-stats,
        .timer-page .pv-mobile-nav {
          backdrop-filter: var(--pv-card-blur);
          -webkit-backdrop-filter: var(--pv-card-blur);
        }

        /* Focus mode: while a solve is running, fade out everything
           except the digit display. Opacity (rather than display:none /
           visibility:hidden) keeps the layout intact so the digits don't
           jump, and gives a smooth fade in/out around solve start/stop. */
        .timer-page .pv-sidebar,
        .timer-page .pv-right-panel,
        .timer-page .pv-scramble,
        .timer-page .pv-mobile-header,
        .timer-page .pv-mobile-stats,
        .timer-page .pv-mobile-nav,
        .timer-page .pv-bt-indicator,
        .timer-page .pv-instruction,
        .timer-page .pv-ao5-inline {
          transition: opacity 0.15s ease;
        }
        /* The timer card itself drops its fill + border in focus mode so
           the digits (translated to the viewport centre, see focusShift)
           sit on the plain page background. */
        .timer-page .pv-timer-card {
          transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .timer-page.focus-mode .pv-timer-card {
          background-color: transparent !important;
          border-color: transparent !important;
        }
        .timer-page.focus-mode .pv-sidebar,
        .timer-page.focus-mode .pv-right-panel,
        .timer-page.focus-mode .pv-scramble,
        .timer-page.focus-mode .pv-mobile-header,
        .timer-page.focus-mode .pv-mobile-stats,
        .timer-page.focus-mode .pv-mobile-nav,
        .timer-page.focus-mode .pv-bt-indicator,
        .timer-page.focus-mode .pv-instruction,
        .timer-page.focus-mode .pv-ao5-inline {
          opacity: 0;
          pointer-events: none;
        }
        /* Plain page background behind the digits during a solve — the
           theme's solid bg (#0B0B0C on the default theme) instead of any
           gradient, so drained-to-0 panels can't leave a coloured backdrop
           and the digits keep their contrast on every theme. */
        .timer-page.focus-mode {
          background: ${C.bg} !important;
        }

        .pv-ao5-inline {
          animation: ao5-fade-in 0.2s ease-out both;
        }
        /* "Ижил холилт is active" dot — slow soft pulse, static for users
           who prefer reduced motion. */
        .pv-active-dot {
          animation: pv-dot-pulse 2s ease-in-out infinite;
        }
        @keyframes pv-dot-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pv-active-dot { animation: none; }
        }
        @keyframes ao5-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

// ── Desktop right-panel components (redesigned Performance section) ────────

// Returns 'down' (current is lower = faster = improving) or 'up' (slower).
function trendDir(curr: number | null, prev: number | null): 'up' | 'down' | null {
  if (curr == null || prev == null) return null;
  if (curr < prev) return 'down';
  if (curr > prev) return 'up';
  return null;
}

function DesktopPbCard({ pbMs, gapFromMean, precision }: {
  pbMs: number | null;
  gapFromMean: number | null;  // seconds, positive = PB faster than mean
  precision: Precision;
}) {
  return (
    <div style={{
      borderRadius: RADIUS, padding: '1rem 1.1rem',
      background: C.card,
      border: `1px solid ${C.border}`,
    }}>
      <div style={{
        fontSize: '0.75rem', color: C.muted, fontWeight: 500,
      }}>
        Personal best
      </div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '2.4rem', fontWeight: 700, color: C.success,
        marginTop: '0.35rem', fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.0,
      }}>
        {fmtMs(pbMs, false, precision)}
      </div>
      <div style={{
        marginTop: '0.5rem', fontSize: '0.7rem', color: C.muted,
      }}>
        {gapFromMean != null && gapFromMean > 0 ? (
          <>
            <span style={{ color: C.success, fontWeight: 700 }}>↓ {gapFromMean.toFixed(2)}s</span>
            {' '}from mean
          </>
        ) : pbMs == null ? 'No solves yet' : 'Personal record'}
      </div>
    </div>
  );
}

/** One cell of the desktop stats surface. No border/radius of its own —
 *  the parent grid draws the dividers and the outer frame. */
function DesktopStatCard({ label, value, trend }: {
  label: string;
  value: string;
  trend?: 'up' | 'down' | null;
}) {
  const trendColor = trend === 'down' ? C.success : trend === 'up' ? C.danger : C.mutedDim;
  const trendChar  = trend === 'down' ? '↓' : trend === 'up' ? '↑' : '';
  return (
    <div
      style={{
        background: C.card,
        padding: '0.7rem 0.85rem',
        display: 'flex', flexDirection: 'column', gap: '0.25rem',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '0.75rem', color: C.muted, fontWeight: 500 }}>
          {label}
        </span>
        {trendChar && (
          <span style={{ color: trendColor, fontSize: '0.78rem', fontWeight: 600, lineHeight: 1 }}>
            {trendChar}
          </span>
        )}
      </div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '1.55rem', fontWeight: 700,
        color: C.text,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.05,
      }}>
        {value}
      </div>
    </div>
  );
}

interface ChartTrend {
  values: (number | null)[];
  dashed?: boolean;
}

/** Monochrome session chart shared by the desktop panel and the mobile
 *  Stats tab. The main series (solve times, ms) is a smooth monotone
 *  cubic curve in secondary grey with a faint fading area under it; DNFs
 *  arrive as null and are skipped by connecting their neighbours. Optional
 *  trend series (Ao5/Ao12) are thinner primary-at-low-opacity curves that
 *  break into segments where they're null. The best solve gets one small
 *  green dot.
 *
 *  Drawn in real pixels: the width is measured with a ResizeObserver and
 *  the height is fixed, so lines, dots and labels are never stretched the
 *  way a preserveAspectRatio="none" viewBox would stretch them. */
function SmoothChart({ values, trends = [], height, axis = false, c }: {
  values: (number | null)[];
  trends?: ChartTrend[];
  height: number;
  axis?: boolean;
  c: typeof C;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(0);
  const fillId = `pv-chart-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const finite = (v: number | null): v is number => v != null && Number.isFinite(v);
  const validCount = values.filter(finite).length;

  if (validCount < 2) {
    return (
      <div ref={wrapRef} style={{
        height, width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: c.mutedDim, fontSize: '0.72rem', textAlign: 'center',
      }}>
        Need at least 2 solves to chart progress.
      </div>
    );
  }

  const n = values.length;
  const plotted = [...values, ...trends.flatMap(t => t.values)].filter(finite);
  const minMs = Math.min(...plotted);
  const maxMs = Math.max(...plotted);
  const span = maxMs - minMs || 1000;
  const yMin = minMs - span * 0.08;
  const yMax = maxMs + span * 0.08;

  const padL = axis ? 36 : 6, padR = 8, padT = 8, padB = axis ? 8 : 6;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = Math.max(1, height - padT - padB);
  const xAt = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (ms: number) => padT + (1 - (ms - yMin) / (yMax - yMin)) * innerH;

  // Main series: drop DNFs and join the remaining points into one curve.
  const mainPts: Pt[] = [];
  let bestIdx = -1;
  values.forEach((v, i) => {
    if (!finite(v)) return;
    mainPts.push({ x: xAt(i), y: yAt(v) });
    if (bestIdx < 0 || v < (values[bestIdx] as number)) bestIdx = i;
  });
  const mainD = monotonePath(mainPts);
  const bottom = padT + innerH;
  const areaD = `${mainD}L${mainPts[mainPts.length - 1].x.toFixed(2)},${bottom}L${mainPts[0].x.toFixed(2)},${bottom}Z`;

  const ticks = [yMin + span * 0.08, (yMin + yMax) / 2, yMax - span * 0.08];

  return (
    <div ref={wrapRef} style={{ height, width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={height} style={{ display: 'block' }} aria-hidden="true">
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.muted} stopOpacity={0.12} />
              <stop offset="100%" stopColor={c.muted} stopOpacity={0} />
            </linearGradient>
          </defs>

          {axis && ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={yAt(t)} y2={yAt(t)} stroke={c.border} strokeWidth={1} />
              <text x={4} y={yAt(t) + 3.5} fontSize={10} fill={c.mutedDim} fontFamily='"JetBrains Mono", monospace'>
                {(t / 1000).toFixed(1)}s
              </text>
            </g>
          ))}

          <path d={areaD} fill={`url(#${fillId})`} stroke="none" />

          {trends.map((tr, ti) =>
            segmentsOf(tr.values, xAt, yAt).map((seg, si) => (
              <path
                key={`${ti}-${si}`}
                d={monotonePath(seg)}
                fill="none" stroke={c.text} strokeOpacity={tr.dashed ? 0.4 : 0.6}
                strokeWidth={1.25} strokeDasharray={tr.dashed ? '4 3' : undefined}
                strokeLinejoin="round" strokeLinecap="round"
              />
            )),
          )}

          <path d={mainD} fill="none" stroke={c.muted} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

          {bestIdx >= 0 && (
            <circle cx={xAt(bestIdx)} cy={yAt(values[bestIdx] as number)} r={3} fill={c.success} />
          )}
        </svg>
      )}
    </div>
  );
}

// ── Mobile-only sub-components ──────────────────────────────────────────────

// Compact Bluetooth toggle. State drives both color and tooltip; click flips
// between connect (idle/error) and disconnect (connected). When the browser
// doesn't expose Web Bluetooth, the button still renders but explains why.
function GanButton({
  state, onConnect, onDisconnect, size = 30, iconSize = 16,
}: {
  state: 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';
  onConnect: () => void;
  onDisconnect: () => void;
  size?: number;
  iconSize?: number;
}) {
  const isConnected = state === 'connected';
  const isConnecting = state === 'connecting';
  const isUnsupported = state === 'unsupported';
  const color = isConnected ? C.success
    : isConnecting ? C.text
    : isUnsupported ? C.mutedDim
    : C.muted;
  const title = isUnsupported ? 'Web Bluetooth not supported in this browser'
    : isConnecting ? 'Connecting…'
    : isConnected ? 'GAN Timer connected — tap to disconnect'
    : 'Connect GAN Timer';
  return (
    <button
      onClick={() => {
        if (isUnsupported) {
          const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
          // eslint-disable-next-line no-alert
          alert(isIOS
            ? "iOS browsers don't support Web Bluetooth. Install Bluefy from the App Store and open this site in Bluefy to use a smart timer."
            : 'Web Bluetooth is required for smart-timer support. Use Chrome or Edge over HTTPS / localhost.');
          return;
        }
        if (isConnected) onDisconnect(); else if (!isConnecting) onConnect();
      }}
      aria-label={title}
      title={title}
      style={{
        // Ghost icon: no frame; state shows through the icon colour
        // (green when connected), hover = surface-selected.
        width: size, height: size, borderRadius: RADIUS,
        background: isConnecting ? C.cardAlt : 'transparent',
        border: 'none',
        color, cursor: isUnsupported ? 'help' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        animation: isConnecting ? 'pv-ble-pulse 1.1s ease-in-out infinite' : undefined,
        transition: 'background 0.15s, color 0.15s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = C.cardAlt; }}
      onMouseLeave={e => { e.currentTarget.style.background = isConnecting ? C.cardAlt : 'transparent'; }}
    ><IconBluetooth size={iconSize} /></button>
  );
}

function MobileActionIcon({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        flex: 1, height: 38, borderRadius: RADIUS,
        background: C.card, border: 'none',
        color: C.muted, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >{icon}</button>
  );
}

// Tiles for the mobile Stats tab — bigger card style for the 2x2 main grid.
function MobileStatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  // `accent` only tints the value text (e.g. green PB) — the card itself
  // is always the plain surface.
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: RADIUS, padding: '0.6rem 0.75rem',
      display: 'flex', flexDirection: 'column', gap: '0.25rem',
    }}>
      <div style={{ fontSize: '0.72rem', color: C.muted, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '1.35rem', fontWeight: 700,
        color: accent ?? C.text,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.05,
      }}>
        {value}
      </div>
    </div>
  );
}

// Compact 4-up secondary row: tiny label + value, no card chrome.
function MobileStatMini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: RADIUS_SM, padding: '0.4rem 0.5rem',
      display: 'flex', flexDirection: 'column', gap: '0.1rem',
      alignItems: 'center', textAlign: 'center', minWidth: 0,
    }}>
      <div style={{ fontSize: '0.68rem', color: C.muted, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '0.82rem', fontWeight: 700,
        color: C.text, fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: '100%',
      }}>
        {value}
      </div>
    </div>
  );
}

function MobileMicroStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '2.6rem 1fr',
      alignItems: 'baseline', gap: '0.4rem',
    }}>
      <div style={{ fontSize: '0.68rem', color: C.muted, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '0.85rem', fontWeight: 700, lineHeight: 1.3,
        color: C.text,
        fontVariantNumeric: 'tabular-nums',
        textAlign: 'right',
      }}>
        {value}
      </div>
    </div>
  );
}

// ── Community tab (mobile, internal id 'tools') ─────────────────────────
//
// Layout: wide Profile card at the top, then two grouped 3-column grids —
// "Идэвхтэй" (live destinations; hidden when none are open) and "Удахгүй"
// (stub tiles in tertiary text with an "Удахгүй" badge; tapping toasts).
// Race / Competition join the stubs while their TIMER_FEATURES flag is
// off. Each tile is square, with a single SVG icon + short label.

interface ToolTile {
  id: string;
  name: string;
  Icon: (p: IconProps) => React.ReactElement;
  /** Undefined route means the tile is a "Soon" stub (rendered dimmed). */
  route?: string;
  /** Feature switch gating this tile; while it's off the tile is shown
   *  as an "Удахгүй" stub instead (see lib/timer-features.ts). */
  feature?: TimerFeature;
}

const ACTIVE_TILES: ToolTile[] = [
  { id: 'race',        name: 'Race',        Icon: IconStopwatch, route: '/timer/multiplayer',   feature: 'racing' },
  { id: 'competition', name: 'Competition', Icon: IconTrophy,    route: '/timer/competitions', feature: 'competition' },
];

const SOON_TILES: ToolTile[] = [
  { id: 'community',  name: 'Community',  Icon: IconUsers },
  { id: 'algorithms', name: 'Algorithms', Icon: IconCube  },
];

const ROLE_LABEL_MN: Record<'member' | 'athlete' | 'admin', string> = {
  member:  'Гишүүн',
  athlete: 'Спортсмен',
  admin:   'Админ',
};

function ToolsTab({
  onNavigate, solveCount, currentUserId,
}: {
  onNavigate: (path: string) => void;
  solveCount: number;
  currentUserId?: string;
}) {
  // Tiles whose feature is switched off move to the "Удахгүй" group as
  // route-less stubs; the "Идэвхтэй" group hides when nothing is left.
  const isOpen = (t: ToolTile) => !t.feature || TIMER_FEATURES[t.feature];
  const openTiles = ACTIVE_TILES.filter(isOpen);
  const soonTiles: ToolTile[] = [
    ...ACTIVE_TILES.filter(t => !isOpen(t)).map(t => ({ ...t, route: undefined })),
    ...SOON_TILES,
  ];
  return (
    <div style={{
      flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
      padding: '1rem 0',
    }}>
      <div style={{ padding: '0 1rem' }}>
        <ProfileCard
          solveCount={solveCount}
          onClick={() => onNavigate('/timer/profile')}
        />
      </div>

      {openTiles.length > 0 && (
        <>
          <SectionLabel>Идэвхтэй</SectionLabel>
          <div style={{
            padding: '0 1rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.6rem',
            justifyItems: 'stretch',
          }}>
            {openTiles.map((tile, i) => (
              <ToolTileBtn
                key={tile.id}
                tile={tile}
                index={i}
                onClick={() => tile.route && onNavigate(tile.route)}
              />
            ))}
          </div>
        </>
      )}

      <SectionLabel>Удахгүй</SectionLabel>
      <div style={{
        padding: '0 1rem',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.6rem',
        justifyItems: 'stretch',
      }}>
        {soonTiles.map((tile, i) => (
          <ToolTileBtn
            key={tile.id}
            tile={tile}
            index={i + openTiles.length}
            onClick={() => showToast({ msg: COMING_SOON_TOAST })}
          />
        ))}
      </div>

      <div style={{ padding: '0 1rem', marginTop: '1.5rem', marginBottom: '1rem' }}>
        <a
          href="https://m.me/ch/AbZ1rFu-7_RtQf_g/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '0.85rem 1rem',
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: RADIUS,
            color: C.text,
            fontSize: '0.9rem',
            fontWeight: 600,
            textDecoration: 'none',
            cursor: 'pointer',
            boxSizing: 'border-box',
          }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.08)')}
          onMouseLeave={e => (e.currentTarget.style.filter = '')}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <IconComment size={18} />
            Алдаа мэдээлэх
          </span>
          <IconArrowRight size={16} />
        </a>
      </div>

      <style>{`
        @keyframes pv-tile-fade {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.75rem', fontWeight: 500,
      color: C.muted,
      margin: '0.75rem 0 0.5rem',
      padding: '0 1rem 0 1.1rem',
    }}>{children}</div>
  );
}

function ProfileCard({
  solveCount, onClick,
}: {
  solveCount: number;
  onClick: () => void;
}) {
  const { user } = useAuth();
  const [avatarBroken, setAvatarBroken] = useState(false);

  const displayName = user?.displayName?.trim() || 'Зочин';
  const roleLabel = user
    ? (ROLE_LABEL_MN[user.role] ?? user.role)
    : 'Нэвтрэх';
  const initial = displayName.codePointAt(0)
    ? String.fromCodePoint(displayName.codePointAt(0)!).toUpperCase()
    : '?';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Профайл"
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', gap: '0.85rem',
        padding: '0.85rem 1rem',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: RADIUS,
        color: C.text, fontFamily: 'inherit',
        cursor: 'pointer',
        transition: 'transform 0.12s ease, background 0.15s ease',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = C.cardAlt; }}
      onMouseLeave={e => { e.currentTarget.style.background = C.card; }}
      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.99)'; }}
      onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      onTouchStart={e => { e.currentTarget.style.transform = 'scale(0.99)'; }}
      onTouchEnd={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      onTouchCancel={e => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <span style={{
        width: 48, height: 48, borderRadius: '50%',
        background: C.cardAlt,
        color: C.text, fontSize: 20, fontWeight: 600, lineHeight: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', flexShrink: 0,
      }}>
        {user?.photoURL && !avatarBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.photoURL}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setAvatarBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : initial}
      </span>

      <span style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', gap: '0.15rem',
        textAlign: 'left',
      }}>
        <span style={{
          fontSize: '1rem', fontWeight: 700, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{displayName}</span>
        <span style={{
          fontSize: '0.75rem', color: C.mutedDim,
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span style={{
            padding: '0.05rem 0.4rem',
            borderRadius: RADIUS_SM,
            background: C.cardAlt,
            color: C.muted,
            fontWeight: 500,
            fontSize: '0.68rem',
          }}>{roleLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{solveCount} эвлүүлэлт</span>
        </span>
      </span>

      <span aria-hidden="true" style={{
        color: C.muted, display: 'inline-flex', flexShrink: 0,
      }}>
        <IconArrowRight size={16} />
      </span>
    </button>
  );
}

function ToolTileBtn({
  tile, index, onClick,
}: {
  tile: ToolTile;
  index: number;
  onClick: () => void;
}) {
  const isSoon = !tile.route;
  const Icon = tile.Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      // Stubs stay clickable (the parent shows a "coming soon" toast) but
      // are announced as disabled and get no hover/press feedback.
      aria-disabled={isSoon || undefined}
      aria-label={isSoon ? `${tile.name} — Удахгүй` : tile.name}
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        minHeight: 70,
        padding: '0.7rem',
        background: C.card,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${C.border}`,
        borderRadius: RADIUS,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '6px',
        color: isSoon ? C.mutedDim : C.text, fontFamily: 'inherit',
        cursor: isSoon ? 'default' : 'pointer',
        // Press feedback + entrance stagger (30 ms per tile) so the
        // grid feels like a native home-screen.
        animation: `pv-tile-fade 0.28s ease-out both`,
        animationDelay: `${index * 30}ms`,
        transition: 'transform 0.12s ease, border-color 0.15s ease, background 0.15s ease',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseEnter={e => { if (!isSoon) { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.background = C.cardAlt; } }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = C.card; }}
      onMouseDown={e => { if (!isSoon) e.currentTarget.style.transform = 'scale(0.96)'; }}
      onMouseUp={e => { if (!isSoon) e.currentTarget.style.transform = 'scale(1.04)'; }}
      onTouchStart={e => { if (!isSoon) e.currentTarget.style.transform = 'scale(0.96)'; }}
      onTouchEnd={e => { if (!isSoon) e.currentTarget.style.transform = 'scale(1)'; }}
      onTouchCancel={e => { if (!isSoon) e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <span
        aria-hidden="true"
        // Monochrome icons — primary text, tertiary for "Удахгүй" stubs.
        style={{
          color: isSoon ? C.mutedDim : C.text,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon size={28} />
      </span>
      <span style={{
        fontSize: '0.7rem', fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth: '100%',
      }}>{tile.name}</span>
      {isSoon && (
        <span style={{
          position: 'absolute', top: 6, right: 8,
          fontSize: '0.6rem', fontWeight: 500,
          padding: '0.1rem 0.4rem', borderRadius: RADIUS_SM,
          background: C.cardAlt,
          color: C.muted,
        }}>Удахгүй</span>
      )}
    </button>
  );
}

function BottomTab({ label, icon, active, onClick, C: c }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void; C: typeof C }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '0.2rem',
        padding: '0.4rem 0',
        position: 'relative',
        color: active ? c.text : c.mutedDim,
        transition: 'color 0.12s',
      }}
    >
      <span style={{ display: 'inline-flex', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '0.62rem', fontWeight: 600 }}>{label}</span>
      {active && (
        <span style={{
          position: 'absolute', bottom: 0, left: '30%', right: '30%',
          height: 2, background: c.text, borderRadius: 2,
        }} />
      )}
    </button>
  );
}

// Solves-tab "more" menu — currently hosts only the sort options, but
// kept structurally generic so future actions ("Clear all solves",
// "Export") can join the same menu. Trigger is a 32×32 ⋮ icon button
// that fits inline at the right edge of the search bar (mobile) or the
// solves header (desktop). Click-outside catcher and ESC both close it.
// Sessions popup — opened from the sidebar's session-selector button on
// desktop and from the mobile capsule's "+" button. Both paths render
// the SAME panel; only the outer shell differs:
//   - mode='sidebar' anchors the panel under the trigger (absolute
//     positioned inside the parent `position: relative` wrapper).
//   - mode='modal' renders a fixed centered overlay with click-outside
//     and ESC dismissal.
// The body itself is identical: header / scrollable list / sticky
// bottom CTA. Each row has an inline ⋮ menu that exposes rename +
// delete affordances; the bottom CTA toggles between a plain "Шинэ
// сесс үүсгэх" button and an inline input + save/cancel pair.
function SessionsPanel({
  mode, list, currentId, precision,
  onSwitch, onCreate, onRename, onDelete, onClose,
}: {
  mode: 'sidebar' | 'modal';
  list: Session[];
  currentId: string | undefined;
  precision: Precision;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const body = (
    <>
      {/* Header — title + dismiss × */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.85rem 1rem',
        borderBottom: `1px solid ${C.border}`,
        gap: '0.5rem',
      }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text }}>
          Sessions
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 28, height: 28, borderRadius: RADIUS_SM,
            background: 'transparent', border: 'none',
            color: C.muted, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        ><IconClose size={14} /></button>
      </div>

      {/* Scrollable session list. Hidden scrollbar via the shared
          .pv-solves-list rule defined further down in the page. */}
      <div className="pv-solves-list" style={{
        flex: '1 1 auto', minHeight: 0,
        overflowY: 'auto',
        padding: '0.5rem',
        display: 'flex', flexDirection: 'column', gap: '0.3rem',
      }}>
        {list.length === 0 && (
          <div style={{ fontSize: '0.8rem', color: C.mutedDim, padding: '0.5rem' }}>
            No sessions yet.
          </div>
        )}
        {list.map(s => {
          const valid = s.solves.filter(x => !isDnf(x));
          const sessBest = valid.length ? Math.min(...valid.map(finalMs)) : null;
          const lastTs = s.solves.length ? s.solves[s.solves.length - 1].ts : null;
          const isCurrent = s.id === currentId;
          const isRenaming = renamingId === s.id;
          const isMenuOpen = menuId === s.id;
          return (
            <div
              key={s.id}
              style={{
                position: 'relative',
                padding: '0.75rem 0.85rem',
                borderRadius: RADIUS,
                background: isCurrent ? C.cardAlt : 'transparent',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => {
                if (!isCurrent) e.currentTarget.style.background = C.cardAlt;
              }}
              onMouseLeave={e => {
                if (!isCurrent) e.currentTarget.style.background = 'transparent';
              }}
            >
              {isRenaming ? (
                /* Inline rename input — Enter commits, Esc cancels. */
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.4rem', alignItems: 'center' }}>
                  <input
                    autoFocus
                    maxLength={30}
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onRename(s.id, renameValue);
                        setRenamingId(null);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setRenamingId(null);
                      }
                    }}
                    style={{
                      background: C.bg, color: C.text,
                      border: `1px solid ${C.borderHi}`, borderRadius: RADIUS_SM,
                      padding: '0.4rem 0.6rem', fontSize: '0.9rem',
                      fontFamily: 'inherit', outline: 'none', minWidth: 0,
                    }}
                  />
                  <button
                    onClick={() => { onRename(s.id, renameValue); setRenamingId(null); }}
                    aria-label="Хадгалах"
                    style={{
                      width: 30, height: 30, borderRadius: RADIUS_SM,
                      background: C.cardAlt, color: C.text,
                      border: 'none', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  ><IconCheck size={14} /></button>
                  <button
                    onClick={() => setRenamingId(null)}
                    aria-label="Болих"
                    style={{
                      width: 30, height: 30, borderRadius: RADIUS_SM,
                      background: 'transparent', color: C.muted,
                      border: 'none', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  ><IconClose size={14} /></button>
                </div>
              ) : (
                <button
                  onClick={() => { onSwitch(s.id); onClose(); }}
                  style={{
                    width: '100%',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                    padding: 0, textAlign: 'left',
                    display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                    alignItems: 'center', gap: '0.7rem',
                  }}
                >
                  {/* Active session = small check; others keep an empty
                      slot of the same width so names stay aligned. */}
                  <span aria-hidden style={{
                    width: 14,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: C.text,
                  }}>
                    {isCurrent && <IconCheck size={14} />}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
                    <span style={{
                      fontSize: '0.95rem', fontWeight: isCurrent ? 600 : 500,
                      color: C.text,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {s.name}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: C.muted, fontWeight: 500 }}>
                      {s.solves.length} эвлүүлэлт
                      {sessBest != null && (
                        <> · Шилдэг <span style={{ fontFamily: '"JetBrains Mono", monospace', color: C.success }}>{fmtMs(sessBest, false, precision)}</span></>
                      )}
                      {lastTs != null && (
                        <> · Сүүлд: {formatSolveDate(lastTs)}</>
                      )}
                    </span>
                  </span>
                  <span
                    role="button"
                    aria-label="Илүү"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId(prev => (prev === s.id ? null : s.id));
                    }}
                    style={{
                      width: 28, height: 28, borderRadius: RADIUS_SM,
                      background: isMenuOpen ? C.border : 'transparent',
                      color: isMenuOpen ? C.text : C.muted,
                      cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx={12} cy={5}  r={1.6} />
                      <circle cx={12} cy={12} r={1.6} />
                      <circle cx={12} cy={19} r={1.6} />
                    </svg>
                  </span>
                </button>
              )}

              {isMenuOpen && !isRenaming && (
                <>
                  <div
                    onClick={() => setMenuId(null)}
                    style={{ position: 'fixed', inset: 0, zIndex: 52, background: 'transparent' }}
                  />
                  {/* Submenu opens to the LEFT of the ⋮ button rather
                      than below it — that way the bottom-most session
                      row doesn't get its submenu clipped behind the
                      "New Session" CTA. Vertically centered on the
                      row; the menu is compact enough (~60 px) to stay
                      within the row's vertical extent so neither the
                      first nor the last row clips through the list's
                      `overflow: auto` boundary. */}
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      right: '2.5rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      zIndex: 53,
                      background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: RADIUS, padding: '0.2rem',
                      minWidth: 140,
                      boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
                      display: 'flex', flexDirection: 'column', gap: '0.05rem',
                    }}
                  >
                    <button
                      role="menuitem"
                      onClick={() => {
                        setRenamingId(s.id);
                        setRenameValue(s.name);
                        setMenuId(null);
                      }}
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: C.text, fontFamily: 'inherit', textAlign: 'left',
                        fontSize: '0.8rem', fontWeight: 500,
                        padding: '0.4rem 0.55rem', borderRadius: RADIUS_SM,
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.cardAlt; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <IconPencil size={14} /> Нэр өөрчлөх
                    </button>
                    <button
                      role="menuitem"
                      disabled={list.length <= 1}
                      onClick={() => {
                        if (list.length <= 1) return;
                        onDelete(s.id);
                        setMenuId(null);
                      }}
                      title={list.length > 1 ? '' : 'At least one session is required'}
                      style={{
                        background: 'transparent', border: 'none',
                        cursor: list.length > 1 ? 'pointer' : 'not-allowed',
                        color: C.danger,
                        opacity: list.length > 1 ? 1 : 0.45,
                        fontFamily: 'inherit', textAlign: 'left',
                        fontSize: '0.8rem', fontWeight: 500,
                        padding: '0.4rem 0.55rem', borderRadius: RADIUS_SM,
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                      }}
                      onMouseEnter={e => { if (list.length > 1) e.currentTarget.style.background = C.cardAlt; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <IconTrash size={14} /> Устгах
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky bottom CTA — collapsed button by default, expands to
          an inline input on tap. Enter / ✓ commits, Esc / ✕ cancels. */}
      <div style={{
        flexShrink: 0,
        padding: '0.7rem 1rem',
        borderTop: `1px solid ${C.border}`,
      }}>
        {creating ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.4rem' }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCreate(newName);
                  setNewName('');
                  setCreating(false);
                  onClose();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setCreating(false);
                  setNewName('');
                }
              }}
              placeholder="New session name"
              style={{
                background: C.bg, color: C.text,
                border: `1px solid ${C.borderHi}`, borderRadius: RADIUS_SM,
                padding: '0.55rem 0.7rem', fontSize: '0.9rem',
                fontFamily: 'inherit', outline: 'none', minWidth: 0,
              }}
            />
            <button
              onClick={() => {
                onCreate(newName);
                setNewName('');
                setCreating(false);
                onClose();
              }}
              aria-label="Үүсгэх"
              style={{
                width: 36, height: 36, borderRadius: RADIUS_SM,
                background: C.cardAlt, color: C.text,
                border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            ><IconCheck size={16} /></button>
            <button
              onClick={() => { setCreating(false); setNewName(''); }}
              aria-label="Болих"
              style={{
                width: 36, height: 36, borderRadius: RADIUS_SM,
                background: 'transparent', color: C.muted,
                border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            ><IconClose size={16} /></button>
          </div>
        ) : (
          /* Plain text button with a + icon — no fill, no dashed frame. */
          <button
            onClick={() => { setCreating(true); setNewName(''); }}
            style={{
              width: '100%',
              background: 'transparent',
              color: C.text,
              border: 'none',
              borderRadius: RADIUS,
              padding: '0.6rem 0.7rem',
              fontSize: '0.88rem', fontWeight: 500, fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.5rem',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.cardAlt; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <IconPlus size={14} /> New Session
          </button>
        )}
      </div>
    </>
  );

  // Neutral surface container — same chrome in both shells so the popup
  // reads as one component regardless of how it was triggered.
  const container = (extraStyle: React.CSSProperties = {}) => ({
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    maxHeight: '70vh',
    display: 'flex', flexDirection: 'column' as const,
    overflow: 'hidden' as const,
    animation: 'pv-sessions-pop 0.16s cubic-bezier(0.2, 0.8, 0.3, 1) both',
    ...extraStyle,
  });

  if (mode === 'sidebar') {
    return (
      <>
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'transparent' }}
        />
        <div
          role="dialog"
          aria-label="Sessions"
          style={container({
            position: 'absolute',
            top: '100%', left: '0.7rem', right: '0.7rem',
            marginTop: '0.4rem',
            zIndex: 51,
          })}
        >
          {body}
        </div>
        <style>{`
          @keyframes pv-sessions-pop {
            from { opacity: 0; transform: scale(0.95); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </>
    );
  }

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-label="Sessions"
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={container({
          width: '100%',
          maxWidth: 460,
        })}
      >
        {body}
      </div>
      <style>{`
        @keyframes pv-sessions-pop {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function SortPicker({ sortMode, onChange }: {
  sortMode: SortMode;
  onChange: (m: SortMode) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More options"
        title="More options"
        style={{
          width: 32, height: 32, borderRadius: RADIUS_SM,
          background: open ? C.cardAlt : 'transparent',
          color: open ? C.text : C.muted,
          border: 'none',
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s, color 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.color = C.text; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.color = C.muted; }}
      >
        {/* Three-dot vertical glyph — three filled circles stacked on
            the y-axis, currentColor so the button's own color tracks
            the open/hover state. */}
        <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor"
             aria-hidden="true" style={{ display: 'block' }}>
          <circle cx={12} cy={5}  r={1.6} />
          <circle cx={12} cy={12} r={1.6} />
          <circle cx={12} cy={19} r={1.6} />
        </svg>
      </button>

      {open && (
        <>
          {/* Click-outside catcher */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'transparent' }}
          />
          <div
            role="listbox"
            aria-label="Эрэмбэлэх"
            style={{
              position: 'absolute', top: 'calc(100% + 0.3rem)', right: 0, zIndex: 51,
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: RADIUS, padding: '0.25rem 0',
              minWidth: 200,
              boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {SORT_GROUPS.map((group, gi) => (
              <div key={group.header} role="group" aria-label={group.header}>
                {/* Subtle separator between groups so the list reads as
                    two distinct categories without dominating the popup. */}
                {gi > 0 && (
                  <div style={{
                    height: 1, background: C.border, margin: '0.3rem 0.5rem',
                  }} />
                )}
                <div style={{
                  fontSize: '0.7rem', color: C.muted, fontWeight: 500,
                  padding: '0.45rem 0.85rem 0.25rem',
                }}>
                  {group.header}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.05rem', padding: '0 0.25rem' }}>
                  {group.options.map(opt => {
                    const active = opt === sortMode;
                    return (
                      <button
                        key={opt}
                        role="option"
                        aria-selected={active}
                        onClick={() => { onChange(opt); setOpen(false); }}
                        style={{
                          // Reserved 14px slot keeps every label aligned
                          // whether or not it has the leading checkmark.
                          display: 'grid', gridTemplateColumns: '14px 1fr',
                          alignItems: 'center', gap: '0.25rem',
                          background: active ? C.cardAlt : 'transparent',
                          color: C.text,
                          border: 'none', borderRadius: RADIUS_SM,
                          padding: '0.45rem 0.65rem',
                          fontSize: '0.82rem', fontWeight: active ? 600 : 500, fontFamily: 'inherit',
                          cursor: 'pointer', textAlign: 'left',
                          transition: 'background 0.12s, color 0.12s',
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.cardAlt; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span aria-hidden style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 14, height: 14, color: C.accent,
                        }}>
                          {active && <IconCheck size={12} />}
                        </span>
                        <span>{SORT_LABELS[opt]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Legend entry matching SmoothChart: a short line, dashed line or dot. */
function ChartLegendItem({ swatch, color, opacity = 1, label }: {
  swatch: 'line' | 'dashed' | 'dot';
  color: string;
  opacity?: number;
  label: string;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <svg width={16} height={8} aria-hidden="true" style={{ display: 'block' }}>
        {swatch === 'dot'
          ? <circle cx={8} cy={4} r={3} fill={color} />
          : <line x1={1} x2={15} y1={4} y2={4} stroke={color} strokeOpacity={opacity}
              strokeWidth={1.75} strokeLinecap="round"
              strokeDasharray={swatch === 'dashed' ? '3 3' : undefined} />}
      </svg>
      <span style={{ color: C.muted }}>{label}</span>
    </span>
  );
}

// ── SettingsPanel: large multi-section modal (desktop) / bottom sheet (mobile)
type SettingsSectionId = 'timer' | 'shortcuts' | 'display';
interface SettingsPanelProps {
  isMobile: boolean;
  C: typeof C;
  onClose: () => void;
  onExit: () => void;
  section: SettingsSectionId;
  setSection: (s: SettingsSectionId) => void;
  mobileExpanded: Set<SettingsSectionId>;
  toggleMobileSection: (s: SettingsSectionId) => void;
  inspectionEnabled: boolean;
  setInspectionEnabled: (v: boolean) => void;
  holdToStart: boolean;
  setHoldToStart: (v: boolean) => void;
  holdTimeMs: number;
  setHoldTimeMs: (n: number) => void;
  hideTimeWhileRunning: boolean;
  setHideTimeWhileRunning: (v: boolean) => void;
  showAo5Projection: boolean;
  setShowAo5Projection: (v: boolean) => void;
  precision: Precision;
  setPrecision: (p: Precision) => void;
  timeEntryMode: 'default' | 'manual' | 'bluetooth';
  setTimeEntryMode: (m: 'default' | 'manual' | 'bluetooth') => void;
  // The unified smart-timer surface. Typed loosely on purpose — this
  // panel only reads { state, brand, deviceName, connect, disconnect }.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gan: any;
  scrambleFontSize: 'sm' | 'md' | 'lg';
  setScrambleFontSize: (s: 'sm' | 'md' | 'lg') => void;
  qiyiDebugMode: boolean;
  setQiyiDebugMode: (v: boolean) => void;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
}

// Static section ordering / icons. Labels themselves come from i18n at
// render time (see SettingsPanel) so the toggle takes effect immediately.
// Standalone "Bluetooth" entry was removed when BT controls collapsed
// into the Timer section's "Цаг оруулах горим" segmented row — they
// only render when the user picks the 'bluetooth' option there.
const SETTINGS_SECTIONS: { id: SettingsSectionId; labelKey: 'timer.section.timer' | 'timer.section.shortcuts' | 'timer.section.display'; icon: React.ReactNode }[] = [
  { id: 'timer',     labelKey: 'timer.section.timer',     icon: <IconStopwatch size={16} /> },
  { id: 'shortcuts', labelKey: 'timer.section.shortcuts', icon: <IconKeyboard  size={16} /> },
  { id: 'display',   labelKey: 'timer.section.display',   icon: <IconPalette   size={16} /> },
];

function SettingsPanel(props: SettingsPanelProps) {
  const { isMobile, C: c, onClose, onExit } = props;
  const { t, lang, setLang } = useLang();

  // ESC closes — captured to win over any other listeners.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // ── Section bodies (shared between desktop + mobile) ──────────────────────
  const renderTimer = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <SegmentedRow<'default' | 'manual' | 'bluetooth'>
        label="Цаг оруулах горим"
        value={props.timeEntryMode}
        onChange={props.setTimeEntryMode}
        options={[
          { value: 'default',   label: 'Үндсэн',    title: 'Хүрэх / SPACE дарж эхлүүлнэ' },
          { value: 'manual',    label: 'Гараар',    title: 'Цагийг шууд бичнэ' },
          { value: 'bluetooth', label: 'Bluetooth', title: 'Smart timer-аас уншина' },
        ]}
        c={c}
      />
      {/* Bluetooth controls fold inline when the user picks the BT mode.
          Used to be its own Settings sidebar entry; the segmented row
          above is now the single discoverability point for choosing
          how a time gets into the timer. */}
      {props.timeEntryMode === 'bluetooth' && renderBluetooth()}
      <ToggleRow label={t('timer.inspectionTime')} value={props.inspectionEnabled} onChange={props.setInspectionEnabled} />
      <ToggleRow label={t('timer.holdToStart')}    value={props.holdToStart}        onChange={props.setHoldToStart} />
      {props.holdToStart && (
        <HoldTimeSlider
          value={props.holdTimeMs}
          onChange={props.setHoldTimeMs}
          c={c}
        />
      )}
      <ToggleRow
        label="Solve үед цаг нуух"
        value={props.hideTimeWhileRunning}
        onChange={props.setHideTimeWhileRunning}
      />
      <div>
        <ToggleRow
          label="Ao5 төсөөлөл харуулах"
          value={props.showAo5Projection}
          onChange={props.setShowAo5Projection}
        />
        <div style={{
          fontSize: '0.7rem', color: c.muted, marginTop: '0.3rem',
          lineHeight: 1.4,
        }}>
          4 удаагийн солвыг хийсний дараа 5 дахь солв-оос хамаарч гарах боломжит сайн ба муу Ao5-ийг харуулна.
        </div>
      </div>
      <SegmentedRow
        label={t('timer.precision')}
        value={props.precision}
        onChange={props.setPrecision}
        options={[
          { value: 'cs', label: t('timer.precision.cs'), title: t('timer.precision.cs.title') },
          { value: 'ms', label: t('timer.precision.ms'), title: t('timer.precision.ms.title') },
        ]}
        c={c}
      />
    </div>
  );

  const renderBluetooth = () => {
    const { gan } = props;
    const connected = gan.state === 'connected';
    const connecting = gan.state === 'connecting';
    const unsupported = gan.state === 'unsupported';
    // gan.brand is set live during a connection and falls back to the
    // last-connected brand from localStorage. Used purely for the
    // small "(GAN)" / "(QiYi)" badge so the user knows which protocol
    // matched their device.
    const brandBadge = gan.brand === 'qiyi' ? 'QiYi' : gan.brand === 'gan' ? 'GAN' : null;
    // iOS doesn't expose Web Bluetooth in any system browser (Apple
    // restriction — Safari, iOS Chrome, iOS Edge are all WebKit and all
    // missing the API), so the generic "use Chrome or Edge" advice is
    // misleading. Bluefy is a third-party WebKit-based browser that ships
    // its own BLE bridge to Web Bluetooth, which is the practical workaround.
    // When Bluefy is in use `navigator.bluetooth` exists → `unsupported` is
    // false → this whole branch never renders, so the iOS hint is hidden.
    const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '0.75rem', padding: '0.75rem', borderRadius: 10,
          background: c.cardAlt, border: `1px solid ${c.border}`,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem', fontWeight: 600, color: c.text }}>
              <span style={{
                width: 9, height: 9, borderRadius: 999,
                background: connected ? c.success : c.mutedDim,
                flexShrink: 0,
              }} />
              {connected ? (
                <>
                  {t('timer.bt.connected')}
                  {brandBadge && (
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 500, color: c.muted,
                      background: c.cardAlt,
                      padding: '0.1rem 0.4rem', borderRadius: RADIUS_SM,
                    }}>{brandBadge}</span>
                  )}
                </>
              ) : connecting ? t('timer.bt.connecting')
                : unsupported ? t('timer.bt.unsupported')
                : t('timer.bt.idle')}
            </span>
            {connected && gan.deviceName && (
              <span style={{ fontSize: '0.74rem', color: c.muted, fontFamily: '"JetBrains Mono", monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {gan.deviceName}
              </span>
            )}
            {!connected && !connecting && !unsupported && (
              <span style={{ fontSize: '0.74rem', color: c.muted }}>
                {t('timer.bt.support-blurb')}
              </span>
            )}
          </div>
          <button
            onClick={() => {
              if (unsupported) return;
              if (connected) gan.disconnect();
              else if (!connecting) gan.connect();
            }}
            disabled={unsupported || connecting}
            style={{
              padding: '0.5rem 0.95rem', borderRadius: RADIUS,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              background: c.cardAlt,
              color: connected ? c.danger : c.text,
              border: 'none',
              cursor: unsupported || connecting ? 'not-allowed' : 'pointer',
              opacity: unsupported || connecting ? 0.5 : 1,
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {connected ? t('timer.bt.disconnect') : connecting ? t('timer.bt.connecting') : t('timer.bt.connect')}
          </button>
        </div>

        {unsupported ? (
          <div
            style={{
              background: c.cardAlt,
              borderRadius: RADIUS,
              padding: '0.7rem 0.85rem',
              display: 'flex', flexDirection: 'column', gap: '0.45rem',
            }}
          >
            <div style={{
              fontSize: '0.82rem', fontWeight: 600, color: c.text,
            }}>
              {isIOS ? 'iOS дээр Bluetooth ашиглах' : 'Web Bluetooth not available'}
            </div>
            <div style={{ fontSize: '0.78rem', color: c.muted, lineHeight: 1.55 }}>
              {isIOS
                ? 'Safari, Chrome, Edge зэрэг iOS-ийн browser-ууд Bluetooth timer-ийг дэмждэггүй. Smart timer ашиглахын тулд Bluefy browser-ыг татаж аваад, энэ сайтыг Bluefy дотор нээнэ үү.'
                : 'Web Bluetooth is required. Use Chrome or Edge over HTTPS or localhost.'}
            </div>
            {isIOS && (
              <a
                href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  alignSelf: 'flex-start',
                  marginTop: '0.25rem',
                  padding: '0.65rem 1.1rem',
                  borderRadius: RADIUS,
                  background: c.card,
                  color: c.text,
                  fontSize: '0.9rem', fontWeight: 600,
                  textDecoration: 'none',
                  border: `1px solid ${c.borderHi}`,
                  display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                }}
              >
                Bluefy татах
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 17L17 7" />
                  <polyline points="8 7 17 7 17 16" />
                </svg>
              </a>
            )}
          </div>
        ) : (
          <div style={{ fontSize: '0.78rem', color: c.muted, lineHeight: 1.55 }}>
            {t('timer.bt.help')}
          </div>
        )}
        {(connected && gan.brand === 'qiyi') && (
          <div style={{
            marginTop: '0.25rem',
            paddingTop: '0.7rem',
            borderTop: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', gap: '0.45rem',
          }}>
            <ToggleRow
              label="Debug mode (raw packet log)"
              value={props.qiyiDebugMode}
              onChange={props.setQiyiDebugMode}
            />
            <div style={{ fontSize: '0.7rem', color: c.mutedDim, lineHeight: 1.5 }}>
              When on, a small overlay shows the last 10 raw BLE packets
              received from the timer. Use this to confirm whether data is
              arriving from an unfamiliar firmware (e.g. QY-Timer-V2).
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderShortcuts = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* ── Desktop keyboard shortcuts ── */}
      <div>
        <div style={{
          fontSize: '0.75rem', fontWeight: 500, color: c.muted, marginBottom: '0.6rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}>
          <IconKeyboard size={13} /> Компьютер
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem 1.25rem',
          fontSize: '0.84rem',
        }}>
          <ShortcutCell label="Start / stop timer"            kbd="SPACE" c={c} />
          <ShortcutCell label="Clear session (press twice)"   kbd="Alt+D" c={c} />
          <ShortcutCell label="Square-1"                      kbd="Alt+1" c={c} />
          <ShortcutCell label="2×2 Cube"                      kbd="Alt+2" c={c} />
          <ShortcutCell label="3×3 Cube"                      kbd="Alt+3" c={c} />
          <ShortcutCell label="4×4 Cube"                      kbd="Alt+4" c={c} />
          <ShortcutCell label="5×5 Cube"                      kbd="Alt+5" c={c} />
          <ShortcutCell label="6×6 Cube"                      kbd="Alt+6" c={c} />
          <ShortcutCell label="7×7 Cube"                      kbd="Alt+7" c={c} />
          <ShortcutCell label="Skewb"                         kbd="Alt+S" c={c} />
          <ShortcutCell label="Megaminx"                      kbd="Alt+M" c={c} />
          <ShortcutCell label="Clock"                         kbd="Alt+C" c={c} />
          <ShortcutCell label="Pyraminx"                      kbd="Alt+P" c={c} />
        </div>
      </div>

      <div style={{ height: 1, background: c.border }} />

      {/* ── Mobile two-finger gestures ── */}
      <div>
        <div style={{
          fontSize: '0.75rem', fontWeight: 500, color: c.muted, marginBottom: '0.6rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}>
          <IconPhone size={13} /> Утас
        </div>
        <div style={{
          fontSize: '0.72rem', color: c.muted, marginBottom: '0.55rem',
        }}>
          Хоёр хуруугаар товшилт
        </div>
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '0.4rem',
          fontSize: '0.84rem',
        }}>
          <ShortcutCell label="Сүүлийн эвлүүлэлт устгах"     kbd="Товших"      c={c} />
          <ShortcutCell label="+2 нэмэх / хасах"             kbd="Дээш чирэх"  c={c} />
          <ShortcutCell label="DNF тэмдэглэх / хасах"        kbd="Доош чирэх"  c={c} />
        </div>
        <div style={{
          fontSize: '0.68rem', color: c.muted, marginTop: '0.55rem',
          fontStyle: 'italic',
        }}>
          Эвлүүлэлт дууссаны дараа л ажиллана.
        </div>
      </div>
    </div>
  );

  const renderDisplay = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <ThemePicker
        isMobile={isMobile}
        themeId={props.themeId}
        setThemeId={props.setThemeId}
        c={c}
      />
      <SegmentedRow<Lang>
        label={t('timer.language')}
        value={lang}
        onChange={setLang}
        options={[
          { value: 'mn', label: t('timer.language.mn') },
          { value: 'en', label: t('timer.language.en') },
        ]}
        c={c}
      />
      <SegmentedRow
        label={t('timer.scrambleFontSize')}
        value={props.scrambleFontSize}
        onChange={props.setScrambleFontSize}
        options={[
          { value: 'sm', label: t('timer.scrambleFontSize.sm') },
          { value: 'md', label: t('timer.scrambleFontSize.md') },
          { value: 'lg', label: t('timer.scrambleFontSize.lg') },
        ]}
        c={c}
      />
    </div>
  );

  const renderSection = (id: SettingsSectionId) => {
    if (id === 'timer')     return renderTimer();
    if (id === 'shortcuts') return renderShortcuts();
    return renderDisplay();
  };

  // Header content shared between layouts (Settings title + Exit + Close).
  const headerActions = (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
      <button
        onClick={onExit}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: c.mutedDim, fontSize: '0.74rem', fontFamily: 'inherit',
          padding: '0.2rem 0.45rem',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = c.muted)}
        onMouseLeave={e => (e.currentTarget.style.color = c.mutedDim)}
      >{t('timer.exit')}</button>
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'transparent', border: `1px solid ${c.border}`,
          color: c.muted, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      ><IconClose size={14} /></button>
    </div>
  );

  // ── Mobile bottom sheet with accordion ──
  if (isMobile) {
    return (
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'stretch',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxHeight: '85vh',
            background: c.card, borderTop: `1px solid ${c.border}`,
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
            paddingBottom: 'env(safe-area-inset-bottom)',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 -16px 40px rgba(0,0,0,0.55)',
          }}
        >
          {/* Sticky header */}
          <div style={{
            flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.85rem 0.95rem',
            borderBottom: `1px solid ${c.border}`,
          }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: c.text }}>{t('timer.settings')}</div>
            {headerActions}
          </div>
          {/* Scroll area with accordion */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.5rem 0.85rem 1rem' }}>
            {SETTINGS_SECTIONS.map(s => {
              const open = props.mobileExpanded.has(s.id);
              return (
                <div
                  key={s.id}
                  style={{
                    background: c.cardAlt, border: `1px solid ${c.border}`,
                    borderRadius: 10, marginBottom: '0.5rem', overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => props.toggleMobileSection(s.id)}
                    aria-expanded={open}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.75rem 0.85rem',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: c.text, fontFamily: 'inherit',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
                      <span style={{ color: open ? c.accent : c.muted, display: 'inline-flex' }}>{s.icon}</span>
                      <span style={{ fontSize: '0.92rem', fontWeight: 700 }}>{t(s.labelKey)}</span>
                    </span>
                    <DisclosureChevron open={open} />
                  </button>
                  {open && (
                    <div style={{
                      padding: '0.5rem 0.85rem 0.95rem',
                      borderTop: `1px solid ${c.border}`,
                    }}>
                      {renderSection(s.id)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop: 800×560 modal with left sidebar nav ──
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(800px, 100%)', height: 'min(560px, 100%)',
          background: c.card, border: `1px solid ${c.border}`,
          borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1rem',
          borderBottom: `1px solid ${c.border}`,
        }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: c.text }}>Settings</div>
          {headerActions}
        </div>
        {/* Body: sidebar + content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <nav style={{
            flex: '0 0 220px', minWidth: 0,
            background: c.cardAlt, borderRight: `1px solid ${c.border}`,
            padding: '0.7rem 0.5rem',
            display: 'flex', flexDirection: 'column', gap: '0.2rem',
          }}>
            {SETTINGS_SECTIONS.map(s => {
              const active = props.section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => props.setSection(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.55rem 0.7rem', borderRadius: 8,
                    background: active ? c.accentDim : 'transparent',
                    border: `1px solid ${active ? c.borderHi : 'transparent'}`,
                    color: active ? c.accent : c.muted,
                    fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ display: 'inline-flex' }}>{s.icon}</span>
                  {t(s.labelKey)}
                </button>
              );
            })}
          </nav>
          <div style={{
            flex: 1, minWidth: 0,
            padding: '1.1rem 1.25rem',
            overflowY: 'auto',
          }}>
            <div style={{
              fontSize: '0.8rem', color: c.muted, fontWeight: 500,
              marginBottom: '0.85rem',
            }}>
              {(() => {
                const s = SETTINGS_SECTIONS.find(s => s.id === props.section);
                return s ? t(s.labelKey) : '';
              })()}
            </div>
            {renderSection(props.section)}
          </div>
        </div>
      </div>
    </div>
  );
}

// Reusable label + segmented options row used across Settings sections.
function SegmentedRow<T extends string>({
  label, value, onChange, options, c,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
  c: typeof C;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem', gap: '0.6rem', flexWrap: 'wrap' }}>
      <span style={{ color: c.text }}>{label}</span>
      <div style={{
        display: 'inline-flex',
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: RADIUS_SM, padding: 2, gap: 2,
      }}>
        {options.map(o => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              title={o.title}
              style={{
                padding: '0.3rem 0.7rem', borderRadius: 6,
                fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600,
                background: active ? c.cardAlt : 'transparent',
                color: active ? c.text : c.muted,
                border: `1px solid ${active ? c.borderHi : 'transparent'}`,
                cursor: 'pointer', transition: 'all 0.12s',
              }}
            >{o.label}</button>
          );
        })}
      </div>
    </div>
  );
}

function ShortcutCell({ label, kbd, c }: { label: string; kbd: string; c: typeof C }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', minWidth: 0 }}>
      <span style={{ color: c.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <kbd style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '0.7rem', fontWeight: 600,
        padding: '0.2rem 0.5rem', borderRadius: RADIUS_SM,
        background: c.cardAlt, border: 'none',
        color: c.text, whiteSpace: 'nowrap',
      }}>{kbd}</kbd>
    </div>
  );
}

function ModalShell({ title, onClose, headerAction, children }: { title?: string; onClose: () => void; headerAction?: React.ReactNode; children: React.ReactNode }) {
  // Close on ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  // Title is optional: when omitted (or empty), the header collapses to
  // just the close × in the top-right corner. Used by the Solve Detail
  // modal so the time itself is the first prominent content.
  const showTitleBar = !!title || !!headerAction;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%', maxWidth: 460,
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '1.1rem 1.25rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        {showTitleBar ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', gap: '0.5rem' }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: C.text }}>{title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              {headerAction}
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: 'transparent', border: `1px solid ${C.border}`,
                  color: C.muted, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              ><IconClose size={14} /></button>
            </div>
          </div>
        ) : (
          // Title-less variant: float a small × in the top-right corner
          // of the modal so it doesn't reserve any vertical space above
          // the content.
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: 'absolute', top: 10, right: 10,
              width: 28, height: 28, borderRadius: 7,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          ><IconClose size={14} /></button>
        )}
        {children}
      </div>
    </div>
  );
}

// Fixed-position diagnostic overlay for the QiYi BLE protocol. Shows the
// most recent N raw notification packets received from any subscribed
// characteristic, oldest at top, newest at bottom. Used to confirm "data
// IS arriving" when debugging unfamiliar firmware (e.g. QY-Timer-V2-3650)
// where the canonical parser silently drops everything.
function QiyiDebugOverlay({ packets, C: c }: { packets: QiyiPacket[]; C: typeof C }) {
  return (
    <div
      role="region"
      aria-label="QiYi raw packet log"
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)',
        left: '0.75rem',
        zIndex: 900,
        maxWidth: 'min(420px, calc(100vw - 1.5rem))',
        background: c.card,
        border: `1px solid ${c.borderHi}`,
        borderRadius: 10,
        padding: '0.55rem 0.65rem',
        boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
        fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, monospace',
        fontSize: '0.66rem',
        lineHeight: 1.45,
        color: c.text,
        pointerEvents: 'none',  // overlay shouldn't intercept timer taps
      }}
    >
      <div style={{
        fontFamily: 'inherit',
        fontSize: '0.66rem',
        fontWeight: 600,
        color: c.muted,
        marginBottom: '0.35rem',
      }}>
        QiYi DEBUG — last {packets.length}/10 packets
      </div>
      {packets.length === 0 ? (
        <div style={{ color: c.mutedDim }}>(no packets received yet — connect a timer)</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {packets.map((p, i) => {
            // UUID can be long; show last 4-byte field for compactness.
            const shortUuid = p.uuid.split('-')[0];
            return (
              <div key={`${p.ts}-${i}`} style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ color: c.muted, fontSize: '0.6rem' }}>
                  {new Date(p.ts).toLocaleTimeString()} · {shortUuid}
                </span>
                <span style={{ color: c.text, wordBreak: 'break-all' }}>{p.hex}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Slider for the long-press arming threshold (Settings → Timer → "Hold
// time"). Shown only when "Hold to start" is enabled. 200–1000 ms range
// in 50 ms increments — narrow enough to avoid accidental sub-100ms
// arms but generous enough for slow-to-press cubers.
const HOLD_TIME_MIN = 200;
const HOLD_TIME_MAX = 1000;
const HOLD_TIME_STEP = 50;
const HOLD_TIME_DEFAULT = 550;
function HoldTimeSlider({
  value,
  onChange,
  c,
}: {
  value: number;
  onChange: (n: number) => void;
  c: typeof C;
}) {
  // Track-fill percentage for the filled (primary-text) part of the track.
  const pct = Math.max(0, Math.min(100,
    ((value - HOLD_TIME_MIN) / (HOLD_TIME_MAX - HOLD_TIME_MIN)) * 100,
  ));
  const trackBg =
    `linear-gradient(to right, ${c.accent} 0%, ${c.accent} ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%)`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.6rem' }}>
        <span style={{ color: c.text }}>Hold time</span>
        <span style={{
          color: c.accent, fontWeight: 700,
          fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {value}ms
        </span>
      </div>
      <input
        type="range"
        min={HOLD_TIME_MIN}
        max={HOLD_TIME_MAX}
        step={HOLD_TIME_STEP}
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        aria-label="Hold time before timer arms"
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          width: '100%',
          height: 6,
          borderRadius: 999,
          background: trackBg,
          outline: 'none',
          cursor: 'pointer',
        }}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '0.7rem', color: c.mutedDim,
      }}>
        <span>Fast ({HOLD_TIME_MIN}ms)</span>
        <span style={{ color: value === HOLD_TIME_DEFAULT ? c.muted : c.mutedDim }}>
          WCA standard: {HOLD_TIME_DEFAULT}ms
        </span>
        <span>Slow ({HOLD_TIME_MAX}ms)</span>
      </div>
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${c.accent};
          border: 2px solid ${c.bg};
          box-shadow: 0 0 0 1px ${c.borderHi};
          cursor: pointer;
          margin-top: -6px;
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${c.accent};
          border: 2px solid ${c.bg};
          box-shadow: 0 0 0 1px ${c.borderHi};
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// BlockTimer-style colour-tile picker. Lives at the top of Settings →
// Display. Switches the active theme on tap (no save button) and uses
// inline styles for the selected ring so the tile reflects whichever
// theme is currently active — `c.accent` is the *new* theme's accent
// because Object.assign(C, …) above ran during the same render.
function ThemePicker({
  isMobile,
  themeId,
  setThemeId,
  c,
}: {
  isMobile: boolean;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  c: typeof C;
}) {
  const tileSize = isMobile ? 52 : 60;
  return (
    <div>
      <div style={{
        fontSize: '0.75rem', fontWeight: 500,
        color: c.muted, marginBottom: '0.5rem',
      }}>
        Загвар
      </div>
      <div style={{
        display: 'flex', gap: '0.5rem',
        flexWrap: isMobile ? 'nowrap' : 'wrap',
        overflowX: isMobile ? 'auto' : 'visible',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: isMobile ? '0.25rem' : 0,
      }}>
        {(Object.values(THEMES)).map(theme => {
          const active = theme.id === themeId;
          return (
            <button
              key={theme.id}
              onClick={() => setThemeId(theme.id)}
              aria-pressed={active}
              title={theme.name}
              style={{
                flex: '0 0 auto',
                display: 'inline-flex', flexDirection: 'column',
                alignItems: 'center', gap: '0.35rem',
                background: 'transparent', border: 'none',
                padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'transform 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              <span style={{
                width: tileSize, height: tileSize, borderRadius: 12,
                background: theme.preview,
                border: active ? `2px solid ${c.accent}` : '2px solid transparent',
                boxShadow: active ? `0 0 0 1px ${c.bg}` : 'none',
                display: 'block',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }} />
              <span style={{
                fontSize: '0.7rem',
                fontWeight: active ? 700 : 500,
                color: active ? c.text : c.mutedDim,
                whiteSpace: 'nowrap',
              }}>
                {theme.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
      <span style={{ color: C.text }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        style={{
          position: 'relative',
          width: 40, height: 22, borderRadius: 999,
          background: value ? C.accent : 'rgba(255,255,255,0.1)',
          border: `1px solid ${value ? C.borderHi : C.border}`,
          cursor: 'pointer', padding: 0,
          transition: 'background 0.18s, border-color 0.18s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: value ? 20 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: value ? C.bg : C.muted,
          transition: 'left 0.18s, background 0.18s',
        }} />
      </button>
    </div>
  );
}

function PenaltyRow({ penalty, onSet }: { penalty: Penalty; onSet: (p: Penalty) => void }) {
  const opts: { label: string; value: Penalty; color: string }[] = [
    { label: 'OK',  value: 'none', color: C.text   },
    { label: '+2',  value: '+2',   color: C.danger },
    { label: 'DNF', value: 'dnf',  color: C.danger },
  ];
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', gap: '0.4rem' }}
    >
      {opts.map(o => {
        const active = penalty === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onSet(o.value)}
            style={{
              padding: '0.4rem 0.85rem', borderRadius: RADIUS_SM,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              background: active ? C.cardAlt : 'transparent',
              border: `1px solid ${active ? C.borderHi : C.border}`,
              color: active ? o.color : C.muted,
              cursor: 'pointer', transition: 'all 0.12s',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Quick-action icon row that appears under the big timer display the
// moment a solve completes — but only while the most-recent solve is
// still 'none'. Once DNF or +2 is applied, the parent swaps this row
// for `UndoActionRow` so the user has a single, prominent way to back
// out. Delete opens a confirm dialog (parent handles).
function SolveActionRow({
  solve, isMobile, disabled, onDelete, onSetPenalty, onOpenComment,
}: {
  solve: Solve;
  isMobile: boolean;
  // True during the brief post-stop cooldown — the row is rendered for
  // continuity with the fade-in but absorbs no input until armed.
  disabled: boolean;
  onDelete: () => void;
  onSetPenalty: (p: '+2' | 'dnf') => void;
  onOpenComment: () => void;
}) {
  const hasComment = !!(solve.comment && solve.comment.trim());
  const size = isMobile ? 40 : 32;
  // The action row sits INSIDE the timer's tap-to-arm <section>, which
  // has its own onTouchStart/onTouchEnd that begin a new solve. Without
  // this guard, every tap on a button would also start the timer. Stop
  // propagation at the row's wrapper as a defense-in-depth net so even
  // taps on the gap area between buttons are absorbed.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      onTouchStart={stop}
      onTouchEnd={stop}
      onPointerDown={stop}
      onClick={stop}
      style={{
        display: 'flex', justifyContent: 'center',
        gap: isMobile ? '0.7rem' : '0.55rem',
        marginTop: '1.1rem',
        animation: 'pv-actionrow-fade 0.32s cubic-bezier(0.2, 0.8, 0.3, 1) both',
        pointerEvents: disabled ? 'none' : 'auto',
        opacity: disabled ? 0.3 : 1,
        transition: 'opacity 0.22s ease-out',
      }}
    >
      <ActionIconBtn
        size={size}
        title="Solve устгах (X)"
        ariaLabel="Delete solve"
        icon={<IconClose size={isMobile ? 18 : 15} />}
        onClick={onDelete}
      />
      <ActionIconBtn
        size={size}
        title="DNF (D)"
        ariaLabel="Mark DNF"
        activeColor={C.danger}
        icon={<IconBan size={isMobile ? 18 : 15} />}
        onClick={() => onSetPenalty('dnf')}
      />
      <ActionIconBtn
        size={size}
        title="+2 (2)"
        ariaLabel="Apply +2 penalty"
        activeColor={C.warn}
        icon={<IconFlag size={isMobile ? 18 : 15} />}
        onClick={() => onSetPenalty('+2')}
      />
      <ActionIconBtn
        size={size}
        title="Тайлбар (C)"
        ariaLabel="Comment"
        active={hasComment}
        activeColor={C.accent}
        icon={<IconComment size={isMobile ? 18 : 15} />}
        onClick={onOpenComment}
      />
    </div>
  );
}

function ActionIconBtn({
  size, icon, title, ariaLabel, onClick, active, activeColor,
}: {
  size: number;
  icon: React.ReactNode;
  title: string;
  ariaLabel: string;
  onClick: () => void;
  active?: boolean;
  /** Tint used for the filled/active background. Defaults to the
   *  neutral primary-text colour so the Delete button (no semantic
   *  colour) and Comment-on-hover share the same monochrome fill. */
  activeColor?: string;
}) {
  const tint = activeColor ?? C.accent;
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      // The button is rendered inside the timer's tap-to-arm section,
      // so every native touch/click event MUST stop propagating or it
      // bubbles up and starts a new solve. We block at three layers
      // (touch, pointer, click) because mobile browsers fire mixed
      // sequences depending on platform, and the cost of an extra
      // stopPropagation is nil.
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onTouchStart={(e) => {
        e.stopPropagation();
        e.currentTarget.style.transform = 'scale(0.94)';
        e.currentTarget.style.background = active ? `${tint}40` : 'rgba(255,255,255,0.12)';
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.background = active ? `${tint}26` : 'transparent';
      }}
      onTouchCancel={(e) => {
        e.stopPropagation();
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.background = active ? `${tint}26` : 'transparent';
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.style.transform = 'scale(0.94)';
        e.currentTarget.style.background = active ? `${tint}40` : 'rgba(255,255,255,0.12)';
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.background = active ? `${tint}26` : 'transparent';
      }}
      style={{
        width: size, height: size, padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8,
        background: active ? `${tint}26` : 'transparent',
        border: 'none',
        color: active ? tint : C.muted,
        fontFamily: 'inherit', cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s, transform 0.08s',
        // Suppress iOS Safari's grey tap-flash so our own scale/colour
        // feedback is the only thing the user sees on press.
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
      }}
      onMouseEnter={e => {
        if (active) return;
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        e.currentTarget.style.color = C.text;
      }}
      onMouseLeave={e => {
        if (active) return;
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = C.muted;
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {icon}
    </button>
  );
}

// ── Tools panel + shared scramble code ("Ижил холилт") UI ───────────────

type ToolsTab = 'preview' | 'shared';

// Same labels on desktop and mobile.
const TOOLS_VIEW_LABELS: Record<ToolsTab, string> = {
  preview: 'Холилтын зураг',
  shared: 'Ижил холилт',
};

/** Green "Ижил холилт is active" dot. Slow soft pulse via the
 *  .pv-active-dot keyframes in the page <style>; static when the user
 *  prefers reduced motion. */
function SharedActiveDot() {
  return (
    <span
      className="pv-active-dot"
      role="status"
      aria-label="Ижил холилт идэвхтэй"
      style={{
        display: 'inline-block', width: 7, height: 7, flexShrink: 0,
        borderRadius: '50%', background: C.success,
      }}
    />
  );
}

/** Tools-panel header: the current view's label (no chevron — hover
 *  shade + pointer are the affordance); clicking it
 *  opens a small menu to switch views (closes on outside click / Esc).
 *  Used by the desktop right panel and the mobile enlarged-preview sheet.
 *  While a shared code is active a green dot sits next to the label
 *  (whatever view is shown) and before "Ижил холилт" in the menu. */
function ToolsViewMenu({ value, onChange, sharedActive }: {
  value: ToolsTab;
  onChange: (tab: ToolsTab) => void;
  sharedActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase so Esc closes only this menu, not a surrounding sheet.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const views: ToolsTab[] = ['preview', 'shared'];
  return (
    <div ref={rootRef} className="pv-tools-menu" style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        // Same pill as the desktop event picker ("3x3x3 Cube"): shared
        // ghost-button style, same gap, same hover / open shade.
        style={{ ...ghostButtonStyle(open), gap: '0.5rem', maxWidth: '100%' }}
        onMouseEnter={e => { e.currentTarget.style.background = C.border; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = C.cardAlt; }}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {TOOLS_VIEW_LABELS[value]}
        </span>
        {sharedActive && <SharedActiveDot />}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 0.3rem)', left: 0, zIndex: 20,
            minWidth: 190,
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: RADIUS, padding: '0.25rem',
            boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
            display: 'flex', flexDirection: 'column', gap: '0.1rem',
          }}
        >
          {views.map(view => {
            const current = view === value;
            return (
              <button
                key={view}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                onClick={() => { onChange(view); setOpen(false); }}
                style={{
                  display: 'grid', gridTemplateColumns: '14px 1fr auto',
                  alignItems: 'center', gap: '0.45rem',
                  background: current ? C.cardAlt : 'transparent', border: 'none',
                  borderRadius: RADIUS_SM, padding: '0.45rem 0.55rem',
                  color: C.text, fontFamily: 'inherit', fontSize: '0.82rem',
                  fontWeight: current ? 600 : 500, textAlign: 'left', cursor: 'pointer',
                }}
                onMouseEnter={e => { if (!current) e.currentTarget.style.background = C.cardAlt; }}
                onMouseLeave={e => { if (!current) e.currentTarget.style.background = 'transparent'; }}
              >
                <span aria-hidden="true" style={{ display: 'inline-flex', justifyContent: 'center' }}>
                  {view === 'shared' && sharedActive && <SharedActiveDot />}
                </span>
                <span>{TOOLS_VIEW_LABELS[view]}</span>
                <span aria-hidden="true" style={{ display: 'inline-flex', width: 14 }}>
                  {current && <IconCheck size={13} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function copySharedCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    showToast({ msg: 'Хуулагдлаа ✓', tone: 'success' });
  } catch { /* clipboard blocked — the code is visible anyway */ }
}

/** "‹ #5 ›" stepper. Tapping "#5" turns it into a number input so a
 *  friend can jump straight to someone else's position. */
function SharedIndexControl({ index, onStep, onJump, large = false }: {
  index: number;
  onStep: (delta: number) => void;
  onJump: (index: number) => void;
  large?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 1) onJump(n);
    setEditing(false);
  };
  const fs = large ? '1rem' : '0.8rem';
  const plain: React.CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: C.text, fontFamily: '"JetBrains Mono", monospace', fontSize: fs, fontWeight: 600,
    padding: large ? '0.3rem 0.5rem' : '0.2rem 0.3rem', borderRadius: RADIUS_SM,
    display: 'inline-flex', alignItems: 'center',
  };
  const arrow = (enabled: boolean): React.CSSProperties => ({
    ...plain, fontFamily: 'inherit', fontSize: large ? '1.25rem' : '1rem', lineHeight: 1,
    padding: large ? '0.2rem 0.6rem' : '0.1rem 0.4rem',
    color: enabled ? C.text : C.mutedDim, cursor: enabled ? 'pointer' : 'default',
  });
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem', fontVariantNumeric: 'tabular-nums' }}>
      <button type="button" aria-label="Өмнөх scramble" disabled={index <= 1} onClick={() => onStep(-1)} style={arrow(index > 1)}>‹</button>
      {editing ? (
        <input
          autoFocus
          inputMode="numeric"
          aria-label="Scramble дугаар"
          value={draft}
          onChange={e => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
          }}
          onBlur={commit}
          style={{
            width: large ? '4.5rem' : '3.6rem', background: C.bg, color: C.text,
            border: `1px solid ${C.borderHi}`, borderRadius: RADIUS_SM,
            padding: '0.1rem 0.35rem', fontFamily: '"JetBrains Mono", monospace',
            fontSize: fs, outline: 'none', textAlign: 'center',
          }}
        />
      ) : (
        <button
          type="button"
          title="Дугаар руу үсрэх"
          onClick={() => { setDraft(String(index)); setEditing(true); }}
          style={plain}
        >#{index}</button>
      )}
      <button type="button" aria-label="Дараагийн scramble" onClick={() => onStep(1)} style={arrow(true)}>›</button>
    </span>
  );
}

/** "Ижил холилт" view of the tools panel. Inactive: create a random
 *  4-digit code or type one in. Active: big code (tap to copy), the
 *  ‹ #n › stepper with jump, and "Гарах". */
function SharedCodeTools({ code, index, onEnter, onLeave, onStep, onJump }: {
  code: string | null;
  index: number | null;
  onEnter: (code: string) => void;
  onLeave: () => void;
  onStep: (delta: number) => void;
  onJump: (index: number) => void;
}) {
  const [draft, setDraft] = useState('');
  const valid = isValidSharedCode(draft);
  const actionBtn = (enabled: boolean): React.CSSProperties => ({
    ...ghostButtonStyle(false),
    justifyContent: 'center',
    opacity: enabled ? 1 : 0.45,
    cursor: enabled ? 'pointer' : 'default',
  });
  const wrap: React.CSSProperties = {
    flex: 1, minWidth: 0,
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    gap: '0.7rem', padding: '0.25rem 0.35rem',
  };

  if (code && index != null) {
    return (
      <div className="pv-shared-tools" style={{ ...wrap, alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: '0.75rem', color: C.muted }}>Код</div>
        <button
          type="button"
          onClick={() => copySharedCode(code)}
          title="Код хуулах"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.text, fontFamily: '"JetBrains Mono", monospace',
            fontSize: '2.2rem', fontWeight: 700, letterSpacing: '0.12em',
            lineHeight: 1, padding: '0.1rem 0.3rem', borderRadius: RADIUS_SM,
          }}
        >{code}</button>
        <SharedIndexControl index={index} onStep={onStep} onJump={onJump} large />
        <button
          type="button"
          onClick={onLeave}
          style={{ ...ghostButtonStyle(false), background: 'transparent', color: C.muted, padding: '0.3rem 0.7rem' }}
        >Гарах</button>
      </div>
    );
  }

  return (
    <div className="pv-shared-tools" style={wrap}>
      <div style={{ fontSize: '0.75rem', color: C.muted, lineHeight: 1.45 }}>
        Ижил код оруулсан хүмүүс ижил дарааллын холилт (#1, #2, …) авна.
      </div>
      <button
        type="button"
        onClick={() => onEnter(randomSharedCode())}
        style={{ ...actionBtn(true), width: '100%' }}
      >Код үүсгэх</button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="pv-shared-code" style={{ fontSize: '0.72rem', color: C.muted }}>Код оруулах</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '0.4rem' }}>
          <input
            id="pv-shared-code"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="0000"
            value={draft}
            onChange={e => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={e => { if (e.key === 'Enter' && valid) onEnter(draft); }}
            style={{
              background: C.bg, color: C.text,
              border: `1px solid ${C.borderHi}`, borderRadius: RADIUS_SM,
              padding: '0.45rem 0.6rem', minWidth: 0, width: '100%',
              fontFamily: '"JetBrains Mono", monospace', fontSize: '1rem',
              letterSpacing: '0.2em', outline: 'none',
            }}
          />
          <button
            type="button"
            disabled={!valid}
            onClick={() => onEnter(draft)}
            style={actionBtn(valid)}
          >Нэгдэх</button>
        </div>
      </div>
    </div>
  );
}

// Swipeable scramble row used on mobile. Left swipe → next scramble
// (history's index 0 → fresh random), right swipe → previous scramble
// (older history). Threshold is intentionally generous (>50 px) so the
// solver's vertical scrolls don't accidentally rotate the scramble.
function SwipeScrambleRow({
  scramble, scrambleFontPx, onNext, onPrev,
}: {
  scramble: string;
  // Final px value — already accounts for both the scramble's character
  // count and the user's sm/md/lg preference (see getScrambleFontSize).
  scrambleFontPx: number;
  onNext: () => void;
  onPrev: () => void;
}) {
  const SWIPE_THRESHOLD = 50;
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // Soft fade during the swipe motion so the change of scramble feels
  // intentional, not jarring. Animation key changes with the scramble
  // string so the keyframe reruns each time.
  const [fadeKey, setFadeKey] = useState(0);
  const triggerFade = () => setFadeKey(k => k + 1);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    startRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (Math.abs(dx) < Math.abs(dy)) return; // mostly vertical — let it scroll
    if (dx < 0) onNext(); else onPrev();
    triggerFade();
  };
  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        margin: '0 0.7rem 0.5rem',
        padding: '0.45rem 0.6rem',
        borderRadius: 12,
        // touchAction:pan-y lets vertical scrolls through but reserves
        // horizontal pans for our swipe handler.
        touchAction: 'pan-y',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      <div
        key={fadeKey}
        className="pv-scramble-text"
        style={{
          fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
          fontSize: scrambleFontPx,
          lineHeight: 1.45,
          color: C.text,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          textAlign: 'center',
          maxWidth: '100%',
          animation: 'pv-scramble-fade 0.25s ease-out both',
        }}
      >
        {scramble}
      </div>
    </div>
  );
}

// Inline manual-entry input — sits where the big timer number would
// otherwise be when timeEntryMode === 'manual'. Uses inputMode='numeric'
// so the mobile keyboard is digits-only, and Enter / "✓" commits via
// the parent's onCommit (which runs the same parser + finishExternal
// path the legacy modal used).
function ManualInlineInput({
  value, onChange, onCommit, fontSize, isMobile,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  fontSize: string;
  isMobile: boolean;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const ref = useRef<HTMLInputElement | null>(null);
  // Live preview matching the entered digits — same parser semantics
  // as the legacy "Add Time" modal (last 2 digits = cs).
  const previewMs = parseManualTime(value);
  const placeholder = isMobile ? '12.34' : '0.00';
  return (
    <div
      onTouchStart={stop}
      onTouchEnd={stop}
      onPointerDown={stop}
      onClick={stop}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '0.6rem', width: '100%',
        pointerEvents: 'auto',
      }}
    >
      <input
        ref={ref}
        type="text"
        value={previewMs == null ? value : fmtMs(previewMs)}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit();
          }
        }}
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder={placeholder}
        aria-label="Цаг бичих"
        style={{
          width: '100%',
          background: 'transparent',
          color: previewMs == null ? C.mutedDim : C.text,
          border: 'none', outline: 'none',
          fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
          fontSize, fontWeight: 700, lineHeight: 0.95,
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'center', padding: 0,
          letterSpacing: '0.01em',
          caretColor: C.accent,
        }}
      />
    </div>
  );
}

// Single-undo row that replaces the action buttons whenever the
// most-recent solve has a non-'none' penalty. Visually quieter than the
// full action row so the big "DNF" / "+2" timer text stays the focal
// point; the user just needs an obvious way back to neutral.
function UndoActionRow({ isMobile, disabled, onUndo }: { isMobile: boolean; disabled: boolean; onUndo: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const size = isMobile ? 40 : 32;
  return (
    <div
      onTouchStart={stop}
      onTouchEnd={stop}
      onPointerDown={stop}
      onClick={stop}
      style={{
        display: 'flex', justifyContent: 'center',
        marginTop: '1.1rem',
        animation: 'pv-actionrow-fade 0.32s cubic-bezier(0.2, 0.8, 0.3, 1) both',
        pointerEvents: disabled ? 'none' : 'auto',
        opacity: disabled ? 0.3 : 1,
        transition: 'opacity 0.22s ease-out',
      }}
    >
      <ActionIconBtn
        size={size}
        title="Буцаах"
        ariaLabel="Undo"
        icon={<IconUndoArrow size={isMobile ? 18 : 15} />}
        onClick={onUndo}
      />
    </div>
  );
}

// Material-style modal shell: centered light card on a darker dimmed
// backdrop, tap-outside-to-cancel, no header bar — the title sits
// inside the card body alongside the buttons. Used for the delete
// confirmation and the comment editor so both feel like the screenshot
// reference rather than the rest of the dark-themed app chrome.
function MaterialDialog({
  width = 320, onCancel, children,
}: {
  width?: number;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
        animation: 'pv-dialog-fade 0.18s ease-out both',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: width,
          background: '#ffffff',
          color: '#222',
          borderRadius: RADIUS,
          boxShadow: '0 24px 48px rgba(0,0,0,0.55), 0 8px 16px rgba(0,0,0,0.35)',
          padding: '1.4rem 1.5rem 0.6rem',
          fontFamily: 'inherit',
          animation: 'pv-dialog-pop 0.18s cubic-bezier(0.2, 0.8, 0.3, 1) both',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function MaterialTextBtn({
  label, tone = 'neutral', autoFocus, onClick,
}: {
  label: string;
  /** neutral = grey, primary = near-black (no accent hue), danger = red. */
  tone?: 'neutral' | 'primary' | 'danger';
  autoFocus?: boolean;
  onClick: () => void;
}) {
  const color =
    tone === 'danger'  ? '#d32f2f' :
    tone === 'primary' ? '#111111' :
    '#666';
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        color, fontFamily: 'inherit', fontWeight: 600,
        fontSize: '0.85rem',
        padding: '0.55rem 0.7rem', borderRadius: RADIUS_SM,
        transition: 'background 0.12s',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >{label}</button>
  );
}

// Delete confirmation — Material-style "Solve устгах уу?" with a red
// destructive primary button. The button bar sits inside the same card
// (no separate footer) so the dialog stays compact.
function DeleteConfirmDialog({
  onCancel, onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <MaterialDialog onCancel={onCancel} width={300}>
      <div style={{
        fontSize: '1rem', fontWeight: 600, color: '#222',
        marginBottom: '1rem', lineHeight: 1.4,
      }}>
        Solve устгах уу?
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.25rem', marginRight: '-0.7rem' }}>
        <MaterialTextBtn label="Болих" onClick={onCancel} />
        <MaterialTextBtn label="Устгах" tone="danger" onClick={onConfirm} autoFocus />
      </div>
    </MaterialDialog>
  );
}

// Comment editor — Material-style dialog with the canonical underline
// text input (filled while focused, faint when blurred). Pre-filled
// with the existing comment so opening it on a solve that already has
// a note feels like editing, not appending. Empty save removes the
// comment via the parent's setSolveComment helper.
function CommentModal({
  initialComment, onCancel, onSave,
}: {
  initialComment: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState<string>(initialComment);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const isEditing = !!initialComment.trim();
  return (
    <MaterialDialog onCancel={onCancel} width={320}>
      <div style={{
        fontSize: '1rem', fontWeight: 600, color: '#222',
        marginBottom: '0.85rem', lineHeight: 1.4,
      }}>
        {isEditing ? 'Тайлбар засах' : 'Тайлбар нэмэх'}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={e => setText(e.target.value.slice(0, 280))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Тайлбар"
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSave(text);
          }
        }}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: 'transparent', color: '#222',
          border: 'none',
          borderBottom: `${focused ? '2px' : '1px'} solid ${focused ? '#111111' : 'rgba(0,0,0,0.42)'}`,
          padding: '0.4rem 0',
          fontSize: '1rem', fontFamily: 'inherit',
          outline: 'none',
          marginBottom: '0.6rem',
          transition: 'border-color 0.15s',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.25rem', marginRight: '-0.7rem' }}>
        <MaterialTextBtn label="Болих" onClick={onCancel} />
        <MaterialTextBtn label="Хадгалах" tone="primary" onClick={() => onSave(text)} autoFocus />
      </div>
    </MaterialDialog>
  );
}

function Row({ label, kbd }: { label: string; kbd: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ color: C.text }}>{label}</span>
      <kbd style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '0.72rem', fontWeight: 600,
        padding: '0.2rem 0.55rem', borderRadius: RADIUS_SM,
        background: C.cardAlt, border: 'none',
        color: C.text,
      }}>{kbd}</kbd>
    </div>
  );
}

// ── SVG icons (mobile UI) ───────────────────────────────────────────────────
type IconProps = { size?: number; strokeWidth?: number };
/** Open/closed indicator for expand-collapse sections only (Settings
 *  accordion, "Тусгай төрлүүд"): points right when closed, rotates 90°
 *  to point down when open. Popup/menu triggers deliberately have none. */
function DisclosureChevron({ open }: { open: boolean }) {
  return (
    <svg
      className="pv-disclosure-chevron"
      width={14} height={14} viewBox="0 0 24 24" fill="none"
      stroke={C.mutedDim} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{
        flexShrink: 0, display: 'block',
        transform: open ? 'rotate(90deg)' : 'none',
        transition: 'transform 0.15s ease',
      }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function IconBase({ size = 18, strokeWidth = 1.8, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block' }}
    >{children}</svg>
  );
}
function IconStopwatch(p: IconProps)  { return <IconBase {...p}><circle cx={12} cy={14} r={7}/><path d="M12 14v-3"/><path d="M9 2h6"/><path d="M12 4v3"/><path d="M19 6l-1.5 1.5"/></IconBase>; }
function IconList(p: IconProps)       { return <IconBase {...p}><path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><circle cx={4} cy={6}  r={1}/><circle cx={4} cy={12} r={1}/><circle cx={4} cy={18} r={1}/></IconBase>; }
function IconChart(p: IconProps)      { return <IconBase {...p}><path d="M4 20V4"/><path d="M4 20h16"/><path d="M7 14l3-3 3 3 4-6"/></IconBase>; }
function IconRefresh(p: IconProps)    { return <IconBase {...p}><path d="M21 12a9 9 0 0 0-15.5-6.3L3 8"/><path d="M3 4v4h4"/><path d="M3 12a9 9 0 0 0 15.5 6.3L21 16"/><path d="M21 20v-4h-4"/></IconBase>; }
function IconPencil(p: IconProps)     { return <IconBase {...p}><path d="M14.5 4.5l4 4-9.5 9.5H5v-4z"/><path d="M13 6l5 5"/></IconBase>; }
function IconPlus(p: IconProps)       { return <IconBase {...p}><path d="M12 5v14"/><path d="M5 12h14"/></IconBase>; }
function IconClose(p: IconProps)      { return <IconBase {...p}><path d="M6 6l12 12"/><path d="M18 6l-12 12"/></IconBase>; }
function IconSearch(p: IconProps)     { return <IconBase {...p}><circle cx={11} cy={11} r={6}/><path d="M20 20l-4.3-4.3"/></IconBase>; }
function IconSettings(p: IconProps)   { return <IconBase {...p}><circle cx={12} cy={12} r={3}/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></IconBase>; }
function IconCheck(p: IconProps)      { return <IconBase {...p}><path d="M5 12l5 5L20 7"/></IconBase>; }
function IconTrash(p: IconProps)      { return <IconBase {...p}><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></IconBase>; }
function IconCube(p: IconProps)       { return <IconBase {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5"/><path d="M12 12L4 7.5"/><path d="M12 12v9"/></IconBase>; }
function IconBluetooth(p: IconProps)  { return <IconBase {...p}><path d="M7 7l10 10-5 5V2l5 5L7 17"/></IconBase>; }
function IconUsers(p: IconProps)      { return <IconBase {...p}><path d="M16 11a4 4 0 1 0-4-4"/><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><circle cx={9} cy={7} r={4}/><path d="M22 21v-1a5 5 0 0 0-4-4.9"/></IconBase>; }
function IconGrid(p: IconProps)       { return <IconBase {...p}><rect x={3} y={3} width={7} height={7} rx={1.5}/><rect x={14} y={3} width={7} height={7} rx={1.5}/><rect x={3} y={14} width={7} height={7} rx={1.5}/><rect x={14} y={14} width={7} height={7} rx={1.5}/></IconBase>; }
function IconArrowRight(p: IconProps) { return <IconBase {...p}><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></IconBase>; }
function IconLock(p: IconProps)       { return <IconBase {...p}><rect x={4} y={11} width={16} height={10} rx={2}/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></IconBase>; }
function IconKeyboard(p: IconProps)   { return <IconBase {...p}><rect x={2}  y={6}  width={20} height={12} rx={2}/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M6 14h0M10 14h4M18 14h0"/></IconBase>; }
function IconPhone(p: IconProps)     { return <IconBase {...p}><rect x={7} y={2} width={10} height={20} rx={2}/><path d="M11 18h2"/></IconBase>; }
function IconPalette(p: IconProps)    { return <IconBase {...p}><path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.4 0-1.1.9-2 2-2H17a4 4 0 0 0 4-4 8 8 0 0 0-9-7.2"/><circle cx={7.5}  cy={11} r={1}/><circle cx={9.5}  cy={7}  r={1}/><circle cx={14.5} cy={7}  r={1}/><circle cx={17.5} cy={11} r={1}/></IconBase>; }
function IconBan(p: IconProps)        { return <IconBase {...p}><circle cx={12} cy={12} r={9}/><path d="M5.6 5.6l12.8 12.8"/></IconBase>; }
function IconFlag(p: IconProps)       { return <IconBase {...p}><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></IconBase>; }
function IconComment(p: IconProps)    { return <IconBase {...p}><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></IconBase>; }
function IconShareOut(p: IconProps)   { return <IconBase {...p}><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></IconBase>; }
function IconUndoArrow(p: IconProps)  { return <IconBase {...p}><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H10"/></IconBase>; }
function IconTrophy(p: IconProps)     { return <IconBase {...p}><path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M16 6h3a2 2 0 0 1-3 3"/><path d="M8 6H5a2 2 0 0 0 3 3"/><path d="M12 14v3"/><path d="M9 20h6"/><path d="M10 17h4l-1 3h-2z"/></IconBase>; }
function IconUserCircle(p: IconProps) { return <IconBase {...p}><circle cx={12} cy={12} r={9}/><circle cx={12} cy={10} r={3.2}/><path d="M5.6 19a7 7 0 0 1 12.8 0"/></IconBase>; }
function IconHelp(p: IconProps)       { return <IconBase {...p}><circle cx={12} cy={12} r={9}/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1.5 1-1.5 1.9V14"/><circle cx={12} cy={17} r={0.5} fill="currentColor"/></IconBase>; }
function IconBarChart(p: IconProps)   { return <IconBase {...p}><path d="M4 20V4"/><path d="M4 20h16"/><rect x={7}  y={12} width={3} height={6}/><rect x={12} y={8}  width={3} height={10}/><rect x={17} y={14} width={3} height={4}/></IconBase>; }

// ── Event picker (mobile) ───────────────────────────────────────────────────
// Bottom sheet that replaces the mobile <select>. Two groups: a primary
// 3-col grid of the everyday events, and a collapsible "special events"
// accordion for BLD / MBF / FMC. Tile-tap commits the choice and closes
// the sheet; backdrop / Escape close without committing.

function EventTile({
  event, active, onClick,
}: {
  event: EventDef;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.85rem 0.5rem',
        background: active ? C.cardAlt : C.card,
        border: `1px solid ${active ? C.borderHi : C.border}`,
        borderRadius: RADIUS,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '0.4rem',
        cursor: 'pointer', fontFamily: 'inherit',
        color: C.text,
        transition: 'background 0.12s, border-color 0.12s',
        minHeight: 80,
      }}
    >
      <WcaEventIcon eventId={event.id} size={28} />
      <span style={{
        fontSize: '0.72rem', fontWeight: 600,
      }}>
        {event.short}
      </span>
    </button>
  );
}

function EventPickerSheet({
  currentEventId, onSelect, onClose,
}: {
  currentEventId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  // Auto-expand the special-events accordion if the user is currently on
  // one of those events, so they can see and re-confirm their selection
  // without a second tap to expand.
  const [specialOpen, setSpecialOpen] = useState(
    SPECIAL_EVENT_IDS.includes(currentEventId),
  );
  const primaryEvents = EVENTS.filter(e => !SPECIAL_EVENT_IDS.includes(e.id));
  const specialEvents = EVENTS.filter(e => SPECIAL_EVENT_IDS.includes(e.id));

  // Capture-phase Escape so the sheet's close beats any other listener
  // wired to the same key (e.g. the hardware-keyboard cube handlers).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'stretch',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxHeight: '85vh',
          background: C.card, borderTop: `1px solid ${C.border}`,
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          paddingBottom: 'env(safe-area-inset-bottom)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -16px 40px rgba(0,0,0,0.55)',
        }}
      >
        {/* Sticky header */}
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 0.95rem',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: C.text }}>
            Төрөл сонгох
          </div>
          <button
            onClick={onClose}
            aria-label="Хаах"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          ><IconClose size={14} /></button>
        </div>

        {/* Scrollable body — primary grid + collapsible special events */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{
            padding: '0.85rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.6rem',
          }}>
            {primaryEvents.map(ev => (
              <EventTile
                key={ev.id}
                event={ev}
                active={ev.id === currentEventId}
                onClick={() => { onSelect(ev.id); onClose(); }}
              />
            ))}
          </div>

          <div style={{
            borderTop: `1px solid ${C.border}`,
            padding: '0 0.85rem 0.85rem',
          }}>
            <button
              onClick={() => setSpecialOpen(o => !o)}
              aria-expanded={specialOpen}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.85rem 0.2rem',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: C.text, fontFamily: 'inherit',
              }}
            >
              <span style={{
                fontSize: '0.78rem', fontWeight: 500,
                color: specialOpen ? C.text : C.muted,
              }}>
                Тусгай төрлүүд (BLD / FMC)
              </span>
              <DisclosureChevron open={specialOpen} />
            </button>
            {specialOpen && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.6rem',
                paddingTop: '0.2rem',
              }}>
                {specialEvents.map(ev => (
                  <EventTile
                    key={ev.id}
                    event={ev}
                    active={ev.id === currentEventId}
                    onClick={() => { onSelect(ev.id); onClose(); }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Canonical display order for the desktop dropdown list (differs from
// EVENTS' declaration order, which groups BLD/MBF/FMC together for the
// mobile sheet's "special events" accordion).
const EVENT_DROPDOWN_ORDER = [
  '333', '222', '444', '555', '666', '777',
  '333oh', '333bld', '333fm', '444bld', '555bld', '333mbf',
  'clock', 'minx', 'pyram', 'skewb', 'sq1',
];

function EventListRow({
  event, active, onClick,
}: {
  event: EventDef;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', minHeight: 32,
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0 0.7rem',
        background: active ? C.accentDim : 'transparent',
        border: 'none', borderBottom: `1px solid ${C.border}`,
        color: active ? C.accent : C.text,
        fontSize: '0.82rem', fontWeight: active ? 700 : 500,
        fontFamily: 'inherit', textAlign: 'left',
        cursor: 'pointer', transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.cardAlt; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <WcaEventIcon eventId={event.id} size={18} />
      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.name}
      </span>
      {active && <IconCheck size={14} />}
    </button>
  );
}

// Desktop counterpart to EventPickerSheet — a single-column vertical list
// of all 17 events (no grouping/accordion), rendered via a portal to
// document.body so it escapes the scramble card's stacking context
// (its blur/backdrop-filter creates one that traps a nested z-index)
// and any ancestor's overflow clipping. Positioned with `position: fixed`
// against the trigger's measured getBoundingClientRect().
function EventPickerDropdown({
  currentEventId, onSelect, onClose, triggerRect,
}: {
  currentEventId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  triggerRect: DOMRect;
}) {
  // Portals need a client-side document.body target; bail out of the
  // very first (SSR/pre-hydration) render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Capture-phase ESC so the dropdown closes ahead of any other key
  // listener (matches EventPickerSheet's behaviour).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // The trigger's rect is captured once at open time and doesn't track
  // layout changes; closing on resize (rather than repositioning) keeps
  // this simple and avoids ever showing a stale/misaligned panel.
  useEffect(() => {
    window.addEventListener('resize', onClose);
    return () => window.removeEventListener('resize', onClose);
  }, [onClose]);

  const orderedEvents = EVENT_DROPDOWN_ORDER
    .map(id => EVENTS.find(e => e.id === id))
    .filter((e): e is EventDef => !!e);

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Click-outside catcher — transparent fixed-inset backdrop sitting
          one z-layer beneath the panel itself. */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'transparent' }}
      />
      <div
        role="dialog"
        aria-label="Pick event"
        className="event-dropdown-list"
        style={{
          position: 'fixed',
          top: triggerRect.bottom + 8,
          left: triggerRect.left,
          width: 240,
          overflow: 'hidden',
          zIndex: 9999,
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}
      >
        {orderedEvents.map(ev => (
          <EventListRow
            key={ev.id}
            event={ev}
            active={ev.id === currentEventId}
            onClick={() => { onSelect(ev.id); onClose(); }}
          />
        ))}
      </div>
    </>,
    document.body,
  );
}
