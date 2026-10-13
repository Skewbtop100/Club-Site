'use client';

import { useEffect, useState } from 'react';
import {
  subscribeJudgeAccess, setJudgePin, revealJudgePin,
  type JudgeAccessStatus, type PinRevealFailure,
} from '@/lib/firebase/services/judge-access';
import { useLang, type TranslationKey } from '@/lib/i18n';

const REVEAL_MESSAGE: Record<Exclude<PinRevealFailure, 'disabled'>, TranslationKey> = {
  legacy: 'admin.comp.judge-pin.legacy',
  'no-key': 'admin.comp.judge-pin.no-key',
  undecryptable: 'admin.comp.judge-pin.undecryptable',
  error: 'admin.comp.judge-pin.reveal-failed',
};

/**
 * "Шүүгчийн PIN" in the competition form: generate / regenerate / disable
 * the PIN judges sign in with on /judge, and look the active one up again.
 *
 * The PIN is created, hashed and encrypted on the server (app/api/judge/pin).
 * The browser gets it only in the generate response and from the admin-only
 * `reveal` action, which decrypts the stored copy — so it is shown masked
 * until the admin asks, and it never sits in Firestore in the clear. A PIN
 * with no encrypted copy (made before that existed, or while the server had
 * no JUDGE_PIN_ENC_KEY) still works but can't be shown.
 * `competitionId` is null for a competition not created yet.
 */
export default function JudgePinSection({ competitionId }: { competitionId: string | null }) {
  const { t } = useLang();
  const [status, setStatus] = useState<JudgeAccessStatus | null>(null);
  // A PIN the server has handed over (generate or reveal), with the stored
  // record's timestamp it belongs to. It only counts as "the active PIN"
  // while that is still the record on the document — if another admin
  // regenerates or disables, the stamp moves on and this is ignored.
  const [held, setHeld] = useState<{ pin: string; stamp: number } | null>(null);
  const [wantVisible, setWantVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealNote, setRevealNote] = useState<TranslationKey | ''>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');

  useEffect(() => {
    if (!competitionId) return;
    return subscribeJudgeAccess(competitionId, setStatus, () => setStatus({ enabled: false, updatedAt: null, revealable: 'legacy' }));
  }, [competitionId]);

  const stamp = status?.updatedAt?.getTime() ?? 0;
  const pin = held && held.stamp === stamp && status?.enabled ? held.pin : '';
  const visible = wantVisible && !!pin;

  async function run(action: 'generate' | 'disable') {
    if (!competitionId) return;
    setBusy(true); setMsg('');
    try {
      const result = await setJudgePin(competitionId, action);
      // Show a fresh PIN straight away (it appears as soon as the document
      // snapshot with the same timestamp is in, whichever arrives first).
      setHeld(result.pin && result.updatedAt ? { pin: result.pin, stamp: result.updatedAt } : null);
      setWantVisible(!!result.pin);
      setRevealNote(''); setCopied(false);
      if (action === 'disable') { setMsgType('success'); setMsg(t('admin.comp.judge-pin.disabled-msg')); }
    } catch (e: unknown) {
      setMsgType('error');
      setMsg(t('admin.msg.error-prefix') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  /** The active PIN, from memory or the server; '' (with a note) if it can't be had. */
  async function loadPin(): Promise<string> {
    if (pin) return pin;
    if (!competitionId) return '';
    setBusy(true); setRevealNote('');
    try {
      const result = await revealJudgePin(competitionId);
      if (!('reason' in result)) { setHeld({ pin: result.pin, stamp }); return result.pin; }
      if (result.reason !== 'disabled') setRevealNote(REVEAL_MESSAGE[result.reason]);
      return '';
    } catch {
      setRevealNote('admin.comp.judge-pin.reveal-failed');
      return '';
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisible() {
    if (visible) { setWantVisible(false); return; }
    if (await loadPin()) setWantVisible(true);
  }

  async function copy() {
    const value = await loadPin();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions, insecure origin): show it instead.
      setWantVisible(true);
    }
  }

  const enabled = !!status?.enabled;
  // Can it be shown? Yes if we already hold it (just generated), else only
  // with an encrypted copy on the document.
  const revealable = !!pin || status?.revealable === 'yes';
  const cannotShow: TranslationKey | '' = !enabled || revealable ? ''
    : status?.revealable === 'no-key' ? 'admin.comp.judge-pin.no-key' : 'admin.comp.judge-pin.legacy';
  const iconBtn: React.CSSProperties = {
    minWidth: '2.4rem', minHeight: '2.4rem', padding: '0 0.6rem', borderRadius: '8px', cursor: busy ? 'wait' : 'pointer',
    fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600,
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', color: 'var(--text)',
  };

  return (
    <div className="form-group">
      <label>{t('admin.comp.judge-pin.label')}</label>
      <div style={{ fontSize: '0.73rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
        {t('admin.comp.judge-pin.help')}
      </div>
      {!competitionId ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic' }}>{t('admin.comp.judge-pin.need-save')}</div>
      ) : (
        <>
          {/* Active PIN: masked until asked for, with show/hide and copy */}
          {enabled && (
            <div style={{
              marginBottom: '0.6rem', padding: '0.6rem 0.8rem', borderRadius: '10px',
              background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)',
            }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem' }}>
                {t('admin.comp.judge-pin.active')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span
                  aria-live="polite"
                  style={{ fontFamily: 'monospace', fontSize: '1.7rem', fontWeight: 700, letterSpacing: '0.3em', color: 'var(--text)', minWidth: '9.5rem' }}
                >
                  {visible && pin ? pin : '••••••'}
                </span>
                {revealable && (
                  <>
                    <button
                      type="button" style={iconBtn} disabled={busy} onClick={toggleVisible}
                      aria-label={t(visible ? 'admin.comp.judge-pin.hide' : 'admin.comp.judge-pin.show')}
                      title={t(visible ? 'admin.comp.judge-pin.hide' : 'admin.comp.judge-pin.show')}
                    >
                      {visible ? '🙈' : '👁'}
                    </button>
                    <button type="button" style={iconBtn} disabled={busy} onClick={copy}>
                      {t(copied ? 'admin.comp.judge-pin.copied' : 'admin.comp.judge-pin.copy')}
                    </button>
                  </>
                )}
              </div>
              {status?.updatedAt && (
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                  {t('admin.comp.judge-pin.created')} {status.updatedAt.toLocaleString()}
                </div>
              )}
              {(cannotShow || revealNote) && (
                <div style={{ fontSize: '0.75rem', color: '#fbbf24', marginTop: '0.3rem' }}>{t(revealNote || cannotShow as TranslationKey)}</div>
              )}
              {/* Just generated, but the server can't show it again later. */}
              {pin && status?.revealable !== 'yes' && (
                <div style={{ fontSize: '0.75rem', color: '#fbbf24', marginTop: '0.3rem' }}>{t('admin.comp.judge-pin.shown-once')}</div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
            <span style={{
              padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
              border: `1px solid ${enabled ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.12)'}`,
              background: enabled ? 'rgba(34,197,94,0.12)' : 'transparent',
              color: enabled ? '#4ade80' : 'var(--muted)',
            }}>
              {t(enabled ? 'admin.comp.judge-pin.status-on' : 'admin.comp.judge-pin.status-off')}
            </span>
            <button type="button" className="btn-sm-secondary" disabled={busy || status === null} onClick={() => run('generate')}>
              {t(enabled ? 'admin.comp.judge-pin.regenerate' : 'admin.comp.judge-pin.generate')}
            </button>
            {enabled && (
              <button type="button" className="btn-sm-secondary" disabled={busy} onClick={() => run('disable')}>
                {t('admin.comp.judge-pin.disable')}
              </button>
            )}
          </div>
          {enabled && (
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.4rem' }}>{t('admin.comp.judge-pin.regenerate-note')}</div>
          )}
        </>
      )}
      {msg && <div className={`msg ${msgType}`} style={{ display: 'block' }}>{msg}</div>}
    </div>
  );
}
