'use client';

// Module-level toast event bus + host component.
//
// Why an event bus instead of a React Context? Several call sites that
// need to dispatch toasts (auth-context's onAuthStateChanged callback,
// non-component code paths in lib/points.ts handlers) can't easily
// `useToast()`. A plain `showToast()` import works from anywhere — the
// <ToastHost /> mounted in app/layout.tsx subscribes and renders.

import { useEffect, useState } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  msg: string;
  tone?: ToastTone;
}

interface ToastItem extends ToastInput {
  id: number;
}

// Auto-dismiss timeout. Spec says 3s.
const DISMISS_MS = 3000;

const listeners = new Set<(items: ToastItem[]) => void>();
let queue: ToastItem[] = [];
let nextId = 1;

function emit(): void {
  for (const l of listeners) l(queue);
}

export function showToast(input: ToastInput): void {
  const id = nextId++;
  const item: ToastItem = { id, msg: input.msg, tone: input.tone ?? 'info' };
  queue = [...queue, item];
  emit();
  setTimeout(() => {
    queue = queue.filter(i => i.id !== id);
    emit();
  }, DISMISS_MS);
}

function dismissToast(id: number): void {
  queue = queue.filter(i => i.id !== id);
  emit();
}

const TONE_COLORS: Record<ToastTone, { border: string; bg: string; text: string }> = {
  success: { border: 'rgba(52,211,153,0.45)', bg: 'rgba(20,40,32,0.96)',  text: '#a7f3d0' },
  error:   { border: 'rgba(239,68,68,0.45)',  bg: 'rgba(40,16,16,0.96)',  text: '#fecaca' },
  info:    { border: 'rgba(167,139,250,0.45)', bg: 'rgba(28,22,42,0.96)', text: '#e8e8ed' },
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    listeners.add(setItems);
    setItems(queue);
    return () => { listeners.delete(setItems); };
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 700);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (items.length === 0) return null;

  // Mobile: top-center stack. Desktop: bottom-right stack.
  const containerStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 0.6rem)',
        left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', gap: '0.45rem',
        zIndex: 2000, pointerEvents: 'none',
        width: 'min(calc(100% - 1rem), 380px)',
      }
    : {
        position: 'fixed',
        bottom: '1.1rem', right: '1.1rem',
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
        zIndex: 2000, pointerEvents: 'none',
        maxWidth: 380,
      };

  return (
    <div style={containerStyle} aria-live="polite" role="status">
      {items.map(t => {
        const c = TONE_COLORS[t.tone ?? 'info'];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => dismissToast(t.id)}
            style={{
              pointerEvents: 'auto',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 12,
              color: c.text,
              padding: '0.65rem 0.85rem',
              fontSize: '0.86rem',
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
              backdropFilter: 'blur(6px)',
              animation: 'cmnToastIn 0.18s ease-out',
              minHeight: 0,
            }}
          >
            {t.msg}
          </button>
        );
      })}
      <style>{`
        @keyframes cmnToastIn {
          0%   { opacity: 0; transform: translateY(-6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
