'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState, type BadgeSpec } from '../../_components/ui';
import type { OnlineCompetitionAdminView, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import CompetitionForm from './CompetitionForm';
import RoundGapWarning from './RoundGapWarning';

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

/** Admin home page's main content — the competitions list. Each row now
 *  links to that competition's own detail page (Тамирчид / Шүүгчийн
 *  самбар tabs); the old per-row "Засах" button moved there too (see
 *  CompetitionDetail) — this page keeps only "create a new competition"
 *  as an inline action, via the exact same CompetitionForm used to
 *  create one. */
export default function CompetitionsList() {
  const [competitions, setCompetitions] = useState<OnlineCompetitionAdminView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [recomputingId, setRecomputingId] = useState<string | null>(null);
  const [recomputeMsg, setRecomputeMsg] = useState<{ id: string; text: string; isError: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-competitions');
      if (!res.ok) throw new Error('failed');
      // Every competition, drafts included. This list reads through the
      // Admin SDK route, which bypasses the rules that hide drafts from
      // the public site — so no status filter belongs here.
      const data = (await res.json()) as { competitions: OnlineCompetitionAdminView[] };
      setCompetitions(data.competitions);
    } catch {
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
      const res = await fetch('/api/online-competition/admin-recompute-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId }),
      });
      const data = (await res.json()) as {
        season?: string;
        athletesUpdated?: number;
        error?: string;
        stats?: { athletesUpdated: number; events: number } | null;
      };
      const statsNote = data.stats ? ` · Статистик: ${data.stats.athletesUpdated} тамирчин` : '';
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setRecomputeMsg({
        id: competitionId,
        text: `Шинэчлэгдлээ: ${data.athletesUpdated} тамирчин (${data.season})${statsNote}`,
        isError: false,
      });
    } catch (err) {
      // The per-athlete stats recompute runs first and independently of
      // the season, so points can fail while stats succeeded — the server
      // says so in its message and it would be misleading to replace that
      // with a flat "something went wrong".
      const raw = err instanceof Error ? err.message : '';
      setRecomputeMsg({
        id: competitionId,
        text: raw.startsWith('Competition has no season set')
          ? `Энэ тэмцээнд сезон тохируулаагүй байна${raw.includes('статистик') ? ' · Статистик шинэчлэгдсэн' : ''}`
          : raw || 'Онооны тооцоо шинэчлэхэд алдаа гарлаа',
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
        <Button variant="primary" onClick={() => setCreating(true)}>
          Шинэ тэмцээн
        </Button>
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
            const detail = `/online-competition/admin/competitions/${c.id}`;
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
                      tab. No badge: registrations have a single status
                      ('registered') — there is no pending-request state in
                      the schema for a count to come from. */}
                  <Link className="oc-adm-comp-btn" href={detail}>
                    БҮРТГЭЛ
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

                  <Link className="oc-adm-comp-btn" href={detail}>
                    ЗАСАХ
                  </Link>
                </div>

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
                    last column — "Онооны тооцоо шинэчлэх" is far too long
                    a label to fit that column's fixed width. Kept on the
                    list (not the detail page) since it's a season-points
                    action, unrelated to either of the detail page's two
                    tabs. */}
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
                      {recomputingId === c.id ? 'Тооцож байна...' : 'Онооны тооцоо шинэчлэх'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <CompetitionForm
          competition={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}
