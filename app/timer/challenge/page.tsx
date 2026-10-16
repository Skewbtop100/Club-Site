'use client';

// /timer/challenge — hub (docs/challenge-plan.md, phase 2).
//   Student: join a room by code; list of my rooms with status.
//   Coach (admin or coaches/{uid}): my rooms + create room.
// Reads are one-time (plan B2: keep reads low); a refresh re-reads.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { fetchIsCoach } from '@/lib/firebase/services/coaches';
import {
  createRoom, fetchCoachRooms, fetchMyMemberships, joinRoomByCode, roomsErrorText,
} from '@/lib/firebase/services/rooms';
import {
  ROOM_CODE_LENGTH, ROOM_NAME_MAX, isRoomCode, normalizeRoomCode,
  type MemberStatus, type Room, type RoomMember,
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

export default function ChallengeHubPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isCoach, setIsCoach] = useState(false);
  const [coachRooms, setCoachRooms] = useState<Room[] | null>(null);
  const [memberships, setMemberships] = useState<RoomMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [joinMsg, setJoinMsg] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [joining, setJoining] = useState(false);

  const [roomName, setRoomName] = useState('');
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadError(null);
    try {
      const coach = await fetchIsCoach(user);
      setIsCoach(coach);
      const [rooms, mine] = await Promise.all([
        coach ? fetchCoachRooms(user.uid) : Promise.resolve([] as Room[]),
        fetchMyMemberships(user.uid),
      ]);
      setCoachRooms(rooms);
      setMemberships(mine);
    } catch (e) {
      console.error('[challenge] load', e);
      setLoadError('Мэдээлэл ачаалж чадсангүй.');
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const onJoin = async () => {
    const c = normalizeRoomCode(code);
    if (!isRoomCode(c)) { setJoinMsg({ text: 'Код буруу байна. 6 тэмдэгт оруулна уу.', tone: 'danger' }); return; }
    setJoining(true); setJoinMsg(null);
    try {
      const r = await joinRoomByCode(c);
      setJoinMsg(r.status === 'active'
        ? { text: `Та «${r.roomName}» өрөөнд аль хэдийн нэгдсэн байна.`, tone: 'success' }
        : { text: `«${r.roomName}» өрөөнд хүсэлт илгээлээ. Coach баталгаажуулахыг хүлээнэ үү.`, tone: 'success' });
      setCode('');
      await load();
    } catch (e) {
      setJoinMsg({ text: roomsErrorText(e), tone: 'danger' });
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

          {/* ── Student: join + my rooms ── */}
          <Card title="Өрөөнд нэгдэх" testId="join-card">
            <Note text="Coach-ийн өгсөн 6 тэмдэгттэй кодыг оруулна уу." />
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
            {joinMsg && <Note text={joinMsg.text} tone={joinMsg.tone} />}
          </Card>

          <Card title="Миний өрөөнүүд" testId="my-rooms">
            {memberships === null ? <Muted>Уншиж байна…</Muted>
              : memberships.length === 0 ? <Muted>Та одоогоор ямар ч өрөөнд нэгдээгүй байна.</Muted>
              : memberships.map(m => (
                <Row key={m.roomId} testId={`membership-${m.roomId}`}>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.roomName}</div>
                    <Muted>Coach: {m.coachName}</Muted>
                  </div>
                  <StatusChip
                    text={STATUS_TEXT[m.status]}
                    tone={m.status === 'active' ? 'text' : m.status === 'removed' ? 'dim' : 'muted'}
                  />
                </Row>
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

          <div>
            <Button kind="plain" onClick={load}>Шинэчлэх</Button>
          </div>
        </>
      )}
    </PageShell>
  );
}
