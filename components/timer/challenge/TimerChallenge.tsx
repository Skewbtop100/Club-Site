'use client';

// Challenge-mode pieces of the solo timer (docs/challenge-plan.md, B4,
// phase 4a): the progress strip above the digits, the mandatory
// OK / +2 / DNF row, and the simple "✅ Challenge биеллээ" notice (the full
// celebration screen is phase 4b). Colours come from the timer's active
// theme (`c`), so they follow the user's palette; monochrome except the
// semantic success / danger.
import { useState } from 'react';
import { METRIC_LABEL, formatTarget } from '@/lib/challenge';
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

/** Phase 4a's simple completion notice (the celebration screen is 4b). */
export function ChallengeCompleted({ title, c, onClose }: { title: string; c: TimerColors; onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Challenge биеллээ" data-testid="challenge-completed" style={{
      position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
    }}>
      <div style={{
        background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: '1.4rem 1.6rem',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem', textAlign: 'center', maxWidth: 360,
      }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 700, color: c.text }}>✅ Challenge биеллээ</div>
        {title && <div style={{ fontSize: '0.88rem', color: c.muted }}>{title}</div>}
        <button type="button" onClick={onClose} style={{
          marginTop: '0.4rem', background: c.cardAlt, border: 'none', color: c.text, borderRadius: 10,
          padding: '0.5rem 1.1rem', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
        }}>Хаах</button>
      </div>
    </div>
  );
}
