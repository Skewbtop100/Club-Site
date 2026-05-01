'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Public surface mirrors useGanTimer so the page can route either hook
// through the same UI / callbacks.
export type QiyiState = 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';
export type QiyiLiveState = 'idle' | 'inspection' | 'getSet' | 'running' | 'finished' | 'stopped';

export interface QiyiCallbacks {
  /** Physical timer entered RUNNING — start our display. */
  onSolveStart?: () => void;
  /** Final time received (dpId=1 finish), in milliseconds. */
  onSolveStop?: (finalMs: number) => void;
  /** IDLE — device reset. */
  onIdle?: () => void;
  /** Optional informational hooks. */
  onInspection?: () => void;
  onGetSet?: () => void;
}

// ── BLE constants — verbatim from csTimer src/js/hardware/qiyitimer.js
//    (cs0x7f/cstimer @ master). ──────────────────────────────────────────────
const QIYI_SERVICE      = '0000fd50-0000-1000-8000-00805f9b34fb';
const QIYI_UUID_SUFFIX  = '-0000-1001-8001-00805f9b07d0';
const QIYI_CHRCT_WRITE  = '00000001' + QIYI_UUID_SUFFIX;
const QIYI_CHRCT_READ   = '00000002' + QIYI_UUID_SUFFIX;
const QIYI_AES_KEY      = new Uint8Array(16).fill(0x77);

// Device-name regex straight from csTimer line 233: tail of `QY-Timer-XXXX-1234`
// or `QY-Adapter-XXXX-1234`, capturing the last 4 hex chars.
const QIYI_NAME_RE = /^QY-(?:Timer|Adapter).*-([0-9A-F]{4})$/;

// ── CRC-16/MODBUS — matches csTimer crc16modbus() ──────────────────────────
function crc16modbus(data: number[] | Uint8Array): number {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x1) > 0 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc & 0xFFFF;
}

// ── AES-128/ECB — single block in/out, for parity with csTimer's $.aes128.
//    aes-js ECB mode encrypts/decrypts buffers of any 16-byte multiple, but
//    we only pass one block at a time to mirror the source. ─────────────────
async function aesEncryptBlock(block: number[]): Promise<number[]> {
  const aes = await import('aes-js');
  const ecb = new aes.ModeOfOperation.ecb(QIYI_AES_KEY);
  const out = ecb.encrypt(new Uint8Array(block));
  return Array.from(out);
}
async function aesDecryptBlock(block: number[]): Promise<number[]> {
  const aes = await import('aes-js');
  const ecb = new aes.ModeOfOperation.ecb(QIYI_AES_KEY);
  const out = ecb.decrypt(new Uint8Array(block));
  return Array.from(out);
}

// Fragmentation: each 16-byte cipher block is sent as its own BLE write.
//   Block 0: prefix [0x00, msg.length+2, 0x40, 0x00]   → 20 bytes
//   Block i (i>=1): prefix [(i*16) >> 4 = i]           → 17 bytes
// (csTimer line 60: `i == 0 ? [0x00, msg.length+2, 0x40, 0x00] : [i >> 4]`,
//  where `i` is the byte offset, so `i >> 4` collapses to the block index.)
async function buildFrames(plaintext: number[]): Promise<Uint8Array[]> {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < plaintext.length; i += 16) {
    const block = plaintext.slice(i, i + 16);
    while (block.length < 16) block.push(0x01);  // pad with 0x01
    const cipher = await aesEncryptBlock(block);
    const prefix = i === 0 ? [0x00, plaintext.length + 2, 0x40, 0x00] : [i >> 4];
    const frame = new Uint8Array(prefix.length + 16);
    for (let j = 0; j < prefix.length; j++) frame[j] = prefix[j];
    for (let j = 0; j < 16; j++) frame[prefix.length + j] = cipher[j];
    frames.push(frame);
  }
  return frames;
}

// Build a complete plaintext message before encryption:
//   sendSN(4 BE) | ackSN(4 BE) | cmd(2 BE) | len(2 BE) | data | crc16(2 BE)
//
// Matches csTimer sendMessage(): CRC pushed high-byte first, low-byte second.
function buildPlaintext(sendSN: number, ackSN: number, cmd: number, data: number[]): number[] {
  const msg: number[] = [];
  msg.push((sendSN >> 24) & 0xff, (sendSN >> 16) & 0xff, (sendSN >> 8) & 0xff, sendSN & 0xff);
  msg.push((ackSN  >> 24) & 0xff, (ackSN  >> 16) & 0xff, (ackSN  >> 8) & 0xff, ackSN  & 0xff);
  msg.push((cmd >> 8) & 0xff, cmd & 0xff);
  msg.push((data.length >> 8) & 0xff, data.length & 0xff);
  for (const b of data) msg.push(b);
  const crc = crc16modbus(msg);
  msg.push((crc >> 8) & 0xff, crc & 0xff);
  return msg;
}

// Hello payload: [0, 0, 0, 0, 0, 33, 8, 0, 1, 5, 90, ...mac-reversed]
//                                                     mac as "AA:BB:CC:DD:EE:FF"
function buildHelloContent(mac: string): number[] {
  const content = [0, 0, 0, 0, 0, 33, 8, 0, 1, 5, 90];
  // csTimer pushes from i=5 down to i=0 of the colon-separated MAC.
  for (let i = 5; i >= 0; i--) {
    content.push(parseInt(mac.slice(i * 3, i * 3 + 2), 16));
  }
  return content;
}

// Fallback MAC inferred from the advertised device name:
//   "QY-Timer-XXXX-1234"   → "CC:A1:00:00:12:34"
//   "QY-Adapter-XXXX-1234" → "CC:A8:00:00:12:34"
function fallbackMacFromName(name: string): string | null {
  const m = QIYI_NAME_RE.exec(name);
  if (!m) return null;
  const tail = m[1];
  const prefix = name.startsWith('QY-Adapter') ? 'CC:A8' : 'CC:A1';
  return `${prefix}:00:00:${tail.slice(0, 2)}:${tail.slice(2, 4)}`;
}

export function useQiyiTimer(callbacks: QiyiCallbacks) {
  const supported =
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { bluetooth?: unknown }).bluetooth !== 'undefined';

  const [state, setState] = useState<QiyiState>(supported ? 'idle' : 'unsupported');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<QiyiLiveState>('idle');

  const stateRef = useRef(state);
  stateRef.current = state;
  const liveStateRef = useRef<QiyiLiveState>('idle');
  useEffect(() => { liveStateRef.current = liveState; }, [liveState]);

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // BLE handles
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const writeCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const notifyCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const onDisconnectedRef = useRef<((e: Event) => void) | null>(null);
  const notifyHandlerRef = useRef<((e: Event) => void) | null>(null);

  // Reassembly state — mirrors csTimer waitPkg/payloadLen/payloadData.
  const waitPkgRef = useRef<number>(0);
  const payloadLenRef = useRef<number>(0);
  const payloadDataRef = useRef<number[]>([]);

  const teardown = useCallback(() => {
    const dev = deviceRef.current;
    const notify = notifyCharRef.current;
    const handler = notifyHandlerRef.current;
    if (notify && handler) {
      try { notify.removeEventListener('characteristicvaluechanged', handler); } catch { /* ignore */ }
      try { notify.stopNotifications(); } catch { /* ignore */ }
    }
    if (dev && onDisconnectedRef.current) {
      try { dev.removeEventListener('gattserverdisconnected', onDisconnectedRef.current); } catch { /* ignore */ }
    }
    if (dev?.gatt?.connected) {
      try { dev.gatt.disconnect(); } catch { /* ignore */ }
    }
    deviceRef.current = null;
    writeCharRef.current = null;
    notifyCharRef.current = null;
    onDisconnectedRef.current = null;
    notifyHandlerRef.current = null;
    waitPkgRef.current = 0;
    payloadLenRef.current = 0;
    payloadDataRef.current = [];
    setDeviceName(null);
    setLiveState('idle');
  }, []);

  // Send a list of BLE frames over the write characteristic, in order.
  const writeFrames = useCallback(async (frames: Uint8Array[]) => {
    const wc = writeCharRef.current;
    if (!wc) throw new Error('No QiYi write characteristic');
    for (const f of frames) {
      // Copy into a fresh ArrayBuffer to satisfy strict BufferSource typings.
      const ab = new ArrayBuffer(f.byteLength);
      new Uint8Array(ab).set(f);
      // csTimer uses writeValue() — keep that for parity (default behaviour).
      await wc.writeValue(ab);
    }
  }, []);

  // High-level: build, encrypt, fragment, send.
  const sendMessage = useCallback(async (sendSN: number, ackSN: number, cmd: number, data: number[]) => {
    const plaintext = buildPlaintext(sendSN, ackSN, cmd, data);
    const frames = await buildFrames(plaintext);
    // eslint-disable-next-line no-console
    console.log('[QiYi] send', { sendSN, ackSN, cmd: '0x' + cmd.toString(16), data, plaintextLen: plaintext.length, frames: frames.length });
    await writeFrames(frames);
  }, [writeFrames]);

  const sendHello = useCallback(async (mac: string) => {
    const content = buildHelloContent(mac);
    return sendMessage(1, 0, 0x0001, content);
  }, [sendMessage]);

  const sendAck = useCallback(async (sendSN: number, ackSN: number, cmd: number) => {
    return sendMessage(sendSN, ackSN, cmd, [0x00]);
  }, [sendMessage]);

  // ── Inbound: reassemble + decrypt + dispatch (mirrors csTimer onReadEvent) ─
  const handleNotify = useCallback(async (rawBytes: Uint8Array) => {
    // eslint-disable-next-line no-console
    console.log('[QiYi] raw notify', Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join(' '));

    let msg: number[] = Array.from(rawBytes);

    // Drop fragments out of order. The first fragment always has pktNum==0;
    // subsequent fragments have monotonically increasing pktNum.
    if (msg[0] !== waitPkgRef.current) {
      waitPkgRef.current = 0;
      payloadDataRef.current = [];
      if (msg[0] !== 0) return;
    }

    if (msg[0] === 0) {
      // First fragment carries plaintext length: `msg[1] - 2`.
      payloadLenRef.current = msg[1] - 2;
      msg = msg.slice(4);  // strip [0x00, len+2, 0x40, 0x00]
    } else {
      msg = msg.slice(1);  // strip [pktNum]
    }

    // Each fragment payload is exactly one (or several) full 16-byte cipher
    // block(s). Decrypt each in place and append to the reassembly buffer.
    for (let i = 0; i < msg.length; i += 16) {
      const block = msg.slice(i, i + 16);
      if (block.length < 16) {
        waitPkgRef.current = 0;
        payloadDataRef.current = [];
        return;
      }
      const plain = await aesDecryptBlock(block);
      payloadDataRef.current = payloadDataRef.current.concat(plain);
    }

    if (payloadDataRef.current.length < payloadLenRef.current) {
      waitPkgRef.current += 1;
      return;
    }

    const data = payloadDataRef.current.slice(0, payloadLenRef.current);
    waitPkgRef.current = 0;
    payloadDataRef.current = [];

    // ── CRC verify (csTimer trick: appending CRC bytes [low,high] makes the
    //    CRC of (msg+CRC) equal 0 when the original CRC is right). ─────────
    const declaredLen = (data[10] << 8) | data[11];
    const crcInput = data.slice(0, declaredLen + 12).concat([data[declaredLen + 13], data[declaredLen + 12]]);
    if (crc16modbus(crcInput) !== 0) {
      // eslint-disable-next-line no-console
      console.warn('[QiYi] CRC mismatch — dropping frame');
      return;
    }

    const sendSN = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
    const ackSN  = ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0;
    const cmd    = (data[8]  << 8)  | data[9];
    const payload = data.slice(12, declaredLen + 12);

    if (cmd !== 0x1003) {
      // eslint-disable-next-line no-console
      console.log('[QiYi] ignoring cmd', '0x' + cmd.toString(16));
      return;
    }

    const dpId   = payload[0];
    const dpType = payload[1];
    const cb = callbacksRef.current;

    if (dpId === 1 && dpType === 1) {
      // Final solve record. solveTime at [8..11], inspectTime at [12..15].
      const solveMs = ((payload[8]  << 24) | (payload[9]  << 16) | (payload[10] << 8) | payload[11]) >>> 0;
      const inspectMs = ((payload[12] << 24) | (payload[13] << 16) | (payload[14] << 8) | payload[15]) >>> 0;
      // eslint-disable-next-line no-console
      console.log('[QiYi] FINISH solveMs=', solveMs, ' inspectMs=', inspectMs);
      liveStateRef.current = 'stopped';
      setLiveState('stopped');
      cb.onSolveStop?.(solveMs);
      // Acknowledge per csTimer: sendAck(ackSN+1, sendSN, 0x1003).
      try {
        await sendAck(ackSN + 1, sendSN, 0x1003);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[QiYi] ack send failed', err);
      }
      return;
    }

    if (dpId === 4 && dpType === 4) {
      const idx = payload[4];
      const states: QiyiLiveState[] = ['idle', 'inspection', 'getSet', 'running', 'finished', 'stopped', 'idle'];
      const next = states[idx] ?? 'idle';
      const solveMs = ((payload[5] << 24) | (payload[6] << 16) | (payload[7] << 8) | payload[8]) >>> 0;
      // eslint-disable-next-line no-console
      console.log('[QiYi] STATUS idx=', idx, ' state=', next, ' solveMs=', solveMs);

      const prev = liveStateRef.current;
      liveStateRef.current = next;
      setLiveState(next);

      if (next === 'idle' && prev !== 'idle') cb.onIdle?.();
      else if (next === 'inspection') cb.onInspection?.();
      else if (next === 'getSet') cb.onGetSet?.();
      else if (next === 'running' && prev !== 'running') cb.onSolveStart?.();
      // 'finished' and 'stopped' don't fire onSolveStop — that arrives via
      // the dpId=1 finish packet which has the authoritative time.
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[QiYi] unknown dp', { dpId, dpType, payload });
  }, [sendAck]);

  // ── connect ────────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!supported) return;
    if (stateRef.current === 'connecting' || stateRef.current === 'connected') return;
    setState('connecting');

    try {
      // DEBUG MODE: show ALL nearby BLE devices so the user can identify what
      // their QiYi timer actually advertises. After we confirm the real name
      // pattern, this can be tightened back to namePrefix filters.
      //
      // The csTimer reference assumes "QY-Timer-XXXX-NNNN" / "QY-Adapter-…"
      // but firmware revisions vary, and some devices advertise plain "QiYi"
      // or generic Bluetooth-LE-Module names. Approach C surfaces them all.
      const requestOpts: RequestDeviceOptions = {
        acceptAllDevices: true,
        optionalServices: [QIYI_SERVICE],
      };
      // eslint-disable-next-line no-console
      console.log('[QiYi] scanning for devices…');
      // eslint-disable-next-line no-console
      console.log('[QiYi] Requesting BLE device with options:', JSON.stringify(requestOpts));
      // eslint-disable-next-line no-console
      console.log('[QiYi] Tip: if the picker is empty, your browser may not see the timer. ' +
        'Tighter filters previously tried: namePrefix=[QY-Timer, QY-Adapter, QiYi, Qiyi] / services=[' + QIYI_SERVICE + ']');

      const bt = (navigator as Navigator & { bluetooth: { requestDevice: (o: RequestDeviceOptions) => Promise<BluetoothDevice> } }).bluetooth;
      const device = await bt.requestDevice(requestOpts);

      // eslint-disable-next-line no-console
      console.log('[QiYi] Selected device:', { name: device.name, id: device.id });
      // eslint-disable-next-line no-console
      console.log('[QiYi] (If the name doesn\'t match QY-Timer/QY-Adapter, the MAC fallback will use placeholder zeros — let us know what the device advertises.)');
      setDeviceName(device.name ?? 'QiYi Timer');
      deviceRef.current = device;

      const onDisconnected = () => {
        // eslint-disable-next-line no-console
        console.log('[QiYi] gattserverdisconnected');
        teardown();
        setState('idle');
      };
      onDisconnectedRef.current = onDisconnected;
      device.addEventListener('gattserverdisconnected', onDisconnected);

      if (!device.gatt) throw new Error('No GATT server on device');
      // eslint-disable-next-line no-console
      console.log('[QiYi] connecting GATT…');
      const server = await device.gatt.connect();
      // Enumerate primary services to help diagnose "wrong device picked" cases.
      try {
        const services = await server.getPrimaryServices();
        // eslint-disable-next-line no-console
        console.log('[QiYi] device exposes services:', services.map(s => s.uuid));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[QiYi] could not enumerate services (may need optionalServices)', err);
      }
      // eslint-disable-next-line no-console
      console.log('[QiYi] getting primary service', QIYI_SERVICE);
      const service = await server.getPrimaryService(QIYI_SERVICE);
      // eslint-disable-next-line no-console
      console.log('[QiYi] getting characteristics');
      try {
        const allChars = await service.getCharacteristics();
        // eslint-disable-next-line no-console
        console.log('[QiYi] service exposes characteristics:', allChars.map(c => ({ uuid: c.uuid, props: c.properties })));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[QiYi] could not list characteristics', err);
      }
      const writeChar  = await service.getCharacteristic(QIYI_CHRCT_WRITE);
      const notifyChar = await service.getCharacteristic(QIYI_CHRCT_READ);
      writeCharRef.current = writeChar;
      notifyCharRef.current = notifyChar;

      const handler = (e: Event) => {
        const ch = e.target as BluetoothRemoteGATTCharacteristic;
        const v = ch.value;
        if (!v) return;
        const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        void handleNotify(bytes);
      };
      notifyHandlerRef.current = handler;
      notifyChar.addEventListener('characteristicvaluechanged', handler);
      // eslint-disable-next-line no-console
      console.log('[QiYi] starting notifications');
      await notifyChar.startNotifications();

      // Determine MAC — Web Bluetooth doesn't surface manufacturer-data on
      // Chrome stable, so fall back to the device-name-derived MAC.
      const fallback = device.name ? fallbackMacFromName(device.name) : null;
      const mac = fallback ?? '00:00:00:00:00:00';
      // eslint-disable-next-line no-console
      console.log('[QiYi] using MAC', mac, fallback ? '(from name)' : '(placeholder — name didn\'t match QY pattern)');

      // eslint-disable-next-line no-console
      console.log('[QiYi] sending hello');
      await sendHello(mac);

      // eslint-disable-next-line no-console
      console.log('[QiYi] connected');
      setState('connected');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[QiYi] connect failed', err);
      teardown();
      setState(supported ? 'idle' : 'unsupported');
    }
  }, [supported, teardown, handleNotify, sendHello]);

  const disconnect = useCallback(() => {
    teardown();
    setState(supported ? 'idle' : 'unsupported');
  }, [supported, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return { state, connect, disconnect, supported, deviceName, liveState };
}
