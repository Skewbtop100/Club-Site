'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SolveMarks } from '@/lib/online-competition/types';
// TEMP-IOS-RECORDING-DIAG — logging only, to find why iOS Safari records an
// empty clip. Remove with the fix; see recording-diagnostics.ts.
import {
  environmentInfo,
  errorInfo,
  mimeSupport,
  recDiag,
  trackInfo,
} from '@/lib/online-competition/recording-diagnostics';

// Ideal hint only, deliberately in the sensor's native landscape shape
// (NOT width:480/height:640 portrait — that was tried and reverted: it
// made the browser pre-crop to portrait before handing us the track,
// cropping into less than the camera's full field of view). facingMode:
// 'user' targets the front/selfie camera — the one a laptop webcam or a
// phone propped up facing the solver's own setup actually has.
//
// ── THE CANVAS IS BACK, AND THIS TIME IT IS LOAD-BEARING ──
// Read this before removing it again.
//
// An earlier version recorded from an off-screen canvas that redrew (and
// for a while rotated) every frame, on the theory that MediaRecorder saw
// a differently-oriented raw frame than <video> displayed. That was
// VERIFIED FALSE — the files were upright and complete all along, and the
// real bug was downstream, in an admin <video> box that cropped a
// portrait clip into a landscape container. So the canvas was removed as
// indirection that bought nothing, and guards were added forbidding it.
// That removal was correct ON ITS OWN REASONING.
//
// It is back for a completely different reason, which those guards could
// not have anticipated: THE RECORDING CANNOT BE DOWNSCALED BY
// CONSTRAINTS ON THIS HARDWARE. applyConstraints on a cloned track is
// ignored outright on the athlete's device — a max on the long edge was
// tried at 640 and again at 720 and both produced a full 1080x1920 clip,
// ~8MB for 104 seconds. Worse, constraining BOTH dimensions made the
// browser crop to the implied ratio instead of scaling to it, cutting the
// top and bottom off the frame (1080x1440 from a 1080x1920 source, while
// the stills from the same stream came back whole).
//
// Drawing to a canvas at a chosen size is the only remaining way to
// control what MediaRecorder encodes: the canvas IS the frame size, so
// there is nothing left for a browser to ignore. The rotation theory is
// still false and nothing here rotates — the draw is a straight scale of
// the whole frame into a canvas of the same aspect ratio.
//
// So: do not remove this as "unnecessary indirection" a second time
// without first confirming that applyConstraints has started working on
// the devices athletes actually use. The guards in run-protection now pin
// the canvas IN rather than out.
//
// audio: false here on purpose — no microphone/ambient audio is ever
// captured, for the athlete's privacy and to save bandwidth.
// THE SOURCE IS AS LARGE AS THE DEVICE WILL GIVE, and the RECORDING IS
// NOT: the canvas pipeline below scales every frame down to
// RECORDING_MAX_EDGE on its long side. The 1920x1080 hint was raised for
// full-resolution stills, which no longer exist. It is KEPT because the
// canvas downscales from it, and lowering it is a separate decision with
// its own risk — on some phones a lower resolution selects a different
// sensor mode with a narrower field of view — not something to fold into
// removing the stills.
//
// `ideal`, never `exact`: a device that cannot do 1080p must hand back
// whatever it has rather than failing getUserMedia and ending the run
// before it starts. The pipeline sizes its canvas from the frames that
// actually arrive, so a phone that answers with 1280x720 — or 640x480 —
// still records correctly.
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    facingMode: 'user',
  },
  audio: false,
};

// WHAT THE CLIP STAYS AT, and why this constant had to be invented. The
// recorded video is bitrate-capped on purpose — it has to fit
// Cloudinary's free tier — and MediaRecorder has no size setting of its own: it encodes
// whatever the track hands it. So raising the source above would have
// silently re-aimed that same small bitrate at four times the pixels,
// does NOT make the file bigger (the bitrate is capped) but makes it
// markedly worse to watch. The file-size check that would normally catch
// a recorder change cannot see this one.
//
// Hence a downscaled CLONE of the camera track for the recorder, made
// once per run in requestCamera: the athlete's preview keeps the
// full-size track, the clip keeps exactly the frame size it has always
// had. `max` rather than `exact` for the same graceful-degradation reason
// as above — a weaker camera handing back something smaller than this
// already satisfies it.

// ── ONE DIMENSION, AND ONLY ONE ──
// The recorder's clone used to be constrained on BOTH width and height
// (max 640 x max 480). Two dimensions state an ASPECT RATIO whether you
// meant to or not, and at least one browser satisfied that ratio the
// cheapest way available: it cropped. A run came back 1080x1440 — full
// width, 480px of height cut off the top and bottom — while the stills
// from the same stream were a complete 1080x1920. Neither size cap had
// been applied at all; only the 4:3 the two of them implied.
//
// Capping the LONG EDGE alone leaves no ratio to crop toward. A browser
// that honours it scales the whole frame down proportionally (1080x1920
// -> 360x640, still 9:16); one that ignores it hands back the full frame
// untouched. The bad outcome becomes "larger than we wanted", never
// "missing the part of the frame the judge needs".
//
// HEIGHT is the long edge because these are recorded upright, on a phone
// or a propped-up laptop.
//
// 720, ARRIVED AT BY PIXEL COUNT RATHER THAN BY BITRATE. Uncropped but
// unconstrained, a run came back 1080x1920 at ~611kbps — 8MB for 104
// seconds, against a target of about 4. Halving the bitrate at that same
// pixel count would have halved the bits available to every pixel, and
// the first thing that costs is fine high-contrast detail: the four
// digits on the athlete's timer, which is the one thing a judge has to
// read. Cutting the FRAME instead gets the file to the same place with
// MORE bits per pixel than before, not fewer.
//
// 720x1280 is 44% of 1080x1920's pixels, so the same encoder settings
// land near 270kbps ~= 3.5MB for a 104-second attempt.
const RECORDING_MAX_EDGE = 720;

/** How often the camera frame is copied onto the recording canvas.
 *
 *  A TIMER, NOT requestAnimationFrame, and the difference matters here.
 *  rAF is paced by the compositor — it fires at the display's refresh
 *  rate (so 60Hz would need every other frame thrown away to reach 30)
 *  and, more importantly, it STOPS ENTIRELY when the page is not being
 *  painted. This canvas is not being drawn for anyone to look at; it is
 *  feeding an encoder for ninety seconds while the athlete is looking at
 *  a cube, and a draw loop that pauses whenever the compositor does would
 *  freeze the clip on its last frame. A timer targets 30 directly and
 *  keeps running (clamped) when the page is backgrounded. */
const DRAW_FPS = 30;

/** How long startRecording will wait for the frame source to decode its
 *  first frame before giving up and starting anyway.
 *
 *  THERE MUST BE A CEILING. The wait exists because a canvas stream emits
 *  nothing until the canvas is drawn, so starting the recorder before the
 *  first draw makes the clip's t=0 later than recordingT0 and every seek
 *  position wrong by the difference — a measured run lost six seconds off
 *  the head this way. But an unbounded wait would trade that for
 *  something worse: an attempt that never begins on a device whose
 *  decoder is slow or wedged. Two seconds is far longer than a warm
 *  camera needs and comfortably inside the 8-second hold that zeroDisplay
 *  is already showing, so the athlete never reaches the next stage
 *  waiting for it. On timeout the recorder starts regardless and the gap
 *  is logged. */
const FIRST_FRAME_TIMEOUT_MS = 2000;
// Raised from 250k with the frame size. The old value was set against a
// 640x480 clip and, at 1080p, was being ignored outright — the encoder
// delivered 611kbps when asked for 250. A hint pitched below what the
// encoder will produce anyway is not a cap, it is a number that does
// nothing. At 720x1280 this is within reach, so it can actually bind.
const VIDEO_BITS_PER_SECOND = 300_000;

const BEEP_FREQUENCY_HZ = 880;
const BEEP_DURATION_S = 0.25;
const BEEP_GAIN = 0.2;

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

/** Camera + recording for the 5-attempt solve flow. getUserMedia
 *  permission is requested exactly once, up front (the cameraSetup
 *  stage), and the same stream is reused for all 5 attempts — it feeds
 *  the on-screen <video> preview directly, and MediaRecorder reads from
 *  it directly too (video-only — see playBeep below for why). Each
 *  attempt gets its own fresh MediaRecorder instance, started as soon as
 *  that attempt's zeroDisplay begins so the frozen "0.00", the scramble
 *  application, the orientation hold, and the solve are all one
 *  continuous clip.
 *
 *  playBeep() plays the WCA-style 8s/12s inspection cues live, through
 *  the device speaker, so the athlete actually hears them — but does NOT
 *  mix them into the recording. An earlier version routed the same
 *  oscillator into a MediaStreamAudioDestinationNode and added that
 *  track alongside the video track into MediaRecorder's stream, so the
 *  cues would be embedded in the file too. That broke recording entirely:
 *  verified via an isolated test (video-only vs. video+a second audio
 *  track, both with a fully "running" — not suspended — AudioContext)
 *  that MediaRecorder produced a normal ~79KB clip for 4 seconds of
 *  video-only, but only ~110 bytes (an essentially empty container, no
 *  real frame data at all) the instant a second audio track was present
 *  alongside it — reproducible regardless of whether anything was ever
 *  played through that audio track. This is what caused attempts 1-5 to
 *  all end up as near-empty recordings after the state-machine rework
 *  that added embedded beep cues. Embedding may be revisitable later
 *  (e.g. muxing audio+video as separate recordings after the fact), but
 *  for now a reliable recording matters far more than an embedded cue —
 *  the athlete still hears the beep live either way. */
export function useSolveRecorder() {
  const streamRef = useRef<MediaStream | null>(null);
  /** The stream MediaRecorder actually reads: the canvas stream from
   *  startCanvasPipeline. Held so releaseCamera can stop its track, which
   *  stopping the camera does not do. */
  const recordingStreamRef = useRef<MediaStream | null>(null);
  /** THE HOOK'S OWN <video>, not the preview.
   *
   *  The preview element belongs to whichever stage is on screen, and one
   *  of them — zeroDisplay, the stage that STARTS the recording — renders
   *  none at all. Drawing from `videoElRef` would therefore mean drawing
   *  from null at the exact moment every clip begins. This one is created
   *  once with the stream and lives until releaseCamera, so the draw loop
   *  always has a frame source.
   *
   *  In the document but 1px and transparent, not `display: none`: a
   *  display-none video is allowed to stop decoding, which would leave
   *  the canvas with nothing to copy. */
  const drawElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Dedupes concurrent requestCamera() calls (e.g. React StrictMode's
  // double-invoked effects in dev) into the one in-flight getUserMedia
  // call, instead of prompting/opening the camera twice.
  const pendingRequestRef = useRef<Promise<boolean> | null>(null);

  // Created lazily on first playBeep() call and reused for every
  // subsequent beep across all 5 attempts.
  const audioContextRef = useRef<AudioContext | null>(null);

  // ── Stage marks: where each press lands in the clip ──────────────────
  // WHY THESE LIVE IN THE HOOK and not in the page that renders the
  // buttons: the origin is MediaRecorder's own `onstart`, and the last
  // mark is its `onstop`. Both are events on an object nothing outside
  // this file holds. A ref in the page would have to be handed the two
  // moments anyway, so the ref belongs where the moments are; the page
  // calls mark() from its handlers and reads `marks` when it files.
  //
  // performance.now() at the recorder's `onstart`, NOT at the line that
  // calls .start(). The two are not the same instant — the browser
  // negotiates the encoder in between — and the gap is precisely the
  // stretch of time that never made it into the file. Measuring from the
  // call would push every mark later than the frame it names.
  //
  // Null until onstart fires, and reset to null at the top of every
  // startRecording: an attempt whose recorder never started has no origin
  // to measure from, and mark() below refuses rather than inventing one
  // from the previous attempt's clip.
  const recordingT0 = useRef<number | null>(null);
  const marksRef = useRef<Partial<SolveMarks>>({});

  /** Records where we are in the current clip, in whole milliseconds.
   *
   *  SILENT WHEN IT CANNOT. No origin means no mark — not a zero, not a
   *  guess. A partial or empty set of marks is an expected outcome and
   *  must never block a submission (see SolveMarks): the video and the
   *  time are the evidence, these are only seek positions into it. */
  const mark = useCallback((key: keyof SolveMarks) => {
    if (recordingT0.current == null) return;
    marksRef.current[key] = Math.round(performance.now() - recordingT0.current);
  }, []);

  // EXIT PATH 3 OF 3: an unmounted hook's interval keeps firing forever.
  useEffect(
    () => () => {
      // The ref directly, not stopDrawLoop — that helper is defined
      // further down and this effect must not depend on declaration
      // order to be the last thing that ever stops the loop.
      if (drawTimerRef.current !== null) {
        clearInterval(drawTimerRef.current);
        drawTimerRef.current = null;
      }
    },
    [],
  );

  const [hasCamera, setHasCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A callback ref, not a plain ref — cameraSetup/scrambleReveal/
  // orientationHold/readyPrompt/rec each render their own <video> element
  // (different surrounding markup, and zeroDisplay renders none at all),
  // so a new DOM node mounts between them and needs the existing stream
  // re-attached immediately rather than waiting on an effect keyed to a
  // ref that doesn't itself trigger re-renders.
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current) el.srcObject = streamRef.current;
  }, []);

  /** Stops the draw loop. Safe to call repeatedly and from anywhere; the
   *  three exit paths (recording stop, releaseCamera, unmount) all reach
   *  it, because a loop that outlives its recording is a battery drain
   *  the athlete has no way to see. */
  const stopDrawLoop = useCallback(() => {
    if (drawTimerRef.current !== null) {
      clearInterval(drawTimerRef.current);
      drawTimerRef.current = null;
    }
  }, []);

  /** The source's real frame size, preferred from the element actually
   *  being drawn (it reports what decoded) and falling back to the track's
   *  own settings. */
  const sourceSize = useCallback((): { w: number; h: number } | null => {
    const el = drawElRef.current;
    if (el && el.videoWidth > 0 && el.videoHeight > 0) {
      return { w: el.videoWidth, h: el.videoHeight };
    }
    const s = streamRef.current?.getVideoTracks()[0]?.getSettings();
    if (s?.width && s?.height) return { w: s.width, h: s.height };
    return null;
  }, []);

  /** Sizes the canvas, primes it with a frame, and hands back a stream.
   *
   *  THE PRIMING DRAW IS THE WHOLE POINT OF THIS BEING ASYNC. A canvas
   *  stream produces no frame until the canvas is drawn to, and
   *  MediaRecorder timestamps its file from the first frame it receives —
   *  so a recorder started against a blank canvas produces a clip whose
   *  t=0 is whenever the first draw eventually happened. recordingT0,
   *  meanwhile, is set at onstart. The two clocks drifted apart by
   *  however long that took, and every mark — every jump button — was
   *  wrong by the same amount, pointing PAST the moment it named.
   *
   *  So: wait for the source, draw once, and only then create the stream.
   *  By the time the caller starts the recorder there is already a frame
   *  waiting, and the two clocks refer to the same instant.
   *
   *  THE LONG EDGE BECOMES RECORDING_MAX_EDGE AND THE RATIO IS KEPT
   *  EXACTLY. One scale factor is applied to both dimensions, so
   *  1080x1920 becomes 405x720 and 640x480 becomes 720x540. drawImage
   *  fills the whole canvas from the whole frame, which means there is
   *  nothing to letterbox, nothing to crop and nothing to pad.
   *
   *  Returns null rather than throwing if anything is missing, so
   *  startRecording can fall back to the raw track: a clip at the wrong
   *  size is worth having and no clip is not. */
  const startCanvasPipeline = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const calledAt = performance.now();
      const el = drawElRef.current;
      const size = sourceSize();
      recDiag('pipeline:enter', {
        hasDrawEl: !!el,
        size,
        drawEl: el
          ? { readyState: el.readyState, paused: el.paused, videoWidth: el.videoWidth, videoHeight: el.videoHeight }
          : null,
      });
      if (!el || !size) return null;

      const scale = RECORDING_MAX_EDGE / Math.max(size.w, size.h);
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvasRef.current = canvas;
      canvas.width = Math.round(size.w * scale);
      canvas.height = Math.round(size.h * scale);
      // isConnected: WebKit bug 240380 — a canvas outside the document can
      // emit erratic or no frames from captureStream.
      recDiag('pipeline:canvas', { width: canvas.width, height: canvas.height, scale, inDocument: canvas.isConnected });

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        recDiag('pipeline:no 2d context');
        return null;
      }

      /** One copy of the camera frame onto the canvas. Reports whether it
       *  actually drew, so the priming call below can tell a real frame
       *  from a skipped tick. readyState < 2 is a decoder that has not
       *  produced a frame yet; skipping leaves the previous contents in
       *  place, which captureStream re-emits — a repeated frame, never a
       *  black one. */
      // TEMP-IOS-RECORDING-DIAG: tick counts, reported every 5s, measure
      // whether the timer is throttled and whether the source ever decodes.
      const loopStats = { calls: 0, drawn: 0, notReady: 0, threw: 0, since: performance.now() };
      let lastDrawError: unknown = null;
      let captureTrack: MediaStreamTrack | null = null;
      const drawFrame = (): boolean => {
        if (el.readyState < 2) {
          loopStats.notReady++;
          return false;
        }
        try {
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
          return true;
        } catch (e) {
          // A transient decode error must not kill the loop; the next
          // tick is 33ms away.
          loopStats.threw++;
          lastDrawError = errorInfo(e);
          return false;
        }
      };
      const drawOnce = (): boolean => {
        const drawn = drawFrame();
        loopStats.calls++;
        if (drawn) loopStats.drawn++;
        const now = performance.now();
        if (now - loopStats.since >= 5000) {
          recDiag('draw-loop', {
            windowMs: Math.round(now - loopStats.since),
            calls: loopStats.calls,
            effectiveHz: Math.round((loopStats.calls * 10000) / (now - loopStats.since)) / 10,
            drawn: loopStats.drawn,
            notReady: loopStats.notReady,
            threw: loopStats.threw,
            lastDrawError,
            source: { readyState: el.readyState, paused: el.paused, currentTime: el.currentTime, videoWidth: el.videoWidth },
            captureTrack: trackInfo(captureTrack),
            visibility: document.visibilityState,
          });
          loopStats.calls = 0;
          loopStats.drawn = 0;
          loopStats.notReady = 0;
          loopStats.threw = 0;
          loopStats.since = now;
        }
        return drawn;
      };

      // ── Wait for the source, bounded ──
      // Polled rather than driven by a 'loadeddata' listener because the
      // element may ALREADY be past that event — on attempts 2-5 it has
      // been playing since the lobby — and a listener for an event that
      // has already fired never resolves.
      const deadline = calledAt + FIRST_FRAME_TIMEOUT_MS;
      while (el.readyState < 2 && performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 16));
      }

      // PRIMED BEFORE captureStream, and therefore before the caller
      // starts the recorder. This is the line that makes the two clocks
      // agree; moving it after either of them reopens the gap.
      const primed = drawOnce();
      const gapMs = Math.round(performance.now() - calledAt);
      if (!primed) {
        // Started anyway, deliberately: a clip with a short head gap is
        // worth far more than an attempt that never begins. The gap is in
        // this warning, and the loop will start producing frames the
        // moment the decoder does.
        console.warn(
          `[khorom] recording started before the first frame (${gapMs}ms, readyState ${el.readyState})`,
        );
      }

      const stream = canvas.captureStream(DRAW_FPS);
      captureTrack = stream.getVideoTracks()[0] ?? null;
      recDiag('pipeline:captureStream', {
        primed,
        gapMs,
        sourceReadyState: el.readyState,
        videoTracks: stream.getVideoTracks().length,
        track: trackInfo(captureTrack),
      });

      stopDrawLoop();
      drawTimerRef.current = setInterval(drawOnce, 1000 / DRAW_FPS);

      return stream;
    } catch (e) {
      console.warn('Could not start the canvas recording pipeline:', e);
      recDiag('pipeline:threw', errorInfo(e));
      return null;
    }
  }, [sourceSize, stopDrawLoop]);

  /** Requests the camera stream if it doesn't already exist; a no-op
   *  (resolves true immediately) once granted, so attempts 2-5 never
   *  re-prompt. Called once, by the cameraSetup stage. */
  const requestCamera = useCallback((): Promise<boolean> => {
    if (streamRef.current) return Promise.resolve(true);
    if (pendingRequestRef.current) return pendingRequestRef.current;

    setError(null);
    const promise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
        streamRef.current = stream;
        recDiag('camera:granted', {
          environment: environmentInfo(),
          videoTracks: stream.getVideoTracks().length,
          track: trackInfo(stream.getVideoTracks()[0]),
        });
        if (videoElRef.current) videoElRef.current.srcObject = stream;

        // ── The frame source the recorder draws from ──
        // A <video> of our own, because the recording must not depend on
        // whichever preview element a stage happens to have mounted —
        // and the stage that starts the recording has none. See drawElRef.
        //
        // The cloned-and-constrained track that used to live here is
        // GONE: applyConstraints was ignored on the devices this runs on,
        // so the clone downscaled nothing and only added a second live
        // track to stop. The canvas does the sizing now.
        const drawEl = document.createElement('video');
        drawEl.muted = true;
        drawEl.playsInline = true;
        drawEl.setAttribute('playsinline', '');
        drawEl.srcObject = stream;
        drawEl.style.cssText =
          'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.appendChild(drawEl);
        drawElRef.current = drawEl;
        // Autoplay is permitted because it is muted; a rejection here is
        // not fatal, the draw loop simply skips until frames arrive.
        await drawEl.play().catch((e) => {
          recDiag('camera:drawEl.play() rejected', errorInfo(e));
        });
        recDiag('camera:drawEl', {
          readyState: drawEl.readyState,
          paused: drawEl.paused,
          videoWidth: drawEl.videoWidth,
          videoHeight: drawEl.videoHeight,
        });

        setHasCamera(true);
        return true;
      } catch (e) {
        recDiag('camera:failed', errorInfo(e));
        setError(e instanceof Error ? e.message : 'Камерт хандах эрх олдсонгүй');
        setHasCamera(false);
        return false;
      } finally {
        pendingRequestRef.current = null;
      }
    })();
    pendingRequestRef.current = promise;
    return promise;
  }, []);

  /** Plays a short beep live through the device speaker — a WCA-style
   *  inspection cue for the athlete, not embedded in the recording (see
   *  the hook's doc comment for why). Silently does nothing on browsers
   *  with no Web Audio API at all. */
  const playBeep = useCallback(() => {
    const AudioContextCtor =
      typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!AudioContextCtor) return;
    if (!audioContextRef.current) audioContextRef.current = new AudioContextCtor();
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(BEEP_FREQUENCY_HZ, ctx.currentTime);
    gain.gain.setValueAtTime(BEEP_GAIN, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + BEEP_DURATION_S);
  }, []);

  /** Starts a fresh MediaRecorder on the already-granted (video-only)
   *  stream — called at the top of each attempt's zeroDisplay state, so
   *  the resulting blob covers zeroDisplay -> scrambleReveal ->
   *  orientationHold -> readyPrompt -> rec as one continuous clip.
   *  Assumes requestCamera() already succeeded; returns false (and does
   *  nothing) if there's no stream to record from. */
  const startRecording = useCallback(async (): Promise<boolean> => {
    // THE CANVAS STREAM, not the camera track. The canvas is the only
    // place the frame size can actually be chosen on this hardware — see
    // the header. Falls back to the full-size camera stream if the
    // pipeline could not start, because a clip at the wrong size is worth
    // having and no clip is not.
    const canvasStream = await startCanvasPipeline();
    if (canvasStream) recordingStreamRef.current = canvasStream;
    const stream = canvasStream ?? streamRef.current;
    recDiag('record:stream', {
      source: canvasStream ? 'canvas' : streamRef.current ? 'camera (canvas fallback)' : 'none',
      videoTracks: stream?.getVideoTracks().length ?? 0,
      track: trackInfo(stream?.getVideoTracks()[0]),
    });
    if (!stream) {
      setError('Камерын урсгал олдсонгүй');
      return false;
    }

    chunksRef.current = [];
    // A NEW ATTEMPT IS A NEW CLIP, so it is a new set of marks and a new
    // origin. Cleared BEFORE the recorder exists, so there is no window
    // in which a mark could be measured against the previous attempt's
    // start — and so an attempt whose recorder fails to start files with
    // no marks rather than with the last one's.
    marksRef.current = {};
    recordingT0.current = null;
    recDiag('record:mime', { chosen: pickMimeType(), isTypeSupported: mimeSupport() });
    // TEMP-IOS-RECORDING-DIAG: caught only to be logged, then RETHROWN —
    // the failure takes exactly the path it took before.
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: pickMimeType(),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });
    } catch (e) {
      recDiag('record:new MediaRecorder threw', errorInfo(e));
      throw e;
    }
    recDiag('record:constructed', {
      mimeType: recorder.mimeType,
      videoBitsPerSecond: recorder.videoBitsPerSecond,
      state: recorder.state,
    });
    // Listeners ADDED, never assigned: the on* handlers below are untouched.
    const diagStartedAt = performance.now();
    recorder.addEventListener('dataavailable', (e) => {
      recDiag('record:dataavailable', {
        size: (e as BlobEvent).data.size,
        type: (e as BlobEvent).data.type,
        state: recorder.state,
        msSinceStart: Math.round(performance.now() - diagStartedAt),
      });
    });
    for (const type of ['start', 'stop', 'pause', 'resume'] as const) {
      recorder.addEventListener(type, () => recDiag(`record:event ${type}`, { state: recorder.state }));
    }
    recorder.addEventListener('error', (e) => {
      recDiag('record:event error', {
        error: errorInfo((e as Event & { error?: unknown }).error ?? e),
        state: recorder.state,
      });
    });
    setTimeout(() => {
      recDiag('record:+3s', {
        state: recorder.state,
        track: trackInfo(stream.getVideoTracks()[0]),
        chunksSoFar: chunksRef.current.length,
      });
    }, 3000);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    // FRAME ZERO OF THE FILE, as the browser reports it — see the note on
    // recordingT0 for why this is not the .start() call below.
    recorder.onstart = () => {
      recordingT0.current = performance.now();
    };
    recorderRef.current = recorder;
    try {
      recorder.start();
    } catch (e) {
      recDiag('record:start() threw', errorInfo(e));
      throw e;
    }
    recDiag('record:start() returned', { state: recorder.state });
    return true;
  }, [startCanvasPipeline]);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      recDiag('stop:requested', {
        hasRecorder: !!recorder,
        state: recorder?.state ?? null,
        chunks: chunksRef.current.length,
      });
      if (!recorder || recorder.state === 'inactive') {
        recDiag('stop:no active recorder — resolving what was collected', {
          bytes: chunksRef.current.reduce((n, c) => n + c.size, 0),
        });
        resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
        return;
      }
      recorder.onstop = () => {
        // EXIT PATH 1 OF 3. The encoder has what it needs; every further
        // draw is work nobody will ever see.
        stopDrawLoop();
        // BEFORE the promise resolves, so finishRecording's continuation
        // — and therefore everything downstream that reads `marks` —
        // cannot observe the clip as ended without its last mark.
        mark('recordingEnd');
        recDiag('stop:onstop', {
          chunks: chunksRef.current.length,
          chunkSizes: chunksRef.current.map((c) => c.size),
          bytes: chunksRef.current.reduce((n, c) => n + c.size, 0),
          recorderMimeType: recorder.mimeType,
        });
        resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
      };
      recorder.stop();
    });
  }, [mark, stopDrawLoop]);

  const releaseCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // EXIT PATH 2 OF 3.
    stopDrawLoop();
    // The canvas track is a track in its own right: stopping the camera
    // does not stop it.
    recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordingStreamRef.current = null;
    canvasRef.current = null;
    // The hook put this element in the document, so the hook takes it out
    // again — otherwise every run leaves one behind, each still holding a
    // reference to a stream.
    if (drawElRef.current) {
      drawElRef.current.srcObject = null;
      drawElRef.current.remove();
      drawElRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setHasCamera(false);
  }, [stopDrawLoop]);

  /** The marks gathered for the attempt just recorded, AS A COPY.
   *
   *  A copy, and that is the whole point of it being a function rather
   *  than the ref's contents on the returned object. Filing runs BEHIND
   *  the athlete — the upload for attempt 3 is still in flight while
   *  attempt 4's startRecording clears these — so anything that holds
   *  this across an await must hold a value, not a live reference to a
   *  ref the next attempt will empty. Read it once, at the moment the
   *  attempt is handed to the queue. */
  const readMarks = useCallback((): Partial<SolveMarks> => ({ ...marksRef.current }), []);

  return {
    videoRef,
    hasCamera,
    error,
    requestCamera,
    startRecording,
    stopRecording,
    releaseCamera,
    playBeep,
    mark,
    readMarks,
  };
}
