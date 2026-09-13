'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { splitScrambleIntoChunks } from '../_lib/scrambleChunks';

const GROUP_DISPLAY_MS = 5000;

function groupLabel(groups: string[], index: number): string {
  const movesPerGroup = groups.map((g) => g.split(' ').filter(Boolean).length);
  const start = movesPerGroup.slice(0, index).reduce((a, b) => a + b, 0) + 1;
  const end = start + movesPerGroup[index] - 1;
  return start === end ? `${start}` : `${start}-${end}`;
}

/** "scrambleReveal" — shows the scramble in chunks, ONE at a time (each
 *  replaces the last, not stacking), 5 seconds per chunk.
 *
 *  THE CHUNKS ARE EVEN, and the count follows the scramble rather than
 *  the size being fixed. A fixed size of five split an 11-move 2x2
 *  scramble into 5/5/1 — a final chunk holding a single move, on screen
 *  for the same five seconds as a full one. splitScrambleIntoChunks
 *  chooses the count from the length and spreads the moves across it; see
 *  scrambleChunks.ts for the rule and why a long scramble gets more than
 *  four.
 *
 *  The mockup's own header: ХОЛИЛТ, one tick per chunk, and the seconds
 *  left on THIS chunk. The countdown is a READOUT of the 5-second clock
 *  that was already running — the timers that advance the groups are
 *  untouched, and both it and they come from GROUP_DISPLAY_MS.
 *
 *  A PREVIEW, SMALL, AT THE TOP. This screen carried a 74px camera off to
 *  the side once and it was removed on the grounds that the mockup's
 *  reveal is the scramble alone. That was wrong for a reason the mockup
 *  could not show: the reveal and the cover after it are forty seconds —
 *  the longest stretch of the clip — during which the athlete is looking
 *  at moves, not at a camera, and has no way to tell the recording is
 *  still running. A camera that died here costs them the whole attempt and
 *  they find out at the keypad.
 *
 *  It is a REASSURANCE, not a framing tool: the athlete aimed this shot on
 *  the lobby and checks it again on the timer check. So it is small,
 *  dimmed, and above the header rather than beside the scramble — see
 *  .oc-solve-reveal-rec for how it is kept from competing with the tiles.
 *
 *  Recording is unaffected either way, in both directions: MediaRecorder
 *  reads the camera track and has never read a <video> element, so adding
 *  one here neither starts, stops nor alters the clip. */
export default function RevealStage({
  scramble,
  videoRef,
  onDone,
}: {
  scramble: string;
  videoRef: (el: HTMLVideoElement | null) => void;
  onDone: () => void;
}) {
  const groups = splitScrambleIntoChunks(scramble);
  const [currentGroup, setCurrentGroup] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(GROUP_DISPLAY_MS / 1000);

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

  // Display only. It restarts with each chunk and never advances one.
  useEffect(() => {
    setSecondsLeft(GROUP_DISPLAY_MS / 1000);
    const id = setInterval(() => setSecondsLeft((s) => Math.max(s - 1, 0)), 1000);
    return () => clearInterval(id);
  }, [currentGroup]);

  const moves = groups[currentGroup].split(' ').filter(Boolean);

  return (
    <div className="oc-solve-reveal">
      {/* THE SAME SIGNAL AS THE SOLVE SCREEN'S, deliberately: the pulsing
          dot and the same two words, from the same two classes. A
          reassurance only reassures if it is recognised, and a bare dot
          somewhere else on the screen would be a second thing to learn
          for one fact. What is NOT reused is the solve screen's
          positioning — .oc-solve-rec-flag pins itself to the corner of a
          full-bleed video, which is that screen's job, not this one's. */}
      <div className="oc-solve-reveal-rec">
        <div className="oc-solve-reveal-cam">
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
        </div>
        <span className="oc-solve-rec-dot" aria-hidden />
        <span className="oc-solve-rec-flag-text">БИЧИЖ БАЙНА</span>
      </div>

      <div className="oc-solve-reveal-head">
        <span className="oc-solve-reveal-eyebrow">ХОЛИЛТ</span>
        <div className="oc-solve-reveal-clock">
          <div className="oc-solve-chunk-bar-track">
            {groups.map((_, i) => (
              <span
                key={i}
                className={`oc-solve-chunk-bar${i <= currentGroup ? ' oc-solve-chunk-bar-filled' : ''}`}
              />
            ))}
          </div>
          <span className="oc-solve-reveal-rule" aria-hidden />
          <div className="oc-solve-reveal-left">
            <span className="oc-solve-reveal-n">{secondsLeft}</span>
            <span className="oc-solve-reveal-unit">СЕК</span>
          </div>
        </div>
      </div>

      {/* key={currentGroup} retriggers the fade-in on every group swap;
          only the CURRENT group renders — earlier groups don't stack. */}
      <div key={currentGroup} className="oc-solve-chunk-group">
        <span style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#6E6A62' }}>
          {groupLabel(groups, currentGroup)}
        </span>
        {/* ONE ROW, ALWAYS. --oc-chunk-n is how many moves this chunk
            holds, and the row is a grid of exactly that many equal
            columns — so there is no second row for a move to wrap onto,
            whatever the chunk length or the screen width. The tiles take
            68px where there is room and divide the width where there is
            not. */}
        <div
          className="oc-solve-move-row"
          style={{ '--oc-chunk-n': moves.length } as CSSProperties}
        >
          {moves.map((move, j) => (
            <span key={j} className="oc-solve-move-tile">
              {move}
            </span>
          ))}
        </div>
      </div>

      <p className="oc-solve-reveal-note">Хэсэг тус бүр 5 секунд харагдана.</p>
    </div>
  );
}
