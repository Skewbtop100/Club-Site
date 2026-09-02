'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { fetchParticipant, resolveProfileStatus, submitParticipantProfile } from '@/lib/online-competition/data';
import { uploadImageToCloudinary } from '@/lib/online-competition/cloudinary';
import type { OnlineParticipant, OnlineParticipantGender } from '@/lib/online-competition/types';
import NavBar from '../_components/hub/NavBar';

const GENDER_LABEL: Record<OnlineParticipantGender, string> = {
  male: 'Эрэгтэй',
  female: 'Эмэгтэй',
  other: 'Бусад',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso;
}

// Centers the content column regardless of viewport, matching the
// dashboard page's Shell (app/online-competition/dashboard/page.tsx) —
// duplicated locally rather than imported since that one isn't exported.
// Carries the shared hub NavBar so every state this page renders (signed-
// out prompt, loading, form, pending, approved) has a way back to the hub
// — its "Миний тэмцээнүүд" link/user badge is the "done, go back" path
// after a submit or from the read-only approved view.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full" style={{ background: '#FFFDF8' }}>
      <NavBar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px' }}>{children}</div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading: authLoading, signInWithGoogle } = useOnlineAuth();

  const [participant, setParticipant] = useState<OnlineParticipant | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadError, setLoadError] = useState('');

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

  if (authLoading) {
    return <Shell>{null}</Shell>;
  }

  if (!user || user.isAnonymous) {
    return (
      <Shell>
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <p style={{ marginBottom: 16, font: '400 13px var(--oc-font-heading), sans-serif', color: '#4C473C' }}>
            Профайлаа бөглөхийн тулд нэвтэрнэ үү.
          </p>
          <button type="button" className="oc-hub-signin-btn" onClick={() => signInWithGoogle()}>
            Нэвтрэх
          </button>
        </div>
      </Shell>
    );
  }

  if (loadingProfile) {
    return (
      <Shell>
        <p style={{ font: '400 13px var(--oc-font-heading), sans-serif', color: '#8A8474' }}>Ачааллаж байна...</p>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <p style={{ font: '400 13px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>{loadError}</p>
      </Shell>
    );
  }

  const status = resolveProfileStatus(participant);

  return (
    <Shell>
      <p className="oc-mono-label" style={{ marginBottom: 16 }}>
        Тамирчны профайл
      </p>

      {status === 'pending' && <PendingView />}

      {/* Read-only once approved — profileStatus can never move back to
          'pending' from 'approved' (see the Firestore rules snippet: only
          incomplete->pending and rejected->pending are allowed for a
          direct client write), so there's no resubmit path to offer here. */}
      {status === 'approved' && <ApprovedView participant={participant} />}

      {(status === 'incomplete' || status === 'rejected') && (
        <ProfileForm
          uid={user.uid}
          participant={participant}
          rejectionReason={status === 'rejected' ? (participant?.rejectionReason ?? null) : null}
          onSubmitted={(next) => setParticipant(next)}
        />
      )}
    </Shell>
  );
}

// Pending review — resubmission is deliberately not offered here. The
// athlete already sees this the moment their submission is in an admin's
// queue; letting them silently overwrite it mid-review (photo, DOB, etc.)
// would let a submission change out from under whichever admin is looking
// at it. If they made a mistake, contacting the club is the expected path
// until there's a "withdraw submission" action — same tradeoff the
// onlineSubmissions review flow makes (an owner can't touch status/penalty
// once submitted either, see firestore.rules).
function PendingView() {
  return (
    <div className="oc-profile-status-pending">
      <p style={{ font: '600 15px var(--oc-font-heading), sans-serif', color: '#8A5400' }}>Хүлээгдэж байна</p>
      <p style={{ marginTop: 8, font: '400 12px var(--oc-font-heading), sans-serif', color: '#4C473C' }}>
        Таны профайлын мэдээллийг админ хянаж байна. Баталгаажсаны дараа тэмцээнд бүртгүүлэх боломжтой болно.
      </p>
    </div>
  );
}

function ApprovedView({ participant }: { participant: OnlineParticipant | null }) {
  return (
    <div className="oc-profile-status-approved">
      <div className="oc-profile-photo-row">
        {participant?.approvedPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Cloudinary URL, not our own image pipeline.
          <img src={participant.approvedPhotoUrl} alt="" className="oc-profile-photo-preview" />
        ) : (
          <span className="oc-profile-photo-placeholder">ЗУРАГГҮЙ</span>
        )}
        <div>
          <p style={{ font: '600 17px var(--oc-font-heading), sans-serif', color: '#1D6E3E' }}>
            {participant?.lastName} {participant?.firstName}
          </p>
          <p style={{ marginTop: 4, font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.1em', color: '#1D6E3E' }}>
            БАТАЛГААЖСАН
          </p>
        </div>
      </div>

      <dl style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, font: '400 13px var(--oc-font-heading), sans-serif' }}>
        <dt style={{ color: '#4C473C' }}>Төрсөн өдөр</dt>
        <dd style={{ color: '#16140F' }}>{fmtDate(participant?.dateOfBirth)}</dd>
        <dt style={{ color: '#4C473C' }}>Хүйс</dt>
        <dd style={{ color: '#16140F' }}>{participant?.gender ? GENDER_LABEL[participant.gender] : '—'}</dd>
        <dt style={{ color: '#4C473C' }}>Иргэншил</dt>
        <dd style={{ color: '#16140F' }}>{participant?.citizenship || '—'}</dd>
      </dl>
    </div>
  );
}

function ProfileForm({
  uid,
  participant,
  rejectionReason,
  onSubmitted,
}: {
  uid: string;
  participant: OnlineParticipant | null;
  rejectionReason: string | null;
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
    } catch {
      setError('Хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="oc-profile-card">
      {rejectionReason && (
        <div className="oc-profile-status-rejected" style={{ marginBottom: 18 }}>
          <p style={{ font: '600 13px var(--oc-font-heading), sans-serif' }}>Татгалзсан</p>
          <p style={{ marginTop: 6, font: '400 12px var(--oc-font-heading), sans-serif' }}>{rejectionReason}</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <span className="oc-field-label">ОВОГ</span>
          <input
            className="oc-input"
            style={{ marginTop: 8 }}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={60}
          />
        </div>

        <div>
          <span className="oc-field-label">НЭР</span>
          <input
            className="oc-input"
            style={{ marginTop: 8 }}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={60}
          />
        </div>

        <div>
          <span className="oc-field-label">ТӨРСӨН ӨДӨР</span>
          <input
            type="date"
            className="oc-input oc-input-mono"
            style={{ marginTop: 8 }}
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        </div>

        <div>
          <span className="oc-field-label">ХҮЙС</span>
          <select
            className="oc-input oc-input-select"
            style={{ marginTop: 8 }}
            value={gender}
            onChange={(e) => setGender(e.target.value as OnlineParticipantGender)}
          >
            <option value="" disabled>
              Сонгоно уу
            </option>
            <option value="male">Эрэгтэй</option>
            <option value="female">Эмэгтэй</option>
            <option value="other">Бусад</option>
          </select>
        </div>

        <div>
          <span className="oc-field-label">ИРГЭНШИЛ</span>
          <input
            className="oc-input"
            style={{ marginTop: 8 }}
            value={citizenship}
            onChange={(e) => setCitizenship(e.target.value)}
            placeholder="Монгол"
            maxLength={60}
          />
        </div>

        <div>
          <span className="oc-field-label">ЗУРАГ</span>
          <div className="oc-profile-photo-row" style={{ marginTop: 8 }}>
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview / Cloudinary URL, not our own image pipeline.
              <img src={photoPreview} alt="" className="oc-profile-photo-preview" />
            ) : (
              <span className="oc-profile-photo-placeholder">ЗУРАГГҮЙ</span>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handlePhotoChange(e.target.files?.[0] ?? null)}
              style={{ font: '400 12px var(--oc-font-heading), sans-serif' }}
            />
          </div>
          {progress !== null && (
            <p style={{ marginTop: 6, font: '400 11px var(--oc-font-mono), monospace', color: '#8A8474' }}>
              Зураг илгээж байна... {progress}%
            </p>
          )}
        </div>
      </div>

      {error && (
        <p style={{ marginTop: 16, font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button type="submit" className="oc-btn-register-confirm" disabled={saving}>
          {saving ? 'Илгээж байна...' : 'Илгээх'}
        </button>
      </div>
    </form>
  );
}
