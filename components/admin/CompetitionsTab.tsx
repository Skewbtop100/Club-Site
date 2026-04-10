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

interface FormShape {
  name: string;
  country: string;
  date: string;
  clubDate: string;
  status: Status;
}

const emptyForm: FormShape = { name: '', country: '', date: '', clubDate: '', status: 'upcoming' };

export default function CompetitionsTab() {
  const [comps, setComps] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormShape>({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');

  useEffect(() => {
    const unsub = subscribeCompetitions((data) => { setComps(data); setLoading(false); });
    return unsub;
  }, []);

  function showMsg(type: string, text: string) {
    setMsgType(type); setMsg(text); setTimeout(() => setMsg(''), 5000);
  }

  function startEdit(c: Competition) {
    setEditId(c.id);
    setForm({
      name: c.name,
      country: c.country || '',
      date: c.date as string || '',
      clubDate: c.clubDate as string || '',
      status: c.status,
    });
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
        <div className="card-title">
          <span className="title-accent" />{editId ? 'Edit Competition' : 'New Competition'}
        </div>
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
            <label>Competition Date</label>
            <div style={{ fontSize: '0.73rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>
              The date the original competition was held
            </div>
            <DatePicker
              value={form.date}
              onChange={date => setForm(f => ({ ...f, date }))}
            />
          </div>
          <div className="form-group">
            <label>Club Event Date</label>
            <div style={{ fontSize: '0.73rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>
              The date your club is running this event
            </div>
            <DatePicker
              value={form.clubDate}
              onChange={clubDate => setForm(f => ({ ...f, clubDate }))}
            />
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
                      <th>Comp Date</th>
                      <th>Club Date</th>
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
                          <td className="td-muted">{c.clubDate ? String(c.clubDate).slice(0, 10) : '—'}</td>
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
                            {Object.keys(c.events || {}).filter(k => (c.events as Record<string, boolean>)?.[k]).length} events
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

// ── DatePicker ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseLocalDate(str: string): Date | null {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toLocalIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function DatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = parseLocalDate(value);
  const today = new Date();

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? today.getMonth());
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync view when value changes externally (Edit button)
  const prevValue = useRef(value);
  if (prevValue.current !== value) {
    prevValue.current = value;
    const p = parseLocalDate(value);
    if (p) { setViewYear(p.getFullYear()); setViewMonth(p.getMonth()); }
  }

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

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedDate = parsed;
  const todayIso = toLocalIso(today);

  function selectDay(day: number) {
    const chosen = new Date(viewYear, viewMonth, day);
    onChange(toLocalIso(chosen));
    setOpen(false);
  }

  const displayValue = value
    ? parseLocalDate(value)?.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) ?? value
    : '';

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Trigger input */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.55rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
          background: 'var(--input-bg, rgba(255,255,255,0.04))',
          border: '1px solid var(--input-border, rgba(255,255,255,0.1))',
          color: value ? 'var(--text)' : 'var(--muted)',
          fontSize: '0.88rem', userSelect: 'none',
          transition: 'border-color 0.15s',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ opacity: 0.5, flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        <span>{displayValue || 'Select date…'}</span>
        {value && (
          <button
            onPointerDown={e => { e.stopPropagation(); onChange(''); }}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0 2px', fontSize: '1rem', lineHeight: 1 }}
            title="Clear"
          >×</button>
        )}
      </div>

      {/* Calendar popup */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
          background: 'var(--card, #1a1730)',
          border: '1px solid rgba(124,58,237,0.4)',
          borderRadius: '12px',
          padding: '0.9rem',
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
          minWidth: '260px',
        }}>
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.7rem' }}>
            <button onClick={prevMonth} style={navBtnStyle}>‹</button>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)' }}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button onClick={nextMonth} style={navBtnStyle}>›</button>
          </div>

          {/* Day-of-week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
            {DAY_NAMES.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: '0.68rem', fontWeight: 600, color: 'var(--muted)', padding: '2px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />;
              const iso = toLocalIso(new Date(viewYear, viewMonth, day));
              const isSelected = selectedDate ? toLocalIso(selectedDate) === iso : false;
              const isToday = todayIso === iso;
              return (
                <button
                  key={i}
                  onClick={() => selectDay(day)}
                  style={{
                    padding: '5px 0',
                    borderRadius: '6px',
                    border: isToday && !isSelected ? '1px solid rgba(124,58,237,0.5)' : '1px solid transparent',
                    background: isSelected
                      ? 'linear-gradient(135deg, var(--accent, #7c3aed), var(--accent2, #ec4899))'
                      : 'transparent',
                    color: isSelected ? '#fff' : isToday ? '#a78bfa' : 'var(--text)',
                    fontWeight: isSelected || isToday ? 700 : 400,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.18)'; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div style={{ marginTop: '0.6rem', textAlign: 'center' }}>
            <button
              onClick={() => { onChange(todayIso); setOpen(false); }}
              style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'rgba(124,58,237,0.12)',
  border: '1px solid rgba(124,58,237,0.25)',
  borderRadius: '6px',
  color: '#a78bfa',
  cursor: 'pointer',
  fontSize: '1.1rem',
  lineHeight: 1,
  padding: '2px 8px',
  fontFamily: 'inherit',
};

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
