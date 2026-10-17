'use client';

// /timer/challenge/history/[assignmentId] (docs/challenge-plan.md, phase 5).
// One assignment's history: the summary (first started, completed, days
// taken, sessions, blocks, best streak) and its sessions, newest first,
// 10 per page; tap a session for its blocks and solves.
//   Student: their own — always, also after being removed (N4).
//   Coach:   while the student is in the room (decision 24); a removed
//            student's assignment can't be read and shows "not found".
// One-time reads only: 1 assignment + 10 sessions per page.
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { fetchAssignment } from '@/lib/firebase/services/challengeHistory';
import type { ChallengeAssignment } from '@/lib/types/challenge';
import { Card, Muted, Note, PageShell } from '@/components/timer/challenge/ui';
import { AssignmentSummary, SessionList } from '@/components/timer/challenge/History';
import SignInPrompt from '@/components/timer/challenge/SignInPrompt';

const HUB = { href: '/timer/challenge', label: 'Challenge' };

export default function HistoryPage() {
  const params = useParams<{ assignmentId: string }>();
  const id = typeof params?.assignmentId === 'string' ? decodeURIComponent(params.assignmentId) : '';
  const { user, loading } = useAuth();
  const [a, setA] = useState<ChallengeAssignment | null | undefined>(undefined);

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    fetchAssignment(id).then(r => { if (!cancelled) setA(r); });
    return () => { cancelled = true; };
  }, [user, id]);

  if (loading) return <PageShell title="Түүх" back={HUB}><Muted>Уншиж байна…</Muted></PageShell>;
  if (!user) return <PageShell title="Түүх" back={HUB}><SignInPrompt /></PageShell>;
  if (a === undefined) return <PageShell title="Түүх" back={HUB}><Muted>Уншиж байна…</Muted></PageShell>;
  if (!a) {
    return (
      <PageShell title="Түүх" back={HUB}>
        <Card testId="history-missing"><Note text="Challenge олдсонгүй эсвэл хандах эрхгүй байна." /></Card>
      </PageShell>
    );
  }

  const viewer = a.studentUid === user.uid ? 'student' : 'coach';
  const back = viewer === 'student' ? HUB
    : { href: `/timer/challenge/rooms/${a.roomId}/students/${a.studentUid}`, label: a.studentName || 'Сурагч' };
  return (
    <PageShell title={a.template.title} back={back}>
      <AssignmentSummary a={a} who={viewer === 'coach' ? a.studentName : undefined} />
      <SessionList a={a} viewer={viewer} />
    </PageShell>
  );
}
