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
// No canvas, no manual rotate()/translate() here — an earlier version of
// this hook recorded from an off-screen canvas that redrew (and, for a
// while, also rotated) every video frame, on the theory that MediaRecorder
// sees a differently-oriented raw frame than what <video> displays.
// Verified false: pulling the recorded files directly from Cloudinary
// showed they were correctly oriented, upright, full field of view all
// along, under these exact constraints — MediaRecorder on the raw track
// was never the problem. (The actual bug turned out to be downstream, in
// how the admin review dashboard's <video> box cropped a portrait clip
// into a landscape-shaped container.) MediaRecorder now reads directly
// off the camera track, which is simpler and avoids the canvas
// indirection entirely.
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
// recorded video is 250kbps on purpose — it has to fit Cloudinary's free
// tier — and MediaRecorder has no size setting of its own: it encodes
// whatever the track hands it. So raising the source above would have
// silently re-aimed that same 250kbps at four times the pixels, which
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
// or a propped-up laptop. 640 rather than the 480 above: 480 was the
// short side of the old landscape box, and using it here would shrink
// the clip well past what it has always been.
const RECORDING_MAX_EDGE = 640;
const VIDEO_BITS_PER_SECOND = 250_000;

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
  // The clip is 250kbps by necessity, which is enough to watch a solve
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
  useEffect(() => clearStillTimers, [clearStillTimers]);

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

        // ── The recorder's own, smaller view of the same camera ──
        // Cloned and constrained HERE, once, rather than per attempt:
        // applyConstraints is async, and doing it inside startRecording
        // would either make that function async (its caller checks a
        // synchronous boolean) or let the first frames of every clip
        // encode at full size before shrinking mid-stream. Once per run,
        // awaited, means every attempt records at a settled frame size.
        //
        // A REJECTION IS NOT FATAL. Some browsers apply track constraints
        // by reconfiguring the shared source instead of downscaling the
        // clone; the worst case is that the stills come back no larger
        // than they used to be, which is exactly where this feature
        // started. Recording must not be the thing that fails.
        const source = stream.getVideoTracks()[0];
        if (source) {
          // 1 — what the camera actually gave us, before anything is
          //     cloned or constrained.
          diag('1 source AFTER getUserMedia', source.getSettings());
          const recordingTrack = source.clone();
          try {
            // NOTHING HERE MAY IMPLY A RATIO — no width, no aspectRatio,
            // and `max` alone rather than a max/ideal pair, since an
            // `ideal` the browser chooses to hit exactly is one more way
            // to end up at a shape nobody asked for. See
            // RECORDING_MAX_EDGE.
            await recordingTrack.applyConstraints({
              height: { max: RECORDING_MAX_EDGE },
            });
            diag('   applyConstraints RESOLVED (no rejection)', true);
          } catch (e) {
            console.warn('Could not pin the recording track size:', e);
            diag('   applyConstraints REJECTED', String(e));
          }
          // 2 — what the recorder's own track reports now. Honoured ==
          //     360x640-ish, still 9:16. Ignored == a full 1080x1920.
          //     ANY OTHER SHAPE means it cropped, and C2 has not held.
          diag('2 clone AFTER applyConstraints', recordingTrack.getSettings());
          // 3 — THE DECIDING ONE. Same source object as line 1. If these
          //     two differ, constraining the clone reconfigured the shared
          //     camera and the preview and stills are affected too; if
          //     they match, the clone was reconfigured alone.
          diag('3 source AFTER the clone was constrained', source.getSettings());
          recordingStreamRef.current = new MediaStream([recordingTrack]);
        }

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
    // The DOWNSCALED clone, not streamRef — see RECORDING_MAX_WIDTH for
    // why the recorder gets its own view of the camera. Falls back to the
    // full-size stream if the clone could not be made, because a clip at
    // the wrong size is worth having and no clip is not.
    const stream = recordingStreamRef.current ?? streamRef.current;
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
  }, [clearStillTimers]);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
        return;
      }
      recorder.onstop = () => {
        // BEFORE the promise resolves, so finishRecording's continuation
        // — and therefore everything downstream that reads `marks` —
        // cannot observe the clip as ended without its last mark.
        mark('recordingEnd');
        resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
      };
      recorder.stop();
    });
  }, [mark]);

  const releaseCamera = useCallback(() => {
    clearStillTimers();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // The clone is a track in its own right: stopping the stream it was
    // cloned from does NOT stop it, and a live clone keeps the camera's
    // in-use light on after the athlete has left the run.
    recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordingStreamRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setHasCamera(false);
  }, [clearStillTimers]);

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
