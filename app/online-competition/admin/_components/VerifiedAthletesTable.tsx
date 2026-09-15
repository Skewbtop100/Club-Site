'use client';

import { useCallback, useEffect, useState } from 'react';
import EmailChangeDialog from './EmailChangeDialog';
import AthleteDetailPanel from './AthleteDetailPanel';
import { countryName } from '@/lib/online-competition/countries';
import { resolveParticipantPhoto } from '@/lib/online-competition/data';
import type { OnlineParticipantAdminView, OnlineParticipantGender } from '@/lib/online-competition/types';

// ── Тамирчдын бүртгэл ────────────────────────────────────────────────────
// VERIFIED athletes only, as a dense spreadsheet-style table: every field on
// screen at once. Values from design-mockups/Khorom Admin.dc.html (the
// "people" table), widened to the full record.
//
// Wider than the content column on most screens, so the table scrolls
// horizontally inside its own box, with the name column PINNED (position:
// sticky) so a row stays identifiable while scrolling to its later columns.
// Pending requests are their own page (AthleteRequests).

const MONO = 'var(--oc-font-mono), monospace';
const HEADING = 'var(--oc-font-heading), sans-serif';

const GENDER_LABEL: Record<OnlineParticipantGender, string> = {
  male: 'Эрэгтэй',
  female: 'Эмэгтэй',
  other: 'Бусад',
};

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

export default function VerifiedAthletesTable() {
  const [athletes, setAthletes] = useState<OnlineParticipantAdminView[] | null>(null);
  const [error, setError] = useState('');
  const [merging, setMerging] = useState<OnlineParticipantAdminView | null>(null);
  // The athlete whose photo panel is open — see the note on the avatar.
  const [viewingUid, setViewingUid] = useState<string | null>(null);

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

  const viewingIndex = athletes && viewingUid ? athletes.findIndex((a) => a.uid === viewingUid) : -1;

  return (
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
        {athletes && (
          <span style={{ font: `500 9px/1 ${MONO}`, letterSpacing: '.12em', color: '#9A958A', whiteSpace: 'nowrap' }}>
            {athletes.length} ТАМИРЧИН
          </span>
        )}
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
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 1240, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="oc-adm-people-sticky" style={{ ...TH, zIndex: 2 }}>
                  ОВОГ · НЭР
                </th>
                <th style={TH}>И-МЭЙЛ</th>
                <th style={TH}>WCA ID</th>
                <th style={TH}>ТӨРСӨН</th>
                <th style={{ ...TH, textAlign: 'right' }}>НАС</th>
                <th style={TH}>ХҮЙС</th>
                <th style={TH}>УЛС</th>
                <th style={TH}>БАТАЛГААЖСАН</th>
                <th style={TH}>ХҮСЭЛТ ИЛГЭЭСЭН</th>
                <th style={TH}>БҮРТГҮҮЛСЭН</th>
                <th style={TH}>GOOGLE НЭР</th>
                <th style={TH} aria-label="Үйлдэл" />
              </tr>
            </thead>
            <tbody>
              {athletes.map((a) => {
                const photo = resolveParticipantPhoto(a);
                const age = ageFrom(a.dateOfBirth);
                return (
                  <tr key={a.uid} className="oc-adm-people-row">
                    <td className="oc-adm-people-sticky" style={TD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {/* The avatar opens the athlete panel: its one remaining
                            job is the verification photo at a legible size,
                            which a table cell cannot show. */}
                        <button
                          type="button"
                          title="Зураг харах"
                          aria-label={`${a.lastName} ${a.firstName} — зураг харах`}
                          onClick={() => setViewingUid(a.uid)}
                          style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer', flex: 'none' }}
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
                        <span style={{ font: `500 13px/1 ${HEADING}`, color: '#F4F1EA' }}>
                          {`${a.lastName} ${a.firstName}`.trim() || a.displayName || '—'}
                        </span>
                      </div>
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
                      <span style={{ font: `400 12px/1 ${HEADING}`, color: '#9A958A' }}>
                        {a.citizenship ? `${countryName(a.citizenship)}` : '—'}
                      </span>
                      {a.citizenship && (
                        <span style={{ marginLeft: 6, font: `400 9px/1 ${MONO}`, color: '#6E6A62' }}>{a.citizenship.toUpperCase()}</span>
                      )}
                    </td>
                    <td style={TD}>
                      <span style={MUTED_MONO}>{fmtDay(a.reviewedAt)}</span>
                    </td>
                    <td style={TD}>
                      <span style={MUTED_MONO}>{fmtDay(a.submittedAt)}</span>
                    </td>
                    <td style={TD}>
                      <span style={MUTED_MONO}>{fmtDay(a.createdAt)}</span>
                    </td>
                    <td style={TD}>
                      <span style={{ font: `400 12px/1 ${HEADING}`, color: '#6E6A62' }}>{a.displayName || '—'}</span>
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

      {athletes && viewingIndex !== -1 && (
        <AthleteDetailPanel
          athlete={athletes[viewingIndex]}
          position={{ index: viewingIndex, total: athletes.length }}
          onPrev={viewingIndex > 0 ? () => setViewingUid(athletes[viewingIndex - 1].uid) : null}
          onNext={viewingIndex < athletes.length - 1 ? () => setViewingUid(athletes[viewingIndex + 1].uid) : null}
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
  );
}
