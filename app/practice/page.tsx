'use client';

// Self-entry Practice Log — a logged-in athlete records their own daily Ao5.
// Guard pattern mirrors app/profile/page.tsx: useAuth() + `?redirect=` bounce
// through /login (not a `returnTo` param — this codebase's login page reads
// `redirect`, see app/login/page.tsx).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { getAthlete } from '@/lib/firebase/services/athletes';
import { getPracticeStreak } from '@/lib/firebase/services/practiceSessions';
import { useLang } from '@/lib/i18n';
import PracticeEntryPanel from '@/components/practice/PracticeEntryPanel';
import PracticeComparisonWidget from '@/components/practice/PracticeComparisonWidget';
import PracticeLeaderboardWidget from '@/components/practice/PracticeLeaderboardWidget';
import type { PracticeSession } from '@/lib/types/practice';

export default function PracticePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t } = useLang();

  const [athleteName, setAthleteName] = useState<string | null>(null);
  const [athleteLoading, setAthleteLoading] = useState(true);

  // Lifted from PracticeEntryPanel so the comparison + leaderboard widgets
  // below it can track "which event is active" and "did a save just
  // happen" without duplicating the event picker.
  const [activeEvent, setActiveEvent] = useState('');
  const [todaySession, setTodaySession] = useState<PracticeSession | null>(null);
  const [currentStreak, setCurrentStreak] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?redirect=/practice');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user?.athleteId) {
      setAthleteName(null);
      setAthleteLoading(false);
      return;
    }
    let cancelled = false;
    setAthleteLoading(true);
    getAthlete(user.athleteId)
      .then((a) => {
        if (cancelled) return;
        setAthleteName(a ? `${a.name}${a.lastName ? ' ' + a.lastName : ''}` : null);
      })
      .catch(() => { if (!cancelled) setAthleteName(null); })
      .finally(() => { if (!cancelled) setAthleteLoading(false); });
    return () => { cancelled = true; };
  }, [user?.athleteId]);

  // Cross-event streak — re-fetched whenever today's session changes (a new
  // save can extend the streak by one).
  useEffect(() => {
    if (!user?.athleteId) { setCurrentStreak(0); return; }
    let cancelled = false;
    getPracticeStreak(user.athleteId)
      .then((s) => { if (!cancelled) setCurrentStreak(s.currentStreak); })
      .catch(() => { if (!cancelled) setCurrentStreak(0); });
    return () => { cancelled = true; };
  }, [user?.athleteId, todaySession?.id]);

  if (loading || !user) {
    return (
      <div style={{ minHeight: 'calc(100vh - 60px)', background: 'var(--bg)' }} />
    );
  }

  return (
    <div style={{
      minHeight: 'calc(100vh - 60px)',
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: '1.5rem 1rem',
    }}>
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <h1 style={{
            fontSize: '1.5rem', fontWeight: 800, margin: 0,
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            {t('practice.page-title')}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.3rem' }}>
            {t('practice.page-subtitle')}
          </p>
          {currentStreak > 0 && (
            <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fbbf24', marginTop: '0.5rem' }}>
              🔥 {currentStreak} {t('practice.streak.days-suffix')}
            </p>
          )}
        </div>

        {athleteLoading ? null : !user.athleteId || !athleteName ? (
          <div className="card">
            <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.8rem' }}>
              {t('practice.not-linked')}
            </div>
            <Link href="/profile" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.88rem', textDecoration: 'none' }}>
              {t('practice.not-linked-cta')} →
            </Link>
          </div>
        ) : (
          <>
            <PracticeEntryPanel
              athleteId={user.athleteId}
              athleteName={athleteName}
              mode="self"
              onEventChange={(e) => { setActiveEvent(e); setTodaySession(null); }}
              onTodayChange={setTodaySession}
            />
            {activeEvent && todaySession && (
              <PracticeComparisonWidget
                athleteId={user.athleteId}
                event={activeEvent}
                todayId={todaySession.id}
              />
            )}
            {activeEvent && (
              <PracticeLeaderboardWidget event={activeEvent} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
