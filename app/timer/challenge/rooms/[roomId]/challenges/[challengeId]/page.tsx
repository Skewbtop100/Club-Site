'use client';

// /timer/challenge/rooms/[roomId]/challenges/[challengeId] (docs/
// challenge-plan.md, phase 5). Coach: how every student is doing on one
// challenge — status, days taken, sessions, best streak. Completed students
// on top, earliest completion first (lib/challenge-history.ts sortOverview).
// Removed students are not listed (visibleToCoach, decision 24).
// One-time reads: 1 challenge + its visible assignments.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { previewSentence } from '@/lib/challenge';
import { ubDate } from '@/lib/challenge-progress';
import { sortOverview } from '@/lib/challenge-history';
import { ASSIGNMENT_STATUS_TEXT } from '@/lib/firebase/services/challengeAssignments';
import { fetchChallengeOverview } from '@/lib/firebase/services/challengeHistory';
import type { Challenge, ChallengeAssignment } from '@/lib/types/challenge';
import { Card, Muted, Note, PageShell, StatusChip, T } from '@/components/timer/challenge/ui';
import SignInPrompt from '@/components/timer/challenge/SignInPrompt';

export default function ChallengeOverviewPage() {
  const params = useParams<{ roomId: string; challengeId: string }>();
  const roomId = typeof params?.roomId === 'string' ? params.roomId : '';
  const challengeId = typeof params?.challengeId === 'string' ? params.challengeId : '';
  const back = { href: `/timer/challenge/rooms/${roomId}`, label: 'Өрөө' };
  const { user, loading } = useAuth();
  const [data, setData] = useState<{ challenge: Challenge; rows: ChallengeAssignment[] } | null | undefined>(undefined);

  useEffect(() => {
    if (!user || !challengeId) return;
    let cancelled = false;
    fetchChallengeOverview(challengeId, user.uid)
      .catch(() => null)
      .then(r => { if (!cancelled) setData(r && r.challenge.roomId === roomId ? { ...r, rows: sortOverview(r.rows) } : null); });
    return () => { cancelled = true; };
  }, [user, roomId, challengeId]);

  if (loading || (user && data === undefined)) return <PageShell title="Challenge" back={back}><Muted>Уншиж байна…</Muted></PageShell>;
  if (!user) return <PageShell title="Challenge" back={back}><SignInPrompt /></PageShell>;
  if (!data) {
    return (
      <PageShell title="Challenge" back={back}>
        <Card testId="overview-missing"><Note text="Challenge олдсонгүй эсвэл хандах эрхгүй байна." /></Card>
      </PageShell>
    );
  }

  const { challenge: c, rows } = data;
  const done = rows.filter(a => a.status === 'completed').length;
  return (
    <PageShell title={c.title} back={back}>
      <Card testId="overview-card" title={`Сурагчид · ${done}/${rows.length} биелсэн`}>
        <span data-testid="overview-sentence" style={{ fontSize: '0.9rem' }}>{previewSentence(c)}</span>
        {rows.length === 0 ? <Muted>Одоогоор хэнд ч оноогоогүй.</Muted> : rows.map(a => (
          <Link key={a.id} href={`/timer/challenge/history/${a.id}`} data-testid="overview-row" data-student={a.studentUid} style={{
            display: 'flex', flexDirection: 'column', gap: '0.2rem', padding: '0.55rem 0', minWidth: 0,
            borderTop: `1px solid ${T.border}`, color: T.text, textDecoration: 'none',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
              <span data-testid="overview-name" style={{ flex: '1 1 auto', minWidth: 0, fontSize: '0.88rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.studentName}</span>
              <StatusChip text={ASSIGNMENT_STATUS_TEXT[a.status]} tone={a.status === 'completed' ? 'text' : 'muted'} />
            </span>
            <span data-testid="overview-numbers" style={{ color: T.muted, fontSize: '0.78rem' }}>
              {a.status === 'completed' ? `${ubDate(a.completedAt ?? 0)} · ${a.daysTaken ?? '—'} өдөр` : 'Зарцуулсан —'}
              {' · '}{a.sessionsCount} session · хамгийн их дараалал {a.bestStreak}
            </span>
          </Link>
        ))}
      </Card>
    </PageShell>
  );
}
