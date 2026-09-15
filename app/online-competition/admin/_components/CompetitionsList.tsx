'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState, type BadgeSpec } from '../../_components/ui';
import type { OnlineCompetitionAdminView, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import RoundGapWarning from './RoundGapWarning';
import DeleteCompetitionDialog from './DeleteCompetitionDialog';

const LIST_BASE = '/online-competition/admin/competitions';

// Record<OnlineCompetitionStatus, ...> — the compiler requires an entry
// for every status, which is what keeps a new one from rendering blank.
const STATUS_LABEL: Record<OnlineCompetitionStatus, string> = {
  draft: 'Ноорог',
  upcoming: 'Удахгүй болох',
  live: 'Явагдаж буй',
  finished: 'Дууссан',
};

// Exact literal colors from the approved mockup — not derived from the
// --color-* token block (see theme.css's top comment for why).
const STATUS_BADGE: Record<OnlineCompetitionStatus, BadgeSpec> = {
  // Ноорог is muted on purpose — deliberately NOT the volt accent, which
  // this system reserves for the live state. Distinguished from `upcoming`
  // (same outline, brighter text, no dot) by the dimmer ink plus a dot
  // swatch, and from `finished` (filled dark) by staying transparent: a
  // draft is unfinished, not over.
  draft: { borderColor: '#2A2A31', background: 'transparent', color: '#6E6A62', dotColor: '#4A4740' },
  upcoming: { borderColor: '#2A2A31', background: 'transparent', color: '#9A958A' },
  live: { borderColor: '#DFFF4F', background: '#DFFF4F', color: '#08080A' },
  finished: { borderColor: '#16161B', background: '#131318', color: '#6E6A62' },
};

/** YYYY.MM.DD — the meta line has no room for a time, and the list is
 *  scanned by date rather than read to the minute. */
function fmtDate(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** Admin home page's main content — the competitions list.
 *
 *  Editing is its own route now (CompetitionEditor, the tabbed form), so
 *  both ЗАСАХ and "Шинэ тэмцээн" are plain links rather than an inline
 *  form rendered underneath the table. ЗАСАХ goes STRAIGHT to the editor:
 *  it used to point at the detail page, which opens on its Тамирчид tab
 *  and made editing a two-click job. БҮРТГЭЛ is the link that still wants
 *  the detail page — that IS the registrations view. */
export default function CompetitionsList() {
  const [competitions, setCompetitions] = useState<OnlineCompetitionAdminView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recomputingId, setRecomputingId] = useState<string | null>(null);
  const [recomputeMsg, setRecomputeMsg] = useState<{ id: string; text: string; isError: boolean } | null>(null);
  /** The competition whose УСТГАХ dialog is open. */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** competitionId -> added events waiting for a decision. */
  const [eventRequests, setEventRequests] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-competitions');
      if (!res.ok) throw new Error('failed');
      // Every competition, drafts included. This list reads through the
      // Admin SDK route, which bypasses the rules that hide drafts from
      // the public site — so no status filter belongs here.
      const data = (await res.json()) as {
        competitions: OnlineCompetitionAdminView[];
        eventRequests?: Record<string, number>;
      };
      setCompetitions(data.competitions);
      setEventRequests(data.eventRequests ?? {});
    } catch (err) {
      console.error('CompetitionsList: loading competitions failed:', err);
      setError('Тэмцээнүүдийг ачааллаж чадсангүй');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRecompute(competitionId: string) {
    setRecomputingId(competitionId);
    setRecomputeMsg(null);
    try {
      const res = await fetch('/api/online-competition/admin-recompute-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId }),
      });
      const data = (await res.json()) as { athletesUpdated?: number; events?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setRecomputeMsg({
        id: competitionId,
        text: `Статистик шинэчлэгдлээ: ${data.athletesUpdated ?? 0} тамирчин`,
        isError: false,
      });
    } catch (err) {
      // Logged as well as shown: a network failure has an empty message,
      // so the console is the only place that kind of failure is visible.
      console.error('CompetitionsList: the stats recompute failed:', err);
      setRecomputeMsg({
        id: competitionId,
        text: 'Статистик шинэчлэхэд алдаа гарлаа',
        isError: true,
      });
    } finally {
      setRecomputingId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginBottom: 24 }}>
        <span className="oc-v3-label">
          Тэмцээнүүд
        </span>
        <Link className="oc-btn oc-btn-primary" href={`${LIST_BASE}/new`}>
          Шинэ тэмцээн
        </Link>
      </div>

      {error && (
        <p className="text-sm text-[#E8543C]" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-[#6E6A62]">Ачааллаж байна...</p>
      ) : competitions.length === 0 ? (
        <EmptyState text="Тэмцээн алга." />
      ) : (
        <div className="oc-table">
          {competitions.map((c) => {
            // Cheap defensive fallback — the admin-competitions API already
            // normalizes `status` (normalizeCompetitionStatus), but this
            // keeps the badge from ever indexing undefined if that ever
            // changes some other way.
            const badge = STATUS_BADGE[c.status] ?? STATUS_BADGE.upcoming;
            const label = STATUS_LABEL[c.status] ?? c.status;
            const detail = `${LIST_BASE}/${c.id}`;
            const edit = `${detail}/edit`;
            const preselect = `?competitionId=${encodeURIComponent(c.id)}`;
            return (
              <div key={c.id}>
                <div className="oc-adm-comp-row">
                  {/* НЭР — the start date lives in the meta line beneath the
                      name rather than in a column of its own. */}
                  <div className="oc-adm-comp-name">
                    <p style={{ font: '600 15px/1.2 var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
                      {c.name}
                    </p>
                    <p
                      style={{
                        marginTop: 5,
                        font: '400 10px/1 var(--oc-font-mono), monospace',
                        letterSpacing: '.06em',
                        color: '#6E6A62',
                      }}
                    >
                      {c.events.length} төрөл · онлайн · {fmtDate(c.startAt)}
                    </p>
                  </div>

                  {/* ОНЦЛОХ — TODO: not wired. Featuring a competition needs
                      a schema field on onlineCompetitions plus a public-page
                      change to read it; neither exists yet, so this renders
                      inert rather than pretending to toggle something. */}
                  <button
                    type="button"
                    className="oc-adm-comp-btn oc-adm-comp-star"
                    disabled
                    title="Онцлох — удахгүй"
                    aria-label="Онцлох"
                  >
                    ★
                  </button>

                  {/* Both of these pre-select the competition: RoundsManager
                      and ReviewGrid each read ?competitionId= on mount. */}
                  <Link className="oc-adm-comp-btn" href={`/online-competition/admin/rounds${preselect}`}>
                    РАУНД
                  </Link>
                  <Link className="oc-adm-comp-btn" href={`/online-competition/admin/review${preselect}`}>
                    ШҮҮЛТ
                  </Link>
                  {/* The registrations view IS the detail page's Тамирчид
                      tab. No badge yet: the review statuses exist in the
                      type, but nothing writes 'pending' until registration
                      review lands, so there is no pending count to show. */}
                  {/* Volt count: approved athletes' added events waiting
                      for a decision, which the review table resolves. */}
                  <Link
                    className="oc-adm-comp-btn"
                    href={detail}
                    title={eventRequests[c.id] ? `${eventRequests[c.id]} төрөл нэмэх хүсэлт` : undefined}
                  >
                    БҮРТГЭЛ
                    {(eventRequests[c.id] ?? 0) > 0 && <span style={{ color: '#DFFF4F' }}>{eventRequests[c.id]}</span>}
                  </Link>

                  <Badge {...badge} padding="5px 7px">
                    {label}
                  </Badge>

                  {/* ТАМИРЧИН — registered against the cap. */}
                  <span
                    style={{
                      font: '500 13px/1 var(--oc-font-mono), monospace',
                      color: '#F4F1EA',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.registeredCount}
                    <span style={{ color: '#6E6A62' }}>
                      {' / '}
                      {c.participantLimit === null ? '∞' : c.participantLimit}
                    </span>
                  </span>

                  <Link className="oc-adm-comp-btn" href={edit}>
                    ЗАСАХ
                  </Link>
                  {/* Opens the preview first; nothing is removed until the
                      exact name is typed and confirmed. */}
                  <button
                    type="button"
                    className="oc-adm-comp-btn"
                    style={{ color: '#E8543C' }}
                    onClick={() => setDeletingId(c.id)}
                  >
                    УСТГАХ
                  </button>
                </div>

                {/* A deletion that started but has not finished. The
                    competition is already hidden from athletes. */}
                {c.deletion && (
                  <div
                    className="oc-sc-warn"
                    role="alert"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: 'none' }}
                  >
                    <span>Устгал дуусаагүй — тэмцээн тамирчдаас нуугдсан.</span>
                    <button type="button" className="oc-sc-btn" onClick={() => setDeletingId(c.id)}>
                      ҮРГЭЛЖЛҮҮЛЭХ
                    </button>
                  </div>
                )}

                {/* A live competition with no round open silently refuses
                    every solve attempt. Still a full-width strip directly
                    under its row: the row is a wrapping flex line with no
                    cell wide enough for a sentence, and the warning has to
                    be readable at a glance. */}
                {c.status === 'live' && (
                  <RoundGapWarning
                    events={c.eventsWithoutLiveRound ?? []}
                    style={{ borderTop: 'none' }}
                  />
                )}

                {/* Its own strip below the row, not squeezed into the 80px
                    last column — the label does not fit that column's
                    fixed width. Refreshes athlete stats (PRs, averages)
                    from this competition's judged attempts. */}
                {c.status === 'finished' && (
                  <div
                    style={{
                      padding: '8px 14px 13px',
                      borderTop: '1px solid var(--color-border-soft)',
                      background: 'var(--color-paper-2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: 12,
                    }}
                  >
                    {recomputeMsg && recomputeMsg.id === c.id && (
                      <span
                        className="text-xs"
                        style={{ color: recomputeMsg.isError ? '#E8543C' : 'var(--color-ink-soft)' }}
                      >
                        {recomputeMsg.text}
                      </span>
                    )}
                    <Button
                      variant="outline"
                      className="oc-btn-sm"
                      disabled={recomputingId === c.id}
                      onClick={() => handleRecompute(c.id)}
                    >
                      {recomputingId === c.id ? 'Шинэчилж байна...' : 'Статистик шинэчлэх'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {deletingId && (
        <DeleteCompetitionDialog
          competitionId={deletingId}
          onClose={() => {
            setDeletingId(null);
            load();
          }}
          onChanged={load}
        />
      )}
    </div>
  );
}
