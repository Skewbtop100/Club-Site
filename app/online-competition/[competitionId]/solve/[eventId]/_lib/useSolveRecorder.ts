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
// captured, for the athlete's privacy and to save bandwidth. The only
// audio in the final recording is the synthesized beep cues below, mixed
// in via a separate MediaStreamAudioDestinationNode, not a mic.
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
  // Audio-codec-qualified variants first — Chrome will still mux Opus
  // audio into a video-only-declared webm container if an audio track is
  // present, but naming it explicitly is more correct/portable.
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

/** Camera + recording for the 5-attempt solve flow. getUserMedia
 *  permission is requested exactly once, up front (the cameraSetup
 *  stage), and the same stream is reused for all 5 attempts — it feeds
 *  the on-screen <video> preview directly, and MediaRecorder reads from
 *  it directly too. Each attempt gets its own fresh MediaRecorder
 *  instance, started as soon as that attempt's zeroDisplay begins so the
 *  frozen "0.00", the scramble application, the orientation hold, and the
 *  solve are all one continuous clip.
 *
 *  The MediaRecorder's stream is the camera's video track plus a second,
 *  synthesized audio track (see playBeep below) — never a microphone —
 *  so the WCA-style 8s/12s inspection cues end up embedded in the
 *  recording itself, audible to a reviewing judge without any separate
 *  timestamp bookkeeping. */
export function useSolveRecorder() {
  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Dedupes concurrent requestCamera() calls (e.g. React StrictMode's
  // double-invoked effects in dev) into the one in-flight getUserMedia
  // call, instead of prompting/opening the camera twice.
  const pendingRequestRef = useRef<Promise<boolean> | null>(null);

  // Created lazily, once, on first use (either the first startRecording()
  // or the first playBeep(), whichever comes first) and reused across all
  // 5 attempts — same lifecycle as the camera stream itself.
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

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

  /** Lazily creates the AudioContext + MediaStreamAudioDestinationNode
   *  used for beep cues, reusing both across every attempt. Returns null
   *  on browsers with no Web Audio API at all — playBeep()/startRecording
   *  both treat that as "no audio track", not a hard failure, since the
   *  beep cues are a nice-to-have on top of the actual recording. */
  function ensureAudioGraph(): { ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null {
    if (audioContextRef.current && audioDestRef.current) {
      return { ctx: audioContextRef.current, dest: audioDestRef.current };
    }
    const AudioContextCtor =
      typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!AudioContextCtor) return null;

    const ctx = new AudioContextCtor();
    const dest = ctx.createMediaStreamDestination();
    audioContextRef.current = ctx;
    audioDestRef.current = dest;
    return { ctx, dest };
  }

  /** Plays a short beep, both live (through the device speaker, so the
   *  athlete actually hears the cue) and into the recording (via the
   *  MediaStreamAudioDestinationNode mixed into the MediaRecorder's
   *  stream) — the same oscillator feeds both destinations at once, so
   *  there's no drift between what's heard live and what's embedded. */
  const playBeep = useCallback(() => {
    const graph = ensureAudioGraph();
    if (!graph) return;
    const { ctx, dest } = graph;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(BEEP_FREQUENCY_HZ, ctx.currentTime);
    gain.gain.setValueAtTime(BEEP_GAIN, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + BEEP_DURATION_S);
  }, []);

  /** Starts a fresh MediaRecorder on the camera's video track plus the
   *  synthesized-beep audio track (never a microphone) — called at the
   *  top of each attempt's zeroDisplay state, so the resulting blob
   *  covers zeroDisplay -> scrambleReveal -> orientationHold ->
   *  readyPrompt -> rec as one continuous clip. Assumes requestCamera()
   *  already succeeded; returns false (and does nothing) if there's no
   *  camera stream to record from. */
  const startRecording = useCallback((): boolean => {
    const stream = streamRef.current;
    if (!stream) {
      setError('Камерын урсгал олдсонгүй');
      return false;
    }

    const graph = ensureAudioGraph();
    const tracks: MediaStreamTrack[] = [...stream.getVideoTracks()];
    if (graph) tracks.push(...graph.dest.stream.getAudioTracks());
    const combinedStream = new MediaStream(tracks);

    chunksRef.current = [];
    const recorder = new MediaRecorder(combinedStream, {
      mimeType: pickMimeType(),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    audioDestRef.current?.stream.getTracks().forEach((t) => t.stop());
    audioDestRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setHasCamera(false);
  }, []);

  return { videoRef, hasCamera, error, requestCamera, startRecording, stopRecording, releaseCamera, playBeep };
}
