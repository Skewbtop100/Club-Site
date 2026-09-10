'use client';

import { useRef, useState } from 'react';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import {
  expectedScrambleCountFor,
  parseTnoodleJson,
  roundKey,
  type ParseResult,
  type ScrambleRoundData,
} from '@/lib/online-competition/scrambles';
import { eventCode, eventLabel, roundTitle } from './shared';

// ── Tab 02 · Файл ────────────────────────────────────────────────────────
// The WCA TNoodle import. Parsing and the save round-trip are unchanged
// from the first build — the file is parsed here only to render the
// preview, and the raw text is what gets POSTed, so the server re-runs the
// same validation on the original bytes before writing anything.

const SAMPLE_URL = '/online-competition/sample-tnoodle.json';
const SUMMARY_COLUMNS = 'minmax(150px, 1.5fr) 90px 90px 100px';

export default function FileTab({
  competitionId,
  competition,
  hasImported,
  onSaved,
}: {
  competitionId: string | null;
  competition: OnlineCompetitionAdminView | null;
  /** Whether this competition already has scramble data in Firestore —
   *  gates the destructive УСТГАХ action, which is about stored data, not
   *  about the file currently staged in the picker. */
  hasImported: boolean;
  onSaved: () => Promise<void>;
}) {
  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [open, setOpen] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Drops the staged file only. Purely local — it does not touch anything
   *  already imported into Firestore; that is what handleDelete does. */
  function reset() {
    setFileName('');
    setFileText('');
    setParsed(null);
    setSavedMsg('');
    setConfirmingDelete(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /** Deletes this competition's imported scrambles AND group assignments
   *  from Firestore. Two-step confirm, same pattern as the other
   *  irreversible admin actions — there is no undo. */
  async function handleDelete() {
    if (!competitionId) return;
    setDeleting(true);
    setSavedMsg('');
    try {
      const res = await fetch(
        `/api/online-competition/admin-scrambles?competitionId=${encodeURIComponent(competitionId)}`,
        { method: 'DELETE' },
      );
      const data = (await res.json().catch(() => ({}))) as {
        removedScrambleData?: number;
        removedGroupAssignments?: number;
        error?: string;
      };
      if (!res.ok) {
        setParsed({ ok: false, error: data.error ?? 'Устгахад алдаа гарлаа.' });
        return;
      }
      await onSaved();
      reset();
      setSavedMsg(
        `${data.removedScrambleData ?? 0} раундын холилт устгагдлаа` +
          `${data.removedGroupAssignments ? ` (${data.removedGroupAssignments} группын хуваарилалт хамт)` : ''}.`,
      );
    } catch (err) {
      console.error('FileTab: deleting the scramble file failed:', err);
      setParsed({ ok: false, error: 'Устгахад алдаа гарлаа. Дахин оролдоно уу.' });
    } finally {
      setDeleting(false);
    }
  }

  function load(name: string, text: string) {
    setSavedMsg('');
    setFileName(name);
    setFileText(text);
    setOpen(true);
    try {
      // The competition decides how many scrambles a round needs — the
      // file alone cannot say, since that depends on each event's format.
      setParsed(
        parseTnoodleJson(
          JSON.parse(text),
          expectedScrambleCountFor(competition?.events ?? []),
        ),
      );
    } catch (err) {
      // The parse error names the line and column, which the admin-facing
      // message deliberately does not.
      console.error('FileTab: parsing the chosen JSON file failed:', err);
      setParsed({ ok: false, error: 'JSON файлыг уншиж чадсангүй (буруу форматтай).' });
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    load(file.name, await file.text());
  }

  async function handleSample() {
    try {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error('failed');
      // Labelled as a sample everywhere it's shown — importing it writes
      // real scramble docs, so the admin must be able to see at a glance
      // that these aren't their competition's official scrambles.
      load('ЖИШЭЭ ФАЙЛ (ТУРШИЛТЫН ХОЛИЛТ)', await res.text());
    } catch (err) {
      console.error('FileTab: loading the sample file failed:', err);
      setParsed({ ok: false, error: 'Жишээ файлыг ачааллаж чадсангүй.' });
    }
  }

  async function handleSave() {
    if (!competitionId || !fileText) return;
    setSaving(true);
    setSavedMsg('');
    try {
      const res = await fetch('/api/online-competition/admin-scrambles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitionId, fileText }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        saved?: number;
        removed?: number;
        error?: string;
      };
      if (!res.ok) {
        setParsed({ ok: false, error: data.error ?? 'Хадгалахад алдаа гарлаа.' });
        return;
      }
      await onSaved();
      reset();
      setSavedMsg(
        `${data.saved ?? 0} раундын холилт хадгалагдлаа` +
          `${data.removed ? ` · өмнөх ${data.removed} раунд устгагдлаа` : ''}.`,
      );
    } catch (err) {
      console.error('FileTab: saving the scrambles failed:', err);
      setParsed({ ok: false, error: 'Хадгалахад алдаа гарлаа. Дахин оролдоно уу.' });
    } finally {
      setSaving(false);
    }
  }

  const rounds: ScrambleRoundData[] = parsed?.ok ? parsed.rounds : [];
  const totalGroups = rounds.reduce((n, r) => n + r.groupCount, 0);
  const totalScrambles = rounds.reduce((n, r) => n + r.groups.reduce((m, g) => m + g.scrambles.length, 0), 0);
  const loaded = fileName !== '';

  return (
    <>
      <div className={`oc-sc-uploadrow${loaded ? ' oc-sc-uploadrow-loaded' : ''}`}>
        <div style={{ minWidth: 0 }}>
          <span className="oc-sc-uploadlabel">WCA TNoodle JSON</span>
          <span className={`oc-sc-uploadstatus${loaded ? '' : ' oc-sc-uploadstatus-empty'}`}>
            {loaded ? fileName : 'Файл сонгогдоогүй байна'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label className="oc-sc-file">
            JSON файл сонгох
            <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleFile} />
          </label>
          <button
            type="button"
            className="oc-sc-btn oc-sc-btn-dashed"
            disabled={saving}
            onClick={handleSample}
          >
            ЖИШЭЭ АЧААЛАХ
          </button>
          {/* Dismissing the staged file and deleting the competition's
              imported data are different actions with different stakes, so
              they are different buttons. The old single УСТГАХ only did the
              first while reading as the second, which is how a previous
              import's events survived a "clear" and reappeared merged into
              the next upload. */}
          {loaded && (
            <button type="button" className="oc-sc-btn" disabled={saving || deleting} onClick={reset}>
              ЦУЦЛАХ
            </button>
          )}
          {hasImported && !confirmingDelete && (
            <button
              type="button"
              className="oc-sc-clear"
              disabled={saving || deleting}
              onClick={() => setConfirmingDelete(true)}
            >
              УСТГАХ
            </button>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <div className="oc-sc-warn" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 240px' }}>
            ЭНЭ ТЭМЦЭЭНИЙ ИМПОРТЛОСОН БҮХ ХОЛИЛТ БА ГРУППЫН ХУВААРИЛАЛТ УСТАНА. БУЦААХ БОЛОМЖГҮЙ.
          </span>
          <button type="button" className="oc-sc-btn oc-sc-btn-danger" disabled={deleting} onClick={handleDelete}>
            {deleting ? 'УСТГАЖ БАЙНА...' : 'ТИЙМ, УСТГА'}
          </button>
          <button
            type="button"
            className="oc-sc-btn"
            disabled={deleting}
            onClick={() => setConfirmingDelete(false)}
          >
            ҮГҮЙ
          </button>
        </div>
      )}

      <p className="oc-sc-hint">
        TNoodle-ээс татсан албан ёсны холилтын JSON файлыг оруулна. Раунд бүрийн scrambleSet тус бүр нэг групп
        болно — групп бүр өөрийн 5 холилттой.
      </p>

      {savedMsg && <p className="oc-sc-msg-ok">{savedMsg}</p>}
      {parsed && !parsed.ok && <p className="oc-sc-msg-err">{parsed.error}</p>}

      {parsed?.ok && (
        <>
          <button type="button" className="oc-sc-collapse" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <span className="oc-sc-chev" aria-hidden>
              {open ? '▼' : '▶'}
            </span>
            Хянах хүснэгт
            <span style={{ flex: 1 }} />
            <span className="oc-sc-chipcount">{rounds.length} РАУНД</span>
          </button>

          {open && (
            <div className="oc-sc-table">
              <div className="oc-sc-thead" style={{ gridTemplateColumns: SUMMARY_COLUMNS, minWidth: 440 }}>
                <span className="oc-sc-th">Төрөл</span>
                <span className="oc-sc-th" style={{ textAlign: 'right' }}>
                  Раунд
                </span>
                <span className="oc-sc-th" style={{ textAlign: 'right' }}>
                  Групп
                </span>
                <span className="oc-sc-th" style={{ textAlign: 'right' }}>
                  Холилт
                </span>
              </div>
              {rounds.map((r) => (
                <div
                  key={roundKey(r.eventId, r.round)}
                  className="oc-sc-trow"
                  style={{ gridTemplateColumns: SUMMARY_COLUMNS, minWidth: 440 }}
                >
                  <span className="oc-sc-cellname">
                    <span className="oc-sc-icon" aria-hidden>
                      {eventCode(r.eventId)}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="oc-sc-name">{eventLabel(competition, r.eventId)}</span>
                      <span className="oc-sc-subline">
                        {r.groups.map((g) => g.label).join(' · ')}
                      </span>
                    </span>
                  </span>
                  <span className="oc-sc-num" style={{ textAlign: 'right' }}>
                    {r.round}
                  </span>
                  <span className="oc-sc-num" style={{ textAlign: 'right' }}>
                    {r.groupCount}
                  </span>
                  <span className="oc-sc-num" style={{ textAlign: 'right' }}>
                    {r.groups.reduce((m, g) => m + g.scrambles.length, 0)}
                  </span>
                </div>
              ))}
              <div
                className="oc-sc-trow oc-sc-trow-total"
                style={{ gridTemplateColumns: SUMMARY_COLUMNS, minWidth: 440 }}
              >
                <span className="oc-sc-total-label">Нийт</span>
                <span className="oc-sc-total-num" style={{ textAlign: 'right' }}>
                  {rounds.length}
                </span>
                <span className="oc-sc-total-num" style={{ textAlign: 'right' }}>
                  {totalGroups}
                </span>
                <span className="oc-sc-total-num" style={{ textAlign: 'right' }}>
                  {totalScrambles}
                </span>
              </div>
            </div>
          )}

          {parsed.warnings.length > 0 && (
            <div className="oc-sc-warn">
              ДАРААХ РАУНДУУД АЛГАСАГДАНА:
              {parsed.warnings.map((w) => (
                <span key={`${w.eventId}_${w.round}`} style={{ display: 'block' }}>
                  · {roundTitle(competition, w.eventId, w.round)} — {w.reason}
                </span>
              ))}
            </div>
          )}

          <div>
            <button
              type="button"
              className="oc-sc-btn oc-sc-btn-primary"
              disabled={saving || !competitionId}
              onClick={handleSave}
            >
              {saving ? 'ХАДГАЛЖ БАЙНА...' : 'ХАДГАЛАХ'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
