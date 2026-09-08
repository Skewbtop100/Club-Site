'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../_components/ui';
import type { OnlineParticipantAdminView } from '@/lib/online-competition/types';

// ── Мэйл солих ───────────────────────────────────────────────────────────
// Wraps POST /api/online-competition/admin-athletes/merge, which is the same
// logic scripts/merge-athlete-uid.mjs runs (lib/online-competition/
// merge-athlete.mjs). This component contributes no merge logic of its own —
// only the two-step gate and the Mongolian copy.
//
// The preview step is the safety mechanism and is not skippable: 'commit' is
// only ever sent from the confirm button, which only exists once a preview
// has come back ok.
//
// Styling follows the admin panel: `.oc-*` classes from theme.css and
// literal inline styles, never a Tailwind spacing utility (globals.css's
// unlayered reset zeroes those).

interface MergeError {
  code: string;
  email?: string;
  uids?: string[];
  label?: string;
  count?: number;
  status?: string | null;
}

interface MergeSummary {
  oldUid: string;
  newUid: string;
  registrations: { competitionId: string; events: string[] }[];
  submissions: number;
  seasonPoints: { season: string; totalPoints: number }[];
  notifications: number;
  qualifiers: { path: string; index: number; length: number }[];
  assignments: { path: string; groupIndex: number; otherAthletes: number }[];
  profileFields: { key: string; from: 'old' | 'new' }[];
}

interface MergeResponse {
  ok: boolean;
  committed?: boolean;
  summary: MergeSummary | null;
  errors?: MergeError[];
  counts?: Record<string, number>;
}

/** Every refusal the merge can produce, in plain Mongolian: what is wrong
 *  and what the admin should do about it. The API returns codes, never
 *  prose, so this is the only place the wording lives. */
function errorCopy(err: MergeError, newEmail: string): { title: string; body: string } {
  switch (err.code) {
    case 'NEW_EMAIL_NOT_FOUND':
      return {
        title: 'Шинэ хаяг олдсонгүй',
        body:
          'Энэ мэйлээр нэвтэрсэн хэрэглэгч олдсонгүй. Тамирчин эхлээд шинэ Gmail-ээрээ ' +
          'нэвтэрсэн байх шаардлагатай.',
      };
    case 'OLD_EMAIL_NOT_FOUND':
      return {
        title: 'Хуучин хаяг олдсонгүй',
        body:
          'Энэ тамирчны хуучин мэйлээр бүртгэл олдсонгүй. Жагсаалтаа шинэчлээд дахин ' +
          'оролдоно уу.',
      };
    case 'NEW_EMAIL_AMBIGUOUS':
    case 'OLD_EMAIL_AMBIGUOUS':
      return {
        title: 'Мэйл давхардсан байна',
        body:
          `"${err.email}" хаягтай бүртгэл нэгээс олон байна (${err.uids?.length ?? 0}). ` +
          'Аль нь болохыг тааж шилжүүлэх боломжгүй тул админ эхлээд давхардлыг арилгах ёстой.',
      };
    case 'SAME_ACCOUNT':
      return {
        title: 'Ижил бүртгэл',
        body: 'Оруулсан мэйл нь тухайн тамирчны одоогийн мэйлтэй ижил байна. Шилжүүлэх зүйл алга.',
      };
    case 'ALREADY_MERGED':
      return {
        title: 'Аль хэдийн шилжүүлсэн',
        body:
          'Энэ бүртгэлийн мэдээллийг өмнө нь өөр бүртгэл рүү шилжүүлсэн байна. Дахин ' +
          'шилжүүлэх боломжгүй — шаардлагатай бол хөгжүүлэгчид хандана уу.',
      };
    case 'NEW_HAS_SUBMISSIONS':
      return {
        title: 'Шинэ бүртгэл хоосон биш',
        body:
          `${newEmail} хаягтай бүртгэлд ${err.count ?? ''} илгээмж аль хэдийн байна. Энэ нь ` +
          'мэйл солих тохиолдол биш, өөр тамирчны бүртгэл байж магадгүй. Шилжүүлэхгүй.',
      };
    case 'NEW_HAS_REGISTRATIONS':
      return {
        title: 'Шинэ бүртгэл хоосон биш',
        body:
          `${newEmail} хаягтай бүртгэл ${err.count ?? ''} тэмцээнд бүртгүүлсэн байна. Энэ нь ` +
          'мэйл солих тохиолдол биш, өөр тамирчны бүртгэл байж магадгүй. Шилжүүлэхгүй.',
      };
    case 'NEW_HAS_SEASON_POINTS':
      return {
        title: 'Шинэ бүртгэл хоосон биш',
        body:
          `${newEmail} хаягтай бүртгэлд улирлын оноо аль хэдийн бүртгэгдсэн байна. Энэ нь ` +
          'мэйл солих тохиолдол биш, өөр тамирчны бүртгэл байж магадгүй. Шилжүүлэхгүй.',
      };
    case 'NEW_HAS_PROFILE':
      return {
        title: 'Шинэ бүртгэлд профайл бөглөсөн байна',
        body:
          `${newEmail} хаягтай бүртгэл өөрийн профайлаа бөглөсөн байна (төлөв: ` +
          `${err.status ?? '—'}). Хоосон шинэ бүртгэл рүү л шилжүүлэх боломжтой.`,
      };
    case 'OLD_UID_FIELD_MISMATCH':
    case 'NEW_UID_FIELD_MISMATCH':
    case 'OLD_UID_MALFORMED':
    case 'NEW_UID_MALFORMED':
      return {
        title: 'Бүртгэлийн өгөгдөл эвдэрсэн байна',
        body:
          'Бүртгэлийн дотоод дугаар (uid) буруу байна. Аюулгүйн үүднээс шилжүүлэхгүй — ' +
          'хөгжүүлэгчид хандана уу.',
      };
    default:
      return {
        title: 'Шилжүүлэх боломжгүй',
        body: `Шалгалт амжилтгүй боллоо (${err.code}). Хөгжүүлэгчид хандана уу.`,
      };
  }
}

export default function EmailChangeDialog({
  athlete,
  onClose,
  onMerged,
}: {
  athlete: OnlineParticipantAdminView;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [newEmail, setNewEmail] = useState('');
  const [stage, setStage] = useState<'input' | 'preview' | 'done'>('input');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<MergeError[]>([]);
  const [fetchError, setFetchError] = useState('');
  const [summary, setSummary] = useState<MergeSummary | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function call(mode: 'preview' | 'commit') {
    setBusy(true);
    setErrors([]);
    setFetchError('');
    try {
      const res = await fetch('/api/online-competition/admin-athletes/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldEmail: athlete.email, newEmail: newEmail.trim(), mode }),
      });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as MergeResponse;
      setSummary(data.summary);
      if (!data.ok) {
        setErrors(data.errors ?? []);
        setStage('input');
        return;
      }
      if (data.committed) {
        setCounts(data.counts ?? null);
        setStage('done');
        onMerged();
      } else {
        setStage('preview');
      }
    } catch {
      setFetchError('Сервертэй холбогдоход алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setBusy(false);
    }
  }

  const label = `${athlete.lastName} ${athlete.firstName}`.trim() || athlete.displayName;

  return (
    <div className="oc-adm-merge-overlay" role="presentation" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Мэйл солих"
        className="oc-adm-merge-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '15px 18px', borderBottom: '1px solid #1C1C21' }}>
          <span className="oc-v3-label">Мэйл солих</span>
          <p style={{ marginTop: 8, font: '500 14px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
            {label}
          </p>
          <p style={{ marginTop: 4, font: '400 11px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
            {athlete.email || '—'}
          </p>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {stage === 'input' && (
            <>
              <div className="oc-sc-warn">
                Тамирчин ШИНЭ Gmail-ээрээ эхлээд нэвтэрсэн байх ёстой. Тэр нэвтрэлт нь
                шилжүүлэх хаягийг үүсгэдэг.
              </div>
              <div>
                <span className="oc-v3-field-label">Шинэ мэйл хаяг</span>
                <input
                  className="oc-input"
                  style={{ marginTop: 8 }}
                  type="email"
                  autoFocus
                  value={newEmail}
                  placeholder="new@gmail.com"
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
            </>
          )}

          {errors.map((err) => {
            const copy = errorCopy(err, newEmail.trim());
            return (
              <div key={err.code} className="oc-v3-reject-block">
                <p style={{ font: '600 9px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: '#E8543C' }}>
                  {copy.title.toUpperCase()}
                </p>
                <p style={{ marginTop: 8, font: '400 12px var(--oc-font-heading), sans-serif', color: '#F4F1EA', lineHeight: 1.6 }}>
                  {copy.body}
                </p>
              </div>
            );
          })}

          {fetchError && (
            <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#E8543C' }}>{fetchError}</p>
          )}

          {stage === 'preview' && summary && (
            <>
              <div className="oc-sc-warn">
                Доорх мэдээлэл шинэ хаяг руу бүрмөсөн шилжинэ. Хуучин бүртгэлээс
                профайлын бүх мэдээлэл — нэр, зураг, төрсөн огноо, иргэншил, баталгаажуулалт,
                статистик — БҮРЭН УСтгана. Зөвхөн Gmail бүртгэл нь үлдэж, «шилжүүлсэн» гэж
                тэмдэглэгдэнэ. Энэ үйлдлийг буцаах боломжгүй — батлахаас өмнө сайтар шалгана уу.
              </div>
              <PreviewList summary={summary} />
            </>
          )}

          {stage === 'done' && counts && (
            <div className="oc-sc-warn" style={{ borderColor: '#2E9E5B', color: '#4FD07A', background: '#0A140D' }}>
              Шилжүүлэлт амжилттай. Бичлэг {counts.C}, мэдэгдэл {counts.E}, бүртгэл {counts.B},
              улирлын оноо {counts.D}, шалгаруулалт {counts.F}, групп {counts.G}.
            </div>
          )}
        </div>

        <div
          style={{
            padding: '13px 18px',
            borderTop: '1px solid #1C1C21',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {stage === 'done' ? (
            <Button variant="primary" onClick={onClose}>
              Хаах
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Болих
              </Button>
              {stage === 'input' ? (
                <Button
                  variant="primary"
                  disabled={busy || newEmail.trim().length === 0}
                  onClick={() => call('preview')}
                >
                  {busy ? 'Шалгаж байна...' : 'Шалгах'}
                </Button>
              ) : (
                // The only place 'commit' is ever sent, and it exists only
                // after a preview came back ok — the preview cannot be
                // skipped.
                <Button variant="primary" disabled={busy} onClick={() => call('commit')}>
                  {busy ? 'Шилжүүлж байна...' : 'Тийм, шилжүүлэх'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="oc-adm-merge-row">
      <span style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.12em', color: '#6E6A62' }}>
        {label}
      </span>
      <span style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>{children}</span>
    </div>
  );
}

/** The dry run, rendered. Everything here comes from the same plan the
 *  commit will apply. */
function PreviewList({ summary }: { summary: MergeSummary }) {
  const fromOld = summary.profileFields.filter((f) => f.from === 'old').length;
  const fromNew = summary.profileFields.filter((f) => f.from === 'new').map((f) => f.key);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#1C1C21', border: '1px solid #1C1C21' }}>
      <Row label="ПРОФАЙЛ">
        {fromOld} талбар хуучин бүртгэлээс, {fromNew.join(' / ')} шинэ бүртгэлээс
      </Row>
      <Row label="БҮРТГЭЛ">
        {summary.registrations.length === 0
          ? '—'
          : summary.registrations.map((r) => `${r.competitionId} (${r.events.join(', ')})`).join(' · ')}
      </Row>
      <Row label="ИЛГЭЭМЖ">{summary.submissions}</Row>
      <Row label="УЛИРЛЫН ОНОО">
        {summary.seasonPoints.length === 0
          ? '—'
          : summary.seasonPoints.map((s) => `${s.season}: ${s.totalPoints}`).join(' · ')}
      </Row>
      <Row label="МЭДЭГДЭЛ">{summary.notifications}</Row>
      <Row label="ШАЛГАРУУЛАЛТ">
        {summary.qualifiers.length === 0
          ? '—'
          : summary.qualifiers.map((q) => `${q.path.split('/').slice(-1)[0]} (${q.index + 1}/${q.length}-р байрлал хэвээр)`).join(' · ')}
      </Row>
      <Row label="ГРУПП">
        {summary.assignments.length === 0
          ? '—'
          : summary.assignments
              .map((g) => `${g.path.split('/').slice(-1)[0]}: групп ${g.groupIndex} (бусад ${g.otherAthletes} тамирчинд нөлөөлөхгүй)`)
              .join(' · ')}
      </Row>
    </div>
  );
}
