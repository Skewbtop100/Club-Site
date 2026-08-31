'use client';

import { useCallback, useRef, useState } from 'react';

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
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    facingMode: 'user',
  },
  audio: false,
};
const VIDEO_BITS_PER_SECOND = 250_000;
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
    const stream = streamRef.current;
    if (!stream) {
      setError('Камерын урсгал олдсонгүй');
      return false;
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: pickMimeType(),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    return true;
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
        return;
      }
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
      recorder.stop();
    });
  }, []);

  const releaseCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setHasCamera(false);
  }, []);

  return { videoRef, hasCamera, error, requestCamera, startRecording, stopRecording, releaseCamera, playBeep };
}
