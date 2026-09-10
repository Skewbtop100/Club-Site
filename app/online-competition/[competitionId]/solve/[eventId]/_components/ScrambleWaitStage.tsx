'use client';

/** The gap between attempts, while this attempt's scramble is being
 *  fetched — and where the run parks if that fetch fails.
 *
 *  WHY IT EXISTS: the run used to advance into zeroDisplay the moment the
 *  previous attempt was entered, without waiting for the fetch it had just
 *  fired off. zeroDisplay starts the recording, and `scramble` was never
 *  cleared, so a fetch that failed left the PREVIOUS attempt's scramble on
 *  screen: the athlete solved an already-used scramble on camera and only
 *  the judge ever found out. Nothing may enter zeroDisplay without a
 *  scramble in hand; this is where the run waits instead.
 *
 *  It NEVER offers a way off the page. Every attempt already solved is
 *  held in memory as a video blob and is uploaded only at the end of the
 *  run, so a link away from here would throw away work that cannot be
 *  recovered. Retry is the only action, and the note says what is at
 *  stake. */
export default function ScrambleWaitStage({
  attemptNumber,
  error,
  recordedAttempts,
  onRetry,
}: {
  /** 1-based, the attempt this scramble is for. */
  attemptNumber: number;
  /** '' while the request is in flight. Either the server's own Mongolian
   *  explanation (a round that closed mid-run) or this page's network
   *  message. */
  error: string;
  /** Attempts already solved and held in memory for this run. */
  recordedAttempts: number;
  onRetry: () => void;
}) {
  return (
    <div className="oc-solve-go">
      <div>
        <p
          style={{
            font: '500 9px var(--oc-font-mono), monospace',
            letterSpacing: '.2em',
            color: error ? '#D8402C' : '#8A8474',
          }}
        >
          {error ? 'СКРАМБЛ ИРСЭНГҮЙ' : 'СКРАМБЛ АЧААЛЖ БАЙНА'}
        </p>
        <p
          style={{
            marginTop: 12,
            font: '400 14px var(--oc-font-heading), sans-serif',
            color: '#F4F1EA',
            lineHeight: 1.6,
          }}
        >
          {error || `${attemptNumber}-р оролдлогын скрамблыг авч байна...`}
        </p>
        {/* The whole reason this screen has no way out. Shown only when
            there is something to lose. */}
        {error !== '' && recordedAttempts > 0 && (
          <p
            style={{
              marginTop: 14,
              font: '400 12px var(--oc-font-heading), sans-serif',
              color: '#8A8474',
              lineHeight: 1.6,
            }}
          >
            Өмнөх {recordedAttempts} оролдлогын бичлэг энэ хуудсанд хадгалагдаж байна. Хуудсыг хаах юм уу
            сэргээвэл тэд устана — энд үлдээд дахин оролдоно уу.
          </p>
        )}
      </div>

      {error !== '' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="oc-solve-btn-confirm"
            style={{ width: 'auto', padding: '12px 24px' }}
            onClick={onRetry}
          >
            Дахин оролдох
          </button>
          <p
            style={{
              font: '400 11px var(--oc-font-heading), sans-serif',
              color: '#8A8474',
              textAlign: 'center',
            }}
          >
            Дахин оролдсоор байвал зохион байгуулагчид хандана уу.
          </p>
        </div>
      )}
    </div>
  );
}
