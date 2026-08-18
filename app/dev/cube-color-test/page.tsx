'use client';

import type { CSSProperties, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

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
  // Native-resolution canvas coordinates the sample was taken from — kept so
  // the debug overlay can draw a dot at the exact point that was read.
  x: number;
  y: number;
  // True for the center cell, whose color is assumed from which capture
  // step this is (never sampled from the camera) — see captureFaceIntoDebugCanvas.
  // rgb/hsv are meaningless placeholders in that case.
  isFixed: boolean;
}

type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable' | 'timeout';

// Two-face capture sequence: capture one face, immediately capture a second
// (no re-init needed — the camera stream stays mounted throughout), then
// show both results together. Deliberately generic ("first"/"second") since
// this page doesn't hardcode which physical face the user shows first.
type CaptureStep = 'first' | 'second' | 'done';

// ── Reference HSV ranges (tunable) ──────────────────────────────────────────
// These are the "centers" each sample is compared against. Hue distance is
// weighted much more heavily than saturation/value distance since ambient
// lighting swings brightness and saturation around a lot more than it swings
// the underlying hue of a sticker.
const CUBE_COLOR_HSV_REFERENCE: Record<CubeColorName, HsvRange> = {
  white: { h: 0, s: 10, v: 90 },
  yellow: { h: 55, s: 70, v: 85 },
  // red/orange retuned from on-device calibration data — their hues sit only
  // ~15° apart under real lighting, so value is what actually separates them
  // (see the higher value weight for these two in classifyHsv below).
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
const GUIDE_BOX_FRACTION = 0.8; // must match the CSS overlay's `width: 80%` below
const DEBUG_DOT_MIN_RADIUS_PX = 4;
const CAMERA_INIT_TIMEOUT_MS = 10_000;

const ACCENT = '#A78BFA';
const BG = '#0a0a0a';

// Four L-shaped viewfinder brackets, one per corner of the guide box —
// drawn as plain border-pairs (no image assets) so the guide reads as an
// unmistakable "camera viewfinder" rather than a faint rectangle. Position
// and size are inline here (not Tailwind `absolute h-6 w-6`) so the guide
// box renders correctly even if Tailwind utilities aren't applying.
const CORNER_MARKER_STYLES: CSSProperties[] = [
  { position: 'absolute', height: 24, width: 24, top: -3, left: -3, borderTop: `3px solid ${ACCENT}`, borderLeft: `3px solid ${ACCENT}` },
  { position: 'absolute', height: 24, width: 24, top: -3, right: -3, borderTop: `3px solid ${ACCENT}`, borderRight: `3px solid ${ACCENT}` },
  { position: 'absolute', height: 24, width: 24, bottom: -3, left: -3, borderBottom: `3px solid ${ACCENT}`, borderLeft: `3px solid ${ACCENT}` },
  { position: 'absolute', height: 24, width: 24, bottom: -3, right: -3, borderBottom: `3px solid ${ACCENT}`, borderRight: `3px solid ${ACCENT}` },
];

// ── Color math ───────────────────────────────────────────────────────────────

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
function classifyHsv(
  sample: HSV,
  reference: Record<CubeColorName, HsvRange>
): CubeColorName {
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

// The <video> element is styled with `object-fit: cover`, so the native
// frame is scaled up (using the LARGER of the two axis ratios) until it
// fully covers the display box, then the overflow is cropped equally from
// both sides on whichever axis has slack. A point in display space has to
// be pushed back through that scale-then-crop transform to land on the
// right native pixel.
function mapDisplayPointToNativeVideo(
  displayX: number,
  displayY: number,
  displayW: number,
  displayH: number,
  nativeW: number,
  nativeH: number
): { x: number; y: number } {
  const scale = Math.max(displayW / nativeW, displayH / nativeH);
  const renderedW = nativeW * scale;
  const renderedH = nativeH * scale;
  const cropX = (renderedW - displayW) / 2;
  const cropY = (renderedH - displayH) / 2;

  return {
    x: (displayX + cropX) / scale,
    y: (displayY + cropY) / scale,
  };
}

// ── Small presentational pieces (reused once per face) ─────────────────────

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

function FaceDebugCanvas({
  canvasRef,
  label,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  label: string;
}) {
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

export default function CubeColorTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // shared offscreen scratch buffer, reused for both captures
  const debugCanvasRef1 = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef2 = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Bumped on every new startCamera() call (mount, retry, or visibility
  // regain) and on unmount. A pending getUserMedia() call captures its own
  // id and checks it against this ref when it resolves — if another call
  // has since taken over, the resolution is stale and its stream is stopped
  // immediately instead of being kept alive. Without this, a call that's
  // still in flight when the page is left (nav away, or the effect's own
  // cleanup running) would, on eventually resolving, assign its stream to
  // a ref no cleanup will ever run for again — a leaked live stream that
  // keeps holding the camera hardware and can hang the next getUserMedia().
  const startCameraRequestIdRef = useRef(0);
  const cameraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [cameraError, setCameraError] = useState<string>('');
  // Raw getUserMedia() failure, kept separately from the (Mongolian,
  // user-facing) cameraError string so the diagnostics panel can show it
  // verbatim regardless of how cameraError gets phrased per status branch.
  const [lastCameraError, setLastCameraError] = useState<{ name: string; message: string } | null>(null);
  const [captureStep, setCaptureStep] = useState<CaptureStep>('first');
  const [firstFaceSamples, setFirstFaceSamples] = useState<SampleResult[] | null>(null);
  const [secondFaceSamples, setSecondFaceSamples] = useState<SampleResult[] | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [hsvReference, setHsvReference] =
    useState<Record<CubeColorName, HsvRange>>(CUBE_COLOR_HSV_REFERENCE);
  // Forces the on-screen diagnostics block to re-read videoRef's live
  // getBoundingClientRect()/videoWidth/videoHeight periodically — those
  // aren't otherwise reactive, so a plain render only shows a stale snapshot.
  const [diagTick, setDiagTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setDiagTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    // Superseding any earlier in-flight call is the whole point of the
    // token: bumping it here means a still-pending previous getUserMedia()
    // (e.g. one left over from before a quick nav-away-and-back, or one
    // that's simply taking a long time) will recognize itself as stale when
    // it eventually resolves and stop its stream instead of leaking it.
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
        // A newer request has since taken over (retry, visibility-regain
        // retry, or this component already unmounted) — this stream is
        // stale. Stop it immediately so it doesn't sit there holding the
        // camera hardware.
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
      // Invalidate this mount's request so a getUserMedia() call that's
      // still pending when the user navigates away (client-side routing
      // unmounts this component immediately, but the promise itself can't
      // be cancelled) stops its stream on arrival instead of leaking it —
      // see the comment on startCameraRequestIdRef above.
      startCameraRequestIdRef.current += 1;
      if (cameraTimeoutRef.current) {
        clearTimeout(cameraTimeoutRef.current);
        cameraTimeoutRef.current = null;
      }
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile browsers (confirmed pattern on Android Chrome) can suspend an
  // in-flight getUserMedia() call while the tab/app is backgrounded and
  // only let it resolve once foregrounded again — which reads as "stuck on
  // 'requesting' for minutes, then suddenly connects." If we're still
  // stuck in 'requesting' by the time the page becomes visible again, fire
  // a fresh attempt; the token above makes this safe even if the original
  // call eventually resolves too.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && cameraStatus === 'requesting') {
        startCamera();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [cameraStatus, startCamera]);

  // Captures the current video frame, samples the 8 outer grid cells, and
  // draws the debug-dot overlay into whichever debug canvas is passed in.
  // Coordinate mapping, sampling, and classification for those 8 cells are
  // the exact single-face capture logic from before; only the caller now
  // decides which face's debug canvas and state slot the result goes into,
  // plus what fixed color the center cell should be assumed to be (see
  // fixedCenterColor below — the center piece never actually gets sampled).
  const captureFaceIntoDebugCanvas = useCallback(
    (debugCanvas: HTMLCanvasElement, fixedCenterColor: CubeColorName): SampleResult[] | null => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || cameraStatus !== 'ready') return null;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;

      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(video, 0, 0, vw, vh);

      // The grid overlay is drawn in on-screen CSS pixels over the video's
      // rendered box, not over its native resolution. Since the video is
      // `object-fit: cover`, that box is a cropped, scaled view of the native
      // frame — so the guide box has to be computed in display space first,
      // then each cell center mapped back to native pixels via
      // mapDisplayPointToNativeVideo before sampling.
      const displayRect = video.getBoundingClientRect();
      const displayW = displayRect.width;
      const displayH = displayRect.height;

      const guideSizeDisplay = Math.min(displayW, displayH) * GUIDE_BOX_FRACTION;
      const guideLeftDisplay = (displayW - guideSizeDisplay) / 2;
      const guideTopDisplay = (displayH - guideSizeDisplay) / 2;
      const cellSizeDisplay = guideSizeDisplay / GRID_SIZE;

      // eslint-disable-next-line no-console
      console.log('[cube-color-test] cover-fit mapping', {
        displayW,
        displayH,
        nativeW: vw,
        nativeH: vh,
        scale: Math.max(displayW / vw, displayH / vh),
      });

      const results: SampleResult[] = [];
      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          const centerXDisplay = guideLeftDisplay + cellSizeDisplay * col + cellSizeDisplay / 2;
          const centerYDisplay = guideTopDisplay + cellSizeDisplay * row + cellSizeDisplay / 2;
          const { x, y } = mapDisplayPointToNativeVideo(
            centerXDisplay,
            centerYDisplay,
            displayW,
            displayH,
            vw,
            vh
          );
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

      // eslint-disable-next-line no-console
      console.table(
        results.map((s, i) => ({
          cell: i,
          nativeX: Math.round(s.x),
          nativeY: Math.round(s.y),
          rgb: `${s.rgb.r},${s.rgb.g},${s.rgb.b}`,
          classified: s.classified,
        }))
      );

      // Debug view: the captured frame with a dot burned in at each exact
      // native-pixel sample point, so misalignment is visible at a glance.
      // Setting width/height already resets the bitmap per spec, but we also
      // clearRect explicitly so a stale frame can never show through.
      debugCanvas.width = vw;
      debugCanvas.height = vh;
      const debugCtx = debugCanvas.getContext('2d');
      if (debugCtx) {
        debugCtx.clearRect(0, 0, vw, vh);
        debugCtx.drawImage(canvas, 0, 0);
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

      return results;
    },
    [cameraStatus, hsvReference]
  );

  // Thin dispatcher: routes a capture to the right face's debug canvas and
  // state slot, then advances the sequence. All the actual capture work
  // (mapping, sampling, classification) lives in captureFaceIntoDebugCanvas
  // above, unchanged from the single-face version.
  const handleCapture = useCallback(() => {
    if (captureStep === 'first') {
      const debugCanvas = debugCanvasRef1.current;
      if (!debugCanvas) return;
      // First face's instruction text already tells the user to show white.
      const results = captureFaceIntoDebugCanvas(debugCanvas, 'white');
      if (!results) return;
      setFirstFaceSamples(results);
      setCaptureStep('second');
    } else if (captureStep === 'second') {
      const debugCanvas = debugCanvasRef2.current;
      if (!debugCanvas) return;
      // Second face's instruction text already tells the user to show green.
      const results = captureFaceIntoDebugCanvas(debugCanvas, 'green');
      if (!results) return;
      setSecondFaceSamples(results);
      setCaptureStep('done');
    }
  }, [captureStep, captureFaceIntoDebugCanvas]);

  const handleRestart = useCallback(() => {
    setFirstFaceSamples(null);
    setSecondFaceSamples(null);
    setCaptureStep('first');
  }, []);

  const updateReferenceField = useCallback(
    (color: CubeColorName, field: keyof HsvRange, value: number) => {
      setHsvReference((prev) => ({
        ...prev,
        [color]: { ...prev[color], [field]: value },
      }));
    },
    []
  );

  // Re-classify existing samples live when the reference values are tuned,
  // without needing a new capture. The fixed center cell is skipped — its
  // hsv is a meaningless placeholder, so running it through classifyHsv
  // would stomp its known-correct 'white'/'green' with a bogus reading.
  useEffect(() => {
    setFirstFaceSamples((prev) =>
      prev
        ? prev.map((s) => (s.isFixed ? s : { ...s, classified: classifyHsv(s.hsv, hsvReference) }))
        : prev
    );
    setSecondFaceSamples((prev) =>
      prev
        ? prev.map((s) => (s.isFixed ? s : { ...s, classified: classifyHsv(s.hsv, hsvReference) }))
        : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsvReference]);

  const videoEl = videoRef.current;
  const videoRect = videoEl?.getBoundingClientRect();
  const guideOverlayActive = cameraStatus === 'ready';
  const diagnosticsText = [
    `diagTick: ${diagTick}`,
    `cameraStatus: ${cameraStatus}`,
    `video display rect: ${videoRect ? `${Math.round(videoRect.width)} x ${Math.round(videoRect.height)}` : 'n/a'}`,
    `video native res: ${videoEl ? `${videoEl.videoWidth} x ${videoEl.videoHeight}` : 'n/a'}`,
    `guide overlay active (cameraStatus === 'ready'): ${guideOverlayActive}`,
    `captureStep: ${captureStep}`,
    `firstFaceSamples: ${firstFaceSamples ? `${firstFaceSamples.length} samples` : 'null'}`,
    `secondFaceSamples: ${secondFaceSamples ? `${secondFaceSamples.length} samples` : 'null'}`,
    `lastCameraError: ${lastCameraError ? `${lastCameraError.name} — ${lastCameraError.message}` : 'none'}`,
  ].join('\n');

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: BG, color: '#ffffff' }}>
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        {/* ── Tailwind sanity check ─────────────────────────────────────────
            If this box does NOT render solid red with white text, Tailwind
            utility classes are not applying for this route/build — every
            className-based style below should be treated as suspect and the
            inline-style versions are load-bearing, not just defensive. */}
        <div className="bg-red-500 text-white p-4 font-bold">
          TAILWIND TEST — should be solid red with white text
        </div>

        {/* ── Live diagnostics ──────────────────────────────────────────────
            Pure inline style (no Tailwind dependency) so this stays readable
            even if the sanity check above fails. */}
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
          <h1 className="text-lg font-semibold">Куб өнгө таних тест</h1>
          <p className="text-sm text-white/50">
            {captureStep === 'first' &&
              'Эхний талаа (жишээ нь цагаан) рамканд тааруулаад зураг ав'}
            {captureStep === 'second' &&
              'Одоо хоёр дахь талаа (жишээ нь ногоон) харуулаад зураг ав'}
            {captureStep === 'done' && 'Хоёр тал амжилттай бүртгэгдлээ'}
          </p>
        </header>

        {/* ── Camera / capture view ─────────────────────────────────────────
            Always mounted (never unmounted) so `videoRef` and its
            `srcObject` stay attached to the same DOM node across both
            captures — no re-initialization between the first and second
            face. Visibility, border, radius, overflow, and aspect ratio are
            all inline style (not Tailwind `hidden`/`border`/`rounded-xl`/
            `overflow-hidden`) so this box is guaranteed to size, border, and
            hide/show correctly even if Tailwind utilities are not applying
            for this route. */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            overflow: 'hidden',
            display: captureStep === 'done' ? 'none' : 'block',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{
              position: 'absolute',
              inset: 0,
              height: '100%',
              width: '100%',
              objectFit: 'cover',
            }}
          />

          {guideOverlayActive && (
            <div
              style={{
                pointerEvents: 'none',
                position: 'absolute',
                inset: 0,
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: `${GUIDE_BOX_FRACTION * 100}%`,
                  aspectRatio: '1 / 1',
                }}
              >
                {/* Outer guide box — solid, high-contrast border */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 4,
                    border: `3px solid ${ACCENT}`,
                  }}
                />
                {/* Internal 3x3 grid lines — explicit divs with inline
                    borderTop/borderLeft (not Tailwind's divide-x/divide-y)
                    so the lines render even if Tailwind utilities aren't
                    applying for this route. */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gridTemplateRows: 'repeat(3, 1fr)',
                  }}
                >
                  {Array.from({ length: 9 }).map((_, i) => {
                    const col = i % GRID_SIZE;
                    const row = Math.floor(i / GRID_SIZE);
                    return (
                      <div
                        key={i}
                        style={{
                          borderTop: row > 0 ? '1px solid rgba(255,255,255,0.6)' : undefined,
                          borderLeft: col > 0 ? '1px solid rgba(255,255,255,0.6)' : undefined,
                        }}
                      />
                    );
                  })}
                </div>
                {/* Viewfinder-style corner markers */}
                {CORNER_MARKER_STYLES.map((style, i) => (
                  <div key={i} style={style} />
                ))}
              </div>
            </div>
          )}

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
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {captureStep !== 'done' && (
          <button
            onClick={handleCapture}
            disabled={cameraStatus !== 'ready'}
            className="w-full rounded-lg py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-40"
            style={{ backgroundColor: ACCENT }}
          >
            Зураг авах
          </button>
        )}

        {/* ── Two-face results ─────────────────────────────────────────────
            Only visible once both captures are done, but each debug canvas
            below is always mounted (display-toggled, not unmounted) so its
            ref exists when its own capture happens mid-sequence, in step
            'first'/'second' — well before this section becomes visible. */}
        <div
          style={{ display: captureStep === 'done' ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}
        >
          <div>
            <h2 className="mb-2 text-sm font-semibold">1-р тал</h2>
            {firstFaceSamples && <FaceResultsGrid samples={firstFaceSamples} />}
          </div>
          <FaceDebugCanvas
            canvasRef={debugCanvasRef1}
            label="Дээж авсан цэгүүд — 1-р тал (улаан цэгүүд куб талан дээр байх ёстой)"
          />

          <div>
            <h2 className="mb-2 text-sm font-semibold">2-р тал</h2>
            {secondFaceSamples && <FaceResultsGrid samples={secondFaceSamples} />}
          </div>
          <FaceDebugCanvas
            canvasRef={debugCanvasRef2}
            label="Дээж авсан цэгүүд — 2-р тал (улаан цэгүүд куб талан дээр байх ёстой)"
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
                  <span className="w-16 flex-shrink-0 text-xs text-white/60">
                    {COLOR_LABELS_MN[color]}
                  </span>
                  {(['h', 's', 'v'] as const).map((field) => (
                    <label key={field} className="flex items-center gap-1 text-[10px] text-white/40">
                      {field.toUpperCase()}
                      <input
                        type="number"
                        value={hsvReference[color][field]}
                        onChange={(e) =>
                          updateReferenceField(color, field, Number(e.target.value))
                        }
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
