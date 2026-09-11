'use client';

import { fmtCentiseconds } from '@/lib/online-competition/time-utils';

/** One attempt of the run as the between screen sees it. `state` is the
 *  attempt's filing state; `pending` means it has not been solved yet. */
export interface SlotRow {
  /** 1-based attempt number. */
  attempt: number;
  timeCs: number | null;
  isDnf: boolean;
  state: 'pending' | 'queued' | 'uploading' | 'retrying' | 'filed' | 'failed';
  uploadPercent: number;
}

/** The pause between attempts — and the only waiting screen the run has.
 *
 *  MERGED WITH FILING. Filing used to have a screen of its own that said
 *  "wait" and then moved on by itself; this one says the same thing while
 *  the athlete reads their own times and decides when to go again. Two
 *  waiting screens in a row was one too many, and the second of them took
 *  the decision away from the athlete.
 *
 *  IT DOES NOT BLOCK MID-RUN. An upload that is still running when the
 *  athlete presses on keeps running in the background — that is the whole
 *  point of filing each attempt as it is recorded, and a ~2MB clip
 *  normally lands inside the next attempt's ceremony anyway. Two things
 *  do block: a filing that has FAILED (the next attempt must not start on
 *  top of a hole in the attempt order) and the end of the run (the result
 *  is computed from attempts that are on the server). */
export default function BetweenStage({
  slots,
  nextAttempt,
  runComplete,
  filingFailed,
  unfiledCount,
  errorMessage,
  onNext,
  onRetry,
}: {
  slots: SlotRow[];
  /** 1-based attempt the button starts. Meaningless when runComplete. */
  nextAttempt: number;
  /** Every attempt of the run has been solved — the button leads to the
   *  result rather than to another attempt. */
  runComplete: boolean;
  /** A filing has stopped trying on its own and needs the athlete. */
  filingFailed: boolean;
  unfiledCount: number;
  errorMessage: string | null;
  onNext: () => void;
  onRetry: () => void;
}) {
  const inFlight = slots.find((s) => s.state === 'uploading' || s.state === 'retrying');
  const failedSlot = slots.find((s) => s.state === 'failed');
  const filedCount = slots.filter((s) => s.state === 'filed').length;
  const solved = slots.filter((s) => s.state !== 'pending').length;

  // THE BLOCKING VARIANT. Mid-run an upload runs behind the athlete; at
  // the end of the run it does not, because the summary's Ao5 and the
  // result written from it must describe attempts the server actually
  // has. This is the guarantee the old filing stage existed to give.
  const waitingToFinish = runComplete && unfiledCount > 0 && !filingFailed;
  const blocked = filingFailed || waitingToFinish;

  const title = runComplete
    ? `${slots.length} оролдлого дууслаа`
    : `${solved} / ${slots.length} оролдлого`;

  return (
    <div className="oc-solve-between">
      <span className="oc-solve-between-title">{title}</span>

      <div className="oc-solve-slots">
        {slots.map((s) => {
          const current = s.state === 'pending' && s.attempt === nextAttempt && !runComplete;
          const mark =
            s.state === 'filed'
              ? ' oc-solve-slot-mark-done'
              : s.state === 'failed'
                ? ' oc-solve-slot-mark-bad'
                : s.state === 'pending'
                  ? current
                    ? ' oc-solve-slot-mark-live'
                    : ''
                  : ' oc-solve-slot-mark-live';
          return (
            <div
              key={s.attempt}
              className={`oc-solve-slot${current ? ' oc-solve-slot-now' : ''}${
                s.state === 'failed' ? ' oc-solve-slot-bad' : ''
              }`}
            >
              <span className="oc-solve-slot-n">{s.attempt}</span>
              <span className="oc-solve-slot-time">
                {s.state === 'pending' ? '—' : s.isDnf || s.timeCs === null ? 'DNF' : fmtCentiseconds(s.timeCs)}
              </span>
              {/* Every card carries a word, so the row reads as five of
                  the same thing rather than five different cards. The
                  mockup's ИЛГЭЭГДЭЭГҮЙ is gone: in this platform a
                  recorded attempt IS submitted, the moment it is
                  recorded. */}
              <span className={`oc-solve-slot-word${s.state === 'failed' ? ' oc-solve-slot-word-bad' : ''}`}>
                {s.state === 'filed' && 'ХАДГАЛСАН'}
                {s.state === 'uploading' && `${s.uploadPercent}%`}
                {s.state === 'retrying' && 'ДАХИН'}
                {s.state === 'queued' && 'ЭЭЛЖИНД'}
                {s.state === 'failed' && 'АЛДАА'}
                {s.state === 'pending' && (current ? 'ОДОО' : 'ХҮЛЭЭГДЭЖ')}
              </span>
              <span className={`oc-solve-slot-mark${mark}`} aria-hidden />
            </div>
          );
        })}
      </div>

      <div className="oc-solve-between-status">
        <span
          className={`oc-solve-between-square${
            failedSlot ? ' oc-solve-between-square-bad' : inFlight ? '' : ' oc-solve-between-square-done'
          }`}
          aria-hidden
        />
        <span className="oc-solve-between-statustext">
          {failedSlot
            ? `${failedSlot.attempt}-Р ОРОЛДЛОГО · ХАДГАЛАГДСАНГҮЙ`
            : inFlight
              ? `${inFlight.attempt}-Р ОРОЛДЛОГО · ХАДГАЛЖ БАЙНА ${inFlight.uploadPercent}%`
              : `${filedCount} ОРОЛДЛОГО СЕРВЭРТ ХАДГАЛАГДСАН`}
        </span>
      </div>

      {errorMessage && <p className="oc-solve-between-error">{errorMessage}</p>}

      {/* The mockup said "leave now and the remaining attempts are void".
          They are not: each one is on the server as it is recorded and
          returning resumes at the next. Saying otherwise would keep an
          athlete solving on a dying battery. */}
      <span className="oc-solve-between-note">
        {filingFailed
          ? 'Энэ бичлэг сервэрт хүрээгүй тул дараагийн оролдлого эхлэхгүй. Холболтоо шалгаад дахин илгээнэ үү.'
          : waitingToFinish
            ? 'Сүүлийн бичлэгийг хадгалж дуустал хүлээнэ үү. Дүн нь хадгалагдсан оролдлогуудаас бодогдоно.'
            : runComplete
              ? 'Бүх оролдлого сервэрт хадгалагдсан. Дүнгээ хараад илгээнэ үү.'
              : `Хадгалагдсан оролдлогууд сервэрт үлдэнэ. Одоо завсарлавал буцаж ирээд ${nextAttempt}-р оролдлогоосоо үргэлжлүүлж болно.`}
      </span>

      <button
        type="button"
        className="oc-solve-between-go"
        disabled={waitingToFinish}
        onClick={filingFailed ? onRetry : onNext}
      >
        {filingFailed
          ? 'Дахин илгээх'
          : waitingToFinish
            ? 'Хадгалж байна...'
            : runComplete
              ? 'Дүнг үзэх'
              : `${nextAttempt}-р оролдлогыг эхлэх`}
      </button>

      {blocked && filingFailed && (
        <span className="oc-solve-between-note">Дахин оролдсоор байвал зохион байгуулагчид хандана уу.</span>
      )}
    </div>
  );
}
