'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TEST_ATHLETES,
  TEST_COMPETITIONS,
  TEST_DATA_PREFIX,
  type SeedCounts,
  type WipeCounts,
} from '@/lib/online-competition/test-data';

// ── Тест өгөгдөл ─────────────────────────────────────────────────────────
// Seed / wipe realistic fixture data. Deliberately styled apart from every
// other admin page (amber frame, warning banner) so it is never mistaken
// for a normal admin function — the two buttons here create and destroy
// data in the same collections real competitions live in.
//
// Both actions are admin-cookie gated server-side and confirm-gated here:
// seed once, wipe twice, matching the two-step confirm used for submission
// deletion.

const COUNT_LABEL: Record<keyof WipeCounts, string> = {
  competitions: 'Тэмцээн',
  participants: 'Тамирчин',
  registrations: 'Бүртгэл',
  submissions: 'Илгээмж',
  roundState: 'Раундын төлөв',
  qualifiers: 'Шалгарсан жагсаалт',
  scrambleData: 'Холилт',
  groupAssignments: 'Группын хуваарилалт',
  seasonPoints: 'Улирлын оноо',
  cloudinaryDeleted: 'Cloudinary бичлэг',
};

interface Status {
  present: boolean;
  counts: { competitions: number; participants: number; submissions: number };
  prefix: string;
}

export default function TestDataManager() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<'seed' | 'wipe' | null>(null);
  const [error, setError] = useState('');
  const [seedResult, setSeedResult] = useState<SeedCounts | null>(null);
  const [wipeResult, setWipeResult] = useState<WipeCounts | null>(null);
  const [confirmSeed, setConfirmSeed] = useState(false);
  /** Wipe needs two confirmations, not one — it destroys data. */
  const [wipeStep, setWipeStep] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/online-competition/admin-testdata');
      if (!res.ok) throw new Error('failed');
      setStatus((await res.json()) as Status);
    } catch {
      setError('Тест өгөгдлийн төлөвийг уншиж чадсангүй');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: 'seed' | 'wipe') {
    setBusy(action);
    setError('');
    setSeedResult(null);
    setWipeResult(null);
    try {
      const res = await fetch('/api/online-competition/admin-testdata', {
        method: action === 'seed' ? 'POST' : 'DELETE',
      });
      const data = (await res.json().catch(() => ({}))) as {
        counts?: SeedCounts & WipeCounts;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? 'Үйлдэл амжилтгүй боллоо.');
        return;
      }
      if (action === 'seed') setSeedResult(data.counts as SeedCounts);
      else setWipeResult(data.counts as WipeCounts);
      await load();
    } catch {
      setError('Үйлдэл амжилтгүй боллоо. Дахин оролдоно уу.');
    } finally {
      setBusy(null);
      setConfirmSeed(false);
      setWipeStep(0);
    }
  }

  const totalEvents = TEST_COMPETITIONS.reduce((n, c) => n + c.events.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 className="oc-v3-title">Тест өгөгдөл</h1>
        <p className="oc-rd-note" style={{ marginTop: 5 }}>
          ҮҮСГЭХ · УСТГАХ · ЗӨВХӨН ТУРШИЛТЫН ЗОРИУЛАЛТААР
        </p>
      </div>

      <div className="oc-td-warn">
        <span className="oc-td-warn-icon" aria-hidden>
          ⚠
        </span>
        <div style={{ minWidth: 0 }}>
          <p className="oc-td-warn-title">ЭНЭ ХЭСЭГ ЖИНХЭНЭ ӨГӨГДӨЛ БИШ</p>
          <p className="oc-td-warn-body">
            Энд үүсэх бүх бичлэгийн ID нь <code className="oc-td-code">{TEST_DATA_PREFIX}</code> угтвартай
            байна. Устгах үйлдэл ЗӨВХӨН энэ угтвартай бичлэгийг л арилгана — жинхэнэ тэмцээн, тамирчин,
            илгээмжид хүрэхгүй. (Жишээ нь <code className="oc-td-code">test-comp-1</code> нь нэрнийхээ
            хэдий ч жинхэнэ өгөгдөл бөгөөд энэ угтварт таарахгүй.)
          </p>
        </div>
      </div>

      {error && <p className="oc-sc-msg-err">{error}</p>}

      {/* ── Current state ──────────────────────────────────────────── */}
      <div className="oc-sc-card">
        <div className="oc-sc-cardhead" style={{ padding: '13px 16px', borderBottom: '1px solid #1C1C21' }}>
          <span className="oc-v3-label">Одоогийн байдал</span>
          {status && (
            <span className={`oc-rd-badge${status.present ? ' oc-td-badge-on' : ''}`}>
              {status.present ? 'ТЕСТ ӨГӨГДӨЛ БАЙНА' : 'ТЕСТ ӨГӨГДӨЛ АЛГА'}
            </span>
          )}
        </div>
        <div style={{ padding: 16 }}>
          {status === null ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : (
            <div className="oc-sc-statgrid">
              <div className="oc-sc-statcell">
                <span className="oc-sc-statlabel">Тэмцээн</span>
                <span className="oc-sc-statvalue">{status.counts.competitions}</span>
              </div>
              <div className="oc-sc-statcell">
                <span className="oc-sc-statlabel">Тамирчин</span>
                <span className="oc-sc-statvalue">{status.counts.participants}</span>
              </div>
              <div className="oc-sc-statcell">
                <span className="oc-sc-statlabel">Илгээмж</span>
                <span className="oc-sc-statvalue">{status.counts.submissions}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Seed ───────────────────────────────────────────────────── */}
      <div className="oc-sc-card">
        <div className="oc-sc-cardhead" style={{ padding: '13px 16px', borderBottom: '1px solid #1C1C21' }}>
          <span className="oc-v3-label">Тест өгөгдөл үүсгэх</span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="oc-sc-hint">
            {TEST_COMPETITIONS.length} тэмцээн ({totalEvents} төрөл), {TEST_ATHLETES.length} тамирчин,
            тэдгээрийн бүртгэл, дууссан тэмцээний илгээмжүүд, мөн явагдаж буй тэмцээний 1-р раундыг нээсэн
            төлөвийг үүсгэнэ. Дахин ажиллуулбал ижил ID дээр дарж бичнэ (давхардуулахгүй).
          </p>
          {seedResult && (
            <div className="oc-td-result">
              <p className="oc-sc-msg-ok">Тест өгөгдөл үүслээ:</p>
              <CountList counts={seedResult as unknown as Partial<WipeCounts>} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {confirmSeed ? (
              <>
                <span className="oc-sc-hint">Үүсгэх үү?</span>
                <button
                  type="button"
                  className="oc-sc-btn oc-sc-btn-primary"
                  disabled={busy !== null}
                  onClick={() => run('seed')}
                >
                  {busy === 'seed' ? 'ҮҮСГЭЖ БАЙНА...' : 'ТИЙМ, ҮҮСГЭ'}
                </button>
                <button type="button" className="oc-sc-btn" disabled={busy !== null} onClick={() => setConfirmSeed(false)}>
                  ҮГҮЙ
                </button>
              </>
            ) : (
              <button
                type="button"
                className="oc-sc-btn oc-sc-btn-primary"
                disabled={busy !== null}
                onClick={() => setConfirmSeed(true)}
              >
                ТЕСТ ӨГӨГДӨЛ ҮҮСГЭХ
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Wipe ───────────────────────────────────────────────────── */}
      <div className="oc-sc-card">
        <div className="oc-sc-cardhead" style={{ padding: '13px 16px', borderBottom: '1px solid #1C1C21' }}>
          <span className="oc-v3-label">Тест өгөгдөл устгах</span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="oc-sc-hint">
            <code className="oc-td-code">{TEST_DATA_PREFIX}</code> угтвартай бүх бичлэгийг бүрэн устгана.
            Буцаах боломжгүй.
          </p>
          {wipeResult && (
            <div className="oc-td-result">
              <p className="oc-sc-msg-ok">Устгасан бичлэгүүд:</p>
              <CountList counts={wipeResult} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {wipeStep === 0 && (
              <button
                type="button"
                className="oc-sc-clear"
                disabled={busy !== null || !status?.present}
                title={status?.present ? undefined : 'Устгах тест өгөгдөл алга'}
                onClick={() => setWipeStep(1)}
              >
                ТЕСТ ӨГӨГДӨЛ УСТГАХ
              </button>
            )}
            {wipeStep === 1 && (
              <>
                <span className="oc-sc-hint">Бүх тест өгөгдөл устана. Итгэлтэй байна уу?</span>
                <button type="button" className="oc-sc-btn oc-sc-btn-danger" onClick={() => setWipeStep(2)}>
                  ҮРГЭЛЖЛҮҮЛЭХ
                </button>
                <button type="button" className="oc-sc-btn" onClick={() => setWipeStep(0)}>
                  ҮГҮЙ
                </button>
              </>
            )}
            {wipeStep === 2 && (
              <>
                <span className="oc-sc-msg-err">Эцсийн баталгаа — буцаах боломжгүй.</span>
                <button
                  type="button"
                  className="oc-sc-btn oc-sc-btn-danger"
                  disabled={busy !== null}
                  onClick={() => run('wipe')}
                >
                  {busy === 'wipe' ? 'УСТГАЖ БАЙНА...' : 'ТИЙМ, БҮГДИЙГ УСТГА'}
                </button>
                <button type="button" className="oc-sc-btn" disabled={busy !== null} onClick={() => setWipeStep(0)}>
                  БОЛИХ
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Per-collection counts, so both actions are auditable rather than
 *  silent. Zero-count rows are kept — "0 submissions deleted" is itself
 *  information when you expected some. */
function CountList({ counts }: { counts: Partial<WipeCounts> }) {
  const entries = Object.entries(counts) as [keyof WipeCounts, number][];
  return (
    <div className="oc-td-counts">
      {entries.map(([key, value]) => (
        <div key={key} className="oc-td-countrow">
          <span className="oc-sc-mono">{COUNT_LABEL[key] ?? key}</span>
          <span className="oc-sc-num">{value}</span>
        </div>
      ))}
    </div>
  );
}
