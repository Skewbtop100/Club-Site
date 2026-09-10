'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  OnlineCompetition,
  OnlineParticipantProfileStatus,
  OnlineRegistration,
  OnlineRegistrationStatus,
} from '@/lib/online-competition/types';
import { REGISTRATION_NOTE_MAX } from '@/lib/online-competition/types';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { onlineCompAuth } from '@/lib/online-competition/firebase';
import { fetchParticipant, registerForCompetition, resolveProfileStatus } from '@/lib/online-competition/data';
import {
  feeView,
  profileGateCopy,
  registrationStatusCopy,
  registrationWindow,
} from '@/lib/online-competition/registration-view';
import RegistrationStatusBadge from '../../../_components/RegistrationStatusBadge';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';

// ── The Бүртгүүлэх panel ────────────────────────────────────────────────
// A REDESIGN, not a new flow. The states and their order are exactly what
// they were:
//
//   idle ──(sign in if needed)──(profile check)──> picking ──(save)──> summary
//                                     │                                   │
//                                     └──> gated (not approved)           └── edit ──> picking
//
// persisted to onlineParticipants/{uid}/registrations/{competitionId}. On
// mount an existing registration is loaded and the panel opens straight on
// `summary`, as before.
//
// What is new: the mockup's markup; the note; the fee for the current
// selection; distinct copy for the three not-approved profile states; and
// two gates that did not exist — a passed deadline and a finished
// competition — because "Бүртгэл хаагдах хүртэл төрлөө сольж болно" is a
// promise about the deadline, and it cannot be true if the deadline does
// nothing. ALL gates are client-side; see registration-view.ts.

/** The PANEL's state — which screen is showing. Unrelated to the stored
 *  registration's review status (OnlineRegistrationStatus). The last state
 *  was called 'registered' until the review statuses arrived; it was
 *  renamed so a UI screen and a document status can never be confused
 *  for one another in the same file. */
type RegState = 'idle' | 'gated' | 'picking' | 'summary';

interface Saved {
  events: Set<string>;
  note: string;
}

/** Re-evaluated on this cadence so a panel left open across the deadline
 *  closes itself. The submit handler checks the clock again anyway. */
const WINDOW_TICK_MS = 30_000;

export default function RegistrationPanel({
  competition,
  registration,
  loadingRegistration,
  onSaved,
}: {
  competition: OnlineCompetition;
  /** The signed-in athlete's registration, from useMyRegistration — the
   *  same copy the page's sidebar reads, so the two never disagree. */
  registration: OnlineRegistration | null;
  loadingRegistration: boolean;
  /** Called after a successful save, so the page re-reads the stored
   *  document (its review status included). */
  onSaved: () => void;
}) {
  const { user, signInWithGoogle } = useOnlineAuth();
  const competitionId = competition.id;
  const events = competition.events;

  const [state, setState] = useState<RegState>('idle');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  // The last SAVED registration, or null if the athlete has none. Editing
  // works on a copy; Болих restores this, and "changed?" compares to it.
  const [saved, setSaved] = useState<Saved | null>(null);
  const [gate, setGate] = useState<{ status: Exclude<OnlineParticipantProfileStatus, 'approved'>; reason: string | null } | null>(null);
  const [authError, setAuthError] = useState('');
  const [checkingProfile, setCheckingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), WINDOW_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const deadlineMs = competition.registrationDeadline ? competition.registrationDeadline.toMillis() : null;
  const regWindow = registrationWindow({ status: competition.status, registrationDeadlineMs: deadlineMs }, now);

  // Adopt the stored registration whenever it (re)loads — on mount, after
  // a sign-in, and after every save's refresh. The one exception is an
  // edit in progress: a refresh must not wipe what the athlete is typing.
  // Their status and the admin's note are read straight from the prop
  // below, so those stay current even mid-edit.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!registration || editing) return;
    const snapshot = { events: new Set(registration.events), note: registration.note ?? '' };
    setSaved(snapshot);
    setSelected(new Set(snapshot.events));
    setNote(snapshot.note);
    setState('summary');
  }, [registration, editing]);

  // The review status. A registration saved a moment ago but not yet
  // re-read is 'pending' by construction — that is the only status a
  // first save may write.
  const status: OnlineRegistrationStatus | null = registration?.status ?? (saved ? 'pending' : null);
  const statusCopy = status ? registrationStatusCopy(status) : null;

  async function handleRegisterClick() {
    // Anonymous (solve-page) sessions don't count — registering needs a
    // real, returning identity.
    let uid = user?.uid;
    if (!user || user.isAnonymous) {
      setAuthError('');
      try {
        await signInWithGoogle();
        // signInWithGoogle() resolves void — read the fresh uid off the auth
        // instance; `user` from the hook's closure has not re-rendered yet.
        uid = onlineCompAuth.currentUser?.uid;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        // Popup closed or superseded — nothing went wrong, stay quiet.
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
        console.error('RegistrationPanel: Google sign-in failed:', err);
        setAuthError('Нэвтрэхэд алдаа гарлаа, дахин оролдоно уу');
        return;
      }
    }
    if (!uid) return;

    // The profile gate: only an APPROVED athlete reaches the form.
    setAuthError('');
    setCheckingProfile(true);
    try {
      const participant = await fetchParticipant(uid);
      const status = resolveProfileStatus(participant);
      if (status !== 'approved') {
        setGate({ status, reason: participant?.rejectionReason ?? null });
        setState('gated');
        return;
      }
    } catch (err) {
      console.error('RegistrationPanel: checking the profile failed:', err);
      setAuthError('Профайлын мэдээлэл шалгахад алдаа гарлаа, дахин оролдоно уу');
      return;
    } finally {
      setCheckingProfile(false);
    }
    setState('picking');
  }

  function startEdit() {
    setEditing(true);
    setState('picking');
  }

  function toggle(eventId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  /** Leave the form without saving. An edit returns to the SAVED
   *  registration — it used to drop to `idle`, which showed an athlete who
   *  was registered a "Бүртгүүлэх" button, with their unsaved changes
   *  still sitting in the selection. */
  function handleCancel() {
    setSaveError('');
    setEditing(false);
    if (saved) {
      setSelected(new Set(saved.events));
      setNote(saved.note);
      setState('summary');
    } else {
      setState('idle');
    }
  }

  async function handleConfirm() {
    // The session could have expired, or been signed out in another tab,
    // while this one sat on the form.
    if (!user || user.isAnonymous) {
      setSaveError('Та нэвтрээгүй байна. Дахин нэвтэрнэ үү.');
      return;
    }
    // The deadline is re-checked against the clock NOW, not the last tick:
    // a form opened at 17:59 must not save at 18:01.
    const liveWindow = registrationWindow(
      { status: competition.status, registrationDeadlineMs: deadlineMs },
      Date.now(),
    );
    if (!liveWindow.open) {
      setNow(Date.now());
      setSaveError('Бүртгэлийн хугацаа дууссан тул хадгалах боломжгүй.');
      return;
    }
    // Only events the competition still has — an event the admin removed
    // while this form was open is dropped rather than written back.
    const configured = new Set(events.map((e) => e.eventId));
    const chosen = Array.from(selected).filter((id) => configured.has(id));
    if (chosen.length === 0) {
      // Every ticked event was removed by the admin while the form was
      // open. Saying so, rather than a button that silently does nothing.
      setSaveError('Сонгосон төрөл энэ тэмцээнд байхгүй болсон байна. Дахин сонгоно уу.');
      return;
    }

    setSaveError('');
    setSaving(true);
    try {
      await registerForCompetition(user.uid, competitionId, chosen, note);
      const trimmed = note.trim().slice(0, REGISTRATION_NOTE_MAX);
      setSaved({ events: new Set(chosen), note: trimmed });
      setSelected(new Set(chosen));
      setNote(trimmed);
      setEditing(false);
      setState('summary');
      onSaved();
    } catch (err) {
      console.error('RegistrationPanel: saving the registration failed:', err);
      setSaveError('Бүртгэл хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setSaving(false);
    }
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const fee = feeView(competition.paid === true, competition.baseFeeMnt ?? null, events, selectedIds);
  const savedIds = saved ? Array.from(saved.events) : [];
  const savedFee = feeView(competition.paid === true, competition.baseFeeMnt ?? null, events, savedIds);

  // "Changed?" for the edit form — the save button stays disabled until
  // there is something to save.
  const dirty =
    !saved ||
    saved.note !== note.trim().slice(0, REGISTRATION_NOTE_MAX) ||
    saved.events.size !== selected.size ||
    [...selected].some((id) => !saved.events.has(id));

  if (loadingRegistration) {
    return <p className="oc-rp-muted">Ачааллаж байна...</p>;
  }

  // ── registration closed ──────────────────────────────────────────────
  // Before every other state: there is no point signing in to, or
  // filling in, a registration that cannot be saved. A registered athlete
  // still sees what they registered for — read-only.
  if (!regWindow.open) {
    const closedLine =
      regWindow.reason === 'finished' ? 'Тэмцээн дууссан тул бүртгэл хаагдсан.' : 'Бүртгэлийн хугацаа дууссан.';
    if (saved) {
      return (
        <RegisteredSummary
          events={events}
          saved={saved}
          fee={savedFee}
          status={status}
          statusNote={registration?.statusNote ?? null}
          footer={
            <div className="oc-rp-foot">
              <p className="oc-rp-muted">{closedLine} Сонголтоо өөрчлөх боломжгүй.</p>
            </div>
          }
        />
      );
    }
    return (
      <div className="oc-rp oc-rp-message">
        <p className="oc-rp-title">Бүртгэл хаагдсан</p>
        <p className="oc-rp-body">{closedLine}</p>
      </div>
    );
  }

  if (state === 'idle') {
    return (
      <div className="oc-rp oc-rp-intro">
        <div>
          <p className="oc-rp-body">Бүртгүүлснээр тухайн төрлүүдийн раунд эхлэх үед камерын урсгал танд нээгдэнэ.</p>
          {authError && <p className="oc-rp-error">{authError}</p>}
        </div>
        <button type="button" className="oc-rp-submit" disabled={checkingProfile} onClick={handleRegisterClick}>
          {checkingProfile ? 'ШАЛГАЖ БАЙНА...' : 'БҮРТГҮҮЛЭХ'}
        </button>
      </div>
    );
  }

  if (state === 'gated' && gate) {
    const copy = profileGateCopy(gate.status, gate.reason);
    return (
      <div className="oc-rp oc-rp-message">
        <p className="oc-rp-title oc-rp-title-warn">{copy.title}</p>
        <p className="oc-rp-body">{copy.body}</p>
        {copy.action && (
          <Link href="/online-competition/profile" className="oc-rp-submit" style={{ alignSelf: 'flex-start' }}>
            {copy.action}
          </Link>
        )}
      </div>
    );
  }

  if (state === 'picking') {
    const editing = saved !== null;
    return (
      <div className="oc-rp">
        <div className="oc-rp-head">
          <span className="oc-rp-label">ЯМАР ТӨРӨЛД ОРОХ</span>
          <span className="oc-rp-count">{selected.size} сонгогдсон</span>
        </div>

        <div className="oc-rp-list">
          {events.map((e) => {
            const checked = selected.has(e.eventId);
            return (
              // A <label> around a real checkbox: the whole row is the hit
              // target, and a screen reader hears "3x3x3, checkbox,
              // checked" rather than an unlabelled button.
              <label key={e.eventId} className={`oc-rp-row${checked ? ' oc-rp-row-on' : ''}`}>
                <input
                  type="checkbox"
                  className="oc-rp-input"
                  checked={checked}
                  onChange={() => toggle(e.eventId)}
                />
                <span className="oc-rp-box" aria-hidden>
                  {checked && (
                    <svg viewBox="0 0 12 12" width="12" height="12">
                      <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="#08080A" strokeWidth="2" />
                    </svg>
                  )}
                </span>
                <span className="oc-v3-ev-icon" aria-hidden>
                  {hasWcaEventIcon(e.eventId) ? <WcaEventIcon eventId={e.eventId} size={16} /> : e.eventId.slice(0, 4).toUpperCase()}
                </span>
                <span className="oc-rp-name">{e.label}</span>
                <span className="oc-rp-rounds">{e.rounds} раунд</span>
              </label>
            );
          })}
        </div>

        <div className="oc-rp-note">
          <label className="oc-rp-label" htmlFor="oc-rp-note">
            ТАЙЛБАР · СОНГОЛТТОЙ
          </label>
          <textarea
            id="oc-rp-note"
            className="oc-rp-textarea"
            rows={3}
            maxLength={REGISTRATION_NOTE_MAX}
            placeholder="Зохион байгуулагчид хүргэх тайлбар. Жишээ нь: хамт ирэх хүн, тусгай шаардлага, холбоо барих дугаар."
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, REGISTRATION_NOTE_MAX))}
          />
          <p className="oc-rp-hint">
            {note.length}/{REGISTRATION_NOTE_MAX} тэмдэгт · Зохион байгуулагч энэ тайлбарыг бүртгэлийн хуудсанд харна.
          </p>
        </div>

        <FeeBlock fee={fee} />

        {saveError && <p className="oc-rp-error" style={{ padding: '0 16px' }}>{saveError}</p>}

        <div className="oc-rp-foot">
          <div className="oc-rp-foot-left">
            {/* Editing an existing registration: its status sits beside the
                button, as in the mockup — changing events does not change
                it (an edit never writes the status). */}
            {editing && status && <RegistrationStatusBadge status={status} withDetail />}
            <p className="oc-rp-muted">Бүртгэл хаагдах хүртэл төрлөө сольж болно.</p>
          </div>
          <div className="oc-rp-actions">
            {/* Only when editing. A first-time athlete who changes their
                mind simply does not submit; an athlete editing a saved
                registration needs a way back to it without saving. */}
            {editing && (
              <button type="button" className="oc-rp-cancel" disabled={saving} onClick={handleCancel}>
                Болих
              </button>
            )}
            <button
              type="button"
              className="oc-rp-submit"
              disabled={selected.size === 0 || saving || (editing && !dirty)}
              onClick={handleConfirm}
            >
              {saving ? 'ИЛГЭЭЖ БАЙНА...' : editing ? 'ӨӨРЧЛӨЛТӨӨ ХАДГАЛАХ' : 'БҮРТГЭЛЭЭ ИЛГЭЭХ'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── summary: registered, and still open ──────────────────────────────
  if (!saved) return null;
  return (
    <RegisteredSummary
      events={events}
      saved={saved}
      fee={savedFee}
      status={status}
      statusNote={registration?.statusNote ?? null}
      footer={
        <div className="oc-rp-foot">
          <div className="oc-rp-foot-left">
            {status && <RegistrationStatusBadge status={status} withDetail />}
          </div>
          {/* Cancelled and rejected get no edit button. An edit never
              changes the status, so ticking different events would change
              nothing that matters while looking as if it did — the admin's
              note above says why, and what to do is to ask the organiser. */}
          {statusCopy?.canEdit !== false && (
            <button type="button" className="oc-rp-submit" onClick={startEdit}>
              БҮРТГЭЛЭЭ ЗАСАХ
            </button>
          )}
        </div>
      }
    />
  );
}

/** The fee for a selection. Nothing at all for a free competition. */
function FeeBlock({ fee }: { fee: ReturnType<typeof feeView> }) {
  if (!fee.show) return null;
  if (fee.totalMnt === null) {
    return (
      <div className="oc-rp-fee">
        <span className="oc-rp-label">ТӨЛӨХ ДҮН</span>
        <span className="oc-rp-muted">{fee.note}</span>
      </div>
    );
  }
  return (
    <div className="oc-rp-fee">
      <div className="oc-rp-fee-line">
        <span className="oc-rp-label">ТӨЛӨХ ДҮН</span>
        {/* aria-live: the total changes as boxes are ticked, and someone
            using a screen reader should hear the new amount. */}
        <span className="oc-rp-fee-total" aria-live="polite">
          {fee.total}
        </span>
      </div>
      <p className="oc-rp-hint">{fee.breakdown}</p>
    </div>
  );
}

/** What the athlete is registered for — shown when registration is open
 *  (with an edit button) and when it has closed (read-only). */
function RegisteredSummary({
  events,
  saved,
  fee,
  status,
  statusNote,
  footer,
}: {
  events: OnlineCompetition['events'];
  saved: Saved;
  fee: ReturnType<typeof feeView>;
  status: OnlineRegistrationStatus | null;
  statusNote: string | null;
  footer: React.ReactNode;
}) {
  const chosen = events.filter((e) => saved.events.has(e.eventId));
  const tone = status ? registrationStatusCopy(status).tone : 'muted';
  return (
    <div className="oc-rp">
      <div className="oc-rp-head">
        <span className="oc-rp-done">
          <span aria-hidden>✓</span> ТА БҮРТГҮҮЛСЭН
        </span>
        <span className="oc-rp-count">{chosen.length} төрөл</span>
      </div>
      {/* The organiser's note — "Төлбөр хүлээгдэж буй", "Мэдээлэл дутуу".
          First, above the events, because when there is one it is the
          thing the athlete most needs to read; edged in the status's own
          colour so it reads as belonging to that status. */}
      {statusNote && (
        <div className={`oc-rp-statusnote oc-rp-statusnote-${tone}`}>
          <span className="oc-rp-label">ЗОХИОН БАЙГУУЛАГЧААС</span>
          <p className="oc-rp-body oc-rp-note-text">{statusNote}</p>
        </div>
      )}
      <div className="oc-rp-list">
        {chosen.map((e) => (
          <div key={e.eventId} className="oc-rp-row oc-rp-row-static">
            <span className="oc-v3-ev-icon" aria-hidden>
              {hasWcaEventIcon(e.eventId) ? <WcaEventIcon eventId={e.eventId} size={16} /> : e.eventId.slice(0, 4).toUpperCase()}
            </span>
            <span className="oc-rp-name">{e.label}</span>
            <span className="oc-rp-rounds">{e.rounds} раунд</span>
          </div>
        ))}
      </div>
      {saved.note && (
        <div className="oc-rp-note">
          <span className="oc-rp-label">ТАЙЛБАР</span>
          <p className="oc-rp-body oc-rp-note-text">{saved.note}</p>
        </div>
      )}
      <FeeBlock fee={fee} />
      <p className="oc-rp-muted" style={{ padding: '14px 16px 0' }}>
        Раунд эхлэхэд{' '}
        <Link href="/online-competition/dashboard" className="oc-rp-link">
          «Миний тэмцээнүүд»
        </Link>{' '}
        дээр «Эхлүүлэх» товч нээгдэнэ.
      </p>
      {footer}
    </div>
  );
}
