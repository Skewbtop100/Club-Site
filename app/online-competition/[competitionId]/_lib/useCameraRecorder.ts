'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 854 }, height: { ideal: 480 } },
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

export function useCameraRecorder() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const [hasCamera, setHasCamera] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedCs, setElapsedCs] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setHasCamera(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Камерт хандах эрх олдсонгүй');
      setHasCamera(false);
    }
  }, []);

  const releaseCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setHasCamera(false);
  }, []);

  const tick = useCallback(() => {
    setElapsedCs(Math.floor((performance.now() - startedAtRef.current) / 10));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      setError('Камер идэвхжээгүй байна');
      return;
    }
    chunksRef.current = [];
    setRecordedBlob(null);
    const recorder = new MediaRecorder(stream, {
      mimeType: pickMimeType(),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setRecordedBlob(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    startedAtRef.current = performance.now();
    setElapsedCs(0);
    setIsRecording(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stopRecording = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setElapsedCs(Math.floor((performance.now() - startedAtRef.current) / 10));
    recorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  const resetRecording = useCallback(() => {
    setRecordedBlob(null);
    setElapsedCs(0);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    videoRef,
    hasCamera,
    isRecording,
    elapsedCs,
    recordedBlob,
    error,
    requestCamera,
    releaseCamera,
    startRecording,
    stopRecording,
    resetRecording,
  };
}
