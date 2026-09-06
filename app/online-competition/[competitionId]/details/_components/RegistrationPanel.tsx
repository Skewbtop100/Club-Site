'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OnlineCompetitionEventConfig } from '@/lib/online-competition/types';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { onlineCompAuth } from '@/lib/online-competition/firebase';
import { fetchParticipant, fetchRegistration, registerForCompetition, resolveProfileStatus } from '@/lib/online-competition/data';

type RegState = 'idle' | 'gated' | 'picking' | 'registered';

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
  const [checkingProfile, setCheckingProfile] = useState(false);
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
    let uid = user?.uid;
    if (!user || user.isAnonymous) {
      setAuthError('');
      try {
        await signInWithGoogle();
        // signInWithGoogle() resolves void — read the freshly-signed-in uid
        // straight off the auth instance rather than the `user` from
        // useOnlineAuth's closure, which won't reflect the new sign-in
        // until this component re-renders off onAuthStateChanged.
        uid = onlineCompAuth.currentUser?.uid;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        // User closed the popup or it got superseded by another —
        // nothing went wrong, just stay on the idle state quietly.
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
        setAuthError('Нэвтрэхэд алдаа гарлаа, дахин оролдоно уу');
        return;
      }
    }
    if (!uid) return;

    // Registration is gated on the athlete's profile-verification status —
    // an unverified/rejected athlete is sent to the profile form instead
    // of the event-picking screen.
    setAuthError('');
    setCheckingProfile(true);
    try {
      const participant = await fetchParticipant(uid);
      if (resolveProfileStatus(participant) !== 'approved') {
        setState('gated');
        return;
      }
    } catch {
      setAuthError('Профайлын мэдээлэл шалгахад алдаа гарлаа, дахин оролдоно уу');
      return;
    } finally {
      setCheckingProfile(false);
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
      <div className="oc-v3-reg-idle">
        <div>
          <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#9A958A', maxWidth: 420 }}>
            Бүртгүүлснээр тухайн төрлүүдийн раунд эхлэх үед камерын урсгал танд нээгдэнэ.
          </p>
          {authError && (
            <p style={{ marginTop: 8, font: '400 12px var(--oc-font-heading), sans-serif', color: '#E8543C' }}>
              {authError}
            </p>
          )}
        </div>
        <button
          type="button"
          className="oc-v3-btn-register"
          disabled={checkingProfile}
          onClick={handleRegisterClick}
        >
          {checkingProfile ? 'Шалгаж байна...' : 'Бүртгүүлэх'}
        </button>
      </div>
    );
  }

  if (state === 'gated') {
    return (
      <div className="oc-v3-reg-gated">
        <p style={{ font: '600 15px var(--oc-font-heading), sans-serif', color: '#E0C46A' }}>
          Профайл баталгаажаагүй байна
        </p>
        <p style={{ marginTop: 8, font: '400 12px var(--oc-font-heading), sans-serif', color: '#9A958A', maxWidth: 420 }}>
          Тэмцээнд бүртгүүлэхийн тулд эхлээд профайлаа бөглөж, админаар баталгаажуулах шаардлагатай.
        </p>
        <Link href="/online-competition/profile" className="oc-v3-btn-register" style={{ marginTop: 14 }}>
          Профайл бөглөх →
        </Link>
      </div>
    );
  }

  if (state === 'picking') {
    return (
      <div className="oc-v3-reg-picking">
        <div className="oc-v3-reg-picking-head">
          <span style={{ font: '600 15px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
            Ямар төрөлд орох вэ?
          </span>
          <span
            style={{ font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.12em', color: '#6E6A62' }}
          >
            {selected.size} СОНГОСОН
          </span>
        </div>
        <div className="oc-v3-reg-picking-body">
          {events.map((e) => {
            const checked = selected.has(e.eventId);
            return (
              <button
                key={e.eventId}
                type="button"
                className="oc-v3-reg-toggle-row"
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
                    border: checked ? '1px solid #DFFF4F' : '1px solid #2A2A31',
                    background: checked ? '#DFFF4F' : 'transparent',
                    color: '#08080A',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {checked ? '✓' : ''}
                </span>
                <span style={{ flex: 1, font: '600 13px var(--oc-font-mono), monospace', color: '#F4F1EA' }}>
                  {e.eventId.toUpperCase()}
                </span>
                <span style={{ font: '400 11px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
                  {e.rounds} раунд
                </span>
              </button>
            );
          })}
        </div>
        {saveError && (
          <p
            style={{
              padding: '0 16px',
              marginBottom: -4,
              font: '400 12px var(--oc-font-heading), sans-serif',
              color: '#E8543C',
            }}
          >
            {saveError}
          </p>
        )}
        <div className="oc-v3-reg-picking-foot">
          <button type="button" className="oc-v3-btn-cancel" disabled={saving} onClick={() => setState('idle')}>
            Болих
          </button>
          <button
            type="button"
            className="oc-v3-btn-register"
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
    <div className="oc-v3-reg-registered">
      <div className="oc-v3-reg-pill">
        <span aria-hidden className="oc-v3-check">
          ✓
        </span>
        <span
          style={{
            font: '600 11px var(--oc-font-mono), monospace',
            letterSpacing: '.1em',
            color: '#4FD07A',
          }}
        >
          ТА БҮРТГҮҮЛСЭН
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {chosen.map((e) => (
          <span key={e.eventId} className="oc-v3-reg-chip">
            {e.eventId.toUpperCase()} · {e.rounds} раунд
          </span>
        ))}
      </div>

      <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
        Раунд эхлэхэд «Миний тэмцээнүүд» дээр «Эхлүүлэх» товч нээгдэнэ.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="oc-v3-btn-edit-reg" onClick={() => setState('picking')}>
          Бүртгэлээ засах
        </button>
        <Link
          href="/online-competition/dashboard"
          style={{ font: '500 12px var(--oc-font-heading), sans-serif', color: '#9A958A' }}
        >
          Миний тэмцээнүүд →
        </Link>
      </div>
    </div>
  );
}
