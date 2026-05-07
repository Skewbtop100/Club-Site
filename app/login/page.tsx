'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import ThemeToggle from '@/components/layout/ThemeToggle';
import LangToggle from '@/components/layout/LangToggle';

export default function LoginPage() {
  // Next 16 requires useSearchParams to live inside a Suspense boundary.
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0a0a14' }} />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  // ?redirect=/foo lets other pages bounce here and come back. Sanitised to
  // relative paths only so a crafted ?redirect=https://evil can't open-
  // redirect us off-site.
  const redirectParam = searchParams.get('redirect');
  const safeRedirect =
    redirectParam && redirectParam.startsWith('/') && !redirectParam.startsWith('//')
      ? redirectParam
      : null;

  // Deliberately no auto-redirect for already-signed-in users. A previous
  // version bounced admins to /admin/dashboard on mount, which hijacked
  // navigations that briefly routed through /login (back-button, deep
  // links). The post-success redirect lives in doGoogleSignIn instead.

  async function doGoogleSignIn() {
    setError('');
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (!result) return;
      if (result.role === 'admin') {
        router.replace(safeRedirect || '/admin/dashboard');
      } else {
        router.replace(safeRedirect || '/profile');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Popup-closed-by-user is benign — don't scare the user.
      if (!/popup-closed-by-user|cancelled-popup-request/i.test(msg)) {
        setError('Нэвтрэх амжилтгүй боллоо. Дахин оролдоно уу.');
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="login-shell">
      {/* Background layers — orbs + fine grid. All non-interactive and
          fixed below the card so theme/lang toggles still work. */}
      <div className="login-bg" aria-hidden>
        <div className="login-orb login-orb-purple" />
        <div className="login-orb login-orb-lavender" />
        <div className="login-orb login-orb-mint" />
        <div className="login-grid" />
      </div>

      <header className="login-topbar">
        <div className="login-topbar-controls">
          <ThemeToggle />
          <LangToggle />
        </div>
        <a href="/" className="login-back" aria-label="Буцах">← Буцах</a>
      </header>

      <main className="login-main">
        <div className="login-card">
          <CubeIllustration />

          <span className="login-tagline">АТЛЕТ ХАРИЛЦАА</span>
          <h1 className="login-title">Mongolian Speedcubers</h1>
          <p className="login-subtitle">Сайн уу — нэвтэрнэ үү</p>

          <button
            type="button"
            onClick={doGoogleSignIn}
            disabled={googleLoading}
            className="login-google"
            aria-busy={googleLoading}
          >
            {googleLoading ? <Spinner /> : <GoogleG />}
            <span>{googleLoading ? 'Нэвтэрч байна...' : 'Google-аар нэвтрэх'}</span>
          </button>

          {error && (
            <div className="login-error" role="alert">
              <span aria-hidden>⚠</span>
              <span>{error}</span>
            </div>
          )}

          <p className="login-disclaimer">
            Үргэлжлүүлснээр та манай үйлчилгээний нөхцөлийг зөвшөөрнө
          </p>
        </div>
      </main>

      <style>{`
        .login-shell {
          min-height: 100vh;
          min-height: 100dvh;
          background: linear-gradient(180deg, #0a0a14 0%, #1a1a2e 100%);
          color: #e8e8ed;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .login-bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
        }
        .login-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
        }
        .login-orb-lavender {
          width: 500px; height: 500px;
          top: -120px; left: -120px;
          background: radial-gradient(circle, rgba(167,139,250,0.12), transparent 70%);
        }
        .login-orb-mint {
          width: 400px; height: 400px;
          bottom: -100px; right: -100px;
          background: radial-gradient(circle, rgba(52,211,153,0.10), transparent 70%);
        }
        .login-orb-purple {
          width: 600px; height: 600px;
          top: 50%; left: 50%; transform: translate(-50%, -50%);
          background: radial-gradient(circle, rgba(124,58,237,0.06), transparent 70%);
        }
        .login-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(167,139,250,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(167,139,250,0.04) 1px, transparent 1px);
          background-size: 60px 60px;
          /* Soften the grid toward the edges so it doesn't fight the
             corner orbs for attention. */
          mask-image: radial-gradient(ellipse at 50% 50%, #000 35%, transparent 85%);
          -webkit-mask-image: radial-gradient(ellipse at 50% 50%, #000 35%, transparent 85%);
        }

        .login-topbar {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 1.25rem;
          gap: 0.75rem;
        }
        .login-topbar-controls {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
        .login-back {
          font-size: 0.82rem;
          color: rgba(232,232,237,0.6);
          text-decoration: none;
          padding: 0.4rem 0.7rem;
          border-radius: 8px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        .login-back:hover {
          background: rgba(167,139,250,0.10);
          color: #c4b5fd;
          border-color: rgba(167,139,250,0.3);
        }

        .login-main {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem 1rem 2rem;
        }
        .login-card {
          width: 100%;
          max-width: 420px;
          background: rgba(20,20,30,0.6);
          -webkit-backdrop-filter: blur(20px);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 24px;
          padding: 2.5rem 2rem;
          box-shadow: 0 24px 60px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          align-items: center;
          opacity: 0;
          transform: translateY(16px);
          animation: login-card-in 0.5s ease-out forwards;
        }
        @media (max-width: 600px) {
          .login-card {
            padding: 2rem 1.25rem;
            border-radius: 20px;
          }
        }
        @keyframes login-card-in {
          to { opacity: 1; transform: translateY(0); }
        }

        .login-cube-wrap {
          position: relative;
          width: 110px; height: 110px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 0.5rem;
        }
        @media (max-width: 600px) {
          .login-cube-wrap { width: 70px; height: 70px; }
        }
        .login-cube-glow {
          position: absolute;
          inset: -25%;
          background: radial-gradient(circle, rgba(167,139,250,0.30), transparent 65%);
          pointer-events: none;
          filter: blur(8px);
        }
        .login-cube {
          position: relative;
          width: 100%;
          height: 100%;
          animation: login-cube-float 3s ease-in-out infinite;
          transform-origin: 50% 60%;
        }
        @keyframes login-cube-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50%      { transform: translateY(-6px) rotate(2deg); }
        }

        .login-tagline {
          display: inline-block;
          font-size: 0.6rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          font-weight: 700;
          color: #c4b5fd;
          padding: 0.28rem 0.75rem;
          border: 1px solid rgba(167,139,250,0.3);
          border-radius: 999px;
          background: rgba(167,139,250,0.08);
          -webkit-backdrop-filter: blur(8px);
          backdrop-filter: blur(8px);
          opacity: 0;
          animation: login-fade-in 0.5s ease-out 0.1s forwards;
          margin-bottom: 0.5rem;
        }
        .login-title {
          margin: 0;
          font-size: 2.2rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          background: linear-gradient(135deg, #ffffff 0%, #c4b5fd 60%, #a78bfa 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          text-align: center;
          line-height: 1.1;
          opacity: 0;
          animation: login-fade-in 0.5s ease-out 0.2s forwards;
        }
        @media (max-width: 600px) {
          .login-title { font-size: 1.4rem; }
        }
        .login-subtitle {
          margin: 0.5rem 0 1.6rem;
          font-size: 0.95rem;
          color: rgba(232,232,237,0.6);
          text-align: center;
          opacity: 0;
          animation: login-fade-in 0.5s ease-out 0.25s forwards;
        }
        @keyframes login-fade-in {
          to { opacity: 1; }
        }

        .login-google {
          width: 100%;
          max-width: 320px;
          padding: 0.85rem 1.5rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.7rem;
          background: #ffffff;
          color: #1a1a1a;
          border: none;
          border-radius: 12px;
          font-family: inherit;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 20px rgba(167,139,250,0.15);
          transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
          opacity: 0;
          animation: login-fade-in 0.5s ease-out 0.35s forwards;
        }
        .login-google:hover:not(:disabled) {
          transform: scale(1.02);
          box-shadow: 0 8px 28px rgba(167,139,250,0.28);
        }
        .login-google:active:not(:disabled) {
          transform: scale(1.0);
        }
        .login-google:disabled {
          cursor: not-allowed;
          opacity: 0.7;
        }

        .login-error {
          margin-top: 0.85rem;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          color: #f87171;
          font-size: 0.82rem;
          opacity: 0;
          animation: login-error-in 0.25s ease-out forwards;
        }
        @keyframes login-error-in {
          from { opacity: 0; transform: translateY(-2px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .login-disclaimer {
          margin: 1.6rem 0 0;
          font-size: 0.72rem;
          color: rgba(232,232,237,0.45);
          text-align: center;
          line-height: 1.5;
          max-width: 280px;
        }

        .login-spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid rgba(0,0,0,0.15);
          border-top-color: #1a1a1a;
          border-radius: 50%;
          animation: login-spin 0.7s linear infinite;
        }
        @keyframes login-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ── Cube illustration ─────────────────────────────────────────────────────
// Three visible faces of a Rubik's cube projected isometrically into a
// 100×100 viewBox. Each face is a parallelogram divided into a 3×3
// sticker grid by lerping along its corners. Stroke gives the subtle
// dark separators between stickers; the radial-gradient halo behind the
// SVG (login-cube-glow) lifts it off the card. WCA-ish color choice per
// spec: top white, front (left-half) red, right blue.
function CubeIllustration() {
  const lerp = (
    P: [number, number],
    Q: [number, number],
    t: number,
  ): [number, number] => [P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])];

  function face(
    A: [number, number],
    B: [number, number],
    C: [number, number],
    D: [number, number],
    fill: string,
    key: string,
  ) {
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const top0 = lerp(A, B, j / 3);
        const top1 = lerp(A, B, (j + 1) / 3);
        const bot0 = lerp(D, C, j / 3);
        const bot1 = lerp(D, C, (j + 1) / 3);
        const p0 = lerp(top0, bot0, i / 3);
        const p1 = lerp(top1, bot1, i / 3);
        const p2 = lerp(top1, bot1, (i + 1) / 3);
        const p3 = lerp(top0, bot0, (i + 1) / 3);
        cells.push(
          <polygon
            key={`${key}-${i}-${j}`}
            points={`${p0[0].toFixed(2)},${p0[1].toFixed(2)} ${p1[0].toFixed(2)},${p1[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)} ${p3[0].toFixed(2)},${p3[1].toFixed(2)}`}
            fill={fill}
            stroke="rgba(10,10,18,0.7)"
            strokeWidth={0.6}
            strokeLinejoin="round"
          />,
        );
      }
    }
    return cells;
  }

  return (
    <div className="login-cube-wrap">
      <div className="login-cube-glow" aria-hidden />
      <svg
        className="login-cube"
        viewBox="0 0 100 100"
        role="img"
        aria-label="Speedcubing cube illustration"
      >
        {/* Right face (blue) — A=top-back-right, B=top-front, C=bottom-front, D=bottom-back-right */}
        {face([87, 30], [50, 50], [50, 90], [87, 70], '#3b82f6', 'right')}
        {/* Front-left face (red) */}
        {face([13, 30], [50, 50], [50, 90], [13, 70], '#ef4444', 'left')}
        {/* Top face (white) — A=back, B=right, C=front, D=left */}
        {face([50, 10], [87, 30], [50, 50], [13, 30], '#f5f5f7', 'top')}
      </svg>
    </div>
  );
}

// Official Google "G" mark — 4 colours, untouched from the previous
// design. Sized to inherit the parent font's flow.
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
      <path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>
      <path fill="#EA4335" d="M24 9.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 3.18 29.93 1 24 1 15.4 1 7.96 5.93 4.34 13.12l7.35 5.7C13.42 13.62 18.27 9.75 24 9.75z"/>
    </svg>
  );
}

function Spinner() {
  return <span className="login-spinner" aria-hidden />;
}
