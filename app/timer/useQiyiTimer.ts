'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Public surface mirrors useGanTimer so the page can route either hook
// through the same UI / callbacks.
export type QiyiState = 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';
export type QiyiLiveState = 'idle' | 'inspection' | 'getSet' | 'running' | 'stopped';

export interface QiyiCallbacks {
  /** GET_SET (state=2) — the device is armed; physical timer about to start. */
  onGetSet?: () => void;
  /** RUNNING (state=3) — timer started counting. */
  onSolveStart?: () => void;
  /** Final time received (dpId=1 finish message), in milliseconds. */
  onSolveStop?: (finalMs: number) => void;
  /** IDLE — device reset back to ready. */
  onIdle?: () => void;
  /** INSPECTION — informational. */
  onInspection?: () => void;
}

// ── BLE constants — sourced from CubicTimer (TimerFragment.java) ────────────
const QIYI_SERVICE          = '0000fd50-0000-1000-8000-00805f9b34fb';
const QIYI_WRITE_CHAR       = '00000001-0000-1001-8001-00805f9b07d0';
const QIYI_NOTIFY_CHAR      = '00000002-0000-1001-8001-00805f9b07d0';
// Hardcoded AES-128/ECB key: 0x77 × 16.
const QIYI_AES_KEY = new Uint8Array(16).fill(0x77);
// MAC address isn't accessible via Web Bluetooth (privacy), so we use a
// deterministic placeholder for the handshake's reversed-MAC bytes. If a
// timer rejects this, the fallback will be visible as no notifications.
const QIYI_PLACEHOLDER_MAC_REVERSED = new Uint8Array([0, 0, 0, 0, 0, 0]);

// CRC-16/MODBUS — init 0xFFFF, poly 0xA001 (reflected 0x8005), no final XOR.
function crc16Modbus(data: Uint8Array): number {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let k = 0; k < 8; k++) {
      if (crc & 0x0001) crc = (crc >>> 1) ^ 0xA001;
      else crc = crc >>> 1;
    }
  }
  return crc & 0xFFFF;
}

// Pad a plaintext message to a 16-byte multiple with 0x01 bytes (per CubicTimer).
function padToBlock(buf: Uint8Array): Uint8Array {
  const padLen = (16 - (buf.length % 16)) % 16;
  if (padLen === 0) return buf;
  const out = new Uint8Array(buf.length + padLen);
  out.set(buf, 0);
  out.fill(0x01, buf.length);
  return out;
}

// AES-128/ECB encrypt a multiple-of-16 buffer.
async function aesEcbEncrypt(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const aes = await import('aes-js');
  const ecb = new aes.ModeOfOperation.ecb(key);
  return ecb.encrypt(data);
}
async function aesEcbDecrypt(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const aes = await import('aes-js');
  const ecb = new aes.ModeOfOperation.ecb(key);
  return ecb.decrypt(data);
}

// Build a complete encrypted message ready to fragment.
//   plaintext = seqNum(4 BE) | respNum(4 BE) | cmd(2 BE) | pldLen(2 BE) | payload | crc16(2 BE)
async function buildQiyiMessage(seqNum: number, respNum: number, cmd: number, payload: Uint8Array): Promise<Uint8Array> {
  const head = new Uint8Array(12 + payload.length);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, seqNum >>> 0, false);
  dv.setUint32(4, respNum >>> 0, false);
  dv.setUint16(8, cmd & 0xFFFF, false);
  dv.setUint16(10, payload.length & 0xFFFF, false);
  head.set(payload, 12);
  const crc = crc16Modbus(head);
  const full = new Uint8Array(head.length + 2);
  full.set(head, 0);
  full[full.length - 2] = (crc >>> 8) & 0xFF;
  full[full.length - 1] = crc & 0xFF;
  // pad + encrypt
  const padded = padToBlock(full);
  return aesEcbEncrypt(QIYI_AES_KEY, padded);
}

// Wrap an encrypted body into the BLE-fragmented frame(s).
//   frame 0: pktNum=1 | msgLen=plaintextLen+2 | 0x40 | 0x00 | ciphertext...
//   frame n: pktNum=n+1 | ciphertext...
function fragmentForBle(ciphertext: Uint8Array, plaintextLen: number): Uint8Array[] {
  const HEADER_FIRST = 4; // pktNum, msgLen, version, securityFlag
  const HEADER_REST  = 1; // pktNum
  const MAX_PAYLOAD_FIRST = 20 - HEADER_FIRST;
  const MAX_PAYLOAD_REST  = 20 - HEADER_REST;
  const frames: Uint8Array[] = [];
  let offset = 0;
  let pktNum = 1;
  while (offset < ciphertext.length) {
    if (pktNum === 1) {
      const take = Math.min(MAX_PAYLOAD_FIRST, ciphertext.length - offset);
      const f = new Uint8Array(HEADER_FIRST + take);
      f[0] = pktNum;
      f[1] = (plaintextLen + 2) & 0xFF;
      f[2] = 0x40;
      f[3] = 0x00;
      f.set(ciphertext.subarray(offset, offset + take), HEADER_FIRST);
      frames.push(f);
      offset += take;
    } else {
      const take = Math.min(MAX_PAYLOAD_REST, ciphertext.length - offset);
      const f = new Uint8Array(HEADER_REST + take);
      f[0] = pktNum;
      f.set(ciphertext.subarray(offset, offset + take), HEADER_REST);
      frames.push(f);
      offset += take;
    }
    pktNum++;
  }
  return frames;
}

// Build the two handshake frames CubicTimer sends on connect.
async function buildHandshakeFrames(): Promise<{ frames: Uint8Array[]; plaintextLen: number }[]> {
  // Header_1: 00 00 00 00 00 21 08 00 01 05 5A
  // Header_2: 00 00 00 00 00 22 05 00 01 06 5A
  const h1 = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0x08, 0x00, 0x01, 0x05, 0x5A, ...QIYI_PLACEHOLDER_MAC_REVERSED]);
  const h2 = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x22, 0x05, 0x00, 0x01, 0x06, 0x5A, ...QIYI_PLACEHOLDER_MAC_REVERSED]);
  // Each is wrapped via buildQiyiMessage(seqNum=1, respNum=0, cmd=0x0001, payload).
  // But only ONE of the two is the "command" payload — CubicTimer sends both as
  // separate messages with cmd=0x0001. We mirror that.
  async function wrap(payload: Uint8Array) {
    // The plaintext length is what fragmentation header reports as `msgLen-2`,
    // i.e. the length of seqNum..crc (head + crc) BEFORE padding.
    const plaintextLen = 12 + payload.length + 2; // header(12) + payload + crc(2)
    const cipher = await buildQiyiMessage(1, 0, 0x0001, payload);
    return { frames: fragmentForBle(cipher, plaintextLen), plaintextLen };
  }
  return [await wrap(h1), await wrap(h2)];
}

interface InboundReassembler {
  expectedMsgLen: number;       // plaintext length (msgLen - 2, i.e. without overhead)
  cipherChunks: Uint8Array[];
  cipherLenSoFar: number;
  expectedCipherLen: number;
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

  // BLE handles — kept on refs so we can tear down deterministically.
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const writeCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const notifyCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const reassemblerRef = useRef<InboundReassembler | null>(null);
  const onDisconnectedRef = useRef<((e: Event) => void) | null>(null);
  const notifyHandlerRef = useRef<((e: Event) => void) | null>(null);

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
    reassemblerRef.current = null;
    onDisconnectedRef.current = null;
    notifyHandlerRef.current = null;
    setDeviceName(null);
    setLiveState('idle');
  }, []);

  // Decode an inbound packet from the QiYi notify characteristic.
  const onIncoming = useCallback(async (data: Uint8Array) => {
    if (data.length < 1) return;
    const pktNum = data[0];
    if (pktNum === 1) {
      // First fragment: pktNum | msgLen | 0x40 | 0x00 | ciphertext...
      if (data.length < 4) return;
      const msgLen = data[1];          // plaintext_len + 2
      const plaintextLen = msgLen;     // includes overhead per the encoder
      const expectedCipherLen = Math.ceil(plaintextLen / 16) * 16;
      const r: InboundReassembler = {
        expectedMsgLen: plaintextLen,
        cipherChunks: [data.subarray(4)],
        cipherLenSoFar: data.length - 4,
        expectedCipherLen,
      };
      reassemblerRef.current = r;
    } else {
      const r = reassemblerRef.current;
      if (!r) return;
      r.cipherChunks.push(data.subarray(1));
      r.cipherLenSoFar += data.length - 1;
    }
    const r = reassemblerRef.current;
    if (!r) return;
    if (r.cipherLenSoFar < r.expectedCipherLen) return;

    // Concatenate exactly expectedCipherLen bytes.
    const cipher = new Uint8Array(r.expectedCipherLen);
    let off = 0;
    for (const chunk of r.cipherChunks) {
      const need = r.expectedCipherLen - off;
      if (need <= 0) break;
      const take = Math.min(chunk.length, need);
      cipher.set(chunk.subarray(0, take), off);
      off += take;
    }
    reassemblerRef.current = null;

    let plain: Uint8Array;
    try {
      plain = await aesEcbDecrypt(QIYI_AES_KEY, cipher);
    } catch {
      return;
    }
    // header(12) + payload + crc(2) = msgLen+? — but msgLen field above is
    // (plaintext_len + 2). Trust it for slicing. Total useful = msgLen.
    if (plain.length < r.expectedMsgLen) return;
    const useful = plain.subarray(0, r.expectedMsgLen);
    if (useful.length < 14) return;

    const dv = new DataView(useful.buffer, useful.byteOffset, useful.byteLength);
    const cmd = dv.getUint16(8, false);
    const pldLen = dv.getUint16(10, false);
    if (12 + pldLen + 2 > useful.length) return;
    const payload = useful.subarray(12, 12 + pldLen);
    const crcBytes = useful.subarray(12 + pldLen, 12 + pldLen + 2);
    const expectedCrc = (crcBytes[0] << 8) | crcBytes[1];
    const computedCrc = crc16Modbus(useful.subarray(0, 12 + pldLen));
    if (expectedCrc !== computedCrc) {
      // CRC mismatch — likely garbled. Skip.
      return;
    }

    if (cmd !== 0x1003) return; // CubicTimer only acts on this command.

    // Walk DP entries: dpId(1) | dpType(1) | dpLen(2 BE) | dp(dpLen)
    let p = 0;
    const cb = callbacksRef.current;
    while (p + 4 <= payload.length) {
      const dpId = payload[p];
      const dpType = payload[p + 1];
      const dpLen = (payload[p + 2] << 8) | payload[p + 3];
      const dpEnd = p + 4 + dpLen;
      if (dpEnd > payload.length) break;
      const dp = payload.subarray(p + 4, dpEnd);
      // dpId=1, dpType=1 → finish: skip 4 bytes, then solveTime(4 BE), inspectionTime(4 BE)
      if (dpId === 1 && dpType === 1 && dp.length >= 12) {
        const ms = ((dp[4] << 24) | (dp[5] << 16) | (dp[6] << 8) | dp[7]) >>> 0;
        liveStateRef.current = 'stopped';
        setLiveState('stopped');
        cb.onSolveStop?.(ms);
      }
      // dpId=4, dpType=4 → status(1) | solveTime(4 BE)
      if (dpId === 4 && dpType === 4 && dp.length >= 1) {
        const status = dp[0];
        // 0=IDLE, 1=INSPECTION, 2=GET_SET, 3=RUNNING, 4=STOPPED
        const prev = liveStateRef.current;
        if (status === 0) {
          liveStateRef.current = 'idle';
          setLiveState('idle');
          if (prev !== 'idle') cb.onIdle?.();
        } else if (status === 1) {
          liveStateRef.current = 'inspection';
          setLiveState('inspection');
          cb.onInspection?.();
        } else if (status === 2) {
          liveStateRef.current = 'getSet';
          setLiveState('getSet');
          cb.onGetSet?.();
        } else if (status === 3) {
          // Fire onSolveStart only on the first transition into running.
          const wasRunning = prev === 'running';
          liveStateRef.current = 'running';
          setLiveState('running');
          if (!wasRunning) cb.onSolveStart?.();
        } else if (status === 4) {
          liveStateRef.current = 'stopped';
          setLiveState('stopped');
        }
      }
      p = dpEnd;
    }
  }, []);

  const writeFrames = useCallback(async (frames: Uint8Array[]) => {
    const wc = writeCharRef.current;
    if (!wc) throw new Error('No write characteristic');
    for (const f of frames) {
      // Copy into a fresh ArrayBuffer to satisfy BufferSource typing across
      // recent TS lib variants (Uint8Array<ArrayBufferLike> doesn't always
      // assign to BufferSource cleanly).
      const ab = new ArrayBuffer(f.byteLength);
      new Uint8Array(ab).set(f);
      await wc.writeValueWithoutResponse(ab);
    }
  }, []);

  const sendHandshake = useCallback(async () => {
    const wrapped = await buildHandshakeFrames();
    for (const w of wrapped) {
      await writeFrames(w.frames);
    }
  }, [writeFrames]);

  const connect = useCallback(async () => {
    if (!supported) return;
    if (stateRef.current === 'connecting' || stateRef.current === 'connected') return;
    setState('connecting');
    try {
      const bt = (navigator as Navigator & { bluetooth: { requestDevice: (o: unknown) => Promise<BluetoothDevice> } }).bluetooth;
      const device = await bt.requestDevice({
        filters: [{ services: [QIYI_SERVICE] }],
        optionalServices: [QIYI_SERVICE],
      });
      deviceRef.current = device;
      setDeviceName(device.name ?? 'QiYi Timer');

      const onDisconnected = () => {
        teardown();
        setState('idle');
      };
      onDisconnectedRef.current = onDisconnected;
      device.addEventListener('gattserverdisconnected', onDisconnected);

      if (!device.gatt) throw new Error('No GATT server on device');
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(QIYI_SERVICE);
      const writeChar  = await service.getCharacteristic(QIYI_WRITE_CHAR);
      const notifyChar = await service.getCharacteristic(QIYI_NOTIFY_CHAR);
      writeCharRef.current = writeChar;
      notifyCharRef.current = notifyChar;

      const handler = (e: Event) => {
        const ch = e.target as BluetoothRemoteGATTCharacteristic;
        const v = ch.value;
        if (!v) return;
        const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        // Fire-and-forget; reassembler is async but order is preserved by the await chain.
        void onIncoming(bytes);
      };
      notifyHandlerRef.current = handler;
      notifyChar.addEventListener('characteristicvaluechanged', handler);
      await notifyChar.startNotifications();

      // Send handshake so the device starts streaming status updates.
      await sendHandshake();

      setState('connected');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('QiYi timer connect failed', err);
      teardown();
      setState(supported ? 'idle' : 'unsupported');
    }
  }, [supported, teardown, onIncoming, sendHandshake]);

  const disconnect = useCallback(() => {
    teardown();
    setState(supported ? 'idle' : 'unsupported');
  }, [supported, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return { state, connect, disconnect, supported, deviceName, liveState };
}
