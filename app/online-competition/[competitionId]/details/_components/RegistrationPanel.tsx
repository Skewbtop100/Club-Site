'use client';

import { useEffect, useState } from 'react';
import type { OnlineCompetitionEventConfig } from '@/lib/online-competition/types';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { fetchRegistration, registerForCompetition } from '@/lib/online-competition/data';

type RegState = 'idle' | 'picking' | 'registered';

/** idle -> picking -> registered, persisted to
 *  onlineParticipants/{uid}/registrations/{competitionId}. On mount, if
 *  the signed-in user already has a registration for this competition,
 *  this skips straight to `registered` with their previous events
 *  pre-selected instead of resetting to `idle`. */
export default function RegistrationPanel({
  competitionId,
  events,
}: {
  competitionId: string;
  events: OnlineCompetitionEventConfig[];
}) {
  const { user, signInWithGoogle } = useOnlineAuth();
  const [state, setState] = useState<RegState>('idle');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [authError, setAuthError] = useState('');
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Load any existing registration for this user + competition so a
  // reload (or a later visit) shows their real status instead of
  // resetting to idle every time.
  useEffect(() => {
    if (!user || user.isAnonymous) {
      setCheckingExisting(false);
      return;
    }
    let cancelled = false;
    setCheckingExisting(true);
    fetchRegistration(user.uid, competitionId)
      .then((reg) => {
        if (cancelled || !reg) return;
        setSelected(new Set(reg.events));
        setState('registered');
      })
      .catch(() => {
        // Best-effort — if this fails, the user just sees the idle state
        // and can register (or re-register) normally.
      })
      .finally(() => {
        if (!cancelled) setCheckingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, competitionId]);

  async function handleRegisterClick() {
    // Anonymous (solve-page) sessions don't count — registering needs a
    // real, returning identity.
    if (!user || user.isAnonymous) {
      setAuthError('');
      try {
        await signInWithGoogle();
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        // User closed the popup or it got superseded by another —
        // nothing went wrong, just stay on the idle state quietly.
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
        setAuthError('Нэвтрэхэд алдаа гарлаа, дахин оролдоно уу');
        return;
      }
    }
    setState('picking');
  }

  function toggle(eventId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  async function handleConfirm() {
    // Shouldn't normally happen — "Бүртгүүлэх" already gates sign-in
    // before reaching this panel — but the session could have expired or
    // been signed out in another tab while this one sat on the picking
    // screen, so this stays defensive rather than trusting the caller.
    if (!user || user.isAnonymous) {
      setSaveError('Та нэвтрээгүй байна. Дахин нэвтэрнэ үү.');
      return;
    }
    setSaveError('');
    setSaving(true);
    try {
      await registerForCompetition(user.uid, competitionId, Array.from(selected));
      setState('registered');
    } catch {
      setSaveError('Бүртгэл хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setSaving(false);
    }
  }

  if (checkingExisting) {
    return null;
  }

  if (state === 'idle') {
    return (
      <div className="oc-reg-idle">
        <div>
          <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#4C473C', maxWidth: 420 }}>
            Бүртгүүлснээр тухайн төрлүүдийн раунд эхлэх үед камерын урсгал танд нээгдэнэ.
          </p>
          {authError && (
            <p style={{ marginTop: 8, font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>
              {authError}
            </p>
          )}
        </div>
        <button type="button" className="oc-btn-register" onClick={handleRegisterClick}>
          Бүртгүүлэх
        </button>
      </div>
    );
  }

  if (state === 'picking') {
    return (
      <div className="oc-reg-picking">
        <div className="oc-reg-picking-header">
          <span style={{ font: '600 16px var(--oc-font-heading), sans-serif', color: '#16140F' }}>
            Ямар төрөлд орох вэ?
          </span>
          <span
            style={{ font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.12em', color: '#8A8474' }}
          >
            {selected.size} СОНГОСОН
          </span>
        </div>
        <div className="oc-reg-picking-body">
          {events.map((e) => {
            const checked = selected.has(e.eventId);
            return (
              <button
                key={e.eventId}
                type="button"
                className="oc-reg-toggle-row"
                onClick={() => toggle(e.eventId)}
              >
                <span
                  aria-hidden
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: checked ? '1px solid #16140F' : '1px solid #A9A392',
                    background: checked ? '#DFFF4F' : 'transparent',
                    color: '#16140F',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {checked ? '✓' : ''}
                </span>
                <span style={{ flex: 1, font: '600 14px var(--oc-font-mono), monospace', color: '#16140F' }}>
                  {e.eventId.toUpperCase()}
                </span>
                <span style={{ font: '400 11px var(--oc-font-mono), monospace', color: '#8A8474' }}>
                  {e.rounds} раунд
                </span>
              </button>
            );
          })}
        </div>
        {saveError && (
          <p
            style={{
              padding: '0 20px',
              marginBottom: -4,
              font: '400 12px var(--oc-font-heading), sans-serif',
              color: '#D8402C',
            }}
          >
            {saveError}
          </p>
        )}
        <div className="oc-reg-picking-footer">
          <button type="button" className="oc-btn-cancel" disabled={saving} onClick={() => setState('idle')}>
            Болих
          </button>
          <button
            type="button"
            className="oc-btn-register-confirm"
            disabled={selected.size === 0 || saving}
            onClick={handleConfirm}
          >
            {saving ? 'Хадгалж байна...' : 'Бүртгэлээ бататгах'}
          </button>
        </div>
      </div>
    );
  }

  const chosen = events.filter((e) => selected.has(e.eventId));
  return (
    <div className="oc-reg-registered">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: '1.5px solid #2E9E5B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#1D6E3E',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            ✓
          </span>
          <span style={{ font: '600 17px var(--oc-font-heading), sans-serif', color: '#1D6E3E' }}>
            Та бүртгүүлсэн
          </span>
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {chosen.map((e) => (
            <span key={e.eventId} className="oc-reg-chip">
              {e.eventId.toUpperCase()} · {e.rounds} раунд
            </span>
          ))}
        </div>
        <p style={{ marginTop: 12, font: '400 12px var(--oc-font-heading), sans-serif', color: '#4C473C' }}>
          Раунд эхлэхэд «Миний тэмцээнүүд» дээр «Эхлүүлэх» товч нээгдэнэ.
        </p>
      </div>
      <button type="button" className="oc-btn-edit-registration" onClick={() => setState('picking')}>
        Бүртгэлээ засах
      </button>
    </div>
  );
}
