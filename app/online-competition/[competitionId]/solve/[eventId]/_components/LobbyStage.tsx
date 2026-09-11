'use client';

import { useEffect } from 'react';

/** The first screen of a round: what is about to happen, the camera, and
 *  the way in.
 *
 *  ABSORBS cameraSetup. The permission request, the "no stream, no start"
 *  gate and the reconnect button all live here now — there was no reason
 *  to spend a screen asking for the camera when the screen that explains
 *  the run can hold the preview.
 *
 *  IT ADAPTS TO A RESUMED RUN. An athlete returning at attempt 3 must not
 *  be told "five attempts in one sitting" as though they were starting.
 *  The heading, the lead and the button all change; the numbers — how
 *  many are saved, which attempt is next — stay in the resume banner
 *  above the stage, which is the one place that sentence is written. */
export default function LobbyStage({
  totalAttempts,
  filedAttempts,
  nextAttempt,
  hasCamera,
  cameraError,
  videoRef,
  onRequestCamera,
  onStart,
}: {
  totalAttempts: number;
  /** Attempts already on the server for this run. 0 for a fresh start. */
  filedAttempts: number;
  /** 1-based attempt this run will begin at. */
  nextAttempt: number;
  hasCamera: boolean;
  cameraError: string | null;
  videoRef: (el: HTMLVideoElement | null) => void;
  onRequestCamera: () => Promise<boolean>;
  onStart: () => void;
}) {
  useEffect(() => {
    void onRequestCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resuming = filedAttempts > 0;

  // ── THE COPY HAD TO CHANGE ──
  // The mockup reads "Хооронд гарвал үлдсэн оролдлого хүчингүй болно" —
  // leave in between and the remaining attempts are void. That described
  // the platform this one stopped being: attempts are filed one at a time
  // as they are recorded, athletes cannot delete a filed submission, and
  // a returning athlete resumes at the attempt after the last one filed.
  //
  // Keeping the mockup's line would not just be inaccurate, it would be
  // actively harmful — an athlete on a dying battery would keep solving
  // rather than stop, believing stopping costs them the round. The rule
  // it replaces says the true thing, which is also the reassuring one.
  const rules = [
    'Камераа бүх хугацаанд асаалттай байлга. Шоо, гар хоёул бүтэн харагдах ёстой.',
    'Оролдлого бүр бичигдмэгцээ шууд хадгалагдана — бүгдийг дуустал хүлээх шаардлагагүй.',
    'Завсарлах шаардлага гарвал хадгалагдсан оролдлогууд хэвээр үлдэнэ. Буцаж ирээд дараагийнхаас нь үргэлжлүүлнэ.',
    'Цагаа өөрөө хэмжиж, эвлүүлсний дараа гараар оруулна.',
  ];

  return (
    <div className="oc-solve-lobby">
      <div className="oc-solve-lobby-head">
        <span className="oc-solve-lobby-title">
          {resuming ? 'Үлдсэн оролдлогоо үргэлжлүүл' : `${totalAttempts} оролдлогыг нэг суулт дотор`}
        </span>
        <span className="oc-solve-lobby-lead">
          {resuming
            ? 'Өмнө хадгалагдсан оролдлогууд сервэрт байгаа. Тэднийг дахин хийх шаардлагагүй — үлдсэнийг нь дуусгаад дүнгээ илгээнэ үү.'
            : 'Оролдлого бүр бичигдмэгцээ шууд хадгалагдана. Завсарлаад буцаж ирвэл дараагийн оролдлогоосоо үргэлжлүүлнэ. Камер бүх хугацаанд бичиж байх ёстой.'}
        </span>
      </div>

      <div className="oc-solve-lobby-panel">
        <div className="oc-solve-lobby-cam">
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          {!hasCamera && <span className="oc-solve-lobby-camlabel">КАМЕР</span>}
        </div>
        <div className="oc-solve-lobby-rules">
          {rules.map((text) => (
            <div key={text} className="oc-solve-lobby-rule">
              <span className="oc-solve-lobby-dot" aria-hidden />
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {cameraError && <p className="oc-solve-lobby-error">{cameraError}</p>}
      {!hasCamera && !cameraError && <p className="oc-solve-lobby-wait">Камерын зөвшөөрөл хүлээж байна...</p>}

      {/* The gate cameraSetup used to hold: no stream, no start. The very
          next screen begins recording, so there is nowhere later to put
          this. */}
      <button type="button" className="oc-solve-lobby-go" disabled={!hasCamera} onClick={onStart}>
        {resuming ? `${nextAttempt}-р оролдлогоо эхлэх` : 'Эвлүүлэлтээ эхлэх'}
      </button>
      {cameraError && (
        <button
          type="button"
          className="oc-solve-btn-redo"
          style={{ flex: 'none', width: 'auto', padding: '10px 20px', alignSelf: 'center' }}
          onClick={() => void onRequestCamera()}
        >
          Камерыг дахин холбох
        </button>
      )}
    </div>
  );
}
