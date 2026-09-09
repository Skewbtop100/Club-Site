'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { fetchCompetition } from '@/lib/online-competition/data';
import type { OnlineCompetition, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import { fmtDateTime, toMillisOrNull } from '../../_components/hub/format';
import HubNav from '../../_components/hub/v3/HubNav';
import Countdown from './_components/Countdown';
import RegistrationPanel from './_components/RegistrationPanel';

const COMPETITIONS = '/online-competition/competitions';

// A draft never reaches this page — fetchCompetition returns null for one
// (the rules refuse it) and the page renders "Тэмцээн олдсонгүй". The
// entry exists because the Record demands one, and so that a draft can
// never render as a blank badge if that ever changes.
const STATUS_LABEL: Record<OnlineCompetitionStatus, string> = {
  draft: 'Ноорог',
  upcoming: 'Удахгүй болох',
  live: 'Явагдаж буй',
  finished: 'Дууссан',
};

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

export default function CompetitionDetailPage() {
  const params = useParams<{ competitionId: string }>();
  const competitionId = params.competitionId;

  const [competition, setCompetition] = useState<OnlineCompetition | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchCompetition(competitionId)
      .then((c) => {
        if (cancelled) return;
        if (!c) {
          setNotFound(true);
        } else {
          setCompetition(c);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Тэмцээний мэдээллийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId]);

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
  const limit = competition.participantLimit ?? null;

  return (
    <Shell competition={competition}>
      <main className="oc-v3-main">
        <div>
          <Link href={COMPETITIONS} className="oc-v3-back-link">
            ← Тэмцээнүүд
          </Link>
        </div>

        <header className="oc-v3-dhero">
          <div className="oc-v3-dhero-left">
            <span className="oc-v3-status-badge">{STATUS_LABEL[competition.status]}</span>
            <h1
              style={{
                marginTop: 12,
                font: '600 32px var(--oc-font-heading), sans-serif',
                letterSpacing: '-.015em',
                color: '#F4F1EA',
              }}
            >
              {competition.name}
            </h1>
            <div className="oc-v3-dhero-metarow" style={{ marginTop: 16 }}>
              <span style={{ font: '400 12px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
                {fmtDateTime(competition.startAt)}
              </span>
              {competition.events.length > 0 && (
                <>
                  <span className="oc-v3-divider-v" aria-hidden />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {competition.events.map((e) => (
                      <span key={e.eventId} className="oc-v3-ev-square" title={e.label}>
                        {hasWcaEventIcon(e.eventId) ? (
                          <WcaEventIcon eventId={e.eventId} size={20} />
                        ) : (
                          e.eventId.toUpperCase()
                        )}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="oc-v3-dhero-right">
            <div className="oc-v3-statblock">
              <div className="oc-v3-statcell">
                <p
                  style={{
                    font: '500 9px var(--oc-font-mono), monospace',
                    letterSpacing: '.18em',
                    color: '#6E6A62',
                  }}
                >
                  ЭХЛЭХЭД
                </p>
                <div style={{ marginTop: 10 }}>
                  <Countdown startAtMs={startAtMs} />
                </div>
              </div>

              <div className="oc-v3-statdiv" aria-hidden />

              <div className="oc-v3-statcell">
                <p
                  style={{
                    font: '500 9px var(--oc-font-mono), monospace',
                    letterSpacing: '.18em',
                    color: '#6E6A62',
                  }}
                >
                  БҮРТГЭЛ ХААГДАХ
                </p>
                <p
                  style={{
                    marginTop: 10,
                    font: '500 16px var(--oc-font-mono), monospace',
                    fontVariantNumeric: 'tabular-nums',
                    color: '#F4F1EA',
                  }}
                >
                  {fmtDateTime(competition.registrationDeadline)}
                </p>

                {/* Registered counts have no public read path — see
                    CompetitionCells.tsx — so this shows "—" over the real
                    declared capacity and an unfilled track. */}
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #2A2A31' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span
                      style={{
                        font: '500 9px var(--oc-font-mono), monospace',
                        letterSpacing: '.18em',
                        color: '#6E6A62',
                      }}
                    >
                      ТАМИРЧИН
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        font: '700 14px var(--oc-font-mono), monospace',
                        fontVariantNumeric: 'tabular-nums',
                        color: '#F4F1EA',
                      }}
                    >
                      {limit === null ? '—' : `— / ${limit}`}
                    </span>
                  </div>
                  <div className="oc-v3-bar" style={{ marginTop: 8 }} />
                </div>
              </div>
            </div>

            <RegistrationPanel competitionId={competition.id} events={competition.events} />
          </div>
        </header>

        <section>
          <p className="oc-v3-label" style={{ display: 'block', marginBottom: 10 }}>
            Төрлүүд
          </p>
          <div className="oc-v3-event-chip-grid">
            {competition.events.map((e) => (
              <div key={e.eventId} className="oc-v3-event-chip">
                <span style={{ font: '600 13px var(--oc-font-mono), monospace', color: '#F4F1EA' }}>
                  {e.label}
                </span>
                <span style={{ font: '400 11px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
                  {e.rounds} раунд
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </Shell>
  );
}
