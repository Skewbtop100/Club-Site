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
  idleReason,
  meContextFor,
  ownRoundStats,
  pickCurrentRound,
  roundRowState,
  statsRound,
  type LiveViewPayload,
  type RoundRef,
} from '@/lib/online-competition/live-view';
import type { CompetitionRoster } from '@/app/api/online-competition/competitions/[id]/roster/route';
import HubNav from '../../_components/hub/v3/HubNav';
import AuthModal from '../../_components/hub/v3/AuthModal';
import { toMillisOrNull } from '../../_components/hub/format';
import LiveHeader from './_components/LiveHeader';
import CurrentRoundPanel, { CURRENT_PANEL_ID } from './_components/CurrentRoundPanel';
import SchedulePanel, { type ScheduleItem } from './_components/SchedulePanel';
import StandingsPanel from './_components/StandingsPanel';

// ── The athlete's live competition view ─────────────────────────────────
// Where an athlete lands on a live competition. The solve flow is reached
// from the start buttons here; nothing on this page writes anything.
//
// Data: the competition document (name, events, start) through the same
// client reader the details page uses; the approved athlete count from the
// public roster route; and everything else from the live route, which is
// read-only and does its reads with the Admin SDK.

function Shell({ competition, children }: { competition: OnlineCompetition | null; children: React.ReactNode }) {
  return (
    <div className="oc-v3-page">
      <HubNav live={competition?.status === 'live' ? competition : null} active="competitions" />
      {children}
    </div>
  );
}

function fmtMoment(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [athleteCount, setAthleteCount] = useState<number | null>(null);
  const [view, setView] = useState<LiveViewPayload | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  /** The event the athlete picked from the schedule, if any. */
  const [selected, setSelected] = useState<string | null>(null);
  const [standingsTarget, setStandingsTarget] = useState<RoundRef | null>(null);
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

  // The ТАМИРЧИН count — the same approved count the details page shows.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/online-competition/competitions/${encodeURIComponent(competitionId)}/roster`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: CompetitionRoster) => {
        if (!cancelled) setAthleteCount(d.approvedCount);
      })
      .catch(() => {
        // The cell keeps its em dash; a missing count is not worth a page error.
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
  // competition's approved submissions.
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
    const scheduleItems: ScheduleItem[] = view.events.flatMap((e) => {
      const me = meContextFor(view, e);
      return e.rounds
        .filter((r) => !(current && current.eventId === e.eventId && current.round === r.round))
        .map((r) => ({
          key: `${e.eventId}_${r.round}`,
          eventId: e.eventId,
          label: `${e.label} · ${r.label}`,
          round: r.round,
          status: r.status,
          scheduledAt: r.scheduledAt,
          qualified: r.qualified,
          state: roundRowState(r, me),
          viewNote: !view.signedIn
            ? 'НЭВТЭРЧ ОРОЛЦОНО'
            : !view.registration || !e.me?.registered
              ? 'БҮРТГҮҮЛЭЭГҮЙ ТӨРӨЛ'
              : gate
                ? gate.label
                : 'ТАНЫ РАУНД БИШ',
        }));
    });

    return {
      currentEvent,
      currentRound,
      currentState,
      stats,
      gate,
      scheduleItems,
      idle: currentState ? null : idleReason(view),
      defaultTarget: defaultStandingsTarget(view, statsRef),
    };
  }, [view, selected]);

  const selectRound = useCallback((eventId: string) => {
    setSelected(eventId);
    // On a phone the panel this changes is above the schedule, off screen.
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
  const status = view?.status ?? competition.status;
  const context =
    derived?.currentEvent && derived.currentRound
      ? `${derived.currentEvent.label} · ${derived.currentRound.label}`.toUpperCase()
      : status === 'upcoming' && startAtMs !== null
        ? `ЭХЛЭХ ${fmtMoment(startAtMs)}`
        : null;

  const target =
    view &&
    standingsTarget &&
    view.events.some((e) => e.eventId === standingsTarget.eventId && e.rounds.some((r) => r.round === standingsTarget.round))
      ? standingsTarget
      : derived?.defaultTarget ?? null;

  return (
    <Shell competition={competition}>
      <main className="oc-v3-main">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <LiveHeader
            name={competition.name}
            status={status}
            athleteCount={athleteCount}
            eventCount={competition.events.length}
            context={context}
            stats={derived?.stats ?? null}
            detailsHref={detailsHref}
          />

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
            <div className="oc-live-grid">
              <div className="oc-live-col">
                <CurrentRoundPanel
                  competitionId={competitionId}
                  event={derived.currentEvent}
                  round={derived.currentRound}
                  state={derived.currentState}
                  idle={derived.idle}
                  gate={derived.gate}
                  startAtMs={startAtMs}
                  detailsHref={detailsHref}
                  onSignIn={() => setAuthOpen(true)}
                />
                <SchedulePanel items={derived.scheduleItems} competitionId={competitionId} onSelect={selectRound} />
              </div>
              <div className="oc-live-col">
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
          )}
        </div>
      </main>
      {/* Plain sign-in: the athlete is already where they want to be, so the
          modal closes and the page re-reads as them. */}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </Shell>
  );
}
