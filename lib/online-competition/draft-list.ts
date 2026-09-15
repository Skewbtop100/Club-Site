// ── Шинэ тэмцээн: competitions not yet announced ─────────────────────────
// Pure — no React, no fetch — so what the drafts page lists, and how it
// words each row, is unit-tested in tests/competition-fields/draft-list.test.cjs.
//
// NOT YET ANNOUNCED means status 'draft'. It is the one status the public
// site cannot see (fetchAllCompetitions filters it out; firestore.rules deny
// reading it); 'upcoming', 'live' and 'finished' are all public. A draft
// whose DELETION has started is also stored as 'draft' (competition-delete.ts
// hides it that way) — that is a competition being removed, not one being
// prepared, so it is left out here and finished from Тэмцээнүүд, where its
// ҮРГЭЛЖЛҮҮЛЭХ lives.
//
// READINESS is the editor's own publish checklist (publish-readiness.ts,
// the Хянах tab), evaluated on the stored competition: the same four
// requirements, so "3/4" here and the checklist inside the editor can never
// disagree.

import { evaluateReadiness, type Readiness } from './publish-readiness';
import type { OnlineCompetitionAdminView } from './types';

export const ADMIN_COMPETITIONS = '/online-competition/admin/competitions';

export type DraftSource = Pick<
  OnlineCompetitionAdminView,
  | 'id'
  | 'name'
  | 'status'
  | 'startAt'
  | 'registrationDeadline'
  | 'posterUrl'
  | 'bannerUrl'
  | 'paid'
  | 'baseFeeMnt'
  | 'events'
  | 'createdAt'
  | 'deletion'
>;

export function isUnannounced(c: Pick<DraftSource, 'status' | 'deletion'>): boolean {
  return c.status === 'draft' && !c.deletion;
}

/** The Хянах checklist for a STORED competition. The editor passes one
 *  extra, editor-only fact — an event marked as costing extra with no
 *  amount typed — which cannot exist in storage (a surcharge is saved as an
 *  amount or not at all), so it is simply absent here. */
export function readinessOf(c: DraftSource): Readiness {
  return evaluateReadiness({
    name: c.name,
    startAt: c.startAt,
    registrationDeadline: c.registrationDeadline,
    posterUrl: c.posterUrl,
    bannerUrl: c.bannerUrl,
    paid: c.paid,
    baseFeeMnt: c.baseFeeMnt,
    events: c.events.map((e) => ({ eventId: e.eventId, label: e.label, rounds: e.rounds })),
  });
}

/** "2026.10.04 · 11:00", in the admin's own time zone — the zone the
 *  editor's date fields are typed in. */
export function fmtStart(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface DraftRow {
  id: string;
  name: string;
  /** "НООРОГ · ПОСТЕР · БАННЕР ДУТУУ", or "БЭЛЭН · ЗАРЛААГҮЙ". */
  tag: string;
  tagColor: string;
  dateLabel: string;
  eventCount: number;
  met: number;
  total: number;
  /** The bar's width, "75%". */
  pct: string;
  barColor: string;
  /** "3/4 ХЭСЭГ БӨГЛӨСӨН". */
  doneLabel: string;
  editHref: string;
}

// design-mockups/Khorom Admin.dc.html, the drafts list.
const TAG_READY = '#A8B96A';
const TAG_DRAFT = '#6E6A62';
const BAR_READY = '#DFFF4F';
const BAR_DRAFT = '#3A4614';

export function toDraftRow(c: DraftSource): DraftRow {
  const readiness = readinessOf(c);
  const unmet = readiness.requirements.filter((r) => !r.met);
  const total = readiness.requirements.length;
  const met = total - unmet.length;
  const complete = unmet.length === 0;
  return {
    id: c.id,
    name: c.name.trim() || 'Нэргүй тэмцээн',
    // What is missing, in the checklist's own words.
    tag: complete ? 'БЭЛЭН · ЗАРЛААГҮЙ' : `НООРОГ · ${unmet.map((r) => r.status).join(' · ')}`,
    tagColor: complete ? TAG_READY : TAG_DRAFT,
    dateLabel: fmtStart(c.startAt),
    eventCount: c.events.length,
    met,
    total,
    pct: `${(met / total) * 100}%`,
    barColor: complete ? BAR_READY : BAR_DRAFT,
    doneLabel: `${met}/${total} ХЭСЭГ БӨГЛӨСӨН`,
    editHref: `${ADMIN_COMPETITIONS}/${encodeURIComponent(c.id)}/edit`,
  };
}

/** The page's rows: unannounced competitions, soonest start first (no start
 *  date last), newest created first among equals. */
export function draftRows(competitions: readonly DraftSource[]): DraftRow[] {
  return competitions
    .filter(isUnannounced)
    .sort(
      (a, b) =>
        (a.startAt ?? Number.MAX_SAFE_INTEGER) - (b.startAt ?? Number.MAX_SAFE_INTEGER) ||
        (b.createdAt ?? 0) - (a.createdAt ?? 0),
    )
    .map(toDraftRow);
}
