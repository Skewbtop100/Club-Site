'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  subscribeCompetitions,
  addCompetition,
  updateCompetition,
  deleteCompetition,
} from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import type { Athlete, Competition, CompetitionAthlete, EventConfig, AdvancementConfig } from '@/lib/types';
import { WCA_EVENTS } from '@/lib/wca-events';
import COUNTRIES from '@/lib/countries';

type Status = 'upcoming' | 'live' | 'finished';

interface FormShape {
  name: string;
  country: string;
  date: string;
  clubDate: string;
  imageUrl: string;
  status: Status;
}

const emptyForm: FormShape = { name: '', country: '', date: '', clubDate: '', imageUrl: '', status: 'upcoming' };

type AthleteReg = { selected: boolean; events: Record<string, boolean> };

export default function CompetitionsTab() {
  const [comps, setComps] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormShape>({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, boolean>>({});
  const [eventConfig, setEventConfig] = useState<Record<string, EventConfig>>({});
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');
  const [allAthletes, setAllAthletes] = useState<Athlete[]>([]);
  const [athleteReg, setAthleteReg] = useState<Record<string, AthleteReg>>({});
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteMsg, setDeleteMsg] = useState('');

  useEffect(() => {
    getAthletes().then(data => setAllAthletes([...data].sort((a, b) => a.name.localeCompare(b.name))));
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
      imageUrl: c.imageUrl || '',
      status: c.status,
    });
    setEvents((c.events as Record<string, boolean>) || {});
    setEventConfig(c.eventConfig || {});
    const reg: Record<string, AthleteReg> = {};
    if (c.athletes) {
      c.athletes.forEach(a => {
        reg[a.id] = {
          selected: true,
          events: a.events.reduce((acc: Record<string, boolean>, ev: string) => ({ ...acc, [ev]: true }), {}),
        };
      });
    }
    setAthleteReg(reg);
  }

  function cancelEdit() { setEditId(null); setForm({ ...emptyForm }); setEvents({}); setEventConfig({}); setAthleteReg({}); }

  function toggleAthlete(athleteId: string) {
    setAthleteReg(prev => {
      const existing = prev[athleteId];
      if (existing?.selected) {
        return { ...prev, [athleteId]: { ...existing, selected: false } };
      }
      const defaultEvents = Object.fromEntries(
        Object.entries(events).filter(([, v]) => v).map(([k]) => [k, true])
      );
      return { ...prev, [athleteId]: { selected: true, events: defaultEvents } };
    });
  }

  function toggleAthleteEvent(athleteId: string, eventId: string, checked: boolean) {
    setAthleteReg(prev => ({
      ...prev,
      [athleteId]: {
        ...prev[athleteId],
        events: { ...(prev[athleteId]?.events || {}), [eventId]: checked },
      },
    }));
  }

  async function submitComp() {
    if (!form.name) { showMsg('error', 'Competition name is required.'); return; }
    const athletesData: CompetitionAthlete[] = Object.entries(athleteReg)
      .filter(([, r]) => r.selected)
      .map(([id, r]) => ({
        id,
        name: allAthletes.find(a => a.id === id)?.name || '',
        events: Object.entries(r.events)
          .filter(([evId, v]) => v && events[evId])
          .map(([evId]) => evId),
      }));
    try {
      if (editId) {
        await updateCompetition(editId, { ...form, events, athletes: athletesData, eventConfig });
        showMsg('success', 'Competition updated.');
      } else {
        await addCompetition({ ...form, events, athletes: athletesData, eventConfig });
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

  function openDeleteModal(c: Competition) {
    setDeleteModal({ id: c.id, name: c.name });
    setDeleteInput('');
    setDeleteMsg('');
  }

  function closeDeleteModal() {
    setDeleteModal(null);
    setDeleteInput('');
    setDeleteMsg('');
  }

  async function confirmDelete() {
    if (!deleteModal || deleteInput !== deleteModal.name) return;
    try {
      await deleteCompetition(deleteModal.id);
      setDeleteMsg('success');
      setTimeout(() => closeDeleteModal(), 1200);
    } catch (e: unknown) {
      setDeleteMsg('error: ' + (e instanceof Error ? e.message : String(e)));
    }
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
            <label style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--muted)' }}>Competition Image URL</label>
            <input type="text" value={form.imageUrl} placeholder="https://res.cloudinary.com/..."
              onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} />
            <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.25rem', opacity: 0.7 }}>
              Upload image to cloudinary.com and paste the URL here
            </div>
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
              <div key={ev.id} style={{
                borderRadius: '8px', overflow: 'hidden',
                border: `1px solid ${events[ev.id] ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.05)'}`,
                background: events[ev.id] ? 'rgba(124,58,237,0.06)' : 'rgba(255,255,255,0.02)',
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.42rem 0.7rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox" checked={!!events[ev.id]}
                    onChange={e => {
                      setEvents(prev => ({ ...prev, [ev.id]: e.target.checked }));
                      if (e.target.checked) {
                        setEventConfig(prev => prev[ev.id] ? prev : { ...prev, [ev.id]: { rounds: 1, groups: 1 } });
                      }
                    }}
                    style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{ev.name}</span>
                </label>
                {events[ev.id] && (
                  <div style={{
                    display: 'flex', gap: '0.75rem', padding: '0.3rem 0.7rem 0.5rem',
                    borderTop: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap',
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      Rounds:
                      <input
                        type="number" min={1} max={4}
                        value={eventConfig[ev.id]?.rounds ?? 1}
                        onChange={e => setEventConfig(prev => ({
                          ...prev,
                          [ev.id]: { ...(prev[ev.id] || { rounds: 1, groups: 1 }), rounds: Math.min(4, Math.max(1, Number(e.target.value))) },
                        }))}
                        style={{
                          width: '3rem', padding: '0.2rem 0.3rem', fontSize: '0.8rem',
                          borderRadius: '5px', textAlign: 'center', fontFamily: 'inherit',
                          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text)',
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      Groups/round:
                      <input
                        type="number" min={1} max={10}
                        value={eventConfig[ev.id]?.groups ?? 1}
                        onChange={e => setEventConfig(prev => ({
                          ...prev,
                          [ev.id]: { ...(prev[ev.id] || { rounds: 1, groups: 1 }), groups: Math.min(10, Math.max(1, Number(e.target.value))) },
                        }))}
                        style={{
                          width: '3rem', padding: '0.2rem 0.3rem', fontSize: '0.8rem',
                          borderRadius: '5px', textAlign: 'center', fontFamily: 'inherit',
                          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text)',
                        }}
                      />
                    </label>
                  </div>
                )}
                {events[ev.id] && (eventConfig[ev.id]?.rounds ?? 1) > 1 && (
                  <div style={{
                    padding: '0.3rem 0.7rem 0.5rem',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', flexDirection: 'column', gap: '0.3rem',
                  }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.1rem', opacity: 0.7 }}>
                      Advance to next round:
                    </div>
                    {Array.from({ length: (eventConfig[ev.id]?.rounds ?? 1) - 1 }, (_, idx) => idx + 1).map(r => {
                      const adv: AdvancementConfig | undefined = eventConfig[ev.id]?.advancement?.[String(r)];
                      const isPercent = adv?.type === 'percent';
                      return (
                        <div key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.74rem', color: 'var(--muted)' }}>
                          <span style={{ flexShrink: 0, minWidth: '1.6rem' }}>R{r}:</span>
                          <span style={{ flexShrink: 0 }}>Top</span>
                          <input
                            type="number" min={1} max={isPercent ? 99 : 999}
                            value={adv?.value ?? ''}
                            placeholder={isPercent ? '25' : '8'}
                            onChange={e => {
                              const val = Math.max(1, Number(e.target.value));
                              setEventConfig(prev => ({
                                ...prev,
                                [ev.id]: {
                                  ...(prev[ev.id] || { rounds: 1, groups: 1 }),
                                  advancement: {
                                    ...(prev[ev.id]?.advancement || {}),
                                    [String(r)]: { type: adv?.type || 'fixed', value: val },
                                  },
                                },
                              }));
                            }}
                            style={{
                              width: '3rem', padding: '0.2rem 0.3rem', fontSize: '0.78rem',
                              borderRadius: '5px', textAlign: 'center', fontFamily: 'inherit',
                              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text)',
                            }}
                          />
                          {/* Fixed / % toggle */}
                          <div style={{ display: 'flex', borderRadius: '5px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
                            {(['fixed', 'percent'] as const).map(t => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setEventConfig(prev => ({
                                  ...prev,
                                  [ev.id]: {
                                    ...(prev[ev.id] || { rounds: 1, groups: 1 }),
                                    advancement: {
                                      ...(prev[ev.id]?.advancement || {}),
                                      [String(r)]: { type: t, value: adv?.value ?? (t === 'percent' ? 25 : 8) },
                                    },
                                  },
                                }))}
                                style={{
                                  padding: '0.15rem 0.4rem', cursor: 'pointer',
                                  fontSize: '0.7rem', fontFamily: 'inherit',
                                  background: (adv?.type || 'fixed') === t ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.04)',
                                  color: (adv?.type || 'fixed') === t ? '#c4b5fd' : 'var(--muted)',
                                  border: 'none',
                                }}
                              >
                                {t === 'fixed' ? '#' : '%'}
                              </button>
                            ))}
                          </div>
                          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem' }}>
                            {isPercent ? 'advance' : 'advance'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Athletes Registration */}
        {(() => {
          const competitionEvents = WCA_EVENTS.filter(ev => events[ev.id]);
          return (
            <div className="form-group">
              <label>Athletes</label>
              <div style={{ fontSize: '0.73rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                Select athletes participating in this competition, then choose their events.
              </div>
              {allAthletes.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>No athletes in club yet.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.4rem' }}>
                  {allAthletes.map(athlete => {
                    const reg = athleteReg[athlete.id];
                    const isSelected = reg?.selected || false;
                    const fullName = [athlete.name, athlete.lastName].filter(Boolean).join(' ');
                    return (
                      <div key={athlete.id} style={{
                        borderRadius: '10px',
                        border: `1px solid ${isSelected ? 'rgba(124,58,237,0.45)' : 'rgba(255,255,255,0.06)'}`,
                        background: isSelected ? 'rgba(124,58,237,0.07)' : 'rgba(255,255,255,0.02)',
                        transition: 'border-color 0.15s, background 0.15s',
                        display: 'flex', flexDirection: 'column',
                      }}>
                        <div
                          onClick={() => toggleAthlete(athlete.id)}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.5rem', cursor: 'pointer' }}
                        >
                          <div style={{
                            width: 15, height: 15, borderRadius: '3px', flexShrink: 0, marginTop: '0.1rem',
                            border: `2px solid ${isSelected ? '#7c3aed' : 'rgba(255,255,255,0.2)'}`,
                            background: isSelected ? '#7c3aed' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.12s',
                          }}>
                            {isSelected && (
                              <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{fullName}</div>
                            {athlete.wcaId && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', opacity: 0.6, marginTop: '0.1rem' }}>{athlete.wcaId}</div>
                            )}
                          </div>
                        </div>
                        {isSelected && competitionEvents.length > 0 && (
                          <div style={{
                            display: 'flex', flexWrap: 'wrap', gap: '0.25rem',
                            padding: '0.3rem 0.5rem 0.45rem',
                            borderTop: '1px solid rgba(255,255,255,0.04)',
                          }}>
                            {competitionEvents.map(ev => {
                              const evSelected = reg?.events?.[ev.id] ?? false;
                              return (
                                <button
                                  key={ev.id}
                                  type="button"
                                  onClick={e => { e.stopPropagation(); toggleAthleteEvent(athlete.id, ev.id, !evSelected); }}
                                  style={{
                                    padding: '0.15rem 0.45rem', borderRadius: '999px',
                                    cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'inherit',
                                    border: `1px solid ${evSelected ? 'rgba(124,58,237,0.6)' : 'rgba(255,255,255,0.12)'}`,
                                    background: evSelected ? 'rgba(124,58,237,0.22)' : 'transparent',
                                    color: evSelected ? '#c4b5fd' : 'var(--muted)',
                                    transition: 'all 0.12s',
                                  }}
                                >
                                  {ev.short}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {isSelected && competitionEvents.length === 0 && (
                          <div style={{
                            padding: '0.25rem 0.5rem 0.4rem',
                            borderTop: '1px solid rgba(255,255,255,0.04)',
                            fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic',
                          }}>
                            No events selected yet.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

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
                      <th>Athletes</th>
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
                          <td className="td-muted" style={{ fontSize: '0.78rem' }}>
                            {(c.athletes || []).length} registered
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button className="btn-edit" onClick={() => startEdit(c)}>Edit</button>
                              <button className="btn-delete" onClick={() => openDeleteModal(c)}>Delete</button>
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

      {/* Delete confirmation modal */}
      {deleteModal && (
        <div
          onClick={closeDeleteModal}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--card, #1a1730)',
              border: '1px solid rgba(239,68,68,0.45)',
              borderRadius: '14px',
              padding: '1.75rem',
              maxWidth: '440px',
              width: '100%',
              boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
            }}
          >
            {deleteMsg === 'success' ? (
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✓</div>
                <div style={{ color: '#4ade80', fontWeight: 600 }}>Competition deleted.</div>
              </div>
            ) : (
              <>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.4rem' }}>
                      Delete Competition?
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.55 }}>
                      This will permanently delete <strong style={{ color: 'var(--text)' }}>{deleteModal.name}</strong> and ALL its results, assignments, and data. This cannot be undone.
                    </div>
                  </div>
                </div>

                {/* Name confirmation input */}
                <div style={{ marginBottom: '1.1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.4rem' }}>
                    Type <strong style={{ color: 'var(--text)' }}>{deleteModal.name}</strong> to confirm:
                  </label>
                  <input
                    type="text"
                    value={deleteInput}
                    onChange={e => { setDeleteInput(e.target.value); setDeleteMsg(''); }}
                    placeholder={deleteModal.name}
                    autoFocus
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '0.55rem 0.75rem', borderRadius: '8px', fontSize: '0.88rem',
                      background: 'rgba(255,255,255,0.04)',
                      border: `1px solid ${deleteInput === deleteModal.name ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.1)'}`,
                      color: 'var(--text)', fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Error message */}
                {deleteMsg && deleteMsg !== 'success' && (
                  <div style={{ fontSize: '0.8rem', color: '#f87171', marginBottom: '0.8rem' }}>{deleteMsg}</div>
                )}

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                  <button
                    onClick={closeDeleteModal}
                    style={{
                      padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '0.88rem',
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                      color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDelete}
                    disabled={deleteInput !== deleteModal.name}
                    style={{
                      padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '0.88rem',
                      fontFamily: 'inherit', fontWeight: 600, cursor: deleteInput === deleteModal.name ? 'pointer' : 'not-allowed',
                      background: deleteInput === deleteModal.name ? 'rgba(239,68,68,0.85)' : 'rgba(239,68,68,0.2)',
                      border: `1px solid ${deleteInput === deleteModal.name ? 'rgba(239,68,68,0.9)' : 'rgba(239,68,68,0.3)'}`,
                      color: deleteInput === deleteModal.name ? '#fff' : 'rgba(239,68,68,0.5)',
                      transition: 'all 0.15s',
                    }}
                  >
                    Delete Forever
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
