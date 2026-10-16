'use client';

// /timer/challenge — hub (docs/challenge-plan.md, phases 2–3).
//   Student: join a room by code; my rooms with status, and under each
//   room my assigned challenges (phase 3: waiting for the coach to start).
//   Coach (admin or coaches/{uid}): my rooms + create room.
// My memberships and my assignments are live while the hub is open (an
// approval or a new assignment shows at once: one read per document on
// open, then one per change); the coach's room list is a one-time read.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { fetchIsCoach } from '@/lib/firebase/services/coaches';
import {
  createRoom, fetchCoachRooms, joinRoomByCode, roomsErrorText, subscribeMyMemberships,
} from '@/lib/firebase/services/rooms';
import { ASSIGNMENT_STATUS_TEXT, subscribeMyAssignments } from '@/lib/firebase/services/challengeAssignments';
import { previewSentence } from '@/lib/challenge';
import {
  ROOM_CODE_LENGTH, ROOM_NAME_MAX, isRoomCode, normalizeRoomCode,
  type ChallengeAssignment, type MemberStatus, type Room, type RoomMember,
} from '@/lib/types/challenge';
import {
  Button, Card, MONO, Muted, Note, PageShell, Row, StatusChip, T, TextInput,
} from '@/components/timer/challenge/ui';
import SignInPrompt from '@/components/timer/challenge/SignInPrompt';

const STATUS_TEXT: Record<MemberStatus, string> = {
  pending: 'Хүлээгдэж байна',
  active: 'Нэгдсэн',
  removed: 'Хасагдсан',
};

type JoinMsg =
  | { kind: 'sent' | 'already'; roomId: string; roomName: string }
  | { kind: 'error'; text: string };

export default function ChallengeHubPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isCoach, setIsCoach] = useState(false);
  const [coachRooms, setCoachRooms] = useState<Room[] | null>(null);
  const [memberships, setMemberships] = useState<RoomMember[] | null>(null);
  const [assignments, setAssignments] = useState<ChallengeAssignment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  // 'sent' shows only while that membership is still pending: once the
  // coach approves (or rejects), the live list changes and it disappears.
  const [joinMsg, setJoinMsg] = useState<JoinMsg | null>(null);
  const [joining, setJoining] = useState(false);

  const [roomName, setRoomName] = useState('');
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadCoach = useCallback(async () => {
    if (!user) return;
    try {
      const coach = await fetchIsCoach(user);
      setIsCoach(coach);
      setCoachRooms(coach ? await fetchCoachRooms(user.uid) : []);
    } catch (e) {
      console.error('[challenge] coach rooms', e);
      setLoadError('Мэдээлэл ачаалж чадсангүй.');
    }
  }, [user]);

  useEffect(() => { loadCoach(); }, [loadCoach]);

  useEffect(() => {
    if (!user) return;
    const fail = (what: string) => (err: Error) => {
      console.error(`[challenge] ${what}`, err);
      setLoadError('Мэдээлэл ачаалж чадсангүй.');
    };
    const unsubMembers = subscribeMyMemberships(user.uid, setMemberships, fail('memberships'));
    const unsubAssignments = subscribeMyAssignments(user.uid, setAssignments, fail('assignments'));
    return () => { unsubMembers(); unsubAssignments(); };
  }, [user]);

  const assignmentsByRoom = useMemo(() => {
    const m = new Map<string, ChallengeAssignment[]>();
    for (const a of assignments) m.set(a.roomId, [...(m.get(a.roomId) ?? []), a]);
    return m;
  }, [assignments]);

  const joinNote = (() => {
    if (!joinMsg) return null;
    if (joinMsg.kind === 'error') return <Note text={joinMsg.text} tone="danger" />;
    const status = memberships?.find(m => m.roomId === joinMsg.roomId)?.status;
    if (joinMsg.kind === 'already' || status === 'active') return <Note text={`Та «${joinMsg.roomName}» өрөөнд нэгдсэн байна.`} />;
    if (status && status !== 'pending') return null;
    return <Note text={`«${joinMsg.roomName}» өрөөнд хүсэлт илгээлээ. Багш баталгаажуулахыг хүлээнэ үү.`} tone="success" />;
  })();

  const onJoin = async () => {
    const c = normalizeRoomCode(code);
    if (!isRoomCode(c)) { setJoinMsg({ kind: 'error', text: 'Код буруу байна. 6 тэмдэгт оруулна уу.' }); return; }
    setJoining(true); setJoinMsg(null);
    try {
      const r = await joinRoomByCode(c);
      setJoinMsg({ kind: r.status === 'active' ? 'already' : 'sent', roomId: r.roomId, roomName: r.roomName });
      setCode('');
    } catch (e) {
      setJoinMsg({ kind: 'error', text: roomsErrorText(e) });
    } finally {
      setJoining(false);
    }
  };

  const onCreate = async () => {
    const name = roomName.trim();
    if (!name) { setCreateMsg('Өрөөний нэр оруулна уу.'); return; }
    setCreating(true); setCreateMsg(null);
    try {
      const r = await createRoom(name);
      router.push(`/timer/challenge/rooms/${r.roomId}`);
    } catch (e) {
      setCreateMsg(roomsErrorText(e));
      setCreating(false);
    }
  };

  return (
    <PageShell title="Challenge" back={{ href: '/timer', label: 'Timer' }}>
      {loading ? (
        <Muted>Уншиж байна…</Muted>
      ) : !user ? (
        <SignInPrompt />
      ) : (
        <>
          {loadError && <Note text={loadError} tone="danger" />}

          {/* ── Student: join + my rooms (+ my challenges) ── */}
          <Card title="Өрөөнд нэгдэх" testId="join-card">
            <Note text="Багшийн өгсөн 6 тэмдэгттэй кодыг оруулна уу." />
            <form
              onSubmit={e => { e.preventDefault(); onJoin(); }}
              style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
            >
              <TextInput
                id="room-code" label="Өрөөний код" mono placeholder="ABC234"
                maxLength={ROOM_CODE_LENGTH + 2}
                value={code} onChange={v => setCode(normalizeRoomCode(v).slice(0, ROOM_CODE_LENGTH))}
              />
              <Button type="submit" disabled={joining || code.length !== ROOM_CODE_LENGTH}>Нэгдэх</Button>
            </form>
            {joinNote}
          </Card>

          <Card title="Миний өрөөнүүд" testId="my-rooms">
            {memberships === null ? <Muted>Уншиж байна…</Muted>
              : memberships.length === 0 ? <Muted>Та одоогоор ямар ч өрөөнд нэгдээгүй байна.</Muted>
              : memberships.map(m => (
                <div key={m.roomId} data-testid={`membership-${m.roomId}`}>
                  <Row>
                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.roomName}</div>
                      <Muted>Багш: {m.coachName}</Muted>
                    </div>
                    <StatusChip
                      text={STATUS_TEXT[m.status]}
                      tone={m.status === 'active' ? 'text' : m.status === 'removed' ? 'dim' : 'muted'}
                    />
                  </Row>
                  {(assignmentsByRoom.get(m.roomId) ?? []).map(a => <MyAssignment key={a.id} a={a} />)}
                </div>
              ))}
          </Card>

          {/* ── Coach: my rooms + create ── */}
          {isCoach && (
            <Card title="Миний удирддаг өрөөнүүд" testId="coach-rooms">
              {coachRooms === null ? <Muted>Уншиж байна…</Muted>
                : coachRooms.length === 0 ? <Muted>Одоогоор өрөө үүсгээгүй байна.</Muted>
                : coachRooms.map(r => (
                  <Row key={r.id} testId={`coach-room-${r.id}`}>
                    <Link href={`/timer/challenge/rooms/${r.id}`} style={{ flex: '1 1 auto', minWidth: 0, color: T.text, textDecoration: 'none' }}>
                      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <span style={{ fontFamily: MONO, color: T.muted, fontSize: '0.8rem', letterSpacing: '0.12em' }}>{r.code}</span>
                    </Link>
                    <Link href={`/timer/challenge/rooms/${r.id}`} style={{ color: T.muted, fontSize: '0.8rem', textDecoration: 'none' }}>Удирдах</Link>
                  </Row>
                ))}
              <form
                onSubmit={e => { e.preventDefault(); onCreate(); }}
                style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.3rem' }}
              >
                <TextInput id="room-name" label="Шинэ өрөөний нэр" placeholder="Шинэ өрөөний нэр"
                  maxLength={ROOM_NAME_MAX} value={roomName} onChange={setRoomName} />
                <Button type="submit" disabled={creating || !roomName.trim()}>Өрөө үүсгэх</Button>
              </form>
              {createMsg && <Note text={createMsg} tone="danger" />}
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}

/** One of my assigned challenges, under its room. In phase 3 the coach
 *  starts it in class (phase 4), so the student only waits. */
function MyAssignment({ a }: { a: ChallengeAssignment }) {
  return (
    <div data-testid={`my-assignment-${a.challengeId}`} style={{
      margin: '0 0 0.55rem 0.2rem', padding: '0.55rem 0.7rem', borderRadius: 8, background: T.cardAlt,
      display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: '0.88rem', flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.template.title}</span>
        <StatusChip text={ASSIGNMENT_STATUS_TEXT[a.status]} tone={a.status === 'completed' ? 'text' : 'muted'} />
      </div>
      <span data-testid="my-assignment-sentence" style={{ fontSize: '0.86rem' }}>{previewSentence(a.template)}</span>
      {a.template.note && <Muted>{a.template.note}</Muted>}
      {a.status === 'assigned' && <Muted>Багш эхлүүлэхийг хүлээнэ үү</Muted>}
    </div>
  );
}
