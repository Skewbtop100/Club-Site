'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import type { ScramblesOverview } from '@/app/api/online-competition/admin-scrambles/route';
import RegistrationTab from './scrambles/RegistrationTab';
import FileTab from './scrambles/FileTab';
import ScrambleTextTab from './scrambles/ScrambleTextTab';
import GroupsTab from './scrambles/GroupsTab';

// ── Холилт ба групп ──────────────────────────────────────────────────────
// Shell for the four-tab workspace: it owns the competition selection and
// the single overview fetch, and hands the data to whichever tab is open.
// The tabs themselves live in ./scrambles.
//
// All four tabs are always selectable. There is deliberately no "locked
// until the previous step is done" gating and no registration-closed
// state — nothing in the schema records one, and inventing one here would
// misrepresent the data.

const TABS = [
  { id: 'registration', num: '01', label: 'Бүртгэл' },
  { id: 'file', num: '02', label: 'Файл' },
  { id: 'scrambles', num: '03', label: 'Холилт' },
  { id: 'groups', num: '04', label: 'Групп' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ScramblesManager() {
  const [competitions, setCompetitions] = useState<OnlineCompetitionAdminView[] | null>(null);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [tab, setTab] = useState<TabId>('registration');
  const [overview, setOverview] = useState<ScramblesOverview | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/online-competition/admin-competitions')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { competitions: OnlineCompetitionAdminView[] }) => {
        if (cancelled) return;
        const list = d.competitions ?? [];
        setCompetitions(list);
        // Same preference order the review grid uses: the live
        // competition, else the most recently starting one.
        const live = list.find((c) => c.status === 'live');
        const recent = [...list].sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0))[0];
        setCompetitionId((live ?? recent)?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setCompetitions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const competition = competitions?.find((c) => c.id === competitionId) ?? null;

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoadError('');
    try {
      const res = await fetch(
        `/api/online-competition/admin-scrambles?competitionId=${encodeURIComponent(competitionId)}`,
      );
      if (!res.ok) throw new Error('failed');
      setOverview((await res.json()) as ScramblesOverview);
    } catch {
      setOverview(null);
      setLoadError('Холилтын мэдээллийг ачааллаж чадсангүй');
    }
  }, [competitionId]);

  // One fetch per competition, shared by every tab — switching tabs never
  // refetches, switching competitions always does.
  useEffect(() => {
    setOverview(null);
    load();
  }, [load]);

  if (competitions === null) return <p className="oc-v3-status">Ачааллаж байна...</p>;
  if (competitions.length === 0) return <p className="oc-v3-status">Тэмцээн алга.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Competition selector ───────────────────────────────────── */}
      <div className="oc-rv-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <h1 className="oc-v3-title">Холилт ба групп</h1>
          <div className="oc-rv-picker">
            <button type="button" className="oc-rv-picker-btn" onClick={() => setPickerOpen((v) => !v)}>
              {competition?.name ?? 'Тэмцээн сонгох'}
              <span className="oc-v3-tab-caret" aria-hidden>
                ▼
              </span>
            </button>
            {pickerOpen && (
              <div className="oc-rv-menu">
                {competitions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`oc-v3-menu-item${c.id === competitionId ? ' oc-v3-menu-item-active' : ''}`}
                    onClick={() => {
                      setCompetitionId(c.id);
                      setPickerOpen(false);
                    }}
                  >
                    <span aria-hidden style={{ color: c.id === competitionId ? '#DFFF4F' : '#3A3A42' }}>
                      {c.id === competitionId ? '●' : '○'}
                    </span>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="oc-sc-card">
        <div className="oc-sc-tabstrip" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`oc-sc-tab${tab === t.id ? ' oc-sc-tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="oc-sc-tabnum" aria-hidden>
                {t.num}
              </span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="oc-sc-tabbody" role="tabpanel">
          {loadError ? (
            <p className="oc-v3-status-error">{loadError}</p>
          ) : overview === null ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : tab === 'registration' ? (
            <RegistrationTab competition={competition} athletes={overview.athletes} />
          ) : tab === 'file' ? (
            <FileTab competitionId={competitionId} competition={competition} onSaved={load} />
          ) : tab === 'scrambles' ? (
            <ScrambleTextTab competition={competition} scrambleData={overview.scrambleData} />
          ) : (
            <GroupsTab
              competitionId={competitionId}
              competition={competition}
              scrambleData={overview.scrambleData}
              assignments={overview.assignments}
              autoAssignments={overview.autoAssignments}
              athletes={overview.athletes}
              onChanged={load}
            />
          )}
        </div>
      </div>
    </div>
  );
}
