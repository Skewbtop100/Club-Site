'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmailChangeDialog from './EmailChangeDialog';
import AthleteDetailPanel from './AthleteDetailPanel';
import { countryName, flagUrl } from '@/lib/online-competition/countries';
import { filterAthletes } from '@/lib/online-competition/athlete-search';
import { resolveParticipantPhoto } from '@/lib/online-competition/data';
import type { OnlineParticipantAdminView, OnlineParticipantGender } from '@/lib/online-competition/types';

// ── Тамирчдын бүртгэл ────────────────────────────────────────────────────
// VERIFIED athletes only, as a dense spreadsheet-style table. Values from
// design-mockups/Khorom Admin.dc.html (the "people" table), widened to the
// full record.
//
// Wider than the content column on most screens, so the table scrolls
// horizontally inside its own box. Above 640px the ЗУРАГ, ОВОГ and НЭР
// columns are PINNED (theme.css .oc-adm-people-sticky), so a row stays
// identifiable while scrolling to its later columns; on a phone nothing is
// pinned, because three pinned columns would fill the screen.

const MONO = 'var(--oc-font-mono), monospace';
const HEADING = 'var(--oc-font-heading), sans-serif';

const GENDER_LABEL: Record<OnlineParticipantGender, string> = {
  male: 'Эрэгтэй',
  female: 'Эмэгтэй',
  other: 'Бусад',
};

/** Pinned column geometry: each pinned cell's left offset is the widths
 *  before it, so they are fixed widths, not content-sized. */
const PHOTO_W = 56; // 28px photo + 14px padding each side
const SURNAME_W = 150;
const GIVEN_W = 150;

/** YYYY.MM.DD, the mockup's date form. */
function fmtDay(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function ageFrom(dateOfBirth: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!m) return null;
  const now = new Date();
  let age = now.getFullYear() - Number(m[1]);
  if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[3]))) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

function initialsOf(a: OnlineParticipantAdminView): string {
  const s = `${a.lastName.charAt(0)}${a.firstName.charAt(0)}` || a.displayName.slice(0, 2);
  return s.toUpperCase() || '—';
}

const TH: React.CSSProperties = {
  padding: '11px 14px',
  borderBottom: '1px solid #1C1C21',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  font: `500 8px/1 ${MONO}`,
  letterSpacing: '.1em',
  color: '#6E6A62',
  background: '#0D0D10',
};
const TD: React.CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid #16161B',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
};
const MUTED_MONO: React.CSSProperties = { font: `500 11px/1 ${MONO}`, color: '#9A958A', fontVariantNumeric: 'tabular-nums' };
// LINE-HEIGHT 1.4, NOT 1. These cells clip (overflow: hidden, for the
// ellipsis), and a clipped box is exactly as tall as its line box: at 13px/1
// that is 13px, and Cyrillic descenders — р, у, ц — hang below it and were
// cut off. 1.4 gives them the room. Every other cell uses line-height 1 but
// clips nothing, so its descenders simply overflow and stay visible.
const NAME: React.CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  font: `500 13px/1.4 ${HEADING}`,
  color: '#F4F1EA',
};

/** A pinned column's cell style: fixed width and its left offset. */
function pinned(left: number, width: number): React.CSSProperties {
  return { left, width, minWidth: width, maxWidth: width };
}

export default function VerifiedAthletesTable() {
  const [athletes, setAthletes] = useState<OnlineParticipantAdminView[] | null>(null);
  const [error, setError] = useState('');
  const [merging, setMerging] = useState<OnlineParticipantAdminView | null>(null);
  // The athlete whose photo panel is open — see the note on the photo cell.
  const [viewingUid, setViewingUid] = useState<string | null>(null);
  // The БАТАЛГААЖСАН cell whose dates popup is open, and where to draw it.
  const [dates, setDates] = useState<{ uid: string; anchor: DOMRect } | null>(null);
  // The search box. Filters the rows already loaded — see athlete-search.ts.
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const clearSearch = () => {
    setQuery('');
    setDates(null);
    searchRef.current?.focus();
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-athletes?status=approved');
      if (!res.ok) throw new Error(`admin-athletes answered ${res.status}`);
      const data = (await res.json()) as { athletes?: OnlineParticipantAdminView[] };
      setAthletes(data.athletes ?? []);
    } catch (err) {
      console.error('VerifiedAthletesTable: loading athletes failed:', err);
      setError('Тамирчдын мэдээллийг ачаалж чадсангүй — энэ нь тамирчин байхгүй гэсэн үг биш.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => (athletes ? filterAthletes(athletes, query) : null), [athletes, query]);
  const searching = query.trim() !== '';
  // The panel steps through what is on screen, so a search narrows it too.
  const viewingIndex = visible && viewingUid ? visible.findIndex((a) => a.uid === viewingUid) : -1;
  const datesFor = athletes && dates ? athletes.find((a) => a.uid === dates.uid) ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {athletes && athletes.length > 0 && !error && (
      <div
        role="search"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          border: '1px solid #1C1C21',
          background: '#0D0D10',
          padding: '14px 16px',
        }}
      >
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          {/* The mockup's search field. Line-height 1.4 for the same reason
              as the name cells: an input clips its text box. */}
          <input
            ref={searchRef}
            type="text"
            role="searchbox"
            aria-label="Тамирчин хайх"
            placeholder="Овог, нэр, и-мэйл эсвэл WCA ID"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setDates(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                clearSearch();
              }
            }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={{
              width: '100%',
              border: `1px solid ${searchFocused ? '#DFFF4F' : '#2A2A31'}`,
              background: '#08080A',
              padding: query ? '11px 40px 11px 11px' : 11,
              font: `400 13px/1.4 ${HEADING}`,
              color: '#F4F1EA',
              outline: 'none',
            }}
          />
          {query && (
            <button
              type="button"
              aria-label="Хайлт цэвэрлэх"
              title="Цэвэрлэх (Esc)"
              onClick={clearSearch}
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 28,
                height: 28,
                border: 'none',
                background: 'transparent',
                color: '#9A958A',
                cursor: 'pointer',
                font: `500 16px/1 ${MONO}`,
              }}
            >
              ×
            </button>
          )}
        </div>
        <span
          role="status"
          style={{
            font: `500 9px/1.4 ${MONO}`,
            letterSpacing: '.12em',
            color: searching ? '#DFFF4F' : '#6E6A62',
            whiteSpace: 'nowrap',
            flex: 'none',
          }}
        >
          {searching && visible ? `${visible.length} / ${athletes.length} ТАМИРЧИН` : `${athletes.length} ТАМИРЧИН`}
        </span>
      </div>
    )}

    <div style={{ border: '1px solid #1C1C21', background: '#0D0D10' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid #1C1C21',
        }}
      >
        <span style={{ font: `500 9px/1 ${MONO}`, letterSpacing: '.18em', color: '#6E6A62' }}>БАТАЛГААЖСАН ТАМИРЧИД</span>
      </div>

      {error ? (
        <div role="alert" style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <p style={{ font: `500 13px ${HEADING}`, color: '#E8543C' }}>{error}</p>
          <button type="button" className="oc-sc-btn" onClick={load}>
            ДАХИН АЧААЛАХ
          </button>
        </div>
      ) : athletes === null ? (
        <p style={{ padding: 16, font: `400 13px ${HEADING}`, color: '#6E6A62' }}>Ачааллаж байна...</p>
      ) : athletes.length === 0 ? (
        <p style={{ padding: '56px 16px', textAlign: 'center', font: `500 13px/1 ${HEADING}`, color: '#6E6A62' }}>
          Баталгаажсан тамирчин алга.
        </p>
      ) : visible && visible.length === 0 ? (
        // Nothing matches THE SEARCH — worded differently from the empty
        // list above, and the way out is right here.
        <div style={{ padding: '48px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <p style={{ font: `500 13px/1.4 ${HEADING}`, color: '#6E6A62', textAlign: 'center', overflowWrap: 'anywhere' }}>
            «{query.trim()}» — тохирох тамирчин алга.
          </p>
          <button type="button" className="oc-sc-btn" onClick={clearSearch}>
            ХАЙЛТ ЦЭВЭРЛЭХ
          </button>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }} onScroll={() => setDates(null)}>
          <table style={{ width: '100%', minWidth: 1120, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="oc-adm-people-sticky" style={{ ...TH, ...pinned(0, PHOTO_W), zIndex: 2 }}>
                  ЗУРАГ
                </th>
                <th className="oc-adm-people-sticky" style={{ ...TH, ...pinned(PHOTO_W, SURNAME_W), zIndex: 2 }}>
                  ОВОГ
                </th>
                <th
                  className="oc-adm-people-sticky oc-adm-people-sticky-edge"
                  style={{ ...TH, ...pinned(PHOTO_W + SURNAME_W, GIVEN_W), zIndex: 2 }}
                >
                  НЭР
                </th>
                <th style={TH}>И-МЭЙЛ</th>
                <th style={TH}>WCA ID</th>
                <th style={TH}>ТӨРСӨН</th>
                <th style={{ ...TH, textAlign: 'right' }}>НАС</th>
                <th style={TH}>ХҮЙС</th>
                <th style={TH}>УЛС</th>
                <th style={TH}>БАТАЛГААЖСАН</th>
                <th style={TH} aria-label="Үйлдэл" />
              </tr>
            </thead>
            <tbody>
              {(visible ?? []).map((a) => {
                const photo = resolveParticipantPhoto(a);
                const age = ageFrom(a.dateOfBirth);
                const datesOpen = dates?.uid === a.uid;
                return (
                  <tr key={a.uid} className="oc-adm-people-row">
                    <td className="oc-adm-people-sticky" style={{ ...TD, ...pinned(0, PHOTO_W) }}>
                      {/* Opens the athlete panel: its one remaining job is the
                          verification photo at a legible size, which a table
                          cell cannot show. */}
                      <button
                        type="button"
                        title="Зураг харах"
                        aria-label={`${a.lastName} ${a.firstName} — зураг харах`}
                        onClick={() => setViewingUid(a.uid)}
                        style={{ display: 'block', padding: 0, border: 0, background: 'none', cursor: 'pointer' }}
                      >
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- Cloudinary URL, not our own image pipeline.
                          <img src={photo} alt="" style={{ width: 28, height: 28, objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <span
                            style={{
                              width: 28,
                              height: 28,
                              background: '#16161B',
                              color: '#9A958A',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              font: `600 10px/1 ${MONO}`,
                            }}
                          >
                            {initialsOf(a)}
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="oc-adm-people-sticky" style={{ ...TD, ...pinned(PHOTO_W, SURNAME_W) }}>
                      <span style={NAME} title={a.lastName}>
                        {a.lastName || '—'}
                      </span>
                    </td>
                    <td
                      className="oc-adm-people-sticky oc-adm-people-sticky-edge"
                      style={{ ...TD, ...pinned(PHOTO_W + SURNAME_W, GIVEN_W) }}
                    >
                      <span style={NAME} title={a.firstName}>
                        {a.firstName || '—'}
                      </span>
                    </td>
                    <td style={TD}>
                      <span style={{ font: `400 11px/1 ${MONO}`, color: '#9A958A' }}>{a.email || '—'}</span>
                    </td>
                    <td style={TD}>
                      {a.wcaId ? (
                        <span style={{ font: `600 11px/1 ${MONO}`, color: '#DFFF4F' }}>{a.wcaId}</span>
                      ) : (
                        <span style={{ font: `400 10px/1 ${MONO}`, color: '#6E6A62' }}>байхгүй</span>
                      )}
                    </td>
                    <td style={TD}>
                      <span style={MUTED_MONO}>{a.dateOfBirth ? a.dateOfBirth.replace(/-/g, '.') : '—'}</span>
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <span style={MUTED_MONO}>{age ?? '—'}</span>
                    </td>
                    <td style={TD}>
                      <span style={{ font: `400 12px/1 ${HEADING}`, color: '#9A958A' }}>
                        {a.gender ? GENDER_LABEL[a.gender] : '—'}
                      </span>
                    </td>
                    <td style={TD}>
                      {a.citizenship ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          {/* The mockup's 20x13 flag, from the same flagcdn
                              helper the profile picker and the registration
                              review use. */}
                          <span
                            aria-hidden
                            style={{
                              width: 20,
                              height: 13,
                              flex: 'none',
                              border: '1px solid #2A2A31',
                              backgroundImage: `url(${flagUrl(a.citizenship)})`,
                              backgroundSize: '100% 100%',
                              backgroundRepeat: 'no-repeat',
                              backgroundColor: '#0A0A0C',
                            }}
                          />
                          <span style={{ font: `400 12px/1 ${HEADING}`, color: '#9A958A' }}>{countryName(a.citizenship)}</span>
                        </span>
                      ) : (
                        <span style={{ font: `400 12px/1 ${HEADING}`, color: '#6E6A62' }}>—</span>
                      )}
                    </td>
                    <td style={TD}>
                      {/* The one date column. The other two are a click away. */}
                      <button
                        type="button"
                        aria-expanded={datesOpen}
                        aria-haspopup="dialog"
                        title="Бусад огноо"
                        onClick={(e) => {
                          const anchor = e.currentTarget.getBoundingClientRect();
                          setDates(datesOpen ? null : { uid: a.uid, anchor });
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 7,
                          padding: '4px 6px',
                          margin: '-4px -6px',
                          border: `1px solid ${datesOpen ? '#DFFF4F' : 'transparent'}`,
                          background: 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={MUTED_MONO}>{fmtDay(a.reviewedAt)}</span>
                        <span
                          aria-hidden
                          style={{
                            width: 0,
                            height: 0,
                            borderTop: '3px solid transparent',
                            borderBottom: '3px solid transparent',
                            borderLeft: `4px solid ${datesOpen ? '#DFFF4F' : '#6E6A62'}`,
                          }}
                        />
                      </button>
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      {/* Opens the two-step merge dialog. Nothing is written
                          until the preview inside it has been confirmed. */}
                      <button
                        type="button"
                        className="oc-v3-row-action"
                        style={{ width: 'auto' }}
                        title="Тамирчны мэдээллийг шинэ Gmail рүү шилжүүлэх"
                        onClick={() => setMerging(a)}
                      >
                        МЭЙЛ СОЛИХ
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dates && datesFor && <DatesPopup athlete={datesFor} anchor={dates.anchor} onClose={() => setDates(null)} />}

      {visible && viewingIndex !== -1 && (
        <AthleteDetailPanel
          athlete={visible[viewingIndex]}
          position={{ index: viewingIndex, total: visible.length }}
          onPrev={viewingIndex > 0 ? () => setViewingUid(visible[viewingIndex - 1].uid) : null}
          onNext={viewingIndex < visible.length - 1 ? () => setViewingUid(visible[viewingIndex + 1].uid) : null}
          onClose={() => setViewingUid(null)}
        />
      )}

      {merging && (
        <EmailChangeDialog
          athlete={merging}
          onClose={() => setMerging(null)}
          onMerged={() => {
            // The athlete now lives under a different uid — refetch.
            load();
          }}
        />
      )}
    </div>
    </div>
  );
}

const POPUP_W = 220;
const POPUP_H = 104;
const EDGE = 8;

/** ХҮСЭЛТ ИЛГЭЭСЭН and БҮРТГҮҮЛСЭН, beside the БАТАЛГААЖСАН cell.
 *
 *  Drawn with position: fixed from the cell's own rectangle — NOT absolutely
 *  inside the table, whose horizontal-scroll box would clip it. To the RIGHT
 *  of the cell by default; when that would cross the viewport's right edge it
 *  flips to the LEFT of the cell, and it is clamped to stay 8px inside the
 *  viewport on every side.
 *
 *  Closes on: a click anywhere outside it (the cell's own button toggles it),
 *  Escape, and any scroll or resize — a fixed popup would otherwise float
 *  away from the row it describes. */
function DatesPopup({
  athlete,
  anchor,
  onClose,
}: {
  athlete: OnlineParticipantAdminView;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      // The trigger toggles itself; let its own click handle it.
      if ((target as HTMLElement).closest?.('[aria-haspopup="dialog"][aria-expanded="true"]')) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let left = anchor.right + EDGE;
  if (left + POPUP_W > vw - EDGE) left = anchor.left - POPUP_W - EDGE;
  left = Math.max(EDGE, Math.min(left, vw - POPUP_W - EDGE));
  const top = Math.max(EDGE, Math.min(anchor.top - 10, vh - POPUP_H - EDGE));

  const row = (label: string, ms: number | null) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderBottom: '1px solid #16161B' }}>
      <span style={{ font: `500 8px/1 ${MONO}`, letterSpacing: '.14em', color: '#6E6A62' }}>{label}</span>
      <span style={{ font: `500 11px/1 ${MONO}`, color: '#F4F1EA', fontVariantNumeric: 'tabular-nums' }}>{fmtDay(ms)}</span>
    </div>
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Огноо"
      style={{
        position: 'fixed',
        left,
        top,
        width: POPUP_W,
        zIndex: 70,
        border: '1px solid #2A2A31',
        background: '#0D0D10',
        boxShadow: '0 18px 40px -14px rgba(0,0,0,.9)',
      }}
    >
      {row('ХҮСЭЛТ ИЛГЭЭСЭН', athlete.submittedAt)}
      {row('БҮРТГҮҮЛСЭН', athlete.createdAt)}
    </div>
  );
}
