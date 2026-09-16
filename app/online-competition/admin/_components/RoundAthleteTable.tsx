'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RoundDetailView } from '@/app/api/online-competition/admin-rounds/detail/route';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';

// ── One round, athlete by athlete ───────────────────────────────────────
// Opened from a round's row. A column per attempt, a state per athlete, and
// four filter tabs — which is the admin's actual question mid-round: who has
// not finished, and what is sitting in the judge's queue.
//
// It fetches its own round from /admin-rounds/detail rather than being
// handed rows by the list, because the list deliberately returns counts
// only: sending every athlete of every round would grow that payload with
// the competition. Both call roundRosterProgress over the same roster rule,
// so the numbers here and the numbers in the row above cannot disagree.

type Filter = 'all' | 'incomplete' | 'awaiting' | 'complete';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'БҮГД' },
  { key: 'incomplete', label: 'ДУУСГААГҮЙ' },
  { key: 'awaiting', label: 'ХҮЛЭЭГДЭЖ БУЙ' },
  { key: 'complete', label: 'ДУУСГАСАН' },
];

const STATE_LABEL: Record<string, string> = {
  complete: 'ДУУСГАСАН',
  awaiting: 'ХҮЛЭЭГДЭЖ БУЙ',
  incomplete: 'ДУУСГААГҮЙ',
};
const STATE_TONE: Record<string, string> = {
  complete: '#4FD07A',
  awaiting: '#DFFF4F',
  incomplete: '#9A958A',
};

export default function RoundAthleteTable({
  competitionId,
  eventId,
  round,
}: {
  competitionId: string;
  eventId: string;
  round: number;
}) {
  const [view, setView] = useState<RoundDetailView | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setError('');
    const q = new URLSearchParams({ competitionId, eventId, round: String(round) });
    fetch(`/api/online-competition/admin-rounds/detail?${q.toString()}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as (RoundDetailView & { error?: string }) | null;
        if (cancelled) return;
        if (!res.ok || !data) {
          setError(data?.error ?? 'Тамирчдын мэдээллийг ачааллаж чадсангүй');
          return;
        }
        setView(data);
      })
      .catch((err) => {
        console.error('RoundAthleteTable: loading the round detail failed:', err);
        if (!cancelled) setError('Тамирчдын мэдээллийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId, eventId, round]);

  const counts = useMemo(() => {
    const rows = view?.athletes ?? [];
    return {
      all: rows.length,
      incomplete: rows.filter((a) => a.state === 'incomplete').length,
      awaiting: rows.filter((a) => a.state === 'awaiting').length,
      complete: rows.filter((a) => a.state === 'complete').length,
    };
  }, [view]);

  if (error) return <p className="oc-sc-msg-err" style={{ margin: '0 14px 12px' }}>{error}</p>;
  if (!view) return <p className="oc-v3-status" style={{ padding: '0 14px 12px' }}>Ачааллаж байна...</p>;

  const shown = filter === 'all' ? view.athletes : view.athletes.filter((a) => a.state === filter);

  return (
    <div style={{ padding: '0 14px 14px' }}>
      <div className="oc-rd-tabs" role="tablist" aria-label="Тамирчдыг шүүх">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`oc-rd-tab${filter === f.key ? ' oc-rd-tab-on' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span style={{ marginLeft: 6, color: '#6E6A62', fontVariantNumeric: 'tabular-nums' }}>
              {counts[f.key]}
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="oc-sc-empty" style={{ marginTop: 12 }}>
          {view.participants === 0
            ? 'Энэ раундад тамирчин байхгүй.'
            : 'Энэ шүүлтэд тохирох тамирчин алга.'}
        </p>
      ) : (
        <div className="oc-cd-table-wrap" style={{ marginTop: 12 }}>
          <table className="oc-rd-table">
            <thead>
              <tr>
                <th scope="col">ТАМИРЧИН</th>
                {Array.from({ length: view.attempts }, (_, i) => (
                  <th key={i} scope="col" className="oc-rd-th-num">
                    {i + 1}
                  </th>
                ))}
                <th scope="col" className="oc-rd-th-num">
                  ФАЙЛ
                </th>
                <th scope="col">ТӨЛӨВ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.uid}>
                  <td className="oc-rd-td-name">{a.displayName}</td>
                  {Array.from({ length: view.attempts }, (_, i) => {
                    const cell = a.cells[i] ?? null;
                    const pending = a.pendingSlots.includes(i + 1);
                    // Past what a cut-off athlete owed: not an empty slot
                    // they still have to fill, so it reads as struck out
                    // rather than missing.
                    const beyondCut = a.cutOff && i + 1 > a.expected;
                    return (
                      <td
                        key={i}
                        className="oc-rd-td-num"
                        style={{
                          color: pending
                            ? '#DFFF4F'
                            : cell === 'DNF'
                              ? '#E8543C'
                              : cell !== null
                                ? '#F4F1EA'
                                : '#2A2A31',
                        }}
                        title={pending ? 'Шүүгчийг хүлээж байна' : undefined}
                      >
                        {pending ? '•••' : cell === 'DNF' ? 'DNF' : cell !== null ? fmtCentiseconds(cell) : beyondCut ? '–' : '·'}
                      </td>
                    );
                  })}
                  <td
                    className="oc-rd-td-num"
                    style={{ color: a.filed >= a.expected ? '#9A958A' : '#F4F1EA' }}
                  >
                    {a.filed}/{a.expected}
                  </td>
                  <td>
                    <span
                      style={{
                        font: '500 9px var(--oc-font-mono), monospace',
                        letterSpacing: '.08em',
                        color: STATE_TONE[a.state],
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {STATE_LABEL[a.state]}
                      {/* A cut-off athlete is complete on fewer attempts
                          than the format's count. Correct, and it looks
                          wrong, so the row says why. */}
                      {a.cutOff && <span style={{ color: '#6E6A62' }}> · ХЯЗГААР</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
