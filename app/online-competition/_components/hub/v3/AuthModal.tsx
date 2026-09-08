'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';

// ── Sign-in modal (hub v3) ────────────────────────────────────────────────
// Purely a surface in front of the EXISTING auth call. It changes what
// happens before signInWithGoogle(), nothing about the call itself: same
// useOnlineAuth() hook, same second Firebase app instance, same
// onAuthStateChanged consumers afterwards. Previously the nav's "Нэвтрэх"
// button fired the Google popup directly.
//
// The mockup's email + "КОД АВАХ" block is deliberately absent: there is
// no OTP backend behind it, and a button that does nothing is worse than
// no button.
//
// Inline styles throughout — the club site ships an unlayered
// `* { margin: 0; padding: 0 }` reset that outranks Tailwind's layered
// spacing utilities, so class-based padding silently does nothing in this
// tree. Only the entry animation needs a real keyframe, which lives in
// theme.css as `khFadeUp`.

const MONO = "'JetBrains Mono', monospace";

/** The 3x3 mark, volt on the diagonals. Same nine-cell grid the nav uses,
 *  at the modal's larger 11px scale. */
const LOGO_CELLS = [
  '#DFFF4F', '#1C1C21', '#DFFF4F',
  '#1C1C21', '#DFFF4F', '#1C1C21',
  '#DFFF4F', '#1C1C21', '#DFFF4F',
] as const;

export default function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signInWithGoogle } = useOnlineAuth();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');

  // Escape closes, and the close button takes focus on open so the modal
  // is immediately dismissable from the keyboard.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open. The PREVIOUS value is restored rather
  // than a hardcoded 'auto' — a page that had deliberately set something
  // else would otherwise be clobbered by closing this modal.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // A fresh open starts clean rather than showing the last attempt's error.
  useEffect(() => {
    if (open) setError('');
  }, [open]);

  if (!open) return null;

  async function handleGoogle() {
    // Guarded the same way every other sign-in call site in this feature
    // is: without it an impatient second click fires signInWithPopup twice
    // on the same auth instance, and the second cancels the first with an
    // uncaught 'auth/cancelled-popup-request'.
    if (signingIn) return;
    setError('');
    setSigningIn(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      // Closing the popup, or superseding it with another, is a cancel —
      // not a failure. Return to the idle modal state silently, exactly as
      // the registration panel and solve page do.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      setError('Нэвтрэхэд алдаа гарлаа, дахин оролдоно уу');
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(6,6,8,.82)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 22px',
        overflowY: 'auto',
        animation: 'khFadeUp .25s ease-out',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Нэвтрэх"
        // Clicks inside the panel must not reach the overlay's close handler.
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 392,
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          border: '1px solid #2A2A31',
          background: '#0A0A0C',
          padding: '34px 30px',
          boxShadow: '0 30px 80px -20px rgba(0,0,0,.95)',
        }}
      >
        <CloseButton ref={closeRef} onClick={onClose} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
          <span
            aria-hidden
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 11px)',
              gridTemplateRows: 'repeat(3, 11px)',
              gap: 3,
            }}
          >
            {LOGO_CELLS.map((color, i) => (
              <span key={i} style={{ background: color }} />
            ))}
          </span>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <p
              style={{
                font: '600 30px/1.1 Geologica, sans-serif',
                letterSpacing: '-.02em',
                color: '#F4F1EA',
              }}
            >
              Хором
            </p>
            <p style={{ font: '400 13px/1.6 Geologica, sans-serif', color: '#9A958A' }}>
              Онлайн эвлүүлэлтийн тэмцээний талбар. Нэвтэрч тэмцээнд бүртгүүлнэ.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <GoogleButton pending={signingIn} onClick={handleGoogle} />

          {/* Same error treatment the registration panel's sign-in gate
              uses, so a failed sign-in reads identically wherever it
              happens. The modal deliberately stays open behind it. */}
          {error && (
            <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#E8543C' }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CloseButton({
  ref,
  onClick,
}: {
  ref: React.Ref<HTMLButtonElement>;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Хаах"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 28,
        height: 28,
        border: `1px solid ${hover ? '#DFFF4F' : '#1C1C21'}`,
        background: 'transparent',
        color: hover ? '#DFFF4F' : '#6E6A62',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: `400 14px/1 ${MONO}`,
      }}
    >
      ×
    </button>
  );
}

function GoogleButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        border: 'none',
        background: hover && !pending ? '#FFFFFF' : '#F4F1EA',
        color: '#08080A',
        padding: 16,
        cursor: pending ? 'default' : 'pointer',
        font: '600 13px/1 Geologica, sans-serif',
        opacity: pending ? 0.6 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#08080A',
          color: '#F4F1EA',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          font: `700 11px/1 ${MONO}`,
          flex: 'none',
        }}
      >
        G
      </span>
      {pending ? 'Нэвтэрч байна...' : 'Gmail-ээр нэвтрэх'}
    </button>
  );
}
