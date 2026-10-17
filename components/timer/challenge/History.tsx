'use client';

// Challenge history (docs/challenge-plan.md, phase 5) — the parts shared by
// the student's and the coach's pages: the summary of one assignment, its
// session list (one-time reads, 10 per page, "Цааш үзэх"), and a session's
// blocks with their solves (already in the session doc: no extra read).
import { useCallback, useEffect, useState } from 'react';
import { appNow } from '@/lib/clock';
import { previewSentence } from '@/lib/challenge';
import { ubClock, ubDate } from '@/lib/challenge-progress';
import {
  END_REASON_TEXT, blockText, endReason, sessionBlocks, shownEndMs, solveText,
} from '@/lib/challenge-history';
import { ASSIGNMENT_STATUS_TEXT } from '@/lib/firebase/services/challengeAssignments';
import {
  fetchSessionsPage, type SessionsCursor,
} from '@/lib/firebase/services/challengeHistory';
import type { ChallengeAssignment, ChallengeSessionRecord, SessionSolve } from '@/lib/types/challenge';
import { Button, Card, Muted, Note, StatusChip, T } from './ui';

const dateOf = (ms: number | null) => (ms == null ? '—' : ubDate(ms));

/** Label / value tiles; wraps to two or three columns at 360px. */
export function Stats({ items, testId }: { items: [string, string | number][]; testId?: string }) {
  return (
    <div data-testid={testId} style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(6.4rem, 1fr))', gap: '0.4rem',
    }}>
      {items.map(([label, value]) => (
        <div key={label} data-stat={label} style={{ background: T.cardAlt, borderRadius: 8, padding: '0.4rem 0.55rem', minWidth: 0 }}>
          <div style={{ color: T.muted, fontSize: '0.7rem' }}>{label}</div>
          <div style={{ fontSize: '0.92rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

/** The A8 numbers of one assignment. Blocks and best streak are rolled up
 *  when a session closes, so a running session isn't in them yet. */
export function summaryItems(a: ChallengeAssignment): [string, string | number][] {
  return [
    ['Анх эхэлсэн', dateOf(a.firstStartedAt)],
    ['Биелсэн', dateOf(a.completedAt)],
    ['Зарцуулсан', a.daysTaken == null ? '—' : `${a.daysTaken} өдөр`],
    ['Session', a.sessionsCount],
    ['Нийт блок', a.blocksAttempted],
    ['Хамгийн их дараалал', a.bestStreak],
  ];
}

export function AssignmentSummary({ a, who }: { a: ChallengeAssignment; who?: string }) {
  return (
    <Card testId="history-summary">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', minWidth: 0 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {who && <Muted>{who}</Muted>}
          <span data-testid="history-sentence" style={{ fontSize: '0.98rem', fontWeight: 600, lineHeight: 1.35 }}>
            {previewSentence(a.template)}
          </span>
        </div>
        <span data-testid="history-status">
          <StatusChip text={ASSIGNMENT_STATUS_TEXT[a.status]} tone={a.status === 'completed' ? 'text' : 'muted'} />
        </span>
      </div>
      {a.template.note && <Muted>{a.template.note}</Muted>}
      <Stats testId="history-stats" items={summaryItems(a)} />
    </Card>
  );
}

/** The session list of one assignment, newest first, 10 per page. */
export function SessionList({ a, viewer }: { a: ChallengeAssignment; viewer: 'student' | 'coach' }) {
  const [rows, setRows] = useState<ChallengeSessionRecord[] | null>(null);
  const [next, setNext] = useState<SessionsCursor>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [now] = useState(() => appNow());

  const load = useCallback(async (after: SessionsCursor) => {
    setBusy(true); setError(null);
    try {
      const page = await fetchSessionsPage(a, viewer, after);
      setRows(prev => [...(after ? prev ?? [] : []), ...page.rows]);
      setNext(page.next);
    } catch (e) {
      console.error('[history] sessions', e);
      setError('Session-уудыг ачаалж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }, [a, viewer]);

  useEffect(() => { load(null); }, [load]);

  return (
    <Card title="Session-ууд" testId="history-sessions">
      {error && <Note text={error} tone="danger" />}
      {rows === null ? (!error && <Muted>Уншиж байна…</Muted>)
        : rows.length === 0 ? <Muted>Одоогоор session алга.</Muted>
        : rows.map(s => (
          <SessionRow key={s.id} s={s} now={now} open={open === s.id} onToggle={() => setOpen(o => (o === s.id ? null : s.id))} />
        ))}
      {next && (
        <div><Button disabled={busy} onClick={() => load(next)}>{busy ? 'Уншиж байна…' : 'Цааш үзэх'}</Button></div>
      )}
    </Card>
  );
}

function SessionRow({ s, now, open, onToggle }: {
  s: ChallengeSessionRecord; now: number; open: boolean; onToggle: () => void;
}) {
  const reason = endReason(s, now);
  const end = shownEndMs(s, now);
  return (
    <div data-testid="session-row" data-session-id={s.id} style={{ borderTop: `1px solid ${T.border}`, minWidth: 0 }}>
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        style={{
          width: '100%', background: 'transparent', border: 'none', color: T.text, cursor: 'pointer',
          padding: '0.55rem 0', textAlign: 'left', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: '0.2rem',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', minWidth: 0 }}>
          <span data-testid="session-when" style={{ fontSize: '0.88rem', fontWeight: 500, flex: '1 1 auto' }}>
            {s.ubDate} · {ubClock(s.startedAt)}–{end == null ? `${ubClock(s.endsAt)} хүртэл` : ubClock(end)}
          </span>
          <span data-testid="session-reason"><StatusChip text={END_REASON_TEXT[reason]} tone={reason === 'completed' ? 'text' : 'muted'} /></span>
        </span>
        <span data-testid="session-numbers" style={{ color: T.muted, fontSize: '0.78rem' }}>
          {s.blocksAttempted} блок · хамгийн их дараалал {s.bestStreak} · {s.solves.length} эвлүүлэлт
        </span>
      </button>
      {open && <SessionDetail s={s} running={reason === 'running'} />}
    </div>
  );
}

function SessionDetail({ s, running }: { s: ChallengeSessionRecord; running: boolean }) {
  const { blocks, leftover } = sessionBlocks(s);
  return (
    <div data-testid="session-detail" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingBottom: '0.6rem' }}>
      {blocks.length === 0 && leftover.length === 0 && <Muted>Эвлүүлэлт алга.</Muted>}
      {blocks.map(b => (
        <BlockBox key={b.index} testId="history-block" title={`${b.index}-р блок`}
          result={blockText(s.template.metric, b)} pass={b.pass} solves={b.solves} />
      ))}
      {leftover.length > 0 && (
        <BlockBox testId="history-leftover" solves={leftover}
          title={running ? 'Одоогийн блок' : 'Дуусаагүй блок · тооцогдоогүй'} />
      )}
    </div>
  );
}

function BlockBox({ title, result, pass, solves, testId }: {
  title: string; result?: string; pass?: boolean; solves: SessionSolve[]; testId: string;
}) {
  const comments = solves.filter(x => x.comment);
  return (
    <div data-testid={testId} style={{
      background: T.cardAlt, borderRadius: 8, padding: '0.45rem 0.6rem',
      display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ color: T.muted, fontSize: '0.75rem' }}>{title}</span>
        {result && (
          <span data-testid="block-result" style={{ fontWeight: 600, fontSize: '0.88rem', color: pass ? T.success : T.text }}>{result}</span>
        )}
      </div>
      <div data-testid="block-solves" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.7rem', fontSize: '0.84rem', fontVariantNumeric: 'tabular-nums' }}>
        {solves.map(x => (
          <span key={x.seq}>
            <span style={{ color: T.dim, fontSize: '0.7rem' }}>{x.seq}. </span>
            <span style={{ color: x.penalty === 'none' ? T.text : T.danger }}>{solveText(x)}</span>
          </span>
        ))}
      </div>
      {comments.map(x => (
        <div key={x.seq} data-testid="solve-comment" style={{ fontSize: '0.78rem', color: T.muted, overflowWrap: 'anywhere' }}>
          {x.seq}. {x.comment}
        </div>
      ))}
    </div>
  );
}
