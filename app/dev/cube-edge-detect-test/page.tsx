'use client';

// Standalone, isolated validation page: does contour-based quadrilateral
// detection (OpenCV.js) reliably find a cube face in a handheld live camera
// feed? Pure visual detection only — no color sampling, no perspective
// transform, no state machine, no connection to app/dev/cube-color-test.
//
// Camera lifecycle (getUserMedia setup, the request-token leak-prevention
// pattern, the init timeout + retry, the visibility-regain retry) is copied
// verbatim from that page's proven pattern rather than reinvented — see the
// comments there for the underlying reasoning (mount/unmount race, mobile
// backgrounding, etc).

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable' | 'timeout';
type OpenCvStatus = 'loading' | 'ready' | 'error';

interface Point {
  x: number;
  y: number;
}

interface QuadCandidate {
  points: [Point, Point, Point, Point];
  area: number;
}

// OpenCV.js attaches its entire API dynamically onto the loaded module at
// WASM-init time; there's no dependable, version-matched TypeScript surface
// for it (the community .d.ts files lag behind and don't cover everything
// used here), so it's typed as `any` at the call sites below rather than
// pretending to a precision the actual runtime object doesn't guarantee.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvModule = any;

// OpenCV.js is loaded via a classic <script src="/opencv.js"> tag (see the
// load effect below), not an npm package + bundler import — that package's
// module.exports is a bare native Promise, and Turbopack's CJS→ESM
// namespace-builder walks its prototype chain and auto-exposes
// Promise.prototype's then/catch/finally as fake named exports on the
// synthesized module namespace object; Turbopack's own dynamic-import
// dependency-resolution code then duck-types that namespace as thenable and
// calls .then() on it directly, throwing "incompatible receiver [object
// Module]" entirely inside Turbopack's runtime before any of our code runs.
// A classic script tag sidesteps ESM/CJS bundler interop entirely — the
// script sets `window.cv` as an ordinary global, exactly as opencv.js's own
// upstream distribution is designed to be used.
declare global {
  interface Window {
    cv: CvModule;
  }
}

const ACCENT = '#A78BFA';
const BG = '#0a0a0a';

// ── Detection tuning ─────────────────────────────────────────────────────────
// Frames are processed at a capped resolution, not the camera's native
// resolution — Canny + findContours cost scales with pixel count, and a
// phone's native frame (often 1280x720+) is far more detail than a coarse
// "is there a quad here" check needs. This is the main lever for keeping
// per-tick processing time bounded on real hardware.
const PROCESSING_MAX_DIM = 480;
const SAMPLE_INTERVAL_MS = 250; // target spacing between ticks; see the self-scheduling loop below
const MIN_AREA_FRACTION = 0.05; // candidate quad must cover at least 5% of the frame
const MAX_SIDE_RATIO = 2.2; // longest side / shortest side of the quad — rejects thin slivers
const CAMERA_INIT_TIMEOUT_MS = 10_000;

// ── Camera math (copied pattern from cube-color-test) ───────────────────────

function sideLengths(points: readonly Point[]): number[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
}

// Runs the Canny + contour + polygon-approximation pipeline once on whatever
// is currently drawn onto `canvas`, returning surviving quad candidates.
// Every intermediate cv.Mat/MatVector is explicitly `.delete()`d — OpenCV.js
// allocates on the WASM heap, which the JS garbage collector does not manage,
// so skipping this would leak memory every single tick and eventually crash
// the tab in a continuous loop like this one.
function detectQuads(cv: CvModule, canvas: HTMLCanvasElement): QuadCandidate[] {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const dilated = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const candidates: QuadCandidate[] = [];

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    // Canny output is rarely a fully closed outline — a light dilate closes
    // small gaps so findContours sees continuous boundaries instead of
    // broken segments. Without this, real-world (non-synthetic) edges
    // produce almost no usable 4-vertex contours at all.
    cv.dilate(edges, dilated, kernel);
    cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const frameArea = canvas.width * canvas.height;
    const minArea = frameArea * MIN_AREA_FRACTION;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const approx = new cv.Mat();
      try {
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

        if (approx.rows === 4) {
          const area = Math.abs(cv.contourArea(approx));
          if (area >= minArea) {
            const points = [0, 1, 2, 3].map(
              (p): Point => ({ x: approx.data32S[p * 2], y: approx.data32S[p * 2 + 1] })
            ) as [Point, Point, Point, Point];

            // "Square-ish" is checked on actual side lengths, not the
            // axis-aligned bounding box — a square viewed at an angle has a
            // skewed bounding-box aspect ratio even though its own sides
            // are still all roughly equal, so bounding-box aspect would
            // reject exactly the tilted-but-valid views we want to keep.
            const sides = sideLengths(points);
            const ratio = Math.max(...sides) / Math.min(...sides);
            if (ratio <= MAX_SIDE_RATIO) {
              candidates.push({ points, area });
            }
          }
        }
      } finally {
        approx.delete();
        contour.delete();
      }
    }
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    dilated.delete();
    kernel.delete();
    contours.delete();
    hierarchy.delete();
  }

  candidates.sort((a, b) => b.area - a.area);
  return candidates;
}

function drawQuads(canvas: HTMLCanvasElement, candidates: QuadCandidate[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#22d3ee'; // bright cyan
  candidates.forEach(({ points }) => {
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CubeEdgeDetectTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cvRef = useRef<CvModule | null>(null);
  const startCameraRequestIdRef = useRef(0);
  const cameraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopRunIdRef = useRef(0);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [cameraError, setCameraError] = useState<string>('');
  const [lastCameraError, setLastCameraError] = useState<{ name: string; message: string } | null>(null);
  const [opencvStatus, setOpencvStatus] = useState<OpenCvStatus>('loading');
  const [opencvError, setOpencvError] = useState<string>('');
  const [lastFrameMs, setLastFrameMs] = useState<number | null>(null);
  const [candidateCount, setCandidateCount] = useState<number>(0);
  const [largestCandidate, setLargestCandidate] = useState<QuadCandidate | null>(null);
  const [diagTick, setDiagTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setDiagTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  // ── OpenCV.js load ─────────────────────────────────────────────────────────
  // Classic <script> tag, not an npm import — see the header comment on the
  // `declare global { interface Window { cv } }` block above for why. The
  // script sets `window.cv` itself; once ready, we mirror it into cvRef so
  // the detection loop below reads a stable ref rather than the global on
  // every tick.
  useEffect(() => {
    if (window.cv?.calledRun) {
      cvRef.current = window.cv;
      setOpencvStatus('ready');
      return;
    }

    const script = document.createElement('script');
    script.src = '/opencv.js';
    script.async = true;
    script.onload = () => {
      const cv = window.cv;
      if (cv.calledRun) {
        cvRef.current = cv;
        setOpencvStatus('ready');
      } else {
        cv.onRuntimeInitialized = () => {
          cvRef.current = cv;
          setOpencvStatus('ready');
        };
      }
    };
    script.onerror = () => {
      setOpencvStatus('error');
      setOpencvError('Failed to load /opencv.js script');
    };
    document.body.appendChild(script);
    // Deliberately not removing the script/resetting window.cv on cleanup
    // — OpenCV.js's WASM runtime isn't cleanly re-initializable, and this
    // is a dev-only test page where leaving it cached globally across
    // remounts (e.g. React Strict Mode's double-invoke) is fine.
  }, []);

  // ── Camera lifecycle (copied pattern from cube-color-test/page.tsx) ────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    const requestId = ++startCameraRequestIdRef.current;

    setCameraStatus('requesting');
    setCameraError('');

    if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current);
    cameraTimeoutRef.current = setTimeout(() => {
      if (startCameraRequestIdRef.current === requestId) {
        setCameraStatus('timeout');
        setCameraError('Камер холбогдоход удаж байна. Дахин оролдоно уу.');
      }
    }, CAMERA_INIT_TIMEOUT_MS);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' } },
        audio: false,
      });

      if (startCameraRequestIdRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      if (cameraTimeoutRef.current) {
        clearTimeout(cameraTimeoutRef.current);
        cameraTimeoutRef.current = null;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraStatus('ready');
    } catch (err) {
      if (startCameraRequestIdRef.current !== requestId) return;
      if (cameraTimeoutRef.current) {
        clearTimeout(cameraTimeoutRef.current);
        cameraTimeoutRef.current = null;
      }
      const name = err instanceof Error ? err.name : '';
      const message = err instanceof Error ? err.message : String(err);
      setLastCameraError({ name: name || 'UnknownError', message });
      const suffix = `(${name}: ${message})`;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraStatus('denied');
        setCameraError(`Камерын зөвшөөрөл өгөгдөөгүй байна. Тохиргооноос зөвшөөрнө үү. ${suffix}`);
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraStatus('unavailable');
        setCameraError(`Камер олдсонгүй. ${suffix}`);
      } else {
        setCameraStatus('unavailable');
        setCameraError(`Камерт хандах үед алдаа гарлаа. ${suffix}`);
      }
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      startCameraRequestIdRef.current += 1;
      if (cameraTimeoutRef.current) {
        clearTimeout(cameraTimeoutRef.current);
        cameraTimeoutRef.current = null;
      }
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && cameraStatus === 'requesting') {
        startCamera();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [cameraStatus, startCamera]);

  // ── Continuous detection loop ────────────────────────────────────────────
  // Self-scheduling via setTimeout rather than setInterval: each run measures
  // its own wall-clock cost and schedules the next run relative to when THIS
  // one finished, so if OpenCV processing ever takes longer than
  // SAMPLE_INTERVAL_MS on a given device, runs never queue up or overlap —
  // the loop naturally settles to whatever cadence the hardware can sustain
  // instead of falling behind indefinitely.
  useEffect(() => {
    if (cameraStatus !== 'ready' || opencvStatus !== 'ready') return;

    const runId = ++loopRunIdRef.current;

    const tick = () => {
      if (loopRunIdRef.current !== runId) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const cv = cvRef.current;
      if (video && canvas && cv && video.videoWidth && video.videoHeight) {
        const scale = PROCESSING_MAX_DIM / Math.max(video.videoWidth, video.videoHeight);
        const w = Math.round(video.videoWidth * Math.min(1, scale));
        const h = Math.round(video.videoHeight * Math.min(1, scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);

          const start = performance.now();
          let candidates: QuadCandidate[] = [];
          try {
            candidates = detectQuads(cv, canvas);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[cube-edge-detect-test] detection error', err);
          }
          const elapsed = performance.now() - start;

          drawQuads(canvas, candidates);
          setLastFrameMs(elapsed);
          setCandidateCount(candidates.length);
          setLargestCandidate(candidates[0] ?? null);

          loopTimeoutRef.current = setTimeout(tick, Math.max(50, SAMPLE_INTERVAL_MS - elapsed));
          return;
        }
      }

      loopTimeoutRef.current = setTimeout(tick, SAMPLE_INTERVAL_MS);
    };

    tick();

    return () => {
      loopRunIdRef.current += 1;
      if (loopTimeoutRef.current) {
        clearTimeout(loopTimeoutRef.current);
        loopTimeoutRef.current = null;
      }
    };
  }, [cameraStatus, opencvStatus]);

  const videoEl = videoRef.current;
  const videoRect = videoEl?.getBoundingClientRect();
  const diagnosticsText = [
    `diagTick: ${diagTick}`,
    `cameraStatus: ${cameraStatus}`,
    `video display rect: ${videoRect ? `${Math.round(videoRect.width)} x ${Math.round(videoRect.height)}` : 'n/a'}`,
    `video native res: ${videoEl ? `${videoEl.videoWidth} x ${videoEl.videoHeight}` : 'n/a'}`,
    `lastCameraError: ${lastCameraError ? `${lastCameraError.name} — ${lastCameraError.message}` : 'none'}`,
    `opencvStatus: ${opencvStatus}${opencvError ? ` (${opencvError})` : ''}`,
    `processing res: ${canvasRef.current ? `${canvasRef.current.width} x ${canvasRef.current.height}` : 'n/a'}`,
    `lastFrameMs: ${lastFrameMs !== null ? lastFrameMs.toFixed(1) : 'n/a'}`,
    `candidateCount: ${candidateCount}`,
    `largestCandidate corners: ${
      largestCandidate
        ? largestCandidate.points.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' ')
        : 'none'
    }`,
  ].join('\n');

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: BG, color: '#ffffff' }}>
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        {/* ── Tailwind sanity check ─────────────────────────────────────── */}
        <div className="bg-red-500 text-white p-4 font-bold">
          TAILWIND TEST — should be solid red with white text
        </div>

        {/* ── Live diagnostics ─────────────────────────────────────────── */}
        <pre
          style={{
            margin: 0,
            padding: 12,
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.6,
            color: '#00ff88',
            backgroundColor: '#000000',
            border: '1px solid #333333',
            borderRadius: 8,
            whiteSpace: 'pre-wrap',
          }}
        >
          {diagnosticsText}
        </pre>

        <header>
          <h1 className="text-lg font-semibold">Куб ирмэг таних тест (OpenCV)</h1>
          <p className="text-sm text-white/50">
            Дөрвөн өнцөгт (куб тал шиг) хэлбэр илрүүлэх туршилт — өнгө уншихгүй.
          </p>
        </header>

        {/* ── Detection view ───────────────────────────────────────────────
            The one visible canvas: each tick redraws the captured frame at
            processing resolution, then strokes cyan outlines around every
            surviving quad candidate directly on top of it. */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            overflow: 'hidden',
            backgroundColor: '#000000',
          }}
        >
          {/* Video stays mounted and playing (never display:none, and never
              shrunk to a tiny footprint) — some mobile browsers pause frame
              decoding for fully hidden video elements, or downscale decode
              quality for elements rendered very small, either of which would
              silently starve or degrade the capture loop. It's kept at a
              normal on-screen footprint (matching the canvas above it) but
              visually invisible via opacity, since the canvas is the actual
              visible output. */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              pointerEvents: 'none',
            }}
          />

          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />

          {cameraStatus === 'requesting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white/70">
              Камер асааж байна...
            </div>
          )}

          {(cameraStatus === 'denied' ||
            cameraStatus === 'unavailable' ||
            cameraStatus === 'timeout') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
              <p className="text-sm text-white/70">{cameraError}</p>
              <button
                onClick={startCamera}
                className="rounded-lg px-4 py-2 text-sm font-medium text-black"
                style={{ backgroundColor: ACCENT }}
              >
                Дахин оролдох
              </button>
            </div>
          )}

          {cameraStatus === 'ready' && opencvStatus === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white/70">
              OpenCV ачаалж байна...
            </div>
          )}

          {opencvStatus === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center text-sm text-white/70">
              OpenCV ачаалахад алдаа гарлаа: {opencvError}
            </div>
          )}
        </div>

        <p className="text-xs text-white/40">
          Хөх контур бол илрүүлсэн дөрвөн өнцөгт нэр дэвшигчид. Куб талыг өөр өнцөг, зайнаас барьж
          үзээд контур хэр тогтвортой, зөв бүрхэж байгааг ажигла.
        </p>
      </div>
    </div>
  );
}
