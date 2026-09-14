// ── Reading a recording's real length in the browser ───────────────────
// Cloudinary used to hand this back in its upload response. R2 returns no
// metadata at all, so the length is read from the finished file itself,
// before it is uploaded.
//
// STILL AN INDEPENDENT CLOCK, which is the whole reason the field exists.
// DURATION_MISMATCH compares this against `recordingEnd`, which comes from
// the recorder's performance.now(). This number comes from the browser's
// demuxer reading the timestamps actually written into the file — a
// different clock measuring the artefact rather than the recorder's idea
// of it — so a recorder that started late still shows up as a mismatch.
//
// ── THE INFINITY PROBLEM ──
// A WebM from MediaRecorder is written as a live stream: the header is
// emitted before the recording ends, so it carries no duration, and
// Chromium reports `video.duration === Infinity` on it. The established
// workaround is to seek far past the end — the demuxer then scans to the
// last cluster, learns the real length, and fires `durationchange` /
// `timeupdate` with a finite value. Both events are handled because
// browsers differ on which one arrives.
//
// NEVER ALLOWED TO BLOCK AN UPLOAD. Bounded by a timeout, and every
// failure resolves to `undefined` — an absent duration, which the checks
// report as neutral rather than guessing.

export const DURATION_PROBE_TIMEOUT_MS = 5000;

/** Far enough past any real recording that the element must seek to the
 *  end. The conventional value for this workaround. */
const SEEK_PAST_END_S = 1e101;

/** The subset of HTMLVideoElement the probe uses — narrow so it can be
 *  driven by a fake in tests. */
export interface DurationProbeElement {
  preload: string;
  muted: boolean;
  src: string;
  readonly duration: number;
  currentTime: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  removeAttribute(name: string): void;
  load(): void;
}

export interface DurationProbeDeps {
  createElement?: () => DurationProbeElement;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  timeoutMs?: number;
}

function toMs(seconds: number): number | undefined {
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
}

/** The blob's duration in whole milliseconds, or undefined if it cannot be
 *  established within the timeout. Never rejects. */
export function probeVideoDurationMs(blob: Blob, deps: DurationProbeDeps = {}): Promise<number | undefined> {
  const createElement =
    deps.createElement ?? (() => document.createElement('video') as unknown as DurationProbeElement);
  const createObjectURL = deps.createObjectURL ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeObjectURL = deps.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));
  const timeoutMs = deps.timeoutMs ?? DURATION_PROBE_TIMEOUT_MS;

  return new Promise((resolve) => {
    let el: DurationProbeElement;
    let url: string;
    try {
      el = createElement();
      url = createObjectURL(blob);
    } catch {
      resolve(undefined);
      return;
    }

    let settled = false;
    let seeking = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listeners: [string, () => void][] = [];
    const on = (type: string, fn: () => void) => {
      el.addEventListener(type, fn);
      listeners.push([type, fn]);
    };

    const finish = (ms: number | undefined) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const [type, fn] of listeners) el.removeEventListener(type, fn);
      // Release the decoder and the blob URL either way: this element
      // exists only to be read, and a leaked object URL pins the whole
      // recording in memory for the life of the page.
      try {
        el.removeAttribute('src');
        el.load();
      } catch {
        /* already torn down */
      }
      try {
        revokeObjectURL(url);
      } catch {
        /* already revoked */
      }
      resolve(ms);
    };

    const settleIfKnown = (): boolean => {
      const ms = toMs(el.duration);
      if (ms === undefined) return false;
      finish(ms);
      return true;
    };

    timer = setTimeout(() => finish(undefined), timeoutMs);

    on('loadedmetadata', () => {
      // A file with a real duration in its header (anything not written
      // as a live stream) is done here.
      if (settleIfKnown()) return;
      // Infinity or NaN: the MediaRecorder case. Force a scan to the end.
      if (!seeking) {
        seeking = true;
        try {
          el.currentTime = SEEK_PAST_END_S;
        } catch {
          finish(undefined);
        }
      }
    });
    on('durationchange', () => {
      if (seeking) settleIfKnown();
    });
    on('timeupdate', () => {
      if (seeking) settleIfKnown();
    });
    on('error', () => finish(undefined));

    el.preload = 'metadata';
    el.muted = true;
    el.src = url;
  });
}
