'use client';

import { useEffect, useState } from 'react';
import { splitScrambleIntoGroups } from '../_lib/scrambleChunks';

const GROUP_SIZE = 5;
const GROUP_DISPLAY_MS = 5000;

function groupLabel(groups: string[], index: number): string {
  const movesPerGroup = groups.map((g) => g.split(' ').filter(Boolean).length);
  const start = movesPerGroup.slice(0, index).reduce((a, b) => a + b, 0) + 1;
  const end = start + movesPerGroup[index] - 1;
  return start === end ? `${start}` : `${start}-${end}`;
}

/** "scrambleReveal" — shows the scramble in fixed-size groups of 5 moves,
 *  ONE group at a time (each replaces the last, not stacking), 5 seconds
 *  per group. Group count is dynamic from the actual scramble length, not
 *  a fixed 4 — a longer scramble just runs through more groups. */
export default function RevealStage({
  scramble,
  onDone,
  videoRef,
}: {
  scramble: string;
  onDone: () => void;
  videoRef: (el: HTMLVideoElement | null) => void;
}) {
  const groups = splitScrambleIntoGroups(scramble, GROUP_SIZE);
  const [currentGroup, setCurrentGroup] = useState(0);

  useEffect(() => {
    setCurrentGroup(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < groups.length; i++) {
      timers.push(setTimeout(() => setCurrentGroup(i), i * GROUP_DISPLAY_MS));
    }
    timers.push(setTimeout(onDone, groups.length * GROUP_DISPLAY_MS));
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
            СКРАМБЛ · ХЭСЭГ {currentGroup + 1} / {groups.length}
          </p>
          <div className="oc-solve-chunk-bar-track" style={{ marginTop: 8 }}>
            {groups.map((_, i) => (
              <span
                key={i}
                className={`oc-solve-chunk-bar${i <= currentGroup ? ' oc-solve-chunk-bar-filled' : ''}`}
              />
            ))}
          </div>
        </div>

        {/* Recording already started (see page.tsx's effect on entering
            zeroDisplay, before this stage) — this mini preview + pulsing
            dot is just visual confirmation for the athlete that the
            scramble application itself is being captured, not only the
            solve. Kept small and off to the side so it doesn't crowd the
            scramble tiles. */}
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

      {/* key={currentGroup} retriggers the fade-in on every group swap;
          only the CURRENT group renders — earlier groups don't stack. */}
      <div key={currentGroup} className="oc-solve-chunk-group" style={{ flex: 1 }}>
        <span style={{ font: '500 8px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#5B564B' }}>
          {groupLabel(groups, currentGroup)}
        </span>
        <div className="oc-solve-move-row">
          {groups[currentGroup]
            .split(' ')
            .filter(Boolean)
            .map((move, j) => (
              <span key={j} className="oc-solve-move-tile">
                {move}
              </span>
            ))}
        </div>
      </div>

      <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#5B564B' }}>
        Хэсэг бүр 5 секундын турш дараалан харагдана.
      </p>
    </div>
  );
}
