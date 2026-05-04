// ICON LIBRARY
//
// All icons should be SVG components, not emoji.
// Style: 24x24 viewBox, currentColor stroke, strokeWidth 1.8,
// strokeLinecap round, strokeLinejoin round.
//
// Add new icons here when needed for consistency across the app.
//
// Notes:
//   - Color comes from `currentColor` — set it via the parent's CSS
//     `color`, or pass an explicit `color` prop.
//   - For "filled" variants, pass `filled` to flip the SVG to use
//     `fill={currentColor}` instead of `stroke`.
//   - These intentionally duplicate a few names from app/timer/page.tsx
//     (IconRefresh, IconUsers, IconBluetooth) — that file's icons live
//     inside the solo-timer module and aren't exported. Sharing comes
//     later if/when both pages migrate to a single source.

import * as React from 'react';

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  color?: string;
  /** Use a filled variant where it makes sense (e.g. dot, star, medal). */
  filled?: boolean;
  /** Forwarded to the root <svg> for layout tweaks. */
  style?: React.CSSProperties;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
  'aria-label'?: string;
}

function IconBase({
  size = 18,
  strokeWidth = 1.8,
  color,
  style,
  className,
  children,
  filled,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', color, ...style }}
      className={className}
      aria-hidden={rest['aria-hidden'] ?? (rest['aria-label'] ? undefined : true)}
      aria-label={rest['aria-label']}
      role={rest['aria-label'] ? 'img' : undefined}
    >{children}</svg>
  );
}

// ── People / community ─────────────────────────────────────────────────────

export function IconUsers(p: IconProps) {
  // Two-people pictogram, 👥 replacement.
  return (
    <IconBase {...p}>
      <circle cx={9} cy={7} r={4} />
      <path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
      <path d="M16 11a4 4 0 1 0-4-4" />
      <path d="M22 21v-1a5 5 0 0 0-4-4.9" />
    </IconBase>
  );
}

export function IconCrown(p: IconProps) {
  // Host indicator. 👑 replacement. Use color="#fbbf24" for gold.
  return (
    <IconBase {...p} filled={p.filled ?? true}>
      <path d="M3 8l4 5 5-7 5 7 4-5-1.5 11h-15z" />
    </IconBase>
  );
}

// ── Achievements / awards ──────────────────────────────────────────────────

export function IconTrophy(p: IconProps) {
  // 🏆 replacement.
  return (
    <IconBase {...p}>
      <path d="M8 4h8v6a4 4 0 0 1-8 0z" />
      <path d="M16 6h3a2 2 0 0 1-3 3" />
      <path d="M8 6H5a2 2 0 0 0 3 3" />
      <path d="M12 14v3" />
      <path d="M9 20h6" />
      <path d="M10 17h4l-1 3h-2z" />
    </IconBase>
  );
}

export function IconMedal(p: IconProps & { tone?: 'gold' | 'silver' | 'bronze' }) {
  // 🥇/🥈/🥉 base. The `tone` prop nudges color when no explicit color
  // is passed — use the constants below for stable theming.
  const c = p.color ?? (
    p.tone === 'silver' ? MEDAL_SILVER
    : p.tone === 'bronze' ? MEDAL_BRONZE
    : MEDAL_GOLD
  );
  return (
    <IconBase {...p} color={c}>
      <path d="M8 3h8l-2 5H10z" />
      <circle cx={12} cy={14} r={6} />
      <path d="M12 11v6" strokeWidth={1.4} />
      <path d="M9 14h6" strokeWidth={1.4} />
    </IconBase>
  );
}

export const MEDAL_GOLD = '#fbbf24';
export const MEDAL_SILVER = '#cbd5e1';
export const MEDAL_BRONZE = '#d97706';

export function IconMedalGold(p: IconProps)   { return <IconMedal {...p} tone="gold" />; }
export function IconMedalSilver(p: IconProps) { return <IconMedal {...p} tone="silver" />; }
export function IconMedalBronze(p: IconProps) { return <IconMedal {...p} tone="bronze" />; }

export function IconStar(p: IconProps) {
  // ⭐ replacement.
  return (
    <IconBase {...p} filled={p.filled ?? true}>
      <path d="M12 3l2.6 5.4 5.9.7-4.3 4.1 1.1 5.8L12 16.3l-5.3 2.7 1.1-5.8L3.5 9.1l5.9-.7z" />
    </IconBase>
  );
}

export function IconDiamond(p: IconProps) {
  // 💎 replacement — used for points throughout the app.
  return (
    <IconBase {...p} filled={p.filled ?? true}>
      <path d="M6 3h12l4 6-10 12L2 9z" />
      <path d="M2 9h20" stroke="rgba(0,0,0,0.18)" strokeWidth={0.6} fill="none" />
      <path d="M9 3l3 6 3-6" stroke="rgba(0,0,0,0.18)" strokeWidth={0.6} fill="none" />
    </IconBase>
  );
}

export function IconTarget(p: IconProps) {
  // 🎯 replacement — achievements / event averages section header.
  return (
    <IconBase {...p}>
      <circle cx={12} cy={12} r={9} />
      <circle cx={12} cy={12} r={5.5} />
      <circle cx={12} cy={12} r={2} />
    </IconBase>
  );
}

export function IconFire(p: IconProps) {
  // 🔥 replacement — win-streak achievement.
  return (
    <IconBase {...p}>
      <path d="M12 3c1 4 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 1-5 1.5 1 1.5 2 3 -3z" />
      <path d="M10 17a2 2 0 1 0 4 0c0-1.5-2-2-2-4 0 1 -2 1.5 -2 4z" />
    </IconBase>
  );
}

export function IconRocket(p: IconProps) {
  // 🚀 replacement — sub-15 PB achievement.
  return (
    <IconBase {...p}>
      <path d="M12 3c4 2 6 6 6 10l-3 4h-6l-3-4c0-4 2-8 6-10z" />
      <circle cx={12} cy={11} r={1.6} />
      <path d="M9 17l-3 4 4-1" />
      <path d="M15 17l3 4-4-1" />
    </IconBase>
  );
}

// ── Status / state ────────────────────────────────────────────────────────

export function IconDot(p: IconProps) {
  // 🟢 / 🟡 / 🔴 replacement. Very small status indicators.
  return (
    <IconBase {...p} filled>
      <circle cx={12} cy={12} r={6} />
    </IconBase>
  );
}

export function IconHourglass(p: IconProps) {
  // ⏳ replacement — "waiting".
  return (
    <IconBase {...p}>
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M6 3v3l6 6 6-6V3" />
      <path d="M6 21v-3l6-6 6 6v3" />
    </IconBase>
  );
}

export function IconFlag(p: IconProps) {
  // 🏁 replacement — racing flag, simplified (no checker pattern).
  return (
    <IconBase {...p}>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5" />
    </IconBase>
  );
}

export function IconGameController(p: IconProps) {
  // 🎮 replacement — match-history pill / multiplayer marker.
  return (
    <IconBase {...p}>
      <path d="M7 8h10a4 4 0 0 1 4 4v3a3 3 0 0 1-5 2l-2-2H10l-2 2a3 3 0 0 1-5-2v-3a4 4 0 0 1 4-4z" />
      <path d="M8 12v3" />
      <path d="M6.5 13.5h3" />
      <circle cx={15.5} cy={12.5} r={0.9} fill="currentColor" />
      <circle cx={17.5} cy={14.5} r={0.9} fill="currentColor" />
    </IconBase>
  );
}

export function IconBolt(p: IconProps) {
  // ⚡ replacement — "Хурдан үйлдлүүд" header.
  return (
    <IconBase {...p} filled={p.filled ?? true}>
      <path d="M13 3L4 14h6l-1 7 9-11h-6z" />
    </IconBase>
  );
}

// ── Playback ──────────────────────────────────────────────────────────────

export function IconPlay(p: IconProps) {
  // ▶️ replacement.
  return (
    <IconBase {...p} filled={p.filled ?? true}>
      <path d="M7 4l13 8-13 8z" />
    </IconBase>
  );
}

export function IconPause(p: IconProps) {
  // ⏸ replacement.
  return (
    <IconBase {...p} filled={p.filled ?? true}>
      <rect x={6} y={4} width={4} height={16} rx={1} />
      <rect x={14} y={4} width={4} height={16} rx={1} />
    </IconBase>
  );
}

export function IconRefresh(p: IconProps) {
  // 🔄 replacement.
  return (
    <IconBase {...p}>
      <path d="M21 12a9 9 0 0 0-15.5-6.3L3 8" />
      <path d="M3 4v4h4" />
      <path d="M3 12a9 9 0 0 0 15.5 6.3L21 16" />
      <path d="M21 20v-4h-4" />
    </IconBase>
  );
}

export function IconUndo(p: IconProps) {
  // ↩️ replacement — instant undo / retry button.
  return (
    <IconBase {...p}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5h-3" />
    </IconBase>
  );
}

// ── Connectivity ──────────────────────────────────────────────────────────

export function IconWifi(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M2 9a16 16 0 0 1 20 0" />
      <path d="M5 13a11 11 0 0 1 14 0" />
      <path d="M8.5 16.5a6 6 0 0 1 7 0" />
      <circle cx={12} cy={20} r={1.2} fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconWifiOff(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M3 3l18 18" />
      <path d="M9 17a4 4 0 0 1 6 0" />
      <path d="M5 13a11 11 0 0 1 4-2.6" />
      <path d="M2 9a16 16 0 0 1 6.4-3.7" />
      <path d="M22 9a16 16 0 0 0-6-3.4" />
      <circle cx={12} cy={20} r={1.2} fill="currentColor" stroke="none" />
    </IconBase>
  );
}

// ── People (with action) ──────────────────────────────────────────────────

export function IconUserPlus(p: IconProps) {
  return (
    <IconBase {...p}>
      <circle cx={9} cy={7} r={4} />
      <path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
      <path d="M19 8v6" />
      <path d="M16 11h6" />
    </IconBase>
  );
}

export function IconUserMinus(p: IconProps) {
  return (
    <IconBase {...p}>
      <circle cx={9} cy={7} r={4} />
      <path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
      <path d="M16 11h6" />
    </IconBase>
  );
}

// ── Status / alerts ───────────────────────────────────────────────────────

export function IconAlertCircle(p: IconProps) {
  return (
    <IconBase {...p}>
      <circle cx={12} cy={12} r={9} />
      <line x1={12} y1={8} x2={12} y2={13} />
      <line x1={12} y1={16.5} x2={12} y2={16.5} strokeWidth={2.4} strokeLinecap="round" />
    </IconBase>
  );
}

// ── Misc reused ───────────────────────────────────────────────────────────

export function IconChart(p: IconProps) {
  // 📊 replacement — "Миний статистик" header.
  return (
    <IconBase {...p}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M7 14l3-3 3 3 4-6" />
    </IconBase>
  );
}

export function IconCheck(p: IconProps) {
  return <IconBase {...p}><path d="M5 12l5 5L20 7" /></IconBase>;
}

export function IconClose(p: IconProps) {
  return <IconBase {...p}><path d="M6 6l12 12" /><path d="M18 6l-12 12" /></IconBase>;
}

export function IconLock(p: IconProps) {
  // 🔒 replacement.
  return (
    <IconBase {...p}>
      <rect x={4} y={11} width={16} height={10} rx={2} />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </IconBase>
  );
}

export function IconSettings(p: IconProps) {
  // ⚙ replacement.
  return (
    <IconBase {...p}>
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </IconBase>
  );
}

// ── Rank helper ────────────────────────────────────────────────────────────
// Returns a medal icon for ranks 1–3, null otherwise. Replaces the
// hand-rolled rank-emoji selectors we used to have inline.
export function rankIcon(
  rank: number,
  size = 18,
): React.ReactNode {
  if (rank === 1) return <IconMedalGold size={size} />;
  if (rank === 2) return <IconMedalSilver size={size} />;
  if (rank === 3) return <IconMedalBronze size={size} />;
  return null;
}
