'use client';

export default function RecStage({
  videoRef,
  onFinish,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  onFinish: () => void;
}) {
  return (
    <div className="oc-solve-rec">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="oc-solve-rec-dot" aria-hidden />
          <span style={{ font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#D8402C' }}>
            БИЧИЖ БАЙНА
          </span>
        </div>
        <div className="oc-solve-camera-box-portrait" style={{ marginTop: 10 }}>
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          <div className="oc-solve-tick-strip" aria-hidden />
        </div>
        <p style={{ marginTop: 10, font: '400 12px var(--oc-font-heading), sans-serif', color: '#8A8474' }}>
          Дэлгэц дээр цаг харагдахгүй. Цагаа өөрөө хэмжиж, дараа нь бичнэ.
        </p>
      </div>

      <button type="button" className="oc-solve-btn-finish" onClick={onFinish}>
        Дуусгах
      </button>
    </div>
  );
}
