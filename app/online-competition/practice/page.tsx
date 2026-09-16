'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { authedFetchWithRetry } from '@/lib/online-competition/authed-fetch';
import { ONLINE_COMP_EVENTS } from '@/lib/online-competition/events';
import { resolveVideoSrc } from '@/lib/online-competition/video-source';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { PRACTICE_RUN_LIMIT } from '@/lib/online-competition/practice';
import type { PracticeListResponse } from '@/app/api/online-competition/practice/route';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import HubNav from '../_components/hub/v3/HubNav';
import AuthModal from '../_components/hub/v3/AuthModal';
import EmptyBlock from '../_components/hub/v3/EmptyBlock';

// ── ТУРШИЛТ: the athlete's own practice area ────────────────────────────
// Where an athlete goes to learn what a recorded solve asks of them,
// without a competition attached. The point of the screen is the SECOND
// half: their own runs, what an admin said about each, and the recording
// itself — practising a sequence you cannot watch back is practising blind.
//
// The allowance is READ FROM THE SERVER, never computed here. It is counted
// from the documents (practiceAllowance) because a counter an athlete could
// write would not be a limit; this page just renders the answer.

const STATUS_LABEL: Record<string, string> = {
  pending: 'ХЯНАГДАЖ БАЙНА',
  correct: 'ЗӨВ',
  incorrect: 'БУРУУ',
  redo: 'ДАХИН ИЛГЭЭХ',
};
const STATUS_TONE: Record<string, string> = {
  pending: '#DFFF4F',
  correct: '#4FD07A',
  incorrect: '#E8543C',
  redo: '#E0A020',
};

function fmtDay(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function PracticePage() {
  const { user, loading: authLoading } = useOnlineAuth();
  const signedIn = !!user && !user.isAnonymous;
  const [authOpen, setAuthOpen] = useState(false);
  const [data, setData] = useState<PracticeListResponse | null>(null);
  const [error, setError] = useState('');
  /** Which run's recording is open. One at a time: these are whole video
   *  files and mounting ten players would fetch ten of them. */
  const [playing, setPlaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await authedFetchWithRetry('/api/online-competition/practice');
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as PracticeListResponse);
    } catch (err) {
      console.error('PracticePage: loading practice runs failed:', err);
      setError('Туршилтын бичлэгүүдийг ачааллаж чадсангүй');
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setData(null);
      return;
    }
    void load();
  }, [signedIn, load]);

  return (
    <div className="oc-v3-page">
      <HubNav live={null} section={null} />

      <main className="oc-v3-main">
        <div className="oc-v3-clist">
          <div className="oc-v3-card">
            <div className="oc-v3-card-head">
              <span className="oc-v3-label">Туршилтын бичлэг</span>
              {/* The allowance, always visible — including before any run
                  has been used, so the limit is known in advance rather
                  than discovered at the tenth. */}
              {data && (
                <span className="oc-v3-season" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {data.remaining} / {data.limit} ҮЛДСЭН
                </span>
              )}
            </div>

            <div style={{ padding: '15px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ font: '400 12px/18px var(--oc-font-heading), sans-serif', color: '#C9C4B8' }}>
                Тэмцээний бичлэгтэй яг адил дараалал: цаг 0.00, холилт, ковер, эвлүүлэлт, цаг харуулах, шоо
                харуулах, цаг бичих. Энд хийсэн бичлэг хаана ч тооцогдохгүй — зөвхөн дарааллыг сурахад.
              </p>
              <p style={{ font: '400 11px/17px var(--oc-font-heading), sans-serif', color: '#6E6A62' }}>
                Админ бичлэг бүрийг шалгаж, холилтоо зөв хийсэн эсэхийг хэлнэ. Бичлэг шалгагдсанаас 7
                хоногийн дараа, шалгагдаагүй бол хийснээс 30 хоногийн дараа автоматаар устна.
              </p>
            </div>
          </div>

          {authLoading ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : !signedIn ? (
            <div className="oc-v3-card">
              <div className="oc-v3-empty">
                <p className="oc-v3-empty-text">Туршилтын бичлэг хийхийн тулд нэвтэрнэ үү.</p>
                <button type="button" className="oc-v3-signin" onClick={() => setAuthOpen(true)}>
                  Нэвтрэх
                </button>
              </div>
              <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
            </div>
          ) : error ? (
            <p className="oc-v3-status oc-v3-status-error">{error}</p>
          ) : data === null ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : (
            <>
              {/* ── START ONE ── */}
              <div className="oc-v3-card">
                <div className="oc-v3-card-head">
                  <span className="oc-v3-label">Шинэ туршилт</span>
                </div>
                {data.remaining === 0 ? (
                  /* SAID PLAINLY, not hidden. A missing button is the thing
                     this whole feature exists to stop an athlete meeting. */
                  <div style={{ padding: '15px 18px' }}>
                    <p style={{ font: '500 12px var(--oc-font-heading), sans-serif', color: '#E8543C' }}>
                      Туршилтын {PRACTICE_RUN_LIMIT} бичлэг бүгд ашиглагдсан.
                    </p>
                    <p style={{ marginTop: 6, font: '400 11px/17px var(--oc-font-heading), sans-serif', color: '#6E6A62' }}>
                      Доорх бичлэгүүдээ дахин үзэж болно. Нэмэлт бичлэг хэрэгтэй бол зохион байгуулагчтай
                      холбогдоно уу.
                    </p>
                  </div>
                ) : (
                  <div className="oc-practice-events">
                    {ONLINE_COMP_EVENTS.map((e) => (
                      <Link key={e.id} href={`/online-competition/practice/${e.id}`} className="oc-practice-event">
                        <span className="oc-practice-event-icon" aria-hidden>
                          {hasWcaEventIcon(e.id) ? <WcaEventIcon eventId={e.id} size={18} /> : e.id.toUpperCase()}
                        </span>
                        {e.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* ── THEIR OWN RUNS ── */}
              <div className="oc-v3-card">
                <div className="oc-v3-card-head">
                  <span className="oc-v3-label">Миний туршилтууд</span>
                  <span className="oc-v3-count-badge">{data.runs.length}</span>
                </div>

                {data.runs.length === 0 ? (
                  <EmptyBlock text="Одоогоор туршилтын бичлэг алга." />
                ) : (
                  data.runs.map((r) => {
                    const src = resolveVideoSrc({ videoKey: r.videoKey });
                    const open = playing === r.id;
                    return (
                      <div key={r.id} className="oc-practice-row">
                        <div className="oc-practice-row-head">
                          <span className="oc-practice-row-event">{r.event.toUpperCase()}</span>
                          <span className="oc-practice-row-time">
                            {r.isDnf ? 'DNF' : r.timeCs !== null ? fmtCentiseconds(r.timeCs) : 'цаг бичээгүй'}
                          </span>
                          <span className="oc-practice-row-date">{fmtDay(r.createdAtMs)}</span>
                          <span style={{ flex: 1 }} />
                          <span
                            className="oc-practice-row-status"
                            style={{ color: STATUS_TONE[r.status] ?? '#9A958A' }}
                          >
                            {STATUS_LABEL[r.status] ?? r.status.toUpperCase()}
                          </span>
                        </div>

                        {/* THE REASON, when there is one. The athlete cannot
                            fix what they are not told. */}
                        {r.status === 'incorrect' && r.reason && (
                          <p className="oc-practice-row-reason">{r.reason}</p>
                        )}
                        {r.status === 'redo' && (
                          <p className="oc-practice-row-reason">
                            Админ дахин бичлэг хийхийг хүссэн. Энэ бичлэг таны 10-д тооцогдохгүй.
                          </p>
                        )}

                        <div className="oc-practice-row-foot">
                          {src === null ? (
                            <span className="oc-practice-row-gone">Бичлэг устсан</span>
                          ) : (
                            <button
                              type="button"
                              className="oc-practice-watch"
                              aria-expanded={open}
                              onClick={() => setPlaying(open ? null : r.id)}
                            >
                              {open ? 'ХААХ' : 'БИЧЛЭГ ҮЗЭХ'}
                            </button>
                          )}
                          {r.expiresAtMs !== null && (
                            <span className="oc-practice-row-expiry">{fmtDay(r.expiresAtMs)}-нд устна</span>
                          )}
                        </div>

                        {/* Mounted only when opened — one video file at a
                            time, not ten. */}
                        {open && src !== null && (
                          <video
                            className="oc-practice-video"
                            src={src}
                            controls
                            playsInline
                            preload="metadata"
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
