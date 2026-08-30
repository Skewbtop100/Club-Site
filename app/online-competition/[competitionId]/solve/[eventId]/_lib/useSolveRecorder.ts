'use client';

import { useCallback, useRef, useState } from 'react';

// Ideal-portrait hint (the rec-state preview box is 3:4) — this is only a
// request; actual stream dimensions depend on the device's camera.
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 480 }, height: { ideal: 640 } },
  audio: false,
};
const VIDEO_BITS_PER_SECOND = 250_000;

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

/** Camera + recording for the 5-attempt solve flow. One getUserMedia
 *  permission grant is reused across all 5 attempts (only requested on
 *  the first "go" state); each attempt gets its own fresh MediaRecorder
 *  instance on the same stream. */
export function useSolveRecorder() {
  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [hasCamera, setHasCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A callback ref, not a plain ref — the `go` and `rec` states each
  // render their own <video> element (different surrounding markup), so
  // a new DOM node mounts between them and needs the existing stream
  // re-attached immediately rather than waiting on an effect keyed to a
  // ref that doesn't itself trigger re-renders.
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current) el.srcObject = streamRef.current;
  }, []);

  /** Ensures the camera stream exists (requesting it on first call only)
   *  and starts a fresh MediaRecorder on it. Returns whether it
   *  succeeded — the caller (the `go` state) should not proceed to
   *  `goNow`/`rec` on failure. */
  const startCameraAndRecording = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
        streamRef.current = stream;
        setHasCamera(true);
      }
      if (videoElRef.current) videoElRef.current.srcObject = stream;

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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Камерт хандах эрх олдсонгүй');
      setHasCamera(false);
      return false;
    }
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
    setHasCamera(false);
  }, []);

  return { videoRef, hasCamera, error, startCameraAndRecording, stopRecording, releaseCamera };
}
