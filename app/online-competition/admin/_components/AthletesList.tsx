'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../../_components/ui';
import type { OnlineParticipantAdminView, OnlineParticipantGender } from '@/lib/online-competition/types';

const GENDER_LABEL: Record<OnlineParticipantGender, string> = {
  male: 'Эрэгтэй',
  female: 'Эмэгтэй',
  other: 'Бусад',
};

function fmtDate(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AthletesList() {
  const [pending, setPending] = useState<OnlineParticipantAdminView[]>([]);
  const [approved, setApproved] = useState<OnlineParticipantAdminView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoadingUid, setActionLoadingUid] = useState<string | null>(null);
  const [rejectingUid, setRejectingUid] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pendingRes, approvedRes] = await Promise.all([
        fetch('/api/online-competition/admin-athletes?status=pending'),
        fetch('/api/online-competition/admin-athletes?status=approved'),
      ]);
      if (!pendingRes.ok || !approvedRes.ok) throw new Error('failed');
      const pendingData = (await pendingRes.json()) as { athletes: OnlineParticipantAdminView[] };
      const approvedData = (await approvedRes.json()) as { athletes: OnlineParticipantAdminView[] };
      setPending(pendingData.athletes);
      setApproved(approvedData.athletes);
    } catch {
      setError('Тамирчдын мэдээллийг ачааллаж чадсангүй');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(uid: string) {
    setActionLoadingUid(uid);
    try {
      const res = await fetch(`/api/online-competition/admin-athletes/${uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      if (!res.ok) throw new Error('failed');
      const athlete = pending.find((a) => a.uid === uid);
      setPending((prev) => prev.filter((a) => a.uid !== uid));
      if (athlete) {
        setApproved((prev) => [
          ...prev,
          { ...athlete, profileStatus: 'approved', approvedPhotoUrl: athlete.photoUrl, reviewedAt: Date.now() },
        ]);
      }
    } catch {
      setError('Зөвшөөрөхөд алдаа гарлаа, дахин оролдоно уу');
    } finally {
      setActionLoadingUid(null);
    }
  }

  async function handleReject(uid: string) {
    if (!rejectReason.trim()) return;
    setActionLoadingUid(uid);
    try {
      const res = await fetch(`/api/online-competition/admin-athletes/${uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error('failed');
      setPending((prev) => prev.filter((a) => a.uid !== uid));
      setRejectingUid(null);
      setRejectReason('');
    } catch {
      setError('Татгалзахад алдаа гарлаа, дахин оролдоно уу');
    } finally {
      setActionLoadingUid(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
      {error && (
        <p className="text-sm text-[#D8402C]" style={{ marginBottom: -12 }}>
          {error}
        </p>
      )}

      <section>
        <span className="font-[family-name:var(--oc-font-mono)] text-xs font-medium uppercase tracking-[.14em] text-[#8A8474]">
          Ирсэн хүсэлт
        </span>
        <div style={{ marginTop: 16 }}>
          {loading ? (
            <p className="text-[#8A8474]">Ачааллаж байна...</p>
          ) : pending.length === 0 ? (
            <EmptyState text="Хүсэлт алга." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pending.map((a) => (
                <div key={a.uid} className="oc-athlete-card">
                  {a.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Cloudinary URL, not our own image pipeline.
                    <img src={a.photoUrl} alt="" className="oc-athlete-thumb" />
                  ) : (
                    <span className="oc-athlete-thumb" />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="font-[family-name:var(--oc-font-heading)] text-base font-semibold text-[#16140F]">
                      {a.lastName} {a.firstName}
                    </p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm" style={{ marginTop: 8 }}>
                      <dt className="text-[#8A8474]">Төрсөн өдөр</dt>
                      <dd className="text-[#16140F]">{a.dateOfBirth || '—'}</dd>
                      <dt className="text-[#8A8474]">Хүйс</dt>
                      <dd className="text-[#16140F]">{a.gender ? GENDER_LABEL[a.gender] : '—'}</dd>
                      <dt className="text-[#8A8474]">Иргэншил</dt>
                      <dd className="text-[#16140F]">{a.citizenship || '—'}</dd>
                      <dt className="text-[#8A8474]">И-мэйл</dt>
                      <dd className="text-[#16140F]" style={{ overflowWrap: 'anywhere' }}>
                        {a.email || '—'}
                      </dd>
                    </dl>

                    {rejectingUid === a.uid ? (
                      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <input
                          className="oc-input"
                          style={{ flex: 1, minWidth: 200 }}
                          placeholder="Татгалзсан шалтгаан"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="oc-btn oc-btn-outline"
                          disabled={actionLoadingUid === a.uid || !rejectReason.trim()}
                          onClick={() => handleReject(a.uid)}
                        >
                          Татгалзах
                        </button>
                        <button
                          type="button"
                          className="oc-btn oc-btn-outline"
                          disabled={actionLoadingUid === a.uid}
                          onClick={() => {
                            setRejectingUid(null);
                            setRejectReason('');
                          }}
                        >
                          Болих
                        </button>
                      </div>
                    ) : (
                      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="oc-btn oc-btn-primary"
                          disabled={actionLoadingUid === a.uid}
                          onClick={() => handleApprove(a.uid)}
                        >
                          Зөвшөөрөх
                        </button>
                        <button
                          type="button"
                          className="oc-btn oc-btn-outline"
                          disabled={actionLoadingUid === a.uid}
                          onClick={() => {
                            setRejectingUid(a.uid);
                            setRejectReason('');
                          }}
                        >
                          Татгалзах
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <span className="font-[family-name:var(--oc-font-mono)] text-xs font-medium uppercase tracking-[.14em] text-[#8A8474]">
          Бүртгэлтэй тамирчид
        </span>
        <div style={{ marginTop: 16 }}>
          {loading ? (
            <p className="text-[#8A8474]">Ачааллаж байна...</p>
          ) : approved.length === 0 ? (
            <EmptyState text="Тамирчин алга." />
          ) : (
            <div className="oc-table">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderBottom: '1px solid #DCD6C8', background: '#F4F1EA' }}>
                {['', 'Нэр', 'И-мэйл', 'Иргэншил', 'Баталгаажсан'].map((label, i) => (
                  <span
                    key={i}
                    style={{
                      flex: i === 0 ? '0 0 40px' : i === 1 ? '1.4 1 0' : i === 2 ? '1.4 1 0' : i === 3 ? '.8 1 0' : '.9 1 0',
                      font: '500 9px var(--oc-font-mono), monospace',
                      letterSpacing: '.14em',
                      color: '#8A8474',
                      textTransform: 'uppercase',
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
              {approved.map((a) => (
                <div
                  key={a.uid}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid #EFEBE0' }}
                >
                  <span style={{ flex: '0 0 40px' }}>
                    {a.approvedPhotoUrl || a.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Cloudinary URL, not our own image pipeline.
                      <img
                        src={a.approvedPhotoUrl ?? a.photoUrl ?? undefined}
                        alt=""
                        style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <span style={{ width: 32, height: 32, borderRadius: '50%', display: 'block', background: '#F4F1EA' }} />
                    )}
                  </span>
                  <span style={{ flex: '1.4 1 0', font: '500 13px var(--oc-font-heading), sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.lastName} {a.firstName}
                  </span>
                  <span style={{ flex: '1.4 1 0', font: '400 12px var(--oc-font-heading), sans-serif', color: '#4C473C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.email || '—'}
                  </span>
                  <span style={{ flex: '.8 1 0', font: '400 12px var(--oc-font-heading), sans-serif', color: '#4C473C' }}>
                    {a.citizenship || '—'}
                  </span>
                  <span style={{ flex: '.9 1 0', font: '400 11px var(--oc-font-mono), monospace', color: '#8A8474' }}>
                    {fmtDate(a.reviewedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
