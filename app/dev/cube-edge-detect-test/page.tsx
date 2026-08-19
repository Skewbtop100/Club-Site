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

// A single 4-vertex quad surviving the per-contour filters — a candidate
// STICKER, not a candidate face (see the header comment on detectQuads).
// `parent` is that contour's parent index from the hierarchy output
// (-1 = top level), used to group siblings; `center` is used for the 3x3
// spatial-grid check.
interface StickerCandidate extends QuadCandidate {
  parent: number;
  center: Point;
}

interface DetectionResult {
  // 4-vertex contours passing only the 4-vertex + area checks, BEFORE the
  // convexity/side-length/corner-angle quality filters — lets the
  // diagnostics panel show how aggressively those filters are rejecting
  // candidates (too strict if stickers ≈ 0 while this stays high; too
  // loose if this barely drops after filtering).
  rawQuadCount: number;
  // Raw per-contour sticker candidates surviving ALL filters, pre-grouping
  // — kept separate from `faces` so the diagnostics panel can show whether
  // the pipeline is finding shapes at all vs. finding shapes but failing
  // to group them.
  stickers: StickerCandidate[];
  // Groups of exactly 9 sticker candidates confirmed to form a clean 3x3
  // spatial grid — this is the actual detected-face output.
  faces: QuadCandidate[];
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
// per-tick processing time bounded on real hardware. Dropped from 480 to
// 320 (56% fewer pixels: 320²/480² ≈ 0.44) after a scrambled cube's many
// sticker-groove edges pushed lastFrameMs high enough at 480 to visibly
// lag video rendering — this is a coarse presence-detection pass, not
// final color sampling, so the precision tradeoff is acceptable here.
const PROCESSING_MAX_DIM = 320;
const SAMPLE_INTERVAL_MS = 250; // target spacing between ticks; see the self-scheduling loop below
// Floor on the gap between ticks, even on a fast frame — guarantees the
// main thread gets real idle time to decode/paint video between synchronous
// OpenCV calls, rather than the previous 50ms floor which let heavy frames
// re-fire almost immediately and run back-to-back. See the adaptive
// nextDelay logic in the detection loop for the "slow frame" case.
const MIN_TICK_GAP_MS = 100;
// Per-sticker area bounds, as a fraction of frame area — a single sticker
// is roughly 1/9th of a face, so this range sits well below the old
// whole-face threshold (0.05) that this replaces. Min filters out grooves/
// noise; max rejects a lone large contour (e.g. the face's own outer
// boundary) from being miscounted as one sticker — it wouldn't cluster
// into a 9-piece grid anyway, but excluding it early keeps the candidate
// list (and the grouping pass) smaller.
const MIN_STICKER_AREA_FRACTION = 0.004;
const MAX_STICKER_AREA_FRACTION = 0.2;
// Quad-quality filters, applied per-candidate after the 4-vertex + area
// checks — concepts (convexity / side-length consistency / corner-angle)
// reimplemented in TypeScript from the validated approach in the
// open-source tentone/rubix-solver project's vision.cpp (that project uses
// OpenCV C++; this is OpenCV.js), added because unstable flicker (2-3
// corners detected inconsistently) traced back to 4-vertex approximations
// from noise/highlights/groove shadows that are technically quads but
// geometrically nothing like a real square sticker.
//
// Max pairwise side-length difference, as a FRACTION of the average side
// length (not an absolute pixel value) — stickers appear at varying sizes
// depending on distance from camera, so a fixed-pixel threshold would be
// wrong at every distance except the one it was tuned at. This replaces
// the old longest/shortest-side ratio check (same underlying property,
// equal-sidedness, checked more precisely).
const SIDE_LENGTH_TOLERANCE = 0.35;
// Corner-angle tolerance band around 90°, in degrees — generous enough to
// allow moderate camera tilt/perspective skew, tight enough to reject
// clearly non-square shapes. Starting value; likely needs retuning once
// checked against real device footage (real lighting/lens distortion may
// call for a looser or tighter band than this guess).
const ANGLE_TOLERANCE = 25;
const REQUIRED_STICKER_COUNT = 9; // a face is exactly 9 stickers — no more, no less
// How tightly a 3x3 grid's rows/columns must cluster, as a fraction of the
// full spread across all 9 points on that axis — generous, since real
// camera angle/lens distortion skews grid spacing noticeably.
const GRID_CLUSTER_TOLERANCE = 0.4;
const CAMERA_INIT_TIMEOUT_MS = 10_000;

// ── Camera math (copied pattern from cube-color-test) ───────────────────────

function sideLengths(points: readonly Point[]): number[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
}

// True if the 4 side lengths are consistent with each other (a real
// sticker's sides should all be roughly equal) — false if the largest
// pairwise difference exceeds SIDE_LENGTH_TOLERANCE of the average side
// length, or if the average is ~zero (a degenerate quad — guards the
// division that would otherwise make everything "pass").
function sideLengthsAreConsistent(sides: readonly number[]): boolean {
  const avg = sides.reduce((sum, s) => sum + s, 0) / sides.length;
  if (avg < 1e-6) return false;
  let maxDiff = 0;
  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      maxDiff = Math.max(maxDiff, Math.abs(sides[i] - sides[j]));
    }
  }
  return maxDiff <= SIDE_LENGTH_TOLERANCE * avg;
}

// Interior angle in degrees at `corner`, between edges corner→prev and
// corner→next, via the standard dot-product formula
// (acos(dot(v1,v2) / (|v1|*|v2|))). Returns NaN if either edge has ~zero
// length (a degenerate vertex) — callers must check for that rather than
// let a meaningless angle silently pass.
function cornerAngleDegrees(prev: Point, corner: Point, next: Point): number {
  const v1 = { x: prev.x - corner.x, y: prev.y - corner.y };
  const v2 = { x: next.x - corner.x, y: next.y - corner.y };
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 < 1e-6 || mag2 < 1e-6) return NaN;
  const dot = v1.x * v2.x + v1.y * v2.y;
  // Floating-point error can push cos(θ) a hair outside [-1, 1], which
  // would otherwise make acos return NaN for an angle that's really just
  // ~0° or ~180° — clamp before the inverse-cosine call.
  const cos = Math.min(1, Math.max(-1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// True only if every one of the quad's 4 corners has an interior angle
// within [90 - ANGLE_TOLERANCE, 90 + ANGLE_TOLERANCE] — false if any angle
// is out of band, or degenerate (NaN, from a near-zero-length edge).
function cornerAnglesAreSquareish(points: readonly Point[]): boolean {
  return points.every((corner, i) => {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const angle = cornerAngleDegrees(prev, corner, next);
    return Number.isFinite(angle) && Math.abs(angle - 90) <= ANGLE_TOLERANCE;
  });
}

// Clusters exactly 9 scalar values (one axis — x or y — of 9 sticker-quad
// centers) into 3 groups of 3 by sorted position, then returns each value's
// cluster id (0/1/2) IN ORIGINAL ORDER — or null if the values don't split
// into 3 reasonably tight, well-separated groups (i.e. this axis isn't
// actually grid-aligned, so whatever produced these 9 shapes probably
// isn't a real 3x3 face).
function clusterInto3(values: readonly number[]): number[] | null {
  if (values.length !== REQUIRED_STICKER_COUNT) return null;

  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const sorted = order.map((i) => values[i]);
  const range = sorted[8] - sorted[0];
  if (range <= 1e-6) return null; // degenerate — all 9 at (roughly) the same position

  const groups = [sorted.slice(0, 3), sorted.slice(3, 6), sorted.slice(6, 9)];
  const maxIntraSpread = Math.max(...groups.map((g) => g[2] - g[0]));
  if (maxIntraSpread > range * GRID_CLUSTER_TOLERANCE) return null;

  const clusterIdByOriginalIndex = new Array<number>(REQUIRED_STICKER_COUNT);
  order.forEach((originalIndex, sortedPos) => {
    clusterIdByOriginalIndex[originalIndex] = Math.floor(sortedPos / 3);
  });
  return clusterIdByOriginalIndex;
}

// Given a group of sticker candidates that share a parent contour, checks
// whether they're exactly 9 and arranged in a clean 3x3 spatial grid (row
// AND column clustering must both succeed, and together must produce all
// 9 distinct (col,row) pairs — this rejects degenerate cases like all 9
// points clustering into a single column, which row/column clustering
// alone wouldn't catch). Returns the combined bounding region as the
// detected face, or null if this group isn't a valid grid.
function groupToFaceIfGrid(group: readonly StickerCandidate[]): QuadCandidate | null {
  if (group.length !== REQUIRED_STICKER_COUNT) return null;

  const colIds = clusterInto3(group.map((s) => s.center.x));
  const rowIds = clusterInto3(group.map((s) => s.center.y));
  if (!colIds || !rowIds) return null;

  const seenCells = new Set<string>();
  for (let i = 0; i < REQUIRED_STICKER_COUNT; i++) {
    seenCells.add(`${colIds[i]},${rowIds[i]}`);
  }
  if (seenCells.size !== REQUIRED_STICKER_COUNT) return null; // not a clean bijection onto the 3x3 grid

  const allPoints = group.flatMap((s) => s.points);
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    area: (maxX - minX) * (maxY - minY),
  };
}

// Runs the Canny + contour + polygon-approximation pipeline once on whatever
// is currently drawn onto `canvas`. Finds candidate STICKER quads (any
// 4-vertex, square-ish, appropriately-sized contour), then groups siblings
// under the same hierarchy parent and checks each group for a clean 3x3
// grid — only a confirmed 9-sticker grid counts as a detected FACE. A lone
// quad, however clean, is deliberately never reported as a face: that was
// the previous approach's core ambiguity (it couldn't tell "one sticker"
// from "the whole face"), and a scrambled cube's many sticker-to-sticker
// grooves produce lots of small competing quads instead of one clean
// whole-face boundary, so nothing reliably passed the old single-quad
// filters. Every intermediate cv.Mat/MatVector is explicitly `.delete()`d —
// OpenCV.js allocates on the WASM heap, which the JS garbage collector does
// not manage, so skipping this would leak memory every tick and eventually
// crash the tab in a continuous loop like this one.
function detectQuads(cv: CvModule, canvas: HTMLCanvasElement): DetectionResult {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const dilated = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const stickers: StickerCandidate[] = [];
  let rawQuadCount = 0;

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    // Canny output is rarely a fully closed outline — a light dilate closes
    // small gaps so findContours sees continuous boundaries instead of
    // broken segments. Without this, real-world (non-synthetic) edges
    // produce almost no usable 4-vertex contours at all.
    cv.dilate(edges, dilated, kernel);
    // RETR_TREE (not RETR_LIST) — we need the parent/child hierarchy to
    // group individual sticker-quad contours by shared enclosing parent,
    // not just a flat list of shapes with no structural relationship.
    cv.findContours(dilated, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

    const frameArea = canvas.width * canvas.height;
    const minArea = frameArea * MIN_STICKER_AREA_FRACTION;
    const maxArea = frameArea * MAX_STICKER_AREA_FRACTION;
    // hierarchy is a single-row Mat, 4 int32 per contour: [next, prev,
    // firstChild, parent] — flat-indexed as hierarchyData[i*4 + 3] below.
    const hierarchyData = hierarchy.data32S;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const approx = new cv.Mat();
      try {
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

        if (approx.rows === 4) {
          const area = Math.abs(cv.contourArea(approx));
          if (area >= minArea && area <= maxArea) {
            rawQuadCount++;

            const points = [0, 1, 2, 3].map(
              (p): Point => ({ x: approx.data32S[p * 2], y: approx.data32S[p * 2 + 1] })
            ) as [Point, Point, Point, Point];

            // Three quad-quality filters — reject contours that are
            // technically 4-vertex quads (noise, sticker highlights/
            // reflections, partial groove shadows) but geometrically
            // nothing like a real square sticker:
            //  1. Convex — a self-intersecting/concave "quad" is never a
            //     real sticker.
            //  2. Side-length consistency — all 4 sides roughly equal,
            //     checked as a fraction of average length so it works at
            //     any distance from camera, not just one tuned pixel size.
            //  3. Corner angles — all 4 corners close to 90°, tolerant of
            //     moderate camera tilt/perspective skew.
            const isConvex: boolean = cv.isContourConvex(approx);
            const sides = sideLengths(points);

            if (isConvex && sideLengthsAreConsistent(sides) && cornerAnglesAreSquareish(points)) {
              const parent = hierarchyData[i * 4 + 3];
              const center: Point = {
                x: (points[0].x + points[1].x + points[2].x + points[3].x) / 4,
                y: (points[0].y + points[1].y + points[2].y + points[3].y) / 4,
              };
              stickers.push({ points, area, parent, center });
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

  // Group surviving sticker candidates by shared parent contour — siblings
  // under the same enclosing boundary are the ones that could plausibly be
  // the 9 stickers of a single physical face.
  const byParent = new Map<number, StickerCandidate[]>();
  stickers.forEach((s) => {
    const list = byParent.get(s.parent);
    if (list) list.push(s);
    else byParent.set(s.parent, [s]);
  });

  const faces: QuadCandidate[] = [];
  byParent.forEach((group) => {
    const face = groupToFaceIfGrid(group);
    if (face) faces.push(face);
  });
  faces.sort((a, b) => b.area - a.area);

  return { rawQuadCount, stickers, faces };
}

function strokeQuad(ctx: CanvasRenderingContext2D, points: readonly Point[]) {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.stroke();
}

// Draws raw sticker candidates (dim amber, thin) underneath confirmed
// whole-face detections (bright cyan, thick) — the two-tier styling is a
// direct visual version of the stickerCandidateCount/candidateCount split
// in the diagnostics panel: at a glance, are we finding shapes at all
// (amber outlines present) vs. finding shapes but failing to group them
// into a 3x3 grid (amber present, no cyan)?
function drawQuads(canvas: HTMLCanvasElement, stickers: readonly QuadCandidate[], faces: readonly QuadCandidate[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)'; // dim amber
  stickers.forEach(({ points }) => strokeQuad(ctx, points));

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#22d3ee'; // bright cyan
  faces.forEach(({ points }) => strokeQuad(ctx, points));
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
  // TEMPORARY diagnostic-only counter for the progressive-degradation
  // investigation — not part of detection logic, safe to remove once the
  // investigation concludes. Counts ticks so every 20th one gets logged.
  const diagnosticTickCounterRef = useRef(0);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [cameraError, setCameraError] = useState<string>('');
  const [lastCameraError, setLastCameraError] = useState<{ name: string; message: string } | null>(null);
  const [opencvStatus, setOpencvStatus] = useState<OpenCvStatus>('loading');
  const [opencvError, setOpencvError] = useState<string>('');
  const [lastFrameMs, setLastFrameMs] = useState<number | null>(null);
  // 4-vertex quads passing only the 4-vertex + area checks, BEFORE the
  // convexity/side-length/corner-angle quality filters — compared against
  // stickerCandidateCount (AFTER those filters) to see how aggressively
  // they're rejecting candidates.
  const [rawQuadCount, setRawQuadCount] = useState<number>(0);
  // Raw per-contour sticker candidates found this tick, before grouping —
  // separate from candidateCount (confirmed 3x3-grid faces) so it's clear
  // whether the pipeline is finding shapes at all vs. finding shapes but
  // failing to group them into a face.
  const [stickerCandidateCount, setStickerCandidateCount] = useState<number>(0);
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
  // instead of falling behind indefinitely. On a slow frame (e.g. a
  // scrambled cube's many sticker-groove edges vs. a solved face's near-
  // uniform surface), the next tick backs off to at least as long as the
  // frame just took (not just the MIN_TICK_GAP_MS floor) — this was the
  // actual cause of "severe lag": synchronous OpenCV work re-firing almost
  // immediately after a slow frame left the main thread no room to
  // decode/paint video between ticks, a near-100%-duty-cycle loop rather
  // than a genuinely periodic one.
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
          let result: DetectionResult = { rawQuadCount: 0, stickers: [], faces: [] };
          try {
            result = detectQuads(cv, canvas);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[cube-edge-detect-test] detection error', err);
          }
          const elapsed = performance.now() - start;

          drawQuads(canvas, result.stickers, result.faces);
          setLastFrameMs(elapsed);
          setRawQuadCount(result.rawQuadCount);
          setStickerCandidateCount(result.stickers.length);
          setCandidateCount(result.faces.length);
          setLargestCandidate(result.faces[0] ?? null);

          // TEMPORARY — progressive-degradation investigation. Logs
          // lastFrameMs and the WASM heap's current byte length
          // (cv.HEAPU8.length — Emscripten's ALLOW_MEMORY_GROWTH heap only
          // grows, never shrinks, so an unbounded upward trend here over a
          // few minutes of continuous running is direct, hard evidence of
          // a real leak; a quick plateau is normal working-set growth).
          // Remove once the investigation concludes.
          diagnosticTickCounterRef.current++;
          if (diagnosticTickCounterRef.current % 20 === 0) {
            // eslint-disable-next-line no-console
            console.log('[cube-edge-detect-test][diag]', {
              tick: diagnosticTickCounterRef.current,
              lastFrameMs: Math.round(elapsed),
              wasmHeapBytes: cv.HEAPU8?.length ?? 'n/a',
            });
          }

          const nextDelay =
            elapsed > SAMPLE_INTERVAL_MS
              ? Math.max(MIN_TICK_GAP_MS, elapsed)
              : Math.max(MIN_TICK_GAP_MS, SAMPLE_INTERVAL_MS - elapsed);
          loopTimeoutRef.current = setTimeout(tick, nextDelay);
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
    `rawQuadCount (4-vertex+area, before quality filters): ${rawQuadCount}`,
    `stickerCandidateCount (after convexity/side/angle filters): ${stickerCandidateCount}`,
    `candidateCount (confirmed 3x3-grid faces): ${candidateCount}`,
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
          Бүдэг шар контур бол ганц наалт (стикер) нэр дэвшигч; тод хөх контур бол 9 наалт 3x3
          тор хэлбэрээр бүлэглэгдэж баталгаажсан бүхэл тал. Куб талыг өөр өнцөг, зайнаас барьж
          үзээд контур хэр тогтвортой, зөв бүрхэж байгааг ажигла.
        </p>
      </div>
    </div>
  );
}
