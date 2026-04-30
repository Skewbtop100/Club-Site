// Generate PWA icons (PNG) from a procedural stopwatch design.
// No external deps — encodes PNG bytes directly via zlib's deflate.
//
// Usage:  node scripts/gen-pwa-icons.mjs
//
// Outputs:
//   public/timer-icon-192.png
//   public/timer-icon-512.png
//   public/timer-icon-192-maskable.png   (full-bleed bg, inner safe zone)
//   public/timer-icon-512-maskable.png
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import path from 'node:path';

// ── PNG encoding helpers ────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function makePng(size, draw) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type = RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const raw = Buffer.alloc(size * (1 + size * 4));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter byte (none)
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Stopwatch glyph composition ─────────────────────────────────────────────
// Returns a draw(x, y) function for a square canvas of the given size.
// `fullBleed` = true for maskable variant (purple fills the entire square,
// glyph stays inside the safe zone). `fullBleed` = false leaves rounded
// corners transparent so the OS doesn't see a perfect square outline.
function makeDraw(size, fullBleed) {
  const PURPLE = [0xA7, 0x8B, 0xFA, 0xFF];
  const DARK   = [0x14, 0x14, 0x14, 0xFF];
  const WHITE  = [0xFF, 0xFF, 0xFF, 0xFF];
  const TRANSPARENT = [0, 0, 0, 0];

  const cx = size / 2;
  const cy = size * (fullBleed ? 0.52 : 0.55);
  const rOuter = size * (fullBleed ? 0.26 : 0.30);
  const ringWidth = Math.max(2, size * 0.035);
  const rInner = rOuter - ringWidth;
  const rDot = Math.max(2, size * 0.025);

  const crownW = size * 0.12;
  const crownH = size * 0.05;
  const crownTop = cy - rOuter - crownH;
  const crownBot = cy - rOuter + 1; // overlap ring slightly

  const handLen = rInner * 0.85;
  const angleFromUp = Math.PI / 4;          // 45° clockwise from up
  const ux = Math.sin(angleFromUp);
  const uy = -Math.cos(angleFromUp);
  const handThickness = Math.max(2, size * 0.012);

  const cornerR = fullBleed ? 0 : size * 0.18;

  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Center dot — drawn last (over everything)
    if (dist < rDot) return WHITE;

    // Hand line
    const t = dx * ux + dy * uy;
    const perp = Math.abs(-dx * uy + dy * ux);
    if (t >= 0 && t <= handLen && perp < handThickness) return WHITE;

    // Crown (top stem)
    if (Math.abs(x - cx) < crownW / 2 && y >= crownTop && y <= crownBot) return WHITE;

    // Ring outline
    if (dist >= rInner && dist <= rOuter) return WHITE;

    // Dial face
    if (dist < rInner) return DARK;

    // Background — rounded square (or full bleed)
    if (cornerR > 0) {
      const ix = Math.min(x, size - 1 - x);
      const iy = Math.min(y, size - 1 - y);
      if (ix < cornerR && iy < cornerR) {
        const dxc = cornerR - ix;
        const dyc = cornerR - iy;
        if (dxc * dxc + dyc * dyc > cornerR * cornerR) return TRANSPARENT;
      }
    }
    return PURPLE;
  };
}

// ── Write outputs ───────────────────────────────────────────────────────────
const pubDir = path.join(process.cwd(), 'public');
if (!existsSync(pubDir)) mkdirSync(pubDir, { recursive: true });

const targets = [
  { file: 'timer-icon-192.png',          size: 192, mask: false },
  { file: 'timer-icon-512.png',          size: 512, mask: false },
  { file: 'timer-icon-192-maskable.png', size: 192, mask: true  },
  { file: 'timer-icon-512-maskable.png', size: 512, mask: true  },
];

for (const t of targets) {
  const png = makePng(t.size, makeDraw(t.size, t.mask));
  writeFileSync(path.join(pubDir, t.file), png);
  console.log(`  ✓ ${t.file}  (${png.length.toLocaleString()} bytes)`);
}
console.log('Done.');
