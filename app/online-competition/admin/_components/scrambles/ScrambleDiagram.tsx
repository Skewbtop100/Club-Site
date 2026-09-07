'use client';

import { useEffect, useRef, useState } from 'react';
import ScramblePreview from '@/components/shared/ScramblePreview';

// Cube-state diagram for one scramble row in the Холилт tab.
//
// The render itself is components/shared/ScramblePreview — the exact same
// component the club's Daily Practice judging flow uses (see the preview
// block in components/admin/ResultsEntryTab.tsx), so the puzzle style,
// colours and proportions here are that component's, not a second
// implementation. This file adds nothing to the drawing; it only decides
// WHEN to mount it.
//
// Why the gating matters: ScramblePreview mounts a @cubing/twisty
// TwistyPlayer, which is one WebGL context per instance. This tab renders
// a whole round's worth of scrambles at once — five per group, and a
// 3x3x3 event with two rounds of two groups is twenty rows — while
// browsers cap simultaneous WebGL contexts in the mid-teens and silently
// drop the OLDEST context once past it, blanking diagrams the admin has
// already scrolled to. Mounting only what is near the viewport keeps the
// live count to roughly what fits on screen, and also avoids building
// twenty players up front.
//
// The margin is deliberately generous so a diagram is ready before it
// scrolls into view and is only torn down well after it leaves.
const ROOT_MARGIN = '400px 0px';

export default function ScrambleDiagram({ eventId, scramble }: { eventId: string; scramble: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // No IntersectionObserver (very old browser, or a test environment):
    // fall back to always-mounted rather than never showing a diagram.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="oc-sc-scrdiag" aria-hidden>
      {visible && <ScramblePreview eventId={eventId} scramble={scramble} />}
    </div>
  );
}
