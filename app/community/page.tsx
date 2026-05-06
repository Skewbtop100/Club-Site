'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const DISCORD_INVITE_URL = 'https://discord.gg/VxrmRDN3nK';

type FeatureIconName = 'megaphone' | 'lightbulb' | 'trophy' | 'play' | 'headphones' | 'chat';

const FEATURES: {
  title: string;
  desc: string;
  color: string;
  icon: FeatureIconName;
}[] = [
  {
    title: 'Тэмцээний шинэ мэдээ',
    desc: 'Удахгүй болох тэмцээн, бүртгэлийн хугацаа, шагнал — бүгд эхлээд энд зарлагдана.',
    color: '#ef4444',
    icon: 'megaphone',
  },
  {
    title: 'Алгоритм нэгтгэл',
    desc: 'OLL, PLL, F2L, шинэ техник, тоног төхөөрөмжийн зөвлөгөө — ах нараас сурна.',
    color: '#3b82f6',
    icon: 'lightbulb',
  },
  {
    title: 'Амжилт хуваалцах',
    desc: 'Шинэ PR, медаль, тэмцээний дүн — баяраа хуваалцаж бусдыг урамшуулна.',
    color: '#fbbf24',
    icon: 'trophy',
  },
  {
    title: 'Solve видео',
    desc: 'Өөрийн solve-оо хуваалцаж сайжруулалт авна. Бусдын hand-cam-аас санаа аваарай.',
    color: '#ec4899',
    icon: 'play',
  },
  {
    title: 'Хамт practice',
    desc: 'Voice channel дээр чатлан хамт solve хийнэ. Хэн нэгний хажууд практик илүү таатай.',
    color: '#22c55e',
    icon: 'headphones',
  },
  {
    title: 'Чөлөөт яриа',
    desc: 'Cubing-ийн талаар юу ч ярь — meme, ярилцлага, тоног төхөөрөмжийн review. Хязгааргүй.',
    color: '#a78bfa',
    icon: 'chat',
  },
];

function DiscordLogo({ size = 120 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 127.14 96.36"
      width={size}
      height={size * (96.36 / 127.14)}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
      />
    </svg>
  );
}

function CubeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" className="dc-cube" aria-hidden>
      <g transform="rotate(15 11 11)">
        <rect x="2"  y="2"  width="6" height="6" fill="#ef4444" rx="1"/>
        <rect x="8"  y="2"  width="6" height="6" fill="#fff"    rx="1"/>
        <rect x="14" y="2"  width="6" height="6" fill="#3b82f6" rx="1"/>
        <rect x="2"  y="8"  width="6" height="6" fill="#22c55e" rx="1"/>
        <rect x="8"  y="8"  width="6" height="6" fill="#fbbf24" rx="1"/>
        <rect x="14" y="8"  width="6" height="6" fill="#ef4444" rx="1"/>
        <rect x="2"  y="14" width="6" height="6" fill="#fff"    rx="1"/>
        <rect x="8"  y="14" width="6" height="6" fill="#f97316" rx="1"/>
        <rect x="14" y="14" width="6" height="6" fill="#22c55e" rx="1"/>
      </g>
    </svg>
  );
}

function TimerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 20 20"
      fill="none" stroke="#4ade80" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="10" cy="11" r="6" />
      <line x1="10" y1="11" x2="10" y2="7" className="dc-timer-hand" />
      <line x1="8" y1="3" x2="12" y2="3" />
      <line x1="10" y1="3" x2="10" y2="5" />
    </svg>
  );
}

function FeatureIcon({ name, size = 28 }: { name: FeatureIconName; size?: number }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'megaphone':
      return (
        <svg {...props}>
          <path d="M3 11v2a1 1 0 001 1h3l8 5V5l-8 5H4a1 1 0 00-1 1z" />
          <path d="M19 8a4 4 0 010 8" />
        </svg>
      );
    case 'lightbulb':
      return (
        <svg {...props}>
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 00-4 12c.6.5 1 1.3 1 2v2h6v-2c0-.7.4-1.5 1-2a7 7 0 00-4-12z" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...props}>
          <path d="M8 21h8" />
          <path d="M12 17v4" />
          <path d="M7 4h10v6a5 5 0 01-10 0V4z" />
          <path d="M17 4h3a2 2 0 01-2 4" />
          <path d="M7 4H4a2 2 0 002 4" />
        </svg>
      );
    case 'play':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8l6 4-6 4V8z" />
        </svg>
      );
    case 'headphones':
      return (
        <svg {...props}>
          <path d="M3 14v-2a9 9 0 0118 0v2" />
          <path d="M3 14v3a2 2 0 002 2h2v-7H5a2 2 0 00-2 2z" />
          <path d="M21 14v3a2 2 0 01-2 2h-2v-7h2a2 2 0 012 2z" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...props}>
          <path d="M21 12a8 8 0 01-12 7l-5 2 2-5a8 8 0 1115-4z" />
        </svg>
      );
  }
}

export default function CommunityPage() {
  const [stats, setStats] = useState<{ total: number; online: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      try {
        const res = await fetch('/api/discord-stats');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStats({ total: data.total, online: data.online });
      } catch {
        // Keep last known value
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
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="dc-hero">
        {/* Layered background */}
        <div className="dc-bg-orbs" aria-hidden>
          <div className="dc-orb dc-orb-tl" />
          <div className="dc-orb dc-orb-tr" />
          <div className="dc-orb dc-orb-bc" />
        </div>
        <div className="dc-bg-grid" aria-hidden />

        <div className="dc-hero-content">
          <span className="dc-tagline fade-in" style={{ animationDelay: '0ms' }}>
            <span className="dc-tagline-text">Official Community</span>
          </span>

          <div className="dc-logo-halo fade-in" style={{ animationDelay: '60ms' }}>
            <div className="dc-logo-ring">
              <span className="dc-logo-inner">
                <DiscordLogo size={88} />
              </span>
            </div>
          </div>

          <h1 className="dc-title fade-in" style={{ animationDelay: '100ms' }}>
            Mongolian Speedcubers Community
          </h1>
          <p className="dc-subtitle fade-in" style={{ animationDelay: '200ms' }}>
            <span>Куб эргүүлдэг бид нэг дор</span>
            <span className="dc-sub-dot" aria-hidden>•</span>
            <span>Алгоритм хуваалцана</span>
            <span className="dc-sub-dot" aria-hidden>•</span>
            <span>Тэмцээнд бэлдэнэ</span>
            <span className="dc-sub-dot" aria-hidden>•</span>
            <span>Хамт ургана</span>
          </p>

          {stats !== null && (
            <div className="dc-stats fade-in" style={{ animationDelay: '300ms' }}>
              <div className="dc-pill dc-pill-purple">
                <CubeIcon size={22} />
                <span>{stats.total} cuber</span>
              </div>
              <div className="dc-pill dc-pill-green">
                <TimerIcon size={20} />
                <span>{stats.online} solving</span>
              </div>
            </div>
          )}

          <button
            type="button"
            className="dc-cta fade-in"
            style={{ animationDelay: '400ms' }}
            onClick={openDiscord}
          >
            <span className="dc-cta-label">
              <span className="dc-cta-icon" style={{ color: '#fff' }}>
                <DiscordLogo size={22} />
              </span>
              Discord-руу нэгдэх
            </span>
          </button>

          <div className="dc-or fade-in" style={{ animationDelay: '500ms' }}>
            <span>Эсвэл QR кодыг скан хийх</span>
          </div>

          <div className="dc-qr-wrap fade-in" style={{ animationDelay: '500ms' }}>
            <div className="dc-qr">
              <QRCodeSVG
                value={DISCORD_INVITE_URL}
                size={180}
                bgColor="#ffffff"
                fgColor="#1a1a2e"
                level="M"
              />
            </div>
          </div>
        </div>

        <a href="#features" className="dc-scroll-hint" aria-label="Доош">
          <span>Дэлгэрэнгүй</span>
          <span aria-hidden>↓</span>
        </a>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="dc-features-section" id="features">
        <h2 className="dc-features-title">Энд юу хийх вэ?</h2>
        <p className="dc-features-subtitle">Бүгд Discord дээр</p>
        <div className="dc-features-grid">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="dc-feature fade-in"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div
                className="dc-feature-icon"
                style={{
                  background: `${f.color}1A`,
                  borderColor: `${f.color}33`,
                  color: f.color,
                }}
              >
                <FeatureIcon name={f.icon} size={28} />
              </div>
              <div className="dc-feature-name" style={{ color: f.color }}>
                {f.title}
              </div>
              <div className="dc-feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer help ──────────────────────────────────────── */}
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
          background: #0a0a14;
          color: #fff;
          overflow-x: hidden;
        }

        /* ── Hero ─────────────────────────────────────────────── */
        .dc-hero {
          position: relative;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4rem 1.25rem 6rem;
          background: linear-gradient(180deg, #0a0a14 0%, #1a1a2e 100%);
          overflow: hidden;
        }

        .dc-bg-orbs {
          position: absolute; inset: 0;
          z-index: 0;
          pointer-events: none;
        }
        .dc-orb {
          position: absolute;
          border-radius: 50%;
        }
        .dc-orb-tl {
          top: -200px; left: -200px;
          width: 600px; height: 600px;
          background: radial-gradient(circle, rgba(88,101,242,0.18) 0%, transparent 70%);
        }
        .dc-orb-tr {
          top: -150px; right: -150px;
          width: 500px; height: 500px;
          background: radial-gradient(circle, rgba(235,69,158,0.14) 0%, transparent 70%);
        }
        .dc-orb-bc {
          bottom: -300px; left: 50%; transform: translateX(-50%);
          width: 800px; height: 800px;
          background: radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%);
        }
        .dc-bg-grid {
          position: absolute; inset: 0;
          z-index: 0;
          pointer-events: none;
          background-image:
            linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px);
          background-size: 60px 60px;
          mask-image: radial-gradient(ellipse at center, #000 35%, transparent 85%);
          -webkit-mask-image: radial-gradient(ellipse at center, #000 35%, transparent 85%);
        }

        .dc-hero-content {
          position: relative;
          z-index: 1;
          max-width: 720px;
          width: 100%;
          margin: 0 auto;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        /* Tagline pill */
        .dc-tagline {
          display: inline-block;
          padding: 6px 16px;
          border-radius: 999px;
          border: 1px solid transparent;
          background:
            linear-gradient(#0e0e1c, #0e0e1c) padding-box,
            linear-gradient(135deg, #7c3aed 0%, #ec4899 100%) border-box;
          margin-bottom: 1.6rem;
        }
        .dc-tagline-text {
          font-size: 0.7rem;
          font-weight: 800;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          background: linear-gradient(135deg, #c4b5fd 0%, #f0abfc 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        /* Logo + halo + gradient ring */
        .dc-logo-halo {
          position: relative;
          display: inline-flex;
          margin-bottom: 1.6rem;
        }
        .dc-logo-halo::before {
          content: '';
          position: absolute;
          inset: -50px;
          z-index: -1;
          background: radial-gradient(circle, rgba(88,101,242,0.45) 0%, transparent 65%);
          border-radius: 50%;
          animation: dcHalo 4s ease-in-out infinite;
        }
        @keyframes dcHalo {
          0%, 100% { transform: scale(1);    opacity: 0.9; }
          50%      { transform: scale(1.08); opacity: 1; }
        }
        .dc-logo-ring {
          padding: 28px;
          border-radius: 50%;
          border: 2px solid transparent;
          background:
            linear-gradient(#11111e, #11111e) padding-box,
            linear-gradient(135deg, #5865F2 0%, #7c3aed 50%, #ec4899 100%) border-box;
          box-shadow: 0 8px 40px rgba(88,101,242,0.25);
        }
        .dc-logo-inner {
          color: #5865F2;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        /* Typography */
        .dc-title {
          font-size: clamp(2rem, 6vw, 3.5rem);
          font-weight: 800;
          line-height: 1.08;
          letter-spacing: -0.02em;
          margin-bottom: 0.85rem;
          background: linear-gradient(135deg, #ffffff 0%, #c4b5fd 50%, #f0abfc 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .dc-subtitle {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 0.65rem;
          font-size: 1.1rem;
          line-height: 1.5;
          color: rgba(255,255,255,0.7);
          letter-spacing: 0.02em;
          margin-bottom: 1.85rem;
          max-width: 760px;
        }
        .dc-sub-dot {
          color: #a78bfa;
          font-size: 0.7rem;
          opacity: 0.8;
          line-height: 1;
        }

        /* Stats pills (glass) */
        .dc-stats {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          justify-content: center;
          margin-bottom: 2rem;
        }
        .dc-pill {
          display: inline-flex; align-items: center;
          gap: 0.6rem;
          padding: 0.6rem 1.4rem;
          border-radius: 999px;
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 0.95rem;
          font-weight: 600;
        }
        .dc-pill-purple {
          color: #c4b5fd;
          perspective: 600px;
        }
        .dc-pill-green {
          color: #4ade80;
        }
        .dc-cube {
          transition: transform 0.18s ease;
          transform-style: preserve-3d;
        }
        .dc-pill-purple:hover .dc-cube {
          animation: dcCubeFlip 1.2s ease-in-out;
        }
        @keyframes dcCubeFlip {
          to { transform: rotateY(360deg); }
        }
        .dc-timer-hand {
          transform-origin: 10px 11px;
          animation: dcSpin 4s linear infinite;
        }
        @keyframes dcSpin {
          to { transform: rotate(360deg); }
        }

        /* CTA */
        .dc-cta {
          position: relative;
          overflow: hidden;
          padding: 1.1rem 2.5rem;
          border: none;
          border-radius: 14px;
          color: #fff;
          font-family: inherit;
          font-size: 1.1rem;
          font-weight: 700;
          letter-spacing: 0.005em;
          cursor: pointer;
          background:
            linear-gradient(135deg, #5865F2 0%, #7c3aed 50%, #ec4899 100%);
          background-size: 200% 200%;
          background-position: 0% 0%;
          box-shadow:
            0 8px 32px rgba(88,101,242,0.4),
            0 1px 0 rgba(255,255,255,0.18) inset;
          transition: transform 0.18s ease, box-shadow 0.18s ease, background-position 0.5s ease;
        }
        .dc-cta:hover {
          transform: scale(1.04);
          background-position: 100% 50%;
          box-shadow:
            0 12px 40px rgba(88,101,242,0.55),
            0 1px 0 rgba(255,255,255,0.22) inset;
        }
        .dc-cta:active { transform: scale(1.0); }
        .dc-cta-label {
          position: relative;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          gap: 0.65rem;
        }
        .dc-cta-icon {
          display: inline-flex;
          align-items: center;
        }
        .dc-cta::after {
          content: '';
          position: absolute;
          top: 0; left: -100%;
          width: 60%; height: 100%;
          background: linear-gradient(
            100deg,
            transparent 0%,
            rgba(255,255,255,0.25) 50%,
            transparent 100%
          );
          transform: skewX(-20deg);
          transition: left 0.7s ease;
          pointer-events: none;
        }
        .dc-cta:hover::after { left: 150%; }

        /* QR */
        .dc-or {
          margin-top: 2rem;
          margin-bottom: 1rem;
          display: flex; align-items: center; justify-content: center;
          gap: 0.85rem;
          font-size: 0.75rem;
          font-weight: 700;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }
        .dc-or::before, .dc-or::after {
          content: '';
          flex: 0 0 50px;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.18), transparent);
        }
        .dc-qr-wrap { display: flex; justify-content: center; }
        .dc-qr {
          padding: 16px;
          background: #fff;
          border-radius: 14px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          line-height: 0;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .dc-qr:hover {
          transform: scale(1.03);
          box-shadow: 0 8px 26px rgba(0,0,0,0.55);
        }

        /* Scroll hint */
        .dc-scroll-hint {
          position: absolute;
          bottom: 1.6rem;
          left: 50%;
          transform: translateX(-50%);
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          color: rgba(255,255,255,0.45);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          text-decoration: none;
          animation: dcBounce 2.4s ease-in-out infinite;
        }
        .dc-scroll-hint:hover { color: rgba(255,255,255,0.85); }
        @keyframes dcBounce {
          0%, 100% { transform: translate(-50%, 0); }
          50%      { transform: translate(-50%, -8px); }
        }

        /* ── Features ─────────────────────────────────────────── */
        .dc-features-section {
          max-width: 1080px;
          margin: 0 auto;
          padding: 6rem 1.25rem;
          text-align: center;
        }
        .dc-features-title {
          font-size: clamp(1.5rem, 4vw, 1.8rem);
          font-weight: 800;
          margin-bottom: 0.45rem;
          background: linear-gradient(135deg, #ffffff 0%, #c4b5fd 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .dc-features-subtitle {
          color: rgba(255,255,255,0.5);
          font-size: 0.95rem;
          margin-bottom: 2.4rem;
        }
        .dc-features-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          text-align: left;
        }
        .dc-feature {
          background: rgba(255,255,255,0.02);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 16px;
          padding: 1.5rem;
          transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }
        .dc-feature:hover {
          transform: translateY(-4px);
          border-color: rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.035);
          box-shadow: 0 10px 30px rgba(124,58,237,0.18);
        }
        .dc-feature-icon {
          width: 56px; height: 56px;
          border-radius: 14px;
          border: 1px solid;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          margin-bottom: 1rem;
        }
        .dc-feature-name {
          font-size: 1rem;
          font-weight: 700;
          color: #fff;
          margin-bottom: 0.3rem;
        }
        .dc-feature-desc {
          font-size: 0.85rem;
          color: rgba(255,255,255,0.55);
          line-height: 1.5;
        }

        /* Footer */
        .dc-footer {
          max-width: 1080px;
          margin: 0 auto;
          padding: 0 1.25rem 4rem;
          text-align: center;
          font-size: 0.85rem;
        }
        .dc-footer-label {
          color: rgba(255,255,255,0.4);
          margin-right: 0.4rem;
        }
        .dc-footer-link {
          color: #c4c8ff;
          font-weight: 700;
          text-decoration: none;
        }
        .dc-footer-link:hover { color: #fff; text-decoration: underline; }

        /* ── Animations ───────────────────────────────────────── */
        .fade-in {
          opacity: 0;
          transform: translateY(20px);
          animation: dcFadeUp 0.6s ease-out forwards;
        }
        @keyframes dcFadeUp {
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Mobile ───────────────────────────────────────────── */
        @media (max-width: 900px) {
          .dc-features-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 768px) {
          .dc-subtitle {
            flex-direction: column;
            gap: 4px;
            font-size: 0.95rem;
          }
          .dc-sub-dot { display: none; }
          .dc-hero { min-height: 90dvh; padding: 3rem 1rem 4.5rem; }
          .dc-orb-tl, .dc-orb-tr {
            width: 380px; height: 380px;
          }
          .dc-orb-bc { width: 520px; height: 520px; }
          .dc-logo-halo::before { inset: -32px; }
          .dc-logo-ring { padding: 22px; }
          .dc-cta {
            width: calc(100% - 1rem);
            padding-left: 1rem; padding-right: 1rem;
          }
          .dc-or, .dc-qr-wrap { display: none; }
          .dc-features-grid { grid-template-columns: 1fr; }
          .dc-features-section { padding: 4.5rem 1rem; }
          .dc-scroll-hint { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .dc-logo-halo::before,
          .dc-timer-hand,
          .dc-cube,
          .dc-pill-purple:hover .dc-cube,
          .dc-scroll-hint,
          .fade-in,
          .dc-cta::after { animation: none; }
          .fade-in { opacity: 1; transform: none; }
        }
      `}</style>
    </main>
  );
}
