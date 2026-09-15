'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../_components/ui';
import type {
  DeletionJobView,
  DeletionPhase,
  DeletionPreview,
} from '@/lib/online-competition/competition-delete';

// ── Тэмцээн устгах ───────────────────────────────────────────────────────
// Preview (nothing written) -> type the exact name -> the deletion runs in
// steps until done, showing what was removed and anything that could not
// be. See lib/online-competition/competition-delete.ts.
//
// Closing mid-deletion stops the steps but not the deletion: the competition
// is already hidden from athletes, and the list offers ҮРГЭЛЖЛҮҮЛЭХ.
//
// Styling follows the admin panel: `.oc-*` classes and inline v3 values.

const PHASE_LABEL: Record<DeletionPhase, string> = {
  rounds: 'Раундын төлөв, тасалбар',
  submissions: 'Илгээмж ба бичлэг',
  registrations: 'Бүртгэл',
  notifications: 'Мэдэгдэл',
  subcollections: 'Холилт, групп, шалгаруулалт',
  images: 'Тэмцээний зураг',
  'r2-orphans': 'Үлдсэн бичлэг шалгах',
  finalize: 'Дуусгах',
  done: 'Дууссан',
};

const FAILURE_LABEL: Record<string, string> = {
  'r2-video': 'Бичлэг (R2)',
  'legacy-video': 'Хуучин бичлэг (Cloudinary)',
  still: 'Зураг (Cloudinary)',
  image: 'Тэмцээний зураг',
  'r2-orphan': 'Үлдсэн бичлэг (R2)',
  'r2-scan': 'R2 шалгалт',
  submission: 'Илгээмж',
};

export default function DeleteCompetitionDialog({
  competitionId,
  onClose,
  onChanged,
}: {
  competitionId: string;
  onClose: () => void;
  /** The list should reload: the competition was hidden or deleted. */
  onChanged: () => void;
}) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [typed, setTyped] = useState('');
  const [job, setJob] = useState<DeletionJobView | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const closed = useRef(false);

  const base = `/api/online-competition/admin-competitions/${encodeURIComponent(competitionId)}/delete`;

  async function runSteps() {
    setRunning(true);
    setRunError('');
    try {
      while (!closed.current) {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'continue' }),
        });
        const data = (await res.json().catch(() => ({}))) as { job?: DeletionJobView; error?: string };
        if (!res.ok || !data.job) {
          setRunError(data.error ?? 'Устгал тасарлаа. Дахин үргэлжлүүлнэ үү.');
          return;
        }
        setJob(data.job);
        if (data.job.done) {
          onChanged();
          return;
        }
      }
    } catch (err) {
      console.error('DeleteCompetitionDialog: a deletion step failed:', err);
      setRunError('Сервертэй холбогдож чадсангүй. Дахин үргэлжлүүлнэ үү.');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    closed.current = false;
    (async () => {
      try {
        const res = await fetch(base);
        const data = (await res.json().catch(() => ({}))) as {
          preview?: DeletionPreview;
          job?: DeletionJobView | null;
          error?: string;
        };
        if (!res.ok || !data.preview) {
          setLoadError(data.error ?? 'Урьдчилсан мэдээллийг ачаалж чадсангүй.');
          return;
        }
        setPreview(data.preview);
        // A deletion already under way: pick it up where it stopped.
        if (data.job && !data.job.done) {
          setJob(data.job);
          runSteps();
        }
      } catch (err) {
        console.error('DeleteCompetitionDialog: loading the preview failed:', err);
        setLoadError('Урьдчилсан мэдээллийг ачаалж чадсангүй.');
      }
    })();
    return () => {
      closed.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !running) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, running]);

  async function confirmDelete() {
    if (!preview || typed !== preview.confirmText) return;
    setRunning(true);
    setRunError('');
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'start', confirmName: typed }),
      });
      const data = (await res.json().catch(() => ({}))) as { job?: DeletionJobView; error?: string };
      if (!res.ok || !data.job) {
        setRunError(data.error ?? 'Устгалыг эхлүүлж чадсангүй.');
        setRunning(false);
        return;
      }
      setJob(data.job);
      onChanged();
    } catch (err) {
      console.error('DeleteCompetitionDialog: starting the deletion failed:', err);
      setRunError('Сервертэй холбогдож чадсангүй.');
      setRunning(false);
      return;
    }
    await runSteps();
  }

  const canConfirm = !!preview && typed === preview.confirmText && !running;
  const title = preview?.name || job?.name || competitionId;

  return (
    <div className="oc-adm-merge-overlay" role="presentation" onClick={running ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Тэмцээн устгах"
        className="oc-adm-merge-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '15px 18px', borderBottom: '1px solid #1C1C21' }}>
          <span className="oc-v3-label" style={{ color: '#E8543C' }}>
            Тэмцээн устгах
          </span>
          <p style={{ marginTop: 8, font: '500 14px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>{title}</p>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loadError && <p className="oc-sc-msg-err">{loadError}</p>}
          {!preview && !loadError && <p className="oc-v3-status" style={{ padding: 0 }}>Ачааллаж байна...</p>}

          {preview && !job && (
            <>
              <div className="oc-v3-reject-block">
                <p style={{ font: '600 9px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: '#E8543C' }}>
                  БУЦААХ БОЛОМЖГҮЙ
                </p>
                <p style={{ marginTop: 8, font: '400 12px var(--oc-font-heading), sans-serif', color: '#F4F1EA', lineHeight: 1.6 }}>
                  Доорх бүх мэдээлэл бүрмөсөн устна. Тэмцээн устгал эхэлмэгц тамирчдад харагдахаа болино.
                </p>
              </div>
              <PreviewCounts preview={preview} />
              <div>
                <span className="oc-v3-field-label">
                  Баталгаажуулахын тулд тэмцээний нэрийг яг бичнэ үү: «{preview.confirmText}»
                </span>
                <input
                  className="oc-input"
                  style={{ marginTop: 8 }}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Тэмцээний нэр"
                />
              </div>
            </>
          )}

          {job && <Progress job={job} running={running} />}

          {runError && <p className="oc-sc-msg-err">{runError}</p>}
        </div>

        <div
          style={{
            padding: '13px 18px',
            borderTop: '1px solid #1C1C21',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {job && !job.done && !running && (
            <span style={{ font: '400 11px var(--oc-font-heading), sans-serif', color: '#9A958A', marginRight: 'auto' }}>
              Тэмцээн нуугдсан хэвээр. Хаавал жагсаалтаас үргэлжлүүлж болно.
            </span>
          )}
          {job?.done ? (
            <Button variant="primary" onClick={onClose}>
              Хаах
            </Button>
          ) : job ? (
            <>
              <Button variant="outline" onClick={onClose} disabled={running}>
                Хаах
              </Button>
              <Button variant="primary" onClick={runSteps} disabled={running}>
                {running ? 'Устгаж байна...' : 'Үргэлжлүүлэх'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={running}>
                Болих
              </Button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={!canConfirm}
                style={{
                  border: '1px solid #E8543C',
                  background: canConfirm ? '#E8543C' : 'transparent',
                  color: canConfirm ? '#08080A' : '#6E6A62',
                  padding: '10px 16px',
                  font: '700 11px var(--oc-font-heading), sans-serif',
                  letterSpacing: '.06em',
                  cursor: canConfirm ? 'pointer' : 'not-allowed',
                  opacity: canConfirm ? 1 : 0.6,
                }}
              >
                {running ? 'Эхлүүлж байна...' : 'Бүрмөсөн устгах'}
              </button>
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

function PreviewCounts({ preview }: { preview: DeletionPreview }) {
  const roundDocs = Object.values(preview.roundDocs).reduce((a, b) => a + b, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#1C1C21', border: '1px solid #1C1C21' }}>
      <Row label="ТАМИРЧИН">
        {preview.registrations.total} бүртгэл ({preview.registrations.approved} зөвшөөрсөн, {preview.registrations.pending}{' '}
        хүлээгдэж буй{preview.registrations.other > 0 ? `, ${preview.registrations.other} бусад` : ''})
      </Row>
      <Row label="ИЛГЭЭМЖ">
        {preview.submissions.total} ({preview.submissions.judged} шүүгдсэн, {preview.submissions.pending} хүлээгдэж буй)
      </Row>
      <Row label="БИЧЛЭГ">
        {preview.videos.r2} бичлэг
        {preview.videos.legacyCloudinary > 0 ? `, ${preview.videos.legacyCloudinary} хуучин бичлэг` : ''}
        {preview.videos.stills > 0 ? `, ${preview.videos.stills} зураг` : ''}
      </Row>
      <Row label="РАУНД, ХОЛИЛТ">{roundDocs} баримт</Row>
      <Row label="МЭДЭГДЭЛ">{preview.notifications}</Row>
      <Row label="ЗУРАГ">{preview.images} (постер, баннер, хэсгийн зураг)</Row>
    </div>
  );
}

function Progress({ job, running }: { job: DeletionJobView; running: boolean }) {
  const r = job.removed;
  return (
    <>
      <div
        className="oc-sc-warn"
        role="status"
        style={job.done ? { borderColor: '#2E9E5B', color: '#4FD07A', background: '#0A140D' } : undefined}
      >
        {job.done
          ? job.failureCount > 0
            ? `Тэмцээн устгагдлаа. ${job.failureCount} файл устгаж чадсангүй — доорх жагсаалтыг гараар шалгана уу.`
            : 'Тэмцээн болон түүний бүх мэдээлэл устгагдлаа.'
          : `${running ? 'Устгаж байна' : 'Зогссон'} · ${PHASE_LABEL[job.phase]}`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#1C1C21', border: '1px solid #1C1C21' }}>
        <Row label="ИЛГЭЭМЖ">{r.submissions}</Row>
        <Row label="БИЧЛЭГ">
          {r.r2Videos}
          {r.legacyVideos > 0 ? ` + ${r.legacyVideos} хуучин` : ''}
          {r.stills > 0 ? ` + ${r.stills} зураг` : ''}
          {r.r2Orphans > 0 ? ` + ${r.r2Orphans} илгээгдээгүй` : ''}
        </Row>
        <Row label="БҮРТГЭЛ">{r.registrations}</Row>
        <Row label="МЭДЭГДЭЛ">{r.notifications}</Row>
        <Row label="РАУНД, ХОЛИЛТ">{r.roundDocs}</Row>
        <Row label="ЗУРАГ">{r.images}</Row>
      </div>

      {job.failureCount > 0 && (
        <div className="oc-v3-reject-block">
          <p style={{ font: '600 9px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: '#E8543C' }}>
            УСТГАЖ ЧАДААГҮЙ ФАЙЛ · {job.failureCount}
          </p>
          <p style={{ marginTop: 6, font: '400 11px/1.5 var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
            Баримтууд устгагдсан. Эдгээр файлууд хадгалах сан дээр үлдсэн байж магадгүй; бүтэн жагсаалт устгалын бүртгэлд
            (onlineCompetitionDeletions/{job.competitionId}) хадгалагдсан.
          </p>
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', maxHeight: 180, overflowY: 'auto' }}>
            {job.failures.map((f) => (
              <li
                key={`${f.kind}:${f.id}`}
                style={{ padding: '4px 0', font: '400 10px/1.4 var(--oc-font-mono), monospace', color: '#F4F1EA', overflowWrap: 'anywhere' }}
              >
                {FAILURE_LABEL[f.kind] ?? f.kind}: {f.id} — {f.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {job.refusedCount > 0 && (
        <p style={{ font: '400 11px/1.5 var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
          {job.refusedCount} файл өөр эзэнтэй тул устгаагүй (жишээ нь өөр тэмцээн ашиглаж буй зураг).
        </p>
      )}
    </>
  );
}
