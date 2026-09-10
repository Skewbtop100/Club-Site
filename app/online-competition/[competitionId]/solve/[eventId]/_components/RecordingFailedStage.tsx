'use client';

/** The camera stopped being a camera — and the run stops here rather than
 *  carrying on without it.
 *
 *  TWO WAYS IN, and the difference matters to the athlete:
 *    'start' — MediaRecorder would not start for this attempt (the stream
 *              died while the phone was locked, another app took the
 *              camera, permission was revoked). Nothing has been solved
 *              yet, so this costs them nothing but the interruption.
 *    'empty' — the attempt WAS solved, and what came back was an empty
 *              file. The solve cannot be kept: the video is the evidence,
 *              and a submission without one is a submission a judge has to
 *              reject. This attempt has to be solved again.
 *
 *  Before this existed the page ignored both: it proceeded into the
 *  attempt and uploaded a 0-byte video, and nobody found out until a judge
 *  opened it.
 *
 *  Like ScrambleWaitStage, this screen offers NO way off the page — every
 *  attempt already solved is a video blob held in memory until the end of
 *  the run. */
export default function RecordingFailedStage({
  reason,
  attemptNumber,
  cameraError,
  hasCamera,
  recordedAttempts,
  videoRef,
  onReconnectCamera,
  onRestartAttempt,
}: {
  reason: 'start' | 'empty';
  /** 1-based, the attempt that has to be (re)done. */
  attemptNumber: number;
  /** The recorder's own message, when it has one. */
  cameraError: string | null;
  /** True once a live stream is in hand again — until then, restarting
   *  would just fail the same way. */
  hasCamera: boolean;
  /** Attempts already solved and held in memory for this run. */
  recordedAttempts: number;
  videoRef: (el: HTMLVideoElement | null) => void;
  onReconnectCamera: () => void;
  onRestartAttempt: () => void;
}) {
  return (
    <div className="oc-solve-go">
      <div>
        <p
          style={{
            font: '500 9px var(--oc-font-mono), monospace',
            letterSpacing: '.2em',
            color: '#D8402C',
          }}
        >
          {reason === 'empty' ? 'БИЧЛЭГ ХАДГАЛАГДСАНГҮЙ' : 'КАМЕР БИЧЖ ЭХЭЛСЭНГҮЙ'}
        </p>
        <p
          style={{
            marginTop: 12,
            font: '400 14px var(--oc-font-heading), sans-serif',
            color: '#F4F1EA',
            lineHeight: 1.6,
          }}
        >
          {reason === 'empty'
            ? `${attemptNumber}-р оролдлогын бичлэг хоосон гарлаа. Бичлэггүй оролдлогыг шүүгч хүлээж авахгүй тул энэ оролдлогыг дахин хийх шаардлагатай.`
            : `${attemptNumber}-р оролдлогыг бичиж эхэлж чадсангүй. Камераа шалгаад дахин эхлүүлнэ үү.`}
        </p>
        {cameraError && (
          <p style={{ marginTop: 10, font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>
            {cameraError}
          </p>
        )}
        {/* The preview is the check: the athlete needs to SEE the camera
            working again before restarting, not press a button and hope.
            Capped narrow so the restart button below it stays on screen on
            a short phone — this screen has more to say than cameraSetup
            does, and the button is the point of it. */}
        <div className="oc-solve-camera-box" style={{ marginTop: 14, maxWidth: 220 }}>
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          <span className="oc-solve-corner oc-solve-corner-tl" aria-hidden />
          <span className="oc-solve-corner oc-solve-corner-br" aria-hidden />
        </div>
        {recordedAttempts > 0 && (
          <p
            style={{
              marginTop: 14,
              font: '400 12px var(--oc-font-heading), sans-serif',
              color: '#8A8474',
              lineHeight: 1.6,
            }}
          >
            Өмнөх {recordedAttempts} оролдлогын бичлэг энэ хуудсанд хадгалагдаж байна. Хуудсыг хаах юм уу
            сэргээвэл тэд устана — энд үлдээд үргэлжлүүлнэ үү.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          className="oc-solve-btn-confirm"
          style={{ width: 'auto', padding: '12px 24px' }}
          disabled={!hasCamera}
          onClick={onRestartAttempt}
        >
          {attemptNumber}-р оролдлогыг дахин эхлүүлэх
        </button>
        <button
          type="button"
          className="oc-solve-btn-redo"
          style={{ flex: 'none', width: 'auto', padding: '10px 20px' }}
          onClick={onReconnectCamera}
        >
          Камерыг дахин холбох
        </button>
      </div>
    </div>
  );
}
