'use client';

// /timer/challenge/rooms/[roomId]/students/[uid] (docs/challenge-plan.md,
// phase 5). Coach: one student's challenges in this room, each with its
// status and summary numbers; tap one for its sessions. A removed student
// is hidden (decision 24): their membership and assignments can't be read.
// One-time reads: 1 membership + that student's assignments here.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { previewSentence } from '@/lib/challenge';
import { fetchMyMembership } from '@/lib/firebase/services/rooms';
import { ASSIGNMENT_STATUS_TEXT } from '@/lib/firebase/services/challengeAssignments';
import { fetchStudentAssignments } from '@/lib/firebase/services/challengeHistory';
import type { ChallengeAssignment, RoomMember } from '@/lib/types/challenge';
import { Avatar, Card, Muted, Note, PageShell, StatusChip, T } from '@/components/timer/challenge/ui';
import { Stats, summaryItems } from '@/components/timer/challenge/History';
import SignInPrompt from '@/components/timer/challenge/SignInPrompt';

export default function StudentPage() {
  const params = useParams<{ roomId: string; uid: string }>();
  const roomId = typeof params?.roomId === 'string' ? params.roomId : '';
  const uid = typeof params?.uid === 'string' ? params.uid : '';
  const back = { href: `/timer/challenge/rooms/${roomId}`, label: 'Өрөө' };
  const { user, loading } = useAuth();
  const [data, setData] = useState<{ member: RoomMember; rows: ChallengeAssignment[] } | null | undefined>(undefined);

  useEffect(() => {
    if (!user || !roomId || !uid) return;
    let cancelled = false;
    (async () => {
      // The coach can't read a removed (or unknown) student's membership.
      const member = await fetchMyMembership(roomId, uid).catch(() => null);
      const ok = member && member.status !== 'removed';
      const rows = ok ? await fetchStudentAssignments(roomId, user.uid, uid).catch(() => null) : null;
      if (!cancelled) setData(ok && rows ? { member, rows } : null);
    })();
    return () => { cancelled = true; };
  }, [user, roomId, uid]);

  if (loading || (user && data === undefined)) return <PageShell title="Сурагч" back={back}><Muted>Уншиж байна…</Muted></PageShell>;
  if (!user) return <PageShell title="Сурагч" back={back}><SignInPrompt /></PageShell>;
  if (!data) {
    return (
      <PageShell title="Сурагч" back={back}>
        <Card testId="student-missing"><Note text="Сурагч олдсонгүй эсвэл хандах эрхгүй байна." /></Card>
      </PageShell>
    );
  }

  const { member, rows } = data;
  return (
    <PageShell title={member.displayName} back={{ ...back, label: member.roomName || 'Өрөө' }}>
      <Card testId="student-challenges" title={`Challenge-үүд (${rows.length})`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
          <Avatar name={member.displayName} url={member.photoURL} />
          <Muted>{member.status === 'pending' ? 'Хүсэлт хүлээгдэж байна' : 'Өрөөний сурагч'}</Muted>
        </div>
        {rows.length === 0 ? <Muted>Одоогоор оноосон challenge алга.</Muted> : rows.map(a => (
          <Link key={a.id} href={`/timer/challenge/history/${a.id}`} data-testid={`student-assignment-${a.challengeId}`} style={{
            display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.6rem 0', minWidth: 0,
            borderTop: `1px solid ${T.border}`, color: T.text, textDecoration: 'none',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
              <span style={{ flex: '1 1 auto', minWidth: 0, fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.template.title}</span>
              <StatusChip text={ASSIGNMENT_STATUS_TEXT[a.status]} tone={a.status === 'completed' ? 'text' : 'muted'} />
            </span>
            <span style={{ fontSize: '0.84rem' }}>{previewSentence(a.template)}</span>
            <Stats items={summaryItems(a)} />
          </Link>
        ))}
      </Card>
    </PageShell>
  );
}
