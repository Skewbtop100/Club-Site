// Coach challenge templates (docs/challenge-plan.md, A3 and phase 3):
// the 7 metrics, M 1–100, target-time parsing, the generated title and the
// Mongolian preview sentence, and one validator the server routes, the
// coach form and the unit tests (scripts/test-challenge.ts) all share.
//
// Pure: no firebase / React imports, so it runs on the server, in the
// browser and under plain tsc.
import type { ChallengeMetric, ChallengeTemplate } from './types/challenge';

export const METRICS: readonly ChallengeMetric[] = ['single', 'mo3', 'ao5', 'ao12', 'ao25', 'ao50', 'ao100'];

export const METRIC_LABEL: Record<ChallengeMetric, string> = {
  single: 'Single', mo3: 'Mo3', ao5: 'Ao5', ao12: 'Ao12', ao25: 'Ao25', ao50: 'Ao50', ao100: 'Ao100',
};

/** Solves per block (plan B2: N is derived from the metric). */
export const METRIC_N: Record<ChallengeMetric, number> = {
  single: 1, mo3: 3, ao5: 5, ao12: 12, ao25: 25, ao50: 50, ao100: 100,
};

/** M ("times in a row"), decision 7: any whole number ≥ 1, max 100. */
export const STREAK_MIN = 1;
export const STREAK_MAX = 100;
/** Largest target: 59:59.99. */
export const TARGET_MAX_MS = 3_599_990;
export const TITLE_MAX = 60;
export const NOTE_MAX = 300;

/** Events a challenge can use — the timer's own event ids (app/timer/page.tsx
 *  EVENTS), since phase 4 locks the timer to template.event. Fewest moves
 *  and multi-blind are left out: their result is not a single time. */
export const CHALLENGE_EVENTS: readonly { id: string; name: string; short: string }[] = [
  { id: '333',    name: '3x3x3',           short: '3x3'   },
  { id: '222',    name: '2x2x2',           short: '2x2'   },
  { id: '444',    name: '4x4x4',           short: '4x4'   },
  { id: '555',    name: '5x5x5',           short: '5x5'   },
  { id: '666',    name: '6x6x6',           short: '6x6'   },
  { id: '777',    name: '7x7x7',           short: '7x7'   },
  { id: '333oh',  name: '3x3 One-Handed',  short: '3OH'   },
  { id: '333bld', name: '3x3 Blindfolded', short: '3BLD'  },
  { id: '444bld', name: '4x4 Blindfolded', short: '4BLD'  },
  { id: '555bld', name: '5x5 Blindfolded', short: '5BLD'  },
  { id: 'pyram',  name: 'Pyraminx',        short: 'Pyra'  },
  { id: 'skewb',  name: 'Skewb',           short: 'Skewb' },
  { id: 'sq1',    name: 'Square-1',        short: 'Sq-1'  },
  { id: 'clock',  name: 'Clock',           short: 'Clock' },
  { id: 'minx',   name: 'Megaminx',        short: 'Mega'  },
];

export const challengeEvent = (id: string) => CHALLENGE_EVENTS.find(e => e.id === id);
export const isMetric = (v: unknown): v is ChallengeMetric =>
  typeof v === 'string' && (METRICS as readonly string[]).includes(v);

/**
 * Target time as typed by the coach → ms (a multiple of 10), or null.
 *   "2" → 2000, "2.5" → 2500, "2.00" → 2000, "1:05.30" → 65300,
 *   "65.3" → 65300, "2,50" → 2500 (comma as decimal point).
 * Refused: more than 2 decimals (targets are centiseconds), "1:65",
 * zero, anything over 59:59.99, and anything that isn't a time.
 */
export function parseTargetTime(input: string): number | null {
  const s = input.trim().replace(',', '.');
  let m = /^(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?$/.exec(s);
  let minutes = 0;
  let seconds: number;
  let frac: string | undefined;
  if (m) {
    minutes = Number(m[1]);
    seconds = Number(m[2]);
    frac = m[3];
    if (seconds >= 60) return null;
  } else {
    m = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    seconds = Number(m[1]);
    frac = m[2];
  }
  const cs = frac === undefined ? 0 : Number(frac.padEnd(2, '0'));
  const ms = (minutes * 60 + seconds) * 1000 + cs * 10;
  if (ms <= 0 || ms > TARGET_MAX_MS) return null;
  return ms;
}

/** ms → "2.00" / "1:05.30" — the timer's display (fmtMs, centiseconds). */
export function formatTarget(ms: number): string {
  const cs = Math.floor(ms / 10);
  const totalSec = Math.floor(cs / 100);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const c = String(cs % 100).padStart(2, '0');
  return m === 0 ? `${s}.${c}` : `${m}:${String(s).padStart(2, '0')}.${c}`;
}

type TemplateCore = Pick<ChallengeTemplate, 'event' | 'metric' | 'targetMs' | 'streak'>;

/** Generated title, plan B2: "2x2 Ao5 < 2.00 × 5". */
export function defaultTitle(t: TemplateCore): string {
  const ev = challengeEvent(t.event);
  return `${ev?.short ?? t.event} ${METRIC_LABEL[t.metric]} < ${formatTarget(t.targetMs)} × ${t.streak}`;
}

/** Plain Mongolian sentence shown to the coach and the student:
 *  "2x2x2 дээр Ao5 < 2.00-ийг 5 удаа дараалан" (M = 1 → "1 удаа"). */
export function previewSentence(t: TemplateCore): string {
  const ev = challengeEvent(t.event);
  const times = t.streak === 1 ? '1 удаа' : `${t.streak} удаа дараалан`;
  return `${ev?.name ?? t.event} дээр ${METRIC_LABEL[t.metric]} < ${formatTarget(t.targetMs)}-ийг ${times}`;
}

export type TemplateError = 'bad-event' | 'bad-metric' | 'bad-target' | 'bad-streak' | 'bad-title' | 'bad-note';

/**
 * Checks a template from a request body. Title and note are optional: an
 * empty title becomes the generated one. Whitespace is trimmed / collapsed.
 */
export function validateTemplate(raw: Record<string, unknown>):
  { ok: true; value: ChallengeTemplate } | { ok: false; error: TemplateError } {
  const { event, metric, targetMs, streak } = raw;
  if (typeof event !== 'string' || !challengeEvent(event)) return { ok: false, error: 'bad-event' };
  if (!isMetric(metric)) return { ok: false, error: 'bad-metric' };
  if (typeof targetMs !== 'number' || !Number.isInteger(targetMs) || targetMs <= 0 ||
      targetMs % 10 !== 0 || targetMs > TARGET_MAX_MS) return { ok: false, error: 'bad-target' };
  if (typeof streak !== 'number' || !Number.isInteger(streak) || streak < STREAK_MIN || streak > STREAK_MAX) {
    return { ok: false, error: 'bad-streak' };
  }
  const title = raw.title ?? '';
  const note = raw.note ?? '';
  if (typeof title !== 'string') return { ok: false, error: 'bad-title' };
  if (typeof note !== 'string') return { ok: false, error: 'bad-note' };
  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  const cleanNote = note.trim();
  if (cleanTitle.length > TITLE_MAX) return { ok: false, error: 'bad-title' };
  if (cleanNote.length > NOTE_MAX) return { ok: false, error: 'bad-note' };
  const core = { event, metric, targetMs, streak };
  return { ok: true, value: { ...core, title: cleanTitle || defaultTitle(core), note: cleanNote } };
}

/** Whether a stored title is the generated one (the edit form then leaves
 *  the title box empty, so the title keeps following the template). */
export const isDefaultTitle = (t: ChallengeTemplate) => t.title === defaultTitle(t);
