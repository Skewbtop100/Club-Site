'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Subscription } from 'rxjs';

// State surface exposed to the UI.
export type GanState = 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';

// Live phase from the physical timer, mirrored for UI feedback (e.g. green
// timer text while pads are pressed and the device is about to start).
export type GanLiveState = 'idle' | 'handsOn' | 'getSet' | 'running' | 'stopped';

export interface GanCallbacks {
  /** GAN HANDS_OFF — physical timer started, drive our `running` state. */
  onSolveStart?: () => void;
  /** GAN STOPPED — physical timer recorded a final time (ms). */
  onSolveStop?: (finalMs: number) => void;
  /** GAN IDLE — timer was reset by the user. */
  onIdle?: () => void;
  /** GAN HANDS_ON — both pads pressed (informational). */
  onHandsOn?: () => void;
  /** GAN GET_SET — grace delay expired, timer armed (informational). */
  onGetSet?: () => void;
}

/**
 * Wraps `gan-web-bluetooth` to drive a GAN Halo Smart Timer over Web Bluetooth.
 * Library is dynamically imported so SSR / unsupported browsers don't load it.
 */
export function useGanTimer(callbacks: GanCallbacks) {
  const supported =
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { bluetooth?: unknown }).bluetooth !== 'undefined';

  const [state, setState] = useState<GanState>(supported ? 'idle' : 'unsupported');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  // Most recent live phase from the device — used for UI cues (color etc).
  const [liveState, setLiveState] = useState<GanLiveState>('idle');
  // Ref mirror of liveState so the BLE subscription callback can read the
  // CURRENT phase without React's closure capturing a stale value.
  const liveStateRef = useRef<GanLiveState>('idle');
  useEffect(() => { liveStateRef.current = liveState; }, [liveState]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connRef = useRef<any>(null);
  const subRef = useRef<Subscription | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const teardown = useCallback(() => {
    if (subRef.current) {
      subRef.current.unsubscribe();
      subRef.current = null;
    }
    if (connRef.current) {
      try { connRef.current.disconnect(); } catch { /* ignore */ }
      connRef.current = null;
    }
    setDeviceName(null);
    setLiveState('idle');
  }, []);

  const connect = useCallback(async () => {
    if (!supported) return;
    if (stateRef.current === 'connecting' || stateRef.current === 'connected') return;
    setState('connecting');
    try {
      const mod = await import('gan-web-bluetooth');

      // Monkey-patch requestDevice so we can capture the BluetoothDevice
      // (and its .name) — the library's connection object doesn't expose it.
      // The patch is restored before the connect promise resolves.
      const bt = (navigator as Navigator & { bluetooth: { requestDevice: (...args: unknown[]) => Promise<BluetoothDevice> } }).bluetooth;
      const original = bt.requestDevice.bind(bt);
      // Use a single-element array so the captured device survives TS's
      // closure narrowing (a plain `let` would be inferred as `null`).
      const capturedRef: { device: BluetoothDevice | null } = { device: null };
      bt.requestDevice = async (...args: unknown[]) => {
        const dev = await original(...args);
        capturedRef.device = dev;
        return dev;
      };

      let conn;
      try {
        conn = await mod.connectGanTimer();
      } finally {
        bt.requestDevice = original;
      }
      connRef.current = conn;
      setDeviceName(capturedRef.device?.name ?? 'GAN Timer');

      const sub = conn.events$.subscribe((evt) => {
        const cb = callbacksRef.current;
        const S = mod.GanTimerState;
        switch (evt.state) {
          case S.DISCONNECT:
            teardown();
            setState('idle');
            break;
          case S.IDLE:
            setLiveState('idle');
            cb.onIdle?.();
            break;
          case S.HANDS_ON:
            setLiveState('handsOn');
            cb.onHandsOn?.();
            break;
          case S.GET_SET:
            setLiveState('getSet');
            cb.onGetSet?.();
            break;
          case S.HANDS_OFF: {
            const wasRunning = liveStateRef.current === 'running';
            liveStateRef.current = 'running';
            setLiveState('running');
            if (!wasRunning) cb.onSolveStart?.();
            break;
          }
          case S.RUNNING: {
            // Fallback: some devices skip HANDS_OFF and go straight to RUNNING.
            const wasRunning = liveStateRef.current === 'running';
            liveStateRef.current = 'running';
            setLiveState('running');
            if (!wasRunning) cb.onSolveStart?.();
            break;
          }
          case S.STOPPED:
            setLiveState('stopped');
            if (evt.recordedTime) cb.onSolveStop?.(evt.recordedTime.asTimestamp);
            break;
          // FINISHED carries no payload we need — keep liveState as 'stopped'.
          default: break;
        }
      });

      subRef.current = sub;
      setState('connected');
    } catch (err) {
      // The most common failure is the user dismissing the device picker.
      // eslint-disable-next-line no-console
      console.warn('GAN timer connect failed', err);
      teardown();
      setState(supported ? 'idle' : 'unsupported');
    }
  }, [supported, teardown]);

  const disconnect = useCallback(() => {
    teardown();
    setState(supported ? 'idle' : 'unsupported');
  }, [supported, teardown]);

  // Cleanup on unmount.
  useEffect(() => () => teardown(), [teardown]);

  return { state, connect, disconnect, supported, deviceName, liveState };
}
