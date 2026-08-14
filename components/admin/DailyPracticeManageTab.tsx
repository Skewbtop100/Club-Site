'use client';

import { useEffect, useMemo, useState } from 'react';
import { subscribeResultsByComp, deleteResult } from '@/lib/firebase/services/results';
import { DAILY_PRACTICE_COMPETITION_ID } from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import { useLang } from '@/lib/i18n';
import PracticeEditModal from '@/components/admin/PracticeEditModal';
import type { Athlete, Result } from '@/lib/types';

function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (typeof ts === 'number') return ts;
  return 0;
}

export default function DailyPracticeManageTab() {
  const { t } = useLang();
  const [results, setResults] = useState<Result[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [editingResult, setEditingResult] = useState<Result | null>(null);

  const [deleteMode, setDeleteMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmTarget, setConfirmTarget] = useState<'selected' | Result | null>(null);
  const [deleteWorking, setDeleteWorking] = useState(false);

  useEffect(() => {
    getAthletes().then(setAthletes);
    const unsub = subscribeResultsByComp(DAILY_PRACTICE_COMPETITION_ID, (data) => {
      setResults(data);
      setLoading(false);
    });
    return unsub;
  }, []);

  const athleteNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    athletes.forEach(a => { m[a.id] = (a.name || '') + (a.lastName ? ' ' + a.lastName : ''); });
    return m;
  }, [athletes]);

  const eventNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    WCA_EVENTS.forEach(e => { m[e.id] = e.name; });
    return m;
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results
      .filter(r => {
        if (q) {
          const name = (athleteNameMap[r.athleteId] || r.athleteName || '').toLowerCase();
          if (!name.includes(q)) return false;
        }
        if (dateFrom && (r.practiceDate || '') < dateFrom) return false;
        if (dateTo && (r.practiceDate || '') > dateTo) return false;
        return true;
      })
      .sort((a, b) => {
        const d = (b.practiceDate || '').localeCompare(a.practiceDate || '');
        return d !== 0 ? d : toMillis(b.submittedAt) - toMillis(a.submittedAt);
      });
  }, [results, search, dateFrom, dateTo, athleteNameMap]);

  function toggleSelected(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function doDelete() {
    if (!confirmTarget) return;
    setDeleteWorking(true);
    try {
      const ids = confirmTarget === 'selected' ? [...selected] : [confirmTarget.id];
      await Promise.all(ids.map(id => deleteResult(id)));
      setSelected(new Set());
      setDeleteMode(false);
      setConfirmTarget(null);
    } catch { /* ignore — live subscription reflects whatever actually succeeded */ }
    finally { setDeleteWorking(false); }
  }

  const deleteCount = confirmTarget === 'selected' ? selected.size : confirmTarget ? 1 : 0;

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />{t('admin.tab.daily-practice')}</div>

      {/* Filters */}
      <div className="dpm-filters">
        <div className="form-group" style={{ marginBottom: 0, flex: 2, minWidth: '180px' }}>
          <label>{t('admin.dpm.search-label')}</label>
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('admin.dpm.search-placeholder')}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
          <label>{t('admin.dpm.date-from')}</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
          <label>{t('admin.dpm.date-to')}</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {(search || dateFrom || dateTo) && (
          <button className="btn-xs" style={{ alignSelf: 'flex-end', marginBottom: '0.05rem' }}
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); }}>
            {t('admin.dpm.clear-filters')}
          </button>
        )}
      </div>

      {/* Delete mode toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.6rem' }}>
        {deleteMode ? (
          <>
            <button className="btn-xs" onClick={() => { setDeleteMode(false); setSelected(new Set()); }}>
              {t('admin.btn.cancel')}
            </button>
            <button
              className="btn-xs danger-outline"
              disabled={selected.size === 0}
              onClick={() => selected.size > 0 && setConfirmTarget('selected')}
            >
              {t('admin.cr.btn.delete-selected')} ({selected.size})
            </button>
          </>
        ) : (
          <button className="btn-xs danger-outline" onClick={() => { setDeleteMode(true); setSelected(new Set()); }}>
            {t('admin.cr.btn.delete-mode')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="spinner-row">{t('admin.loading')}<span className="spinner-ring" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">{t('admin.dpm.empty')}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {deleteMode && <th></th>}
                <th>{t('admin.dpm.col.date')}</th>
                <th>{t('admin.dpm.col.athlete')}</th>
                <th>{t('admin.dpm.col.event')}</th>
                <th className="r">{t('admin.results.ao5')}</th>
                <th>{t('admin.label.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const isChecked = selected.has(r.id);
                return (
                  <tr key={r.id} style={deleteMode && isChecked ? { background: 'rgba(239,68,68,0.06)' } : undefined}>
                    {deleteMode && (
                      <td>
                        <input type="checkbox" checked={isChecked} onChange={() => toggleSelected(r.id)} />
                      </td>
                    )}
                    <td className="td-muted">{r.practiceDate || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{athleteNameMap[r.athleteId] || r.athleteName || r.athleteId}</td>
                    <td className="td-muted">{eventNameMap[r.eventId] || r.eventId}</td>
                    <td className={`r mono bold${r.average != null && r.average < 0 ? '' : ''}`} style={{ color: r.average != null && r.average < 0 ? '#f87171' : undefined }}>
                      {fmtTime(r.average)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button className="btn-xs" onClick={() => setEditingResult(r)}>{t('admin.btn.edit')}</button>
                        <button className="btn-xs danger-outline" onClick={() => setConfirmTarget(r)}>{t('admin.btn.delete')}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingResult && (
        <PracticeEditModal
          result={editingResult}
          athleteName={athleteNameMap[editingResult.athleteId] || editingResult.athleteName || editingResult.athleteId}
          eventName={eventNameMap[editingResult.eventId] || editingResult.eventId}
          onClose={() => setEditingResult(null)}
        />
      )}

      {/* Delete confirmation modal — reuses CompResultsTab's pattern */}
      {confirmTarget && (
        <div onClick={() => !deleteWorking && setConfirmTarget(null)} className="wca-modal-backdrop">
          <div onClick={e => e.stopPropagation()} className="wca-modal" style={{ borderColor: 'rgba(239,68,68,0.35)' }}>
            <div className="wca-modal-title">{t('admin.cr.delete.title')}</div>
            <div className="wca-modal-sub" style={{ marginBottom: '1.25rem' }}>
              <strong style={{ color: 'var(--text)' }}>
                {deleteCount} {deleteCount === 1 ? t('admin.cr.delete.result-1') : t('admin.cr.delete.result-n')}
              </strong>
              {' '}— {t('admin.cr.delete.warning')}
            </div>
            <div className="wca-modal-actions">
              <button onClick={() => setConfirmTarget(null)} disabled={deleteWorking} className="wca-modal-btn">
                {t('admin.btn.cancel')}
              </button>
              <button
                onClick={doDelete} disabled={deleteWorking} className="wca-modal-btn danger"
                style={{ background: deleteWorking ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.75)', borderColor: 'rgba(239,68,68,0.6)' }}
              >
                {deleteWorking ? t('admin.cr.delete.deleting') : `${t('admin.btn.delete')} ${deleteCount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dpm-filters { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 1rem; align-items: flex-end; }
        .danger-outline { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.35); color: #f87171; }
        .danger-outline:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
