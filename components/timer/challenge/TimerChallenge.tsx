'use client';

// Challenge-mode pieces of the solo timer (docs/challenge-plan.md, B4,
// phases 4a–4b): the progress strip above the digits, the mandatory
// OK / +2 / DNF row, and the full-screen celebration on completion
// (decision 17). The strip and the row take the timer's active theme
// (`c`); the celebration uses the challenge pages' monochrome tokens with
// the one green accent.
import { useState } from 'react';
import { METRIC_LABEL, formatTarget, previewSentence } from '@/lib/challenge';
import { T } from './ui';
import type { CompletionResult } from '@/lib/firebase/services/challengeSessions';
import { ubClock } from '@/lib/challenge-progress';
import type { ChallengeTemplate, SessionProgress } from '@/lib/types/challenge';
import type { Penalty } from '@/lib/timer-engine';

export interface TimerColors {
  text: string; muted: string; border: string; card: string; cardAlt: string;
  success: string; danger: string;
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();
/** Keeps taps on these controls from reaching the timer's tap-to-arm area. */
const absorb = { onTouchStart: stop, onTouchEnd: stop, onPointerDown: stop, onMouseDown: stop, onClick: stop };

/** "Ao5 1.87 ✓" / "Ao5 2.03 ✗ — дахин эхэллээ" for the block just finished. */
export function lastBlockNote(t: ChallengeTemplate, p: SessionProgress): { text: string; pass: boolean } | null {
  if (p.inBlock !== 0 || p.blocks.length === 0) return null;
  const b = p.blocks[p.blocks.length - 1];
  const time = b.displayCs === null ? 'DNF' : formatTarget(b.displayCs * 10);
  return b.pass
    ? { text: `${METRIC_LABEL[t.metric]} ${time} ✓`, pass: true }
    : { text: `${METRIC_LABEL[t.metric]} ${time} ✗ — дахин эхэллээ`, pass: false };
}

/**
 * Sits just above the timer digits (decision 21) and fades with the rest of
 * the UI while timing (N6 — the page adds `.pv-challenge-strip` to its
 * focus-mode list).
 */
export function ChallengeStrip({ template, endsAt, progress, c, onEnd }: {
  template: ChallengeTemplate; endsAt: number; progress: SessionProgress | null;
  c: TimerColors; onEnd: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = progress;
  const streak = p?.currentStreak ?? 0;
  const m = template.streak;
  const note = p ? lastBlockNote(template, p) : null;
  const small: React.CSSProperties = { fontSize: '0.72rem', color: c.muted };
  const btn: React.CSSProperties = {
    background: 'transparent', border: 'none', color: c.muted, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: '0.72rem', padding: '0.2rem 0.45rem', borderRadius: 8,
  };

  return (
    <div className="pv-challenge-strip" data-testid="challenge-strip" {...absorb} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem',
      marginBottom: '0.9rem', cursor: 'default', maxWidth: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: c.text }}>{template.title}</span>
        <span style={small}>· {ubClock(endsAt)} хүртэл</span>
        {!confirming ? (
          <button type="button" data-testid="challenge-end" style={btn} onClick={() => setConfirming(true)}>Өнөөдрийг дуусгах</button>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
            <span style={small}>Дуусгах уу?</span>
            <button type="button" data-testid="challenge-end-confirm" disabled={busy} style={{ ...btn, color: c.danger }}
              onClick={async () => { setBusy(true); try { await onEnd(); } finally { setBusy(false); setConfirming(false); } }}>Тийм</button>
            <button type="button" style={btn} onClick={() => setConfirming(false)}>Үгүй</button>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        {p && p.blockSize > 1 && (
          <span data-testid="challenge-block" style={{ fontSize: '0.8rem', color: c.text, fontVariantNumeric: 'tabular-nums' }}>
            {METRIC_LABEL[template.metric]} · {p.inBlock}/{p.blockSize} эвлүүлэлт
          </span>
        )}
        <span data-testid="challenge-streak" aria-label={`Дараалал ${streak}/${m}`} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontVariantNumeric: 'tabular-nums',
        }}>
          {m <= 10 ? (
            <span aria-hidden="true" style={{ letterSpacing: '0.12em', fontSize: '0.85rem', color: c.text }}>
              {'●'.repeat(Math.min(streak, m))}<span style={{ color: c.border }}>{'○'.repeat(Math.max(0, m - streak))}</span>
            </span>
          ) : (
            <span aria-hidden="true" style={{ width: 90, height: 6, borderRadius: 3, background: c.cardAlt, overflow: 'hidden', display: 'inline-block' }}>
              <span style={{ display: 'block', height: '100%', width: `${(100 * Math.min(streak, m)) / m}%`, background: c.text }} />
            </span>
          )}
          <span style={{ fontSize: '0.8rem', color: c.muted }}>{streak}/{m}</span>
        </span>
      </div>

      <div data-testid="challenge-block-note" style={{
        minHeight: '1.05rem', fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums',
        color: note ? (note.pass ? c.success : c.danger) : c.muted,
      }}>{note?.text ?? ''}</div>
    </div>
  );
}

/** The mandatory confirmation after every challenge solve (decision 4):
 *  replaces the usual action row; the next solve can't start until chosen. */
export function ChallengeConfirmRow({ isMobile, c, onConfirm }: {
  isMobile: boolean; c: TimerColors; onConfirm: (p: Penalty) => void;
}) {
  const opts: { p: Penalty; label: string; id: string }[] = [
    { p: 'none', label: 'OK', id: 'ok' }, { p: '+2', label: '+2', id: 'plus2' }, { p: 'dnf', label: 'DNF', id: 'dnf' },
  ];
  return (
    <div data-testid="challenge-confirm" {...absorb} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.45rem', marginTop: '1.1rem', cursor: 'default',
    }}>
      <div style={{ display: 'flex', gap: isMobile ? '0.6rem' : '0.5rem' }}>
        {opts.map(o => (
          <button
            key={o.id} type="button" data-testid={`challenge-confirm-${o.id}`}
            onClick={() => onConfirm(o.p)}
            style={{
              minWidth: isMobile ? 72 : 64, height: isMobile ? 44 : 38, borderRadius: 10,
              background: o.p === 'none' ? c.cardAlt : 'transparent',
              border: `1px solid ${c.border}`, color: o.p === 'none' ? c.text : c.danger,
              fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
              touchAction: 'manipulation',
            }}
          >{o.label}</button>
        ))}
      </div>
      <span style={{ fontSize: '0.7rem', color: c.muted }}>Баталгаажуулсны дараа өөрчлөх боломжгүй</span>
    </div>
  );
}

/** Green accent — the only colour on the celebration screen. */
const ACCENT = '#34D399';
/** ✅ in text presentation (U+FE0E), so it takes ACCENT instead of the
 *  platform's colour-emoji green. */
const CHECK = '\u2705\uFE0E';

/**
 * Full-screen celebration when the streak reaches M (decision 17, A8):
 * "✅ Challenge биеллээ", the challenge sentence, days taken, sessions,
 * total blocks and the completion date. One calm entrance — the backdrop
 * fades, the card rises, the ✅ settles in, the lines follow in a short
 * stagger — and nothing at all with prefers-reduced-motion. No confetti.
 * The ✅ is drawn in text presentation (U+FE0E) so it takes the accent
 * colour instead of the platform's emoji green.
 * "Үргэлжлүүлэх" closes it; the timer is already back in normal mode.
 */
export function ChallengeCelebration({ template, result, onContinue }: {
  template: ChallengeTemplate; result: CompletionResult | null; onContinue: () => void;
}) {
  const stats: [string, string][] = result ? [
    ['Зарцуулсан өдөр', String(result.daysTaken)],
    ['Session', String(result.sessionsCount)],
    ['Нийт блок', String(result.blocksAttempted)],
    ['Биелсэн огноо', result.completedUbDate],
  ] : [];
  return (
    <div role="dialog" aria-modal="true" aria-label="Challenge биеллээ" data-testid="challenge-celebration"
      className="pv-celebrate" {...absorb} style={{
        position: 'fixed', inset: 0, zIndex: 9600, background: T.bg, color: T.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
      }}>
      <style>{`
        .pv-celebrate { animation: pv-cel-fade 0.35s ease-out both; }
        .pv-celebrate .pv-cel-card { animation: pv-cel-rise 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) 0.05s both; }
        .pv-celebrate .pv-cel-mark { animation: pv-cel-pop 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.2) 0.2s both; }
        .pv-celebrate .pv-cel-line { animation: pv-cel-rise 0.45s ease-out both; }
        @keyframes pv-cel-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pv-cel-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes pv-cel-pop { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .pv-celebrate, .pv-celebrate .pv-cel-card, .pv-celebrate .pv-cel-line, .pv-celebrate .pv-cel-mark { animation: none; }
        }
      `}</style>
      <div className="pv-cel-card" style={{
        width: 'min(100%, 420px)', display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '1.1rem', textAlign: 'center',
      }}>
        <h2 data-testid="celebration-title" style={{
          margin: 0, fontSize: '1.45rem', fontWeight: 700,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.9rem',
        }}>
          <span className="pv-cel-mark" style={{
            width: 72, height: 72, borderRadius: '50%', border: `2px solid ${ACCENT}`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: ACCENT, fontSize: '2.1rem', lineHeight: 1,
          }}>{CHECK}</span>
          <span className="pv-cel-line" style={{ animationDelay: '0.45s' }}>Challenge биеллээ</span>
        </h2>
        <p className="pv-cel-line" data-testid="celebration-sentence" style={{
          margin: 0, fontSize: '0.98rem', color: T.text, lineHeight: 1.5, animationDelay: '0.55s',
        }}>{previewSentence(template)}</p>
        {stats.length > 0 && (
          <div className="pv-cel-line" data-testid="celebration-stats" style={{
            width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1,
            background: T.border, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden',
            animationDelay: '0.65s',
          }}>
            {stats.map(([label, value]) => (
              <div key={label} style={{ background: T.card, padding: '0.7rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <span style={{ fontSize: '0.72rem', color: T.muted }}>{label}</span>
                <span style={{ fontSize: '1.05rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="pv-cel-line" onClick={onContinue} style={{
          marginTop: '0.3rem', background: T.cardAlt, color: T.text, border: `1px solid ${T.borderHi}`,
          borderRadius: 10, padding: '0.65rem 1.4rem', fontFamily: 'inherit', fontSize: '0.92rem',
          fontWeight: 600, cursor: 'pointer', animationDelay: '0.75s',
        }}>Үргэлжлүүлэх</button>
      </div>
    </div>
  );
}
