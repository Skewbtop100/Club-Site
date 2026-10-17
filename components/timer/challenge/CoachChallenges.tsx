'use client';

// Coach room page → "Challenge-үүд" (docs/challenge-plan.md, phases 3–4b).
//   Create from the template [event] + [metric] + [< target] + [M in a row]
//   with a live Mongolian preview; assign to one or many active members;
//   unassign before start; edit / delete until the first start (locked),
//   after that only "Хуулбарлах". Per student: "Эхлүүлэх" with an end time
//   (today, ≤ 23:59, ≥ 10 min ahead) and "Зогсоох" while it runs.
// Every write is a server route. Reads (4b): the room's assignments and its
// running sessions are LIVE while this page is open (the live view, a
// start, an end or a completion show at once, no refresh button); the
// challenge list itself only changes through the coach's own actions, so it
// is a one-time read, re-read after each action. Both listeners stop when
// the coach leaves the page. The member list comes live from the room page.
import { appNow } from '@/lib/clock';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHALLENGE_EVENTS, METRICS, METRIC_LABEL, NOTE_MAX, STREAK_MAX, STREAK_MIN, TITLE_MAX,
  defaultTitle, formatTarget, isDefaultTitle, parseTargetTime, previewSentence,
} from '@/lib/challenge';
import {
  assignChallenge, challengeErrorText, createChallenge, deleteChallenge, duplicateChallenge,
  fetchRoomChallenges, unassignChallenge, updateChallenge, type TemplateInput,
} from '@/lib/firebase/services/challenges';
import { ASSIGNMENT_STATUS_TEXT, subscribeRoomAssignments } from '@/lib/firebase/services/challengeAssignments';
import {
  endChallengeSession, startChallengeSession, subscribeRoomLiveSessions, type LiveSession,
} from '@/lib/firebase/services/challengeSessions';
import CoachLiveView from './CoachLiveView';
import { END_LATEST_MIN, ubClock, ubTimeToday, validateEndsAt } from '@/lib/challenge-progress';
import type { Challenge, ChallengeAssignment, ChallengeMetric, RoomMember } from '@/lib/types/challenge';
import {
  Avatar, Button, Card, Checkbox, Field, Muted, Note, Row, Select, StatusChip, T, TextInput,
} from './ui';

const EVENT_OPTIONS = CHALLENGE_EVENTS.map(e => ({ value: e.id, label: e.name }));
const METRIC_OPTIONS = METRICS.map(m => ({ value: m, label: METRIC_LABEL[m] }));

export default function CoachChallenges({ roomId, coachUid, members }: {
  roomId: string; coachUid: string; members: RoomMember[] | null;
}) {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [assignments, setAssignments] = useState<ChallengeAssignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [sessions, setSessions] = useState<LiveSession[]>([]);
  // Re-render every 15 s so "running until HH:MM" turns off on its own.
  const [now, setNow] = useState(() => appNow());
  useEffect(() => {
    const id = window.setInterval(() => setNow(appNow()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const openedAt = useRef(appNow());

  const reload = useCallback(async () => {
    setChallenges(await fetchRoomChallenges(roomId, coachUid));
  }, [roomId, coachUid]);

  useEffect(() => {
    reload().catch((e) => { console.error('[room] challenges', e); setError('Challenge-үүдийг ачаалж чадсангүй.'); });
  }, [reload]);

  // Live: assignments (start / end / completion) and running sessions (every
  // confirmed solve). Unsubscribed when the page unmounts.
  useEffect(() => {
    const fail = (what: string) => (e: Error) => { console.error(`[room] ${what}`, e); setError('Шууд мэдээлэл ачаалж чадсангүй.'); };
    const offA = subscribeRoomAssignments(roomId, coachUid, (rows) => { setAssignments(rows); setNow(appNow()); }, fail('assignments'));
    const offS = subscribeRoomLiveSessions(roomId, coachUid, (rows) => { setSessions(rows); setNow(appNow()); }, fail('sessions'));
    return () => { offA(); offS(); };
  }, [roomId, coachUid]);

  const justCompleted = useMemo(
    () => assignments.filter(a => a.status === 'completed' && (a.completedAt ?? 0) >= openedAt.current - 60_000),
    [assignments],
  );

  const run = useCallback(async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key); setError(null); setInfo(null);
    try {
      const msg = await fn();
      await reload();
      if (msg) setInfo(msg);
    } catch (e) {
      setError(challengeErrorText(e));
    } finally {
      setBusy(null);
    }
  }, [reload]);

  const active = useMemo(() => (members ?? []).filter(m => m.status === 'active'), [members]);

  return (
    <>
    <CoachLiveView sessions={sessions} completed={justCompleted} members={members} now={now} />
    <Card title={`Challenge-үүд (${challenges?.length ?? 0})`} testId="challenges-card">
      {error && <Note text={error} tone="danger" />}
      {info && <Note text={info} tone="success" />}

      {creating ? (
        <ChallengeForm
          submitLabel="Үүсгэх" busy={busy === 'create'}
          onCancel={() => setCreating(false)}
          onSubmit={(t) => run('create', async () => {
            await createChallenge(roomId, t);
            setCreating(false);
            return 'Challenge үүслээ. Одоо сурагчдад оноогоорой.';
          })}
        />
      ) : (
        <div><Button onClick={() => { setCreating(true); setEditingId(null); }}>Шинэ challenge</Button></div>
      )}

      {challenges === null ? <Muted>Уншиж байна…</Muted>
        : challenges.length === 0 ? <Muted>Одоогоор challenge алга.</Muted>
        : challenges.map(c => editingId === c.id ? (
          <div key={c.id} data-testid={`challenge-edit-${c.id}`} style={{ borderTop: `1px solid ${T.border}`, paddingTop: '0.7rem' }}>
            <ChallengeForm
              initial={c} submitLabel="Хадгалах" busy={busy === `edit:${c.id}`}
              onCancel={() => setEditingId(null)}
              onSubmit={(t) => run(`edit:${c.id}`, async () => {
                await updateChallenge(c.id, t);
                setEditingId(null);
                return 'Хадгалагдлаа.';
              })}
            />
          </div>
        ) : (
          <ChallengeItem
            key={c.id} challenge={c} busy={busy} now={now}
            assignments={assignments.filter(a => a.challengeId === c.id)}
            activeMembers={active}
            onEdit={() => { setEditingId(c.id); setCreating(false); }}
            onDuplicate={() => run(`dup:${c.id}`, async () => {
              const r = await duplicateChallenge(c.id);
              setEditingId(r.challengeId);
              setCreating(false);
              return 'Хуулбар үүслээ. Засаад хадгална уу.';
            })}
            onDelete={() => run(`del:${c.id}`, async () => { await deleteChallenge(c.id); return 'Устгагдлаа.'; })}
            onAssign={(uids) => run(`assign:${c.id}`, async () => {
              const r = await assignChallenge(c.id, uids);
              return `${r.assigned.length} сурагчид оноолоо.`;
            })}
            onUnassign={(uid) => run(`unassign:${c.id}:${uid}`, async () => { await unassignChallenge(c.id, uid); })}
            onStart={(a, endsAt) => run(`start:${a.id}`, async () => {
              const r = await startChallengeSession(a.id, endsAt);
              return `${a.studentName}: эхэллээ (${ubClock(r.endsAt)} хүртэл).`;
            })}
            onStop={(a) => run(`stop:${a.id}`, async () => {
              if (a.activeSessionId) await endChallengeSession(a.activeSessionId);
              return `${a.studentName}: зогслоо.`;
            })}
          />
        ))}
    </Card>
    </>
  );
}

// ── Create / edit form ──────────────────────────────────────────────────

function ChallengeForm({ initial, submitLabel, busy, onSubmit, onCancel }: {
  initial?: Challenge; submitLabel: string; busy: boolean;
  onSubmit: (t: TemplateInput) => void; onCancel: () => void;
}) {
  const [event, setEvent] = useState(initial?.event ?? '333');
  const [metric, setMetric] = useState<ChallengeMetric>(initial?.metric ?? 'ao5');
  const [target, setTarget] = useState(initial ? formatTarget(initial.targetMs) : '');
  const [streak, setStreak] = useState(initial ? String(initial.streak) : '');
  // An auto title stays empty here so it keeps following the template.
  const [title, setTitle] = useState(initial && !isDefaultTitle(initial) ? initial.title : '');
  const [note, setNote] = useState(initial?.note ?? '');

  const targetMs = parseTargetTime(target);
  const m = /^\d{1,3}$/.test(streak.trim()) ? Number(streak.trim()) : NaN;
  const streakOk = Number.isInteger(m) && m >= STREAK_MIN && m <= STREAK_MAX;
  const valid = targetMs !== null && streakOk;
  const core = valid ? { event, metric, targetMs: targetMs!, streak: m } : null;

  const hint = target.trim() && targetMs === null ? 'Зорилтот цаг буруу. Жишээ: 2.00 эсвэл 1:05.30'
    : streak.trim() && !streakOk ? `Дараалан: ${STREAK_MIN}–${STREAK_MAX} бүхэл тоо`
    : null;

  return (
    <form
      data-testid="challenge-form"
      onSubmit={e => { e.preventDefault(); if (core) onSubmit({ ...core, title, note }); }}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}
    >
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Field caption="Төрөл" htmlFor="ch-event">
          <Select id="ch-event" label="Төрөл" value={event} onChange={setEvent} options={EVENT_OPTIONS} />
        </Field>
        <Field caption="Хэмжүүр" htmlFor="ch-metric">
          <Select id="ch-metric" label="Хэмжүүр" value={metric} onChange={setMetric} options={METRIC_OPTIONS} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Field caption="Зорилт: < (цаг)" htmlFor="ch-target">
          <TextInput id="ch-target" label="Зорилтот цаг" inputMode="decimal" placeholder="2.00" maxLength={9}
            value={target} onChange={setTarget} />
        </Field>
        <Field caption="Дараалан (удаа)" htmlFor="ch-streak">
          <TextInput id="ch-streak" label="Дараалан хэдэн удаа" inputMode="numeric" placeholder="5" maxLength={3}
            value={streak} onChange={v => setStreak(v.replace(/[^\d]/g, ''))} />
        </Field>
      </div>
      <div style={{ display: 'flex' }}>
        <Field caption="Гарчиг (заавал биш)" htmlFor="ch-title">
          <TextInput id="ch-title" label="Гарчиг" maxLength={TITLE_MAX}
            placeholder={core ? defaultTitle(core) : 'Автоматаар үүснэ'} value={title} onChange={setTitle} />
        </Field>
      </div>
      <div style={{ display: 'flex' }}>
        <Field caption="Тэмдэглэл (заавал биш)" htmlFor="ch-note">
          <TextInput id="ch-note" label="Тэмдэглэл" maxLength={NOTE_MAX} placeholder="Сурагчдад харагдана"
            value={note} onChange={setNote} />
        </Field>
      </div>

      <div data-testid="challenge-preview" style={{
        background: T.cardAlt, borderRadius: 8, padding: '0.6rem 0.75rem',
        fontSize: '0.92rem', color: core ? T.text : T.muted,
      }}>
        {core ? previewSentence(core) : 'Зорилтот цаг болон дараалах тоог оруулахад энд харагдана.'}
      </div>
      {hint && <Note text={hint} tone="danger" />}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Button type="submit" disabled={!valid || busy}>{submitLabel}</Button>
        <Button kind="plain" onClick={onCancel}>Болих</Button>
      </div>
    </form>
  );
}

// ── One challenge ───────────────────────────────────────────────────────

function ChallengeItem({
  challenge: c, assignments, activeMembers, busy, now,
  onEdit, onDuplicate, onDelete, onAssign, onUnassign, onStart, onStop,
}: {
  challenge: Challenge; assignments: ChallengeAssignment[]; activeMembers: RoomMember[]; busy: string | null; now: number;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
  onAssign: (uids: string[]) => void; onUnassign: (uid: string) => void;
  onStart: (a: ChallengeAssignment, endsAt: number) => void; onStop: (a: ChallengeAssignment) => void;
}) {
  const [startingId, setStartingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const assigned = new Set(assignments.map(a => a.studentUid));
  const candidates = activeMembers.filter(m => !assigned.has(m.uid));
  const nameOf = (uid: string, fallback: string) => activeMembers.find(m => m.uid === uid)?.displayName || fallback;
  const photoOf = (uid: string) => activeMembers.find(m => m.uid === uid)?.photoURL ?? null;
  const toggle = (uid: string, on: boolean) => setPicked(p => {
    const n = new Set(p);
    if (on) n.add(uid); else n.delete(uid);
    return n;
  });

  return (
    <div data-testid={`challenge-${c.id}`} style={{
      borderTop: `1px solid ${T.border}`, paddingTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
        <Link href={`/timer/challenge/rooms/${c.roomId}/challenges/${c.id}`} data-testid={`challenge-overview-${c.id}`}
          style={{ fontWeight: 600, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.text, textDecoration: 'none' }}>{c.title}</Link>
        {c.locked && <StatusChip text="Эхэлсэн · түгжигдсэн" />}
      </div>
      <div data-testid="challenge-sentence" style={{ fontSize: '0.88rem' }}>{previewSentence(c)}</div>
      {c.note && <Muted>{c.note}</Muted>}

      {assignments.length === 0 ? <Muted>Одоогоор хэнд ч оноогоогүй.</Muted>
        : assignments
          .slice()
          .sort((a, b) => nameOf(a.studentUid, a.studentName).localeCompare(nameOf(b.studentUid, b.studentName)))
          .map(a => {
            const canUnassign = a.status === 'assigned' && a.firstStartedAt === null;
            const running = isRunning(a, now);
            const canStart = !running && (a.status === 'assigned' || a.status === 'in-progress');
            return (
              <div key={a.id} data-testid={`assignment-${a.studentUid}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0, flexWrap: 'wrap' }}>
                  <Avatar name={nameOf(a.studentUid, a.studentName)} url={photoOf(a.studentUid)} size={24} />
                  <span style={{ flex: '1 1 6rem', minWidth: 0, fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nameOf(a.studentUid, a.studentName)}
                  </span>
                  <StatusChip text={ASSIGNMENT_STATUS_TEXT[a.status]} tone={a.status === 'completed' ? 'text' : 'muted'} />
                  {running && <Muted>{ubClock(a.activeEndsAt!)} хүртэл</Muted>}
                  {a.status === 'completed' && a.daysTaken != null && <Muted>{a.daysTaken} өдөр</Muted>}
                  {running && (
                    <Button kind="danger" disabled={busy !== null} onClick={() => onStop(a)}
                      ariaLabel={`${nameOf(a.studentUid, a.studentName)}-ийн session зогсоох`}>Зогсоох</Button>
                  )}
                  {canStart && startingId !== a.id && (
                    <Button disabled={busy !== null} onClick={() => setStartingId(a.id)}
                      ariaLabel={`${nameOf(a.studentUid, a.studentName)}-д эхлүүлэх`}>Эхлүүлэх</Button>
                  )}
                  {canUnassign && (
                    <Button kind="plain" disabled={busy !== null} onClick={() => onUnassign(a.studentUid)}
                      ariaLabel={`${nameOf(a.studentUid, a.studentName)}-г хасах`}>Хасах</Button>
                  )}
                </div>
                {startingId === a.id && (
                  <StartPanel
                    busy={busy !== null}
                    onCancel={() => setStartingId(null)}
                    onStart={(endsAt) => { setStartingId(null); onStart(a, endsAt); }}
                  />
                )}
              </div>
            );
          })}

      {assigning && (
        <div data-testid="assign-panel" style={{ background: T.cardAlt, borderRadius: 8, padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {candidates.length === 0 ? <Muted>Оноох боломжтой идэвхтэй сурагч алга.</Muted> : (
            <>
              <Checkbox
                label="Бүгдийг сонгох" testId="assign-all"
                checked={picked.size === candidates.length}
                onChange={on => setPicked(on ? new Set(candidates.map(m => m.uid)) : new Set())}
              />
              {candidates.map(m => (
                <Checkbox key={m.uid} testId={`assign-pick-${m.uid}`} label={m.displayName}
                  checked={picked.has(m.uid)} onChange={on => toggle(m.uid, on)} />
              ))}
            </>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.3rem' }}>
            <Button disabled={picked.size === 0 || busy !== null} onClick={() => {
              onAssign([...picked]);
              setPicked(new Set());
              setAssigning(false);
            }}>{`Оноох (${picked.size})`}</Button>
            <Button kind="plain" onClick={() => { setAssigning(false); setPicked(new Set()); }}>Болих</Button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
        {!assigning && <Button onClick={() => setAssigning(true)}>Оноох</Button>}
        {!c.locked && <Button kind="plain" disabled={busy !== null} onClick={onEdit}>Засах</Button>}
        <Button kind="plain" disabled={busy !== null} onClick={onDuplicate}>Хуулбарлах</Button>
        {!c.locked && (confirmDelete ? (
          <>
            <Button kind="danger" disabled={busy !== null} onClick={() => { setConfirmDelete(false); onDelete(); }}>Тийм, устгах</Button>
            <Button kind="plain" onClick={() => setConfirmDelete(false)}>Болих</Button>
          </>
        ) : (
          <Button kind="plain" onClick={() => setConfirmDelete(true)}>Устгах</Button>
        ))}
      </div>
      {c.locked && <Note text="Эхэлсэн challenge-ийг засах, устгах боломжгүй. Өөрчлөх бол «Хуулбарлах»." />}
    </div>
  );
}

/** A session is running while it has a pointer and its end time is ahead
 *  (an expired one is closed on the server at the next action). */
function isRunning(a: ChallengeAssignment, now: number): boolean {
  return a.activeSessionId != null && a.activeEndsAt != null && a.activeEndsAt > now;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "Эхлүүлэх": pick the end time — today in Ulaanbaatar, at the latest 23:59,
 *  at least 10 minutes from now (decision 16, N2). Default 23:59. */
function StartPanel({ busy, onStart, onCancel }: {
  busy: boolean; onStart: (endsAt: number) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(`${pad(Math.floor(END_LATEST_MIN / 60))}:${pad(END_LATEST_MIN % 60)}`);
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  const endsAt = m ? ubTimeToday(appNow(), Number(m[1]), Number(m[2])) : NaN;
  const check = validateEndsAt(appNow(), Number.isFinite(endsAt) ? endsAt : 'bad');
  const hint = 'error' in check
    ? (check.error === 'end-too-soon' ? 'Одооноос дор хаяж 10 минутын дараа байх ёстой.'
      : check.error === 'end-too-late' ? 'Хамгийн оройдоо 23:59.' : 'Цагаа шалгана уу.')
    : null;
  return (
    <div data-testid="start-panel" style={{
      background: T.cardAlt, borderRadius: 8, padding: '0.55rem 0.7rem',
      display: 'flex', flexDirection: 'column', gap: '0.45rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <label htmlFor="ch-end-time" style={{ fontSize: '0.8rem', color: T.muted }}>Дуусах цаг (өнөөдөр)</label>
        <input
          id="ch-end-time" type="time" aria-label="Дуусах цаг" value={value}
          onChange={e => setValue(e.target.value)}
          style={{
            background: T.bg, color: T.text, colorScheme: 'dark',
            border: `1px solid ${T.borderHi}`, borderRadius: 8, padding: '0.35rem 0.5rem',
            fontFamily: 'inherit', fontSize: '0.9rem',
          }}
        />
      </div>
      {hint && <Note text={hint} tone="danger" />}
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <Button disabled={busy || hint !== null} onClick={() => onStart(endsAt)}>Эхлүүлэх</Button>
        <Button kind="plain" onClick={onCancel}>Болих</Button>
      </div>
    </div>
  );
}
