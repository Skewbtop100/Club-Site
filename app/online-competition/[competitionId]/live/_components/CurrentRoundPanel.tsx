'use client';

import { useEffect, useState } from 'react';
import { formatLabel } from '@/lib/online-competition/ao5';
import { opensInLabel } from '@/lib/online-competition/registration-view';
import type {
  AttemptSlot,
  IdleReason,
  LiveEventView,
  LiveRoundView,
  NextRound,
} from '@/lib/online-competition/live-view';
import {
  DashedBox,
  DoneBox,
  EventGlyph,
  HEAD,
  LockedBox,
  MONO,
  OutlineButton,
  OutlineLink,
  StartButton,
  bodyTextStyle,
  fmtResult,
  panelLabelStyle,
  solveHref,
} from './ui';

export const CURRENT_PANEL_ID = 'oc-live-current';

function fmtStart(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The round the athlete can solve now: their attempt slots and the way
 *  into the next one. With no such round, the reason there is none. */
export default function CurrentRoundPanel({
  competitionId,
  event,
  round,
  state,
  idle,
  next,
  gate,
  startAtMs,
  detailsHref,
  onSignIn,
}: {
  competitionId: string;
  event: LiveEventView | null;
  round: LiveRoundView | null;
  /** open — attempts left; open-done — every attempt filed. */
  state: 'open' | 'open-done' | null;
  /** Why there is no current round. Read only when `state` is null. */
  idle: IdleReason | null;
  /** The round the athlete takes part in next, while none is open to them
   *  (live-view.ts pickNextRound). Read only when `state` is null. */
  next: NextRound | null;
  gate: { label: string; message: string } | null;
  startAtMs: number | null;
  detailsHref: string;
  onSignIn: () => void;
}) {
  const active = state !== null && event !== null && round !== null;
  const slots: AttemptSlot[] = active
    ? event.me?.slotsByRound[String(round.round)] ??
      Array.from({ length: event.attempts }, (_, i) => ({ attempt: i + 1, state: 'empty' as const, timeCs: null }))
    : [];
  const filed = slots.filter((s) => s.state !== 'empty').length;
  const nextAttempt = active && state === 'open' ? event.me?.nextAttempt ?? null : null;

  return (
    <section id={CURRENT_PANEL_ID} style={{ border: `1px solid ${active ? '#DFFF4F' : '#1C1C21'}`, background: '#0D0D10' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '15px 18px',
          borderBottom: '1px solid #1C1C21',
        }}
      >
        {active ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <EventGlyph eventId={event.eventId} size={20} color="#DFFF4F" />
              <span style={{ font: `600 15px/1.2 ${HEAD}`, color: '#F4F1EA' }}>
                {event.label} · {round.label}
              </span>
            </div>
            <span style={{ font: `400 10px/1 ${MONO}`, color: '#6E6A62' }}>
              {formatLabel(event.format)} · {filed} / {event.attempts} илгээсэн
            </span>
          </>
        ) : (
          <span style={panelLabelStyle}>{next ? 'ДАРААГИЙН РАУНД' : 'ОДООГИЙН РАУНД'}</span>
        )}
      </div>

      {active && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${event.attempts}, minmax(0, 1fr))`,
            gap: 1,
            background: '#1C1C21',
          }}
        >
          {slots.map((s) => (
            <Slot key={s.attempt} slot={s} next={s.attempt === nextAttempt} />
          ))}
        </div>
      )}

      <div
        style={{
          padding: '16px 18px',
          borderTop: active ? '1px solid #1C1C21' : undefined,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {active ? (
          state === 'open' ? (
            <StartButton
              href={solveHref(competitionId, event.eventId)}
              label={event.me?.planKind === 'resume' && nextAttempt ? `${nextAttempt}-р оролдлого эхлэх` : 'Эвлүүлэлтээ эхлэх'}
            />
          ) : (
            <>
              <DoneBox label="ДУУССАН" />
              <p style={bodyTextStyle}>
                {slots.some((s) => s.state === 'submitted')
                  ? 'Бүх оролдлого илгээгдсэн. Шүүгч баталсан оролдлого л цаг болж харагдана.'
                  : 'Энэ раундын бүх оролдлого шүүгдсэн.'}
              </p>
            </>
          )
        ) : next ? (
          <NextRoundBox next={next} idle={idle} startAtMs={startAtMs} />
        ) : (
          <IdleFooter idle={idle} gate={gate} startAtMs={startAtMs} detailsHref={detailsHref} onSignIn={onSignIn} />
        )}
      </div>
    </section>
  );
}

function Slot({ slot, next }: { slot: AttemptSlot; next: boolean }) {
  return (
    <div
      style={{
        background: '#0D0D10',
        borderTop: `2px solid ${next ? '#DFFF4F' : '#1C1C21'}`,
        padding: '14px 4px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
      }}
    >
      <span style={{ font: `500 8px/1 ${MONO}`, letterSpacing: '.16em', color: '#6E6A62' }}>
        {String(slot.attempt).padStart(2, '0')}
      </span>
      {slot.state === 'submitted' ? (
        // SUBMITTED, NOT A TIME. The slot carries no number to show — the
        // route never sends an unjudged attempt's time.
        <span
          title="Шүүгч хянаж байна"
          style={{
            font: `600 8px/15px ${MONO}`,
            letterSpacing: '.06em',
            color: '#E0A020',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          ИЛГЭЭСЭН
        </span>
      ) : (
        <span
          className="oc-live-slot-time"
          style={{ color: slot.state === 'dnf' ? '#E8543C' : slot.state === 'time' ? '#F4F1EA' : '#3A3A42' }}
        >
          {slot.state === 'dnf' ? 'DNF' : fmtResult(slot.timeCs)}
        </span>
      )}
    </div>
  );
}

/** The athlete's next round, while no round is open to them.
 *
 *  DISPLAY ONLY: no link and no button. A round is started from the active
 *  panel, which appears only once the round-access gate admits them.
 *
 *  The countdown runs to the PROGRAMME's time for the round (the route's
 *  scheduledAtMs), updating every second like the registration countdown.
 *  The organiser opens rounds by hand, so reaching zero opens nothing — the
 *  box then says the scheduled time has come and the organiser will open
 *  it. With no programme time, it says the organiser has not opened it. */
function NextRoundBox({ next, idle, startAtMs }: { next: NextRound; idle: IdleReason | null; startAtMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  const at = next.scheduledAtMs;
  const counting = at !== null && now < at;

  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [counting]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        <EventGlyph eventId={next.eventId} size={20} color="#F4F1EA" />
        <span style={{ font: `600 15px/1.2 ${HEAD}`, color: '#F4F1EA' }}>
          {next.eventLabel} · {next.roundLabel}
        </span>
      </div>
      {at === null ? (
        <>
          <DashedBox label="РАУНД НЭЭГДЭЭГҮЙ" note="Зохион байгуулагч энэ раундыг хараахан нээгээгүй байна." />
          {/* What this panel said before the next round was shown: kept,
              since the competition's start is still worth knowing. */}
          {idle === 'not-started' && startAtMs !== null && <LockedBox label="ТЭМЦЭЭН ЭХЛЭХ" value={fmtStart(startAtMs)} />}
        </>
      ) : counting ? (
        <>
          <LockedBox label="ХУВААРИЙН ДАГУУ НЭЭГДЭХЭД" value={opensInLabel(at - now)} />
          <p style={bodyTextStyle}>
            Хуваарьт {fmtStart(at)}-д. Раундыг зохион байгуулагч нээнэ — нээгдмэгц энд эхлэх товч гарна.
          </p>
        </>
      ) : (
        <DashedBox
          label="ХУВААРИЙН ЦАГ БОЛСОН"
          note={`Хуваарьт ${fmtStart(at)}-д. Зохион байгуулагч раундыг нээхэд энд эхлэх товч гарна.`}
        />
      )}
    </>
  );
}

function IdleFooter({
  idle,
  gate,
  startAtMs,
  detailsHref,
  onSignIn,
}: {
  idle: IdleReason | null;
  gate: { label: string; message: string } | null;
  startAtMs: number | null;
  detailsHref: string;
  onSignIn: () => void;
}) {
  switch (idle) {
    case 'finished':
      return (
        <>
          <DoneBox label="ТЭМЦЭЭН ДУУССАН" />
          <p style={bodyTextStyle}>Шүүгдсэн дүнг ШУУД ҮЗҮҮЛЭЛТ хэсгээс харна уу.</p>
        </>
      );
    case 'signed-out':
      return (
        <>
          <p style={bodyTextStyle}>Өөрийн оролдлого, дүнгээ харахын тулд нэвтэрнэ үү.</p>
          <OutlineButton label="Нэвтрэх" onClick={onSignIn} />
        </>
      );
    case 'not-registered':
      return (
        <>
          <p style={bodyTextStyle}>Та энэ тэмцээнд бүртгүүлээгүй байна.</p>
          <OutlineLink label="Тэмцээний мэдээлэл" href={detailsHref} />
        </>
      );
    case 'gate':
      return <DashedBox label={gate?.label ?? 'БҮРТГЭЛ'} note={gate?.message} />;
    case 'not-qualified':
      return <DashedBox label="ШАЛГАРААГҮЙ" note="Та нээлттэй раундад шалгараагүй байна." />;
    case 'not-started':
      return startAtMs !== null ? (
        <LockedBox label="ЭХЛЭХ" value={fmtStart(startAtMs)} />
      ) : (
        <DashedBox label="РАУНД НЭЭГДЭЭГҮЙ" note="Зохион байгуулагч раунд нээхэд энд идэвхжинэ." />
      );
    // THE ROUND IS OVER — its cut is committed, so it is not reopening and
    // the athlete's result stands. This used to share the wording below,
    // which told an athlete whose round had finished to wait for the
    // organiser to open it.
    case 'round-finished':
      return (
        <>
          <DoneBox label="РАУНД ДУУССАН" />
          <p style={bodyTextStyle}>
            Таны оролдлого хүлээн авагдсан. Шүүгдсэн дүнг ШУУД ҮЗҮҮЛЭЛТ хэсгээс харна уу.
          </p>
        </>
      );
    // NOT ACCEPTING RIGHT NOW — closed between rounds, or closed by the
    // organiser to sort something out. It may open again, so this one does
    // point at them.
    default:
      return (
        <DashedBox
          label="РАУНД ОДООГООР ХААЛТТАЙ"
          note="Одоогоор шинэ оролдлого хийх боломжгүй. Зохион байгуулагч раунд нээхэд энд идэвхжинэ."
        />
      );
  }
}
