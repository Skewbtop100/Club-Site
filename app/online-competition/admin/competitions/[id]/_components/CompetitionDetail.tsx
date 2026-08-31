'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, EmptyState } from '../../../../_components/ui';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import type { RegistrationAdminView } from '@/app/api/online-competition/admin-competitions/[id]/registrations/route';
import CompetitionForm from '../../../_components/CompetitionForm';
import ReviewDashboard from '../../../_components/ReviewDashboard';

type Tab = 'athletes' | 'review';

export default function CompetitionDetail({ competitionId }: { competitionId: string }) {
  const [competition, setCompetition] = useState<OnlineCompetitionAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('athletes');
  const [editing, setEditing] = useState(false);

  const loadCompetition = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/online-competition/admin-competitions/${competitionId}`);
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { competition: OnlineCompetitionAdminView };
      setCompetition(data.competition);
    } catch {
      setError('Тэмцээний мэдээллийг ачааллаж чадсангүй');
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    loadCompetition();
  }, [loadCompetition]);

  if (loading) return <p className="text-[#8A8474]">Ачааллаж байна...</p>;
  if (error || !competition) {
    return <p className="text-sm text-[#D8402C]">{error || 'Тэмцээн олдсонгүй'}</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginBottom: 20 }}>
        <h1 className="font-[family-name:var(--oc-font-heading)] text-xl font-semibold" style={{ color: 'var(--color-ink)' }}>
          {competition.name}
        </h1>
        <Button variant="outline" onClick={() => setEditing(true)}>
          Засах
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 1, borderBottom: '1px solid #DCD6C8', marginBottom: 24 }}>
        <TabButton active={tab === 'athletes'} onClick={() => setTab('athletes')}>
          Тамирчид
        </TabButton>
        <TabButton active={tab === 'review'} onClick={() => setTab('review')}>
          Шүүгчийн самбар
        </TabButton>
      </div>

      {tab === 'athletes' ? (
        <AthletesTab competition={competition} />
      ) : (
        <ReviewDashboard competitionId={competitionId} />
      )}

      {editing && (
        <CompetitionForm
          competition={competition}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            loadCompetition();
          }}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`oc-tab${active ? ' oc-tab-active' : ''}`}>
      {children}
    </button>
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

  if (error) return <p className="text-sm text-[#D8402C]">{error}</p>;
  if (registrations === null) return <p className="text-[#8A8474]">Ачааллаж байна...</p>;

  return (
    <div className="flex flex-col gap-8">
      {competition.events.map((eventConfig) => {
        const athletes = registrations.filter((r) => r.events.includes(eventConfig.eventId));
        return (
          <div key={eventConfig.eventId}>
            <span className="font-[family-name:var(--oc-font-mono)] text-xs font-medium uppercase tracking-[.14em] text-[#8A8474]">
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
