'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';

// Shared pieces of the live view. Every value is lifted from the Khorom v2
// mockup's live screen; nothing here is a new colour or size.

export const MONO = 'var(--oc-font-mono), monospace';
export const HEAD = 'var(--oc-font-heading), sans-serif';

/** The one link into the solve flow on this screen. The flow itself
 *  decides which attempt comes next (planResume), so the link carries
 *  nothing but the event. */
export function solveHref(competitionId: string, eventId: string): string {
  return `/online-competition/${competitionId}/solve/${eventId}`;
}

/** "12.47", "1:02.34", "DNF", or "—" for nothing. */
export function fmtResult(v: number | 'DNF' | null): string {
  if (v === null) return '—';
  return v === 'DNF' ? 'DNF' : fmtCentiseconds(v);
}

export const panelStyle: CSSProperties = { border: '1px solid #1C1C21', background: '#0D0D10' };

export const panelLabelStyle: CSSProperties = {
  font: `500 9px/1 ${MONO}`,
  letterSpacing: '.18em',
  color: '#6E6A62',
};

export const bodyTextStyle: CSSProperties = { font: `400 11px/1.5 ${HEAD}`, color: '#9A958A' };

export function EventGlyph({ eventId, size, color }: { eventId: string; size: number; color: string }) {
  return (
    <span aria-hidden style={{ color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      {hasWcaEventIcon(eventId) ? (
        <WcaEventIcon eventId={eventId} size={size} />
      ) : (
        <span style={{ font: `600 ${Math.round(size * 0.5)}px/1 ${MONO}` }}>{eventId.slice(0, 4).toUpperCase()}</span>
      )}
    </span>
  );
}

/** The volt start button. `compact` is the schedule row's size. */
export function StartButton({ href, label, compact = false }: { href: string; label: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        width: '100%',
        background: '#DFFF4F',
        color: '#08080A',
        padding: compact ? '14px 12px' : '16px 18px',
        font: `700 ${compact ? 12 : 13}px/1 ${HEAD}`,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        textAlign: 'center',
        textDecoration: 'none',
      }}
    >
      {label}
    </Link>
  );
}

/** The outlined start button, for a round the athlete qualified into. */
export function QualifiedStartButton({ href, note }: { href: string; note: string }) {
  return (
    <Link
      href={href}
      style={{
        width: '100%',
        border: '1px solid #DFFF4F',
        color: '#DFFF4F',
        padding: '11px 12px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        textDecoration: 'none',
      }}
    >
      <span style={{ font: `700 11px/1 ${HEAD}`, letterSpacing: '.06em', textTransform: 'uppercase' }}>
        Эвлүүлэлтээ эхлэх
      </span>
      <span style={{ font: `500 8px/1 ${MONO}`, letterSpacing: '.1em', opacity: 0.75 }}>{note}</span>
    </Link>
  );
}

const outlineStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  border: '1px solid #F4F1EA',
  background: 'transparent',
  color: '#F4F1EA',
  padding: 12,
  cursor: 'pointer',
  font: `600 12px/1 ${HEAD}`,
  textAlign: 'center',
  textDecoration: 'none',
};

export function OutlineButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={outlineStyle}>
      {label}
    </button>
  );
}

export function OutlineLink({ label, href }: { label: string; href: string }) {
  return (
    <Link href={href} style={outlineStyle}>
      {label}
    </Link>
  );
}

/** Green tick + label. */
export function DoneBox({ label }: { label: string }) {
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        border: '1px solid #1C1C21',
        background: '#0A0A0C',
        padding: '13px 12px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 15,
          height: 15,
          flex: 'none',
          borderRadius: '50%',
          border: '1.5px solid #4FD07A',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          font: `700 9px/1 ${MONO}`,
          color: '#4FD07A',
        }}
      >
        ✓
      </span>
      <span style={{ font: `500 9px/1.3 ${MONO}`, letterSpacing: '.14em', color: '#4FD07A' }}>{label}</span>
    </div>
  );
}

/** Dashed: something stands between the athlete and this round. */
export function DashedBox({ label, note, center = false }: { label: string; note?: string | null; center?: boolean }) {
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: center ? 'center' : 'stretch',
        textAlign: center ? 'center' : 'left',
        gap: center ? 5 : 6,
        border: '1px dashed #2A2A31',
        background: '#0A0A0C',
        padding: center ? '11px 12px' : '12px 16px',
      }}
    >
      <span style={{ font: `500 9px/1.3 ${MONO}`, letterSpacing: center ? '.12em' : '.14em', color: '#9A958A' }}>
        {label}
      </span>
      {note && (
        <span style={{ font: `400 ${center ? 8 : 9}px/1.5 ${MONO}`, letterSpacing: '.1em', color: '#6E6A62' }}>{note}</span>
      )}
    </div>
  );
}

/** Solid: not open yet, with an amber value when there is one to show. */
export function LockedBox({
  label,
  value,
  extra,
  center = false,
}: {
  label: string;
  value?: string | null;
  extra?: string | null;
  center?: boolean;
}) {
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: center ? 'center' : 'space-between',
        gap: 12,
        border: '1px solid #2A2A31',
        background: '#0A0A0C',
        padding: center ? '11px 12px' : '12px 16px',
      }}
    >
      <span style={{ font: `500 9px/1 ${MONO}`, letterSpacing: center ? '.14em' : '.16em', color: '#6E6A62', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {extra && (
        <span style={{ font: `500 9px/1 ${MONO}`, letterSpacing: '.14em', color: '#4FD07A', whiteSpace: 'nowrap' }}>{extra}</span>
      )}
      {value && (
        <span
          style={{
            font: `700 ${center ? 22 : 24}px/1 ${MONO}`,
            color: '#E0A020',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-.02em',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
      )}
    </div>
  );
}
