'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, type BadgeSpec } from '../../_components/ui';
import type { OnlineCompetitionAdminView, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import CompetitionForm from './CompetitionForm';

const STATUS_LABEL: Record<OnlineCompetitionStatus, string> = {
  upcoming: 'Удахгүй болох',
  live: 'Явагдаж буй',
  finished: 'Дууссан',
};

// Exact literal colors from the approved mockup — not derived from the
// --color-* token block (see theme.css's top comment for why).
const STATUS_BADGE: Record<OnlineCompetitionStatus, BadgeSpec> = {
  upcoming: { borderColor: '#DCD6C8', background: 'transparent', color: '#8A8474' },
  live: { borderColor: '#16140F', background: '#DFFF4F', color: '#16140F' },
  finished: { borderColor: '#8A8474', background: 'transparent', color: '#8A8474' },
};

function fmtDateTime(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type FormTarget = 'closed' | 'create' | OnlineCompetitionAdminView;

export default function CompetitionsTab() {
  const [competitions, setCompetitions] = useState<OnlineCompetitionAdminView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formTarget, setFormTarget] = useState<FormTarget>('closed');
  const [recomputingId, setRecomputingId] = useState<string | null>(null);
  const [recomputeMsg, setRecomputeMsg] = useState<{ id: string; text: string; isError: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-competitions');
      if (!res.ok) throw new Error('failed');
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
      const data = (await res.json()) as { season?: string; athletesUpdated?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setRecomputeMsg({
        id: competitionId,
        text: `Шинэчлэгдлээ: ${data.athletesUpdated} тамирчин (${data.season})`,
        isError: false,
      });
    } catch (err) {
      setRecomputeMsg({
        id: competitionId,
        text: err instanceof Error && err.message === 'Competition has no season set'
          ? 'Энэ тэмцээнд сезон тохируулаагүй байна'
          : 'Онооны тооцоо шинэчлэхэд алдаа гарлаа',
        isError: true,
      });
    } finally {
      setRecomputingId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginBottom: 24 }}>
        <span className="font-[family-name:var(--oc-font-mono)] text-xs font-medium uppercase tracking-[.14em] text-[#8A8474]">
          Тэмцээнүүд
        </span>
        <Button variant="primary" onClick={() => setFormTarget('create')}>
          Шинэ тэмцээн
        </Button>
      </div>

      {error && (
        <p className="text-sm text-[#D8402C]" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-[#8A8474]">Ачааллаж байна...</p>
      ) : competitions.length === 0 ? (
        <EmptyState text="Тэмцээн алга." />
      ) : (
        <div className="oc-table">
          <div className="oc-table-header">
            <span>Нэр</span>
            <span>Эхлэх</span>
            <span>Статус</span>
            <span>Тамирчин</span>
            <span />
          </div>
          {competitions.map((c) => {
            // Cheap defensive fallback — the admin-competitions API already
            // normalizes `status` (normalizeCompetitionStatus), but this
            // keeps the badge from ever indexing undefined if that ever
            // changes some other way.
            const badge = STATUS_BADGE[c.status] ?? STATUS_BADGE.upcoming;
            const label = STATUS_LABEL[c.status] ?? c.status;
            return (
              <div key={c.id}>
                <div className="oc-table-row">
                  <span className="oc-table-name">{c.name}</span>
                  <span className="oc-table-date">{fmtDateTime(c.startAt)}</span>
                  <span>
                    <Badge {...badge} padding="5px 7px">
                      {label}
                    </Badge>
                  </span>
                  <span className="oc-table-count">{c.participantCount}</span>
                  <span>
                    <Button variant="outline" className="oc-btn-sm" onClick={() => setFormTarget(c)}>
                      Засах
                    </Button>
                  </span>
                </div>

                {/* Its own strip below the row, not squeezed into the 80px
                    edit-button column — "Онооны тооцоо шинэчлэх" is far
                    too long a label to fit that column's fixed width. */}
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
                        style={{ color: recomputeMsg.isError ? '#D8402C' : 'var(--color-ink-soft)' }}
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

      {formTarget !== 'closed' && (
        <CompetitionForm
          competition={formTarget === 'create' ? null : formTarget}
          onClose={() => setFormTarget('closed')}
          onSaved={() => {
            setFormTarget('closed');
            load();
          }}
        />
      )}
    </div>
  );
}
