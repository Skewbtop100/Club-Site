// Monotone cubic interpolation (Fritsch–Carlson) as an SVG path. Pure
// maths, no DOM — shared by the timer charts and testable in Node.
//
// Between any two neighbouring points the curve is monotone, so it never
// rises above the higher or dips below the lower of the two: no overshoot
// past the best/worst solve, unlike a Catmull-Rom or plain cubic spline.

export interface Pt {
  x: number;
  y: number;
}

/** Fritsch–Carlson tangents (dy/dx) for points with strictly increasing x. */
export function monotoneTangents(pts: readonly Pt[]): number[] {
  const n = pts.length;
  if (n < 2) return n === 1 ? [0] : [];
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    secant.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  }
  const t: number[] = new Array<number>(n);
  t[0] = secant[0];
  t[n - 1] = secant[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // A local extremum (secants change sign or one is flat) gets a flat
    // tangent; otherwise start from the average of the two secants.
    t[i] = secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (secant[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / secant[i];
    const b = t[i + 1] / secant[i];
    const h = a * a + b * b;
    // Restrict (a, b) to the circle of radius 3 — sufficient for
    // monotonicity of the Hermite segment.
    if (h > 9) {
      const tau = 3 / Math.sqrt(h);
      t[i] = tau * a * secant[i];
      t[i + 1] = tau * b * secant[i];
    }
  }
  return t;
}

/** SVG path ("M … C …") through `pts` using monotone cubic Béziers. */
export function monotonePath(pts: readonly Pt[]): string {
  const n = pts.length;
  if (n === 0) return '';
  const f = (v: number) => v.toFixed(2);
  if (n === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  const t = monotoneTangents(pts);
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const third = (q.x - p.x) / 3;
    d += `C${f(p.x + third)},${f(p.y + t[i] * third)} ${f(q.x - third)},${f(q.y - t[i + 1] * third)} ${f(q.x)},${f(q.y)}`;
  }
  return d;
}

/** Splits a series at null entries into runs of consecutive points. */
export function segmentsOf(values: readonly (number | null)[], xAt: (i: number) => number, yAt: (v: number) => number): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] = [];
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (run.length) out.push(run);
      run = [];
      return;
    }
    run.push({ x: xAt(i), y: yAt(v) });
  });
  if (run.length) out.push(run);
  return out;
}
