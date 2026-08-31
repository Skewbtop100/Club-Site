'use client';

import { useCallback, useRef, useState } from 'react';

// Deliberately NOT requesting portrait width/height/aspectRatio here
// (tried before, reverted) — on a physically-landscape phone sensor,
// asking the browser for a portrait shape makes it do its own
// digital crop-to-portrait before handing us the track, cropping/zooming
// into less than the camera's full field of view. Requesting the
// sensor's native landscape shape instead gets us the full FOV.
// facingMode: 'user' targets the front/selfie camera — the one a laptop
// webcam or a phone propped up facing the solver's own setup actually has.
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    facingMode: 'user',
  },
  audio: false,
};
const VIDEO_BITS_PER_SECOND = 250_000;
const CANVAS_FPS = 30;

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

/** Camera + recording for the 5-attempt solve flow. getUserMedia
 *  permission is requested exactly once, up front (the cameraSetup
 *  stage), and the same raw stream is reused for all 5 attempts, feeding
 *  the on-screen <video> preview directly.
 *
 *  MediaRecorder, however, does NOT record that raw stream — it records
 *  an off-screen <canvas> that a requestAnimationFrame loop continuously
 *  redraws from the live video frame. This used to also apply a manual
 *  rotate()/translate() when the source looked landscape (videoWidth >
 *  videoHeight), on the theory that MediaRecorder sees an unrotated raw
 *  sensor frame while <video> only *displays* it rotated. Real-device
 *  testing proved that wrong for this codebase/browser combination — the
 *  <video> element's decoded frame (videoWidth/videoHeight included) is
 *  already orientation-correct, so the manual rotation was double-
 *  rotating an already-correct frame. The draw loop now does a plain,
 *  transform-free copy: whatever the video shows is exactly what gets
 *  recorded. Each attempt gets its own fresh MediaRecorder instance on
 *  the canvas's captureStream(), started as soon as that attempt's
 *  scramble reveal begins so the scramble application itself is
 *  captured, not just the solve. */
export function useSolveRecorder() {
  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Dedupes concurrent requestCamera() calls (e.g. React StrictMode's
  // double-invoked effects in dev) into the one in-flight getUserMedia
  // call, instead of prompting/opening the camera twice.
  const pendingRequestRef = useRef<Promise<boolean> | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const [hasCamera, setHasCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A callback ref, not a plain ref — cameraSetup/reveal/go/rec each
  // render their own <video> element (different surrounding markup), so
  // a new DOM node mounts between them and needs the existing stream
  // re-attached immediately rather than waiting on an effect keyed to a
  // ref that doesn't itself trigger re-renders. The canvas render loop
  // reads videoElRef.current fresh every frame, so it keeps drawing from
  // whichever <video> is currently mounted without needing to restart.
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

  /** Creates the off-screen canvas + its captureStream() once, on first
   *  use, and reuses both across every attempt (only the MediaRecorder
   *  instance is per-attempt). Sized to whatever the video already
   *  reports at this point if available; drawFrame keeps this in sync
   *  every frame afterward regardless, so this initial size is just a
   *  non-zero placeholder for the (practically unreachable, since
   *  requestCamera() already resolved before any attempt starts
   *  recording) case where no frame has arrived yet. */
  function ensureCanvasStream(): MediaStream | null {
    if (canvasStreamRef.current) return canvasStreamRef.current;

    const canvas = canvasRef.current ?? document.createElement('canvas');
    const video = videoElRef.current;
    canvas.width = video && video.videoWidth > 0 ? video.videoWidth : 2;
    canvas.height = video && video.videoHeight > 0 ? video.videoHeight : 2;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') return null;

    canvasRef.current = canvas;
    canvasCtxRef.current = ctx;
    canvasStreamRef.current = canvas.captureStream(CANVAS_FPS);
    return canvasStreamRef.current;
  }

  /** Copies the current live video frame onto the canvas every animation
   *  frame — no rotation, no transform, just whatever the video element
   *  is already showing (see the hook's doc comment for why manual
   *  rotation was removed). The canvas is resized to match the video's
   *  own reported videoWidth/videoHeight every frame rather than assuming
   *  a fixed size, since those can change (between attempts, or if the
   *  browser adjusts on a real device rotation). Runs only while an
   *  attempt is actively recording (started in startRecording, cancelled
   *  in stopRecording) — not continuously — so there's no rAF loop
   *  leaking between attempts or while sitting on entry/summary/etc. */
  function drawFrame() {
    const video = videoElRef.current;
    const ctx = canvasCtxRef.current;
    const canvas = canvasRef.current;
    if (video && ctx && canvas && video.readyState >= video.HAVE_CURRENT_DATA) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw > 0 && vh > 0) {
        if (canvas.width !== vw || canvas.height !== vh) {
          canvas.width = vw;
          canvas.height = vh;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
    }
    rafIdRef.current = requestAnimationFrame(drawFrame);
  }

  /** Starts a fresh MediaRecorder — reading from the canvas stream (a
   *  transform-free mirror of the video preview), not the raw camera
   *  stream — on top of a freshly (re)started draw loop. Called at the
   *  top of each attempt's reveal state, so the resulting blob covers
   *  reveal -> go -> goNow -> rec as one continuous clip. Assumes
   *  requestCamera() already succeeded; returns false (and does nothing)
   *  if there's no camera stream, or if this browser can't produce a
   *  canvas stream. */
  const startRecording = useCallback((): boolean => {
    if (!streamRef.current) {
      setError('Камерын урсгал олдсонгүй');
      return false;
    }
    const canvasStream = ensureCanvasStream();
    if (!canvasStream) {
      setError('Бичлэг эхлүүлэхэд алдаа гарлаа');
      return false;
    }

    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(drawFrame);

    chunksRef.current = [];
    const recorder = new MediaRecorder(canvasStream, {
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
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
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
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    canvasStreamRef.current?.getTracks().forEach((t) => t.stop());
    canvasStreamRef.current = null;
    canvasRef.current = null;
    canvasCtxRef.current = null;
    setHasCamera(false);
  }, []);

  return { videoRef, hasCamera, error, requestCamera, startRecording, stopRecording, releaseCamera };
}
