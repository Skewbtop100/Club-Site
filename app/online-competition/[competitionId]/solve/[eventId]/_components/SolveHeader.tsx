'use client';

/** The competition-environment bar: fixed, 56px, on every screen of the
 *  run.
 *
 *  Replaces a header that appeared on ten stages out of thirteen and
 *  vanished on the rest. The bar is the frame the whole flow sits in —
 *  it says the athlete is inside a competition environment, which
 *  competition, and how to get out — and a frame that disappears on some
 *  screens is not a frame.
 *
 *  WHAT IS CONDITIONAL is the right-hand pair: the attempt label and the
 *  pips. They mean "attempt 3 of 5, two done", which is true while an
 *  attempt is under way and false on the lobby, the summary and the sent
 *  screen. The bar stays; the claim about an attempt goes. */
export default function SolveHeader({
  competitionName,
  eventLabel,
  roundLabel,
  attempt,
  onExit,
}: {
  competitionName: string;
  eventLabel: string;
  /** "Раунд 1", or null before the round is known. */
  roundLabel: string | null;
  /** Null on every screen that is not inside an attempt. */
  attempt: { index: number; total: number } | null;
  onExit: () => void;
}) {
  return (
    <div className="oc-solve-bar">
      <div className="oc-solve-bar-left">
        <span className="oc-solve-bar-badge">ТЭМЦЭЭНИЙ ОРЧИН</span>
        <span className="oc-solve-bar-rule" aria-hidden />
        {/* Two spans, not one string: on a narrow screen the competition
            name is the half worth dropping. It is context the athlete
            already has — they chose it — while the event and the round are
            what changes between runs, and truncating the whole line left
            "Улаанбаатар Онл…" and nothing else. */}
        <span className="oc-solve-bar-where">
          <span className="oc-solve-bar-comp">{competitionName} · </span>
          {eventLabel}
          {roundLabel ? ` · ${roundLabel}` : ''}
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

        {/* Rendered, disabled, and honest about it. Pausing is only ever
            safe on a stage with no recording running, and deciding which
            those are is its own changeset — a button that looks live and
            does nothing is worse than one that says it is not ready. */}
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
