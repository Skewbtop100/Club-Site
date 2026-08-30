'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import type { OnlineSubmissionAdminView, OnlineSubmissionPenalty, OnlineSubmissionStatus } from '@/lib/online-competition/types';
import { Badge, EmptyState, type BadgeSpec } from '../../_components/ui';

type Filter = OnlineSubmissionStatus | 'all';
type ReviewAction = 'approve' | 'approve_plus2' | 'dnf';
type JudgeTone = 'ok' | 'warn' | 'dnf';

// Exact literal colors from the approved mockup for "pending" and
// "approved" — not derived from the --color-* token block (see theme.css's
// top comment for why). "+2"/"rejected" weren't respecified this round;
// they reuse the exact literal values already established for --color-warn
// /--color-dnf, just written out verbatim instead of via var().
function submissionBadge(status: OnlineSubmissionStatus, penalty: OnlineSubmissionPenalty): BadgeSpec {
  if (status === 'pending') {
    return { borderColor: '#E08A00', background: 'transparent', color: '#B36E00', dotColor: '#E08A00' };
  }
  if (status === 'rejected') {
    return { borderColor: '#D8402C', background: '#FDE8E4', color: '#B22E1D' };
  }
  if (penalty === '+2') {
    return { borderColor: '#E08A00', background: '#FFF3DB', color: '#8A5400' };
  }
  return { borderColor: '#2E9E5B', background: '#E9F6EE', color: '#2E9E5B' };
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', label: 'Хүлээгдэж буй' },
  { value: 'approved', label: 'Батлагдсан' },
  { value: 'rejected', label: 'Татгалзсан' },
  { value: 'all', label: 'Бүгд' },
];

const STATUS_LABEL: Record<OnlineSubmissionStatus, string> = {
  pending: 'Хүлээгдэж буй',
  approved: 'Батлагдсан',
  rejected: 'Татгалзсан',
};

// ── Shape-coded judge actions ────────────────────────────────────────────
// Approve/+2/DNF are told apart by shape as well as color: a circle
// (approve), a square badge (+2 penalty), and a diamond (DNF/reject).

const JUDGE_TONE_COLOR: Record<JudgeTone, string> = {
  ok: 'var(--color-ok)',
  warn: 'var(--color-warn)',
  dnf: 'var(--color-dnf)',
};
const JUDGE_TONE_BG: Record<JudgeTone, string> = {
  ok: 'var(--color-ok-bg)',
  warn: 'var(--color-warn-bg)',
  dnf: 'var(--color-dnf-bg)',
};
const JUDGE_HOVER_CLASS: Record<JudgeTone, string> = {
  ok: 'hover:border-[var(--color-ok)] hover:bg-[var(--color-ok-bg)]',
  warn: 'hover:border-[var(--color-warn)] hover:bg-[var(--color-warn-bg)]',
  dnf: 'hover:border-[var(--color-dnf)] hover:bg-[var(--color-dnf-bg)]',
};

function ShapeMarker({ tone }: { tone: JudgeTone }) {
  const color = JUDGE_TONE_COLOR[tone];
  if (tone === 'ok') {
    return (
      <span
        aria-hidden
        className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[10px] font-bold"
        style={{ borderRadius: '50%', border: `1.5px solid ${color}`, color }}
      >
        ✓
      </span>
    );
  }
  if (tone === 'warn') {
    return (
      <span
        aria-hidden
        className="inline-block h-[17px] w-[17px] shrink-0"
        style={{ borderRadius: 2, border: `1.5px solid ${color}`, background: JUDGE_TONE_BG.warn }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-[15px] w-[15px] shrink-0"
      style={{ border: `1.5px solid ${color}`, background: JUDGE_TONE_BG.dnf, transform: 'rotate(45deg)' }}
    />
  );
}

function JudgeActionButton({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone: JudgeTone;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex w-full items-center justify-center gap-2 border border-[var(--color-border)] text-sm font-medium text-[var(--color-ink-soft)] transition disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)] ${JUDGE_HOVER_CLASS[tone]}`}
      style={{ borderRadius: 2, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}
    >
      <ShapeMarker tone={tone} />
      {children}
    </button>
  );
}

export default function ReviewDashboard() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [submissions, setSubmissions] = useState<OnlineSubmissionAdminView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const load = useCallback(async (status: Filter) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/online-competition/submissions?status=${status}`);
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { submissions: OnlineSubmissionAdminView[] };
      setSubmissions(data.submissions);
    } catch {
      setError('Илгээмжүүдийг ачааллаж чадсангүй');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const handleAction = useCallback(
    async (submissionId: string, action: ReviewAction) => {
      setActionLoadingId(submissionId);
      try {
        const res = await fetch('/api/online-competition/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionId, action }),
        });
        if (!res.ok) throw new Error('failed');

        const update =
          action === 'dnf'
            ? { status: 'rejected' as const, penalty: 'DNF' as const }
            : action === 'approve_plus2'
              ? { status: 'approved' as const, penalty: '+2' as const }
              : { status: 'approved' as const, penalty: null };

        setSubmissions((prev) =>
          filter === 'all'
            ? prev.map((s) => (s.id === submissionId ? { ...s, ...update } : s))
            : prev.filter((s) => s.id !== submissionId),
        );
      } catch {
        setError('Шийдвэрийг хадгалж чадсангүй, дахин оролдоно уу');
      } finally {
        setActionLoadingId(null);
      }
    },
    [filter],
  );

  return (
    <div>
      <div
        className="flex flex-wrap gap-1"
        style={{ borderBottom: '1px solid var(--color-border)', marginBottom: 24 }}
      >
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)] ${
              filter === f.value
                ? 'text-[var(--color-ink)]'
                : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)]'
            }`}
            style={{
              borderBottom: filter === f.value ? '2px solid var(--color-ink)' : '2px solid transparent',
              marginBottom: -1,
              paddingLeft: 12,
              paddingRight: 12,
              paddingTop: 8,
              paddingBottom: 8,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-[var(--color-dnf)]" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-[var(--color-ink-faint)]">Ачааллаж байна...</p>
      ) : submissions.length === 0 ? (
        <EmptyState text="Илгээмж алга." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {submissions.map((s) => (
            <SubmissionCard
              key={s.id}
              submission={s}
              busy={actionLoadingId === s.id}
              onAction={(action) => handleAction(s.id, action)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({
  submission,
  busy,
  onAction,
}: {
  submission: OnlineSubmissionAdminView;
  busy: boolean;
  onAction: (action: ReviewAction) => void;
}) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 2, background: 'var(--color-paper)', padding: 16 }}>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 2, background: 'var(--color-paper-2)', padding: 6 }}>
        <div className="aspect-video w-full overflow-hidden" style={{ borderRadius: 1 }}>
          <video
            src={submission.videoUrl}
            controls
            muted
            playsInline
            className="h-full w-full bg-black object-cover"
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm" style={{ marginTop: 12 }}>
        <dt className="text-[var(--color-ink-faint)]">Тэмцээн</dt>
        <dd className="text-[var(--color-ink)]">{submission.competitionId}</dd>
        <dt className="text-[var(--color-ink-faint)]">Төрөл</dt>
        <dd>
          <Badge borderColor="#DCD6C8" background="transparent" color="#8A8474">
            {submission.event.toUpperCase()} · Раунд {submission.round}
          </Badge>
        </dd>
        <dt className="text-[var(--color-ink-faint)]">Цаг</dt>
        <dd
          style={{
            fontFamily: 'var(--oc-font-mono)',
            fontVariantNumeric: 'tabular-nums',
            color: submission.isDnf ? '#D8402C' : 'var(--color-ink)',
          }}
        >
          {submission.isDnf ? 'DNF' : fmtCentiseconds(submission.reportedTime)}
        </dd>
        <dt className="text-[var(--color-ink-faint)]">Төлөв</dt>
        <dd>
          <Badge {...submissionBadge(submission.status, submission.penalty)}>
            {STATUS_LABEL[submission.status]}
            {submission.penalty ? ` (${submission.penalty})` : ''}
          </Badge>
        </dd>
      </dl>

      {submission.status === 'pending' && (
        <div className="flex flex-col gap-2 sm:flex-row" style={{ marginTop: 16 }}>
          <JudgeActionButton tone="ok" onClick={() => onAction('approve')} disabled={busy}>
            Зөвшөөрөх
          </JudgeActionButton>
          <JudgeActionButton tone="warn" onClick={() => onAction('approve_plus2')} disabled={busy}>
            +2 хугацаа нэмэх
          </JudgeActionButton>
          <JudgeActionButton tone="dnf" onClick={() => onAction('dnf')} disabled={busy}>
            Хүчингүй (DNF)
          </JudgeActionButton>
        </div>
      )}
    </div>
  );
}
