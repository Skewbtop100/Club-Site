'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  approveAthleteRequest,
  rejectAthleteRequest,
  subscribePendingRequests,
  tsToMs,
} from '@/lib/firebase/services/athleteRequests';
import { getAthlete } from '@/lib/firebase/services/athletes';
import type { AthleteRequest } from '@/lib/types';

function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const cp = trimmed.codePointAt(0);
  return cp ? String.fromCodePoint(cp).toUpperCase() : '?';
}

function formatDateTime(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd} · ${hh}:${mi}`;
}

export default function AthleteRequestsTab() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<AthleteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<AthleteRequest | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);
  const toastTimer = useRef<number | null>(null);

  // Athlete photos aren't on the request doc — fetch lazily so the queue
  // stays snappy. Keyed by athleteId so re-renders don't re-fetch.
  const [athletePhotos, setAthletePhotos] = useState<Record<string, string | null>>({});

  // Best-effort identity for the resolvedBy audit field. Falls back to
  // 'legacy-admin' when the admin signed in via the password flow (no
  // Firebase Auth uid available).
  const adminUid = useMemo(() => {
    if (user?.uid) return user.uid;
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('cubeAthleteUser') : null;
      const session = raw ? JSON.parse(raw) : null;
      if (session?.uid) return String(session.uid);
    } catch { /* ignore corrupt session */ }
    return 'legacy-admin';
  }, [user?.uid]);

  const showToast = (msg: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ msg, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  };
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  // Subscribe to pending. Sort client-side (oldest first) — keeping the
  // query single-`where` avoids a composite-index requirement.
  useEffect(() => {
    const unsub = subscribePendingRequests(
      (rows) => {
        rows.sort((a, b) => (tsToMs(a.requestedAt) ?? 0) - (tsToMs(b.requestedAt) ?? 0));
        setRequests(rows);
        setLoading(false);
      },
      (err) => {
        console.error('[athlete-requests] subscribe', err);
        setLoading(false);
        showToast('Хүсэлт ачаалахад алдаа гарлаа.', 'err');
      },
    );
    return () => unsub();
  }, []);

  // Lazy photo fetch — one lookup per unique athleteId we haven't seen yet.
  useEffect(() => {
    const todo = requests
      .map(r => r.athleteId)
      .filter((id, idx, arr) => arr.indexOf(id) === idx)
      .filter(id => !(id in athletePhotos));
    if (todo.length === 0) return;
    let cancelled = false;
    Promise.all(todo.map(async id => {
      try {
        const a = await getAthlete(id);
        return [id, a?.imageUrl ?? null] as const;
      } catch { return [id, null] as const; }
    })).then(pairs => {
      if (cancelled) return;
      setAthletePhotos(prev => {
        const next = { ...prev };
        for (const [id, url] of pairs) next[id] = url;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [requests, athletePhotos]);

  const handleApprove = async (req: AthleteRequest) => {
    if (busyId) return;
    setBusyId(req.id);
    try {
      await approveAthleteRequest(
        { id: req.id, uid: req.uid, athleteId: req.athleteId },
        adminUid,
      );
      showToast('Зөвшөөрлөө');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div className="card-title"><span className="title-accent" />Хүлээгдэж буй хүсэлтүүд</div>

        {loading ? (
          <div className="spinner-row">Уншиж байна…<span className="spinner-ring" /></div>
        ) : requests.length === 0 ? (
          <div className="empty-state">Хүлээгдэж буй хүсэлт байхгүй байна.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {requests.map(req => (
              <RequestCard
                key={req.id}
                req={req}
                athletePhotoURL={athletePhotos[req.athleteId] ?? null}
                busy={busyId === req.id}
                onApprove={() => handleApprove(req)}
                onReject={() => setRejectFor(req)}
              />
            ))}
          </div>
        )}
      </div>

      {rejectFor && (
        <RejectModal
          req={rejectFor}
          busy={busyId === rejectFor.id}
          onCancel={() => setRejectFor(null)}
          onConfirm={async (reason) => {
            setBusyId(rejectFor.id);
            try {
              await rejectAthleteRequest(rejectFor.id, adminUid, reason);
              showToast('Татгалзлаа');
              setRejectFor(null);
            } catch (err) {
              showToast(err instanceof Error ? err.message : String(err), 'err');
            } finally {
              setBusyId(null);
            }
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
            left: '50%', transform: 'translateX(-50%)',
            zIndex: 2000,
            background: toast.tone === 'ok' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
            border: `1px solid ${toast.tone === 'ok' ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.45)'}`,
            color: toast.tone === 'ok' ? '#34d399' : '#f87171',
            padding: '0.55rem 1rem', borderRadius: 999,
            fontSize: '0.85rem', fontWeight: 700,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            maxWidth: 'calc(100vw - 2rem)',
            animation: 'requests-toast-in 0.2s ease-out',
          }}
        >
          {toast.msg}
        </div>
      )}

      <style>{`
        @keyframes requests-toast-in {
          from { opacity: 0; transform: translate(-50%, -6px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}

// ── Per-request card ─────────────────────────────────────────────────────
function RequestCard({
  req, athletePhotoURL, busy, onApprove, onReject,
}: {
  req: AthleteRequest;
  athletePhotoURL: string | null;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div style={{
      padding: '0.95rem',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      display: 'flex', flexDirection: 'column', gap: '0.7rem',
    }}>
      {/* Requester */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        <Thumb name={req.userDisplayName} url={req.userPhotoURL} size={36} />
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {req.userDisplayName}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {req.userEmail}
          </div>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {formatDateTime(tsToMs(req.requestedAt))}
        </div>
      </div>

      {/* Arrow */}
      <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.1em', fontWeight: 700 }}>
        ↓ хүсэж байна ↓
      </div>

      {/* Athlete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        <Thumb name={req.athleteName} url={athletePhotoURL} size={36} />
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {req.athleteName}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Тамирчны бүртгэл</div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.2rem' }}>
        <button
          onClick={onApprove}
          disabled={busy}
          style={{
            padding: '0.7rem 0.85rem', borderRadius: 9,
            background: '#34d399', color: '#0a0a0a',
            border: '1px solid #34d399',
            fontSize: '0.9rem', fontWeight: 800, fontFamily: 'inherit',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >Зөвшөөрөх</button>
        <button
          onClick={onReject}
          disabled={busy}
          style={{
            padding: '0.7rem 0.85rem', borderRadius: 9,
            background: 'transparent', color: '#ef4444',
            border: '1px solid #ef4444',
            fontSize: '0.9rem', fontWeight: 800, fontFamily: 'inherit',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >Татгалзах</button>
      </div>
    </div>
  );
}

// ── Reject reason modal ──────────────────────────────────────────────────
function RejectModal({
  req, busy, onCancel, onConfirm,
}: {
  req: AthleteRequest;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const trimmed = reason.trim();
  const ok = trimmed.length >= 5;

  const handleConfirm = async () => {
    if (!ok || busy) return;
    setError('');
    try {
      await onConfirm(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          background: 'var(--card)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{
          padding: '0.85rem 1rem',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          fontSize: '1rem', fontWeight: 700,
        }}>
          Хүсэлтийг татгалзах
        </header>
        <div style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.7rem', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text)' }}>{req.userDisplayName}</strong> · {req.athleteName}
          </div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, marginBottom: '0.3rem' }}>
            Шалтгаан
          </label>
          <textarea
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Жишээ: Энэ тамирчин таны нэрстэй таарахгүй байна."
            rows={3}
            style={{
              width: '100%', padding: '0.6rem 0.8rem',
              background: 'var(--input-bg)', color: 'var(--text)',
              border: '1px solid var(--input-border)', borderRadius: 9,
              fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none',
              resize: 'vertical', minHeight: 80, boxSizing: 'border-box',
            }}
          />
          <div style={{ marginTop: '0.4rem', fontSize: '0.74rem', color: trimmed.length < 5 ? '#fbbf24' : 'var(--muted)' }}>
            5-аас дээш тэмдэгт оруулна уу. ({trimmed.length})
          </div>
          {error && (
            <div style={{
              marginTop: '0.6rem', padding: '0.5rem 0.7rem',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 8, color: '#fca5a5', fontSize: '0.8rem',
            }}>{error}</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem', marginTop: '1rem' }}>
            <button
              onClick={onCancel}
              style={{
                padding: '0.7rem 0.85rem', borderRadius: 9,
                background: 'transparent', color: 'var(--text)',
                border: '1px solid rgba(255,255,255,0.12)',
                fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
              }}
            >Болих</button>
            <button
              onClick={handleConfirm}
              disabled={!ok || busy}
              style={{
                padding: '0.7rem 0.85rem', borderRadius: 9,
                background: ok ? '#ef4444' : 'var(--input-bg)',
                color: '#fff', border: 'none',
                fontSize: '0.9rem', fontWeight: 800, fontFamily: 'inherit',
                cursor: !ok || busy ? 'not-allowed' : 'pointer',
                opacity: !ok ? 0.55 : 1,
              }}
            >Татгалзах</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Avatar with broken-image fallback ────────────────────────────────────
function Thumb({ name, url, size }: { name: string; url: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [url]);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%', overflow: 'hidden',
      background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
      color: '#fff', fontSize: size * 0.42, fontWeight: 800, lineHeight: 1,
      flexShrink: 0,
    }}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : initialOf(name)}
    </span>
  );
}
