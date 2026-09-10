'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../../../../_components/ui';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import type { RegistrationAdminView } from '@/app/api/online-competition/admin-competitions/[id]/registrations/route';
import Link from 'next/link';
import RoundGapWarning from '../../../_components/RoundGapWarning';

export default function CompetitionDetail({ competitionId }: { competitionId: string }) {
  const [competition, setCompetition] = useState<OnlineCompetitionAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCompetition = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/online-competition/admin-competitions/${competitionId}`);
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { competition: OnlineCompetitionAdminView };
      setCompetition(data.competition);
    } catch (err) {
      console.error('CompetitionDetail: loading the competition failed:', err);
      setError('Тэмцээний мэдээллийг ачааллаж чадсангүй');
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    loadCompetition();
  }, [loadCompetition]);

  if (loading) return <p className="text-[#6E6A62]">Ачааллаж байна...</p>;
  if (error || !competition) {
    return <p className="text-sm text-[#E8543C]">{error || 'Тэмцээн олдсонгүй'}</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginBottom: 20 }}>
        <h1 className="font-[family-name:var(--oc-font-heading)] text-xl font-semibold" style={{ color: 'var(--color-ink)' }}>
          {competition.name}
        </h1>
        {/* The editor is its own route now (the tabbed form). This page
            keeps only the registrations view. */}
        <Link className="oc-btn oc-btn-outline" href={`/online-competition/admin/competitions/${competitionId}/edit`}>
          Засах
        </Link>
      </div>

      {/* Live, but at least one event has no round open — athletes on
          those events get a blocked screen, so this sits above the tab
          bar rather than inside the tab's content. */}
      {competition.status === 'live' && (
        <RoundGapWarning
          events={competition.eventsWithoutLiveRound ?? []}
          style={{ marginBottom: 20 }}
        />
      )}

      {/* Review lives at /admin/review now — one destination, with this
          competition preselected in its dropdown. The duplicate
          "Шүүгчийн самбар" tab that used to sit here is gone. */}
      <div className="oc-adm-tabbar" style={{ marginBottom: 24 }}>
        <span className="oc-tab oc-tab-active">Тамирчид</span>
        <span style={{ flex: 1 }} />
        <Link
          href={`/online-competition/admin/review?competitionId=${competitionId}`}
          className="oc-v3-row-action"
          style={{ width: 'auto', alignSelf: 'center', marginBottom: 6 }}
        >
          БИЧЛЭГ ШҮҮХ →
        </Link>
      </div>

      <AthletesTab competition={competition} />
    </div>
  );
}

/** Registered athletes for this competition, grouped by event (in the
 *  competition's own configured event order) — a simple displayName list
 *  per group, empty state per group with zero registrants. */
function AthletesTab({ competition }: { competition: OnlineCompetitionAdminView }) {
  const [registrations, setRegistrations] = useState<RegistrationAdminView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setRegistrations(null);
    setError('');
    fetch(`/api/online-competition/admin-competitions/${competition.id}/registrations`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json() as Promise<{ registrations: RegistrationAdminView[] }>;
      })
      .then((data) => {
        if (!cancelled) setRegistrations(data.registrations);
      })
      .catch(() => {
        if (!cancelled) setError('Бүртгэлийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, [competition.id]);

  if (error) return <p className="text-sm text-[#E8543C]">{error}</p>;
  if (registrations === null) return <p className="text-[#6E6A62]">Ачааллаж байна...</p>;

  return (
    <div className="flex flex-col gap-8">
      {competition.events.map((eventConfig) => {
        const athletes = registrations.filter((r) => r.events.includes(eventConfig.eventId));
        return (
          <div key={eventConfig.eventId}>
            <span className="oc-v3-label">
              {eventConfig.label}
            </span>
            <div style={{ marginTop: 10 }}>
              {athletes.length === 0 ? (
                <EmptyState text="Бүртгүүлсэн тамирчин алга." />
              ) : (
                <div className="oc-table">
                  {athletes.map((a) => (
                    <div key={a.uid} className="oc-table-row" style={{ gridTemplateColumns: '1fr' }}>
                      <span className="oc-table-name">{a.displayName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
