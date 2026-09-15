'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatNotifMeta,
  markAllRead,
  markRead,
  subscribeToNotifications,
} from '@/lib/online-competition/notifications';
import type { OnlineNotification } from '@/lib/online-competition/types';

// ── Nav bell + notification popup (hub v3 header) ─────────────────────────
// Everything here is inline-styled on purpose. The club site ships an
// unlayered `* { margin: 0; padding: 0 }` reset that outranks Tailwind's
// spacing utilities, so class-based padding/margin silently does nothing
// inside this tree — the surrounding v3 header solves the same problem
// with hand-written CSS in theme.css. Inline styles keep this component
// self-contained and immune to both.
//
// Open state is CONTROLLED by HubNav so the bell and the user menu can be
// mutually exclusive; the outside-click and Escape listeners live here,
// scoped to this component's own wrapper.
//
// The notifications themselves come from useNotifications, called ONCE in
// HubNav and handed to both the bell (desktop) and the bottom bar's
// МЭДЭГДЭЛ sheet (mobile) — one subscription, one unread count.

const VOLT = '#DFFF4F';
const MONO = "'JetBrains Mono', monospace";

/** One live subscription per signed-in athlete, kept open whether or not a
 *  list is showing — the unread badge has to be right before anyone opens
 *  it. */
export function useNotifications(uid: string | null): OnlineNotification[] {
  const [items, setItems] = useState<OnlineNotification[]>([]);
  useEffect(() => {
    if (!uid) {
      setItems([]);
      return;
    }
    return subscribeToNotifications(uid, setItems);
  }, [uid]);
  return items;
}

export function unreadCountOf(items: OnlineNotification[]): number {
  return items.filter((n) => !n.read).length;
}

export default function NotificationBell({
  uid,
  items,
  open,
  onToggle,
  onClose,
}: {
  uid: string;
  items: OnlineNotification[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [bellHover, setBellHover] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const unreadCount = useMemo(() => unreadCountOf(items), [items]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        title="Мэдэгдэл"
        aria-label="Мэдэгдэл"
        onClick={onToggle}
        onMouseEnter={() => setBellHover(true)}
        onMouseLeave={() => setBellHover(false)}
        style={{
          position: 'relative',
          width: 36,
          height: 36,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${open || bellHover ? VOLT : '#1C1C21'}`,
          background: open ? '#16161B' : 'transparent',
          color: open ? VOLT : bellHover ? '#F4F1EA' : '#9A958A',
        }}
      >
        <BellGlyph />

        {unreadCount > 0 && <UnreadBadge count={unreadCount} />}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 9px)',
            right: 0,
            zIndex: 40,
            // Never wider than the viewport on a phone, where this popup is
            // right-anchored to a header only 14px from the screen edge.
            width: 'min(320px, calc(100vw - 24px))',
            border: '1px solid #2A2A31',
            background: '#0D0D10',
            boxShadow: '0 18px 40px -14px rgba(0,0,0,.9)',
            maxHeight: 420,
            overflowY: 'auto',
          }}
        >
          <NotificationList uid={uid} items={items} onNavigate={onClose} />
        </div>
      )}
    </div>
  );
}

/** Bell glyph: dome, clapper bar, tongue — all currentColor, so the whole
 *  icon follows its button's state. Positioned against the nearest
 *  relatively positioned parent. */
export function BellGlyph() {
  return (
    <>
      <span
        aria-hidden
        style={{
          display: 'block',
          width: 14,
          height: 12,
          border: '1.6px solid currentColor',
          borderBottom: 'none',
          borderRadius: '7px 7px 0 0',
        }}
      />
      <span
        aria-hidden
        style={{ position: 'absolute', bottom: 9, width: 18, height: 1.6, background: 'currentColor' }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          bottom: 6,
          width: 5,
          height: 2.6,
          borderRadius: '0 0 3px 3px',
          background: 'currentColor',
        }}
      />
    </>
  );
}

export function UnreadBadge({ count, style }: { count: number; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        position: 'absolute',
        top: -5,
        right: -5,
        minWidth: 16,
        height: 16,
        padding: '0 4px',
        background: VOLT,
        color: '#08080A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: `700 9px/1 ${MONO}`,
        ...style,
      }}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

/** The list itself: the header with БҮГДИЙГ УНШСАН, then one row per
 *  notification. Rendered inside the bell's popup and the bottom bar's
 *  sheet, so the two cannot drift apart. */
export function NotificationList({
  uid,
  items,
  onNavigate,
}: {
  uid: string;
  items: OnlineNotification[];
  /** Called when a row is opened, before navigating — closes the container. */
  onNavigate: () => void;
}) {
  const router = useRouter();
  const [markHover, setMarkHover] = useState(false);
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const unreadCount = useMemo(() => unreadCountOf(items), [items]);

  function openRow(n: OnlineNotification) {
    if (!n.read && n.id) {
      markRead(n.id).catch((err) =>
        console.warn('[online-competition] mark notification read failed', err),
      );
    }
    onNavigate();
    if (n.href) router.push(n.href);
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '13px 14px',
          borderBottom: '1px solid #1C1C21',
        }}
      >
        <span
          style={{
            font: `500 9px/1 ${MONO}`,
            letterSpacing: '.18em',
            color: '#6E6A62',
          }}
        >
          МЭДЭГДЭЛ
        </span>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() =>
              markAllRead(uid).catch((err) =>
                console.warn('[online-competition] mark all read failed', err),
              )
            }
            onMouseEnter={() => setMarkHover(true)}
            onMouseLeave={() => setMarkHover(false)}
            style={{
              border: 'none',
              background: 'transparent',
              color: markHover ? VOLT : '#9A958A',
              cursor: 'pointer',
              font: `500 9px/1 ${MONO}`,
              letterSpacing: '.1em',
            }}
          >
            БҮГДИЙГ УНШСАН
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p
          style={{
            padding: '44px 16px',
            textAlign: 'center',
            font: '500 13px/1 Geologica, sans-serif',
            color: '#6E6A62',
          }}
        >
          Мэдэгдэл алга.
        </p>
      ) : (
        items.map((n) => (
          <div
            key={n.id}
            onClick={() => openRow(n)}
            onMouseEnter={() => setHoverRow(n.id ?? null)}
            onMouseLeave={() => setHoverRow(null)}
            style={{
              display: 'flex',
              gap: 11,
              padding: '13px 14px',
              borderBottom: '1px solid #16161B',
              background: hoverRow === n.id ? '#16161B' : n.read ? 'transparent' : '#111309',
              cursor: n.href ? 'pointer' : 'default',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                marginTop: 5,
                flex: 'none',
                background: n.read ? '#2A2A31' : VOLT,
              }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
              <span style={{ font: '500 12px/1.4 Geologica, sans-serif', color: '#F4F1EA' }}>
                {n.title}
              </span>
              <span style={{ font: `400 9px/1 ${MONO}`, color: '#4A4740' }}>
                {formatNotifMeta(n.contextLabel, n.createdAt)}
              </span>
            </span>
          </div>
        ))
      )}
    </>
  );
}
