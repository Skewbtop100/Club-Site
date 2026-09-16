'use client';

// ── TEMPORARY: iOS recording diagnostics ────────────────────────────────
// REMOVE WITH THE iOS RECORDING FIX. This file, its import in
// useSolveRecorder, the /online-competition/debug/recording page, and the
// relaxed assertion in tests/solve-flow/run-protection.test.cjs all go
// together — search for TEMP-IOS-RECORDING-DIAG.
//
// WHY IT EXISTS: on iOS Safari a run reaches the end with an empty clip,
// and Safari on a phone has no console to watch. So every line is written
// twice: to console.info (for a Mac's Web Inspector, if one is to hand) and
// to a ring buffer in this device's localStorage, which the debug page
// reads back, copies and shares from the phone itself.
//
// IT MUST NOT CHANGE WHAT IT OBSERVES. Every function here swallows its own
// failures and returns nothing the recorder acts on: a full or disabled
// localStorage (private browsing) loses log lines, never a recording. And
// nothing leaves the device — there is no network call anywhere in this
// file; the athlete or admin chooses to share the text.

const KEY = 'khorom.recdiag.v1';
/** Enough for several complete runs: a run writes roughly 40-60 lines. */
const MAX_LINES = 600;

export interface RecDiagLine {
  /** Wall clock, for reading across runs. */
  at: string;
  /** performance.now(), for intervals within one page load. */
  t: number;
  event: string;
  data?: unknown;
}

/** An Error or DOMException as plain data — JSON.stringify drops both. */
export function errorInfo(e: unknown): { name: string; message: string } {
  if (e && typeof e === 'object') {
    const o = e as { name?: unknown; message?: unknown };
    return { name: String(o.name ?? 'Error'), message: String(o.message ?? e) };
  }
  return { name: 'thrown', message: String(e) };
}

/** A track's identity and live state, including getSettings(). */
export function trackInfo(track: MediaStreamTrack | null | undefined): unknown {
  if (!track) return null;
  let settings: unknown = null;
  try {
    settings = track.getSettings();
  } catch (e) {
    settings = { getSettingsThrew: errorInfo(e) };
  }
  return {
    kind: track.kind,
    label: track.label,
    readyState: track.readyState,
    enabled: track.enabled,
    muted: track.muted,
    constructor: track.constructor?.name ?? null,
    settings,
  };
}

/** isTypeSupported for every container this investigation cares about. */
export function mimeSupport(): Record<string, boolean | string> {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=hvc1',
  ];
  const out: Record<string, boolean | string> = {};
  for (const type of types) {
    try {
      out[type] = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type);
    } catch (e) {
      out[type] = `threw ${errorInfo(e).name}`;
    }
  }
  return out;
}

/** The device, once per camera session. */
export function environmentInfo(): unknown {
  try {
    return {
      userAgent: navigator.userAgent,
      platform: (navigator as { platform?: string }).platform ?? null,
      maxTouchPoints: navigator.maxTouchPoints,
      visibility: document.visibilityState,
      hasMediaRecorder: typeof MediaRecorder !== 'undefined',
      hasCanvasCaptureStream:
        typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype,
      devicePixelRatio: window.devicePixelRatio,
    };
  } catch (e) {
    return { environmentThrew: errorInfo(e) };
  }
}

export function recDiag(event: string, data?: unknown): void {
  const line: RecDiagLine = {
    at: new Date().toISOString(),
    t: Math.round(typeof performance !== 'undefined' ? performance.now() : 0),
    event,
    ...(data === undefined ? {} : { data }),
  };
  try {
    console.info('[TEMP-IOS-RECORDING-DIAG]', event, data ?? '');
  } catch {
    /* nothing to do */
  }
  try {
    const raw = localStorage.getItem(KEY);
    const lines: RecDiagLine[] = raw ? JSON.parse(raw) : [];
    lines.push(line);
    localStorage.setItem(KEY, JSON.stringify(lines.slice(-MAX_LINES)));
  } catch {
    /* storage full, disabled or unparsable — lose the line, never the run */
  }
}

export function readRecDiag(): RecDiagLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecDiagLine[]) : [];
  } catch {
    return [];
  }
}

export function clearRecDiag(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
