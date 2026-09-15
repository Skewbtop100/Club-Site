'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchCompetition } from '@/lib/online-competition/data';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { authedFetchWithRetry } from '@/lib/online-competition/authed-fetch';
import { competeGateCopy } from '@/lib/online-competition/registration-view';
import {
  defaultStandingsTarget,
  fmtScheduledClock,
  idleReason,
  meContextFor,
  ownRoundStats,
  pickCurrentRound,
  pickNextRound,
  roundRowState,
  roundsReached,
  statsRound,
  type LiveViewPayload,
  type RoundRef,
} from '@/lib/online-competition/live-view';
import HubNav from '../../_components/hub/v3/HubNav';
import AuthModal from '../../_components/hub/v3/AuthModal';
import { toMillisOrNull } from '../../_components/hub/format';
import LiveStats from './_components/LiveStats';
import CurrentRoundPanel, { CURRENT_PANEL_ID } from './_components/CurrentRoundPanel';
import SchedulePanel, { type ScheduleItem } from './_components/SchedulePanel';
import StandingsPanel from './_components/StandingsPanel';

// ── The athlete's live competition view ─────────────────────────────────
// Where an athlete lands on a live competition. The solve flow is reached
// from the start buttons here; nothing on this page writes anything.
//
// Data: the competition document (start time, and the nav's live tab)
// through the same client reader the details page uses; everything else
// from the live route, which is read-only and does its reads with the
// Admin SDK.

/** Below 900px the two columns become these two tabs; above it both are
 *  shown side by side and this value has no visible effect. */
type LiveTab = 'attempts' | 'standings';

function Shell({ competition, children }: { competition: OnlineCompetition | null; children: React.ReactNode }) {
  return (
    <div className="oc-v3-page">
      <HubNav live={competition?.status === 'live' ? competition : null} active="competitions" section="attempts" />
      {children}
    </div>
  );
}

export default function LiveCompetitionPage() {
  const params = useParams<{ competitionId: string }>();
  const competitionId = params.competitionId;
  const detailsHref = `/online-competition/${competitionId}/details`;

  const { user, loading: authLoading } = useOnlineAuth();
  const uid = user && !user.isAnonymous ? user.uid : null;

  const [competition, setCompetition] = useState<OnlineCompetition | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<LiveViewPayload | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  /** The event the athlete picked from the schedule, if any. */
  const [selected, setSelected] = useState<string | null>(null);
  const [standingsTarget, setStandingsTarget] = useState<RoundRef | null>(null);
  // TAB STATE LIVES HERE, in the page, beside the other view state — not in
  // a child that mounts with the data. A refresh replaces `view` with the
  // new payload but never clears it, and nothing above this line is keyed
  // on `version`, so a re-read (the ШИНЭЧЛЭХ button, coming back to the
  // tab, signing in) re-renders the tabs without resetting them. Only a
  // fresh navigation to the page starts again on ОРОЛДЛОГО.
  const [tab, setTab] = useState<LiveTab>('attempts');
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCompetition(competitionId)
      .then((c) => {
        if (cancelled) return;
        if (!c) setNotFound(true);
        else setCompetition(c);
      })
      .catch((err) => {
        console.error('LiveCompetitionPage: loading the competition failed:', err);
        if (!cancelled) setLoadError('Тэмцээний мэдээллийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId]);

  // Waits for auth to settle, so a signed-in athlete is never shown the
  // signed-out view first.
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    setRefreshing(true);
    const url = `/api/online-competition/competitions/${encodeURIComponent(competitionId)}/live`;
    (uid ? authedFetchWithRetry(url) : fetch(url))
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        if (!r.ok) throw new Error(`live view ${r.status}`);
        return (await r.json()) as LiveViewPayload;
      })
      .then((d) => {
        if (cancelled || !d) return;
        setView(d);
        setViewFailed(false);
      })
      .catch((err) => {
        console.error('LiveCompetitionPage: loading the live view failed:', err);
        if (!cancelled) setViewFailed(true);
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId, uid, authLoading, version]);

  // Re-read on coming back to the tab — including coming back from the
  // solve flow — rather than polling: every read of this route scans the
  // competition's judged submissions.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setVersion((v) => v + 1);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const derived = useMemo(() => {
    if (!view) return null;
    const competitionStartMs = toMillisOrNull(competition?.startAt);

    // The athlete's pick wins while it is still a round they can act on.
    let current: RoundRef | null = null;
    if (selected) {
      const e = view.events.find((x) => x.eventId === selected);
      const me = e ? meContextFor(view, e) : null;
      const r = e?.rounds.find((x) => {
        const s = roundRowState(x, me);
        return s === 'open' || s === 'open-done';
      });
      if (e && r) current = { eventId: e.eventId, round: r.round };
    }
    current = current ?? pickCurrentRound(view);

    const currentEvent = current ? view.events.find((e) => e.eventId === current!.eventId) ?? null : null;
    const currentRound = currentEvent?.rounds.find((r) => r.round === current!.round) ?? null;
    const rawState = currentEvent && currentRound ? roundRowState(currentRound, meContextFor(view, currentEvent)) : null;
    const currentState = rawState === 'open' || rawState === 'open-done' ? rawState : null;

    const statsRef = statsRound(view, current);
    let stats = null;
    if (statsRef) {
      const e = view.events.find((x) => x.eventId === statsRef.eventId);
      const r = e?.rounds.find((x) => x.round === statsRef.round);
      if (e && r) stats = ownRoundStats(e.me?.slotsByRound[String(r.round)] ?? [], r.standings, e);
    }

    const gate = view.registration ? competeGateCopy(view.registration.status) : null;
    // THE ATHLETE'S OWN SCHEDULE: only events they registered for, and in
    // each only the rounds they have reached (roundsReached). A round they
    // did not qualify for is not listed at all.
    const scheduleItems: ScheduleItem[] = view.events.flatMap((e) => {
      const me = meContextFor(view, e);
      return roundsReached(e)
        .filter((r) => !(current && current.eventId === e.eventId && current.round === r.round))
        .map((r) => ({
          key: `${e.eventId}_${r.round}`,
          eventId: e.eventId,
          label: `${e.label} · ${r.label}`,
          round: r.round,
          status: r.status,
          // Formatted HERE, in the athlete's timezone, from the instant —
          // the route's own "13:00" is in the server's.
          scheduledAt: r.scheduledAtMs != null ? fmtScheduledClock(r.scheduledAtMs, competitionStartMs) : r.scheduledAt,
          qualified: r.qualified,
          state: roundRowState(r, me),
          // Every listed round is the athlete's own event, so the only thing
          // that can keep them out of an open one is the registration review.
          viewNote: gate ? gate.label : 'ТАНЫ РАУНД БИШ',
        }));
    });

    // An approved athlete's ADDED events still waiting for the admin: listed
    // so the athlete sees them, never startable. They are not in the
    // registration's `events`, so the gate refuses them and nothing above
    // counts them; these rows carry no button (SchedulePanel `requested`).
    const requestedItems: ScheduleItem[] =
      view.registration?.status === 'approved'
        ? view.events
            .filter((e) => (view.registration?.requestedEvents ?? []).includes(e.eventId))
            .map((e) => ({
              key: `${e.eventId}_requested`,
              eventId: e.eventId,
              label: e.label,
              round: 1,
              status: 'closed' as const,
              scheduledAt: null,
              qualified: null,
              state: 'notopen' as const,
              viewNote: '',
              requested: true,
            }))
        : [];

    const idle = currentState ? null : idleReason(view);
    return {
      currentEvent,
      currentRound,
      currentState,
      stats,
      gate,
      scheduleItems: [...scheduleItems, ...requestedItems],
      idle,
      // Before a round opens: the athlete's next round, only for the two
      // "waiting" reasons. Every other idle reason (finished, signed out,
      // not registered, under review, missed the cut) keeps its own message.
      next: idle === 'not-started' || idle === 'no-open-round' ? pickNextRound(view) : null,
      defaultTarget: defaultStandingsTarget(view, statsRef),
    };
  }, [view, selected, competition]);

  const selectRound = useCallback((eventId: string) => {
    setSelected(eventId);
    document.getElementById(CURRENT_PANEL_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (loadError) {
    return (
      <Shell competition={null}>
        <p className="oc-v3-status oc-v3-status-error">{loadError}</p>
      </Shell>
    );
  }
  if (notFound) {
    return (
      <Shell competition={null}>
        <p className="oc-v3-status">Тэмцээн олдсонгүй.</p>
      </Shell>
    );
  }
  if (!competition) {
    return (
      <Shell competition={null}>
        <p className="oc-v3-status">Ачааллаж байна...</p>
      </Shell>
    );
  }

  const startAtMs = toMillisOrNull(competition.startAt);

  const target =
    view &&
    standingsTarget &&
    view.events.some((e) => e.eventId === standingsTarget.eventId && e.rounds.some((r) => r.round === standingsTarget.round))
      ? standingsTarget
      : derived?.defaultTarget ?? null;

  return (
    <Shell competition={competition}>
      <main className="oc-v3-main">
        {!view || !derived ? (
          viewFailed ? (
            <p className="oc-v3-status oc-v3-status-error">
              Шууд мэдээллийг ачааллаж чадсангүй.{' '}
              <button
                type="button"
                onClick={refresh}
                style={{ border: 'none', background: 'transparent', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
              >
                Дахин оролдох
              </button>
            </p>
          ) : (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Hidden above 900px, where both columns are on screen. */}
            <div className="oc-live-tabs oc-cd-tabs" role="tablist" aria-label="Шууд үзүүлэлт">
              <LiveTabButton id="attempts" label="ОРОЛДЛОГО" tab={tab} onSelect={setTab} />
              <LiveTabButton id="standings" label="ҮЗҮҮЛЭЛТ" tab={tab} onSelect={setTab} />
            </div>

            <div className="oc-live-grid" data-tab={tab}>
              <div id="oc-live-col-attempts" className="oc-live-col oc-live-col-attempts">
                {/* The athlete's own numbers open the page, on the tab that is
                    selected on open. Absent when there is no round to describe
                    — a row of dashes is not something to open on. */}
                {derived.stats && <LiveStats stats={derived.stats} />}
                <CurrentRoundPanel
                  competitionId={competitionId}
                  event={derived.currentEvent}
                  round={derived.currentRound}
                  state={derived.currentState}
                  idle={derived.idle}
                  next={derived.next}
                  gate={derived.gate}
                  startAtMs={startAtMs}
                  detailsHref={detailsHref}
                  onSignIn={() => setAuthOpen(true)}
                />
                {/* No rounds of their own left to list: no panel at all. */}
                {derived.scheduleItems.length > 0 && (
                  <SchedulePanel items={derived.scheduleItems} competitionId={competitionId} onSelect={selectRound} />
                )}
              </div>
              <div id="oc-live-col-standings" className="oc-live-col oc-live-col-standings">
                {target && (
                  <StandingsPanel
                    events={view.events}
                    target={target}
                    onTarget={setStandingsTarget}
                    onRefresh={refresh}
                    refreshing={refreshing}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </main>
      {/* Plain sign-in: the athlete is already where they want to be, so the
          modal closes and the page re-reads as them. */}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </Shell>
  );
}

function LiveTabButton({
  id,
  label,
  tab,
  onSelect,
}: {
  id: LiveTab;
  label: string;
  tab: LiveTab;
  onSelect: (tab: LiveTab) => void;
}) {
  const on = tab === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      aria-controls={`oc-live-col-${id}`}
      className={`oc-cd-tab${on ? ' oc-cd-tab-active' : ''}`}
      onClick={() => onSelect(id)}
    >
      {label}
    </button>
  );
}
