'use client';

import { useEffect, useState } from 'react';
import {
  subscribeUsers,
  addUser,
  updateUser,
  deleteUser,
  type AppUser,
} from '@/lib/firebase/services/users';
import { getAthletes } from '@/lib/firebase/services/athletes';
import type { Athlete } from '@/lib/types';

const ROLES = ['athlete', 'results_entry'];
const emptyForm = { username: '', password: '', role: 'athlete', athleteId: '' };

export default function UsersTab() {
  const [users, setUsers]       = useState<AppUser[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading]   = useState(true);
  const [form, setForm]         = useState({ ...emptyForm });
  const [editId, setEditId]     = useState<string | null>(null);
  const [msg, setMsg]           = useState(''); const [msgType, setMsgType] = useState('');

  useEffect(() => {
    getAthletes().then(setAthletes);
    const unsub = subscribeUsers(
      (data) => { setUsers(data); setLoading(false); },
    );
    return unsub;
  }, []);

  function showMsg(type: string, text: string) { setMsgType(type); setMsg(text); setTimeout(() => setMsg(''), 5000); }

  function startEdit(u: AppUser) {
    setEditId(u.id);
    setForm({ username: u.username, password: '', role: u.role, athleteId: u.athleteId || '' });
  }
  function cancelEdit() { setEditId(null); setForm({ ...emptyForm }); }

  async function handleAdd() {
    if (!form.username || !form.password) { showMsg('error', 'Username and password are required.'); return; }
    try {
      await addUser({
        username: form.username, password: form.password,
        role: form.role, athleteId: form.athleteId || null,
      });
      showMsg('success', 'User created.');
      setForm({ ...emptyForm });
    } catch (e: unknown) { showMsg('error', 'Error: ' + (e instanceof Error ? e.message : String(e))); }
  }

  async function handleEdit() {
    if (!editId) return;
    const upd: Partial<AppUser> = { username: form.username, role: form.role, athleteId: form.athleteId || null };
    if (form.password) upd.password = form.password;
    try {
      await updateUser(editId, upd);
      showMsg('success', 'User updated.');
      cancelEdit();
    } catch (e: unknown) { showMsg('error', 'Error: ' + (e instanceof Error ? e.message : String(e))); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this user?')) return;
    try { await deleteUser(id); } catch { /* ignore */ }
  }

  return (
    <div>
      {/* Add / Edit Form */}
      <div className="card">
        <div className="card-title"><span className="title-accent" />{editId ? 'Edit User' : 'Add User'}</div>
        <div className="form-grid">
          <div className="form-group">
            <label>Username *</label>
            <input className="monospace" type="text" value={form.username} placeholder="username"
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>{editId ? 'New Password (leave blank to keep)' : 'Password *'}</label>
            <input type="password" value={form.password} placeholder={editId ? '(unchanged)' : 'Set password'}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Role</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Linked Athlete</label>
            <select value={form.athleteId} onChange={e => setForm(f => ({ ...f, athleteId: e.target.value }))}>
              <option value="">— None —</option>
              {[...athletes].sort((a,b) => a.name.localeCompare(b.name)).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button className="btn-sm-primary" onClick={editId ? handleEdit : handleAdd}>
            {editId ? 'Save Changes' : 'Create User'}
          </button>
          {editId && <button className="btn-sm-secondary" onClick={cancelEdit}>Cancel</button>}
        </div>
        {msg && <div className={`msg ${msgType}`} style={{ display: 'block' }}>{msg}</div>}
      </div>

      {/* Users Table */}
      <div className="card">
        <div className="card-title"><span className="title-accent" />All Users</div>
        {loading
          ? <div className="spinner-row">Loading<span className="spinner-ring" /></div>
          : users.length === 0
            ? <div className="empty-state">No users yet.</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Linked Athlete</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const ath = athletes.find(a => a.id === u.athleteId);
                      return (
                        <tr key={u.id}>
                          <td><code style={{ fontFamily: 'monospace', fontSize: '0.88rem' }}>{u.username}</code></td>
                          <td>
                            <span style={{
                              display: 'inline-block', padding: '0.12rem 0.5rem', borderRadius: '5px', fontSize: '0.72rem', fontWeight: 700,
                              background: u.role === 'results_entry' ? 'rgba(34,197,94,0.14)' : 'rgba(124,58,237,0.14)',
                              border: `1px solid ${u.role === 'results_entry' ? 'rgba(34,197,94,0.3)' : 'rgba(124,58,237,0.3)'}`,
                              color: u.role === 'results_entry' ? '#4ade80' : '#c4b5fd',
                            }}>{u.role}</span>
                          </td>
                          <td className="td-muted">{ath?.name || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button className="btn-edit" onClick={() => startEdit(u)}>Edit</button>
                              <button className="btn-delete" onClick={() => handleDelete(u.id)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
        }
      </div>
    </div>
  );
}
