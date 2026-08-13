'use client';

// Hand-rolled inline SVG line chart for a continuous Ao5 trend — same
// technique as the Timer's Stats tab (app/timer/page.tsx,
// `MobileLineChart`): no chart library in this codebase, manual M/L path
// string + viewBox scaling.
//
// aspect-ratio (not a fixed pixel height) keeps the viewBox's proportions
// wherever this is mounted, so a wide container doesn't distort slope —
// slope carries meaning for a trajectory ("is this athlete trending
// faster"). A `mode="count"` bar variant briefly lived here for
// /practice's Activity card; that card has since moved to a calendar-
// heatmap-style grid (components/practice/MonthlyActivityGrid.tsx) since
// a bar chart didn't read well with only 1-2 non-zero days in a typical
// month. This component is back to its original single purpose: Ao5.

export default function PracticeTrendChart({
  points,
}: {
  points: { date: string; value: number }[];
}) {
  const n = points.length;
  if (n < 2) {
    return (
      <div style={{
        minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted)', fontSize: '0.82rem', textAlign: 'center', padding: '1rem',
      }}>
        Need at least 2 practice sessions to chart a trend.
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const minMs = Math.min(...values);
  const maxMs = Math.max(...values);
  const pad = (maxMs - minMs) * 0.12 || 200;
  const yMin = Math.max(0, minMs - pad);
  const yMax = maxMs + pad;

  const W = 400, H = 180, padL = 34, padR = 8, padT = 10, padB = 10;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xAt = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + (yMax === yMin ? innerH / 2 : (1 - (v - yMin) / (yMax - yMin)) * innerH);

  let d = '';
  points.forEach((p, i) => {
    d += `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)} `;
  });

  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  const fmtTick = (ms: number) => (ms / 1000).toFixed(1) + 's';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, minHeight: 140, display: 'block' }}
    >
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          <text x={2} y={yAt(t) + 3} fontSize={9} fill="rgba(255,255,255,0.4)" fontFamily="monospace">{fmtTick(t)}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="#a78bfa" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={xAt(i)} cy={yAt(p.value)} r={2.2} fill="#a78bfa" />
      ))}
    </svg>
  );
}
