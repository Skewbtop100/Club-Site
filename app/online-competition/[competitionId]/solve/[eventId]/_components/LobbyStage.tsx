'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** The first screen of a round: the camera, full size, and the way in.
 *
 *  ABSORBS cameraSetup. The permission request, the "no stream, no start"
 *  gate and the reconnect button all live here — there was no reason to
 *  spend a screen asking for the camera when the screen the athlete is
 *  standing on anyway can hold the preview.
 *
 *  THE PREVIEW IS THE SCREEN. It used to be a 200px thumbnail in a fixed
 *  3/4 box with object-fit: cover, beside a heading, a lead paragraph and
 *  four rules. Every part of that was wrong for the one job this screen
 *  has — letting the athlete see what will be recorded:
 *
 *    - `cover` CROPS. Whatever the box could not fit was cut out of the
 *      preview and recorded anyway. An athlete frames the cube and the
 *      timer against the edges they can see, and finds out only when a
 *      judge rejects the clip that the timer was outside them.
 *    - the 3/4 box was FIXED, so it claimed a portrait frame whatever the
 *      camera produced. A laptop webcam hands over landscape; the box
 *      showed a portrait slice of it.
 *
 *  This is not hypothetical here. The same mistake, made one screen
 *  downstream, is what the recorder hook's long comment is about: the
 *  admin review dashboard cropped portrait clips into a landscape box and
 *  the recordings were blamed for it.
 *
 *  IT ADAPTS TO A RESUMED RUN — but only in the button. See the note
 *  above the button for what carries the rest.
 */

/** How long the overlay stays up before fading.
 *
 *  The framing line is ~60 characters of Mongolian: reading it takes
 *  about three and a half seconds, and the athlete is looking at the
 *  video, not at the text, when it appears. Five seconds is long enough
 *  to read it after noticing it and short enough that it is gone before
 *  they have finished aiming — which is the moment the frame edges matter
 *  most and anything covering them is in the way. Tapping brings it back.
 *
 *  ONE timer for the whole overlay, not one per line. The framing line
 *  and the run's status note appear together, are read together, and
 *  fade together as a single block — two independently-timed fades over
 *  live video would be two separate distractions, and the second one
 *  would arrive after the athlete had already gone back to aiming. */
const OVERLAY_VISIBLE_MS = 5000;

export default function LobbyStage({
  note,
  filedAttempts,
  nextAttempt,
  hasCamera,
  cameraError,
  videoRef,
  onRequestCamera,
  onStart,
}: {
  /** The run's one status line — the resume notice, or the saving line's
   *  reassurance when there is no resume notice. Null on a fresh run,
   *  which has neither. It is ONE string by the time it arrives: the page
   *  picks between them, because the resume notice already contains the
   *  saving line's count (see lobbyNote in page.tsx).
   *
   *  A saving line that is NOT reassurance — a failure, or an upload in
   *  progress — never reaches this prop. It stays a permanent row above
   *  the preview, because a failure that fades out is a failure nobody
   *  sees. */
  note: string | null;
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
  const elRef = useRef<HTMLVideoElement | null>(null);
  /** The stream's REAL frame size, straight off the element. Null until
   *  metadata lands — see the placeholder note below. */
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [overlayOn, setOverlayOn] = useState(true);
  /** Bumped on every tap so re-showing the overlay re-arms its timer even
   *  when it was already up. */
  const [overlayNonce, setOverlayNonce] = useState(0);

  useEffect(() => {
    void onRequestCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Composed ref: the hook's callback ref attaches the stream, and this
   *  component needs the same element to read its frame size from. */
  const setVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      elRef.current = el;
      videoRef(el);
    },
    [videoRef],
  );

  // WHERE THE REAL DIMENSIONS COME FROM. videoWidth/videoHeight on the
  // element, not the track's getSettings(), because the element's numbers
  // are the ones a <video> lays out from — and a <video> is also what
  // plays the recording back in the review dashboard. Reading the same
  // property on both ends is what makes "the preview matches the
  // recording" a property rather than a hope. (getSettings() reports the
  // sensor's own orientation, which on a phone is not always the
  // orientation of the frames that come out of the track.)
  //
  // `resize` is the rotation case: the element fires it whenever
  // videoWidth/videoHeight change, which is exactly what a phone turning
  // from portrait to landscape does to a live track. Re-read, re-render,
  // and the frame re-fits.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const read = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        setDims((prev) =>
          prev && prev.w === el.videoWidth && prev.h === el.videoHeight
            ? prev
            : { w: el.videoWidth, h: el.videoHeight },
        );
      }
    };
    read();
    el.addEventListener('loadedmetadata', read);
    el.addEventListener('resize', read);
    return () => {
      el.removeEventListener('loadedmetadata', read);
      el.removeEventListener('resize', read);
    };
  }, [hasCamera]);

  useEffect(() => {
    if (!overlayOn) return;
    const t = setTimeout(() => setOverlayOn(false), OVERLAY_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [overlayOn, overlayNonce]);

  const showOverlay = useCallback(() => {
    setOverlayOn(true);
    setOverlayNonce((n) => n + 1);
  }, []);

  // Live means a stream AND a frame size read back from it. Both, because
  // they arrive separately: the permission resolves first and metadata a
  // moment later, and in between the element has no idea how big its
  // frames are.
  const live = hasCamera && dims !== null;
  const resuming = filedAttempts > 0;

  return (
    <div className="oc-solve-lobby">
      {/* The whole available area. Tapping anywhere in it brings the
          framing line back — the athlete's hands are on the phone they
          are aiming, so the preview itself is the only target worth
          having.
          The measured frame size goes on it as two custom properties, and
          the sizing rule in theme.css builds the ratio from them. That is
          the ONLY thing JavaScript contributes to the geometry: it
          reports what the camera said, and CSS does the fitting. */}
      <div
        className="oc-solve-lobby-view"
        onClick={showOverlay}
        style={
          dims
            ? ({ '--oc-cam-w': dims.w, '--oc-cam-h': dims.h } as React.CSSProperties)
            : undefined
        }
      >
        {/* THE FRAME. Its sizing rule lives in theme.css: the largest box
            of the stream's own ratio that fits the area, in one CSS
            expression over container-query units. The ratio comes from
            the two custom properties above — measured off the stream,
            never assumed — so the frame is portrait or landscape because
            the camera is, and nothing here decides which.
            BEFORE METADATA it claims no ratio at all and draws no edge.
            The alternative is to pick one and draw a box in it, which is
            precisely the lie this screen was rebuilt to stop telling: an
            edge the athlete could aim at that is not where the recording
            ends. */}
        <div className={`oc-solve-lobby-frame${live ? '' : ' oc-solve-lobby-frame-idle'}`}>
          {/* Stays mounted in every state — the recorder's callback ref
              holds the stream through this element, so unmounting it
              would drop the preview. */}
          <video ref={setVideoEl} autoPlay playsInline muted className="oc-solve-lobby-feed" />

          {/* What the athlete is waiting on, in the place they are
              looking. The reconnect button is below, by the go button. */}
          {!live && (
            <div className="oc-solve-lobby-placeholder">
              <span className="oc-solve-lobby-camlabel">КАМЕР</span>
              {cameraError ? (
                <span className="oc-solve-lobby-error">{cameraError}</span>
              ) : (
                <span className="oc-solve-lobby-wait">Камерын зөвшөөрөл хүлээж байна...</span>
              )}
            </div>
          )}

          {/* ALL the screen's text, in one block, at the TOP of the
              frame, on one timer.

              THE TOP, not the bottom, and this is the load-bearing part:
              a solve is framed with the cube and the timer LOW — they sit
              on the mat, the hands come in from below, and the camera
              looks slightly down at them. The bottom edge is therefore
              the one that clips something a judge needs to see, and it is
              the edge the athlete is checking when they aim. The top of
              the frame is usually wall. Covering the bottom hid exactly
              the edge this screen exists to let them check.

              A child of the FRAME, so it is always over the preview
              rather than over the dead space beside it. Always in the
              DOM, never removed — the fade is opacity alone, so a screen
              reader keeps both lines whatever the timer has done to them
              visually. */}
          <div className={`oc-solve-lobby-notes${overlayOn ? '' : ' oc-solve-lobby-notes-out'}`}>
            <p className="oc-solve-lobby-hint">
              Камерт шоо болон таймер хоёул бүтэн харагдахаар байрлуулна уу.
            </p>
            {note && (
              <p className="oc-solve-lobby-note" role="status">
                {note}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* The gate cameraSetup used to hold: no stream, no start. The very
          next screen begins recording, so there is nowhere later to put
          this.
          RESUMING CHANGES ONLY THIS LABEL, and that is deliberate. The
          heading and the lead that used to differ are gone, and nothing
          replaced them, because nothing needed to: the resume banner
          rendered above every stage already says how many attempts are
          saved and which one is next, in the one sentence that counts
          attempts in prose. A second telling on the same screen would be
          the same fact twice. */}
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
