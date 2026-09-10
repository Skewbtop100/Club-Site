'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { fetchCompetition } from '@/lib/online-competition/data';
import { renderableSections } from '@/lib/online-competition/competition-shape';
import { competitionFeeTotals, formatMnt } from '@/lib/online-competition/fees';
import { competitionFormatLabel, type OnlineCompetition } from '@/lib/online-competition/types';
import { toMillisOrNull } from '../../_components/hub/format';
import HubNav from '../../_components/hub/v3/HubNav';
import Countdown from './_components/Countdown';
import { EventsTab, ScheduleTab, SectionTab } from './_components/DetailTabs';
import RegistrationPanel from './_components/RegistrationPanel';

const COMPETITIONS = '/online-competition/competitions';

/** Dark v3 shell. `live` is this competition when it's the one running —
 *  HubNav's live tab has no other source on this route. */
function Shell({ competition, children }: { competition: OnlineCompetition | null; children: React.ReactNode }) {
  return (
    <div className="oc-v3-page">
      <HubNav live={competition?.status === 'live' ? competition : null} active="competitions" />
      {children}
    </div>
  );
}

// ── the left sidebar ─────────────────────────────────────────────────────
type SideKey = 'general' | 'register' | 'athletes';

// ── the tab strip, right of the sidebar ──────────────────────────────────
// ЕРӨНХИЙ is always present. ТӨРЛҮҮД is present whenever there are events
// to list. ХУВААРЬ and the custom-section tabs are CONDITIONAL — see
// visibleTabs.
type TabKey = string;

/** Rows of the fact grid on the Ерөнхий tab. */
interface Fact {
  label: string;
  value: string;
}

/** "2026.03.25 · 10:00" split into its two halves, or "—" for an unset
 *  timestamp. The header meta line and the fact grid both want these, in
 *  different combinations. */
function fmtDay(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}
function fmtHm(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** "2026.03.25 · 10:00", or "—" when unset — the fact grid's date cells. */
function fmtMoment(ms: number | null): string {
  return ms === null ? '—' : `${fmtDay(ms)} · ${fmtHm(ms)}`;
}

export default function CompetitionDetailPage() {
  const params = useParams<{ competitionId: string }>();
  const competitionId = params.competitionId;

  const [competition, setCompetition] = useState<OnlineCompetition | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [side, setSide] = useState<SideKey>('general');
  const [tab, setTab] = useState<TabKey>('general');

  useEffect(() => {
    let cancelled = false;
    fetchCompetition(competitionId)
      .then((c) => {
        if (cancelled) return;
        if (!c) setNotFound(true);
        else setCompetition(c);
      })
      .catch((err) => {
        console.error('CompetitionDetailPage: loading the competition failed:', err);
        if (!cancelled) setError('Тэмцээний мэдээллийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId]);

  /** The custom sections this page shows, each holding only the blocks
   *  that render something. Shared logic (competition-shape.ts): a section
   *  needs a title AND at least one renderable block, so an empty text
   *  block or a video whose url no longer parses cannot open a blank tab. */
  const sections = useMemo(() => renderableSections(competition?.sections ?? []), [competition]);

  /** Which tabs exist for THIS competition.
   *
   *  ТӨРЛҮҮД, ХУВААРЬ and each custom section are conditional: a tab that
   *  opens on nothing is worse than an absent one, because the reader has
   *  already paid the click.
   *
   *  No defensive reading here any more. `fetchCompetition` now runs
   *  events, sections and schedule through the same normalisers the admin
   *  GET uses (competition-shape.ts), so every array below is already
   *  typed and cleaned. */
  const tabs = useMemo(() => {
    const out: { key: TabKey; label: string }[] = [{ key: 'general', label: 'ЕРӨНХИЙ' }];
    if ((competition?.events ?? []).length > 0) out.push({ key: 'events', label: 'ТӨРЛҮҮД' });
    if ((competition?.schedule ?? []).length > 0) out.push({ key: 'schedule', label: 'ХУВААРЬ' });
    for (const sec of sections) out.push({ key: `section:${sec.id}`, label: sec.title.trim().toUpperCase() });
    return out;
  }, [competition, sections]);

  // A tab that disappears (the admin emptied a section between loads)
  // must not leave the strip pointing at nothing.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'general';

  if (error) {
    return (
      <Shell competition={null}>
        <p className="oc-v3-status oc-v3-status-error">{error}</p>
      </Shell>
    );
  }
  if (notFound) {
    return (
      <Shell competition={null}>
        <p className="oc-v3-status">Тэмцээн олдсонгүй.</p>
      </Shell>
    );
  }
  if (!competition) {
    return (
      <Shell competition={null}>
        <p className="oc-v3-status">Ачааллаж байна...</p>
      </Shell>
    );
  }

  const startAtMs = toMillisOrNull(competition.startAt);
  const deadlineMs = toMillisOrNull(competition.registrationDeadline);
  const limit = competition.participantLimit ?? null;
  const bannerUrl = competition.bannerUrl ?? null;
  const posterUrl = competition.posterUrl ?? null;
  const instructions = (competition.instructions ?? '').trim();
  const description = (competition.description ?? '').trim();

  // Fees, through the same pure module the admin Төлбөр tab and the
  // registration total use — one set of arithmetic, so what an athlete
  // reads here cannot disagree with what the admin configured.
  const paid = competition.paid === true;
  const totals = competitionFeeTotals(competition.baseFeeMnt ?? null, competition.events);
  const includedLabels = totals.includedEventIds
    .map((id) => competition.events.find((e) => e.eventId === id)?.label ?? id)
    .join(', ');

  const facts: Fact[] = [
    { label: 'БҮРТГЭЛ НЭЭГДЭХ', value: fmtMoment(toMillisOrNull(competition.registrationOpensAt)) },
    { label: 'БҮРТГЭЛ ХААГДАХ', value: fmtMoment(deadlineMs) },
    { label: 'ТЭМЦЭЭН ЭХЛЭХ', value: fmtMoment(startAtMs) },
    { label: 'ТЭМЦЭЭН ДУУСАХ', value: fmtMoment(toMillisOrNull(competition.endAt)) },
    { label: 'ФОРМАТ', value: competitionFormatLabel(competition.format) },
    { label: 'ТАМИРЧНЫ ХЯЗГААР', value: limit === null ? 'Хязгааргүй' : `${limit} тамирчин` },
    {
      label: 'СУУРЬ ХУРААМЖ',
      // `paid` is THE GATE, never baseFeeMnt being set — the fee fields
      // deliberately persist when the toggle is switched off (see the
      // field comments in types.ts), so a stored amount on a free
      // competition must not surface here.
      value: !paid
        ? 'Хураамжгүй'
        : competition.baseFeeMnt == null
          ? '—'
          : includedLabels
            ? `${formatMnt(totals.minMnt)} · ${includedLabels} багтсан`
            : formatMnt(totals.minMnt),
    },
  ];
  // НЭМЭЛТ ХУРААМЖ is not rendered at all for a free competition, and not
  // rendered when nothing is surcharged — an empty "extras" cell invites
  // the reader to wonder what they missed.
  if (paid && totals.surcharged.length > 0) {
    facts.push({
      label: 'НЭМЭЛТ ХУРААМЖ',
      value: totals.surcharged
        .map((s) => {
          const label = competition.events.find((e) => e.eventId === s.eventId)?.label ?? s.eventId;
          return `${label} +${formatMnt(s.surchargeMnt)}`;
        })
        .join(' · '),
    });
  }

  return (
    <Shell competition={competition}>
      <main className="oc-v3-main">
        <header className="oc-cd-hero" style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}>
          {/* Only when there is artwork to darken — over the plain
              fallback the scrim would just deepen an already-flat block. */}
          {bannerUrl && <div className="oc-scrim-lr" aria-hidden />}

          <div className="oc-cd-hero-body">
            <div className="oc-cd-hero-left">
              <Link href={COMPETITIONS} className="oc-cd-back">
                ← ТЭМЦЭЭН
              </Link>
              <h1 className="oc-cd-title">{competition.name}</h1>
              <p className="oc-cd-meta">
                {fmtDay(startAtMs)} · {fmtHm(startAtMs)} · {competitionFormatLabel(competition.format)}
              </p>
            </div>

            <div className="oc-cd-cells">
              <div className="oc-cd-cell">
                <span className="oc-cd-cell-label">ТАМИРЧИН</span>
                {/* Registered counts have NO public read path:
                    registrations live at onlineParticipants/{uid}/
                    registrations, whose rule is `allow read: if
                    isSignedIn()` on the individual document with no
                    collection-group rule — so neither an anonymous nor a
                    signed-in visitor can count across athletes. The
                    denominator is the real declared capacity; the
                    numerator is an em dash rather than an invented
                    number. "— / 64" is deliberately kept over a bare
                    "64", which under a ТАМИРЧИН label would read as
                    "64 registered". */}
                <span className="oc-cd-cell-value">— / {limit === null ? '∞' : limit}</span>
              </div>
              <div className="oc-cd-cell">
                <span className="oc-cd-cell-label">БҮРТГЭЛ ХААГДАХАД</span>
                <span className="oc-cd-cell-value oc-cd-cell-volt">
                  <Countdown targetMs={deadlineMs} />
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="oc-cd-layout">
          <nav className="oc-cd-side" aria-label="Хэсэг">
            <SideItem active={side === 'general'} onClick={() => setSide('general')} label="Ерөнхий мэдээлэл" />
            <SideItem
              active={side === 'register'}
              onClick={() => setSide('register')}
              label="Бүртгүүлэх"
              count={`${competition.events.length} төрөл`}
            />
            {/* No count: see the ТАМИРЧИН cell above — the number does not
                exist publicly, and a 0 here would be a lie rather than a
                gap. */}
            <SideItem active={side === 'athletes'} onClick={() => setSide('athletes')} label="Тамирчид" count="—" />
          </nav>

          <div className="oc-cd-content">
            {side === 'general' ? (
              <>
                <div className="oc-cd-tabs" role="tablist">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={t.key === activeTab}
                      className={`oc-cd-tab${t.key === activeTab ? ' oc-cd-tab-active' : ''}`}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {activeTab === 'general' ? (
                  <>
                    {/* Тайлбар. No label — it reads as an intro to the
                        competition, not as another field of it, which is
                        why it sits above the grid rather than in it. The
                        whole block goes when there is nothing to say. */}
                    {description && <p className="oc-cd-lead">{description}</p>}
                    <div className={`oc-cd-general${posterUrl ? '' : ' oc-cd-general-noposter'}`}>
                      {/* No poster, no poster block — not an empty box. */}
                      {posterUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- a
                        // Cloudinary url of unknown dimensions.
                        <img src={posterUrl} alt="" className="oc-cd-poster" />
                      )}
                      <div className="oc-cd-facts">
                        {facts.map((f) => (
                          <div key={f.label} className="oc-cd-fact">
                            <span className="oc-cd-fact-label">{f.label}</span>
                            <span className="oc-cd-fact-value">{f.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : activeTab === 'events' ? (
                  <EventsTab events={competition.events} />
                ) : activeTab === 'schedule' ? (
                  <ScheduleTab
                    schedule={competition.schedule ?? []}
                    events={competition.events}
                    startAtMs={startAtMs}
                  />
                ) : (
                  // Every remaining tab key is `section:<id>`, and tabs only
                  // exists for sections that survived renderableSections —
                  // so the lookup cannot miss for a key in the strip.
                  (() => {
                    const section = sections.find((sec) => `section:${sec.id}` === activeTab);
                    return section ? <SectionTab section={section} /> : null;
                  })()
                )}

                {/* Whole block hidden when there are no instructions —
                    a ЗААВАР heading over nothing reads as a page that
                    failed to load. */}
                {activeTab === 'general' && instructions && (
                  <section className="oc-cd-instructions">
                    <h2 className="oc-cd-section-label">ЗААВАР</h2>
                    <p className="oc-cd-instructions-body">{instructions}</p>
                  </section>
                )}
              </>
            ) : side === 'register' ? (
              <>
                <h2 className="oc-cd-section-label">Бүртгүүлэх</h2>
                {/* The EXISTING registration flow, moved here rather than
                    replaced by a placeholder. The rebuilt page has no
                    other home for it, and dropping it would take live
                    registration off the public site — see the note in the
                    handover. Its own redesign is a later changeset. */}
                <div style={{ marginTop: 14 }}>
                  <RegistrationPanel competitionId={competition.id} events={competition.events} />
                </div>
              </>
            ) : (
              <>
                <h2 className="oc-cd-section-label">Тамирчид</h2>
                <p className="oc-cd-soon">Энэ хэсэг удахгүй нэмэгдэнэ.</p>
              </>
            )}
          </div>
        </div>
      </main>
    </Shell>
  );
}

function SideItem({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: string;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      className={`oc-cd-side-item${active ? ' oc-cd-side-item-active' : ''}`}
      onClick={onClick}
    >
      <span className="oc-cd-side-label">{label}</span>
      {count && <span className="oc-cd-side-count">{count}</span>}
    </button>
  );
}
