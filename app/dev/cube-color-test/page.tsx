'use client';

import type { CSSProperties } from 'react';
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
}

type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable';

// ── Reference HSV ranges (tunable) ──────────────────────────────────────────
// These are the "centers" each sample is compared against. Hue distance is
// weighted much more heavily than saturation/value distance since ambient
// lighting swings brightness and saturation around a lot more than it swings
// the underlying hue of a sticker.
const CUBE_COLOR_HSV_REFERENCE: Record<CubeColorName, HsvRange> = {
  white: { h: 0, s: 10, v: 90 },
  yellow: { h: 55, s: 70, v: 85 },
  red: { h: 5, s: 75, v: 70 },
  orange: { h: 25, s: 80, v: 90 },
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

const ACCENT = '#A78BFA';
const BG = '#0a0a0a';

// Four L-shaped viewfinder brackets, one per corner of the guide box —
// drawn as plain border-pairs (no image assets) so the guide reads as an
// unmistakable "camera viewfinder" rather than a faint rectangle.
const CORNER_MARKER_STYLES: CSSProperties[] = [
  { top: -3, left: -3, borderTop: `3px solid ${ACCENT}`, borderLeft: `3px solid ${ACCENT}` },
  { top: -3, right: -3, borderTop: `3px solid ${ACCENT}`, borderRight: `3px solid ${ACCENT}` },
  { bottom: -3, left: -3, borderBottom: `3px solid ${ACCENT}`, borderLeft: `3px solid ${ACCENT}` },
  { bottom: -3, right: -3, borderBottom: `3px solid ${ACCENT}`, borderRight: `3px solid ${ACCENT}` },
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
      const hDist = hueDistance(sample.h, ref.h);
      score = hDist * 2.0 + Math.abs(sample.s - ref.s) * 0.5 + Math.abs(sample.v - ref.v) * 0.3;
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

// ── Component ────────────────────────────────────────────────────────────────

export default function CubeColorTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [cameraError, setCameraError] = useState<string>('');
  const [samples, setSamples] = useState<SampleResult[] | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [hsvReference, setHsvReference] =
    useState<Record<CubeColorName, HsvRange>>(CUBE_COLOR_HSV_REFERENCE);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCameraStatus('requesting');
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraStatus('ready');
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraStatus('denied');
        setCameraError('Камерын зөвшөөрөл өгөгдөөгүй байна. Тохиргооноос зөвшөөрнө үү.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraStatus('unavailable');
        setCameraError('Камер олдсонгүй.');
      } else {
        setCameraStatus('unavailable');
        setCameraError('Камерт хандах үед алдаа гарлаа.');
      }
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const debugCanvas = debugCanvasRef.current;
    if (!video || !canvas || !debugCanvas || cameraStatus !== 'ready') return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

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
        const rgb = sampleAverageRgb(ctx, x, y, SAMPLE_PATCH_PX);
        const hsv = rgbToHsv(rgb);
        const classified = classifyHsv(hsv, hsvReference);
        results.push({ rgb, hsv, classified, x, y });
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
        debugCtx.fillStyle = '#ff0000';
        debugCtx.fill();
        debugCtx.lineWidth = Math.max(1, dotRadius * 0.25);
        debugCtx.strokeStyle = '#ffffff';
        debugCtx.stroke();
      });
    }

    setSamples(results);
  }, [cameraStatus, hsvReference]);

  const handleRetake = useCallback(() => {
    setSamples(null);
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
  // without needing a new capture.
  useEffect(() => {
    setSamples((prev) =>
      prev
        ? prev.map((s) => ({ ...s, classified: classifyHsv(s.hsv, hsvReference) }))
        : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsvReference]);

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: BG, color: '#ffffff' }}>
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <header>
          <h1 className="text-lg font-semibold">Куб өнгө таних тест</h1>
          <p className="text-sm text-white/50">
            Кубын нэг талыг рамкан дотор байрлуулаад зураг ав.
          </p>
        </header>

        {/* ── Camera / capture view ─────────────────────────────────────────
            Always mounted (never unmounted) so `videoRef` and its
            `srcObject` stay attached to the same DOM node across capture /
            retake cycles — unmounting here previously meant a fresh <video>
            replaced the old one on retake with no stream reattached (blank
            feed), and the mount/unmount churn is the likely source of the
            "doubled image" flash right after capture. Visibility toggles
            with a CSS class instead. */}
        <div
          className={`relative w-full overflow-hidden rounded-xl border ${samples ? 'hidden' : ''}`}
          style={{ borderColor: 'rgba(255,255,255,0.1)', aspectRatio: '1 / 1' }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
          />

          {cameraStatus === 'ready' && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div
                className="relative"
                style={{ width: `${GUIDE_BOX_FRACTION * 100}%`, aspectRatio: '1 / 1' }}
              >
                {/* Outer guide box — solid, high-contrast border */}
                <div
                  className="absolute inset-0 rounded"
                  style={{ border: `3px solid ${ACCENT}` }}
                />
                {/* Internal 3x3 grid lines */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 divide-x divide-y divide-white/60">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} />
                  ))}
                </div>
                {/* Viewfinder-style corner markers */}
                {CORNER_MARKER_STYLES.map((style, i) => (
                  <div key={i} className="absolute h-6 w-6" style={style} />
                ))}
              </div>
            </div>
          )}

          {cameraStatus === 'requesting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white/70">
              Камер асааж байна...
            </div>
          )}

          {(cameraStatus === 'denied' || cameraStatus === 'unavailable') && (
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

        <canvas ref={canvasRef} className="hidden" />

        {/* ── Debug: captured frame with sample-point dots ────────────────
            Always mounted (so the ref exists at capture time); visibility
            toggles with `samples` instead of the canvas mounting/unmounting. */}
        <div className={samples ? '' : 'hidden'}>
          <p className="mb-1 text-xs text-white/50">
            Дээж авсан цэгүүд (улаан цэгүүд куб талан дээр байх ёстой)
          </p>
          <canvas
            ref={debugCanvasRef}
            className="w-full rounded-lg border"
            style={{ borderColor: 'rgba(255,255,255,0.1)' }}
          />
        </div>

        {!samples ? (
          <button
            onClick={handleCapture}
            disabled={cameraStatus !== 'ready'}
            className="w-full rounded-lg py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-40"
            style={{ backgroundColor: ACCENT }}
          >
            Зураг авах
          </button>
        ) : (
          <>
            {/* ── Results grid ─────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-2">
              {samples.map((s, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-1 rounded-lg border p-2"
                  style={{ borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#1a1a1a' }}
                >
                  <div
                    className="h-12 w-12 rounded border border-white/20"
                    style={{ backgroundColor: rgbToCss(s.rgb) }}
                  />
                  <span className="text-xs font-semibold">{COLOR_LABELS_MN[s.classified]}</span>
                  <span className="text-center text-[10px] leading-tight text-white/40">
                    RGB {s.rgb.r},{s.rgb.g},{s.rgb.b}
                    <br />
                    HSV {Math.round(s.hsv.h)}°,{Math.round(s.hsv.s)}%,{Math.round(s.hsv.v)}%
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={handleRetake}
              className="w-full rounded-lg py-3 text-sm font-semibold"
              style={{
                backgroundColor: 'transparent',
                border: `1px solid ${ACCENT}`,
                color: ACCENT,
              }}
            >
              Дахин авах
            </button>
          </>
        )}

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
