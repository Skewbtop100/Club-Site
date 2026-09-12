'use client';

import { useEffect, useState } from 'react';

/** THE INSPECTION AND THE SOLVE, ON ONE SCREEN.
 *
 *  It replaces three: `count` (a 130px countdown), `go` (a full-bleed
 *  flash) and the old `rec`. They were three screens for one continuous
 *  moment — the athlete uncovers the cube, looks at it, and starts
 *  turning — and cutting that moment into three made the platform narrate
 *  something it has no business narrating. Worse, the flash TOLD the
 *  athlete when to begin, which WCA does not: inspection is up to fifteen
 *  seconds, and going at six is a legitimate solve, not an early start.
 *
 *  NOTHING HERE TELLS THEM TO BEGIN. There is no cue, no "start now", no
 *  instruction. The athlete uncovers, inspects and goes whenever they
 *  choose; the only thing they are asked to do is press the finish button
 *  when they are done, whether that is at nine seconds or ninety.
 *
 *  THE COUNTER COUNTS UP, not down, and that is not cosmetic. A countdown
 *  is a deadline — it says something happens at zero, and here nothing
 *  does. Counting up is a reading of elapsed time, which is what an
 *  athlete actually wants to know and all this screen can honestly offer.
 *
 *  IT WRITES NO PENALTY, and nothing about it can. WCA gives +2 past
 *  fifteen seconds and a DNF past seventeen, and this platform CAN carry
 *  both — `penalty: '+2' | 'DNF'` is a stored field, the review route
 *  sets it, and effectiveAttemptTime applies it for every scorer. But it
 *  is a JUDGE'S field: firestore.rules pins `penalty == null` on create
 *  and gives athletes no update at all. So this screen states no rule,
 *  names no penalty and applies none. Fifteen seconds passing does
 *  nothing at all here. An athlete who inspects longer does it on camera,
 *  and the judge's existing +2 is what answers that.
 *
 *  IT STARTS AND STOPS NO RECORDING. The clip has been running since the
 *  opening hold and runs on through the closing one. It already covered
 *  all three of the screens merged here, so merging them moves neither
 *  end of it. */

/** The WCA inspection window, and the length of the counter. NOT a stage
 *  duration any more: nothing advances when it is reached, so there is no
 *  timeout here and no `onDone` for one to call. */
const INSPECTION_WINDOW_SECONDS = 15;

/** The judge's spoken cues. A judge calls "8 seconds" and "12 seconds"
 *  during inspection, so those are the two moments an athlete is used to
 *  hearing — carried here as the counter's own colour and nothing else.
 *  No words, no sound, no border. */
const CUE_AMBER_AT = 8;
const CUE_RED_AT = 12;

/** Which of the three cue colours the counter is wearing at `elapsed`.
 *
 *  THE COLOUR IS ON THE DIGITS, not on the camera frame. It used to walk
 *  the preview's border, and the border is the wrong carrier twice over:
 *  it is the edge of what is being recorded — the one thing on this
 *  screen that already means something specific — and a border is a large
 *  peripheral change that pulls the eye across the whole frame at the
 *  exact moment the athlete should be looking at a cube. The cue is a
 *  fact about the counter's value, so it belongs on the counter. */
function cueClass(elapsed: number): string {
  if (elapsed >= CUE_RED_AT) return ' oc-solve-insp-red';
  if (elapsed >= CUE_AMBER_AT) return ' oc-solve-insp-amber';
  return '';
}

export default function RecStage({
  videoRef,
  onFinish,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  onFinish: () => void;
}) {
  /** Seconds since this screen opened, 1..15. It stops at the window and
   *  never advances the run. */
  const [elapsed, setElapsed] = useState(1);

  useEffect(() => {
    const id = setInterval(
      () => setElapsed((e) => Math.min(e + 1, INSPECTION_WINDOW_SECONDS)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  // AT FIFTEEN IT GOES, rather than sitting on 15 for the rest of the
  // solve. A number parked at the end of a window that has closed still
  // looks like it means something, and the only thing it could be taken
  // to mean is the penalty this platform does not apply. Fading it leaves
  // the screen as the camera and the button, which is exactly what the
  // athlete is doing by then.
  //
  // A FADE, not a removal, and a slow one: the athlete may well be
  // mid-solve at fifteen seconds, and something vanishing in the corner
  // of their eye is an interruption. It is gone by the time they could
  // look at it.
  const windowClosed = elapsed >= INSPECTION_WINDOW_SECONDS;

  return (
    <div className="oc-solve-rec">
      {/* FULL-BLEED. The camera is the screen — there is nothing else on
          it worth the space, and the athlete is checking their own framing
          against it while they inspect. */}
      <video ref={videoRef} autoPlay playsInline muted className="oc-solve-rec-feed" />

      <div className="oc-solve-rec-flag">
        <span className="oc-solve-rec-dot" aria-hidden />
        <span className="oc-solve-rec-flag-text">БИЧИЖ БАЙНА</span>
      </div>

      {/* SMALL AND PERIPHERAL, opposite the recording flag. It is a thing
          to glance at, not to watch: an athlete inspecting a cube should
          be looking at the cube. */}
      <span
        className={`oc-solve-insp${cueClass(elapsed)}${windowClosed ? ' oc-solve-insp-done' : ''}`}
        aria-hidden
      >
        {elapsed}
      </span>

      <button type="button" className="oc-solve-btn-finish" onClick={onFinish}>
        Эвлүүлэлт дууссан
      </button>

      {/* The run's only statement that it does not time the solve. Kept
          here, quiet, because this is where it has always been said and
          nowhere else says it. */}
      <p className="oc-solve-rec-note">
        Дэлгэц дээр цаг харагдахгүй. Эвлүүлж дуусаад товч дээр дарж цагаа бичиж оруулна.
      </p>
    </div>
  );
}
