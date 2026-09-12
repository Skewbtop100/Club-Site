'use client';

import { useScreenFill } from './ScreenFill';

/** The beat between the last chunk of the scramble and the cover.
 *
 *  WHY IT EXISTS: the reveal used to hand straight over to the cover
 *  hold, whose eight seconds start the instant it renders. At that
 *  moment the athlete has just finished applying the last chunk and is
 *  still holding the cube — so the first part of a hold a judge measures
 *  went on finding the cover and getting the cube under it. The same
 *  problem the attempt intro solves in front of the timer check, in the
 *  other place the run asks for something physical without warning.
 *
 *  IT IS INSIDE THE CLIP. Recording started at zeroDisplay and runs
 *  unbroken through the reveal, this screen, the cover and the solve; it
 *  stops only at the end of the closing hold. Nothing here starts or
 *  stops anything — there is no recorder call in this file, and none is
 *  wanted. The five seconds are simply five more seconds of the same
 *  continuous video, which is what a judge needs them to be: a gap in the
 *  recording between the scramble and the cover is exactly the gap an
 *  unverifiable cube could be swapped in.
 *
 *  NO PREVIEW, and that is what earns it the colour fill. See
 *  useScreenFill for the rule. */
const PREP_SECONDS = 5;

export default function CoverPrepStage({ onDone }: { onDone: () => void }) {
  const fill = useScreenFill(PREP_SECONDS, onDone);

  return (
    <div className="oc-solve-prep">
      {fill}
      <span className="oc-solve-prep-eyebrow">БЭЛТГЭЛ</span>
      <p className="oc-solve-prep-say">Хольсон шоогоо ковертой бэлдэж байрлуулаарай.</p>
    </div>
  );
}
