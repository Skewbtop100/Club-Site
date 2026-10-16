'use client';

// Coach live view (docs/challenge-plan.md decision 13, phase 4b) — on the
// room page, one row per running session, updated as the student confirms
// solves: event + metric, block progress, streak, last block result, solve
// count, end time, and a flag for solves the sanity checks refused (tap to
// see time + reason). A student who completes while the page is open moves
// to "Биелсэн" at once.
//
// Data: the room's running sessions and assignments arrive from listeners
// owned by CoachChallenges (both stop when the coach leaves the page).
import { useState } from 'react';
import { METRIC_LABEL, METRIC_N, challengeEvent, formatTarget } from '@/lib/challenge';
import { ubClock } from '@/lib/challenge-progress';
import type { LiveSession } from '@/lib/firebase/services/challengeSessions';
import type { ChallengeAssignment, RoomMember } from '@/lib/types/challenge';
import { Avatar, Card, Muted, StatusChip, T } from './ui';

const REASON_TEXT = { 'too-fast': 'хэт хурдан', 'too-close': 'хэт ойрхон' } as const;

export default function CoachLiveView({ sessions, completed, members, now }: {
  sessions: LiveSession[];
  /** Assignments completed since the page opened. */
  completed: ChallengeAssignment[];
  members: RoomMember[] | null;
  now: number;
}) {
  // An expired session nobody closed yet (no action, cron not run) is not running.
  const running = sessions.filter(s => s.endsAt > now);
  const nameOf = (uid: string) => members?.find(m => m.uid === uid)?.displayName ?? '';
  const photoOf = (uid: string) => members?.find(m => m.uid === uid)?.photoURL ?? null;
  if (running.length === 0 && completed.length === 0) return null;
  return (
    <Card title={`Шууд хяналт (${running.length})`} testId="live-view">
      {running
        .slice()
        .sort((a, b) => nameOf(a.studentUid).localeCompare(nameOf(b.studentUid)))
        .map(s => <LiveRow key={s.id} s={s} name={nameOf(s.studentUid)} photo={photoOf(s.studentUid)} />)}
      {completed.map(a => (
        <div key={a.id} data-testid={`live-done-${a.studentUid}`} style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', borderTop: `1px solid ${T.border}`,
        }}>
          <Avatar name={nameOf(a.studentUid) || a.studentName} url={photoOf(a.studentUid)} size={28} />
          <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: '0.88rem' }}>{nameOf(a.studentUid) || a.studentName}</span>
          <span style={{ fontSize: '0.8rem', color: T.success, fontWeight: 600 }}>✅ Биелсэн</span>
          <Muted>{a.template.title}</Muted>
        </div>
      ))}
    </Card>
  );
}

function LiveRow({ s, name, photo }: { s: LiveSession; name: string; photo: string | null }) {
  const [showFlags, setShowFlags] = useState(false);
  const n = METRIC_N[s.template.metric];
  const inBlock = s.solvesCount - s.blocks.length * n;
  const m = s.template.streak;
  const streak = Math.min(s.currentStreak, m);
  const last = s.blocks.length ? s.blocks[s.blocks.length - 1] : null;
  const ev = challengeEvent(s.template.event);
  return (
    <div data-testid={`live-${s.studentUid}`} style={{
      display: 'flex', flexDirection: 'column', gap: '0.35rem', padding: '0.55rem 0', borderTop: `1px solid ${T.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
        <Avatar name={name} url={photo} size={28} />
        <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: '0.9rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {s.flags.length > 0 && (
          <button type="button" data-testid="live-flag" onClick={() => setShowFlags(v => !v)}
            aria-label={`Татгалзсан эвлүүлэлт: ${s.flags.length}`} aria-expanded={showFlags}
            style={{
              background: showFlags ? T.cardAlt : 'transparent', border: `1px solid ${T.border}`, borderRadius: 8,
              color: T.danger, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.75rem', padding: '0.15rem 0.45rem',
            }}>⚑ {s.flags.length}</button>
        )}
        <StatusChip text={`${ubClock(s.endsAt)} хүртэл`} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap', paddingLeft: 'calc(28px + 0.6rem)', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: T.muted }}>{ev?.short ?? s.template.event} · {METRIC_LABEL[s.template.metric]}</span>
        {n > 1 && <span data-testid="live-block">{inBlock}/{n}</span>}
        <span data-testid="live-streak" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          {m <= 10 ? (
            <span aria-hidden="true" style={{ letterSpacing: '0.12em' }}>
              {'●'.repeat(streak)}<span style={{ color: T.borderHi }}>{'○'.repeat(m - streak)}</span>
            </span>
          ) : (
            <span aria-hidden="true" style={{ width: 70, height: 5, borderRadius: 3, background: T.cardAlt, overflow: 'hidden', display: 'inline-block' }}>
              <span style={{ display: 'block', height: '100%', width: `${(100 * streak) / m}%`, background: T.text }} />
            </span>
          )}
          <span style={{ color: T.muted }}>{streak}/{m}</span>
        </span>
        <span data-testid="live-last" style={{ color: last ? (last.pass ? T.success : T.danger) : T.muted }}>
          {last ? `${last.displayCs === null ? 'DNF' : formatTarget(last.displayCs * 10)} ${last.pass ? '✓' : '✗'}` : '—'}
        </span>
        <span data-testid="live-count" style={{ color: T.muted }}>{s.solvesCount} эвлүүлэлт</span>
      </div>
      {showFlags && (
        <div data-testid="live-flags" style={{
          marginLeft: 'calc(28px + 0.6rem)', background: T.cardAlt, borderRadius: 8, padding: '0.45rem 0.6rem',
          display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums',
        }}>
          {s.flags.map((f, i) => (
            <span key={i}>
              <span style={{ color: T.muted }}>{ubClock(f.at)}</span>{' '}
              {formatTarget(Math.floor(f.ms / 10) * 10)} · {REASON_TEXT[f.reason] ?? f.reason}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
