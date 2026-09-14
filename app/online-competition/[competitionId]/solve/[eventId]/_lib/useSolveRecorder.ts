'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SolveMarks } from '@/lib/online-competition/types';

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
// THE SOURCE IS NOW AS LARGE AS THE DEVICE WILL GIVE, and the RECORDING
// IS NOT — the two used to be the same number and are now deliberately
// different. The stills (grabStill below) are read off this stream at its
// native size, because a judge has to read four digits off an athlete's
// timer and 640x480 does not carry them. The clip the stills come from is
// pinned back down to RECORDING_MAX_* before MediaRecorder ever sees it.
//
// `ideal`, never `exact`: a device that cannot do 1080p must hand back
// whatever it has rather than failing getUserMedia and ending the run
// before it starts. Everything downstream reads the track's ACTUAL
// settings (grabStill takes its canvas size from getSettings()), so a
// phone that answers with 1280x720 — or 640x480 — simply gets smaller
// stills, not broken ones.
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
// once per run in requestCamera: the athlete's preview and the stills
// keep the full-size track, the clip keeps exactly the frame size it has
// always had. `max` rather than `exact` for the same graceful-degradation
// reason as above — a weaker camera handing back something smaller than
// this already satisfies it.
const RECORDING_MAX_WIDTH = 640;
const RECORDING_MAX_HEIGHT = 480;

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
// Raised from 250k with the frame size. The old value was set against a
// 640x480 clip and, at 1080p, was being ignored outright — the encoder
// delivered 611kbps when asked for 250. A hint pitched below what the
// encoder will produce anyway is not a cap, it is a number that does
// nothing. At 720x1280 this is within reach, so it can actually bind.
const VIDEO_BITS_PER_SECOND = 300_000;

/** JPEG quality for the stills. High on purpose: the entire point of
 *  these frames is legible digits, and a still is a few hundred KB
 *  against the video's megabytes. */
const STILL_JPEG_QUALITY = 0.9;
/** When each still is taken, measured from the moment its stage opens.
 *  Three shots inside an 8-second hold, none of them near either edge —
 *  the athlete is still settling at 0s and may already be reaching for
 *  the button by 8s. */
const STILL_OFFSETS_MS = [2000, 4000, 6000];
const BEEP_FREQUENCY_HZ = 880;
const BEEP_DURATION_S = 0.25;
const BEEP_GAIN = 0.2;

// ── TEMPORARY DIAGNOSTIC · REMOVE WHEN THE CROP IS FIXED ──────────────
// A recording came back 1080x1440 (3:4), 5.75MB/96s ~= 479kbps, missing
// the top and bottom of the frame that the stills from the same run show
// complete at 1080x1920. So neither the size caps nor the bitrate cap
// below is taking effect, and something is cropping.
//
// These four lines answer which. They log only; nothing here changes what
// is captured, recorded or uploaded.
function diag(label: string, value: unknown) {
  console.log(`[khorom-diag] ${label}`, value);
}

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
  /** The downscaled clone the recorder reads, built once per run beside
   *  streamRef — see RECORDING_MAX_WIDTH. Same camera, same single
   *  getUserMedia, one video track, no audio and no canvas: the only
   *  difference between it and streamRef is frame size. */
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

  // ── Stills: the frames the video is too coarse to carry ─────────────
  // The clip is bitrate-capped by necessity, enough to watch a solve
  // and nowhere near enough to READ a timer — the digits are the first
  // thing that compression spends. So the two stages whose whole job is
  // showing something to the camera also hand back a few full-size JPEGs
  // of that same moment, off the same stream, while the recording runs
  // on untouched.
  //
  // THE ATHLETE IS TOLD NOTHING NEW BY THIS, and nothing new is
  // collected: these are frames of the video they are already recording
  // and already submitting, at the moments already on it, read by the
  // same judge for the same purpose. What changes is legibility, not what
  // is captured — which is why there is no UI for it.
  const timerShotsRef = useRef<Blob[]>([]);
  const cubeShotsRef = useRef<Blob[]>([]);
  const stillTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** One frame from the LIVE stream at the camera's native size — NOT
   *  from the recorder's downscaled clone, and not from the recorded
   *  file. Returns null rather than throwing on every failure there is:
   *  no track, no preview element mounted, a preview that has not
   *  received a frame yet, a canvas the browser will not give us. A still
   *  is a convenience for review and must never be able to interrupt a
   *  solve. */
  const grabStill = useCallback(async (): Promise<Blob | null> => {
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      const el = videoElRef.current;
      // HAVE_CURRENT_DATA. Drawing a video that has not decoded a frame
      // yet paints nothing (or throws, depending on the browser).
      if (!track || !el || el.readyState < 2) return null;
      const s = track.getSettings();
      const canvas = document.createElement('canvas');
      canvas.width = s.width ?? RECORDING_MAX_WIDTH;
      canvas.height = s.height ?? RECORDING_MAX_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      return await new Promise((res) =>
        canvas.toBlob((b) => res(b), 'image/jpeg', STILL_JPEG_QUALITY),
      );
    } catch {
      return null;
    }
  }, []);

  const clearStillTimers = useCallback(() => {
    stillTimersRef.current.forEach(clearTimeout);
    stillTimersRef.current = [];
  }, []);

  /** Schedules this stage's three stills. Fire-and-forget by design: it
   *  returns immediately, the stage advances on its own clock, and a grab
   *  that comes back null is dropped without a word. Nothing about the
   *  run waits on any of this. */
  const captureBurst = useCallback(
    (bucket: 'timer' | 'cube') => {
      for (const offset of STILL_OFFSETS_MS) {
        const id = setTimeout(() => {
          void (async () => {
            const blob = await grabStill();
            if (!blob) return;
            const target = bucket === 'timer' ? timerShotsRef : cubeShotsRef;
            // Capped at the number of offsets, so a bucket cannot grow
            // past what firestore.rules will accept however this is
            // called.
            if (target.current.length < STILL_OFFSETS_MS.length) target.current.push(blob);
          })();
        }, offset);
        stillTimersRef.current.push(id);
      }
    },
    [grabStill],
  );

  // A CANCELLED ATTEMPT MUST NOT FIRE INTO THE NEXT ONE. A pending
  // timeout outlives the stage that scheduled it — the recording-failure
  // restart and the leave-the-run paths both abandon a stage mid-hold —
  // and a still landing after that would be filed against whatever
  // attempt happened to be in the bucket next. Cleared on unmount here,
  // and at the top of every startRecording below.
  // EXIT PATH 3 OF 3. clearStillTimers was already here; the draw loop
  // joins it, because an unmounted hook's interval keeps firing forever.
  useEffect(
    () => () => {
      clearStillTimers();
      // The ref directly, not stopDrawLoop — that helper is defined
      // further down and this effect must not depend on declaration
      // order to be the last thing that ever stops the loop.
      if (drawTimerRef.current !== null) {
        clearInterval(drawTimerRef.current);
        drawTimerRef.current = null;
      }
    },
    [clearStillTimers],
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

  /** Sizes the canvas, starts the draw loop and hands back a stream of it.
   *
   *  THE LONG EDGE BECOMES RECORDING_MAX_EDGE AND THE RATIO IS KEPT
   *  EXACTLY. One scale factor is applied to both dimensions, so
   *  1080x1920 becomes 405x720 and 640x480 becomes 720x540. drawImage
   *  fills the whole canvas from the whole frame, which means there is
   *  nothing to letterbox, nothing to crop and nothing to pad — the only
   *  way to lose part of the frame here would be to compute two
   *  independent scales, which is exactly what constraining two
   *  dimensions did.
   *
   *  Returns null rather than throwing if anything is missing, so
   *  startRecording can fall back to the raw track: a clip at the wrong
   *  size is worth having and no clip is not. */
  const startCanvasPipeline = useCallback((): MediaStream | null => {
    try {
      const el = drawElRef.current;
      const size = sourceSize();
      if (!el || !size) return null;

      const scale = RECORDING_MAX_EDGE / Math.max(size.w, size.h);
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvasRef.current = canvas;
      canvas.width = Math.round(size.w * scale);
      canvas.height = Math.round(size.h * scale);

      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      diag('2 canvas sized', {
        source: `${size.w}x${size.h}`,
        canvas: `${canvas.width}x${canvas.height}`,
        scale: Math.round(scale * 1000) / 1000,
      });

      stopDrawLoop();
      drawTimerRef.current = setInterval(() => {
        // readyState < 2 is a decoder that has not produced a frame yet.
        // Skipping leaves the PREVIOUS canvas contents in place, which
        // captureStream re-emits — a repeated frame, never a black one.
        if (el.readyState < 2) return;
        try {
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        } catch {
          // A transient decode error must not kill the loop; the next
          // tick is 33ms away.
        }
      }, 1000 / DRAW_FPS);

      const stream = canvas.captureStream(DRAW_FPS);
      diag('3 canvas stream track', stream.getVideoTracks()[0]?.getSettings());
      return stream;
    } catch (e) {
      console.warn('Could not start the canvas recording pipeline:', e);
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
        await drawEl.play().catch(() => {});
        diag('1 source AFTER getUserMedia', stream.getVideoTracks()[0]?.getSettings());

        setHasCamera(true);
        return true;
      } catch (e) {
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
  const startRecording = useCallback((): boolean => {
    // THE CANVAS STREAM, not the camera track. The canvas is the only
    // place the frame size can actually be chosen on this hardware — see
    // the header. Falls back to the full-size camera stream if the
    // pipeline could not start, because a clip at the wrong size is worth
    // having and no clip is not.
    const canvasStream = startCanvasPipeline();
    if (canvasStream) recordingStreamRef.current = canvasStream;
    const stream = canvasStream ?? streamRef.current;
    if (!stream) {
      setError('Камерын урсгал олдсонгүй');
      return false;
    }

    chunksRef.current = [];
    // Stills belong to the attempt that took them. Any still still in
    // flight from an abandoned attempt is cancelled here, before its
    // bucket is emptied, so it cannot land in the next one.
    clearStillTimers();
    timerShotsRef.current = [];
    cubeShotsRef.current = [];
    // A NEW ATTEMPT IS A NEW CLIP, so it is a new set of marks and a new
    // origin. Cleared BEFORE the recorder exists, so there is no window
    // in which a mark could be measured against the previous attempt's
    // start — and so an attempt whose recorder fails to start files with
    // no marks rather than with the last one's.
    marksRef.current = {};
    recordingT0.current = null;
    const recorder = new MediaRecorder(stream, {
      mimeType: pickMimeType(),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    // FRAME ZERO OF THE FILE, as the browser reports it — see the note on
    // recordingT0 for why this is not the .start() call below.
    recorder.onstart = () => {
      recordingT0.current = performance.now();
    };
    recorderRef.current = recorder;
    recorder.start();
    // 4 — what MediaRecorder settled on, versus what it was asked for,
    //     plus the frame size it is actually encoding at the moment it
    //     starts (which is the number that ends up in the file).
    diag('4 recorder asked for videoBitsPerSecond', VIDEO_BITS_PER_SECOND);
    diag('  recorder REPORTS videoBitsPerSecond', recorder.videoBitsPerSecond);
    diag('  recorder REPORTS mimeType', recorder.mimeType);
    diag('  track being encoded', stream.getVideoTracks()[0]?.getSettings());
    return true;
  }, [clearStillTimers, startCanvasPipeline]);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
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
        resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
      };
      recorder.stop();
    });
  }, [mark, stopDrawLoop]);

  const releaseCamera = useCallback(() => {
    clearStillTimers();
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
  }, [clearStillTimers, stopDrawLoop]);

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

  /** The stills gathered for the attempt just recorded, AS COPIES — the
   *  same reason readMarks copies: filing outlives the attempt, and the
   *  next startRecording empties these arrays. */
  const readShots = useCallback(
    (): { timerShots: Blob[]; cubeShots: Blob[] } => ({
      timerShots: [...timerShotsRef.current],
      cubeShots: [...cubeShotsRef.current],
    }),
    [],
  );

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
    captureBurst,
    readShots,
  };
}
