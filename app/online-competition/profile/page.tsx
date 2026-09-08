'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import {
  fetchAllCompetitions,
  fetchAthleteSeasonPoints,
  fetchParticipant,
  resolveProfileStatus,
  submitParticipantProfile,
} from '@/lib/online-competition/data';
import { uploadImageToCloudinary } from '@/lib/online-competition/cloudinary';
import type {
  OnlineParticipant,
  OnlineParticipantGender,
  OnlineParticipantProfileStatus,
} from '@/lib/online-competition/types';
import HubNav from '../_components/hub/v3/HubNav';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { toMillisOrNull } from '../_components/hub/format';
import AuthModal from '../_components/hub/v3/AuthModal';

const DASHBOARD = '/online-competition/dashboard';

const GENDERS: { value: OnlineParticipantGender; label: string }[] = [
  { value: 'male', label: 'Эрэгтэй' },
  { value: 'female', label: 'Эмэгтэй' },
  { value: 'other', label: 'Бусад' },
];

const GENDER_LABEL: Record<OnlineParticipantGender, string> = {
  male: 'Эрэгтэй',
  female: 'Эмэгтэй',
  other: 'Бусад',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="oc-v3-page">
      <HubNav live={null} />
      <main className="oc-v3-main" style={{ maxWidth: 1080, margin: '0 auto', width: '100%' }}>
        {children}
      </main>
    </div>
  );
}

function CardHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 18px', borderBottom: '1px solid #1C1C21' }}>
      <span className="oc-v3-label">{children}</span>
    </div>
  );
}

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Т';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

/** Best value across every event the athlete has stats for. With one
 *  event configured today this is the same as "their 3x3 PR"; across
 *  several it reads as a personal best overall, which is what a single
 *  headline number on a profile card should mean. */
function bestAcrossEvents(
  participant: OnlineParticipant | null,
  key: 'pr' | 'ao5',
): number | null {
  const values = Object.values(participant?.stats ?? {})
    .map((e) => e[key])
    .filter((v): v is number => typeof v === 'number');
  return values.length > 0 ? Math.min(...values) : null;
}

function totalSolves(participant: OnlineParticipant | null): number | null {
  const entries = Object.values(participant?.stats ?? {});
  if (entries.length === 0) return null;
  return entries.reduce((sum, e) => sum + (e.solveCount ?? 0), 0);
}

function fmtOrDash(cs: number | null): string {
  return cs === null ? '—' : fmtCentiseconds(cs);
}

function StatCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="oc-v3-stat-cell">
      <span className="oc-v3-stat-label">{label}</span>
      <span className="oc-v3-stat-value" style={accent ? { color: '#DFFF4F' } : undefined}>
        {value}
      </span>
    </div>
  );
}

function StatusChip({ status }: { status: OnlineParticipantProfileStatus }) {
  if (status === 'pending') {
    return (
      <span className="oc-v3-chip oc-v3-chip-pending">
        <span className="oc-v3-dot" aria-hidden />
        ХҮЛЭЭГДЭЖ БУЙ
      </span>
    );
  }
  if (status === 'approved') return <span className="oc-v3-chip oc-v3-chip-approved">БАТАЛГААЖСАН</span>;
  if (status === 'rejected') return <span className="oc-v3-chip oc-v3-chip-rejected">ТАТГАЛЗСАН</span>;
  return null;
}

export default function ProfilePage() {
  const { user, loading: authLoading } = useOnlineAuth();

  const [authOpen, setAuthOpen] = useState(false);

  const [participant, setParticipant] = useState<OnlineParticipant | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savedToast, setSavedToast] = useState(false);
  // Season-points total for the stat grid below. `participant` (which
  // feeds the other three cells) is already loaded by the effect further
  // down for the verification form, so it is reused rather than fetched
  // a second time.
  const [points, setPoints] = useState<number | null>(null);

  // Season-points total for the stat grid. Season is derived the same way
  // the hub and the dashboard did it: whichever competition with a season
  // set has the latest startAt.
  useEffect(() => {
    const uid = user && !user.isAnonymous ? user.uid : null;
    if (uid === null) return;
    let cancelled = false;
    fetchAllCompetitions()
      .then(async (list) => {
        const withSeason = list.filter((c) => c.season);
        if (withSeason.length === 0) return null;
        const latest = withSeason.reduce((best, c) =>
          (toMillisOrNull(c.startAt) ?? 0) > (toMillisOrNull(best.startAt) ?? 0) ? c : best,
        );
        return fetchAthleteSeasonPoints(latest.season as string, uid);
      })
      .then((row) => {
        if (!cancelled) setPoints(row?.totalPoints ?? null);
      })
      .catch(() => {
        if (!cancelled) setPoints(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || user.isAnonymous) {
      setLoadingProfile(false);
      return;
    }
    let cancelled = false;
    setLoadingProfile(true);
    setLoadError('');
    fetchParticipant(user.uid)
      .then((p) => {
        if (!cancelled) setParticipant(p);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Профайлын мэдээллийг ачааллаж чадсангүй');
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Purely presentational: flashes the "ХАДГАЛАГДЛАА" chip after a save.
  // The save itself is unchanged — onSubmitted still swaps in the new
  // participant, which is what moves the page into its pending state.
  useEffect(() => {
    if (!savedToast) return;
    const id = setTimeout(() => setSavedToast(false), 3500);
    return () => clearTimeout(id);
  }, [savedToast]);

  if (authLoading) return <Shell>{null}</Shell>;

  if (!user || user.isAnonymous) {
    return (
      <Shell>
        <div className="oc-v3-card">
          <div className="oc-v3-empty">
            <p className="oc-v3-empty-text">Профайлаа бөглөхийн тулд нэвтэрнэ үү.</p>
            <button type="button" className="oc-v3-signin" onClick={() => setAuthOpen(true)}>
              Нэвтрэх
            </button>
          </div>
        </div>
        {/* Plain sign-in: the user is already on the page they want, so
            the modal just closes and this gate re-renders signed-in — no
            queued destination, same shape as the nav's Нэвтрэх button. */}
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </Shell>
    );
  }

  if (loadingProfile) return <Shell><p className="oc-v3-status">Ачааллаж байна...</p></Shell>;

  // This account's data was moved to another Gmail. The document that
  // remains is an empty forwarding stub — showing the verification form
  // here would invite the athlete to rebuild a profile they already have
  // under their new address.
  if (participant?.mergedInto) {
    return (
      <Shell>
        <div>
          <p className="oc-v3-eyebrow">Профайл</p>
          <h1 className="oc-v3-title" style={{ marginTop: 8 }}>Профайл</h1>
        </div>
        <div className="oc-v3-card" style={{ marginTop: 20 }}>
          <div className="oc-v3-empty">
            <p className="oc-v3-empty-text">
              Энэ бүртгэлийн мэдээллийг өөр мэйл хаяг руу шилжүүлсэн байна. Шинэ хаягаараа нэвтэрнэ үү.
            </p>
          </div>
        </div>
      </Shell>
    );
  }
  if (loadError) return <Shell><p className="oc-v3-status oc-v3-status-error">{loadError}</p></Shell>;

  const status = resolveProfileStatus(participant);
  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p className="oc-v3-eyebrow">Профайл</p>
          <h1 className="oc-v3-title" style={{ marginTop: 8 }}>Профайл</h1>
        </div>
        {savedToast && <span className="oc-v3-toast">ХАДГАЛАГДЛАА</span>}
      </div>

      <ProfileBody
        uid={user.uid}
        email={user.email}
        displayName={user.displayName}
        points={points}
        participant={participant}
        status={status}
        onSubmitted={(next) => {
          setParticipant(next);
          setSavedToast(true);
        }}
      />
    </Shell>
  );
}

function ProfileBody({
  uid,
  email,
  displayName,
  points,
  participant,
  status,
  onSubmitted,
}: {
  uid: string;
  email: string | null;
  displayName: string | null;
  points: number | null;
  participant: OnlineParticipant | null;
  status: OnlineParticipantProfileStatus;
  onSubmitted: (next: OnlineParticipant) => void;
}) {
  const [lastName, setLastName] = useState(participant?.lastName ?? '');
  const [firstName, setFirstName] = useState(participant?.firstName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(participant?.dateOfBirth ?? '');
  const [gender, setGender] = useState<OnlineParticipantGender | ''>(participant?.gender ?? '');
  const [citizenship, setCitizenship] = useState(participant?.citizenship ?? '');

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(participant?.photoUrl ?? null);
  const objectUrlRef = useRef<string | null>(null);
  // Rejected athletes see the chip + reason first; the upload box opens on
  // "ДАХИН ОРУУЛАХ". An incomplete profile has nothing to review, so it
  // starts open.
  const [uploadOpen, setUploadOpen] = useState(status === 'incomplete');
  // An approved athlete edits only after asking to — the МЭДЭЭЛЭЛ ЗАСАХ
  // button below. Saving re-submits for review (submitParticipantProfile
  // always writes profileStatus: 'pending'), which is the point: a changed
  // identity is no longer the one an admin approved.
  const [editing, setEditing] = useState(false);

  // 'incomplete' and 'rejected' have nothing approved to protect, so they
  // are always open. 'approved' opens only via the explicit button.
  // 'pending' stays read-only: a review is already in flight.
  const editable = status === 'incomplete' || status === 'rejected' || editing;

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function handlePhotoChange(file: File | null) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPhotoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setPhotoPreview(url);
    } else {
      setPhotoPreview(participant?.photoUrl ?? null);
    }
  }

  function validate(): string | null {
    if (!lastName.trim()) return 'Овгоо оруулна уу';
    if (!firstName.trim()) return 'Нэрээ оруулна уу';
    if (!dateOfBirth) return 'Төрсөн өдрөө сонгоно уу';
    if (!gender) return 'Хүйсээ сонгоно уу';
    if (!citizenship.trim()) return 'Иргэншлээ оруулна уу';
    if (!photoFile && !participant?.photoUrl) return 'Зураг оруулна уу';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setSaving(true);
    setProgress(photoFile ? 0 : null);
    try {
      let photoUrl = participant?.photoUrl ?? '';
      let photoPublicId = participant?.photoPublicId ?? '';
      if (photoFile) {
        const uploaded = await uploadImageToCloudinary(photoFile, setProgress);
        photoUrl = uploaded.secureUrl;
        photoPublicId = uploaded.publicId;
      }

      await submitParticipantProfile(uid, {
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        dateOfBirth,
        gender: gender as OnlineParticipantGender,
        citizenship: citizenship.trim(),
        photoUrl,
        photoPublicId,
      });

      onSubmitted({
        uid,
        displayName: participant?.displayName ?? `${lastName.trim()} ${firstName.trim()}`,
        photoURL: participant?.photoURL ?? null,
        email: participant?.email ?? null,
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        dateOfBirth,
        gender: gender as OnlineParticipantGender,
        citizenship: citizenship.trim(),
        photoUrl,
        photoPublicId,
        profileStatus: 'pending',
        approvedPhotoUrl: participant?.approvedPhotoUrl ?? null,
      });
      // Status is now 'pending'; the form goes back to read-only and the
      // warning below disappears with it.
      setEditing(false);
      setUploadOpen(false);
    } catch {
      setError('Хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setSaving(false);
    }
  }

  // Which image represents the athlete, in priority order:
  //   1. a file they just picked, so the preview shows what they chose;
  //   2. once approved, the APPROVED photo — types.ts calls this the
  //      official one, and it is what the admin roster shows;
  //   3. otherwise the latest submitted photo.
  // Gated on photoFile rather than photoPreview because photoPreview is
  // seeded from participant.photoUrl at mount, so it is non-null even when
  // nothing has been picked and would otherwise always win.
  const officialPhoto =
    status === 'approved'
      ? participant?.approvedPhotoUrl ?? participant?.photoUrl ?? null
      : participant?.photoUrl ?? null;
  const shownPhoto = (photoFile ? photoPreview : null) ?? officialPhoto;
  const canSubmit = !!photoFile || !!participant?.photoUrl;

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Top band: identity+photo | stats ───────────────────────
          One card where there used to be three stacked ones. The athlete's
          avatar and the verification photo are the same image, so they
          share a cell, and the stat grid sits alongside rather than under.
          .oc-v3-profile-band stacks the two cells below 1040px. */}
      <div className="oc-v3-card">
        <div className="oc-v3-profile-band">
          {/* Identity + verification photo — one cell, one image.
              These used to be two cells showing two different photos of
              the same person (the Google avatar and the reviewed
              verification photo), which read as a bug. The verification
              photo IS the athlete's avatar here; initials stand in until
              one has been submitted. */}
          <div
            style={{
              padding: '24px 18px',
              display: 'flex',
              gap: 18,
              alignItems: 'center',
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            <div
              style={{
                flex: 'none',
                width: 150,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              {shownPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element -- Cloudinary
                // URL, not our own image pipeline.
                <img src={shownPhoto} alt="" className="oc-v3-avatar-96" />
              ) : (
                <span className="oc-v3-avatar-96" aria-hidden>
                  {initials(displayName)}
                </span>
              )}
              <p
                style={{
                  font: '600 20px var(--oc-font-heading), sans-serif',
                  color: '#F4F1EA',
                  textAlign: 'center',
                  overflowWrap: 'anywhere',
                }}
              >
                {displayName ?? 'Тамирчин'}
              </p>
            </div>

            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 11 }}>
              <span className="oc-v3-label">Профайл зураг</span>
              {/* Guidance for choosing a photo — only useful while one can
                  actually be chosen, so it rides the same `editable` gate
                  as the upload affordances. Read-only, the cell is just
                  the photo, the name, the chip and the edit button. */}
              {editable && (
                <p style={{ font: '400 12px/1.65 Geologica, sans-serif', color: '#9A958A', textWrap: 'pretty' }}>
                  Царай тод харагдах зураг. Шүүгч бичлэг шалгахад ашиглана.
                </p>
              )}
              <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
                {editable && !uploadOpen && (
                  <button type="button" className="oc-v3-ghost-btn" onClick={() => setUploadOpen(true)}>
                    {status === 'rejected' ? 'ДАХИН ОРУУЛАХ' : 'ЗУРАГ СОЛИХ'}
                  </button>
                )}
                {status === 'approved' && !editing && (
                  <button type="button" className="oc-v3-ghost-btn" onClick={() => setEditing(true)}>
                    МЭДЭЭЛЭЛ ЗАСАХ
                  </button>
                )}
                <StatusChip status={status} />
              </div>

              {status === 'rejected' && participant?.rejectionReason && (
                <div className="oc-v3-reject-block">
                  <p style={{ font: '600 9px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: '#E8543C' }}>
                    ТАТГАЛЗСАН ШАЛТГААН
                  </p>
                  <p style={{ marginTop: 8, font: '400 12px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
                    {participant.rejectionReason}
                  </p>
                </div>
              )}

              {status === 'pending' && (
                <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
                  Таны мэдээллийг админ хянаж байна. Баталгаажсаны дараа тэмцээнд бүртгүүлэх боломжтой.
                </p>
              )}
            </div>
          </div>

          {/* Stats — real values from the stats rollup + season points;
              "—" only when the data genuinely isn't there yet (no recompute
              has run, or the athlete has no approved solves). */}
          <div className="oc-v3-stat-grid">
            <StatCell label="ПР" accent value={fmtOrDash(bestAcrossEvents(participant, 'pr'))} />
            <StatCell label="Дундаж" value={fmtOrDash(bestAcrossEvents(participant, 'ao5'))} />
            <StatCell label="Оноо" value={points === null ? '—' : String(points)} />
            <StatCell label="Эвлүүлэлт" value={totalSolves(participant) === null ? '—' : String(totalSolves(participant))} />
          </div>
        </div>

        {/* Shown from the moment an approved athlete opens the form until
            the save that actually re-submits them. It is a consequence
            they should see BEFORE typing, not after. */}
        {editing && status === 'approved' && (
          <div className="oc-sc-warn" style={{ margin: '0 18px 18px' }}>
            Мэдээллээ засвал профайл дахин хянагдана. Хянагдах хүртэл тэмцээнд бүртгүүлэх боломжгүй.
          </div>
        )}

        {editable && uploadOpen && (
          <div style={{ padding: '0 18px 20px', borderTop: '1px solid #1C1C21', paddingTop: 20 }}>
            <div className="oc-v3-upload">
              <span
                className="oc-v3-upload-preview"
                aria-hidden
                style={photoPreview ? { backgroundImage: `url(${photoPreview})` } : undefined}
              >
                {photoPreview ? '' : 'ЗУРАГГүЙ'}
              </span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="oc-v3-ghost-btn">
                  ФАЙЛ СОНГОХ
                  <input
                    type="file"
                    accept="image/*"
                    className="oc-v3-file-input"
                    onChange={(e) => handlePhotoChange(e.target.files?.[0] ?? null)}
                  />
                </label>
                <p style={{ marginTop: 12, font: '400 12px var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
                  JPG эсвэл PNG. Царай төвд, гэрэлтэй, малгай нүдний шилгүй.
                </p>
                {progress !== null && (
                  <p style={{ marginTop: 8, font: '400 11px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
                    Зураг илгээж байна... {progress}%
                  </p>
                )}
              </div>
            </div>
            <button type="submit" className="oc-v3-submit-btn" style={{ marginTop: 12 }} disabled={saving || !canSubmit}>
              {saving ? 'Илгээж байна...' : 'Баталгаажуулалтад илгээх'}
            </button>
          </div>
        )}
      </div>

      {/* ── Personal details ──────────────────────────────────────────── */}
      <div className="oc-v3-card">
        <CardHead>Хувийн мэдээлэл</CardHead>
        <div className="oc-v3-form-grid">
          <Field label="Овог">
            {editable ? (
              <input className="oc-v3-input" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} />
            ) : (
              <p className="oc-v3-value">{participant?.lastName || '—'}</p>
            )}
          </Field>

          <Field label="Нэр">
            {editable ? (
              <input className="oc-v3-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60} />
            ) : (
              <p className="oc-v3-value">{participant?.firstName || '—'}</p>
            )}
          </Field>

          <Field label="Төрсөн огноо">
            {editable ? (
              <input
                type="date"
                className="oc-v3-input"
                style={{ font: '500 13px var(--oc-font-mono), monospace', colorScheme: 'dark' }}
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            ) : (
              <p className="oc-v3-value">{participant?.dateOfBirth || '—'}</p>
            )}
          </Field>

          {/* Plain text input, not a searchable country/flag picker — that
              needs a country dataset + combobox this feature doesn't have,
              and the field is a free-text string in the schema. */}
          <Field label="Иргэншил">
            {editable ? (
              <input
                className="oc-v3-input"
                value={citizenship}
                onChange={(e) => setCitizenship(e.target.value)}
                placeholder="Монгол"
                maxLength={60}
              />
            ) : (
              <p className="oc-v3-value">{participant?.citizenship || '—'}</p>
            )}
          </Field>

          <div style={{ gridColumn: '1 / -1' }}>
            <span className="oc-v3-field-label">Хүйс</span>
            <div style={{ marginTop: 8 }}>
              {editable ? (
                <div className="oc-v3-seg">
                  {GENDERS.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      className={`oc-v3-seg-btn${gender === g.value ? ' oc-v3-seg-btn-active' : ''}`}
                      onClick={() => setGender(g.value)}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="oc-v3-value">{participant?.gender ? GENDER_LABEL[participant.gender] : '—'}</p>
              )}
            </div>
          </div>

          {/* Folded in from its own card: one read-only line does not need
              a section of its own. Read-only because identity comes from
              Google Sign-In — the address is already verified and there is
              no change-email flow to offer. */}
          <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
            <span className="oc-v3-field-label">И-мэйл хаяг</span>
            <div style={{ marginTop: 8 }}>
              <div className="oc-v3-email-row">
                <span style={{ font: '500 13px var(--oc-font-heading), sans-serif', color: '#F4F1EA', overflowWrap: 'anywhere' }}>
                  {email ?? '—'}
                </span>
                <span className="oc-v3-chip-sm">БАТАЛГААЖСАН</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#E8543C' }}>{error}</p>}

      <div className="oc-v3-footer-row">
        <Link href={DASHBOARD} className="oc-v3-ghost-btn">
          БУЦАХ
        </Link>
        {editable && (
          <button
            type="submit"
            className="oc-v3-submit-btn"
            style={{ width: 'auto', paddingLeft: 26, paddingRight: 26 }}
            disabled={saving}
          >
            {saving ? 'Хадгалж байна...' : 'Хадгалах'}
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span className="oc-v3-field-label">{label}</span>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}
