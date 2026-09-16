'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { authedFetchWithRetry } from '@/lib/online-competition/authed-fetch';
import { resolveVideoSrc } from '@/lib/online-competition/video-source';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { PRACTICE_RUN_LIMIT } from '@/lib/online-competition/practice';
import { PROFILE_HREF } from '@/lib/online-competition/verification';
import { STATUS_TONE_COLOR, verificationNoticeCopy } from '@/lib/online-competition/registration-view';
import type { PracticeListResponse } from '@/app/api/online-competition/practice/route';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import HubNav from '../_components/hub/v3/HubNav';
import AuthModal from '../_components/hub/v3/AuthModal';
import EmptyBlock from '../_components/hub/v3/EmptyBlock';

// ── ТУРШИЛТ: the athlete's own practice area ────────────────────────────
// Where an athlete goes to learn what a recorded solve asks of them,
// without a competition attached.
//
// FOUR THINGS, IN THIS ORDER: what is left of the ten, the tutorial, one
// button, and their own past runs.
//
// THE TUTORIAL SITS ABOVE THE BUTTON, and that is the one thing allowed to.
// An athlete who has never recorded a solve should meet it before they
// spend one of ten attempts finding out what it asks — after the button is
// too late. It earns the place by being ONE LINE: the two paragraphs that
// were once there explained a sequence the run itself then showed them,
// which is reading standing between the athlete and the action. A signpost
// is not an explanation. It carried a grid of ten event buttons and two
// paragraphs of explanation above that button, which put the reading
// between the athlete and the thing they came to do — and the explanation
// was describing a sequence that the run itself then shows them anyway.
//
// 3x3x3 ONLY. The sequence being practised is the same whatever is in the
// athlete's hands; ten buttons offered a choice that changes nothing about
// what is being learned, and made the one button into a decision.
//
// THE RETENTION LINE MOVED rather than went — see the note on it below.
//
// ── WHO MAY PRACTISE: a verified athlete, and nobody else ──
// Five states, each said in its own words with a way onward:
//   signed out          — sign in (the AuthModal, as before);
//   verified            — the page as it was;
//   never submitted,
//   awaiting review,
//   rejected + reason   — verificationNoticeCopy, THE SAME FUNCTION the
//                         standing notice on every hub page renders, so an
//                         athlete blocked from registering and from
//                         practising reads one sentence in both places. Each
//                         links to the profile, which is the only place any
//                         of the three can be changed.
//
// THE GATE IS THE SERVER'S ANSWER (PracticeListResponse.gate), not this
// page's reading of its own copy of the profile: the auth context's
// participant is null both while loading and when its read failed, and the
// page must never mistake either for an answer. The filing route and the
// presign route check the same thing again and are what actually refuse.
//
// HubNav's own notice is suppressed here: this page carries the same
// sentence in the place the start button would be, and saying it twice on
// one screen reads as two problems.
//
// The allowance is READ FROM THE SERVER, never computed here. It is counted
// from the documents (practiceAllowance) because a counter an athlete could
// write would not be a limit; this page just renders the answer.

/** 3x3x3, and only 3x3x3. The sequence being practised does not change
 *  with the puzzle, so offering ten made the one button a decision about
 *  something that does not matter. */
const PRACTICE_EVENT = '333';

/** The tutorial, as a LINK to YouTube rather than an embedded player.
 *
 *  WHY NOT EMBEDDED, given this project already embeds YouTube elsewhere
 *  (DetailTabs, through videoEmbedUrl): that iframe belongs on a page a
 *  visitor is reading. This one would sit immediately above the only button
 *  on the page, which is the one place an embed costs the most:
 *
 *    · the player is fetched on EVERY visit, for something most athletes
 *      watch once. `loading="lazy"` — which the detail page's iframe does
 *      use — buys nothing here, because "above the start button" is inside
 *      the first viewport by definition, and lazy only defers what is not;
 *    · it owns the space permanently. A 16:9 player is about 190px tall on
 *      a 360px phone, which pushes the button this page exists for below
 *      the fold for everyone who has already watched it;
 *    · this card was stripped to an allowance and one button precisely so
 *      nothing stood between the athlete and the action.
 *
 *  A new tab is what makes the link safe mid-flow: the practice page stays
 *  open behind it, so watching costs nobody their place. If on-page
 *  playback is wanted later, the only acceptable form is a facade — a
 *  button that injects the iframe when tapped — which costs nothing on load
 *  but still owns the space; see the report on this changeset. */
const TUTORIAL_URL = 'https://youtu.be/IpWaBT1hPb0';

const STATUS_LABEL: Record<string, string> = {
  pending: 'ХЯНАГДАЖ БАЙНА',
  correct: 'ЗӨВ',
  incorrect: 'БУРУУ',
  redo: 'ДАХИН ИЛГЭЭХ',
};
const STATUS_TONE: Record<string, string> = {
  pending: '#DFFF4F',
  correct: '#4FD07A',
  incorrect: '#E8543C',
  redo: '#E0A020',
};

function fmtDay(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function PracticePage() {
  const { user, loading: authLoading } = useOnlineAuth();
  const signedIn = !!user && !user.isAnonymous;
  const [authOpen, setAuthOpen] = useState(false);
  const [data, setData] = useState<PracticeListResponse | null>(null);
  const [error, setError] = useState('');
  /** Which run's recording is open. One at a time: these are whole video
   *  files and mounting ten players would fetch ten of them. */
  const [playing, setPlaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await authedFetchWithRetry('/api/online-competition/practice');
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as PracticeListResponse);
    } catch (err) {
      console.error('PracticePage: loading practice runs failed:', err);
      setError('Туршилтын бичлэгүүдийг ачааллаж чадсангүй');
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setData(null);
      return;
    }
    void load();
  }, [signedIn, load]);

  return (
    <div className="oc-v3-page">
      <HubNav live={null} section={null} suppressVerificationNotice />

      <main className="oc-v3-main">
        <div className="oc-v3-clist">

          {authLoading ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : !signedIn ? (
            <div className="oc-v3-card">
              <div className="oc-v3-empty">
                <p className="oc-v3-empty-text">Туршилтын бичлэг хийхийн тулд нэвтэрнэ үү.</p>
                <button type="button" className="oc-v3-signin" onClick={() => setAuthOpen(true)}>
                  Нэвтрэх
                </button>
              </div>
              <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
            </div>
          ) : error ? (
            <p className="oc-v3-status oc-v3-status-error">{error}</p>
          ) : data === null ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : (
            <>
              {!data.gate.allowed ? (
                /* ── NOT VERIFIED: what is wrong, and where to fix it ──
                   In place of the allowance and the button, not above them:
                   there is nothing to start, and a disabled button beside
                   an explanation reads as a fault in the button. */
                (() => {
                  const gate = data.gate;
                  const copy = verificationNoticeCopy(gate.status, gate.reason);
                  const tone =
                    gate.status === 'rejected'
                      ? STATUS_TONE_COLOR.red
                      : gate.status === 'pending'
                        ? STATUS_TONE_COLOR.muted
                        : '#DFFF4F';
                  return (
                    <div className="oc-v3-card">
                      <div className="oc-v3-card-head">
                        <span className="oc-v3-label">Туршилтын бичлэг</span>
                      </div>
                      <div className="oc-v3-vnotice" role="status" style={{ border: 'none', margin: 0 }}>
                        <span className="oc-v3-vnotice-label" style={{ color: tone, borderColor: tone }}>
                          {copy.label}
                        </span>
                        <p className="oc-v3-vnotice-body">{copy.body}</p>
                        <Link href={PROFILE_HREF} className="oc-v3-vnotice-action">
                          {copy.action}
                        </Link>
                      </div>
                    </div>
                  );
                })()
              ) : (
              /* ── THE ALLOWANCE, AND ONE BUTTON ── */
              <div className="oc-v3-card">
                <div className="oc-v3-card-head">
                  <span className="oc-v3-label">Туршилтын бичлэг</span>
                  {/* Always visible, including before any run has been
                      used, so the limit is known in advance rather than
                      discovered at the tenth. */}
                  <span className="oc-v3-season" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {data.remaining} / {data.limit} ҮЛДСЭН
                  </span>
                </div>
                {/* ── THE TUTORIAL ──
                    Outside the allowance branch, so it is there at zero
                    remaining too: an athlete who has used all ten may still
                    want to see how it was supposed to go. */}
                <div className="oc-practice-tutorial">
                  <a
                    className="oc-practice-tutorial-link"
                    href={TUTORIAL_URL}
                    /* A NEW TAB, so this page keeps its place — and the
                       pair rel needs whenever it opens one. */
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span aria-hidden>▶</span>
                    Заавар видео үзэх
                    {/* Where it goes and that it leaves, said before the
                        tap rather than discovered by it. */}
                    <span className="oc-practice-tutorial-where">YouTube · шинэ цонх</span>
                  </a>
                  {/* Only for an athlete who has not recorded anything yet
                      — the one person for whom this is advice rather than a
                      reference. */}
                  {data.runs.length === 0 && (
                    <p className="oc-practice-tutorial-note">
                      Эхлэхээсээ өмнө нэг үзээрэй — бичлэгтэй эвлүүлэлт хэрхэн явагддагийг харуулна.
                    </p>
                  )}
                </div>

                {data.remaining === 0 ? (
                  /* SAID PLAINLY, not hidden. A missing button is the thing
                     this whole feature exists to stop an athlete meeting. */
                  <div style={{ padding: '15px 18px' }}>
                    <p style={{ font: '500 12px var(--oc-font-heading), sans-serif', color: '#E8543C' }}>
                      Туршилтын {PRACTICE_RUN_LIMIT} бичлэг бүгд ашиглагдсан.
                    </p>
                    <p style={{ marginTop: 6, font: '400 11px/17px var(--oc-font-heading), sans-serif', color: '#6E6A62' }}>
                      Доорх бичлэгүүдээ дахин үзэж болно. Нэмэлт бичлэг хэрэгтэй бол зохион байгуулагчтай
                      холбогдоно уу.
                    </p>
                  </div>
                ) : (
                  <div className="oc-practice-start">
                    <Link href={`/online-competition/practice/${PRACTICE_EVENT}`} className="oc-practice-start-btn">
                      <span className="oc-practice-start-icon" aria-hidden>
                        {hasWcaEventIcon(PRACTICE_EVENT) ? (
                          <WcaEventIcon eventId={PRACTICE_EVENT} size={20} />
                        ) : (
                          PRACTICE_EVENT.toUpperCase()
                        )}
                      </span>
                      3x3x3 ТУРШИЛТ ХИЙХ
                    </Link>
                  </div>
                )}
              </div>
              )}

              {/* ── THEIR OWN RUNS ──
                  Still listed for an athlete who is no longer allowed to
                  record — they are the athlete's own, and hiding them would
                  read as deletion. Only an unverified athlete with NO runs
                  skips the card: an empty list under a refusal is noise. */}
              {(data.gate.allowed || data.runs.length > 0) && (
              <div className="oc-v3-card">
                <div className="oc-v3-card-head">
                  <span className="oc-v3-label">Миний туршилтууд</span>
                  <span className="oc-v3-count-badge">{data.runs.length}</span>
                </div>
                {/* ── THE RETENTION LINE, AND WHY IT IS HERE ──
                    It was two lines above the start button, where it was
                    reading an athlete had to get past to do the thing they
                    came for — and it describes something that has not
                    happened yet at that point. Here it sits over the list
                    of recordings it is actually about, so an athlete
                    reading "устна" is looking at the thing that will go.
                    Each row also carries its own expiry date, so the rule
                    is stated once and the date is per recording. */}
                {data.runs.length > 0 && (
                  <p className="oc-practice-retention">
                    Бичлэг шалгагдсанаас 7 хоногийн дараа, шалгагдаагүй бол хийснээс 30 хоногийн дараа
                    автоматаар устна.
                  </p>
                )}

                {data.runs.length === 0 ? (
                  <EmptyBlock text="Одоогоор туршилтын бичлэг алга." />
                ) : (
                  data.runs.map((r) => {
                    const src = resolveVideoSrc({ videoKey: r.videoKey });
                    const open = playing === r.id;
                    return (
                      <div key={r.id} className="oc-practice-row">
                        {/* THREE THINGS: the time, the status, the
                            recording. The event chip went — this page
                            starts 3x3x3 runs and nothing else, so it said
                            the same word on every row — and so did the
                            per-row expiry date, which repeated the rule
                            stated once above the list. The date stays as
                            the quietest thing in the row: it is the only
                            way to tell two runs of a similar time apart. */}
                        <div className="oc-practice-row-head">
                          <span className="oc-practice-row-time">
                            {r.isDnf ? 'DNF' : r.timeCs !== null ? fmtCentiseconds(r.timeCs) : 'цаг бичээгүй'}
                          </span>
                          <span className="oc-practice-row-date">{fmtDay(r.createdAtMs)}</span>
                          <span style={{ flex: 1 }} />
                          <span
                            className="oc-practice-row-status"
                            style={{ color: STATUS_TONE[r.status] ?? '#9A958A' }}
                          >
                            {STATUS_LABEL[r.status] ?? r.status.toUpperCase()}
                          </span>
                        </div>

                        {/* THE REASON, when there is one. The athlete cannot
                            fix what they are not told. */}
                        {r.status === 'incorrect' && r.reason && (
                          <p className="oc-practice-row-reason">{r.reason}</p>
                        )}
                        {r.status === 'redo' && (
                          <p className="oc-practice-row-reason">
                            Админ дахин бичлэг хийхийг хүссэн. Энэ бичлэг таны 10-д тооцогдохгүй.
                          </p>
                        )}

                        <div className="oc-practice-row-foot">
                          {src === null ? (
                            <span className="oc-practice-row-gone">Бичлэг устсан</span>
                          ) : (
                            <button
                              type="button"
                              className="oc-practice-watch"
                              aria-expanded={open}
                              onClick={() => setPlaying(open ? null : r.id)}
                            >
                              {open ? 'ХААХ' : 'БИЧЛЭГ ҮЗЭХ'}
                            </button>
                          )}
                        </div>

                        {/* Mounted only when opened — one video file at a
                            time, not ten. */}
                        {open && src !== null && (
                          <video
                            className="oc-practice-video"
                            src={src}
                            controls
                            playsInline
                            preload="metadata"
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
