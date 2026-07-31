'use client';

// Admin/judge entry for the Practice Log — records a daily Ao5 on behalf of
// an athlete the admin is standing with in person. Athlete-picker mirrors
// ResultsEntryTab's `<select>` (components/admin/ResultsEntryTab.tsx:615),
// same sort-by-name + "name + lastName" rendering; the actual entry UI is
// PracticeEntryPanel (mode="admin"), shared with the self-entry /practice page.

import { useEffect, useState } from 'react';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { useLang } from '@/lib/i18n';
import type { Athlete } from '@/lib/types';
import PracticeEntryPanel from '@/components/practice/PracticeEntryPanel';

export default function PracticeEntryTab() {
  const { t } = useLang();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [athleteId, setAthleteId] = useState('');

  useEffect(() => {
    getAthletes().then(setAthletes).catch(() => {});
  }, []);

  const selected = athletes.find((a) => a.id === athleteId);
  const selectedName = selected ? `${selected.name || ''}${selected.lastName ? ' ' + selected.lastName : ''}`.trim() : '';

  return (
    <>
      <div className="card">
        <div className="card-title"><span className="title-accent" />{t('admin.practice.title')}</div>

        <div className="form-group" style={{ maxWidth: 340, marginBottom: 0 }}>
          <label>{t('admin.practice.athlete-label')}</label>
          <select value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
            <option value="">{t('admin.practice.select-athlete')}</option>
            {[...athletes].sort((a, b) => a.name.localeCompare(b.name)).map((a) => (
              <option key={a.id} value={a.id}>{`${a.name || ''}${a.lastName ? ' ' + a.lastName : ''}`}</option>
            ))}
          </select>
        </div>

        {!athleteId && (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
            {t('admin.practice.select-athlete-prompt')}
          </div>
        )}
      </div>

      {athleteId && (
        <div style={{ marginTop: '1rem' }}>
          <PracticeEntryPanel key={athleteId} athleteId={athleteId} athleteName={selectedName} mode="admin" />
        </div>
      )}
    </>
  );
}
