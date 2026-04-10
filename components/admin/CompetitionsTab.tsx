'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  subscribeCompetitions,
  addCompetition,
  updateCompetition,
  deleteCompetition,
} from '@/lib/firebase/services/competitions';
import type { Competition } from '@/lib/types';
import { WCA_EVENTS } from '@/lib/wca-events';
import COUNTRIES from '@/lib/countries';

type Status = 'upcoming' | 'live' | 'finished';
const emptyForm: { name: string; country: string; date: string; status: Status } = { name: '', country: '', date: '', status: 'upcoming' };

export default function CompetitionsTab() {
  const [comps, setComps] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ name: string; country: string; date: string; status: Status }>({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState(''); const [msgType, setMsgType] = useState('');

  useEffect(() => {
    const unsub = subscribeCompetitions(
      (data) => { setComps(data); setLoading(false); },
    );
    return unsub;
  }, []);

  function showMsg(type: string, text: string) { setMsgType(type); setMsg(text); setTimeout(() => setMsg(''), 5000); }

  function startEdit(c: Competition) {
    setEditId(c.id);
    setForm({ name: c.name, country: c.country || '', date: c.date as string || '', status: c.status });
    setEvents((c.events as Record<string, boolean>) || {});
  }

  function cancelEdit() { setEditId(null); setForm({ ...emptyForm }); setEvents({}); }

  async function submitComp() {
    if (!form.name) { showMsg('error', 'Competition name is required.'); return; }
    try {
      if (editId) {
        await updateCompetition(editId, { ...form, events });
        showMsg('success', 'Competition updated.');
      } else {
        await addCompetition({ ...form, events });
        showMsg('success', 'Competition created.');
      }
      cancelEdit();
    } catch (e: unknown) {
      showMsg('error', 'Error: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function setStatus(id: string, status: string) {
    try { await updateCompetition(id, { status: status as Status }); } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this competition?')) return;
    try { await deleteCompetition(id); } catch { /* ignore */ }
  }

  const statusColors: Record<string, string> = {
    upcoming: 'rgba(124,58,237,0.4)',
    live:     'rgba(34,197,94,0.4)',
    finished: 'rgba(100,116,139,0.35)',
  };

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Form */}
      <div className="card">
        <div className="card-title"><span className="title-accent" />{editId ? 'Edit Competition' : 'New Competition'}</div>
        <div className="form-grid-2">
          <div className="form-group">
            <label>Competition Name *</label>
            <input type="text" value={form.name} placeholder="e.g. Ulaanbaatar Open 2026"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Country *</label>
            <CountryDropdown
              value={form.country}
              onChange={country => setForm(f => ({ ...f, country }))}
            />
          </div>
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as Status }))}>
              <option value="upcoming">Upcoming</option>
              <option value="live">Live</option>
              <option value="finished">Finished</option>
            </select>
          </div>
        </div>

        {/* Events */}
        <div className="form-group">
          <label>Events</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.4rem', marginTop: '0.25rem' }}>
            {WCA_EVENTS.map(ev => (
              <label key={ev.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.42rem 0.7rem', borderRadius: '8px', cursor: 'pointer',
                border: `1px solid ${events[ev.id] ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.05)'}`,
                background: events[ev.id] ? 'rgba(124,58,237,0.06)' : 'rgba(255,255,255,0.02)',
              }}>
                <input
                  type="checkbox" checked={!!events[ev.id]}
                  onChange={e => setEvents(prev => ({ ...prev, [ev.id]: e.target.checked }))}
                  style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }}
                />
                <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{ev.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button className="btn-sm-primary" onClick={submitComp}>{editId ? 'Save Changes' : 'Create Competition'}</button>
          {editId && <button className="btn-sm-secondary" onClick={cancelEdit}>Cancel Edit</button>}
        </div>
        {msg && <div className={`msg ${msgType}`} style={{ display: 'block' }}>{msg}</div>}
      </div>

      {/* Competitions Table */}
      <div className="card">
        <div className="card-title"><span className="title-accent" />All Competitions</div>
        {loading
          ? <div className="spinner-row">Loading<span className="spinner-ring" /></div>
          : comps.length === 0
            ? <div className="empty-state">No competitions yet.</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Country</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Events</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comps
                      .sort((a, b) => (String(b.date) || '').localeCompare(String(a.date) || ''))
                      .map(c => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 600 }}>{c.name}</td>
                          <td className="td-muted">{c.country || '—'}</td>
                          <td className="td-muted">{c.date ? String(c.date).slice(0, 10) : '—'}</td>
                          <td>
                            <select
                              className="status-select"
                              value={c.status}
                              onChange={e => setStatus(c.id, e.target.value)}
                              style={{ borderColor: statusColors[c.status] || 'rgba(255,255,255,0.08)' }}
                            >
                              <option value="upcoming">Upcoming</option>
                              <option value="live">Live</option>
                              <option value="finished">Finished</option>
                            </select>
                          </td>
                          <td className="td-muted" style={{ fontSize: '0.78rem' }}>
                            {Object.keys(c.events || {}).filter(k => (c.events as Record<string,boolean>)?.[k]).length} events
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button className="btn-edit" onClick={() => startEdit(c)}>Edit</button>
                              <button className="btn-delete" onClick={() => handleDelete(c.id)}>Delete</button>
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

// ── CountryDropdown ────────────────────────────────────────────────────────────

function CountryDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = query.trim() === ''
    ? COUNTRIES
    : COUNTRIES.filter(c => c.toLowerCase().includes(query.toLowerCase()));

  // Sync input text when parent changes value (e.g. Edit button)
  const prevValue = useRef(value);
  if (prevValue.current !== value) {
    prevValue.current = value;
    if (query !== value) setQuery(value);
  }

  const select = useCallback((country: string) => {
    onChange(country);
    setQuery(country);
    setOpen(false);
    setHighlighted(0);
  }, [onChange]);

  // Close on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlighted(h => Math.max(h - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[highlighted]) select(filtered[highlighted]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        placeholder="Search country…"
        autoComplete="off"
        onFocus={() => { setOpen(true); setHighlighted(0); }}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlighted(0);
          // If cleared, also clear the form value
          if (e.target.value === '') onChange('');
        }}
        onKeyDown={onKeyDown}
      />

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            zIndex: 200,
            background: 'var(--card, #1e1b2e)',
            border: '1px solid rgba(124,58,237,0.35)',
            borderRadius: '9px',
            padding: '4px',
            margin: 0,
            listStyle: 'none',
            maxHeight: '220px',
            overflowY: 'auto',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(124,58,237,0.4) transparent',
          }}
        >
          {filtered.map((country, i) => (
            <li
              key={country}
              onPointerDown={e => { e.preventDefault(); select(country); }}
              style={{
                padding: '0.38rem 0.7rem',
                borderRadius: '6px',
                fontSize: '0.88rem',
                cursor: 'pointer',
                color: i === highlighted ? '#fff' : 'var(--text)',
                background: i === highlighted ? 'rgba(124,58,237,0.4)' : 'transparent',
                fontWeight: i === highlighted ? 600 : 400,
                transition: 'background 0.1s',
              }}
              onPointerEnter={() => setHighlighted(i)}
            >
              {country}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
