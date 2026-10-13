'use client';

import { useEffect } from 'react';
import { BADGE_STYLES } from '@/lib/record-badges';
import type { CelebrationText } from '@/lib/record-celebration';
import { useLang } from '@/lib/i18n';

// Accent per record level (matches the badge colours used everywhere else).
const GLOW: Record<string, string> = { TR: '#a78bfa', NR: '#4ade80', CR: '#60a5fa', WR: '#f59e0b' };
const CONFETTI = ['#a78bfa', '#ec4899', '#fbbf24', '#4ade80', '#60a5fa', '#f472b6'];

/**
 * The record-break card shown over the Results Entry panel right after a
 * result that sets a club record (or better) is saved — admin and judge
 * alike. Purely presentational: the text arrives ready-made from
 * lib/record-celebration.ts. Dismissed with the button, a tap outside, or
 * Escape. The confetti is a handful of CSS-animated flecks, and is switched
 * off for visitors who ask for reduced motion.
 */
export default function RecordCelebration({ text, onClose }: { text: CelebrationText; onClose: () => void }) {
  const { t } = useLang();
  const level = text.items.reduce((top, i) => (['TR', 'NR', 'CR', 'WR'].indexOf(i.level) > ['TR', 'NR', 'CR', 'WR'].indexOf(top) ? i.level : top), 'TR' as string);
  const glow = GLOW[level] ?? GLOW.TR;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="rc-scrim" onClick={onClose}>
      <div className="rc-confetti" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} style={{
            left: `${(i * 53 + 7) % 100}%`,
            background: CONFETTI[i % CONFETTI.length],
            animationDelay: `${(i % 6) * 0.18}s`,
            animationDuration: `${2.4 + (i % 5) * 0.35}s`,
            width: i % 3 === 0 ? 6 : 8, height: i % 3 === 0 ? 12 : 8,
            borderRadius: i % 3 === 1 ? '50%' : 2,
          }} />
        ))}
      </div>
      <div
        className="rc-card" role="alertdialog" aria-modal="true" aria-label={text.title}
        onClick={e => e.stopPropagation()}
        style={{ borderColor: `${glow}88`, boxShadow: `0 0 0 1px ${glow}33, 0 0 46px ${glow}55, 0 24px 60px rgba(0,0,0,0.6)` }}
      >
        <div className="rc-trophy">🏆</div>
        <div className="rc-title" style={{ color: glow }}>{text.title}</div>
        {text.items.map((item, i) => (
          <div key={i} className="rc-item">
            <div className="rc-headline">
              {item.headline}
              <span className="rc-badge" style={BADGE_STYLES[item.level]}>{item.level}</span>
            </div>
            {item.previous && <div className="rc-line">{item.previous}</div>}
            <div className="rc-line rc-gap">{item.gap}</div>
          </div>
        ))}
        <button className="rc-close" onClick={onClose} autoFocus>{t('celebrate.dismiss')}</button>
      </div>

      <style>{`
        .rc-scrim {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10050;
          display: flex; align-items: center; justify-content: center; padding: 16px;
          background: rgba(4,4,12,0.78); overflow: hidden;
          animation: rcFade 0.2s ease;
        }
        .rc-card {
          position: relative; width: 100%; max-width: 380px; max-height: 100%; overflow-y: auto;
          padding: 22px 18px 16px; border-radius: 18px; border: 1px solid;
          background: var(--card); color: var(--text); text-align: center;
          animation: rcPop 0.35s cubic-bezier(.2,1.3,.4,1);
        }
        .rc-trophy { font-size: 44px; line-height: 1; margin-bottom: 8px; }
        .rc-title { font-size: 20px; font-weight: 800; line-height: 1.25; margin-bottom: 14px; }
        .rc-item {
          padding: 10px 12px; margin-bottom: 10px; border-radius: 12px; text-align: left;
          background: rgba(128,128,128,0.08); border: 1px solid rgba(128,128,128,0.16);
        }
        .rc-headline { font-size: 15px; font-weight: 700; color: var(--text-primary); line-height: 1.35; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
        .rc-badge { display: inline-block; margin-left: 6px; padding: 1px 5px; border-radius: 4px; font-size: 10px; font-weight: 800; vertical-align: middle; }
        .rc-line { font-size: 13px; color: var(--muted); line-height: 1.45; margin-top: 4px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
        .rc-gap { color: #4ade80; font-weight: 600; }
        .rc-close {
          width: 100%; min-height: 46px; margin-top: 4px; border-radius: 12px; cursor: pointer;
          font-family: inherit; font-size: 15px; font-weight: 700; color: #fff; border: none;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
        }
        .rc-confetti { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
        .rc-confetti span { position: absolute; top: -20px; opacity: 0.9; animation: rcFall linear infinite; }
        @keyframes rcFall { 0% { transform: translateY(-20px) rotate(0deg); } 100% { transform: translateY(105vh) rotate(540deg); } }
        @keyframes rcPop { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes rcFade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .rc-confetti { display: none; }
          .rc-card, .rc-scrim { animation: none; }
        }
      `}</style>
    </div>
  );
}
