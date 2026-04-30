'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Subscription } from 'rxjs';

// State surface exposed to the UI.
export type GanState = 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';

export interface GanCallbacks {
  /** GAN HANDS_OFF — physical timer started, drive our `running` state. */
  onSolveStart?: () => void;
  /** GAN STOPPED — physical timer recorded a final time (ms). */
  onSolveStop?: (finalMs: number) => void;
  /** GAN IDLE — timer reset/ready. */
  onIdle?: () => void;
  /** GAN HANDS_ON — both pads pressed (informational). */
  onHandsOn?: () => void;
  /** GAN GET_SET — grace delay expired, timer armed (informational). */
  onGetSet?: () => void;
}

/**
 * Wraps `gan-web-bluetooth` to drive a GAN Halo Smart Timer over Web Bluetooth.
 * The library is dynamically imported so it doesn't load on browsers that
 * don't support Web Bluetooth, and so the SSR pass never sees `navigator`.
 */
export function useGanTimer(callbacks: GanCallbacks) {
  const supported =
    typeof navigator !== 'undefined' && typeof (navigator as Navigator & { bluetooth?: unknown }).bluetooth !== 'undefined';

  const [state, setState] = useState<GanState>(supported ? 'idle' : 'unsupported');

  // Hold the connection + subscription on refs so they survive renders.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connRef = useRef<any>(null);
  const subRef = useRef<Subscription | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Keep callbacks current without re-wiring the subscription.
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
  }, []);

  const connect = useCallback(async () => {
    if (!supported) return;
    if (stateRef.current === 'connecting' || stateRef.current === 'connected') return;
    setState('connecting');
    try {
      const mod = await import('gan-web-bluetooth');
      const conn = await mod.connectGanTimer();
      connRef.current = conn;

      const sub = conn.events$.subscribe((evt) => {
        const cb = callbacksRef.current;
        const S = mod.GanTimerState;
        switch (evt.state) {
          case S.DISCONNECT:
            teardown();
            setState('idle');
            break;
          case S.IDLE:
            cb.onIdle?.();
            break;
          case S.HANDS_ON:
            cb.onHandsOn?.();
            break;
          case S.GET_SET:
            cb.onGetSet?.();
            break;
          case S.HANDS_OFF:
            cb.onSolveStart?.();
            break;
          case S.STOPPED:
            if (evt.recordedTime) cb.onSolveStop?.(evt.recordedTime.asTimestamp);
            break;
          // RUNNING / FINISHED carry no payload we act on.
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

  return { state, connect, disconnect, supported };
}
