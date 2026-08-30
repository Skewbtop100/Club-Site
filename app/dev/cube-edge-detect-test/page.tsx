'use client';

// Full detect→sample→classify pipeline test page: does saturation-based
// blob detection (see detectColorBlob below) reliably find a cube face in a
// handheld live camera feed with NO manual alignment, then classify its 9
// stickers via the same proven HSV sampling/classification logic validated
// in app/dev/cube-color-test/page.tsx (ported here — see the "ported from
// cube-color-test" sections below)? Two-face sequential capture (white,
// green), auto-lock on stability — same UX pattern as cube-color-test, just
// triggered off an auto-detected region instead of a fixed guide box.
//
// The earlier Canny/contour-based quad detection (detectQuads and its
// helper functions/types below) is kept in the file as dead reference code
// — it struggled with cluttered backgrounds (ceiling lines, doorframes)
// producing more/stronger edges than the cube's own sticker grooves, and
// with reliably finding all 9 individual sticker quads — but is no longer
// wired into the detection loop or UI; detectColorBlob's saturation-blob
// approach replaced it as the active strategy after on-device validation.
//
// Camera lifecycle (getUserMedia setup, the request-token leak-prevention
// pattern, the init timeout + retry, the visibility-regain retry) is copied
// verbatim from cube-color-test's proven pattern rather than reinvented —
// see the comments there for the underlying reasoning (mount/unmount race,
// mobile backgrounding, etc).

import type { RefObject } from 'react';
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
  // Bounding rect of the selected candidate contour, or null if nothing
  // cleared the area threshold, or everything that did was rejected by the
  // aspect-ratio/edge-touching filters below (see BLOB_MAX_ASPECT_RATIO /
  // BLOB_EDGE_TOUCH_TOLERANCE_PX).
  boundingRect: { x: number; y: number; width: number; height: number } | null;
  // Count of contours that cleared the min-area threshold but were then
  // rejected by the aspect-ratio or edge-touching filters (e.g. a wall/
  // doorframe blob) — lets the diagnostics panel show whether those filters
  // are doing meaningful work or rarely triggering.
  rejectedCandidates: number;
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

// ── Ported color-sampling types (from app/dev/cube-color-test/page.tsx) ────
// This page is now the active development target for the full detect→
// sample→classify pipeline, so the proven sampling/classification types
// (and the constants/functions ported alongside them further below) are
// copied here as the source of truth going forward, rather than importing
// across dev pages or reinventing them. cube-color-test/page.tsx itself is
// left untouched — see its own comments for the original derivation.
type CubeColorName = 'white' | 'yellow' | 'red' | 'orange' | 'blue' | 'green';

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface HSV {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

interface HsvRange {
  h: number; // reference hue center, 0-360 (ignored for white, which is graded on low saturation)
  s: number; // reference saturation center, 0-100
  v: number; // reference value/brightness center, 0-100
}

interface SampleResult {
  rgb: RGB;
  hsv: HSV;
  classified: CubeColorName;
  // Canvas-buffer coordinates — the same processing-resolution `canvas`
  // detectColorBlob runs on — the sample was taken from, kept so the debug
  // overlay can draw a dot at the exact point that was read. Unlike
  // cube-color-test's version of this type, these are NOT native-video
  // coordinates requiring a display→native mapping: sampling here reads
  // directly from the already-downscaled processing canvas, so no separate
  // coordinate space exists to map between.
  x: number;
  y: number;
  // True for the center cell, whose color is assumed from which capture
  // step this is (never sampled from the camera) — see
  // sampleNineCellsFromRect below.
  isFixed: boolean;
}

// Two-face capture sequence: capture one face, immediately capture a second
// (no re-init needed — the camera stream stays mounted throughout), then
// show both results together. Deliberately generic ("first"/"second") since
// this page doesn't hardcode which physical face the user shows first — see
// the fixedCenterColor mapping in the detection loop below.
type CaptureStep = 'first' | 'second' | 'done';

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
// Max accepted bounding-rect aspect ratio (long side / short side, always
// normalized to ≥1) — a hand-held cube face viewed roughly straight-on is
// close to square (≈1.0); a plain white wall/doorframe segment that clears
// the "white sticker" S/V range is typically much wider or taller than it
// is deep, so this rejects it without needing to distinguish wall-white
// from sticker-white by color alone. Added after an on-device false
// positive locked onto a bright doorframe instead of the cube.
const BLOB_MAX_ASPECT_RATIO = 1.4;
// A candidate blob is rejected if its bounding rect touches this many (or
// more) of the frame's 4 edges — walls/doors that fill much of the frame
// typically run off multiple edges, while a hand-held cube centered in
// frame typically touches none. Secondary heuristic alongside the
// aspect-ratio filter above, since a wall segment can occasionally still
// look roughly square (e.g. a door panel) while still clearly running off
// the frame.
const BLOB_EDGE_TOUCH_MIN_COUNT = 3;
// Pixel tolerance for "touching" a frame edge — exact 0-pixel alignment
// isn't required for this to be a useful heuristic, not a hard geometric
// guarantee.
const BLOB_EDGE_TOUCH_TOLERANCE_PX = 2;

// ── Sampling / classification tuning (ported from cube-color-test) ─────────
// These are the "centers" each sample is compared against. Hue distance is
// weighted much more heavily than saturation/value distance since ambient
// lighting swings brightness and saturation around a lot more than it
// swings the underlying hue of a sticker. Ported verbatim from
// cube-color-test/page.tsx, including its on-device red/orange retuning —
// see the comment on red/orange below for why those two get special
// handling in classifyHsv.
const CUBE_COLOR_HSV_REFERENCE: Record<CubeColorName, HsvRange> = {
  white: { h: 0, s: 10, v: 90 },
  yellow: { h: 55, s: 70, v: 85 },
  // red/orange retuned from on-device calibration data — their hues sit
  // only ~15° apart under real lighting, so value is what actually
  // separates them (see the higher value weight for these two in
  // classifyHsv below).
  red: { h: 355, s: 80, v: 60 },
  orange: { h: 10, s: 82, v: 90 },
  blue: { h: 215, s: 65, v: 65 },
  green: { h: 140, s: 60, v: 60 },
};

const COLOR_LABELS_MN: Record<CubeColorName, string> = {
  white: 'Цагаан',
  yellow: 'Шар',
  red: 'Улаан',
  orange: 'Улбар шар',
  blue: 'Хөх',
  green: 'Ногоон',
};

// Swatch colors used to render each classified name as a chip in the debug
// panel and legend — purely cosmetic, independent of the HSV reference math.
const COLOR_SWATCH_HEX: Record<CubeColorName, string> = {
  white: '#f5f5f5',
  yellow: '#facc15',
  red: '#ef4444',
  orange: '#f97316',
  blue: '#3b82f6',
  green: '#22c55e',
};

const GRID_SIZE = 3;
const SAMPLE_PATCH_PX = 10;
const DEBUG_DOT_MIN_RADIUS_PX = 4;

// ── Auto-lock stability tuning (ported pattern from cube-color-test) ───────
const STABILITY_WINDOW = 4; // consecutive ticks required to agree before locking
const LOCK_FLASH_MS = 800; // how long the "✓ Танигдлаа!" confirmation shows before advancing
// Shrink the detected blob's bounding rect by this fraction on each side
// before sampling within it (e.g. 0.12 → sample within the central 76%) —
// avoids edge pixels that may include hand/background bleeding in from an
// imperfect blob boundary.
const BLOB_SAMPLE_INSET_FRACTION = 0.12;
// Stability tolerance for the detected boundingRect's center position AND
// size across the STABILITY_WINDOW, as a fraction of the frame's larger
// dimension — confirms the user is actually holding the cube steady, not
// just that classification happens to agree across a region that's still
// drifting (e.g. mid-motion toward a stable hold).
const BLOB_STABILITY_TOLERANCE_FRACTION = 0.08;

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
  let rejectedCandidates = 0;

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

    const frameWidth = canvas.width;
    const frameHeight = canvas.height;
    const minArea = frameWidth * frameHeight * BLOB_MIN_AREA_FRACTION;
    // Best candidate found so far AMONG those passing the aspect-ratio/
    // edge-touching filters below — separate from largestContourArea
    // (which tracks the raw largest contour regardless of shape, purely as
    // a "did Canny even find anything cube-sized" diagnostic) so a large
    // but wall-shaped blob doesn't win over a smaller, genuinely cube-
    // shaped one.
    let bestCandidateArea = 0;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      try {
        const area = cv.contourArea(contour);
        if (area > largestContourArea) {
          largestContourArea = area;
        }
        // Below the area threshold entirely — not a candidate at all, and
        // not counted in rejectedCandidates (that count is reserved for
        // contours that cleared this bar but failed shape/position checks).
        if (area < minArea) continue;

        const rect = cv.boundingRect(contour);
        if (rect.width <= 0 || rect.height <= 0) continue;
        // Normalized so it's always >= 1, regardless of whether the blob is
        // wider or taller than it is the other dimension.
        const aspectRatio = Math.max(rect.width, rect.height) / Math.min(rect.width, rect.height);
        const edgeTouchCount = [
          rect.x <= BLOB_EDGE_TOUCH_TOLERANCE_PX,
          rect.y <= BLOB_EDGE_TOUCH_TOLERANCE_PX,
          frameWidth - (rect.x + rect.width) <= BLOB_EDGE_TOUCH_TOLERANCE_PX,
          frameHeight - (rect.y + rect.height) <= BLOB_EDGE_TOUCH_TOLERANCE_PX,
        ].filter(Boolean).length;

        if (aspectRatio > BLOB_MAX_ASPECT_RATIO || edgeTouchCount >= BLOB_EDGE_TOUCH_MIN_COUNT) {
          rejectedCandidates++;
          continue;
        }

        if (area > bestCandidateArea) {
          bestCandidateArea = area;
          boundingRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
      } finally {
        contour.delete();
      }
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

  return { maskNonZeroPixels, largestContourArea, boundingRect, rejectedCandidates };
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

// ── Color sampling / classification (ported from cube-color-test/page.tsx) ─
// Verbatim port of the proven implementation — see that file's comments for
// the underlying derivation. This page is now the source of truth for this
// logic going forward.

function rgbToHsv(rgb: RGB): HSV {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;

  return { h, s, v };
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Weighted HSV distance: hue dominates since it's the most lighting-stable
// channel. White has no meaningful hue (low saturation), so it's scored
// mostly on saturation + value instead of hue.
function classifyHsv(sample: HSV, reference: Record<CubeColorName, HsvRange>): CubeColorName {
  let best: CubeColorName = 'white';
  let bestScore = Infinity;

  (Object.keys(reference) as CubeColorName[]).forEach((name) => {
    const ref = reference[name];
    let score: number;
    if (name === 'white') {
      // White is defined by low saturation + high value; hue is unreliable.
      score = Math.abs(sample.s - ref.s) * 1.5 + Math.abs(sample.v - ref.v) * 1.0;
    } else {
      // Red and orange sit only ~15° apart in hue under real lighting
      // (calibration data: reds ~350-355°, oranges ~10°), so hue alone
      // can't reliably separate them — value carries most of the signal
      // there (reds V49-71%, oranges V80-100%), hence the heavier weight
      // for just these two.
      const valueWeight = name === 'red' || name === 'orange' ? 0.8 : 0.3;
      const hDist = hueDistance(sample.h, ref.h);
      score = hDist * 2.0 + Math.abs(sample.s - ref.s) * 0.5 + Math.abs(sample.v - ref.v) * valueWeight;
    }
    if (score < bestScore) {
      bestScore = score;
      best = name;
    }
  });

  return best;
}

function sampleAverageRgb(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  patch: number
): RGB {
  // Clamp so the patch never reads outside the canvas — guards against
  // rounding error pushing an edge sample a fraction of a pixel out of
  // bounds, which would otherwise throw in getImageData.
  const maxX = Math.max(0, ctx.canvas.width - patch);
  const maxY = Math.max(0, ctx.canvas.height - patch);
  const half = Math.floor(patch / 2);
  const x = Math.min(Math.max(0, Math.round(centerX - half)), maxX);
  const y = Math.min(Math.max(0, Math.round(centerY - half)), maxY);
  const { data } = ctx.getImageData(x, y, patch, patch);

  let r = 0;
  let g = 0;
  let b = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

function rgbToCss(rgb: RGB): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Shrinks `rect` by `insetFraction` on each side (so both width and height
// shrink by 2×insetFraction total) — sampling stays inside the central
// portion of the detected blob, away from edges that may include hand/
// background bleeding in from an imperfect blob boundary.
function insetRect(
  rect: { x: number; y: number; width: number; height: number },
  insetFraction: number
): { x: number; y: number; width: number; height: number } {
  const insetX = rect.width * insetFraction;
  const insetY = rect.height * insetFraction;
  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    width: rect.width - insetX * 2,
    height: rect.height - insetY * 2,
  };
}

// True if every entry in `rects` (the last STABILITY_WINDOW ticks' detected
// boundingRects) agrees closely enough on center position AND size —
// confirms the user is actually holding the cube steady, not just that
// classification happens to agree across a region that's still drifting
// (e.g. mid-motion toward a stable hold).
function boundingRectsAreStable(
  rects: readonly { x: number; y: number; width: number; height: number }[],
  toleranceFraction: number,
  frameWidth: number,
  frameHeight: number
): boolean {
  const tolerance = Math.max(frameWidth, frameHeight) * toleranceFraction;
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  return (
    spread(rects.map((r) => r.x + r.width / 2)) <= tolerance &&
    spread(rects.map((r) => r.y + r.height / 2)) <= tolerance &&
    spread(rects.map((r) => r.width)) <= tolerance &&
    spread(rects.map((r) => r.height)) <= tolerance
  );
}

// Samples 9 grid-cell centers within `rect` (the inset detected blob),
// skipping the fixed center. Unlike cube-color-test's sampleNineCells, this
// reads directly from `ctx` — the SAME processing-resolution canvas
// detectColorBlob already ran on — so no display↔native coordinate mapping
// is needed; `rect` and the returned sample points are all in that one
// canvas-buffer's pixel space throughout. No perspective correction: cells
// are a simple axis-aligned subdivision, reasonable given the aspect-ratio
// filter in detectColorBlob already constrains detected regions to be
// roughly square/face-on.
function sampleNineCellsFromRect(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  fixedCenterColor: CubeColorName,
  hsvReference: Record<CubeColorName, HsvRange>
): SampleResult[] {
  const cellW = rect.width / GRID_SIZE;
  const cellH = rect.height / GRID_SIZE;
  const results: SampleResult[] = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const x = rect.x + cellW * col + cellW / 2;
      const y = rect.y + cellH * row + cellH / 2;
      const isCenterCell = row === 1 && col === 1;
      if (isCenterCell) {
        // The center piece's color is fixed by cube geometry — it's the
        // same physical sticker regardless of scramble/solve state, so
        // classifying it via CV only risks a misread from any printed
        // center-cap logo skewing the averaged pixels. We already know
        // which face this capture is for, so just record that directly.
        results.push({
          rgb: { r: 0, g: 0, b: 0 },
          hsv: { h: 0, s: 0, v: 0 },
          classified: fixedCenterColor,
          x,
          y,
          isFixed: true,
        });
      } else {
        const rgb = sampleAverageRgb(ctx, x, y, SAMPLE_PATCH_PX);
        const hsv = rgbToHsv(rgb);
        const classified = classifyHsv(hsv, hsvReference);
        results.push({ rgb, hsv, classified, x, y, isFixed: false });
      }
    }
  }

  return results;
}

// Draws the already-sampled frame (from `sourceCanvas`, populated by the
// sampleNineCellsFromRect call that produced `results`) plus a dot at each
// exact sample point into `debugCanvas`. Only called once per face, when a
// reading locks in — not on every sampling tick. `sourceCanvas` at that
// point also carries this tick's magenta detected-region outline (drawn by
// drawBlobRect before sampling runs), so the debug snapshot shows exactly
// where the detector thought the face was, not just the raw frame.
function drawDebugOverlay(sourceCanvas: HTMLCanvasElement, debugCanvas: HTMLCanvasElement, results: SampleResult[]) {
  const vw = sourceCanvas.width;
  const vh = sourceCanvas.height;
  debugCanvas.width = vw;
  debugCanvas.height = vh;
  const debugCtx = debugCanvas.getContext('2d');
  if (!debugCtx) return;

  // Setting width/height already resets the bitmap per spec, but we also
  // clearRect explicitly so a stale frame can never show through.
  debugCtx.clearRect(0, 0, vw, vh);
  debugCtx.drawImage(sourceCanvas, 0, 0);
  const dotRadius = Math.max(DEBUG_DOT_MIN_RADIUS_PX, Math.min(vw, vh) * 0.012);
  results.forEach((s) => {
    debugCtx.beginPath();
    debugCtx.arc(s.x, s.y, dotRadius, 0, Math.PI * 2);
    // Fixed (unsampled) center dot renders yellow instead of the usual
    // red, so it's obvious at a glance that this point wasn't actually
    // read from the camera — it's an assumed value.
    debugCtx.fillStyle = s.isFixed ? '#facc15' : '#ff0000';
    debugCtx.fill();
    debugCtx.lineWidth = Math.max(1, dotRadius * 0.25);
    debugCtx.strokeStyle = '#ffffff';
    debugCtx.stroke();

    if (s.isFixed) {
      const fontSize = Math.max(12, dotRadius * 1.4);
      debugCtx.font = `bold ${fontSize}px sans-serif`;
      debugCtx.textAlign = 'center';
      debugCtx.fillStyle = '#facc15';
      debugCtx.fillText('FIX', s.x, s.y - dotRadius - fontSize * 0.4);
    }
  });
}

// DEBUG ONLY — draws a dot at each of THIS TICK's 9 sample points directly
// on the live camera view, every tick (not just once on lock, like
// drawDebugOverlay above) — added to diagnose a mismatch between
// LivePreviewGrid's classified colors and the actual held cube: lets the
// user see in real time exactly where the 9 points are landing relative to
// the cube's stickers as they hold it, before any lock happens. Purely
// visual — does not touch sampling/classification/detection logic. Bright
// cyan fill + white outline (vs. drawDebugOverlay's red/yellow/FIX scheme)
// so this live overlay is never confused with the post-lock debug canvas
// if the two are ever compared side by side.
function drawLiveSampleDots(canvas: HTMLCanvasElement, results: readonly SampleResult[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dotRadius = Math.max(DEBUG_DOT_MIN_RADIUS_PX, Math.min(canvas.width, canvas.height) * 0.012);
  results.forEach((s) => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#22d3ee'; // bright cyan
    ctx.fill();
    ctx.lineWidth = Math.max(1, dotRadius * 0.25);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });
}

function logLockedSample(label: string, results: SampleResult[]) {
  // eslint-disable-next-line no-console
  console.log(`[cube-edge-detect-test] locked in: ${label}`);
  // eslint-disable-next-line no-console
  console.table(
    results.map((s, i) => ({
      cell: i,
      x: Math.round(s.x),
      y: Math.round(s.y),
      rgb: `${s.rgb.r},${s.rgb.g},${s.rgb.b}`,
      classified: s.classified,
    }))
  );
}

// ── Small presentational pieces (ported from cube-color-test/page.tsx) ─────

function FaceResultsGrid({ samples }: { samples: SampleResult[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {samples.map((s, i) => (
        <div
          key={i}
          className="flex flex-col items-center gap-1 rounded-lg border p-2"
          style={{ borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#1a1a1a' }}
        >
          <div
            className="h-12 w-12 rounded border border-white/20"
            style={{ backgroundColor: s.isFixed ? COLOR_SWATCH_HEX[s.classified] : rgbToCss(s.rgb) }}
          />
          <span className="text-xs font-semibold">{COLOR_LABELS_MN[s.classified]}</span>
          {s.isFixed ? (
            <span className="text-center text-[10px] leading-tight text-white/40">(тогтмол)</span>
          ) : (
            <span className="text-center text-[10px] leading-tight text-white/40">
              RGB {s.rgb.r},{s.rgb.g},{s.rgb.b}
              <br />
              HSV {Math.round(s.hsv.h)}°,{Math.round(s.hsv.s)}%,{Math.round(s.hsv.v)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// Compact live preview of the current tick's reading, shown continuously
// while sampling so the user can see the reading settle as they hold the
// cube steady. The center cell always shows the known fixed color; the
// other 8 come from the latest tick's classification (liveReading), in the
// same row-major-skip-center order sampleNineCellsFromRect produces them.
function LivePreviewGrid({
  liveReading,
  fixedCenterColor,
}: {
  liveReading: CubeColorName[] | null;
  fixedCenterColor: CubeColorName;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-white/50">Уншиж байна...</p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 4,
          width: 96,
        }}
      >
        {Array.from({ length: 9 }).map((_, i) => {
          const isCenter = i === 4;
          const color = isCenter ? fixedCenterColor : (liveReading?.[i < 4 ? i : i - 1] ?? null);
          return (
            <div
              key={i}
              style={{
                aspectRatio: '1 / 1',
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.25)',
                backgroundColor: color ? COLOR_SWATCH_HEX[color] : '#2a2a2a',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function FaceDebugCanvas({ canvasRef, label }: { canvasRef: RefObject<HTMLCanvasElement | null>; label: string }) {
  return (
    <div>
      <p className="mb-1 text-xs text-white/50">{label}</p>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      />
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CubeEdgeDetectTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // shared scratch buffer: detection AND sampling both read/write this same processing-resolution canvas
  // DEBUG ONLY — small preview showing the post-morphological-close
  // saturation/value mask detectColorBlob produced this tick (see
  // detectColorBlob above).
  const blobPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef1 = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef2 = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cvRef = useRef<CvModule | null>(null);
  const startCameraRequestIdRef = useRef(0);
  const cameraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopRunIdRef = useRef(0);
  // Rolling history of the last STABILITY_WINDOW ticks' detected
  // boundingRect + 8-color classification, for the current face only —
  // cleared on lock, on advancing to the next face, and on restart. Kept as
  // a ref (not state) since it's consulted and mutated every tick and
  // doesn't need to itself trigger renders.
  const historyRef = useRef<
    { rect: { x: number; y: number; width: number; height: number }; colors: CubeColorName[] }[]
  >([]);
  // Guards against re-entrant locks and pauses sampling entirely during the
  // ~800ms lock-confirmation flash window (the detection loop keeps ticking
  // — blob detection/diagnostics still run — since captureStep hasn't
  // advanced yet).
  const lockingRef = useRef(false);
  const lockFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror captureStep/hsvReference into refs so the tick closure below can
  // read their latest values without needing the main detection loop's
  // effect to depend on (and thus restart on every change of) either —
  // that loop also owns camera-timing bookkeeping (nextDelay pacing, the
  // wasm-heap diagnostic sampler) that shouldn't reset just because the
  // user advanced to the second face or tweaked an HSV slider.
  const captureStepRef = useRef<CaptureStep>('first');
  const hsvReferenceRef = useRef<Record<CubeColorName, HsvRange>>(CUBE_COLOR_HSV_REFERENCE);
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
  // Contours that cleared the min-area threshold but got rejected by the
  // aspect-ratio/edge-touching filters (e.g. a wall/doorframe blob) — see
  // BLOB_MAX_ASPECT_RATIO / BLOB_EDGE_TOUCH_MIN_COUNT above.
  const [blobRejectedCandidates, setBlobRejectedCandidates] = useState<number>(0);
  // ── detect→sample→classify pipeline state (ported pattern from
  // cube-color-test/page.tsx, wired to the auto-detected blob instead of a
  // fixed guide box) ──────────────────────────────────────────────────────
  const [captureStep, setCaptureStep] = useState<CaptureStep>('first');
  const [firstFaceSamples, setFirstFaceSamples] = useState<SampleResult[] | null>(null);
  const [secondFaceSamples, setSecondFaceSamples] = useState<SampleResult[] | null>(null);
  // Latest tick's 8 outer-cell classifications, for the live preview grid.
  const [liveReading, setLiveReading] = useState<CubeColorName[] | null>(null);
  // Briefly true right after a face locks in, showing "✓ Танигдлаа!" in
  // place of the normal instruction text before the next face is prompted.
  const [lockFlashVisible, setLockFlashVisible] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [hsvReference, setHsvReference] = useState<Record<CubeColorName, HsvRange>>(CUBE_COLOR_HSV_REFERENCE);

  useEffect(() => {
    captureStepRef.current = captureStep;
  }, [captureStep]);

  useEffect(() => {
    hsvReferenceRef.current = hsvReference;
  }, [hsvReference]);

  // Reset the stability-tracking history whenever the active capture step
  // changes (new face, or a restart back to 'first') — a stale streak from
  // the previous face/attempt must never carry over and cause an instant
  // false lock.
  useEffect(() => {
    historyRef.current = [];
    setLiveReading(null);
  }, [captureStep]);

  // Re-classify already-locked samples live when the HSV reference is
  // tuned, without needing a new capture. The fixed center cell is skipped
  // — its hsv is a meaningless placeholder, so running it through
  // classifyHsv would stomp its known-correct 'white'/'green' with a bogus
  // reading.
  useEffect(() => {
    setFirstFaceSamples((prev) =>
      prev ? prev.map((s) => (s.isFixed ? s : { ...s, classified: classifyHsv(s.hsv, hsvReference) })) : prev
    );
    setSecondFaceSamples((prev) =>
      prev ? prev.map((s) => (s.isFixed ? s : { ...s, classified: classifyHsv(s.hsv, hsvReference) })) : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsvReference]);

  // Clear the lock-flash timeout on unmount so it can't fire setState after
  // the component's gone.
  useEffect(() => {
    return () => {
      if (lockFlashTimeoutRef.current) clearTimeout(lockFlashTimeoutRef.current);
    };
  }, []);

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

  const handleRestart = useCallback(() => {
    if (lockFlashTimeoutRef.current) {
      clearTimeout(lockFlashTimeoutRef.current);
      lockFlashTimeoutRef.current = null;
    }
    lockingRef.current = false;
    historyRef.current = [];
    setLiveReading(null);
    setLockFlashVisible(false);
    setFirstFaceSamples(null);
    setSecondFaceSamples(null);
    setCaptureStep('first');
  }, []);

  const updateReferenceField = useCallback((color: CubeColorName, field: keyof HsvRange, value: number) => {
    setHsvReference((prev) => ({
      ...prev,
      [color]: { ...prev[color], [field]: value },
    }));
  }, []);

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
  //
  // Also now does grid sampling + auto-lock, gated on this tick's detected
  // blob — see the block below drawBlobRect inside tick(). Deliberately
  // depends only on [cameraStatus, opencvStatus], NOT [captureStep,
  // hsvReference]: those are read via captureStepRef/hsvReferenceRef so
  // advancing to the next face or tweaking an HSV slider doesn't restart
  // this effect's camera-timing bookkeeping (nextDelay pacing, the wasm-
  // heap diagnostic sampler) — unlike cube-color-test's simpler
  // setInterval-per-effect loop, which intentionally DOES restart on
  // captureStep change to reset its own sampling state.
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
        // willReadFrequently — this canvas now also gets 9 getImageData
        // calls a tick from sampleNineCellsFromRect below whenever a valid
        // blob is detected, not just drawImage/stroke calls; only honored
        // on the FIRST getContext call for a given canvas element, so it
        // has to be set here rather than in sampleAverageRgb itself.
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);

          const start = performance.now();
          let blobResult: BlobResult = {
            maskNonZeroPixels: 0,
            largestContourArea: 0,
            boundingRect: null,
            rejectedCandidates: 0,
          };
          try {
            blobResult = detectColorBlob(cv, canvas, blobPreviewCanvasRef.current);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[cube-edge-detect-test] blob detection error', err);
          }
          const elapsed = performance.now() - start;

          drawBlobRect(canvas, blobResult.boundingRect);
          setLastFrameMs(elapsed);
          setBlobMaskNonZeroPixels(blobResult.maskNonZeroPixels);
          setBlobLargestContourArea(blobResult.largestContourArea);
          setBlobBoundingRect(blobResult.boundingRect);
          setBlobRejectedCandidates(blobResult.rejectedCandidates);

          // ── Grid sampling + auto-lock, gated on a valid detected blob ───
          // Paused entirely during the ~800ms lock-confirmation flash
          // window (captureStep hasn't advanced yet, so this loop keeps
          // ticking for blob detection/diagnostics) — lockingRef guards
          // against re-entrant locks and stray sampling while the flash is
          // showing.
          if (captureStepRef.current !== 'done' && !lockingRef.current) {
            if (blobResult.boundingRect) {
              const sampleRect = insetRect(blobResult.boundingRect, BLOB_SAMPLE_INSET_FRACTION);
              const fixedCenterColor: CubeColorName = captureStepRef.current === 'first' ? 'white' : 'green';
              const results = sampleNineCellsFromRect(ctx, sampleRect, fixedCenterColor, hsvReferenceRef.current);
              // DEBUG ONLY — visualize exactly where these 9 points landed,
              // every tick, on the live camera view. Drawn after
              // sampleNineCellsFromRect already read the pixel data, so it
              // can't skew the sample itself. See drawLiveSampleDots above.
              drawLiveSampleDots(canvas, results);
              const liveColors = results.filter((s) => !s.isFixed).map((s) => s.classified);
              setLiveReading(liveColors);

              historyRef.current = [
                ...historyRef.current,
                { rect: blobResult.boundingRect, colors: liveColors },
              ].slice(-STABILITY_WINDOW);

              // "Stable" requires BOTH the classified colors AND the
              // detected region's position/size to agree across the whole
              // window — colors alone could coincidentally agree while the
              // detection is still drifting mid-motion toward a hold.
              const isStable =
                historyRef.current.length === STABILITY_WINDOW &&
                historyRef.current.every((entry) => arraysEqual(entry.colors, liveColors)) &&
                boundingRectsAreStable(
                  historyRef.current.map((entry) => entry.rect),
                  BLOB_STABILITY_TOLERANCE_FRACTION,
                  canvas.width,
                  canvas.height
                );

              if (isStable) {
                lockingRef.current = true;
                const debugCanvas =
                  captureStepRef.current === 'first' ? debugCanvasRef1.current : debugCanvasRef2.current;
                if (debugCanvas) drawDebugOverlay(canvas, debugCanvas, results);
                logLockedSample(captureStepRef.current, results);

                if (captureStepRef.current === 'first') {
                  setFirstFaceSamples(results);
                } else {
                  setSecondFaceSamples(results);
                }

                historyRef.current = [];
                setLockFlashVisible(true);
                lockFlashTimeoutRef.current = setTimeout(() => {
                  setLockFlashVisible(false);
                  lockingRef.current = false;
                  setCaptureStep((prev) => (prev === 'first' ? 'second' : 'done'));
                }, LOCK_FLASH_MS);
              }
            } else {
              // No valid blob this tick — the stability streak can't mean
              // anything spanning a gap where nothing was even detected,
              // so reset it rather than let ticks from before the gap
              // count toward a later coincidental match.
              historyRef.current = [];
              setLiveReading(null);
            }
          }

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
    `blobMaskNonZeroPixels (post-close mask; near-0 = HSV thresholds too strict): ${blobMaskNonZeroPixels}`,
    `blobLargestContourArea (before min-area rejection): ${Math.round(blobLargestContourArea)}`,
    `blobBoundingRect: ${
      blobBoundingRect
        ? `x=${blobBoundingRect.x} y=${blobBoundingRect.y} w=${blobBoundingRect.width} h=${blobBoundingRect.height}`
        : 'none'
    }`,
    `blobRejectedCandidates (passed area, rejected by aspect/edge filters): ${blobRejectedCandidates}`,
    `captureStep: ${captureStep}`,
    `firstFaceSamples: ${firstFaceSamples ? `${firstFaceSamples.length} samples` : 'null'}`,
    `secondFaceSamples: ${secondFaceSamples ? `${secondFaceSamples.length} samples` : 'null'}`,
    `lockFlashVisible: ${lockFlashVisible}`,
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
          <h1 className="text-lg font-semibold">Куб автомат таних (өнгөт blob)</h1>
          <p className="text-sm" style={{ color: lockFlashVisible ? '#4ade80' : 'rgba(255,255,255,0.5)' }}>
            {lockFlashVisible && '✓ Танигдлаа!'}
            {!lockFlashVisible &&
              captureStep === 'first' &&
              'Эхний талаа (жишээ нь цагаан) камерт харуулаад тогтвортой барьж бай — рамканд тааруулах шаардлагагүй'}
            {!lockFlashVisible &&
              captureStep === 'second' &&
              'Одоо хоёр дахь талаа (жишээ нь ногоон) харуулаад тогтвортой барьж бай'}
            {!lockFlashVisible && captureStep === 'done' && 'Хоёр тал амжилттай бүртгэгдлээ'}
          </p>
        </header>

        {/* ── Detection view ───────────────────────────────────────────────
            The one visible canvas: each tick redraws the captured frame at
            processing resolution, then strokes a magenta outline around the
            detected color blob directly on top of it (see drawBlobRect).
            Hidden once both faces are captured (captureStep === 'done'),
            same as cube-color-test hides its camera view for the results
            screen — but never unmounted, so videoRef/canvasRef stay attached
            across a restart. */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            overflow: 'hidden',
            backgroundColor: '#000000',
            display: captureStep === 'done' ? 'none' : 'block',
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

        {/* ── Live preview ──────────────────────────────────────────────────
            Continuous sampling, gated on a valid detected blob each tick —
            shows the current reading updating in real time so the user can
            see it settle as they hold the cube steady. */}
        {captureStep !== 'done' && (
          <LivePreviewGrid liveReading={liveReading} fixedCenterColor={captureStep === 'first' ? 'white' : 'green'} />
        )}

        {/* ── DEBUG: saturation-blob mask preview ───────────────────────────
            White = pixels that passed the saturated-OR-white HSV threshold
            and survived the morphological close (see detectColorBlob); the
            main camera view above overlays the resulting detected region in
            bright magenta. */}
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

        {/* ── Two-face results ─────────────────────────────────────────────
            Only visible once both captures are done, but each debug canvas
            below is always mounted (display-toggled, not unmounted) so its
            ref exists when its own capture happens mid-sequence, in step
            'first'/'second' — well before this section becomes visible. */}
        <div style={{ display: captureStep === 'done' ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
          <div>
            <h2 className="mb-2 text-sm font-semibold">1-р тал</h2>
            {firstFaceSamples && <FaceResultsGrid samples={firstFaceSamples} />}
          </div>
          <FaceDebugCanvas
            canvasRef={debugCanvasRef1}
            label="Дээж авсан цэгүүд — 1-р тал (улаан цэгүүд куб талан дээр байх ёстой, ягаан хүрээ илрүүлсэн бүс)"
          />

          <div>
            <h2 className="mb-2 text-sm font-semibold">2-р тал</h2>
            {secondFaceSamples && <FaceResultsGrid samples={secondFaceSamples} />}
          </div>
          <FaceDebugCanvas
            canvasRef={debugCanvasRef2}
            label="Дээж авсан цэгүүд — 2-р тал (улаан цэгүүд куб талан дээр байх ёстой, ягаан хүрээ илрүүлсэн бүс)"
          />

          <button
            onClick={handleRestart}
            className="w-full rounded-lg py-3 text-sm font-semibold"
            style={{
              backgroundColor: 'transparent',
              border: `1px solid ${ACCENT}`,
              color: ACCENT,
            }}
          >
            Дахин эхлэх
          </button>
        </div>

        <p className="text-xs text-white/40">
          Ягаан (magenta) тэгш өнцөгт бол автоматаар илрүүлсэн куб талын бүс. Куб талыг камерт ямар
          ч байрлал, өнцгөөр харуулаад тогтвортой барьж байхад тухайн бүс дотор 9 нүд дээжлэгдэж,
          тогтвортой болмогц автоматаар дараагийн тал руу шилжинэ.
        </p>

        {/* ── Debug / calibration panel ─────────────────────────────────── */}
        <div className="rounded-lg border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => setShowDebugPanel((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-sm text-white/70"
          >
            <span>HSV лавлах утгууд (тохируулах)</span>
            <span>{showDebugPanel ? '−' : '+'}</span>
          </button>

          {showDebugPanel && (
            <div className="flex flex-col gap-3 border-t px-3 py-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              {(Object.keys(hsvReference) as CubeColorName[]).map((color) => (
                <div key={color} className="flex items-center gap-2">
                  <div
                    className="h-4 w-4 flex-shrink-0 rounded-full border border-white/20"
                    style={{ backgroundColor: COLOR_SWATCH_HEX[color] }}
                  />
                  <span className="w-16 flex-shrink-0 text-xs text-white/60">{COLOR_LABELS_MN[color]}</span>
                  {(['h', 's', 'v'] as const).map((field) => (
                    <label key={field} className="flex items-center gap-1 text-[10px] text-white/40">
                      {field.toUpperCase()}
                      <input
                        type="number"
                        value={hsvReference[color][field]}
                        onChange={(e) => updateReferenceField(color, field, Number(e.target.value))}
                        className="w-14 rounded border bg-transparent px-1 py-0.5 text-white"
                        style={{ borderColor: 'rgba(255,255,255,0.15)' }}
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
