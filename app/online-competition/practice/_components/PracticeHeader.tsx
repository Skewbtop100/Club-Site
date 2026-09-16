'use client';

/** The practice run's bar.
 *
 *  A MIRROR OF SolveHeader, class for class. Every class name here is that
 *  component's — .oc-solve-bar and its children — so the bar is the same
 *  fixed 56px, with the same paddings, the same button metrics, and the
 *  same ≤620px and ≤460px overrides. Nothing in theme.css was added or
 *  changed for it.
 *
 *  WHY NOT REUSE SolveHeader ITSELF: it hardcodes the badge
 *  "ТЭМЦЭЭНИЙ ОРЧИН" — competition environment. Telling an athlete on a
 *  practice run that they are in a competition environment is the one
 *  sentence this whole feature exists to prevent. Making that badge a prop
 *  would be a change to a competition solve-flow component, which this
 *  changeset may not make, so the markup is mirrored and the two words that
 *  must differ, differ.
 *
 *  THE GEOMETRY IS IDENTICAL AND THE WORDS ARE NOT. That is the intended
 *  split: an athlete must learn the same layout, and must not be told they
 *  are somewhere they are not.
 *
 *  ЗОГСООХ is here, rendered and disabled, exactly as it is in a
 *  competition — it keeps the right-hand pair's width identical, and it is
 *  equally true here: pausing is not built. */
export default function PracticeHeader({
  eventLabel,
  attempt,
  onExit,
}: {
  eventLabel: string;
  /** Null on the lobby and the closing screen — the two screens that are
   *  not inside the attempt. A practice run is one attempt, so when it is
   *  shown it reads "1-Р ОРОЛДЛОГО / 1" with a single pip: the same block
   *  in the same place, saying something true. */
  attempt: { index: number; total: number } | null;
  onExit: () => void;
}) {
  return (
    <div className="oc-solve-bar">
      <div className="oc-solve-bar-left">
        <span className="oc-solve-bar-badge">ТУРШИЛТЫН ОРЧИН</span>
        <span className="oc-solve-bar-rule" aria-hidden />
        {/* SolveHeader's two-span split is kept even though there is no
            competition name to drop: the inner span is what the ≤460px rule
            hides, and keeping the structure means the narrow layout behaves
            the same way without a second rule to maintain. */}
        <span className="oc-solve-bar-where">
          <span className="oc-solve-bar-comp">ТУРШИЛТ · </span>
          {eventLabel}
        </span>
      </div>

      <div className="oc-solve-bar-right">
        {attempt && (
          <>
            <span className="oc-solve-bar-attempt">
              {attempt.index + 1}-Р ОРОЛДЛОГО / {attempt.total}
            </span>
            <div className="oc-solve-bar-pips" aria-hidden>
              {Array.from({ length: attempt.total }).map((_, i) => (
                <span
                  key={i}
                  className={`oc-solve-bar-pip${
                    i < attempt.index ? ' oc-solve-bar-pip-done' : i === attempt.index ? ' oc-solve-bar-pip-now' : ''
                  }`}
                />
              ))}
            </div>
          </>
        )}

        <button
          type="button"
          className="oc-solve-bar-btn"
          disabled
          title="Түр зогсоох боломж удахгүй нэмэгдэнэ."
        >
          ЗОГСООХ
        </button>
        <button type="button" className="oc-solve-bar-btn oc-solve-bar-btn-exit" onClick={onExit}>
          ГАРАХ
        </button>
      </div>
    </div>
  );
}
