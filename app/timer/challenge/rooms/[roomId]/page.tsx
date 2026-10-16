'use client';

// /timer/challenge/rooms/[roomId] (docs/challenge-plan.md, phases 2–3).
//   Coach of the room: code (copy / regenerate), rename, pending requests
//   (approve / reject), members (remove), and challenges (create, assign,
//   edit until started, duplicate, delete — components/timer/challenge/
//   CoachChallenges.tsx). Members are live while this page is open;
//   everything else is a one-time read.
//   Anyone else: their own status in the room, or "not found".
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  decideMember, fetchMyMembership, fetchRoom, regenerateRoomCode, renameRoom,
  roomsErrorText, subscribeRoomMembers,
} from '@/lib/firebase/services/rooms';
import { ROOM_NAME_MAX, type MemberAction, type Room, type RoomMember } from '@/lib/types/challenge';
import {
  Avatar, Button, Card, MONO, Muted, Note, PageShell, Row, StatusChip, T, TextInput,
} from '@/components/timer/challenge/ui';
import SignInPrompt from '@/components/timer/challenge/SignInPrompt';
import CoachChallenges from '@/components/timer/challenge/CoachChallenges';

const BACK = { href: '/timer/challenge', label: 'Challenge' };

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = typeof params?.roomId === 'string' ? params.roomId : '';
  const { user, loading } = useAuth();

  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [myMembership, setMyMembership] = useState<RoomMember | null>(null);

  useEffect(() => {
    if (!user || !roomId) return;
    let cancelled = false;
    (async () => {
      // A room this account may not read (not its coach, not a pending or
      // active member) is a permission error — shown as "not found".
      const r = await fetchRoom(roomId).catch(() => null);
      if (cancelled) return;
      setRoom(r);
      if (!r || r.coachUid !== user.uid) {
        const m = await fetchMyMembership(roomId, user.uid).catch(() => null);
        if (!cancelled) setMyMembership(m);
      }
    })();
    return () => { cancelled = true; };
  }, [user, roomId]);

  if (loading) return <PageShell title="Өрөө" back={BACK}><Muted>Уншиж байна…</Muted></PageShell>;
  if (!user) return <PageShell title="Өрөө" back={BACK}><SignInPrompt /></PageShell>;
  if (room === undefined) return <PageShell title="Өрөө" back={BACK}><Muted>Уншиж байна…</Muted></PageShell>;

  if (!room || room.coachUid !== user.uid) {
    const name = room?.name ?? myMembership?.roomName ?? 'Өрөө';
    return (
      <PageShell title={name} back={BACK}>
        <Card testId="room-student-view">
          {myMembership ? (
            <>
              <Muted>Багш: {myMembership.coachName}</Muted>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Muted>Таны төлөв:</Muted>
                <StatusChip
                  text={myMembership.status === 'active' ? 'Нэгдсэн' : myMembership.status === 'pending' ? 'Хүлээгдэж байна' : 'Хасагдсан'}
                  tone={myMembership.status === 'active' ? 'text' : 'muted'}
                />
              </div>
            </>
          ) : (
            <Note text="Өрөө олдсонгүй эсвэл хандах эрхгүй байна." />
          )}
        </Card>
      </PageShell>
    );
  }

  return <CoachRoomView room={room} onRoomChange={setRoom} />;
}

function CoachRoomView({ room, onRoomChange }: { room: Room; onRoomChange: (r: Room) => void }) {
  const [members, setMembers] = useState<RoomMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(room.name);

  useEffect(() => subscribeRoomMembers(
    room.id,
    setMembers,
    (err) => { console.error('[room] members', err); setError('Гишүүдийг ачаалж чадсангүй.'); },
  ), [room.id]);

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null); setInfo(null);
    try { await fn(); } catch (e) { setError(roomsErrorText(e)); } finally { setBusy(null); }
  }, []);

  const act = (uid: string, action: MemberAction) => run(`${action}:${uid}`, async () => {
    await decideMember(room.id, uid, action);
    setConfirmRemove(null);
  });

  const pending = (members ?? []).filter(m => m.status === 'pending');
  const active = (members ?? []).filter(m => m.status === 'active');

  return (
    <PageShell title={room.name} back={BACK}>
      {error && <Note text={error} tone="danger" />}
      {info && <Note text={info} tone="success" />}

      <Card title="Өрөөний код" testId="room-code-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span data-testid="room-code" style={{ fontFamily: MONO, fontSize: '1.9rem', fontWeight: 700, letterSpacing: '0.18em' }}>{room.code}</span>
          <Button onClick={() => run('copy', async () => {
            await navigator.clipboard.writeText(room.code);
            setInfo('Код хуулагдлаа.');
          })}>Хуулах</Button>
          {!confirmRegen ? (
            <Button kind="plain" onClick={() => setConfirmRegen(true)}>Шинэ код</Button>
          ) : (
            <>
              <Button disabled={busy === 'regen'} onClick={() => run('regen', async () => {
                const r = await regenerateRoomCode(room.id);
                onRoomChange({ ...room, code: r.code });
                setConfirmRegen(false);
                setInfo('Шинэ код үүслээ. Хуучин код ажиллахаа болилоо.');
              })}>Тийм, шинэ код</Button>
              <Button kind="plain" onClick={() => setConfirmRegen(false)}>Болих</Button>
            </>
          )}
        </div>
        {confirmRegen && <Note text="Хуучин код ажиллахаа болино. Нэгдсэн сурагчид хэвээр үлдэнэ." />}
        <Note text="Сурагчид энэ кодыг Challenge → «Өрөөнд нэгдэх» хэсэгт оруулна." />
      </Card>

      <Card title="Өрөөний нэр">
        {!editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>{room.name}</span>
            <Button kind="plain" onClick={() => { setNameDraft(room.name); setEditing(true); }}>Нэр солих</Button>
          </div>
        ) : (
          <form
            onSubmit={e => {
              e.preventDefault();
              run('rename', async () => {
                const r = await renameRoom(room.id, nameDraft);
                onRoomChange({ ...room, name: r.name });
                setEditing(false);
              });
            }}
            style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
          >
            <TextInput id="rename" label="Өрөөний нэр" maxLength={ROOM_NAME_MAX} value={nameDraft} onChange={setNameDraft} />
            <Button type="submit" disabled={busy === 'rename' || !nameDraft.trim()}>Хадгалах</Button>
            <Button kind="plain" onClick={() => setEditing(false)}>Болих</Button>
          </form>
        )}
      </Card>

      <Card title={`Хүсэлтүүд (${pending.length})`} testId="pending-card">
        {members === null ? <Muted>Уншиж байна…</Muted>
          : pending.length === 0 ? <Muted>Шинэ хүсэлт алга.</Muted>
          : pending.map(m => (
            <Row key={m.uid} testId={`pending-${m.uid}`}>
              <Avatar name={m.displayName} url={m.photoURL} />
              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.displayName}</span>
              <Button disabled={busy !== null} onClick={() => act(m.uid, 'approve')}>Зөвшөөрөх</Button>
              <Button kind="plain" disabled={busy !== null} onClick={() => act(m.uid, 'reject')}>Татгалзах</Button>
            </Row>
          ))}
      </Card>

      <Card title={`Сурагчид (${active.length})`} testId="members-card">
        {members === null ? <Muted>Уншиж байна…</Muted>
          : active.length === 0 ? <Muted>Одоогоор сурагч алга.</Muted>
          : active.map(m => (
            <Row key={m.uid} testId={`member-${m.uid}`}>
              <Avatar name={m.displayName} url={m.photoURL} />
              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.displayName}</span>
              {confirmRemove === m.uid ? (
                <>
                  <Button kind="danger" disabled={busy !== null} onClick={() => act(m.uid, 'remove')}>Тийм, хасах</Button>
                  <Button kind="plain" onClick={() => setConfirmRemove(null)}>Болих</Button>
                </>
              ) : (
                <Button kind="plain" onClick={() => setConfirmRemove(m.uid)}>Хасах</Button>
              )}
            </Row>
          ))}
        <Note text="Хасагдсан сурагчийн түүх хадгалагдана. Дахин нэмэхийн тулд сурагч кодоор дахин хүсэлт илгээж, та зөвшөөрнө." />
      </Card>

      <CoachChallenges roomId={room.id} coachUid={room.coachUid} members={members} />

      <span style={{ color: T.dim, fontSize: '0.75rem' }}>Багш: {room.coachName}</span>
    </PageShell>
  );
}
