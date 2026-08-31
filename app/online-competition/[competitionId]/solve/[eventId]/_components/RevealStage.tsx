'use client';

import { useEffect, useState } from 'react';
import { splitScrambleIntoChunks } from '../_lib/scrambleChunks';

const REVEAL_INTERVAL_MS = 2000;
const HOLD_AFTER_LAST_MS = 8000;

function chunkLabel(chunks: string[], index: number): string {
  const movesPerChunk = chunks.map((c) => c.split(' ').filter(Boolean).length);
  const start = movesPerChunk.slice(0, index).reduce((a, b) => a + b, 0) + 1;
  const end = start + movesPerChunk[index] - 1;
  return start === end ? `${start}` : `${start}-${end}`;
}

export default function RevealStage({
  scramble,
  onDone,
  videoRef,
}: {
  scramble: string;
  onDone: () => void;
  videoRef: (el: HTMLVideoElement | null) => void;
}) {
  const chunks = splitScrambleIntoChunks(scramble, 4);
  const [revealedCount, setRevealedCount] = useState(1);

  useEffect(() => {
    setRevealedCount(1);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 2; i <= 4; i++) {
      timers.push(setTimeout(() => setRevealedCount(i), (i - 1) * REVEAL_INTERVAL_MS));
    }
    timers.push(setTimeout(onDone, 3 * REVEAL_INTERVAL_MS + HOLD_AFTER_LAST_MS));
    return () => timers.forEach(clearTimeout);
    // Deliberately keyed only on `scramble` — `onDone` is a fresh closure
    // every render from the parent, and re-running this effect on every
    // parent render would restart the reveal timers mid-sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scramble]);

  return (
    <div className="oc-solve-reveal">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#8A8474' }}>
            СКРАМБЛ · ХЭСЭГ
          </p>
          <div className="oc-solve-chunk-bar-track" style={{ marginTop: 8 }}>
            {chunks.map((_, i) => (
              <span
                key={i}
                className={`oc-solve-chunk-bar${i < revealedCount ? ' oc-solve-chunk-bar-filled' : ''}`}
              />
            ))}
          </div>
        </div>

        {/* Recording already started (see page.tsx's effect on entering
            this stage) — this mini preview + pulsing dot is just visual
            confirmation for the athlete that the scramble application
            itself is being captured, not only the solve. Kept small and
            off to the side so it doesn't crowd the scramble chunks. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div className="oc-solve-camera-box-mini">
            <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="oc-solve-rec-dot" aria-hidden />
            <span
              style={{
                font: '500 8px var(--oc-font-mono), monospace',
                letterSpacing: '.14em',
                color: '#D8402C',
                whiteSpace: 'nowrap',
              }}
            >
              БИЧИЖ БАЙНА
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        {chunks.slice(0, revealedCount).map((chunk, i) => (
          <div key={i} className="oc-solve-chunk-group">
            <span
              style={{ font: '500 8px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#5B564B' }}
            >
              {chunkLabel(chunks, i)}
            </span>
            <div className="oc-solve-move-row">
              {chunk
                .split(' ')
                .filter(Boolean)
                .map((move, j) => (
                  <span key={j} className="oc-solve-move-tile">
                    {move}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>

      <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#5B564B' }}>
        Хэсэг бүр дараалан гарна. Дөрөв дэх нь 8 секунд тогтоод скрамбл бүхэлдээ алга болно.
      </p>
    </div>
  );
}
