'use client';

import { useEffect, useState } from 'react';
import {
  subscribeAthletes,
  addAthlete,
  updateAthlete,
  deleteAthlete,
} from '@/lib/firebase/services/athletes';
import type { Athlete } from '@/lib/types';

const emptyForm = { wcaId: '', lastName: '', name: '', birthDate: '', imageUrl: '' };

export default function AthletesTab() {
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
    if (!form.name || !form.birthDate) { showMsg('error', 'Name and Birth Date are required.'); return; }
    try {
      if (editId) {
        await updateAthlete(editId, form);
        showMsg('success', 'Athlete updated.');
      } else {
        await addAthlete(form);
        showMsg('success', 'Athlete added.');
      }
      cancelEdit();
    } catch (e: unknown) {
      showMsg('error', 'Error: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this athlete? This cannot be undone.')) return;
    try {
      await deleteAthlete(id);
      showMsg('success', 'Athlete deleted.');
    } catch (e: unknown) {
      showMsg('error', 'Error: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div>
      {/* Add / Edit Form */}
      <div className="card">
        <div className="card-title"><span className="title-accent" />{editId ? 'Edit Athlete' : 'Add Athlete'}</div>
        <div className="form-grid">
          <div className="form-group">
            <label>WCA ID</label>
            <input className="monospace" type="text" value={form.wcaId} placeholder="e.g. 2019GANT01"
              onChange={e => setForm(f => ({ ...f, wcaId: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Last Name (Овог) *</label>
            <input type="text" value={form.lastName} placeholder="Last name"
              onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Full Name *</label>
            <input type="text" value={form.name} placeholder="Full name"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Birth Date *</label>
            <input type="date" value={form.birthDate}
              onChange={e => setForm(f => ({ ...f, birthDate: e.target.value }))} />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Profile Image URL</label>
            <input type="url" value={form.imageUrl} placeholder="https://example.com/photo.jpg"
              onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-sm-primary" onClick={submitAthlete}>{editId ? 'Save Changes' : 'Add Athlete'}</button>
          {editId && <button className="btn-sm-secondary" onClick={cancelEdit}>Cancel Edit</button>}
        </div>
        {msg && <div className={`msg ${msgType}`} style={{ display: 'block' }}>{msg}</div>}
      </div>

      {/* Athletes Table */}
      <div className="card">
        <div className="card-title"><span className="title-accent" />All Athletes</div>
        {loading
          ? <div className="spinner-row">Loading athletes<span className="spinner-ring" /></div>
          : athletes.length === 0
            ? <div className="empty-state">No athletes yet.</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Last Name</th>
                      <th>WCA ID</th>
                      <th>Birth Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {athletes
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(a => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 600 }}>{a.name}</td>
                          <td className="td-muted">{a.lastName || '—'}</td>
                          <td><code style={{ fontSize: '0.82rem', color: '#a78bfa' }}>{a.wcaId || '—'}</code></td>
                          <td className="td-muted">{a.birthDate || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button className="btn-edit" onClick={() => startEdit(a)}>Edit</button>
                              <button className="btn-delete" onClick={() => handleDelete(a.id)}>Delete</button>
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
