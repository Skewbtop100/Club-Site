'use client';

import { useCallback, useEffect, useState } from 'react';
import { useGanTimer, type GanCallbacks, type GanLiveState, type GanState } from './useGanTimer';
import { useQiyiTimer, type QiyiLiveState, type QiyiPacket } from './useQiyiTimer';

// Auto-detected smart-timer brand. Stays `null` until the user has
// connected at least once or we've loaded a previously-connected
// brand from localStorage.
export type SmartBrand = 'gan' | 'qiyi';

// Unified live-phase across both brands. The two protocols ship
// slightly different vocabularies — GAN never reports 'inspection' /
// 'finished'; QiYi never reports 'handsOn'. The page reads this for
// color cues so a string union of all the values is fine.
export type SmartLiveState = GanLiveState | QiyiLiveState;

// Same callback shape both underlying hooks use. We pass it straight
// through to whichever brand is active.
export interface SmartTimerCallbacks {
  onSolveStart?: () => void;
  onSolveStop?: (finalMs: number) => void;
  onIdle?: () => void;
}

const SMART_BRAND_KEY = 'pv.timer.smart.lastBrand';

// Combined name-prefix filter so the browser picker shows GAN AND QiYi
// devices in a single sheet. Keep the casing variants for GAN since the
// upstream library accepts "GAN" / "Gan" / "gan" advertisements.
const COMBINED_FILTERS: BluetoothLEScanFilter[] = [
  { namePrefix: 'GAN' },
  { namePrefix: 'gan' },
  { namePrefix: 'Gan' },
  { namePrefix: 'QY-' },
  { namePrefix: 'QiYi' },
];

// Web Bluetooth requires every service we'll later call
// getPrimaryService() on to be declared up front. Listing both brands'
// services here means whichever device the user picks, the underlying
// hook can finish its connect() without the security model blocking
// service discovery.
const COMBINED_OPTIONAL_SERVICES: BluetoothServiceUUID[] = [
  // GAN smart-timer service (gan-web-bluetooth)
  '0000fff0-0000-1000-8000-00805f9b34fb',
  // QiYi canonical + variant firmware UUIDs (mirror of QIYI_OPTIONAL_SERVICES)
  '0000fd50-0000-1000-8000-00805f9b34fb',
  '0000ffd0-0000-1000-8000-00805f9b34fb',
  '0000ffd5-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  // Nordic UART service (some clones tunnel through this)
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

function detectBrandFromName(name: string | null | undefined): SmartBrand {
  const n = (name ?? '').trim();
  if (n.startsWith('QY-') || n.startsWith('QiYi')) return 'qiyi';
  if (/^gan/i.test(n)) return 'gan';
  // Unknown prefix — bias to GAN since it's the more common smart timer
  // in the wild. The connect flow falls back to QiYi if GAN's
  // getPrimaryService() can't find its expected service.
  return 'gan';
}

export interface SmartTimerReturn {
  /** Connection state of the currently-targeted hook. Mirrors GanState
   *  even when the active hook is QiYi — both share the same value
   *  domain ('idle' | 'connecting' | 'connected' | 'error' | 'unsupported'). */
  state: GanState;
  /** Name of the connected device (post-pair), or null when idle. */
  deviceName: string | null;
  /** Live phase from the physical timer. The page reads this for the
   *  red→green arming colour cue. */
  liveState: SmartLiveState;
  /** Detected brand. Stays null on first load until either the user
   *  connects or a prior brand is restored from localStorage (which
   *  happens on mount). */
  brand: SmartBrand | null;
  /** Whether Web Bluetooth is exposed at all in this browser. */
  supported: boolean;
  /** Open the unified picker and connect to the chosen device. The
   *  appropriate underlying hook is delegated to based on device name. */
  connect: () => Promise<void>;
  /** Disconnect the active hook (or no-op if nothing is connected). */
  disconnect: () => void;
  /** Last 10 raw QiYi packets when QiYi is the active brand — for the
   *  hidden debug overlay. Empty array otherwise. */
  recentPackets: QiyiPacket[];
}

/**
 * Single Bluetooth connection facade. Shows ONE picker that lists
 * both GAN and QiYi devices, detects the brand from the picked
 * device's name, and routes all subsequent UI / event traffic through
 * the matching brand-specific hook.
 *
 * The two brand hooks (`useGanTimer`, `useQiyiTimer`) are always
 * mounted so React's hook ordering rule is preserved; only one is
 * "active" at any time, gated by the `brand` state set after a
 * successful connect.
 */
export function useSmartTimer(callbacks: SmartTimerCallbacks): SmartTimerReturn {
  const ganCallbacks: GanCallbacks = callbacks;
  const qiyiCallbacks = callbacks;
  const ganHook = useGanTimer(ganCallbacks);
  const qiyiHook = useQiyiTimer(qiyiCallbacks);

  // Currently-active brand (null = nothing connected yet this session).
  // Set the moment we route into a hook's connect; cleared on disconnect.
  const [brand, setBrand] = useState<SmartBrand | null>(null);
  // Last brand the user successfully connected, persisted via
  // localStorage so the disconnected status block can show "Last:
  // GAN" before the user reconnects. Reading happens once on mount —
  // SSR safety requires the deferred read.
  const [lastBrand, setLastBrand] = useState<SmartBrand | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(SMART_BRAND_KEY);
      if (v === 'gan' || v === 'qiyi') setLastBrand(v);
    } catch { /* ignore */ }
  }, []);

  const supported = ganHook.supported || qiyiHook.supported;

  // The hook whose state, deviceName, liveState we expose. Defaults to
  // GAN's pre-connect view (idle / unsupported) so first-paint reads
  // sensibly even before a connect attempt.
  const active = brand === 'qiyi' ? qiyiHook : ganHook;

  // Routes the underlying hook's connect through a pre-picked device,
  // so the user sees a single combined picker even though the GAN /
  // QiYi libraries each call requestDevice internally.
  const connect = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const bt = (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
    if (!bt) return;

    let device: BluetoothDevice;
    try {
      device = await bt.requestDevice({
        filters: COMBINED_FILTERS,
        optionalServices: COMBINED_OPTIONAL_SERVICES,
      });
    } catch (err) {
      // User cancelled or no devices in range — surface nothing,
      // matches the underlying hooks' silent-cancel behaviour.
      console.warn('[smart timer] picker dismissed', err);
      return;
    }

    const detected = detectBrandFromName(device.name);
    console.log('[smart timer] picked', device.name, '→', detected);

    // Monkey-patch requestDevice so the next call (made by the active
    // hook's connect) returns OUR pre-picked device instead of opening
    // a second picker. The patch self-restores after one consumed call
    // OR the finally block below — whichever comes first.
    type Bt = Bluetooth & { requestDevice: (...args: unknown[]) => Promise<BluetoothDevice> };
    const btx = bt as Bt;
    const orig = btx.requestDevice.bind(btx);
    let consumed = false;
    btx.requestDevice = async (...args: unknown[]) => {
      if (consumed) return orig(...args);
      consumed = true;
      return device;
    };

    const tryBrand = async (b: SmartBrand) => {
      consumed = false;
      setBrand(b);
      if (b === 'qiyi') await qiyiHook.connect();
      else              await ganHook.connect();
      try { localStorage.setItem(SMART_BRAND_KEY, b); } catch { /* ignore */ }
      setLastBrand(b);
    };

    try {
      await tryBrand(detected);
    } catch (err) {
      console.error(`[smart timer] ${detected} connect failed; trying fallback`, err);
      const fallback: SmartBrand = detected === 'gan' ? 'qiyi' : 'gan';
      try {
        await tryBrand(fallback);
      } catch (err2) {
        console.error(`[smart timer] fallback ${fallback} failed`, err2);
        setBrand(null);
        // Surface the failure via the hooks' own state — they each
        // flip to 'error', and the page already toasts on that
        // transition (see ganPrevState / qiyiPrevState effects).
      }
    } finally {
      btx.requestDevice = orig;
    }
  }, [ganHook, qiyiHook]);

  const disconnect = useCallback(() => {
    if (brand === 'qiyi') qiyiHook.disconnect();
    else if (brand === 'gan') ganHook.disconnect();
    else {
      // Belt-and-braces: if for some reason brand got out of sync,
      // disconnect both. They no-op when not connected.
      if (ganHook.state === 'connected') ganHook.disconnect();
      if (qiyiHook.state === 'connected') qiyiHook.disconnect();
    }
    setBrand(null);
  }, [brand, ganHook, qiyiHook]);

  return {
    state: active.state,
    deviceName: active.deviceName,
    liveState: active.liveState,
    brand: brand ?? lastBrand,
    supported,
    connect,
    disconnect,
    recentPackets: brand === 'qiyi' ? qiyiHook.recentPackets : [],
  };
}
