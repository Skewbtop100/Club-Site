'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  OnlineCompetitionAdminView,
  OnlineParticipantAdminView,
  OnlineSubmissionAdminView,
} from '@/lib/online-competition/types';
import type { RegistrationAdminView } from '@/app/api/online-competition/admin-competitions/[id]/registrations/route';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import RoundGapWarning from './RoundGapWarning';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import { Badge } from '../../_components/ui';

const ADMIN = '/online-competition/admin';
const QUEUE_PREVIEW = 5;

const STATUS_BADGE = {
  pending: { borderColor: '#E0A020', background: 'transparent', color: '#E0A020' },
  approved: { borderColor: '#4FD07A', background: '#0F1A12', color: '#4FD07A' },
  rejected: { borderColor: '#D8402C', background: '#1A0D0A', color: '#E8543C' },
} as const;
const STATUS_LABEL = { pending: 'ХҮЛЭЭГДЭЖ', approved: 'БАТЛАГДСАН', rejected: 'ТАТГАЛЗСАН' } as const;

function CardHead({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 16px',
        borderBottom: '1px solid #1C1C21',
      }}
    >
      <span className="oc-v3-label">{label}</span>
      {action}
    </div>
  );
}

export default function AdminOverview() {
  const [pending, setPending] = useState<OnlineSubmissionAdminView[] | null>(null);
  const [athletes, setAthletes] = useState<OnlineParticipantAdminView[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [live, setLive] = useState<OnlineCompetitionAdminView | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationAdminView[] | null>(null);
  const [liveSubs, setLiveSubs] = useState<OnlineSubmissionAdminView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const j = <T,>(url: string, key: string): Promise<T[]> =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
        .then((d: Record<string, T[]>) => d[key] ?? [])
        .catch(() => []);

    // Cross-competition pending queue — same scope as the sidebar's
    // "Шүүлт" badge and the /admin/review route. The API already orders
    // by createdAt ascending, so this is oldest-first.
    j<OnlineSubmissionAdminView>('/api/online-competition/submissions?status=pending', 'submissions').then((v) => {
      if (!cancelled) setPending(v);
    });
    j<OnlineParticipantAdminView>('/api/online-competition/admin-athletes?status=pending', 'athletes').then((v) => {
      if (!cancelled) setAthletes(v);
    });
    // Approved roster doubles as the uid -> display name map for the queue
    // rows; submissions carry only a uid.
    j<OnlineParticipantAdminView>('/api/online-competition/admin-athletes?status=approved', 'athletes').then((v) => {
      if (!cancelled) {
        setNames(Object.fromEntries(v.map((a) => [a.uid, `${a.lastName} ${a.firstName}`.trim() || a.displayName])));
      }
    });

    j<OnlineCompetitionAdminView>('/api/online-competition/admin-competitions', 'competitions').then(async (list) => {
      const current = list.find((c) => c.status === 'live') ?? null;
      if (cancelled) return;
      setLive(current);
      if (!current) {
        setRegistrations([]);
        setLiveSubs([]);
        return;
      }
      const [regs, subs] = await Promise.all([
        j<RegistrationAdminView>(`/api/online-competition/admin-competitions/${current.id}/registrations`, 'registrations'),
        j<OnlineSubmissionAdminView>(`/api/online-competition/submissions?status=all&competitionId=${current.id}`, 'submissions'),
      ]);
      if (cancelled) return;
      setRegistrations(regs);
      setLiveSubs(subs);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <p className="oc-v3-eyebrow">Админ</p>
        <h1 className="oc-v3-title" style={{ marginTop: 8 }}>Хяналтын самбар</h1>
      </div>

      {/* Only the two stats the data model actually supports. The mockup's
          "ӨНӨӨДӨР БАТАЛСАН" needs a reviewedAt timestamp on submissions
          (the schema has none — see OnlineSubmission in types.ts) and
          "ОНЛАЙН ТАМИРЧИН" needs presence tracking that doesn't exist at
          all, so both cards are omitted rather than filled with a made-up
          number. */}
      <div className="oc-adm-statgrid">
        <StatCell
          label="Хянах дараалал"
          value={pending === null ? null : pending.length}
          accent
          note="шүүгчийн шийдвэр хүлээж байна"
        />
        <StatCell
          label="Тамирчны хүсэлт"
          value={athletes === null ? null : athletes.length}
          note="баталгаажуулалт хүлээж байна"
        />
      </div>

      <div className="oc-adm-overview-grid">
        {/* ── Review queue preview ─────────────────────────────────── */}
        <div style={{ border: '1px solid #1C1C21', background: '#0D0D10' }}>
          <CardHead
            label="Хянах дараалал"
            action={
              <Link href={`${ADMIN}/review`} className="oc-v3-label-link">
                БҮГДИЙГ ХАРАХ
              </Link>
            }
          />
          {pending === null ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : pending.length === 0 ? (
            <EmptyRow text="Хянах илгээмж алга." />
          ) : (
            pending.slice(0, QUEUE_PREVIEW).map((s) => {
              const tone = STATUS_BADGE[s.status] ?? STATUS_BADGE.pending;
              const isDnf = s.isDnf || s.penalty === 'DNF';
              return (
                <div key={s.id} className="oc-adm-queue-row">
                  <span style={{ display: 'flex', alignItems: 'center', color: '#F4F1EA' }}>
                    {hasWcaEventIcon(s.event) ? (
                      <WcaEventIcon eventId={s.event} size={18} />
                    ) : (
                      <span style={{ font: '600 10px var(--oc-font-mono), monospace' }}>
                        {s.event.toUpperCase()}
                      </span>
                    )}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        font: '500 13px var(--oc-font-heading), sans-serif',
                        color: '#F4F1EA',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {names[s.uid] ?? s.uid.slice(0, 10)}
                    </p>
                    {/* Submissions carry a round but no attempt number, so
                        the mockup's "{round} · {attempt}" is round only. */}
                    <p style={{ marginTop: 3, font: '400 10px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
                      РАУНД {s.round} · {s.competitionId}
                    </p>
                  </div>
                  <span
                    style={{
                      font: '700 15px var(--oc-font-mono), monospace',
                      fontVariantNumeric: 'tabular-nums',
                      color: isDnf ? '#4A4740' : '#F4F1EA',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isDnf ? 'DNF' : fmtCentiseconds(s.reportedTime)}
                  </span>
                  <Badge {...tone} padding="5px 7px">
                    {STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                </div>
              );
            })
          )}
        </div>

        {/* ── Round progress (live competition) ────────────────────── */}
        <div style={{ border: '1px solid #1C1C21', background: '#0D0D10' }}>
          <CardHead label="Раундын явц" />
          {/* The admin lands here first — a live competition with no round
              open must not read as "just no submissions yet". */}
          {live && <RoundGapWarning events={live.eventsWithoutLiveRound ?? []} />}
          {liveSubs === null || registrations === null ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : !live ? (
            <EmptyRow text="Явагдаж буй тэмцээн алга." />
          ) : (
            <RoundProgress competition={live} submissions={liveSubs} registrations={registrations} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: number | null;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className="oc-adm-statcell">
      <span className="oc-v3-stat-label">{label}</span>
      <span className="oc-adm-statvalue" style={{ color: accent ? '#DFFF4F' : '#F4F1EA' }}>
        {value === null ? '—' : value}
      </span>
      <p style={{ marginTop: 8, font: '400 10px var(--oc-font-mono), monospace', color: '#6E6A62' }}>{note}</p>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p style={{ padding: '28px 16px', font: '500 13px var(--oc-font-heading), sans-serif', color: '#6E6A62' }}>
      {text}
    </p>
  );
}

/** One row per event+round that has at least one submission in the live
 *  competition.
 *
 *  Denominator approximation: there is no "expected submissions for this
 *  round" anywhere in the schema, so it uses the number of athletes
 *  registered for that EVENT (the same registrations query the competition
 *  detail page's Тамирчид tab uses). That is per-event, not per-round —
 *  for a multi-round event every round shows the same denominator, which
 *  over-counts if athletes are cut between rounds. There is no cut/advance
 *  model to derive a truer number from. */
function RoundProgress({
  competition,
  submissions,
  registrations,
}: {
  competition: OnlineCompetitionAdminView;
  submissions: OnlineSubmissionAdminView[];
  registrations: RegistrationAdminView[];
}) {
  const rows: { key: string; label: string; done: number; expected: number }[] = [];
  for (const ev of competition.events) {
    const expected = registrations.filter((r) => r.events.includes(ev.eventId)).length;
    for (let round = 1; round <= ev.rounds; round += 1) {
      const done = submissions.filter((s) => s.event === ev.eventId && s.round === round).length;
      if (done === 0) continue;
      rows.push({ key: `${ev.eventId}-${round}`, label: `${ev.label} · Раунд ${round}`, done, expected });
    }
  }

  if (rows.length === 0) return <EmptyRow text="Илгээмж бүхий раунд алга." />;

  return (
    <>
      {rows.map((r) => {
        const pct = r.expected > 0 ? Math.min(100, Math.round((r.done / r.expected) * 100)) : 0;
        return (
          <div key={r.key} className="oc-adm-progress-row">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ font: '500 12px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
                {r.label}
              </span>
              <span
                style={{
                  font: '700 12px var(--oc-font-mono), monospace',
                  fontVariantNumeric: 'tabular-nums',
                  color: '#9A958A',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.done} / {r.expected}
              </span>
            </div>
            <div className="oc-v3-bar" style={{ marginTop: 8, height: 4 }}>
              <div className="oc-v3-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </>
  );
}
