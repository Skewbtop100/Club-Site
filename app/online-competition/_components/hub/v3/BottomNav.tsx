'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OnlineNotification } from '@/lib/online-competition/types';
import { BellGlyph, NotificationList, UnreadBadge, unreadCountOf } from './NotificationBell';
import { useAttemptsTarget } from './useAttemptsTarget';

// ── Mobile bottom navigation ─────────────────────────────────────────────
// Fixed to the bottom at 640px and below (the header's own breakpoint);
// `.oc-v3-bottomnav` in theme.css is display:none above it, so the desktop
// header is exactly as it was. Rendered by HubNav, so it appears on every
// screen that has the header — and on none that does not, which is how the
// SOLVE PAGE stays bar-free: an athlete mid-run cannot tap away from it.
//
// Padding: the bar reserves env(safe-area-inset-bottom) under itself for
// the home indicator, and `.oc-v3-page` reserves the bar's height plus the
// same inset, so no content ends up underneath it.

const HUB = '/online-competition';
const COMPETITIONS = '/online-competition/competitions';
const VOLT = '#DFFF4F';
const BAR_HEIGHT = 60;

export type BottomSection = 'home' | 'competitions' | 'attempts' | null;

export default function BottomNav({
  section,
  uid,
  notifications,
  onSignIn,
}: {
  /** Which item this screen is; null marks none. */
  section: BottomSection;
  /** The signed-in athlete, or null when signed out / anonymous. */
  uid: string | null;
  notifications: OnlineNotification[];
  /** МЭДЭГДЭЛ while signed out opens the header's sign-in modal. */
  onSignIn: () => void;
}) {
  const target = useAttemptsTarget(uid);
  const [sheetOpen, setSheetOpen] = useState(false);
  const unread = unreadCountOf(notifications);

  useEffect(() => {
    if (!sheetOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSheetOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  // Signing out closes it.
  useEffect(() => {
    if (!uid) setSheetOpen(false);
  }, [uid]);

  return (
    <>
      {sheetOpen && uid && (
        <>
          <div
            role="presentation"
            onClick={() => setSheetOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'rgba(6, 6, 8, 0.6)' }}
          />
          <div
            role="dialog"
            aria-label="Мэдэгдэл"
            className="oc-v3-bottomnav-sheet"
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: `calc(${BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
              zIndex: 55,
              maxHeight: '65vh',
              overflowY: 'auto',
              background: '#0D0D10',
              borderTop: '1px solid #2A2A31',
              boxShadow: '0 -18px 40px -14px rgba(0,0,0,.9)',
            }}
          >
            <NotificationList uid={uid} items={notifications} onNavigate={() => setSheetOpen(false)} />
          </div>
        </>
      )}

      <nav
        aria-label="Үндсэн цэс"
        className="oc-v3-bottomnav"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          background: '#0D0D10',
          borderTop: '1px solid #1C1C21',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <BarLink href={HUB} label="НҮҮР" current={section === 'home'} icon={<HomeGlyph />} />
        <BarLink href={COMPETITIONS} label="ТЭМЦЭЭН" current={section === 'competitions'} icon={<ListGlyph />} />
        <BarLink
          href={target.href}
          label="ОРОЛДЛОГО"
          current={section === 'attempts'}
          icon={<AttemptGlyph live={target.kind === 'active'} />}
          live={target.kind === 'active'}
        />
        <button
          type="button"
          aria-label={unread > 0 ? `Мэдэгдэл, ${unread} уншаагүй` : 'Мэдэгдэл'}
          aria-expanded={sheetOpen}
          onClick={() => (uid ? setSheetOpen((v) => !v) : onSignIn())}
          style={itemStyle(sheetOpen)}
        >
          <Indicator on={sheetOpen} />
          <span style={iconBoxStyle}>
            <BellGlyph />
            {unread > 0 && <UnreadBadge count={unread} style={{ top: -7, right: -11 }} />}
          </span>
          <span style={labelStyle(sheetOpen)}>МЭДЭГДЭЛ</span>
        </button>
      </nav>
    </>
  );
}

// ── pieces ────────────────────────────────────────────────────────────────

function itemStyle(current: boolean): React.CSSProperties {
  return {
    position: 'relative',
    height: BAR_HEIGHT,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    border: 'none',
    background: 'transparent',
    color: current ? VOLT : '#6E6A62',
    textDecoration: 'none',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  };
}

function labelStyle(current: boolean): React.CSSProperties {
  return {
    font: '600 9px/1 var(--oc-font-mono), monospace',
    letterSpacing: '.1em',
    color: current ? '#F4F1EA' : '#6E6A62',
    whiteSpace: 'nowrap',
  };
}

const iconBoxStyle: React.CSSProperties = {
  position: 'relative',
  width: 20,
  height: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** The current-section marker: a volt line along the item's top edge. */
function Indicator({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        top: -1,
        left: '22%',
        right: '22%',
        height: 2,
        background: on ? VOLT : 'transparent',
      }}
    />
  );
}

function BarLink({
  href,
  label,
  current,
  icon,
  live = false,
}: {
  href: string;
  label: string;
  current: boolean;
  icon: React.ReactNode;
  live?: boolean;
}) {
  return (
    <Link href={href} aria-current={current ? 'page' : undefined} style={itemStyle(current)}>
      <Indicator on={current} />
      <span style={iconBoxStyle}>{icon}</span>
      <span style={{ ...labelStyle(current), color: current ? '#F4F1EA' : live ? VOLT : '#6E6A62' }}>{label}</span>
    </Link>
  );
}

/** The ХОРОМ mark, as a 3x3 of dots. */
function HomeGlyph() {
  return (
    <span aria-hidden style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 4px)', gap: 2 }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} style={{ width: 4, height: 4, background: 'currentColor' }} />
      ))}
    </span>
  );
}

function ListGlyph() {
  return (
    <span aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {[16, 16, 11].map((w, i) => (
        <span key={i} style={{ width: w, height: 2, background: 'currentColor' }} />
      ))}
    </span>
  );
}

/** A stopwatch ring. With a round open for this athlete it carries the
 *  pulsing volt dot the header's live tab uses. */
function AttemptGlyph({ live }: { live: boolean }) {
  return (
    <span aria-hidden style={{ position: 'relative', width: 16, height: 16 }}>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: '1.6px solid currentColor',
        }}
      />
      <span style={{ position: 'absolute', left: 7, top: 3, width: 1.6, height: 6, background: 'currentColor' }} />
      {live && (
        <span className="oc-v3-dot" style={{ position: 'absolute', top: -3, right: -5 }} />
      )}
    </span>
  );
}
