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
  // loose if this barely drops after filtering). Kept as full points (not
  // just a count) so they can also be drawn on the edge-preview debug
  // overlay — rawQuadCount is just rawQuads.length.
  rawQuads: QuadCandidate[];
  // Raw per-contour sticker candidates surviving ALL filters, pre-grouping
  // — kept separate from `faces` so the diagnostics panel can show whether
  // the pipeline is finding shapes at all vs. finding shapes but failing
  // to group them.
  stickers: StickerCandidate[];
  // Groups of exactly 9 sticker candidates confirmed to form a clean 3x3
  // spatial grid — this is the actual detected-face output.
  faces: QuadCandidate[];
  // cv.countNonZero on the post-dilate edge map — the single clearest
  // signal for "is Canny finding edges at all" vs. "edges exist but
  // findContours/approxPolyDP aren't turning them into clean quads". Near
  // 0 means the Canny thresholds (or the pre-blur) are too strict for the
  // actual scene contrast; a healthy-looking count with rawQuads still low
  // means the problem is downstream of Canny instead.
  nonZeroEdgePixels: number;
}

// Result of the ALTERNATIVE saturation-blob detection strategy (see
// detectColorBlob below) — deliberately separate from DetectionResult since
// this is a diagnostic-only second code path, not a replacement.
interface BlobResult {
  // cv.countNonZero on the post-morphological-close mask — the blob
  // analogue of nonZeroEdgePixels above: near 0 means the HSV thresholds
  // are too strict for the actual scene (nothing is registering as
  // "saturated" or "bright/white"), which is the fix lever.
  maskNonZeroPixels: number;
  // Area of the single largest contour found in the closed mask, BEFORE the
  // BLOB_MIN_AREA_FRACTION rejection — shown regardless of whether it was
  // big enough to count as a real detection, so the diagnostics panel can
  // distinguish "found a blob but too small" from "found nothing at all".
  largestContourArea: number;
  // Bounding rect of that largest contour, or null if its area fell below
  // BLOB_MIN_AREA_FRACTION of the frame (nothing cube-sized was found).
  boundingRect: { x: number; y: number; width: number; height: number } | null;
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

// ── Saturation-blob detection tuning (alternative, diagnostic-only path) ────
// A fundamentally different strategy from detectQuads above: instead of
// finding edges/grooves BETWEEN stickers, find one large connected region of
// "vivid cube color" (the whole face at once) by thresholding HSV
// saturation+value — background surfaces (walls, ceilings) are typically
// low-saturation/gray, while cube stickers are highly saturated (colored
// stickers) or high-value/low-saturation (white stickers). See
// detectColorBlob below. Runs alongside detectQuads, not instead of it.
const BLOB_SAT_MIN = 80; // S floor for the "saturated colored sticker" range, out of 255
const BLOB_SAT_VALUE_MIN = 50; // V floor for that range — excludes near-black noise/shadow
const BLOB_WHITE_SAT_MAX = 60; // S ceiling for the "white sticker" range
const BLOB_WHITE_VALUE_MIN = 180; // V floor for that range
// Morphological closing kernel, square, in pixels at the current
// PROCESSING_MAX_DIM (320) processing resolution — the key step that
// bridges the thin dark grooves between adjacent stickers, merging what
// would otherwise be 9 separate colored regions into one connected blob
// findContours can pick up as a single shape. Starting point (roughly half
// a sticker's width at 320px processing res, per REQUIRED_STICKER_COUNT's
// 3x3 layout); retune from blobMaskNonZeroPixels/blobLargestContourArea
// against real footage.
const BLOB_MORPH_KERNEL_SIZE = 15;
// Reject the largest blob if it's smaller than this fraction of the frame —
// nothing cube-sized was found (background noise, or a stray small
// saturated object).
const BLOB_MIN_AREA_FRACTION = 0.05;

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
function detectQuads(
  cv: CvModule,
  canvas: HTMLCanvasElement,
  edgePreviewCanvas: HTMLCanvasElement | null
): DetectionResult {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const dilated = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const rawQuads: QuadCandidate[] = [];
  const stickers: StickerCandidate[] = [];

  let nonZeroEdgePixels = 0;

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    // Lowered from (50, 150) — real-world sticker grooves under normal
    // indoor lighting have noticeably lower contrast than a synthetic test
    // image (no strong directional light to throw a hard shadow into the
    // groove), and the old thresholds were producing near-zero edge pixels
    // on real footage (confirmed via nonZeroEdgePixels below, added
    // specifically to check this) even though the pipeline logic itself
    // was sound. These are a starting point, not final — retune from here
    // based on the actual nonZeroEdgePixels/rawQuadCount readings.
    cv.Canny(blurred, edges, 20, 60);
    // Canny output is rarely a fully closed outline — a light dilate closes
    // small gaps so findContours sees continuous boundaries instead of
    // broken segments. Without this, real-world (non-synthetic) edges
    // produce almost no usable 4-vertex contours at all.
    cv.dilate(edges, dilated, kernel);

    // DEBUG ONLY — the clearest single signal for "is Canny finding edges
    // at all" (near 0 here means yes, the threshold/blur is the problem)
    // vs. "edges exist but aren't becoming clean quads downstream" (a
    // healthy count here with rawQuads still low points at
    // findContours/approxPolyDP/the quality filters instead).
    nonZeroEdgePixels = cv.countNonZero(dilated);

    // DEBUG ONLY — renders the post-dilate edge map (exactly what
    // findContours below actually consumes, not the raw pre-dilate Canny
    // output) to a small preview canvas, if one was provided. Answers "are
    // sticker-groove edges continuous/closed by the time contour-finding
    // runs, or broken/gappy" — must happen here, before `dilated` is
    // deleted below, since the caller never gets to touch the live Mat.
    // The raw-quad overlay (yellow) is drawn separately by the caller,
    // using the plain-JS `rawQuads` points returned below — no Mat access
    // needed for that part, so it doesn't need to happen in here too.
    // Wrapped defensively: a silent imshow failure would otherwise look
    // identical (all-black preview) to "Canny found nothing", which is
    // exactly the ambiguity nonZeroEdgePixels above is meant to resolve —
    // don't let the two failure modes get confused with each other.
    if (edgePreviewCanvas) {
      try {
        cv.imshow(edgePreviewCanvas, dilated);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[cube-edge-detect-test] cv.imshow failed', err);
      }
    }

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
            const points = [0, 1, 2, 3].map(
              (p): Point => ({ x: approx.data32S[p * 2], y: approx.data32S[p * 2 + 1] })
            ) as [Point, Point, Point, Point];

            rawQuads.push({ points, area });

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

  return { rawQuads, stickers, faces, nonZeroEdgePixels };
}

// ALTERNATIVE, diagnostic-only detection strategy — runs alongside (not
// instead of) detectQuads above. Where detectQuads looks for thin edges
// BETWEEN stickers, this looks for one large connected blob OF cube-like
// color: threshold HSV saturation+value to isolate "vivid" pixels (colored
// stickers) OR "bright, low-saturation" pixels (white stickers), then
// morphologically close the result to bridge the thin dark grooves between
// adjacent stickers into a single connected region. Tests whether a
// cluttered background (ceiling lines, doorframes — which produce more/
// stronger Canny edges than the cube's own grooves) is easier to reject via
// color than via edges. Same Mat-deletion discipline as detectQuads — every
// intermediate Mat is explicitly `.delete()`d in a finally block.
function detectColorBlob(
  cv: CvModule,
  canvas: HTMLCanvasElement,
  blobPreviewCanvas: HTMLCanvasElement | null
): BlobResult {
  const src = cv.imread(canvas); // RGBA, per cv.imread-from-canvas convention (see detectQuads' RGBA2GRAY above)
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const maskSaturated = new cv.Mat();
  const maskWhite = new cv.Mat();
  const combined = new cv.Mat();
  const closed = new cv.Mat();
  const morphKernel = cv.Mat.ones(BLOB_MORPH_KERNEL_SIZE, BLOB_MORPH_KERNEL_SIZE, cv.CV_8U);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  // cv.inRange's lower/upper bounds must be full-frame-size Mats matching
  // hsv's dimensions/type in this OpenCV.js build, NOT a bare cv.Scalar or
  // plain array the way the native C++ API accepts them — a quirk of the
  // WASM binding worth knowing before reaching for inRange again. Declared
  // here (rather than only in the try block) so the finally block below can
  // always reach them, even if hsv-dependent construction throws partway
  // through.
  let lowSaturated: CvModule | null = null;
  let highSaturated: CvModule | null = null;
  let lowWhite: CvModule | null = null;
  let highWhite: CvModule | null = null;

  let maskNonZeroPixels = 0;
  let largestContourArea = 0;
  let boundingRect: BlobResult['boundingRect'] = null;

  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    // Hue left unrestricted (0-179, OpenCV's 8-bit hue range) in both bands
    // — a colored cube sticker can be any hue, and the white-sticker band
    // is defined by low saturation, not by hue at all.
    lowSaturated = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, BLOB_SAT_MIN, BLOB_SAT_VALUE_MIN, 0]);
    highSaturated = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [179, 255, 255, 255]);
    cv.inRange(hsv, lowSaturated, highSaturated, maskSaturated);

    lowWhite = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 0, BLOB_WHITE_VALUE_MIN, 0]);
    highWhite = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [179, BLOB_WHITE_SAT_MAX, 255, 255]);
    cv.inRange(hsv, lowWhite, highWhite, maskWhite);

    cv.bitwise_or(maskSaturated, maskWhite, combined);

    // The key step: bridges the thin dark grooves between adjacent stickers
    // so what would otherwise be 9 separate colored regions merge into one
    // connected blob.
    cv.morphologyEx(combined, closed, cv.MORPH_CLOSE, morphKernel);

    maskNonZeroPixels = cv.countNonZero(closed);

    // DEBUG ONLY — post-close binary mask preview, mirrors the edge-preview
    // pattern in detectQuads above (must happen here, before `closed` is
    // deleted — the caller never gets to touch the live Mat).
    if (blobPreviewCanvas) {
      try {
        cv.imshow(blobPreviewCanvas, closed);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[cube-edge-detect-test] blob cv.imshow failed', err);
      }
    }

    // RETR_EXTERNAL, not RETR_TREE — this strategy wants only the outer
    // boundary of the single largest blob, no parent/child grouping needed
    // (unlike detectQuads, which groups sticker siblings by hierarchy).
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      try {
        const area = cv.contourArea(contour);
        if (area > largestContourArea) {
          largestContourArea = area;
          const rect = cv.boundingRect(contour);
          boundingRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
      } finally {
        contour.delete();
      }
    }

    const frameArea = canvas.width * canvas.height;
    if (largestContourArea < frameArea * BLOB_MIN_AREA_FRACTION) {
      boundingRect = null;
    }
  } finally {
    src.delete();
    rgb.delete();
    hsv.delete();
    maskSaturated.delete();
    maskWhite.delete();
    combined.delete();
    closed.delete();
    morphKernel.delete();
    contours.delete();
    hierarchy.delete();
    lowSaturated?.delete();
    highSaturated?.delete();
    lowWhite?.delete();
    highWhite?.delete();
  }

  return { maskNonZeroPixels, largestContourArea, boundingRect };
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

// DEBUG ONLY — draws every raw 4-vertex contour (before the convexity/
// side-length/corner-angle quality filters) in one color, on top of the
// edge-preview canvas that detectQuads already painted with the post-dilate
// Canny output. `rawQuads`' points are in the same native coordinate space
// cv.imshow drew the preview at (both come from the same processing-
// resolution `canvas`/`dilated` Mat), so no scaling is needed — plain 1:1
// overlay. Answers, visually: are grooves producing continuous closed
// lines that findContours turns into 4-vertex shapes at all (yellow quads
// visible, however messy) vs. Canny/dilate not finding usable edges in the
// first place (no yellow quads at all)?
function drawRawQuadOverlay(canvas: HTMLCanvasElement, rawQuads: readonly QuadCandidate[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)'; // dim yellow
  rawQuads.forEach(({ points }) => strokeQuad(ctx, points));
}

// DEBUG ONLY — draws the saturation-blob strategy's detected bounding rect
// directly on the main camera view, in bright magenta — deliberately
// distinct from the existing cyan (confirmed face)/amber (raw sticker
// candidate)/yellow (raw quad overlay) Canny-based colors, so the two
// independent detection strategies can be visually compared on the same
// frame at a glance.
function drawBlobRect(canvas: HTMLCanvasElement, rect: BlobResult['boundingRect']) {
  if (!rect) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ff00ff'; // bright magenta
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CubeEdgeDetectTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // DEBUG ONLY — small preview showing the post-dilate Canny edge map plus
  // raw 4-vertex contour outlines, so we can see whether sticker grooves
  // are being detected as continuous closed edges at all vs. found but
  // failing to become clean quads afterward. See detectQuads/
  // drawRawQuadOverlay above.
  const edgePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  // DEBUG ONLY — small preview showing the post-morphological-close
  // saturation/value mask from the ALTERNATIVE detectColorBlob strategy
  // below (a separate, diagnostic-only code path from detectQuads/
  // edgePreviewCanvasRef above — both run every tick for side-by-side
  // comparison).
  const blobPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cvRef = useRef<CvModule | null>(null);
  const startCameraRequestIdRef = useRef(0);
  const cameraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopRunIdRef = useRef(0);
  // TEMPORARY diagnostic-only state for the progressive-degradation
  // investigation — not part of detection logic, safe to remove once the
  // investigation concludes. Counts ticks so every 20th one gets sampled.
  const diagnosticTickCounterRef = useRef(0);
  // Rolling window of the last ~20 ticks' raw elapsed times, for
  // avgFrameMsRecent below — a single tick's lastFrameMs bounces around too
  // much to compare reliably across screenshots taken minutes apart.
  const recentFrameMsRef = useRef<number[]>([]);
  // Captured once, on the first 20-tick sample — lets the panel show the
  // delta from session start, which is the actually meaningful signal, not
  // the absolute heap size.
  const wasmHeapMBAtStartRef = useRef<number | null>(null);

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
  // cv.countNonZero on the post-dilate edge map — near 0 means Canny/blur
  // are too strict for the actual scene contrast (the fix lever); a
  // healthy count with rawQuadCount still low means the problem is
  // downstream (findContours/approxPolyDP/quality filters instead).
  const [nonZeroEdgePixels, setNonZeroEdgePixels] = useState<number>(0);
  // Raw per-contour sticker candidates found this tick, before grouping —
  // separate from candidateCount (confirmed 3x3-grid faces) so it's clear
  // whether the pipeline is finding shapes at all vs. finding shapes but
  // failing to group them into a face.
  const [stickerCandidateCount, setStickerCandidateCount] = useState<number>(0);
  const [candidateCount, setCandidateCount] = useState<number>(0);
  const [largestCandidate, setLargestCandidate] = useState<QuadCandidate | null>(null);
  const [diagTick, setDiagTick] = useState(0);
  // TEMPORARY — progressive-degradation investigation (see the tick handler
  // below). Surfaced in the on-screen diagnostics panel, not just
  // console.log, so this can be checked via a phone screenshot without USB
  // debugging: take one screenshot at session start, another a few minutes
  // later, and compare wasmHeapMB / avgFrameMsRecent between the two.
  const [wasmHeapMB, setWasmHeapMB] = useState<number | null>(null);
  const [avgFrameMsRecent, setAvgFrameMsRecent] = useState<number | null>(null);
  // ALTERNATIVE saturation-blob strategy diagnostics — see BlobResult/
  // detectColorBlob above. Separate state from the Canny-path fields above
  // so both strategies' results are visible simultaneously for comparison.
  const [blobMaskNonZeroPixels, setBlobMaskNonZeroPixels] = useState<number>(0);
  const [blobLargestContourArea, setBlobLargestContourArea] = useState<number>(0);
  const [blobBoundingRect, setBlobBoundingRect] = useState<BlobResult['boundingRect']>(null);

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
          let result: DetectionResult = { rawQuads: [], stickers: [], faces: [], nonZeroEdgePixels: 0 };
          try {
            result = detectQuads(cv, canvas, edgePreviewCanvasRef.current);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[cube-edge-detect-test] detection error', err);
          }
          const elapsed = performance.now() - start;

          drawQuads(canvas, result.stickers, result.faces);
          // DEBUG ONLY — overlay raw-quad outlines on top of the edge
          // preview detectQuads already painted via cv.imshow. Must happen
          // after detectQuads returns, since it draws using the plain-JS
          // points (no Mat access needed), same split as drawQuads above.
          if (edgePreviewCanvasRef.current) {
            drawRawQuadOverlay(edgePreviewCanvasRef.current, result.rawQuads);
          }
          setLastFrameMs(elapsed);
          setRawQuadCount(result.rawQuads.length);
          setNonZeroEdgePixels(result.nonZeroEdgePixels);
          setStickerCandidateCount(result.stickers.length);
          setCandidateCount(result.faces.length);
          setLargestCandidate(result.faces[0] ?? null);

          // ALTERNATIVE saturation-blob strategy — runs as an ADDITIONAL
          // computation alongside the Canny path above, not instead of it,
          // so both results are visible simultaneously for comparison. Its
          // own try/catch mirrors detectQuads' above: a failure here must
          // not prevent the Canny-path results already computed from being
          // applied.
          let blobResult: BlobResult = { maskNonZeroPixels: 0, largestContourArea: 0, boundingRect: null };
          try {
            blobResult = detectColorBlob(cv, canvas, blobPreviewCanvasRef.current);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[cube-edge-detect-test] blob detection error', err);
          }
          drawBlobRect(canvas, blobResult.boundingRect);
          setBlobMaskNonZeroPixels(blobResult.maskNonZeroPixels);
          setBlobLargestContourArea(blobResult.largestContourArea);
          setBlobBoundingRect(blobResult.boundingRect);

          // TEMPORARY — progressive-degradation investigation. Tracks
          // lastFrameMs and the WASM heap's current byte length
          // (cv.HEAPU8.length — Emscripten's ALLOW_MEMORY_GROWTH heap only
          // grows, never shrinks, so an unbounded upward trend here over a
          // few minutes of continuous running is direct, hard evidence of
          // a real leak; a quick plateau is normal working-set growth).
          // Surfaced in the on-screen diagnostics panel (see wasmHeapMB /
          // avgFrameMsRecent below) as well as the console, since checking
          // devtools on a phone is impractical — a screenshot at session
          // start and another a few minutes later is enough to compare.
          // Remove all of this once the investigation concludes.
          recentFrameMsRef.current.push(elapsed);
          if (recentFrameMsRef.current.length > 20) recentFrameMsRef.current.shift();

          diagnosticTickCounterRef.current++;
          if (diagnosticTickCounterRef.current % 20 === 0) {
            const avgRecent =
              recentFrameMsRef.current.reduce((sum, v) => sum + v, 0) / recentFrameMsRef.current.length;
            const heapBytes: number | undefined = cv.HEAPU8?.length;
            const heapMB = typeof heapBytes === 'number' ? heapBytes / (1024 * 1024) : null;
            if (heapMB !== null && wasmHeapMBAtStartRef.current === null) {
              wasmHeapMBAtStartRef.current = heapMB;
            }
            setAvgFrameMsRecent(avgRecent);
            setWasmHeapMB(heapMB);

            // eslint-disable-next-line no-console
            console.log('[cube-edge-detect-test][diag]', {
              tick: diagnosticTickCounterRef.current,
              lastFrameMs: Math.round(elapsed),
              avgFrameMsRecent: Math.round(avgRecent),
              wasmHeapMB: heapMB !== null ? heapMB.toFixed(1) : 'n/a',
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
  // TEMPORARY — progressive-degradation investigation. See the tick handler
  // above for how these are sampled (every 20 ticks) and what they mean.
  const wasmHeapAtStart = wasmHeapMBAtStartRef.current;
  const wasmHeapDelta =
    wasmHeapMB !== null && wasmHeapAtStart !== null ? wasmHeapMB - wasmHeapAtStart : null;
  const diagnosticsText = [
    `diagTick: ${diagTick}`,
    `cameraStatus: ${cameraStatus}`,
    `video display rect: ${videoRect ? `${Math.round(videoRect.width)} x ${Math.round(videoRect.height)}` : 'n/a'}`,
    `video native res: ${videoEl ? `${videoEl.videoWidth} x ${videoEl.videoHeight}` : 'n/a'}`,
    `lastCameraError: ${lastCameraError ? `${lastCameraError.name} — ${lastCameraError.message}` : 'none'}`,
    `opencvStatus: ${opencvStatus}${opencvError ? ` (${opencvError})` : ''}`,
    `processing res: ${canvasRef.current ? `${canvasRef.current.width} x ${canvasRef.current.height}` : 'n/a'}`,
    `lastFrameMs: ${lastFrameMs !== null ? lastFrameMs.toFixed(1) : 'n/a'}`,
    `avgFrameMsRecent (rolling avg, last ~20 ticks): ${avgFrameMsRecent !== null ? avgFrameMsRecent.toFixed(1) : 'n/a'}`,
    `wasmHeapMB: ${
      wasmHeapMB !== null && wasmHeapAtStart !== null && wasmHeapDelta !== null
        ? `${wasmHeapMB.toFixed(1)} (started at ${wasmHeapAtStart.toFixed(1)}, ${wasmHeapDelta >= 0 ? '+' : ''}${wasmHeapDelta.toFixed(1)})`
        : 'n/a (waiting for first 20-tick sample)'
    }`,
    `nonZeroEdgePixels (post-dilate; near-0 = Canny/blur too strict): ${nonZeroEdgePixels}`,
    `rawQuadCount (4-vertex+area, before quality filters): ${rawQuadCount}`,
    `stickerCandidateCount (after convexity/side/angle filters): ${stickerCandidateCount}`,
    `candidateCount (confirmed 3x3-grid faces): ${candidateCount}`,
    `largestCandidate corners: ${
      largestCandidate
        ? largestCandidate.points.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' ')
        : 'none'
    }`,
    `--- саарал/өнгөний blob (alt strategy) ---`,
    `blobMaskNonZeroPixels (post-close mask; near-0 = HSV thresholds too strict): ${blobMaskNonZeroPixels}`,
    `blobLargestContourArea (before min-area rejection): ${Math.round(blobLargestContourArea)}`,
    `blobBoundingRect: ${
      blobBoundingRect
        ? `x=${blobBoundingRect.x} y=${blobBoundingRect.y} w=${blobBoundingRect.width} h=${blobBoundingRect.height}`
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

        {/* ── DEBUG: edge preview ─────────────────────────────────────────
            Temporary diagnostic-only addition — not part of the actual
            detection UI. White lines = post-dilate Canny edge map (exactly
            what findContours consumes below); dim yellow outlines = every
            raw 4-vertex contour BEFORE the convexity/side/angle quality
            filters. Answers: are sticker-groove edges even coming through
            as continuous/closed lines Canny+dilate can produce quads from,
            or is that the actual bottleneck (vs. quads existing but the
            quality filters rejecting them, which rawQuadCount vs.
            stickerCandidateCount in the diagnostics panel already shows)?

            Was rendering entirely black on-device despite nonZeroEdgePixels
            confirming real edge content — investigated cv.imshow's actual
            implementation (pulled straight from public/opencv.js, not
            guessed) and confirmed it correctly sets canvas.width/height to
            match the Mat every call and paints via putImageData, so a
            resolution mismatch alone can't produce solid black (only
            distorted scaling). Couldn't fully confirm the root cause
            without a live device, so per the investigation's own fallback:
            enlarged significantly (width:'100%', matching the main video
            preview above, height omitted so the canvas scales by its own
            intrinsic aspect ratio instead of a hardcoded 200x150 box that
            may not match the camera's actual aspect) and added a bright
            red border so the element's real presence/size in the layout is
            visually unmistakable in a screenshot even if cv.imshow's
            content still isn't. Shrink back down once the black-preview
            bug is confirmed fixed. */}
        <div>
          {/* TEMPORARY — unconditional, cv-independent marker. If this lime
              box is NOT visible on-device, the whole edge-preview section
              isn't reaching the DOM at all (a mounting/deployment problem,
              not a canvas/cv.imshow problem) — remove once that's settled. */}
          <div
            style={{
              backgroundColor: 'lime',
              color: 'black',
              padding: '12px',
              fontWeight: 'bold',
              fontSize: '16px',
            }}
          >
            MARKER: If you see this lime box, this section of the page IS mounting correctly.
          </div>
          <p className="mb-1 text-xs text-white/50">
            Ирмэгийн зураг (Canny+dilate, findContours-д ордог өгөгдөл) — шар зураас: чанарын
            шүүлтүүрээс өмнөх дөрвөн өнцөгт бүгд
          </p>
          <canvas
            ref={edgePreviewCanvasRef}
            style={{
              display: 'block',
              width: '100%',
              borderRadius: 8,
              // TEMPORARY — bright red 2px border to visually confirm this
              // canvas element itself is present/sized in the layout,
              // independent of whether cv.imshow's content is visible
              // inside it. Revert to the subtle
              // `1px solid rgba(255,255,255,0.1)` border once resolved.
              border: '2px solid red',
              backgroundColor: '#000000',
              imageRendering: 'pixelated',
            }}
          />
        </div>

        {/* ── DEBUG: saturation-blob preview (ALTERNATIVE strategy) ────────
            Diagnostic-only, separate code path from the Canny/contour
            approach above — does not replace it. White = pixels that passed
            the saturated-OR-white HSV threshold and survived the
            morphological close (see detectColorBlob); the main camera view
            above overlays this strategy's detected bounding rect in bright
            magenta, distinct from the cyan/amber/yellow Canny-based
            overlays, so both strategies can be compared on the same
            frame. */}
        <div>
          <p className="mb-1 text-xs text-white/50">
            Өнгөний ханд blob (саарал дэвсгэр, тод шоо) — цагаан: ханд+гэрэлтэлт босго давсан ба
            morphological close-оор нэгдсэн пиксел
          </p>
          <canvas
            ref={blobPreviewCanvasRef}
            style={{
              display: 'block',
              width: '100%',
              borderRadius: 8,
              border: '2px solid magenta',
              backgroundColor: '#000000',
              imageRendering: 'pixelated',
            }}
          />
        </div>

        <p className="text-xs text-white/40">
          Бүдэг шар контур бол ганц наалт (стикер) нэр дэвшигч; тод хөх контур бол 9 наалт 3x3
          тор хэлбэрээр бүлэглэгдэж баталгаажсан бүхэл тал. Ягаан (magenta) тэгш өнцөгт бол
          өнгөний ханд blob стратегийн илрүүлсэн бүс. Куб талыг өөр өнцөг, зайнаас барьж үзээд
          контур хэр тогтвортой, зөв бүрхэж байгааг ажигла.
        </p>
      </div>
    </div>
  );
}
