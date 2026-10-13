'use client';

import { useEffect, useState } from 'react';
import { subscribeJudgeAccess, setJudgePin, type JudgeAccessStatus } from '@/lib/firebase/services/judge-access';
import { useLang } from '@/lib/i18n';

/**
 * "Шүүгчийн PIN" in the competition form: generate / regenerate / disable
 * the PIN judges sign in with on /judge. The PIN is created and hashed on
 * the server (app/api/judge/pin) and shown here exactly once, straight from
 * that response — only its hash is stored, so there is nothing to show
 * again later. `competitionId` is null for a competition not created yet.
 */
export default function JudgePinSection({ competitionId }: { competitionId: string | null }) {
  const { t } = useLang();
  const [status, setStatus] = useState<JudgeAccessStatus | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');

  useEffect(() => {
    if (!competitionId) return;
    return subscribeJudgeAccess(competitionId, setStatus, () => setStatus({ enabled: false, updatedAt: null }));
  }, [competitionId]);

  async function run(action: 'generate' | 'disable') {
    if (!competitionId) return;
    setBusy(true); setMsg('');
    try {
      const result = await setJudgePin(competitionId, action);
      setPin(result.pin || '');
      if (action === 'disable') { setMsgType('success'); setMsg(t('admin.comp.judge-pin.disabled-msg')); }
    } catch (e: unknown) {
      setMsgType('error');
      setMsg(t('admin.msg.error-prefix') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  const enabled = !!status?.enabled;

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
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
            <span style={{
              padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
              border: `1px solid ${enabled ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.12)'}`,
              background: enabled ? 'rgba(34,197,94,0.12)' : 'transparent',
              color: enabled ? '#4ade80' : 'var(--muted)',
            }}>
              {t(enabled ? 'admin.comp.judge-pin.status-on' : 'admin.comp.judge-pin.status-off')}
              {enabled && status?.updatedAt ? ` · ${status.updatedAt.toLocaleString()}` : ''}
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
          {enabled && !pin && (
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.4rem' }}>{t('admin.comp.judge-pin.regenerate-note')}</div>
          )}
          {pin && (
            <div style={{
              marginTop: '0.6rem', padding: '0.7rem 0.9rem', borderRadius: '10px', textAlign: 'center',
              background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.35)',
            }}>
              <div style={{ fontFamily: 'monospace', fontSize: '2rem', fontWeight: 700, letterSpacing: '0.3em', color: 'var(--text)' }}>{pin}</div>
              <div style={{ fontSize: '0.75rem', color: '#fbbf24', marginTop: '0.3rem' }}>{t('admin.comp.judge-pin.shown-once')}</div>
            </div>
          )}
        </>
      )}
      {msg && <div className={`msg ${msgType}`} style={{ display: 'block' }}>{msg}</div>}
    </div>
  );
}
