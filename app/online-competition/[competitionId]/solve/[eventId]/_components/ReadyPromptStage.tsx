'use client';

/** "readyPrompt" — replaces the old "goNow" flash. Does NOT auto-advance;
 *  the athlete clicks when actually ready. There's no forced 3-2-1-GO
 *  moment anymore — clicking here goes straight into the recording/no-
 *  visible-timer "rec" stage. Recording itself has been running
 *  continuously since zeroDisplay; this stage doesn't start or stop
 *  anything. */
export default function ReadyPromptStage({
  videoRef,
  onDone,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  onDone: () => void;
}) {
  return (
    <div className="oc-solve-go">
      <div>
        <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#8A8474' }}>
          БЭЛЭН БОЛОХ
        </p>
        <div className="oc-solve-camera-box" style={{ marginTop: 10 }}>
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          <span className="oc-solve-corner oc-solve-corner-tl" aria-hidden />
          <span className="oc-solve-corner oc-solve-corner-br" aria-hidden />
        </div>
        <p style={{ marginTop: 10, font: '400 12px var(--oc-font-heading), sans-serif', color: '#8A8474', textAlign: 'center' }}>
          Тавцан дээрх шоо, гар хоёулаа камерт харагдаж байгаа эсэхээ шалгана уу.
        </p>
      </div>

      <button type="button" className="oc-solve-btn-confirm" onClick={onDone}>
        Эвлүүлж эхлүүлэх
      </button>
    </div>
  );
}
