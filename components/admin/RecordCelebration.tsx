'use client';

import { useEffect } from 'react';
import type { CelebrationText, CelebrationItem } from '@/lib/record-celebration';
import { useLang } from '@/lib/i18n';

// Accent per record level (the badge colours used everywhere else).
const LEVEL_COLOR: Record<string, string> = { TR: '#a78bfa', NR: '#4ade80', CR: '#60a5fa', WR: '#f59e0b' };
const LEVEL_ORDER = ['TR', 'NR', 'CR', 'WR'];
const CONFETTI = ['#a78bfa', '#ec4899', '#fbbf24', '#4ade80', '#60a5fa', '#f472b6'];

/**
 * The record-break card shown over the Results Entry panel right after a
 * result that sets a club record (or better) is saved — admin and judge
 * alike. Purely presentational: its content arrives ready-made from
 * lib/record-celebration.ts, which also decides what is known and what is
 * left out, so nothing here renders an empty label.
 *
 * Per broken record: a level chip, then the old record and the new one side
 * by side (stacked on a very narrow phone) with the improvement between
 * them, then the highlight — how long the old record had stood.
 *
 * Dismissed with the button, a tap outside, or Escape. All motion is CSS and
 * is switched off for visitors who ask for reduced motion.
 */
export default function RecordCelebration({ text, onClose }: { text: CelebrationText; onClose: () => void }) {
  const { t } = useLang();
  const top = text.items.reduce((best, i) => (LEVEL_ORDER.indexOf(i.level) > LEVEL_ORDER.indexOf(best) ? i.level : best), 'TR' as string);
  const glow = LEVEL_COLOR[top];

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
        <div className="rc-head">
          <span className="rc-trophy">🏆</span>
          <div className="rc-head-text">
            <div className="rc-title" style={{ color: glow }}>{text.title}</div>
            <div className="rc-event">{text.eventName}</div>
          </div>
        </div>

        <div className="rc-body">
          {text.items.map((item, i) => <Item key={i} item={item} />)}
        </div>

        <button className="rc-close" onClick={onClose} autoFocus>{t('celebrate.dismiss')}</button>
      </div>

      <style>{`
        .rc-scrim {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10050;
          display: flex; align-items: center; justify-content: center; padding: 12px;
          background: rgba(4,4,12,0.8); overflow: hidden; animation: rcFade 0.2s ease;
        }
        /* Head and button stay put; only the records scroll if two of them
           don't fit a short screen — the dismiss button is always reachable. */
        .rc-card {
          position: relative; display: flex; flex-direction: column;
          width: 100%; max-width: 400px; max-height: 100%;
          padding: 14px 12px 12px; border-radius: 18px; border: 1px solid;
          background: var(--card); color: var(--text); text-align: left;
          animation: rcPop 0.35s cubic-bezier(.2,1.3,.4,1);
        }
        .rc-head { display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-bottom: 10px; padding: 0 2px; }
        .rc-trophy { font-size: 32px; line-height: 1; flex-shrink: 0; }
        .rc-head-text { min-width: 0; }
        .rc-title { font-size: 18px; font-weight: 800; line-height: 1.2; overflow-wrap: anywhere; }
        .rc-event { font-size: 13px; font-weight: 600; color: var(--muted); margin-top: 2px; }
        .rc-body { flex: 1; min-height: 0; overflow-y: auto; }

        .rc-item {
          --rc-level: #a78bfa;
          padding: 10px; margin-bottom: 10px; border-radius: 14px;
          background: rgba(128,128,128,0.07); border: 1px solid rgba(128,128,128,0.16);
        }
        .rc-chip {
          display: inline-block; padding: 2px 8px; margin-bottom: 8px; border-radius: 999px;
          font-size: 10.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--rc-level); border: 1px solid var(--rc-level);
          background: color-mix(in srgb, var(--rc-level) 14%, transparent);
        }

        /* Old record | arrow + improvement | new record */
        .rc-compare { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: stretch; gap: 6px; }
        .rc-panel { min-width: 0; padding: 8px; border-radius: 10px; border: 1px solid rgba(128,128,128,0.18); background: rgba(0,0,0,0.18); }
        .rc-panel-new { border-color: var(--rc-level); background: color-mix(in srgb, var(--rc-level) 10%, transparent); }
        .rc-label { font-size: 10px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); }
        .rc-value { font-size: 26px; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; margin: 2px 0 4px; overflow-wrap: anywhere; }
        .rc-panel-prev .rc-value { color: var(--muted); text-decoration: line-through; text-decoration-thickness: 2px; text-decoration-color: rgba(244,63,94,0.75); }
        .rc-panel-new .rc-value { color: var(--rc-level); text-shadow: 0 0 18px color-mix(in srgb, var(--rc-level) 55%, transparent); animation: rcGlow 1.8s ease-in-out infinite; }
        .rc-name { font-size: 13px; font-weight: 700; color: var(--text-primary); line-height: 1.25; overflow-wrap: anywhere; }
        .rc-meta { font-size: 12px; color: var(--text); line-height: 1.3; margin-top: 2px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
        .rc-comp { font-size: 10.5px; color: var(--muted); line-height: 1.3; margin-top: 2px; overflow-wrap: anywhere; }
        .rc-mid { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-width: 0; }
        .rc-arrow { font-size: 20px; line-height: 1; color: var(--muted); }
        .rc-arrow-down { display: none; }
        .rc-gain { font-size: 12.5px; font-weight: 800; color: #4ade80; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .rc-tied { font-size: 11.5px; font-weight: 700; color: #fbbf24; text-align: center; max-width: 76px; line-height: 1.25; }

        /* First ever: the new record alone */
        .rc-first { padding: 10px; border-radius: 10px; text-align: center; border: 1px solid var(--rc-level); background: color-mix(in srgb, var(--rc-level) 10%, transparent); }
        .rc-first .rc-value { font-size: 30px; color: var(--rc-level); text-shadow: 0 0 18px color-mix(in srgb, var(--rc-level) 55%, transparent); animation: rcGlow 1.8s ease-in-out infinite; }
        .rc-first-note { font-size: 12.5px; font-weight: 700; color: var(--rc-level); margin-top: 6px; }

        /* Highlight: how long the old record stood */
        .rc-stat { display: flex; align-items: center; gap: 10px; margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: rgba(74,222,128,0.08); border: 1px solid rgba(74,222,128,0.25); }
        .rc-days { display: flex; align-items: baseline; gap: 5px; flex-shrink: 0; }
        .rc-days-n { font-size: 30px; font-weight: 800; line-height: 1; color: #4ade80; font-variant-numeric: tabular-nums; }
        .rc-days-unit { font-size: 13px; font-weight: 700; color: #4ade80; }
        .rc-stat-caption { font-size: 12.5px; font-weight: 600; color: var(--text); line-height: 1.3; min-width: 0; overflow-wrap: anywhere; }
        .rc-stat-solo { justify-content: center; text-align: center; }
        .rc-stat-solo .rc-stat-caption { font-size: 13.5px; font-weight: 700; color: #4ade80; }

        /* The club record that fell along with a national-or-higher one */
        .rc-club {
          margin-top: 8px; padding: 6px 9px; border-radius: 9px; font-size: 12px; line-height: 1.4;
          color: var(--text); background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.28);
          overflow-wrap: anywhere; font-variant-numeric: tabular-nums;
        }
        .rc-club-label { color: #a78bfa; font-weight: 700; }
        .rc-club-value { font-weight: 800; text-decoration: line-through; text-decoration-color: rgba(244,63,94,0.75); }

        .rc-close {
          flex-shrink: 0; width: 100%; min-height: 46px; margin: 2px 0 0; border-radius: 12px; cursor: pointer;
          font-family: inherit; font-size: 15px; font-weight: 700; color: #fff; border: none;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
        }

        /* Very narrow phones: stack old → new, arrow pointing down */
        @media (max-width: 359px) {
          .rc-compare { grid-template-columns: minmax(0, 1fr); }
          .rc-mid { flex-direction: row; gap: 8px; padding: 1px 0; }
          .rc-arrow-right { display: none; }
          .rc-arrow-down { display: inline; }
          .rc-tied { max-width: none; }
          .rc-value { font-size: 24px; }
        }

        .rc-confetti { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
        .rc-confetti span { position: absolute; top: -20px; opacity: 0.9; animation: rcFall linear infinite; }
        @keyframes rcFall { 0% { transform: translateY(-20px) rotate(0deg); } 100% { transform: translateY(105vh) rotate(540deg); } }
        @keyframes rcPop { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes rcFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rcGlow { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.25); } }
        @media (prefers-reduced-motion: reduce) {
          .rc-confetti { display: none; }
          .rc-card, .rc-scrim, .rc-panel-new .rc-value, .rc-first .rc-value { animation: none; }
        }
      `}</style>
    </div>
  );
}

function Item({ item }: { item: CelebrationItem }) {
  const style = { '--rc-level': LEVEL_COLOR[item.level] } as React.CSSProperties;
  return (
    <div className="rc-item" style={style}>
      <div className="rc-chip">{item.chip}</div>

      {item.first || !item.previous ? (
        <div className="rc-first">
          <div className="rc-value">{item.next.value}</div>
          <div className="rc-name">{item.next.name}</div>
          {item.first && <div className="rc-first-note">{item.first}</div>}
        </div>
      ) : (
        <div className="rc-compare">
          <div className="rc-panel rc-panel-prev">
            <div className="rc-label">{item.previous.label}</div>
            <div className="rc-value">{item.previous.value}</div>
            {item.previous.name && <div className="rc-name">{item.previous.name}</div>}
            {item.previous.date && <div className="rc-meta">{item.previous.date}</div>}
            {item.previous.competition && <div className="rc-comp">{item.previous.competition}</div>}
          </div>
          <div className="rc-mid">
            <span className="rc-arrow rc-arrow-right" aria-hidden="true">→</span>
            <span className="rc-arrow rc-arrow-down" aria-hidden="true">↓</span>
            {item.improvement && <span className="rc-gain">{item.improvement}</span>}
            {item.tied && <span className="rc-tied">{item.tied}</span>}
          </div>
          <div className="rc-panel rc-panel-new">
            <div className="rc-label">{item.next.label}</div>
            <div className="rc-value">{item.next.value}</div>
            <div className="rc-name">{item.next.name}</div>
            <div className="rc-meta">{item.next.when}</div>
          </div>
        </div>
      )}

      {/* NR / CR / WR: the club record that fell with it — smaller, one line */}
      {item.clubPrevious && (
        <div className="rc-club">
          <span className="rc-club-label">{item.clubPrevious.label}:</span>{' '}
          <span className="rc-club-value">{item.clubPrevious.value}</span>
          {(item.clubPrevious.name || item.clubPrevious.date) && (
            <> — {[item.clubPrevious.name, item.clubPrevious.date].filter(Boolean).join(', ')}</>
          )}
          {item.clubPrevious.days !== undefined && <> ({item.clubPrevious.days} {item.clubPrevious.unit})</>}
        </div>
      )}

      {item.stat && (
        <div className={`rc-stat${item.stat.days === undefined ? ' rc-stat-solo' : ''}`}>
          {item.stat.days !== undefined && (
            <div className="rc-days">
              <span className="rc-days-n">{item.stat.days}</span>
              <span className="rc-days-unit">{item.stat.unit}</span>
            </div>
          )}
          <div className="rc-stat-caption">{item.stat.caption}</div>
        </div>
      )}
    </div>
  );
}
