'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OnlineCompetitionAdminView, OnlineRegistrationStatus } from '@/lib/online-competition/types';
import { REGISTRATION_STATUS_NOTE_MAX } from '@/lib/online-competition/types';
import type { RegistrationAdminView } from '@/lib/online-competition/admin-registrations';
import {
  BULK_ACTIONS,
  REVIEW_ORDER,
  REVIEW_SECTION_LABEL,
  reviewSummary,
  sectionFooter,
} from '@/lib/online-competition/registration-review';
import { countryName, flagUrl } from '@/lib/online-competition/countries';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';

// ── The registration review table ───────────────────────────────────────
// Replaces the Тамирчид tab's grouped-by-event name list. One row per
// registration, one collapsible section per review status, a bulk bar.
//
// Every write goes through the admin API (applyRegistrationPatch) — the
// only code allowed to set a status or statusNote. Bulk is ALL OR
// NOTHING: a failure changes no row, and the same click can be repeated.
//
// NOT enforced here or anywhere yet: the participant limit (PR-4). The
// summary line shows approved against the limit precisely so an overrun is
// visible — "70/64 БАТАЛГААЖСАН".

/** The optional columns, in the mockup's order. The rest — checkbox,
 *  WCA ID, name, the admin's note — are always shown. */
const COLUMNS = [
  { key: 'dob', label: 'Төрсөн өдөр' },
  { key: 'country', label: 'Улс' },
  { key: 'events', label: 'Төрлүүд' },
  { key: 'note', label: 'Тайлбар' },
  { key: 'email', label: 'Имэйл' },
  { key: 'registeredAt', label: 'Бүртгэсэн цаг' },
] as const;
type ColumnKey = (typeof COLUMNS)[number]['key'];

/** ON by default: exactly the columns the mockup's row shows — country,
 *  events, the athlete's note. Date of birth, email and registration time
 *  are one click away: useful when checking one athlete, noise when
 *  scanning forty. */
const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = {
  dob: false,
  country: true,
  events: true,
  note: true,
  email: false,
  registeredAt: false,
};

function fmtMoment(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RegistrationReview({ competition }: { competition: OnlineCompetitionAdminView }) {
  const [rows, setRows] = useState<RegistrationAdminView[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  // null = not yet decided; the first load opens the sections with work in
  // them (see below) and after that the admin's choice sticks.
  const [open, setOpen] = useState<Record<OnlineRegistrationStatus, boolean> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/online-competition/admin-competitions/${competition.id}/registrations`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { registrations: RegistrationAdminView[] };
      setRows(data.registrations);
      setLoadError('');
    } catch (err) {
      console.error('RegistrationReview: loading registrations failed:', err);
      setLoadError('Бүртгэлийг ачааллаж чадсангүй');
    }
  }, [competition.id]);

  useEffect(() => {
    load();
  }, [load]);

  const bySection = useMemo(() => {
    const out = { pending: [], waitlisted: [], approved: [], cancelled: [], rejected: [] } as Record<
      OnlineRegistrationStatus,
      RegistrationAdminView[]
    >;
    for (const r of rows ?? []) out[r.status].push(r);
    return out;
  }, [rows]);

  // Sections with work in them open on first load: pending, waitlisted and
  // approved when non-empty. Cancelled and rejected start closed — they are
  // the finished pile. Empty sections are SHOWN, collapsed, with a zero:
  // an empty Хүлээлгийн жагсаалт is information, and a section list whose
  // shape changes as rows move is harder to scan than a fixed one.
  useEffect(() => {
    if (open || !rows) return;
    setOpen({
      pending: bySection.pending.length > 0,
      waitlisted: bySection.waitlisted.length > 0,
      approved: bySection.approved.length > 0,
      cancelled: false,
      rejected: false,
    });
  }, [rows, open, bySection]);

  const q = query.trim().toLowerCase();
  const matches = (r: RegistrationAdminView) =>
    !q || r.name.toLowerCase().includes(q) || r.displayName.toLowerCase().includes(q);

  function toggleRow(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function toggleSection(visible: RegistrationAdminView[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = visible.every((r) => next.has(r.uid));
      for (const r of visible) {
        if (all) next.delete(r.uid);
        else next.add(r.uid);
      }
      return next;
    });
  }

  async function patch(url: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setActionError('');
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        // 409 is a DECISION, not a breakage: the participant limit refused
        // this approval. It arrives already written for the admin — it
        // says how many places are left and offers ХҮЛЭЭЛГЭНД — so it is
        // shown as-is rather than wrapped in "could not save", which would
        // read as a bug in the table.
        if (res.status === 409 && data.error) {
          setActionError(data.error);
          return false;
        }
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await load();
      return true;
    } catch (err) {
      console.error('RegistrationReview: saving a review change failed:', err);
      // All or nothing on the server: a failure here means NO row changed,
      // which is what the message says.
      setActionError(`Хадгалж чадсангүй — өөрчлөлт хийгдээгүй. ${err instanceof Error ? err.message : ''}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function applyBulk(status: OnlineRegistrationStatus) {
    const body: Record<string, unknown> = { uids: [...selected], status };
    // Blank leaves every selected row's existing note alone; typed text
    // replaces it on all of them.
    if (bulkNote.trim()) body.statusNote = bulkNote.trim();
    const ok = await patch(`/api/online-competition/admin-competitions/${competition.id}/registrations`, body);
    if (ok) {
      setSelected(new Set());
      setBulkNote('');
    }
    // On a refusal the SELECTION IS KEPT on purpose: the limit message
    // says to move these athletes to the waitlist, and ХҮЛЭЭЛГЭНД is the
    // button next to the one they just pressed. Clearing it would make
    // them tick every row again to follow the advice they were just
    // given.
  }

  async function saveNote(uid: string, text: string) {
    return patch(`/api/online-competition/admin-competitions/${competition.id}/registrations/${encodeURIComponent(uid)}`, {
      statusNote: text.trim() ? text.trim() : null,
    });
  }

  if (loadError) return <p className="text-sm text-[#E8543C]">{loadError}</p>;
  if (rows === null || open === null) return <p className="text-[#6E6A62]">Ачааллаж байна...</p>;

  const gridColumns = [
    '28px', // checkbox
    '96px', // WCA ID
    'minmax(150px, 1.3fr)', // name
    ...(columns.dob ? ['96px'] : []),
    ...(columns.country ? ['44px'] : []),
    ...(columns.events ? ['minmax(110px, 1fr)'] : []),
    ...(columns.note ? ['minmax(160px, 1.4fr)'] : []),
    ...(columns.email ? ['minmax(160px, 1fr)'] : []),
    ...(columns.registeredAt ? ['128px'] : []),
    'minmax(160px, 1.2fr)', // the admin's note
  ].join(' ');

  return (
    <div className="oc-rr">
      <p className="oc-rr-summary">{reviewSummary(rows, competition.participantLimit)}</p>

      <div className="oc-rr-toolbar">
        <input
          className="oc-rr-search"
          type="search"
          placeholder="Тамирчны нэрээр хайх"
          aria-label="Тамирчны нэрээр хайх"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="oc-rr-cols" role="group" aria-label="Харагдах баганууд">
          {COLUMNS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={columns[c.key]}
              className={`oc-rr-col${columns[c.key] ? ' oc-rr-col-on' : ''}`}
              onClick={() => setColumns((prev) => ({ ...prev, [c.key]: !prev[c.key] }))}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="oc-rr-bulk">
        <span className="oc-rr-bulk-count">{selected.size} сонгогдсон</span>
        <input
          className="oc-rr-bulk-note"
          maxLength={REGISTRATION_STATUS_NOTE_MAX}
          placeholder="Тэмдэглэл (заавал биш) — тамирчин харна"
          aria-label="Сонгосон бүртгэлд тэмдэглэл — тамирчин харна"
          value={bulkNote}
          disabled={selected.size === 0 || busy}
          onChange={(e) => setBulkNote(e.target.value)}
        />
        <div className="oc-rr-bulk-actions">
          {BULK_ACTIONS.map((a) => (
            <button
              key={a.status}
              type="button"
              className={`oc-rr-action oc-rr-action-${a.status}`}
              disabled={selected.size === 0 || busy}
              onClick={() => applyBulk(a.status)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <p className="oc-rr-hint">
        ТЭМДЭГЛЭЛ БАГАНЫН ТЕКСТИЙГ ТАМИРЧИН ӨӨРИЙН БҮРТГЭЛ ДЭЭР ХАРНА. Дотоод тэмдэглэл бичих газар одоогоор байхгүй.
      </p>
      {actionError && <p className="oc-rr-error">{actionError}</p>}

      {REVIEW_ORDER.map((status) => {
        const all = bySection[status];
        const visible = all.filter(matches);
        const isOpen = open[status];
        const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.uid));
        return (
          <section key={status} className={`oc-rr-section oc-rr-section-${status}`}>
            <div className="oc-rr-section-head">
              <button
                type="button"
                className="oc-rr-section-toggle"
                aria-expanded={isOpen}
                onClick={() => setOpen((prev) => (prev ? { ...prev, [status]: !prev[status] } : prev))}
              >
                <span className="oc-rr-caret" aria-hidden>
                  {isOpen ? '▾' : '▸'}
                </span>
                <span className="oc-rr-section-label">{REVIEW_SECTION_LABEL[status]}</span>
                <span className="oc-rr-section-count">{all.length}</span>
              </button>
            </div>

            {isOpen && all.length > 0 && (
              <div className="oc-rr-table">
                <div className="oc-rr-row oc-rr-row-head" style={{ gridTemplateColumns: gridColumns }}>
                  <input
                    type="checkbox"
                    aria-label={`${REVIEW_SECTION_LABEL[status]} — бүгдийг сонгох`}
                    checked={allSelected}
                    disabled={visible.length === 0}
                    onChange={() => toggleSection(visible)}
                  />
                  <span>WCA ID</span>
                  <span>НЭР</span>
                  {columns.dob && <span>ТӨРСӨН</span>}
                  {columns.country && <span>УЛС</span>}
                  {columns.events && <span>ТӨРЛҮҮД</span>}
                  {columns.note && <span>ТАЙЛБАР</span>}
                  {columns.email && <span>ИМЭЙЛ</span>}
                  {columns.registeredAt && <span>БҮРТГЭСЭН</span>}
                  <span className="oc-rr-right">ТЭМДЭГЛЭЛ · ТАМИРЧИН ХАРНА</span>
                </div>

                {visible.length === 0 ? (
                  <p className="oc-rr-empty">Хайлтад тохирох тамирчин алга.</p>
                ) : (
                  visible.map((r) => (
                    <div
                      key={r.uid}
                      className={`oc-rr-row${selected.has(r.uid) ? ' oc-rr-row-on' : ''}`}
                      style={{ gridTemplateColumns: gridColumns }}
                    >
                      <input
                        type="checkbox"
                        aria-label={`${r.name} сонгох`}
                        checked={selected.has(r.uid)}
                        onChange={() => toggleRow(r.uid)}
                      />
                      <span className="oc-rr-mono">{r.wcaId ?? '—'}</span>
                      <span className="oc-rr-name">
                        {r.name}
                        {r.isNew && <span className="oc-rr-new">ШИНЭ</span>}
                      </span>
                      {columns.dob && <span className="oc-rr-mono">{r.dateOfBirth ?? '—'}</span>}
                      {columns.country && (
                        <span>
                          {r.citizenship ? (
                            // eslint-disable-next-line @next/next/no-img-element -- a 20px flag from flagcdn
                            <img
                              className="oc-rr-flag"
                              src={flagUrl(r.citizenship)}
                              alt={countryName(r.citizenship)}
                              title={countryName(r.citizenship)}
                            />
                          ) : (
                            '—'
                          )}
                        </span>
                      )}
                      {columns.events && (
                        <span className="oc-rr-events">
                          {r.events.map((id) => (
                            <span key={id} className="oc-rr-ev" title={id}>
                              {hasWcaEventIcon(id) ? <WcaEventIcon eventId={id} size={14} /> : id.slice(0, 3).toUpperCase()}
                            </span>
                          ))}
                        </span>
                      )}
                      {columns.note && <span className="oc-rr-note">{r.note ?? ''}</span>}
                      {columns.email && <span className="oc-rr-mono oc-rr-clip">{r.email ?? '—'}</span>}
                      {columns.registeredAt && <span className="oc-rr-mono">{fmtMoment(r.registeredAt)}</span>}
                      <StatusNoteCell value={r.statusNote} disabled={busy} onSave={(text) => saveNote(r.uid, text)} />
                    </div>
                  ))
                )}

                <p className="oc-rr-footer">{sectionFooter(all)}</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The admin's note on one row — shown right-aligned, edited in place.
 *
 *  The placeholder and the column header both say the athlete sees it:
 *  this text appears on the athlete's own registration, under their
 *  status, and an admin writing "паспорт хуурамч байх" for colleagues must
 *  know that before pressing Enter. */
function StatusNoteCell({
  value,
  disabled,
  onSave,
}: {
  value: string | null;
  disabled: boolean;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');

  useEffect(() => {
    if (!editing) setText(value ?? '');
  }, [value, editing]);

  if (!editing) {
    return (
      <button
        type="button"
        className={`oc-rr-statusnote${value ? '' : ' oc-rr-statusnote-empty'}`}
        disabled={disabled}
        onClick={() => setEditing(true)}
        title="Засах — тамирчин энэ тэмдэглэлийг харна"
      >
        {value ?? '+ тэмдэглэл'}
      </button>
    );
  }

  async function commit() {
    if (text.trim() === (value ?? '')) {
      setEditing(false);
      return;
    }
    if (await onSave(text)) setEditing(false);
  }

  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by an explicit click on this cell
      autoFocus
      className="oc-rr-statusnote-input"
      maxLength={REGISTRATION_STATUS_NOTE_MAX}
      placeholder="Тамирчин энэ тэмдэглэлийг харна"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setText(value ?? '');
          setEditing(false);
        }
      }}
      onBlur={commit}
    />
  );
}
