// Generate site-wide PWA/favicon icons from the club's real logo.
// Unlike gen-pwa-icons.mjs (which draws a stopwatch procedurally for the
// Timer-scoped manifest), this composites the actual "Mongol Shoochid"
// artwork onto each target size — requires `sharp` (devDependency).
//
// Usage:  node scripts/gen-site-icons.mjs
//
// Source: public/Mongol Shoochid Har Fongui.png (3543x3543, transparent) —
// used as the full canvas (emblem + the "МОНГОЛ ШОЧИД" wordmark below it),
// not cropped to the emblem alone.
//
// Outputs (all composited onto #080810, the site's --bg dark value):
//   public/icon-192.png            — rounded square, transparent corners (purpose: any)
//   public/icon-512.png            — same, higher-res
//   public/icon-192-maskable.png   — full-bleed square, safe-zone padded (purpose: maskable)
//   public/icon-512-maskable.png   — same
//   public/apple-touch-icon.png    — 180x180, fully opaque, no pre-rounded corners
//                                     (kept at the conventional root URL path too —
//                                     some non-Next-aware tools look for it there)
//   app/icon.png                  — 512x512, Next.js's auto-favicon convention
//   app/apple-icon.png            — 180x180, Next.js's auto apple-touch-icon convention
import sharp from 'sharp';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const SRC = 'public/Mongol Shoochid Har Fongui.png';
const BG = '#080810';

async function loadEmblem() {
  return sharp(SRC).toBuffer();
}

function roundedRectSvg(size, radius, color) {
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${color}"/></svg>`,
  );
}

async function resizedEmblem(emblemBuf, contentSize) {
  return sharp(emblemBuf).resize(contentSize, contentSize, { fit: 'contain' }).toBuffer();
}

/** purpose: "any" — rounded square, transparent outside the curve (matches the existing timer-icon style). */
async function makeAny(size, emblemBuf, outPath) {
  const radius = Math.round(size * 0.18);
  const bg = await sharp(roundedRectSvg(size, radius, BG)).png().toBuffer();
  const contentSize = Math.round(size * 0.72);
  const emblem = await resizedEmblem(emblemBuf, contentSize);
  const offset = Math.round((size - contentSize) / 2);
  await sharp(bg).composite([{ input: emblem, left: offset, top: offset }]).png().toFile(outPath);
}

/** purpose: "maskable" — full-bleed solid square, content confined to the ~62% safe zone. */
async function makeMaskable(size, emblemBuf, outPath) {
  const contentSize = Math.round(size * 0.62);
  const emblem = await resizedEmblem(emblemBuf, contentSize);
  const offset = Math.round((size - contentSize) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: emblem, left: offset, top: offset }])
    .png()
    .toFile(outPath);
}

/** apple-touch-icon — fully opaque, no pre-rounded corners (iOS applies its own mask). */
async function makeAppleTouch(size, emblemBuf, outPath) {
  const contentSize = Math.round(size * 0.72);
  const emblem = await resizedEmblem(emblemBuf, contentSize);
  const offset = Math.round((size - contentSize) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: emblem, left: offset, top: offset }])
    .flatten({ background: BG })
    .png()
    .toFile(outPath);
}

async function main() {
  const emblemBuf = await loadEmblem();
  const pubDir = path.join(process.cwd(), 'public');
  const appDir = path.join(process.cwd(), 'app');
  if (!existsSync(pubDir)) mkdirSync(pubDir, { recursive: true });

  await makeAny(192, emblemBuf, path.join(pubDir, 'icon-192.png'));
  console.log('  ✓ public/icon-192.png');
  await makeAny(512, emblemBuf, path.join(pubDir, 'icon-512.png'));
  console.log('  ✓ public/icon-512.png');
  await makeMaskable(192, emblemBuf, path.join(pubDir, 'icon-192-maskable.png'));
  console.log('  ✓ public/icon-192-maskable.png');
  await makeMaskable(512, emblemBuf, path.join(pubDir, 'icon-512-maskable.png'));
  console.log('  ✓ public/icon-512-maskable.png');
  await makeAppleTouch(180, emblemBuf, path.join(pubDir, 'apple-touch-icon.png'));
  console.log('  ✓ public/apple-touch-icon.png');
  await makeAny(512, emblemBuf, path.join(appDir, 'icon.png'));
  console.log('  ✓ app/icon.png');
  await makeAppleTouch(180, emblemBuf, path.join(appDir, 'apple-icon.png'));
  console.log('  ✓ app/apple-icon.png');

  console.log('Done.');
}

main().catch((err) => { console.error(err); process.exit(1); });
