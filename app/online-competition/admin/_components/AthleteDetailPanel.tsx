'use client';

import { useEffect, useRef } from 'react';
import { countryName } from '@/lib/online-competition/countries';
import type {
  OnlineParticipantAdminView,
  OnlineParticipantGender,
  OnlineParticipantProfileStatus,
} from '@/lib/online-competition/types';

// ── Тамирчны дэлгэрэнгүй ─────────────────────────────────────────────────
// A READ-ONLY side panel over the athletes list: the full record an admin
// verifies against. It fetches nothing — the admin athletes route already
// sent this row — and has no inputs; МЭЙЛ СОЛИХ stays in the table.
//
// A side panel rather than an expanding row or a detail page, because the
// list will hold hundreds of athletes: the table keeps its scroll position
// and its columns underneath, a tall photo never pushes rows around, and
// ӨМНӨХ / ДАРААХ step through the list without going back to it.
//
// Styling follows the admin panel: inline v3 values, no Tailwind.

const GENDER_LABEL: Record<OnlineParticipantGender, string> = {
  male: 'Эрэгтэй',
  female: 'Эмэгтэй',
  other: 'Бусад',
};

const STATUS: Record<OnlineParticipantProfileStatus, { text: string; color: string }> = {
  incomplete: { text: 'Бөглөөгүй', color: '#6E6A62' },
  pending: { text: 'Хүлээгдэж буй', color: '#DFFF4F' },
  approved: { text: 'Баталгаажсан', color: '#4FD07A' },
  rejected: { text: 'Татгалзсан', color: '#E8543C' },
};

function fmtDateTime(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whole years on today's date, from a stored "YYYY-MM-DD"; null if unreadable. */
function ageFrom(dateOfBirth: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!m) return null;
  const now = new Date();
  let age = now.getFullYear() - Number(m[1]);
  if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[3]))) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

const genderText = (g: string | null) => (g && g in GENDER_LABEL ? GENDER_LABEL[g as OnlineParticipantGender] : g || '—');
const countryText = (code: string | null) => (code ? `${countryName(code)} (${code})` : '—');

export default function AthleteDetailPanel({
  athlete,
  position,
  onPrev,
  onNext,
  onClose,
}: {
  athlete: OnlineParticipantAdminView;
  position: { index: number; total: number };
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus lands inside the panel once, on open — not on every step, so the
  // ДАРААХ button keeps focus while an admin works down the list.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = `${athlete.lastName} ${athlete.firstName}`.trim() || athlete.displayName || '—';
  const status = STATUS[athlete.profileStatus];
  const age = ageFrom(athlete.dateOfBirth);

  // The photo an admin approved and the one most recently submitted can
  // differ; verification needs to see both, each labelled. Keyed on the
  // PHOTO part: it can be approved while the details are re-reviewed.
  const photos: { url: string; label: string }[] = [];
  if (athlete.photoStatus === 'approved') {
    const main = athlete.approvedPhotoUrl ?? athlete.photoUrl;
    if (main) photos.push({ url: main, label: 'Баталсан зураг' });
    if (athlete.photoUrl && athlete.photoUrl !== main) photos.push({ url: athlete.photoUrl, label: 'Сүүлд илгээсэн зураг' });
  } else {
    if (athlete.photoUrl) photos.push({ url: athlete.photoUrl, label: 'Илгээсэн зураг' });
    if (athlete.approvedPhotoUrl && athlete.approvedPhotoUrl !== athlete.photoUrl) {
      photos.push({ url: athlete.approvedPhotoUrl, label: 'Өмнө баталсан зураг' });
    }
  }

  const navBtn = (label: string, onClick: (() => void) | null) => (
    <button
      type="button"
      className="oc-v3-row-action"
      style={{ width: 'auto', opacity: onClick ? 1 : 0.35, cursor: onClick ? 'pointer' : 'default' }}
      disabled={!onClick}
      onClick={onClick ?? undefined}
    >
      {label}
    </button>
  );

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(6, 6, 8, 0.72)' }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Тамирчны мэдээлэл: ${name}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(560px, 100vw)',
          background: '#0D0D10',
          borderLeft: '1px solid #2A2A31',
          boxShadow: '0 30px 80px -20px rgba(0, 0, 0, 0.95)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header — stays put while the body scrolls. */}
        <div style={{ padding: '15px 18px', borderBottom: '1px solid #1C1C21', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="oc-v3-label">Тамирчны мэдээлэл</span>
            <p style={{ marginTop: 8, font: '500 16px var(--oc-font-heading), sans-serif', color: '#F4F1EA', overflowWrap: 'anywhere' }}>
              {name}
            </p>
            <p style={{ marginTop: 6, font: '600 9px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: status.color }}>
              {status.text.toUpperCase()}
            </p>
          </div>
          <button ref={closeRef} type="button" className="oc-v3-row-action" style={{ width: 'auto' }} onClick={onClose}>
            ХААХ
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* ── Verification photo ──
              Full panel width (up to 522px) at its own aspect ratio, never
              cropped: object-fit contain, so a face and a document held beside
              it both stay in frame. Capped at 70% of the viewport height so a
              portrait photo still fits on screen; the original file opens in
              a new tab for anything finer. */}
          <section>
            {photos.length === 0 ? (
              <>
                <span className="oc-v3-label">Баталгаажуулах зураг</span>
                <p style={{ marginTop: 8, font: '400 12px var(--oc-font-heading), sans-serif', color: '#6E6A62' }}>
                  Зураг илгээгээгүй.
                </p>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {photos.map((p) => (
                  <figure key={p.url} style={{ margin: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                      <span className="oc-v3-label">{p.label}</span>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: '#9A958A' }}
                      >
                        ЖИНХЭНЭ ХЭМЖЭЭГЭЭР ↗
                      </a>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary URL, not our own image pipeline. */}
                    <img
                      src={p.url}
                      alt={`${name} — ${p.label}`}
                      style={{
                        marginTop: 8,
                        display: 'block',
                        width: '100%',
                        height: 'auto',
                        maxHeight: '70vh',
                        objectFit: 'contain',
                        background: '#08080A',
                        border: '1px solid #1C1C21',
                      }}
                    />
                  </figure>
                ))}
              </div>
            )}
          </section>

          <section>
            <span className="oc-v3-label">Хувийн мэдээлэл</span>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 1, background: '#1C1C21', border: '1px solid #1C1C21' }}>
              <Row label="ОВОГ" value={athlete.lastName || '—'} approved={athlete.approvedLastName} live={athlete.lastName} />
              <Row label="НЭР" value={athlete.firstName || '—'} approved={athlete.approvedFirstName} live={athlete.firstName} />
              <Row
                label="ТӨРСӨН ОГНОО"
                value={athlete.dateOfBirth ? `${athlete.dateOfBirth}${age !== null ? ` (${age} нас)` : ''}` : '—'}
                mono
                approved={athlete.approvedDateOfBirth}
                live={athlete.dateOfBirth}
              />
              <Row
                label="ХҮЙС"
                value={genderText(athlete.gender)}
                approved={athlete.approvedGender}
                live={athlete.gender ?? ''}
                approvedText={genderText(athlete.approvedGender)}
              />
              <Row
                label="УЛС"
                value={countryText(athlete.citizenship)}
                approved={athlete.approvedCitizenship}
                live={athlete.citizenship}
                approvedText={countryText(athlete.approvedCitizenship)}
              />
              <Row label="WCA ID" value={athlete.wcaId || '—'} mono />
              <Row label="И-МЭЙЛ" value={athlete.email || '—'} />
            </div>
          </section>

          <section>
            <span className="oc-v3-label">Баталгаажуулалт</span>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 1, background: '#1C1C21', border: '1px solid #1C1C21' }}>
              <Row label="ТӨЛӨВ" value={status.text} color={status.color} />
              <Row label="МЭДЭЭЛЭЛ" value={STATUS[athlete.detailsStatus].text} color={STATUS[athlete.detailsStatus].color} />
              {athlete.detailsRejectionReason && <Row label="МЭДЭЭЛЛИЙН ШАЛТГААН" value={athlete.detailsRejectionReason} />}
              <Row label="ЗУРАГ" value={STATUS[athlete.photoStatus].text} color={STATUS[athlete.photoStatus].color} />
              {athlete.photoRejectionReason && <Row label="ЗУРГИЙН ШАЛТГААН" value={athlete.photoRejectionReason} />}
              <Row label="БҮРТГҮҮЛСЭН" value={fmtDateTime(athlete.createdAt)} mono />
              <Row label="ХҮСЭЛТ ИЛГЭЭСЭН" value={fmtDateTime(athlete.submittedAt)} mono />
              <Row label="ШИЙДВЭРЛЭСЭН" value={fmtDateTime(athlete.reviewedAt)} mono />
            </div>
          </section>
        </div>

        <div
          style={{
            padding: '13px 18px',
            borderTop: '1px solid #1C1C21',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          {navBtn('← ӨМНӨХ', onPrev)}
          <span style={{ font: '400 11px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
            {position.index + 1} / {position.total}
          </span>
          {navBtn('ДАРААХ →', onNext)}
        </div>
      </aside>
    </div>
  );
}

/** One label/value line. When an approved snapshot exists and the live value
 *  has moved on from it, the approved value is shown underneath — that is
 *  the difference a re-verification has to look at. */
function Row({
  label,
  value,
  mono,
  color,
  approved,
  live,
  approvedText,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
  approved?: string | null;
  live?: string;
  approvedText?: string;
}) {
  const differs = approved !== undefined && approved !== null && live !== undefined && approved !== live;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, background: '#0D0D10', padding: '10px 12px' }}>
      <span style={{ flex: '0 0 120px', font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.12em', color: '#6E6A62' }}>
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        <span
          style={{
            display: 'block',
            font: mono ? '400 12px var(--oc-font-mono), monospace' : '400 13px var(--oc-font-heading), sans-serif',
            color: color ?? '#F4F1EA',
          }}
        >
          {value}
        </span>
        {differs && (
          <span style={{ display: 'block', marginTop: 4, font: '400 11px var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
            Баталсан: {approvedText ?? approved}
          </span>
        )}
      </span>
    </div>
  );
}
