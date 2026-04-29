'use client';

import { useEffect, useState } from 'react';
import {
  subscribeAthletes,
  addAthlete,
  updateAthlete,
  deleteAthlete,
} from '@/lib/firebase/services/athletes';
import { useLang } from '@/lib/i18n';
import type { Athlete } from '@/lib/types';

const emptyForm = { wcaId: '', lastName: '', name: '', birthDate: '', imageUrl: '' };

export default function AthletesTab() {
  const { t } = useLang();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState(''); const [msgType, setMsgType] = useState('');

  useEffect(() => {
    const unsub = subscribeAthletes(
      (data) => { setAthletes(data); setLoading(false); },
    );
    return unsub;
  }, []);

  function showMsg(type: string, text: string) {
    setMsgType(type); setMsg(text);
    setTimeout(() => setMsg(''), 5000);
  }

  function startEdit(a: Athlete) {
    setEditId(a.id);
    setForm({ wcaId: a.wcaId || '', lastName: a.lastName || '', name: a.name, birthDate: a.birthDate || '', imageUrl: a.imageUrl || '' });
  }

  function cancelEdit() { setEditId(null); setForm({ ...emptyForm }); }

  async function submitAthlete() {
    if (!form.name || !form.birthDate) { showMsg('error', t('admin.ath.msg.required')); return; }
    try {
      if (editId) {
        await updateAthlete(editId, form);
        showMsg('success', t('admin.ath.msg.updated'));
      } else {
        await addAthlete(form);
        showMsg('success', t('admin.ath.msg.added'));
      }
      cancelEdit();
    } catch (e: unknown) {
      showMsg('error', t('admin.msg.error-prefix') + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('admin.ath.confirm-delete'))) return;
    try {
      await deleteAthlete(id);
      showMsg('success', t('admin.ath.msg.deleted'));
    } catch (e: unknown) {
      showMsg('error', t('admin.msg.error-prefix') + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div>
      {/* Add / Edit Form */}
      <div className="card">
        <div className="card-title"><span className="title-accent" />{editId ? t('admin.ath.edit-title') : t('admin.ath.add-title')}</div>
        <div className="form-grid">
          <div className="form-group">
            <label>{t('admin.ath.wca-id')}</label>
            <input className="monospace" type="text" value={form.wcaId} placeholder="e.g. 2019GANT01"
              onChange={e => setForm(f => ({ ...f, wcaId: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>{t('admin.ath.last-name')}</label>
            <input type="text" value={form.lastName}
              onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>{t('admin.ath.full-name')}</label>
            <input type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>{t('admin.ath.birth-date')}</label>
            <input type="date" value={form.birthDate}
              onChange={e => setForm(f => ({ ...f, birthDate: e.target.value }))} />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('admin.ath.image-url')}</label>
            <input type="url" value={form.imageUrl} placeholder="https://example.com/photo.jpg"
              onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-sm-primary" onClick={submitAthlete}>{editId ? t('admin.btn.save-changes') : t('admin.ath.btn.add')}</button>
          {editId && <button className="btn-sm-secondary" onClick={cancelEdit}>{t('admin.btn.cancel-edit')}</button>}
        </div>
        {msg && <div className={`msg ${msgType}`} style={{ display: 'block' }}>{msg}</div>}
      </div>

      {/* Athletes Table */}
      <div className="card">
        <div className="card-title"><span className="title-accent" />{t('admin.ath.list-title')}</div>
        {loading
          ? <div className="spinner-row">{t('admin.ath.loading')}<span className="spinner-ring" /></div>
          : athletes.length === 0
            ? <div className="empty-state">{t('admin.ath.empty')}</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('admin.ath.col.name')}</th>
                      <th>{t('admin.ath.col.last-name')}</th>
                      <th>{t('admin.ath.col.wca-id')}</th>
                      <th>{t('admin.ath.col.birth-date')}</th>
                      <th>{t('admin.label.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {athletes
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(a => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 600 }}>{`${a.name || ''}${a.lastName ? ' ' + a.lastName : ''}`}</td>
                          <td className="td-muted">{a.lastName || '—'}</td>
                          <td><code style={{ fontSize: '0.82rem', color: '#a78bfa' }}>{a.wcaId || '—'}</code></td>
                          <td className="td-muted">{a.birthDate || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button className="btn-edit" onClick={() => startEdit(a)}>{t('admin.btn.edit')}</button>
                              <button className="btn-delete" onClick={() => handleDelete(a.id)}>{t('admin.btn.delete')}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
        }
      </div>
    </div>
  );
}
