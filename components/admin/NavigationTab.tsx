'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  subscribeNavigation,
  updateNavigation,
  getDefaultNavigation,
  type NavLink,
  type NavStatus,
} from '@/lib/firebase/services/navigation';

const STATUS_OPTIONS: { value: NavStatus; label: string; dot: string }[] = [
  { value: 'active', label: 'Идэвхтэй', dot: '#22c55e' },
  { value: 'soon',   label: 'Удахгүй',  dot: '#fbbf24' },
  { value: 'hidden', label: 'Нуусан',   dot: '#94a3b8' },
];

function statusMeta(status: NavStatus) {
  return STATUS_OPTIONS.find((o) => o.value === status) ?? STATUS_OPTIONS[0];
}

function reorderInPlace(links: NavLink[]): NavLink[] {
  return links.map((l, i) => ({ ...l, order: i }));
}

function sameLinks(a: NavLink[], b: NavLink[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id || x.label !== y.label || x.href !== y.href ||
        x.status !== y.status || x.featured !== y.featured ||
        x.visible !== y.visible || x.order !== y.order) return false;
  }
  return true;
}

export default function NavigationTab() {
  // `serverLinks` = last known persisted state (for the dirty check).
  // `links` = local working copy the admin is editing.
  const [serverLinks, setServerLinks] = useState<NavLink[] | null>(null);
  const [links, setLinks] = useState<NavLink[]>(() => getDefaultNavigation());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  // Don't clobber local edits when the realtime sub fires after our own write.
  const editedSinceLoad = useRef(false);

  useEffect(() => {
    const unsub = subscribeNavigation((next) => {
      setServerLinks(next);
      if (!editedSinceLoad.current) {
        setLinks(next);
      }
    });
    return () => unsub();
  }, []);

  const dirty = useMemo(() => {
    if (!serverLinks) return false;
    return !sameLinks(reorderInPlace(links), reorderInPlace(serverLinks));
  }, [links, serverLinks]);

  function patch(idx: number, patch: Partial<NavLink>) {
    editedSinceLoad.current = true;
    setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= links.length || from === to) return;
    editedSinceLoad.current = true;
    setLinks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const ordered = reorderInPlace(links);
      await updateNavigation(ordered);
      setLinks(ordered);
      setServerLinks(ordered);
      editedSinceLoad.current = false;
      setSavedAt(Date.now());
      window.setTimeout(() => {
        setSavedAt((cur) => (cur && Date.now() - cur >= 2800 ? null : cur));
      }, 3000);
    } catch (e) {
      console.error('[admin] navigation save', e);
      setError(e instanceof Error ? e.message : 'Хадгалахад алдаа гарлаа');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    if (!serverLinks) return;
    editedSinceLoad.current = false;
    setLinks(serverLinks);
  }

  // Drag-and-drop
  function onDragStart(idx: number) {
    setDragIdx(idx);
  }
  function onDragOver(idx: number, e: React.DragEvent) {
    if (dragIdx === null) return;
    e.preventDefault();
    if (overIdx !== idx) setOverIdx(idx);
  }
  function onDrop(idx: number, e: React.DragEvent) {
    e.preventDefault();
    if (dragIdx === null) return;
    move(dragIdx, idx);
    setDragIdx(null);
    setOverIdx(null);
  }
  function onDragEnd() {
    setDragIdx(null);
    setOverIdx(null);
  }

  return (
    <div className="card">
      <div className="card-title">
        <span className="title-accent" />
        Цэсний тохиргоо
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.2rem', lineHeight: 1.55 }}>
        Цэсийн харагдах байдал, дарааллыг тохируулна. Drag хийж байршил солино,
        status солих эсвэл нуух боломжтой.
      </p>

      <div className="nt-list">
        {links.map((link, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === links.length - 1;
          const dragging = dragIdx === idx;
          const dropping = overIdx === idx && dragIdx !== null && dragIdx !== idx;
          const meta = statusMeta(link.status);
          return (
            <div
              key={link.id}
              draggable
              onDragStart={() => onDragStart(idx)}
              onDragOver={(e) => onDragOver(idx, e)}
              onDrop={(e) => onDrop(idx, e)}
              onDragEnd={onDragEnd}
              className={`nt-row${dragging ? ' nt-dragging' : ''}${dropping ? ' nt-dropping' : ''}`}
            >
              <span className="nt-handle" aria-hidden title="Drag хийж шилжүүлнэ үү">⋮⋮</span>

              <div className="nt-label-block">
                <div className="nt-label">{link.label}</div>
                <div className="nt-href">{link.href}</div>
              </div>

              <div className="nt-arrows">
                <button
                  type="button"
                  className="nt-arrow"
                  onClick={() => move(idx, idx - 1)}
                  disabled={isFirst}
                  aria-label="Дээш"
                  title="Дээш"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="nt-arrow"
                  onClick={() => move(idx, idx + 1)}
                  disabled={isLast}
                  aria-label="Доош"
                  title="Доош"
                >
                  ▼
                </button>
              </div>

              <label className="nt-status">
                <span className="nt-dot" style={{ background: meta.dot }} />
                <select
                  value={link.status}
                  onChange={(e) => patch(idx, { status: e.target.value as NavStatus })}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className={`nt-toggle nt-feat${link.featured ? ' on' : ''}`}
                onClick={() => patch(idx, { featured: !link.featured })}
                title="Онцолсон (featured)"
                aria-pressed={link.featured}
                aria-label="Онцолсон"
              >
                ★
              </button>

              <button
                type="button"
                className={`nt-toggle nt-vis${link.visible ? ' on' : ''}`}
                onClick={() => patch(idx, { visible: !link.visible })}
                title={link.visible ? 'Харагдана' : 'Нуусан'}
                aria-pressed={link.visible}
                aria-label={link.visible ? 'Харагдана' : 'Нуусан'}
              >
                {link.visible ? (
                  /* eye open */
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                ) : (
                  /* eye closed */
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a19.5 19.5 0 015.06-5.94"/>
                    <path d="M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a19.5 19.5 0 01-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="nt-bar">
        <div className="nt-status-msg">
          {error
            ? <span className="nt-err">⚠ {error}</span>
            : savedAt
              ? <span className="nt-ok">Хадгалагдлаа ✓</span>
              : dirty
                ? <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>Хадгалаагүй өөрчлөлт байна</span>
                : null}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="nt-cancel"
            onClick={reset}
            disabled={!dirty || saving}
          >
            Болих
          </button>
          <button
            type="button"
            className="nt-save"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? 'Хадгалж байна...' : 'Хадгалах'}
          </button>
        </div>
      </div>

      <style>{`
        .nt-list {
          display: flex; flex-direction: column;
          gap: 0.5rem;
          margin-bottom: 1.2rem;
        }
        .nt-row {
          display: grid;
          grid-template-columns: 18px 1fr auto auto auto auto;
          align-items: center;
          gap: 0.85rem;
          padding: 0.7rem 0.95rem;
          border-radius: 10px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
          transition: opacity 0.15s, border-color 0.15s, background 0.15s;
        }
        .nt-row.nt-dragging { opacity: 0.4; }
        .nt-row.nt-dropping {
          border-color: rgba(167,139,250,0.55);
          background: rgba(124,58,237,0.08);
          box-shadow: inset 0 2px 0 var(--accent);
        }
        .nt-handle {
          color: var(--muted);
          font-size: 1rem;
          cursor: grab;
          user-select: none;
          line-height: 1;
        }
        .nt-row:active .nt-handle { cursor: grabbing; }
        .nt-label-block { min-width: 0; }
        .nt-label {
          font-size: 0.92rem; font-weight: 600; color: var(--text);
        }
        .nt-href {
          font-size: 0.72rem; color: var(--muted);
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          margin-top: 0.15rem;
        }

        .nt-arrows {
          display: inline-flex; flex-direction: column;
          gap: 2px;
        }
        .nt-arrow {
          width: 22px; height: 18px;
          border-radius: 4px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
          color: var(--muted);
          font-size: 0.6rem; line-height: 1;
          cursor: pointer;
          font-family: inherit;
        }
        .nt-arrow:hover:not(:disabled) {
          color: var(--text);
          border-color: rgba(167,139,250,0.4);
        }
        .nt-arrow:disabled { opacity: 0.3; cursor: not-allowed; }

        .nt-status {
          display: inline-flex; align-items: center;
          gap: 0.4rem;
          padding: 0.3rem 0.55rem;
          border-radius: 8px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .nt-status select {
          background: transparent;
          border: none;
          color: var(--text);
          font-family: inherit;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          outline: none;
          padding-right: 0.2rem;
        }
        .nt-status select option {
          background: var(--card);
          color: var(--text);
        }
        .nt-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .nt-toggle {
          width: 32px; height: 32px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
          color: var(--muted);
          font-size: 1rem; line-height: 1;
          font-family: inherit;
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .nt-toggle:hover { color: var(--text); border-color: rgba(167,139,250,0.4); }
        .nt-feat.on {
          color: #fbbf24;
          background: rgba(251,191,36,0.12);
          border-color: rgba(251,191,36,0.4);
        }
        .nt-vis.on {
          color: var(--accent);
          background: rgba(124,58,237,0.12);
          border-color: rgba(124,58,237,0.4);
        }

        .nt-bar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 1rem; flex-wrap: wrap;
        }
        .nt-status-msg { min-height: 1.4em; font-size: 0.82rem; }
        .nt-ok  { color: #4ade80; font-weight: 700; }
        .nt-err { color: #f87171; font-weight: 600; }
        .nt-save {
          padding: 0.5rem 1.2rem;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          color: #fff;
          font-family: inherit; font-size: 0.85rem; font-weight: 700;
          cursor: pointer;
          transition: transform 0.1s, opacity 0.15s;
        }
        .nt-save:hover:not(:disabled) { transform: translateY(-1px); }
        .nt-save:disabled { opacity: 0.4; cursor: not-allowed; }
        .nt-cancel {
          padding: 0.5rem 1rem;
          border-radius: 8px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.1);
          color: var(--muted);
          font-family: inherit; font-size: 0.82rem; font-weight: 600;
          cursor: pointer;
        }
        .nt-cancel:hover:not(:disabled) { color: var(--text); border-color: rgba(255,255,255,0.2); }
        .nt-cancel:disabled { opacity: 0.4; cursor: not-allowed; }

        @media (max-width: 700px) {
          .nt-row {
            display: flex;
            flex-wrap: wrap;
            gap: 0.55rem 0.7rem;
            padding: 0.7rem 0.8rem;
          }
          .nt-label-block { flex: 1 1 60%; }
          .nt-arrows { flex-direction: row; }
          .nt-href { display: none; }
        }
      `}</style>
    </div>
  );
}
