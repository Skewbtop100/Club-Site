export default function Header({
  competitionName,
  eventLabel,
  attemptIndex,
  totalAttempts,
}: {
  competitionName: string;
  eventLabel: string;
  attemptIndex: number; // 0-based
  /** Normally always 5 (real Ao5) — can be lower under the solve page's
   *  ?__testAttempts= testing override. */
  totalAttempts: number;
}) {
  return (
    <>
      <div className="oc-solve-header">
        <div>
          <p style={{ font: '600 13px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
            {competitionName} · {eventLabel}
          </p>
          <p
            style={{
              marginTop: 4,
              font: '500 9px var(--oc-font-mono), monospace',
              letterSpacing: '.14em',
              color: '#8A8474',
            }}
          >
            ОРОЛДЛОГО {attemptIndex + 1} / {totalAttempts}
          </p>
        </div>
        <div className="oc-solve-pips" aria-hidden>
          {Array.from({ length: totalAttempts }).map((_, i) => {
            const cls = i < attemptIndex ? 'oc-solve-pip-done' : i === attemptIndex ? 'oc-solve-pip-current' : 'oc-solve-pip-pending';
            return <span key={i} className={`oc-solve-pip ${cls}`} />;
          })}
        </div>
      </div>
      <div className="oc-solve-divider" />
    </>
  );
}
