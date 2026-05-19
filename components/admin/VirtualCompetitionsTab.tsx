'use client';

import { useEffect, useRef, useState } from 'react';
import {
  subscribeAllCompetitions,
  createVirtualCompetition,
  updateVirtualCompetition,
  deleteVirtualCompetition,
  publishVirtualCompetition,
  closeVirtualCompetition,
} from '@/lib/firebase/services/virtual-competitions';
import type { VirtualCompetition } from '@/lib/firebase/services/virtual-competitions';
import { WCA_EVENTS } from '@/lib/wca-events';
import { useAuth } from '@/lib/auth-context';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  date: string;
  location: string;
  description: string;
  imageUrl: string;
  events: string[];
}

const EMPTY_FORM: FormState = {
  name: '',
  date: '',
  location: '',
  description: '',
  imageUrl: '',
  events: [],
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function VirtualCompetitionsTab() {
  const { user } = useAuth();
  const [comps, setComps] = useState<VirtualCompetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const unsub = subscribeAllCompetitions((data) => {
      setComps(data);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Close ⋮ menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler() { setMenuOpen(null); }
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  function showToast(type: 'success' | 'error', text: string) {
    setToast({ type, text });
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setSelectedId('new');
  }

  function openEdit(comp: VirtualCompetition) {
    setForm({
      name: comp.name,
      date: comp.date,
      location: comp.location ?? '',
      description: comp.description ?? '',
      imageUrl: comp.imageUrl ?? '',
      events: [...comp.events],
    });
    setErrors({});
    setSelectedId(comp.id);
  }

  function backToList() {
    setSelectedId(null);
    setErrors({});
    setSaving(false);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim() || form.name.trim().length < 3) {
      errs.name = 'Нэр 3-аас дээш тэмдэгт байх ёстой';
    }
    if (!form.date || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      errs.date = 'Огноо шаардлагатай (YYYY-MM-DD)';
    }
    if (form.events.length === 0) {
      errs.events = 'Ядаж нэг төрөл сонгоно уу';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function buildPayload() {
    return {
      name: form.name.trim(),
      date: form.date,
      events: form.events,
      ...(form.location.trim() ? { location: form.location.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.imageUrl.trim() ? { imageUrl: form.imageUrl.trim() } : {}),
    };
  }

  async function handleSave() {
    if (!validate() || !user) return;
    setSaving(true);
    try {
      if (selectedId === 'new') {
        const newId = await createVirtualCompetition(buildPayload(), user.uid);
        setSelectedId(newId);
        showToast('success', 'Тэмцээн амжилттай үүслээ');
      } else if (selectedId) {
        await updateVirtualCompetition(selectedId, buildPayload());
        showToast('success', 'Өөрчлөлт хадгалагдлаа');
      }
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!selectedId || selectedId === 'new') return;
    if (!validate()) return;
    setSaving(true);
    try {
      await updateVirtualCompetition(selectedId, buildPayload());
      await publishVirtualCompetition(selectedId);
      showToast('success', 'Тэмцээн амжилттай зарлагдлаа');
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleClose() {
    if (!selectedId || selectedId === 'new') return;
    setSaving(true);
    try {
      await closeVirtualCompetition(selectedId);
      showToast('success', 'Тэмцээн хаагдлаа');
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(compId: string) {
    setSaving(true);
    try {
      await deleteVirtualCompetition(compId);
      showToast('success', 'Тэмцээн устгагдлаа');
      setDeleteConfirm(null);
      if (selectedId === compId) setSelectedId(null);
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function quickAction(action: 'publish' | 'close', compId: string) {
    setMenuOpen(null);
    try {
      if (action === 'publish') {
        await publishVirtualCompetition(compId);
        showToast('success', 'Тэмцээн зарлагдлаа');
      } else {
        await closeVirtualCompetition(compId);
        showToast('success', 'Тэмцээн хаагдлаа');
      }
    } catch (err) {
      showToast('error', 'Алдаа: ' + String(err));
    }
  }

  function toggleEvent(eventId: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(eventId)
        ? f.events.filter((e) => e !== eventId)
        : [...f.events, eventId],
    }));
    if (errors.events) setErrors((prev) => ({ ...prev, events: '' }));
  }

  const currentComp =
    selectedId && selectedId !== 'new'
      ? (comps.find((c) => c.id === selectedId) ?? null)
      : null;

  const canPublish =
    !!currentComp &&
    currentComp.status === 'draft' &&
    form.name.trim().length >= 3 &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.date) &&
    form.events.length > 0;

  // ── Detail view ──────────────────────────────────────────────────────────────

  if (selectedId !== null) {
    const isNew = selectedId === 'new';
    const status = currentComp?.status ?? null;

    return (
      <div>
        {toast && <ToastBar type={toast.type} text={toast.text} />}

        {/* Back button */}
        <button
          onClick={backToList}
          style={{
            background: 'none', border: 'none', color: 'var(--muted)',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem',
            fontWeight: 600, display: 'inline-flex', alignItems: 'center',
            gap: '0.3rem', padding: '0 0 1.1rem', transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
        >
          ← Жагсаалт руу буцах
        </button>

        <div className="card">
          <div className="card-title">
            <span className="title-accent" />
            {isNew ? 'Шинэ виртуал тэмцээн' : 'Тэмцээн засварлах'}
          </div>

          {/* Status badge (edit mode only) */}
          {!isNew && status && (
            <div style={{ marginBottom: '1.1rem' }}>
              <StatusPill status={status} />
            </div>
          )}

          <div className="form-grid-2">
            {/* Name */}
            <div className="form-group">
              <label>Нэр</label>
              <input
                type="text"
                value={form.name}
                placeholder="Mongolian Open 2024"
                onChange={(e) => {
                  setForm((f) => ({ ...f, name: e.target.value }));
                  if (errors.name) setErrors((p) => ({ ...p, name: '' }));
                }}
                style={errors.name ? { borderColor: 'rgba(239,68,68,0.7)' } : {}}
              />
              {errors.name && <FieldError text={errors.name} />}
            </div>

            {/* Date */}
            <div className="form-group">
              <label>Огноо</label>
              <input
                type="text"
                value={form.date}
                placeholder="2024-08-15"
                maxLength={10}
                onChange={(e) => {
                  setForm((f) => ({ ...f, date: e.target.value }));
                  if (errors.date) setErrors((p) => ({ ...p, date: '' }));
                }}
                style={errors.date ? { borderColor: 'rgba(239,68,68,0.7)' } : {}}
              />
              {errors.date && <FieldError text={errors.date} />}
            </div>

            {/* Location */}
            <div className="form-group">
              <label>Газар</label>
              <input
                type="text"
                value={form.location}
                placeholder="Улаанбаатар"
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>

            {/* Image URL */}
            <div className="form-group">
              <label>Зураг URL</label>
              <input
                type="text"
                value={form.imageUrl}
                placeholder="https://res.cloudinary.com/..."
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
              />
            </div>
          </div>

          {/* Description (full width) */}
          <div className="form-group">
            <label>Тайлбар</label>
            <textarea
              value={form.description}
              placeholder="Тэмцээний товч тайлбар..."
              rows={3}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '0.55rem 0.75rem', borderRadius: '8px',
                background: 'var(--input-bg, rgba(255,255,255,0.04))',
                border: '1px solid var(--input-border, rgba(255,255,255,0.1))',
                color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.88rem',
                resize: 'vertical', outline: 'none',
              }}
            />
          </div>

          {/* Event picker */}
          <div className="form-group">
            <label>Төрлүүд</label>
            {errors.events && <FieldError text={errors.events} />}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '0.4rem',
              marginTop: '0.35rem',
            }}>
              {WCA_EVENTS.map((ev) => {
                const active = form.events.includes(ev.id);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => toggleEvent(ev.id)}
                    style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: '0.2rem',
                      padding: '0.5rem 0.3rem',
                      borderRadius: '8px', cursor: 'pointer',
                      fontFamily: 'inherit',
                      border: `1px solid ${active ? 'rgba(124,58,237,0.55)' : 'rgba(255,255,255,0.07)'}`,
                      background: active ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.02)',
                      color: active ? '#c4b5fd' : 'var(--muted)',
                      transition: 'all 0.12s',
                    }}
                  >
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.03em' }}>
                      {ev.short}
                    </span>
                    {active && (
                      <span style={{ fontSize: '0.6rem', color: '#a78bfa', lineHeight: 1 }}>✓</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
              {form.events.length} төрөл сонгогдсон
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '0.5rem 0 1.1rem' }} />

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className="btn-sm-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Хадгалж байна...' : 'Хадгалах'}
            </button>

            {/* Publish — only when draft */}
            {!isNew && status === 'draft' && (
              <button
                onClick={handlePublish}
                disabled={saving || !canPublish}
                style={{
                  padding: '0.42rem 0.95rem', borderRadius: '8px',
                  fontSize: '0.83rem', fontWeight: 700, fontFamily: 'inherit',
                  cursor: saving || !canPublish ? 'not-allowed' : 'pointer',
                  background: canPublish ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.05)',
                  border: `1px solid ${canPublish ? 'rgba(34,197,94,0.5)' : 'rgba(34,197,94,0.15)'}`,
                  color: canPublish ? '#4ade80' : 'rgba(74,222,128,0.35)',
                  transition: 'all 0.15s',
                }}
              >
                Зарлах
              </button>
            )}

            {/* Close — only when published */}
            {!isNew && status === 'published' && (
              <button
                onClick={handleClose}
                disabled={saving}
                style={{
                  padding: '0.42rem 0.95rem', borderRadius: '8px',
                  fontSize: '0.83rem', fontWeight: 700, fontFamily: 'inherit',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  background: 'rgba(245,158,11,0.12)',
                  border: '1px solid rgba(245,158,11,0.4)',
                  color: '#fbbf24',
                  transition: 'all 0.15s',
                }}
              >
                Хаах
              </button>
            )}

            {/* Delete — only on existing comps */}
            {!isNew && currentComp && (
              <button
                onClick={() => setDeleteConfirm({ id: currentComp.id, name: currentComp.name })}
                disabled={saving}
                className="btn-delete"
                style={{ marginLeft: 'auto' }}
              >
                Устгах
              </button>
            )}
          </div>
        </div>

        {/* Delete modal */}
        {deleteConfirm && (
          <DeleteModal
            name={deleteConfirm.name}
            saving={saving}
            onConfirm={() => handleDelete(deleteConfirm.id)}
            onCancel={() => setDeleteConfirm(null)}
          />
        )}
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────

  return (
    <div>
      {toast && <ToastBar type={toast.type} text={toast.text} />}

      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1.1rem',
      }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)' }}>
          Виртуал тэмцээн
        </div>
        <button className="btn-sm-primary" onClick={openCreate}>
          + Шинээр үүсгэх
        </button>
      </div>

      {loading ? (
        <div className="spinner-row">
          Ачааллаж байна…<span className="spinner-ring" />
        </div>
      ) : comps.length === 0 ? (
        <div className="empty-state">Одоогоор виртуал тэмцээн байхгүй байна.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {comps.map((comp) => (
            <CompCard
              key={comp.id}
              comp={comp}
              isMenuOpen={menuOpen === comp.id}
              onMenuToggle={(e) => {
                e.stopPropagation();
                setMenuOpen((prev) => (prev === comp.id ? null : comp.id));
              }}
              onEdit={() => { setMenuOpen(null); openEdit(comp); }}
              onPublish={() => quickAction('publish', comp.id)}
              onClose={() => quickAction('close', comp.id)}
              onDelete={() => { setMenuOpen(null); setDeleteConfirm({ id: comp.id, name: comp.name }); }}
            />
          ))}
        </div>
      )}

      {deleteConfirm && (
        <DeleteModal
          name={deleteConfirm.name}
          saving={saving}
          onConfirm={() => handleDelete(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

// ─── CompCard ─────────────────────────────────────────────────────────────────

function CompCard({
  comp,
  isMenuOpen,
  onMenuToggle,
  onEdit,
  onPublish,
  onClose,
  onDelete,
}: {
  comp: VirtualCompetition;
  isMenuOpen: boolean;
  onMenuToggle: (e: React.MouseEvent) => void;
  onEdit: () => void;
  onPublish: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: '12px',
      padding: '0.9rem 1.1rem',
      display: 'flex', alignItems: 'center', gap: '0.75rem',
    }}>
      {/* Left: info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>
            {comp.name}
          </span>
          <StatusPill status={comp.status} />
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
          {comp.date}
          {' · '}
          {comp.events.length} төрөл
          {' · '}
          {comp.participantCount ?? 0} оролцогч
        </div>
      </div>

      {/* Right: actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
        <button className="btn-edit" onClick={onEdit}>Засах</button>

        {/* ⋮ menu */}
        <div
          style={{ position: 'relative' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={onMenuToggle}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '7px',
              color: 'var(--muted)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '1rem', lineHeight: 1,
              padding: '0.3rem 0.55rem',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          >
            ⋮
          </button>

          {isMenuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 5px)', right: 0, zIndex: 200,
              background: 'var(--card, #1e1b2e)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '10px',
              padding: '0.3rem',
              boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
              minWidth: '130px',
            }}>
              <MenuAction label="Засах" onClick={onEdit} />
              {comp.status === 'draft' && (
                <MenuAction label="Зарлах" onClick={onPublish} color="#4ade80" />
              )}
              {comp.status === 'published' && (
                <MenuAction label="Хаах" onClick={onClose} color="#fbbf24" />
              )}
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '0.2rem 0.3rem' }} />
              <MenuAction label="Устгах" onClick={onDelete} color="#f87171" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuAction({
  label, onClick, color,
}: {
  label: string;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%',
        textAlign: 'left',
        padding: '0.38rem 0.65rem', borderRadius: '7px',
        background: 'none', border: 'none',
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: '0.83rem', fontWeight: 600,
        color: color ?? 'var(--text)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      {label}
    </button>
  );
}

// ─── StatusPill ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  draft:     { bg: 'rgba(100,116,139,0.25)', color: '#94a3b8', label: 'DRAFT' },
  published: { bg: 'rgba(34,197,94,0.2)',    color: '#4ade80', label: 'PUBLISHED' },
  closed:    { bg: 'rgba(245,158,11,0.2)',   color: '#fbbf24', label: 'CLOSED' },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.55rem',
      borderRadius: '999px',
      fontSize: '0.65rem',
      fontWeight: 800,
      letterSpacing: '0.08em',
      background: s.bg,
      color: s.color,
    }}>
      {s.label}
    </span>
  );
}

// ─── DeleteModal ──────────────────────────────────────────────────────────────

function DeleteModal({
  name, saving, onConfirm, onCancel,
}: {
  name: string;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card, #1a1730)',
          border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: '14px',
          padding: '1.75rem',
          maxWidth: '420px', width: '100%',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.1rem' }}>
          <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>⚠️</span>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.35rem' }}>
              Тэмцээн устгах
            </div>
            <div style={{ fontSize: '0.84rem', color: 'var(--muted)', lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--text)' }}>{name}</strong> тэмцээнийг устгахдаа итгэлтэй байна уу? Энэ үйлдлийг буцаах боломжгүй.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '0.88rem',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Болих
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            style={{
              padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '0.88rem',
              fontFamily: 'inherit', fontWeight: 700,
              background: saving ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.82)',
              border: '1px solid rgba(239,68,68,0.85)',
              color: '#fff', cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Устгаж байна...' : 'Устгах'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ToastBar ─────────────────────────────────────────────────────────────────

function ToastBar({ type, text }: { type: 'success' | 'error'; text: string }) {
  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 2000,
      padding: '0.7rem 1.1rem',
      borderRadius: '10px',
      fontSize: '0.88rem', fontWeight: 600,
      background: type === 'success' ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)',
      border: `1px solid ${type === 'success' ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'}`,
      color: type === 'success' ? '#4ade80' : '#f87171',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      pointerEvents: 'none',
    }}>
      {type === 'success' ? '✓ ' : '✕ '}{text}
    </div>
  );
}

// ─── FieldError ───────────────────────────────────────────────────────────────

function FieldError({ text }: { text: string }) {
  return (
    <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.25rem' }}>
      {text}
    </div>
  );
}
