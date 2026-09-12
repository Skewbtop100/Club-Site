'use client';

import { useEffect, useState } from 'react';

/** The beat before an attempt starts — "you are about to solve attempt N,
 *  get your timer ready".
 *
 *  WHY IT EXISTS: pressing ОРОЛДЛОГОО ЭХЛЭХ used to land straight on the
 *  timer check, whose eight seconds start counting the moment it renders.
 *  An athlete who had not already picked up their timer spent the first
 *  half of a hold a judge measures reaching for it. This screen gives
 *  them that moment somewhere it costs nothing.
 *
 *  IT IS NOT ON THE RECORDING, and that is the point of putting it here
 *  rather than inside the hold. The clip still begins at the timer check,
 *  where the evidence begins — see the recording-start effect in
 *  page.tsx. Nothing that happens on this screen is evidence of anything,
 *  so there is no camera preview on it either: an athlete fumbling for
 *  their timer is not something a judge needs five seconds of, on every
 *  attempt, on every clip.
 *
 *  It advances on its own. There is no decision to make here, so a button
 *  would only be a second press between the athlete and the same place. */
const INTRO_SECONDS = 5;

export default function AttemptIntroStage({
  attemptNumber,
  onDone,
}: {
  /** 1-based, the attempt that is about to start. */
  attemptNumber: number;
  onDone: () => void;
}) {
  const [remaining, setRemaining] = useState(INTRO_SECONDS);

  useEffect(() => {
    const interval = setInterval(() => setRemaining((r) => Math.max(r - 1, 0)), 1000);
    const t = setTimeout(onDone, INTRO_SECONDS * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-intro">
      <span className="oc-solve-intro-eyebrow">БЭЛТГЭЛ</span>
      <p className="oc-solve-intro-say">
        {attemptNumber}-р эвлүүлэлт эхлэх гэж байна. Цагаа 0.00 болгож шалгуулахдаа бэлдээрэй.
      </p>
      {/* The count is here so the athlete can pace the one physical thing
          this screen asks of them — reaching for a timer — rather than
          being surprised by the hold starting. Quiet: it is a hint, not a
          clock anyone is measured against. The hold's count is that. */}
      <span className="oc-solve-intro-count" aria-hidden>
        {remaining}
      </span>
    </div>
  );
}
