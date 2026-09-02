'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { fetchCompetition } from '@/lib/online-competition/data';
import type { OnlineCompetition, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import { fmtDateTime, toMillisOrNull } from '../../_components/hub/format';
import NavBar from '../../_components/hub/NavBar';
import Countdown from './_components/Countdown';
import RegistrationPanel from './_components/RegistrationPanel';

const STATUS_LABEL: Record<OnlineCompetitionStatus, string> = {
  upcoming: 'Удахгүй болох',
  live: 'Явагдаж буй',
  finished: 'Дууссан',
};

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
      <div className="min-h-screen w-full" style={{ background: '#FFFDF8' }}>
        <NavBar />
        <p style={{ padding: 24, font: '400 13px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>{error}</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen w-full" style={{ background: '#FFFDF8' }}>
        <NavBar />
        <p style={{ padding: 24, font: '400 13px var(--oc-font-heading), sans-serif', color: '#8A8474' }}>
          Тэмцээн олдсонгүй.
        </p>
      </div>
    );
  }

  if (!competition) {
    return (
      <div className="min-h-screen w-full" style={{ background: '#FFFDF8' }}>
        <NavBar />
        <p style={{ padding: 24, font: '400 13px var(--oc-font-heading), sans-serif', color: '#8A8474' }}>
          Ачааллаж байна...
        </p>
      </div>
    );
  }

  const startAtMs = toMillisOrNull(competition.startAt);
  const limit = competition.participantLimit ?? null;
  // Placeholder — real registration counts arrive in Phase 3, once
  // registering actually writes to onlineParticipants. Nobody can be
  // registered yet, so 0 is accurate today, not just a stub value.
  const registeredCount = 0;
  const progressPct = limit ? Math.min(100, Math.round((registeredCount / limit) * 100)) : 0;

  return (
    <div className="min-h-screen w-full" style={{ background: '#FFFDF8' }}>
      <NavBar />
      <header className="oc-detail-header">
        <div>
          <Link
            href="/online-competition"
            style={{
              display: 'inline-block',
              marginBottom: 12,
              font: '400 11px var(--oc-font-mono), monospace',
              color: '#8A8474',
            }}
          >
            ← Тэмцээнүүд
          </Link>
          <div>
            <span className="oc-detail-status-badge">{STATUS_LABEL[competition.status]}</span>
          </div>
          <p style={{ marginTop: 10, font: '600 30px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
            {competition.name}
          </p>
          <p style={{ marginTop: 8, font: '400 12px var(--oc-font-mono), monospace', color: '#8A8474' }}>
            {fmtDateTime(competition.startAt)}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.18em', color: '#8A8474' }}>
            ЭХЛЭХЭД
          </p>
          <p
            style={{
              marginTop: 6,
              font: '700 26px var(--oc-font-mono), monospace',
              color: '#DFFF4F',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <Countdown startAtMs={startAtMs} />
          </p>
        </div>
      </header>

      <div className="oc-detail-info-strip">
        <div className="oc-detail-info-cell">
          <p className="oc-mono-label">Бүртгэл хаагдах</p>
          <p style={{ marginTop: 8, font: '500 15px var(--oc-font-mono), monospace', color: '#16140F' }}>
            {fmtDateTime(competition.registrationDeadline)}
          </p>
        </div>
        <div className="oc-detail-info-cell">
          <p className="oc-mono-label">Тамирчны хязгаар</p>
          <p
            style={{
              marginTop: 8,
              font: '700 15px var(--oc-font-mono), monospace',
              color: '#16140F',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {limit === null ? 'Хязгааргүй' : `${registeredCount} / ${limit}`}
          </p>
          {limit !== null && (
            <div className="oc-detail-progress-track" style={{ marginTop: 8 }}>
              <div className="oc-detail-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          )}
        </div>
        <div className="oc-detail-info-cell">
          <p className="oc-mono-label">Шүүлт</p>
          <p style={{ marginTop: 8, font: '400 12px var(--oc-font-heading), sans-serif', color: '#4C473C' }}>
            Бичлэг бүрийг шүүгч хянана
          </p>
        </div>
      </div>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <section>
          <p className="oc-mono-label" style={{ marginBottom: 10 }}>
            Төрлүүд
          </p>
          <div className="oc-event-chip-grid">
            {competition.events.map((e) => (
              <div key={e.eventId} className="oc-event-chip">
                <span style={{ font: '600 14px var(--oc-font-mono), monospace', color: '#16140F' }}>
                  {e.eventId.toUpperCase()}
                </span>
                <span style={{ font: '400 11px var(--oc-font-mono), monospace', color: '#8A8474' }}>
                  {e.rounds} раунд
                </span>
              </div>
            ))}
          </div>
        </section>

        <RegistrationPanel competitionId={competition.id} events={competition.events} />
      </div>
    </div>
  );
}
