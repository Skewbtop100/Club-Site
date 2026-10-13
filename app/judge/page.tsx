'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { subscribeCompetitions, subscribeScrambleSets } from '@/lib/firebase/services/competitions';
import { judgeLogin, currentJudgeSession, judgeSignOut } from '@/lib/firebase/services/judge-access';
import { useLang } from '@/lib/i18n';
import type { Competition } from '@/lib/types';

// The same entry panel the admin uses, locked to the judge's competition.
const ResultsEntryTab = dynamic(() => import('@/components/admin/ResultsEntryTab'), { ssr: false });
// The public live-results viewer, embedded: exactly what any visitor sees.
const CompetitionResultsViewer = dynamic(() => import('@/components/shared/CompetitionResultsViewer'), { ssr: false });

type JudgeTab = 'entry' | 'live';
const TAB_KEY = 'judgeTab';

function readSavedTab(): JudgeTab {
  try { return window.localStorage.getItem(TAB_KEY) === 'live' ? 'live' : 'entry'; } catch { return 'entry'; }
}

// ── /judge ────────────────────────────────────────────────────────────────
//
// Per-competition judge access by PIN — no Google account, no admin rights.
// The PIN is checked on the server (app/api/judge/login), which answers a
// correct one with a Firebase custom token whose claims
// { role: 'judge', competitionId, pinVersion, validUntil } are what
// firestore.rules trust. This page only signs in with that token and shows
// the entry panel; it holds no secret and decides nothing about access.
//
// The session ends on its own — the rules stop honouring it — after 24
// hours, when the admin regenerates or disables the PIN, or when the
// competition is finished. The page signs out when it can tell.
export default function JudgePage() {
  const { t } = useLang();
  const [session, setSession] = useState<{ competitionId: string; validUntil: number } | null | undefined>(undefined);
  const [comps, setComps] = useState<Competition[] | null>(null);
  const [compId, setCompId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Which tab is showing, remembered on this device. The entry panel stays
  // mounted (just hidden) on the other tab, so half-entered solves survive a
  // look at the results; the viewer mounts on first visit and then stays, so
  // going back and forth doesn't re-read the whole competition each time.
  const [tab, setTab] = useState<JudgeTab>('entry');
  const [liveVisited, setLiveVisited] = useState(false);
  useEffect(() => {
    const saved = readSavedTab();
    setTab(saved);
    if (saved === 'live') setLiveVisited(true);
  }, []);
  function selectTab(next: JudgeTab) {
    setTab(next);
    if (next === 'live') setLiveVisited(true);
    try { window.localStorage.setItem(TAB_KEY, next); } catch { /* storage unavailable */ }
  }

  useEffect(() => subscribeCompetitions(setComps), []);

  // Which session this browser holds. A Google account (or nobody) is not a
  // judge session: the PIN form is shown, and signing in replaces it.
  useEffect(() => onAuthStateChanged(auth, () => {
    currentJudgeSession().then(setSession).catch(() => setSession(null));
  }), []);

  const sessionComp = session ? comps?.find(c => c.id === session.competitionId) : undefined;
  const finished = !!session && comps !== null && (!sessionComp || sessionComp.status === 'finished');

  function endSession() {
    setMsg(t('judge.session-ended'));
    judgeSignOut().catch(() => {});
  }

  // Finished competition (or one that no longer exists) → access is over.
  useEffect(() => {
    if (finished) endSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  // 24 hours are up.
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(endSession, Math.max(0, session.validUntil - Date.now()));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // PIN regenerated or disabled: the rules refuse the scrambles read a judge
  // is otherwise allowed, which is the earliest sign this page gets.
  useEffect(() => {
    if (!session || finished) return;
    return subscribeScrambleSets(session.competitionId, () => {}, (err) => {
      if ((err as { code?: string }).code === 'permission-denied') endSession();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, finished]);

  async function login() {
    if (!compId || pin.length !== 6 || busy) return;
    setBusy(true); setMsg('');
    try {
      const result = await judgeLogin(compId, pin);
      if (result.ok) {
        setPin('');
      } else if (result.reason === 'locked' || result.retryAfterMs > 0) {
        setMsg(t('judge.error.locked').replace('{min}', String(Math.max(1, Math.ceil(result.retryAfterMs / 60000)))));
      } else {
        setMsg(t(result.reason === 'invalid' ? 'judge.error.invalid' : 'judge.error.server'));
      }
    } catch {
      setMsg(t('judge.error.server'));
    } finally {
      setBusy(false);
    }
  }

  // Live competitions only — an upcoming or finished one can't be judged.
  const liveComps = (comps || []).filter(c => c.status === 'live' && !c.isDailyPractice);
  const shell: React.CSSProperties = {
    background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh',
    fontFamily: "'Segoe UI', system-ui, sans-serif", padding: '1.5rem 1rem 3rem',
  };

  if (session === undefined || comps === null) {
    return <div style={shell}><div className="spinner-row">{t('admin.loading')}<span className="spinner-ring" /></div></div>;
  }

  if (session && sessionComp && !finished) {
    return (
      <div style={shell}>
        <div style={{ maxWidth: 1380, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={{
              fontSize: '0.95rem', fontWeight: 800, letterSpacing: '0.04em',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              {t('judge.panel-title')}
            </div>
            <button className="btn-sm-secondary" onClick={() => { setMsg(''); judgeSignOut().catch(() => {}); }}>{t('judge.signout')}</button>
          </div>
          {/* Two equal tabs — full width, thumb-sized on a phone. */}
          <div role="tablist" style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
            {(['entry', 'live'] as const).map(id => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => selectTab(id)}
                style={{
                  flex: 1, minHeight: '46px', padding: '0.5rem 0.6rem', borderRadius: '10px',
                  fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer',
                  background: tab === id ? 'linear-gradient(135deg, var(--accent), var(--accent2))' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${tab === id ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
                  color: tab === id ? '#fff' : 'var(--muted)',
                }}
              >
                {t(id === 'entry' ? 'judge.tab.entry' : 'judge.tab.live')}
              </button>
            ))}
          </div>
          <div role="tabpanel" style={{ display: tab === 'entry' ? 'block' : 'none' }}>
            <ResultsEntryTab key={session.competitionId} judgeCompetitionId={session.competitionId} />
          </div>
          {liveVisited && (
            <div role="tabpanel" style={{ display: tab === 'live' ? 'block' : 'none' }}>
              <CompetitionResultsViewer key={session.competitionId} comp={sessionComp} isLive embedded />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...shell, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ maxWidth: 400, width: '100%', marginBottom: 0 }}>
        <div className="card-title"><span className="title-accent" />{t('judge.title')}</div>
        {liveComps.length === 0 ? (
          <div className="empty-state">{t('judge.no-live')}</div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); login(); }}>
            <div className="form-group">
              <label>{t('judge.competition')}</label>
              <select value={compId} onChange={e => { setCompId(e.target.value); setMsg(''); }}>
                <option value="">{t('judge.select-comp')}</option>
                {liveComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('judge.pin')}</label>
              <input
                type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6}
                value={pin} placeholder="••••••"
                onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setMsg(''); }}
                style={{ fontSize: '1.6rem', textAlign: 'center', letterSpacing: '0.4em', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
            <button type="submit" className="btn-sm-primary" disabled={!compId || pin.length !== 6 || busy} style={{ width: '100%' }}>
              {busy ? t('judge.logging-in') : t('judge.login')}
            </button>
          </form>
        )}
        {msg && <div className="msg error" style={{ display: 'block' }}>{msg}</div>}
      </div>
    </div>
  );
}
