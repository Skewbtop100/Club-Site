'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const DISCORD_INVITE_URL = 'https://discord.gg/VxrmRDN3nK';

// Discord widget JSON exposes only `presence_count` (online users) — total
// member count isn't on the public widget endpoint and would require a
// bot token. We deliberately show the online count only.
const SERVER_ID = '1501190782647013498';

const FEATURES: { emoji: string; title: string; desc: string }[] = [
  { emoji: '📢', title: 'Зар',        desc: 'Тэмцээний шинэ мэдээ' },
  { emoji: '❓', title: 'Асуулт',     desc: 'Алгоритм, тоног төхөөрөмж' },
  { emoji: '🏆', title: 'Амжилт',     desc: 'PR, медаль хуваалцана' },
  { emoji: '🎥', title: 'Видео',      desc: 'Solve видеонууд' },
  { emoji: '🎤', title: 'Voice chat', desc: 'Хамт practice' },
  { emoji: '💬', title: 'Чат',        desc: 'Юу ч ярина' },
];

function DiscordLogo({ size = 88 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 127.14 96.36"
      width={size}
      height={size * (96.36 / 127.14)}
      aria-hidden
      className="dc-logo"
    >
      <path
        fill="currentColor"
        d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
      />
    </svg>
  );
}

export default function CommunityPage() {
  const [stats, setStats] = useState<{ online: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      try {
        const res = await fetch(`https://discord.com/api/guilds/${SERVER_ID}/widget.json`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setStats({ online: data.presence_count ?? 0 });
        }
      } catch {
        // Network or CORS issue — silently keep last known value
      }
    }
    fetchStats();
    const interval = setInterval(fetchStats, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  function openDiscord() {
    window.open(DISCORD_INVITE_URL, '_blank', 'noopener,noreferrer');
  }

  return (
    <main className="dc-page">
      {/* Hero */}
      <section className="dc-hero">
        <div className="dc-logo-wrap">
          <DiscordLogo size={88} />
        </div>

        <h1 className="dc-title">Mongolian Speedcubers Community</h1>
        <p className="dc-subtitle">Шоочдын нэгдэл — Discord дээр</p>

        {stats !== null ? (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.45rem 1.1rem', borderRadius: 999,
            background: 'rgba(34,197,94,0.12)',
            border: '1px solid rgba(34,197,94,0.3)',
            marginBottom: '2rem',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#22c55e',
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            <span style={{ color: '#4ade80', fontWeight: 600, fontSize: '0.9rem' }}>
              {stats.online} онлайн
            </span>
          </div>
        ) : null}

        <button type="button" className="dc-cta" onClick={openDiscord}>
          <span className="dc-cta-label">
            <span aria-hidden>💜</span> Discord-руу нэгдэх
          </span>
        </button>

        <div className="dc-or">Эсвэл QR кодыг скан хийх</div>

        <div className="dc-qr-wrap">
          <div className="dc-qr">
            <QRCodeSVG
              value={DISCORD_INVITE_URL}
              size={200}
              bgColor="#ffffff"
              fgColor="#5865F2"
              level="M"
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="dc-features-section">
        <h2 className="dc-features-title">Энд юу хийх вэ?</h2>
        <div className="dc-features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="dc-feature">
              <div className="dc-feature-emoji" aria-hidden>{f.emoji}</div>
              <div className="dc-feature-name">{f.title}</div>
              <div className="dc-feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer help */}
      <section className="dc-footer">
        <span className="dc-footer-label">
          Хэрэв Discord ашиглаж байгаагүй бол:
        </span>
        <a
          href="https://support.discord.com/hc/en-us/articles/360045138571-Beginner-s-Guide-to-Discord"
          target="_blank"
          rel="noopener noreferrer"
          className="dc-footer-link"
        >
          Discord гэж юу вэ? →
        </a>
      </section>

      <style>{`
        .dc-page {
          min-height: calc(100vh - 60px);
          background: linear-gradient(180deg, #1e1f26 0%, #2a2b32 100%);
          color: #fff;
          padding: 3.5rem 1.25rem 5rem;
        }

        /* ── Hero ─────────────────────────────────────────────── */
        .dc-hero {
          max-width: 720px;
          margin: 0 auto;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          animation: dcFadeUp 0.55s ease-out;
        }
        .dc-logo-wrap {
          color: #5865F2;
          margin-bottom: 1.5rem;
          filter: drop-shadow(0 8px 32px rgba(88,101,242,0.45));
        }
        .dc-logo { animation: dcBob 3.2s ease-in-out infinite; }

        .dc-title {
          font-size: clamp(1.75rem, 5vw, 2.65rem);
          font-weight: 900;
          line-height: 1.15;
          letter-spacing: -0.01em;
          margin-bottom: 0.6rem;
          background: linear-gradient(135deg, #fff 0%, #c4c8ff 60%, #5865F2 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .dc-subtitle {
          font-size: clamp(0.95rem, 2.5vw, 1.05rem);
          color: rgba(255,255,255,0.72);
          margin-bottom: 1.5rem;
        }

        /* ── CTA button ───────────────────────────────────────── */
        .dc-cta {
          position: relative;
          overflow: hidden;
          padding: 1rem 2.4rem;
          border: none;
          border-radius: 14px;
          background: linear-gradient(135deg, #7c3aed 0%, #5865F2 100%);
          color: #fff;
          font-family: inherit;
          font-size: 1.05rem;
          font-weight: 800;
          letter-spacing: 0.005em;
          cursor: pointer;
          box-shadow:
            0 8px 24px rgba(88,101,242,0.4),
            0 1px 0 rgba(255,255,255,0.15) inset;
          transition: transform 0.16s ease, box-shadow 0.16s ease;
        }
        .dc-cta:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow:
            0 14px 32px rgba(88,101,242,0.55),
            0 1px 0 rgba(255,255,255,0.18) inset;
        }
        .dc-cta:active { transform: translateY(-1px) scale(1.0); }
        .dc-cta-label {
          position: relative;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          gap: 0.55rem;
        }
        .dc-cta::after {
          content: '';
          position: absolute;
          top: 0; left: -100%;
          width: 60%; height: 100%;
          background: linear-gradient(
            100deg,
            transparent 0%,
            rgba(255,255,255,0.22) 50%,
            transparent 100%
          );
          transform: skewX(-20deg);
          transition: left 0.65s ease;
          pointer-events: none;
        }
        .dc-cta:hover::after { left: 150%; }

        /* ── QR code ──────────────────────────────────────────── */
        .dc-or {
          margin-top: 2rem; margin-bottom: 0.85rem;
          font-size: 0.78rem; font-weight: 600;
          color: rgba(255,255,255,0.45);
          letter-spacing: 0.04em;
          text-transform: uppercase;
          position: relative;
        }
        .dc-or::before, .dc-or::after {
          content: '';
          display: inline-block;
          width: 32px; height: 1px;
          background: rgba(255,255,255,0.15);
          vertical-align: middle;
          margin: 0 0.65rem;
        }
        .dc-qr-wrap { display: flex; justify-content: center; }
        .dc-qr {
          padding: 14px;
          background: #fff;
          border-radius: 14px;
          box-shadow: 0 10px 30px rgba(88,101,242,0.18);
          line-height: 0;
        }

        /* ── Features ─────────────────────────────────────────── */
        .dc-features-section {
          max-width: 960px;
          margin: 4.5rem auto 0;
        }
        .dc-features-title {
          font-size: clamp(1.25rem, 3.5vw, 1.55rem);
          font-weight: 800;
          color: #fff;
          margin-bottom: 1.25rem;
          text-align: center;
        }
        .dc-features-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.85rem;
        }
        .dc-feature {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(88,101,242,0.18);
          border-radius: 14px;
          padding: 1.25rem 1.1rem;
          transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
        }
        .dc-feature:hover {
          transform: translateY(-2px);
          border-color: rgba(88,101,242,0.45);
          background: rgba(255,255,255,0.05);
        }
        .dc-feature-emoji {
          font-size: 1.85rem;
          line-height: 1;
          margin-bottom: 0.55rem;
        }
        .dc-feature-name {
          font-size: 0.95rem;
          font-weight: 800;
          color: #fff;
          margin-bottom: 0.22rem;
        }
        .dc-feature-desc {
          font-size: 0.82rem;
          color: rgba(255,255,255,0.62);
          line-height: 1.45;
        }

        /* ── Footer help ──────────────────────────────────────── */
        .dc-footer {
          max-width: 960px;
          margin: 3rem auto 0;
          text-align: center;
          font-size: 0.85rem;
        }
        .dc-footer-label {
          color: rgba(255,255,255,0.5);
          margin-right: 0.4rem;
        }
        .dc-footer-link {
          color: #c4c8ff;
          font-weight: 700;
          text-decoration: none;
        }
        .dc-footer-link:hover { color: #fff; text-decoration: underline; }

        /* ── Animations ───────────────────────────────────────── */
        @keyframes dcFadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes dcBob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.5; }
        }

        /* ── Responsive ───────────────────────────────────────── */
        @media (max-width: 900px) {
          .dc-features-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 600px) {
          .dc-page { padding: 2.5rem 1rem 3.5rem; }
          .dc-cta {
            width: calc(100% - 24px);
            padding-left: 1rem; padding-right: 1rem;
          }
          .dc-or, .dc-qr-wrap { display: none; }
          .dc-features-grid { grid-template-columns: 1fr; }
          .dc-features-section { margin-top: 3rem; }
        }
        @media (prefers-reduced-motion: reduce) {
          .dc-logo, .dc-hero, .dc-cta::after { animation: none; transition: none; }
        }
      `}</style>
    </main>
  );
}
