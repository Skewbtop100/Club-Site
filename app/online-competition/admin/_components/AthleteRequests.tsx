'use client';

import { useCallback, useEffect, useState } from 'react';
import { countryName } from '@/lib/online-competition/countries';
import { formatNotifMeta } from '@/lib/online-competition/notifications';
import type { OnlineParticipantAdminView, OnlineParticipantGender } from '@/lib/online-competition/types';

// ── Бүртгэлийн хүсэлт ────────────────────────────────────────────────────
// Pending athlete-verification requests. Values from
// design-mockups/Khorom Admin.dc.html (the "requests" screen) — but, unlike
// the mockup, the list is COMPACT and a request expands only when clicked.
//
// ONE EXPANDED AT A TIME. Each expanded request carries a large photo and
// its own approve/reject controls; with two open, a click meant for one is
// easily landed on the other, and the list stops being scannable. Choices
// already made on a request survive collapsing it (kept per uid below).
//
// ── The two approvals, each stored ──
// МЭДЭЭЛЭЛ and ЗУРАГ are separate decisions on the server
// (lib/online-competition/verification.ts), sent together by POST
// /api/online-competition/admin-athletes/{uid}:
//   · every PENDING part needs a decision — approve, or reject with a
//     reason;
//   · a part approved in an earlier review is shown approved and LOCKED:
//     an athlete who resubmits only the rejected photo does not have their
//     details reviewed again;
//   · Тамирчнаар бүртгэх when both end up approved, ХҮСЭЛТ ХААХ when one
//     is rejected. Either way the athlete is notified which part was
//     approved and which rejected, with the reason.
// The choices on screen are a draft until sent; the request carries the
// submission time the admin was looking at, so a resubmission that arrived
// meanwhile is refused rather than approved unseen.

const MONO = 'var(--oc-font-mono), monospace';
const HEADING = 'var(--oc-font-heading), sans-serif';

const GENDER_LABEL: Record<OnlineParticipantGender, string> = {
  male: 'Эрэгтэй',
  female: 'Эмэгтэй',
  other: 'Бусад',
};

type PartState = true | false | null;
interface Checklist {
  info: PartState;
  photo: PartState;
  infoNote: string;
  photoNote: string;
}
/** A request's checklist before the admin touches it: a part approved in
 *  an earlier review starts (and stays) approved. */
function initialChecklist(a: OnlineParticipantAdminView): Checklist {
  return {
    info: a.detailsStatus === 'approved' ? true : null,
    photo: a.photoStatus === 'approved' ? true : null,
    infoNote: '',
    photoNote: '',
  };
}

type PartBody = { decision: 'approve' } | { decision: 'reject'; reason: string };
interface DecisionBody {
  submittedAt: number | null;
  details?: PartBody;
  photo?: PartBody;
}

/** The decision to send: the PENDING parts only — an already-approved part
 *  is not decided again. */
export function decisionBodyFor(a: OnlineParticipantAdminView, c: Checklist): DecisionBody {
  const part = (pending: boolean, state: PartState, note: string): PartBody | undefined =>
    !pending || state === null ? undefined : state ? { decision: 'approve' } : { decision: 'reject', reason: note.trim() };
  return {
    submittedAt: a.submittedAt,
    details: part(a.detailsStatus === 'pending', c.info, c.infoNote),
    photo: part(a.photoStatus === 'pending', c.photo, c.photoNote),
  };
}

function initialsOf(a: OnlineParticipantAdminView): string {
  return (`${a.lastName.charAt(0)}${a.firstName.charAt(0)}` || a.displayName.slice(0, 2)).toUpperCase() || '—';
}

function ageFrom(dateOfBirth: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!m) return null;
  const now = new Date();
  let age = now.getFullYear() - Number(m[1]);
  if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[3]))) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/** "2 ЦАГИЙН ӨМНӨ"-style, from the notification bell's own formatter. */
function sentAgo(ms: number | null): string {
  return ms === null ? '—' : formatNotifMeta('', new Date(ms));
}

export default function AthleteRequests() {
  const [requests, setRequests] = useState<OnlineParticipantAdminView[] | null>(null);
  const [error, setError] = useState('');
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [checklists, setChecklists] = useState<Record<string, Checklist>>({});
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ uid: string; message: string } | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-athletes?status=pending');
      if (!res.ok) throw new Error(`admin-athletes answered ${res.status}`);
      const data = (await res.json()) as { athletes?: OnlineParticipantAdminView[] };
      setRequests(data.athletes ?? []);
    } catch (err) {
      console.error('AthleteRequests: loading requests failed:', err);
      setError('Хүсэлтүүдийг ачаалж чадсангүй — энэ нь хүсэлт байхгүй гэсэн үг биш.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const checklistOf = (a: OnlineParticipantAdminView) => checklists[a.uid] ?? initialChecklist(a);
  const patch = (a: OnlineParticipantAdminView, next: Partial<Checklist>) =>
    setChecklists((prev) => ({ ...prev, [a.uid]: { ...(prev[a.uid] ?? initialChecklist(a)), ...next } }));

  /** Sends both parts' decisions in one request. */
  async function decide(a: OnlineParticipantAdminView, body: DecisionBody) {
    setBusyUid(a.uid);
    setActionError(null);
    setNote('');
    try {
      const res = await fetch(`/api/online-competition/admin-athletes/${encodeURIComponent(a.uid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; profileStatus?: string } | null;
      if (!res.ok) {
        // The request changed under the admin (a resubmission, or another
        // admin): say so, and show the current list.
        if (res.status === 409) void load();
        setActionError({ uid: a.uid, message: data?.error ?? 'Шийдвэрийг хадгалж чадсангүй. Дахин оролдоно уу.' });
        return;
      }
      const name = `${a.lastName} ${a.firstName}`.trim() || a.displayName;
      setRequests((prev) => (prev ?? []).filter((r) => r.uid !== a.uid));
      setOpenUid(null);
      setNote(
        data?.profileStatus === 'approved'
          ? `${name}: тамирчнаар бүртгэгдлээ.`
          : `${name}: шийдвэр илгээгдлээ — татгалзсан хэсгийг тамирчин дахин илгээнэ.`,
      );
    } catch (err) {
      console.error('AthleteRequests: the decision failed:', err);
      setActionError({ uid: a.uid, message: 'Шийдвэрийг хадгалж чадсангүй. Дахин оролдоно уу.' });
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          border: '1px solid #1C1C21',
          background: '#0D0D10',
          padding: '14px 16px',
        }}
      >
        <span style={{ font: `500 9px/1 ${MONO}`, letterSpacing: '.18em', color: '#6E6A62' }}>ТАМИРЧИН БОЛОХ ХҮСЭЛТ</span>
        {requests && (
          <span style={{ font: `500 9px/1 ${MONO}`, letterSpacing: '.12em', color: '#DFFF4F', whiteSpace: 'nowrap', flex: 'none' }}>
            {requests.length} ХҮЛЭЭГДЭЖ
          </span>
        )}
      </div>

      {note && (
        <p className="oc-rv-reset-note" role="status">
          {note}
        </p>
      )}

      {error ? (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <p style={{ font: `500 13px ${HEADING}`, color: '#E8543C' }}>{error}</p>
          <button type="button" className="oc-sc-btn" onClick={load}>
            ДАХИН АЧААЛАХ
          </button>
        </div>
      ) : requests === null ? (
        <p style={{ font: `400 13px ${HEADING}`, color: '#6E6A62' }}>Ачааллаж байна...</p>
      ) : requests.length === 0 ? (
        <div
          style={{
            border: '1px dashed #1C1C21',
            padding: '56px 16px',
            textAlign: 'center',
            font: `500 13px/1 ${HEADING}`,
            color: '#6E6A62',
          }}
        >
          Хүсэлт алга.
        </div>
      ) : (
        <div style={{ border: '1px solid #1C1C21', background: '#0D0D10' }}>
          {requests.map((a) => {
            const open = openUid === a.uid;
            return (
              <div key={a.uid} style={{ borderBottom: '1px solid #16161B' }}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenUid(open ? null : a.uid)}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '40px minmax(0, 1fr) auto auto',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    border: 'none',
                    borderLeft: `2px solid ${open ? '#DFFF4F' : 'transparent'}`,
                    background: open ? '#131318' : 'transparent',
                    color: '#F4F1EA',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <Thumb athlete={a} size={40} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    {/* Line-height 1.4: these clip for the ellipsis, and a
                        shorter line box cuts Cyrillic descenders. */}
                    <span style={{ font: `500 13px/1.4 ${HEADING}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {`${a.lastName} ${a.firstName}`.trim() || a.displayName || '—'}
                    </span>
                    <span style={{ font: `400 10px/1.4 ${MONO}`, color: '#6E6A62', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.email || '—'}
                    </span>
                  </span>
                  <span style={{ font: `400 8px/1 ${MONO}`, letterSpacing: '.12em', color: '#6E6A62', whiteSpace: 'nowrap' }}>
                    {sentAgo(a.submittedAt)}
                  </span>
                  <span
                    aria-hidden
                    style={{
                      width: 0,
                      height: 0,
                      borderLeft: '4px solid transparent',
                      borderRight: '4px solid transparent',
                      ...(open ? { borderBottom: '5px solid #DFFF4F' } : { borderTop: '5px solid #6E6A62' }),
                    }}
                  />
                </button>

                {open && (
                  <RequestDetail
                    athlete={a}
                    checklist={checklistOf(a)}
                    onChange={(next) => patch(a, next)}
                    busy={busyUid === a.uid}
                    error={actionError?.uid === a.uid ? actionError.message : ''}
                    onDecide={() => decide(a, decisionBodyFor(a, checklistOf(a)))}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Thumb({ athlete, size }: { athlete: OnlineParticipantAdminView; size: number }) {
  if (athlete.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- Cloudinary URL, not our own image pipeline.
    return <img src={athlete.photoUrl} alt="" style={{ width: size, height: size, objectFit: 'cover', display: 'block' }} />;
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        background: 'repeating-linear-gradient(135deg,#0A0A0C 0 8px,#101014 8px 16px)',
        border: '1px solid #2A2A31',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: `700 12px/1 ${MONO}`,
        color: '#3A3A42',
      }}
    >
      {initialsOf(athlete)}
    </span>
  );
}

function RequestDetail({
  athlete: a,
  checklist: c,
  onChange,
  busy,
  error,
  onDecide,
}: {
  athlete: OnlineParticipantAdminView;
  checklist: Checklist;
  onChange: (next: Partial<Checklist>) => void;
  busy: boolean;
  error: string;
  onDecide: () => void;
}) {
  const age = ageFrom(a.dateOfBirth);
  // Approved in an earlier review — shown, not decided again.
  const infoLocked = a.detailsStatus !== 'pending';
  const photoLocked = a.photoStatus !== 'pending';
  const anyRejected = c.info === false || c.photo === false;
  const bothApproved = c.info === true && c.photo === true;
  // Both parts decided, and every rejected part has its reason.
  const decisionsComplete =
    c.info !== null &&
    c.photo !== null &&
    (c.info !== false || c.infoNote.trim() !== '') &&
    (c.photo !== false || c.photoNote.trim() !== '');
  const photoLine = c.photo === true ? '#4FD07A' : c.photo === false ? '#D8402C' : '#2A2A31';

  const cell = (label: string, value: React.ReactNode, previous?: string | null, current?: string) => (
    <div style={{ background: '#0A0A0C', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ font: `500 8px/1 ${MONO}`, letterSpacing: '.14em', color: '#6E6A62' }}>{label}</span>
      {value}
      {previous != null && current !== undefined && previous !== current && (
        <span style={{ font: `400 10px/1.3 ${HEADING}`, color: '#9A958A' }}>Өмнө баталсан: {previous || '—'}</span>
      )}
    </div>
  );
  const text = (v: string, mono = false) => (
    <span style={{ font: mono ? `500 12px/1 ${MONO}` : `500 12px/1 ${HEADING}`, color: '#F4F1EA', overflowWrap: 'anywhere' }}>{v || '—'}</span>
  );

  return (
    <div style={{ borderTop: '1px solid #1C1C21' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {/* The verification photo at a legible size: up to 300px wide at its
            own shape, never cropped, and the original a click away. */}
        <div
          style={{
            flex: '0 1 300px',
            minWidth: 0,
            borderRight: '1px solid #1C1C21',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
          }}
        >
          {a.photoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary URL, not our own image pipeline. */}
              <img
                src={a.photoUrl}
                alt={`${a.lastName} ${a.firstName} — зураг`}
                style={{
                  display: 'block',
                  width: '100%',
                  height: 'auto',
                  maxHeight: '60vh',
                  objectFit: 'contain',
                  background: '#08080A',
                  border: `1px solid ${photoLine}`,
                }}
              />
              <a
                href={a.photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ font: `500 8px/1 ${MONO}`, letterSpacing: '.14em', color: '#9A958A' }}
              >
                ЖИНХЭНЭ ХЭМЖЭЭГЭЭР ↗
              </a>
            </>
          ) : (
            <div
              style={{
                width: '100%',
                aspectRatio: '1 / 1',
                background: 'repeating-linear-gradient(135deg,#0A0A0C 0 8px,#101014 8px 16px)',
                border: `1px solid ${photoLine}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ font: `700 26px/1 ${MONO}`, color: '#3A3A42' }}>{initialsOf(a)}</span>
            </div>
          )}
          <span style={{ font: `400 8px/1 ${MONO}`, letterSpacing: '.14em', color: '#6E6A62' }}>PROFILE ЗУРАГ</span>
        </div>

        <div style={{ flex: '1 1 320px', minWidth: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ font: `600 16px/1.2 ${HEADING}`, color: '#F4F1EA' }}>
                {`${a.lastName} ${a.firstName}`.trim() || a.displayName || '—'}
              </span>
              <span style={{ font: `400 10px/1 ${MONO}`, color: '#6E6A62', overflowWrap: 'anywhere' }}>{a.email || '—'}</span>
            </div>
            <span style={{ font: `400 8px/1 ${MONO}`, letterSpacing: '.12em', color: '#6E6A62', whiteSpace: 'nowrap', flex: 'none' }}>
              {sentAgo(a.submittedAt)}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 1,
              background: '#1C1C21',
              border: '1px solid #1C1C21',
            }}
          >
            {cell('ОВОГ', text(a.lastName), a.approvedLastName, a.lastName)}
            {cell('НЭР', text(a.firstName), a.approvedFirstName, a.firstName)}
            {cell(
              'ТӨРСӨН ӨДӨР',
              text(a.dateOfBirth ? `${a.dateOfBirth.replace(/-/g, '.')}${age !== null ? ` (${age})` : ''}` : '', true),
              a.approvedDateOfBirth,
              a.dateOfBirth,
            )}
            {cell('ХҮЙС', text(a.gender ? GENDER_LABEL[a.gender] : ''), a.approvedGender, a.gender ?? '')}
            {cell(
              'WCA ID',
              a.wcaId ? (
                <span style={{ font: `600 12px/1 ${MONO}`, color: '#DFFF4F' }}>{a.wcaId}</span>
              ) : (
                <span style={{ font: `400 11px/1 ${MONO}`, color: '#6E6A62' }}>байхгүй</span>
              ),
            )}
            {cell('УЛС', text(a.citizenship ? `${countryName(a.citizenship)} (${a.citizenship.toUpperCase()})` : ''), a.approvedCitizenship, a.citizenship)}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #1C1C21', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ font: `500 8px/1 ${MONO}`, letterSpacing: '.16em', color: '#6E6A62' }}>ХОЁР ЗӨВШӨӨРӨЛ</span>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Approval
            part="МЭДЭЭЛЭЛ"
            state={c.info}
            locked={infoLocked}
            note={c.infoNote}
            placeholder="Мэдээллийг татгалзсан шалтгаан"
            onApprove={() => onChange({ info: c.info === true ? null : true })}
            onReject={() => onChange({ info: c.info === false ? null : false })}
            onNote={(infoNote) => onChange({ infoNote })}
          />
          <Approval
            part="ЗУРАГ"
            state={c.photo}
            locked={photoLocked}
            note={c.photoNote}
            placeholder="Зургийг татгалзсан шалтгаан"
            onApprove={() => onChange({ photo: c.photo === true ? null : true })}
            onReject={() => onChange({ photo: c.photo === false ? null : false })}
            onNote={(photoNote) => onChange({ photoNote })}
          />
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 9,
            alignItems: 'center',
            borderTop: '1px solid #16161B',
            paddingTop: 12,
          }}
        >
          {anyRejected && !decisionsComplete ? (
            <span style={{ font: `500 9px/1.5 ${MONO}`, letterSpacing: '.1em', color: '#6E6A62' }}>
              ХОЁР ХЭСГИЙГ ШИЙДВЭРЛЭЖ, ШАЛТГААНАА БИЧНЭ ҮҮ
            </span>
          ) : anyRejected ? (
            <span style={{ font: `500 9px/1.5 ${MONO}`, letterSpacing: '.1em', color: '#FF9C8C' }}>
              ТАТГАЛЗСАН ХЭСГИЙГ ТАМИРЧИН ДАХИН ИЛГЭЭНЭ
            </span>
          ) : !bothApproved ? (
            <span style={{ font: `500 9px/1.5 ${MONO}`, letterSpacing: '.1em', color: '#6E6A62' }}>
              ХОЁР ЗӨВШӨӨРӨЛ ХОЁУЛАА ШААРДЛАГАТАЙ
            </span>
          ) : null}
          {error && <span style={{ font: `400 11px/1.4 ${HEADING}`, color: '#E8543C' }}>{error}</span>}

          {bothApproved ? (
            <button
              type="button"
              onClick={onDecide}
              disabled={busy}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: '#DFFF4F',
                color: '#08080A',
                padding: '12px 18px',
                cursor: busy ? 'default' : 'pointer',
                font: `700 11px/1 ${HEADING}`,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                flex: 'none',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Бүртгэж байна...' : 'Тамирчнаар бүртгэх'}
            </button>
          ) : (
            <div
              aria-disabled="true"
              style={{
                marginLeft: 'auto',
                border: '1px dashed #2A2A31',
                background: '#0A0A0C',
                color: '#4A4740',
                padding: '12px 18px',
                font: `700 11px/1 ${HEADING}`,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                flex: 'none',
              }}
            >
              Тамирчнаар бүртгэх
            </div>
          )}
          <button
            type="button"
            onClick={onDecide}
            disabled={busy || !anyRejected || !decisionsComplete}
            title={anyRejected && decisionsComplete ? undefined : 'Хоёр хэсгийг шийдвэрлэж, татгалзсан хэсгийн шалтгааныг бичнэ үү'}
            style={{
              border: '1px solid #2A2A31',
              background: 'transparent',
              color: anyRejected && decisionsComplete ? '#FF9C8C' : '#4A4740',
              padding: '11px 14px',
              cursor: busy || !anyRejected || !decisionsComplete ? 'default' : 'pointer',
              font: `600 9px/1 ${MONO}`,
              letterSpacing: '.1em',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            ХҮСЭЛТ ХААХ
          </button>
        </div>
      </div>
    </div>
  );
}

function Approval({
  part,
  state,
  locked,
  note,
  placeholder,
  onApprove,
  onReject,
  onNote,
}: {
  part: 'МЭДЭЭЛЭЛ' | 'ЗУРАГ';
  state: PartState;
  /** Approved in an earlier review: shown, and not decided again. */
  locked: boolean;
  note: string;
  placeholder: string;
  onApprove: () => void;
  onReject: () => void;
  onNote: (value: string) => void;
}) {
  if (locked) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          border: '1px solid #1F3A26',
          background: '#0F1A12',
          color: '#4FD07A',
          padding: '11px 12px',
          font: `600 9px/1.4 ${MONO}`,
          letterSpacing: '.1em',
        }}
      >
        <span aria-hidden>✓</span>
        <span>{part} ӨМНӨ БАТАЛГААЖСАН</span>
      </div>
    );
  }
  const line = state === true ? '#4FD07A' : state === false ? '#D8402C' : '#2A2A31';
  const bg = state === true ? '#0F1A12' : state === false ? '#1A0D0A' : 'transparent';
  const fg = state === true ? '#4FD07A' : state === false ? '#FF9C8C' : '#9A958A';
  const label = state === true ? `${part} БАТАЛГААЖСАН` : state === false ? `${part} ТАТГАЛЗСАН` : `${part} БАТАЛГААЖУУЛАХ`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          aria-pressed={state === true}
          onClick={onApprove}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            border: `1px solid ${line}`,
            background: bg,
            color: fg,
            padding: '11px 12px',
            cursor: 'pointer',
            font: `600 9px/1 ${MONO}`,
            letterSpacing: '.1em',
            textAlign: 'left',
          }}
        >
          {state === true ? (
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '1.5px solid #4FD07A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                font: `700 8px/1 ${MONO}`,
                flex: 'none',
              }}
            >
              ✓
            </span>
          ) : (
            <span style={{ width: 14, height: 14, border: '1px solid #3A3A42', flex: 'none' }} />
          )}
          <span>{label}</span>
        </button>
        <button
          type="button"
          aria-pressed={state === false}
          onClick={onReject}
          style={{
            border: `1px solid ${state === false ? '#D8402C' : '#2A2A31'}`,
            background: 'transparent',
            color: state === false ? '#FF9C8C' : '#9A958A',
            padding: '11px 12px',
            cursor: 'pointer',
            font: `600 9px/1 ${MONO}`,
            letterSpacing: '.1em',
            whiteSpace: 'nowrap',
            flex: 'none',
          }}
        >
          ТАТГАЛЗАХ
        </button>
      </div>
      {state === false && (
        <input
          type="text"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder={placeholder}
          autoFocus
          style={{
            border: '1px solid #D8402C',
            background: '#08080A',
            padding: '10px 11px',
            font: `400 11px/1 ${HEADING}`,
            color: '#F4F1EA',
            outline: 'none',
          }}
        />
      )}
    </div>
  );
}
