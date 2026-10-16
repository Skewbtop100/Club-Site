'use client';

// Coach-challenge mode for the solo timer (docs/challenge-plan.md, B4/B5,
// phase 4a). Owns everything server-facing so app/timer/page.tsx only has
// to switch its own UI:
//
//   • listens to challengeLive/{uid} (signed in + TIMER_FEATURES.challenge)
//     and exposes the running session while now < endsAt — a student who
//     was offline at the start gets it on this first read (decision 16);
//   • the PENDING solve: stopped but not yet confirmed (decision 4). It
//     blocks the next solve and is dropped, never sent, if the session ends
//     first (N3);
//   • an ordered submit queue of CONFIRMED solves → /api/challenge/solve,
//     retried on network errors, mirrored to localStorage with the pending
//     solve so a refresh keeps both;
//   • progress from the same computeProgress the server uses (instant
//     feedback; the server stays the authority — a refused solve is
//     removed and reported through onRefused);
//   • the end time: a local timer flips `active` off at endsAt, and an
//     expired pointer found on open is closed through /api/challenge/end
//     (lazy enforcement, decision 20).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeProgress } from '@/lib/challenge-progress';
import { TIMER_FEATURES } from '@/lib/timer-features';
import { RoomsApiError } from '@/lib/firebase/services/rooms';
import {
  commentChallengeSolve, endChallengeSession, submitChallengeSolve, subscribeChallengeLive,
} from '@/lib/firebase/services/challengeSessions';
import type { ChallengeLive, ChallengeTemplate } from '@/lib/types/challenge';
import type { Penalty } from '@/lib/timer-engine';

const STORE_KEY = 'pv.timer.challenge.v1';

export interface ActiveChallenge {
  sessionId: string;
  assignmentId: string;
  template: ChallengeTemplate;
  endsAt: number;
}
export interface PendingSolve { ms: number; stoppedAt: number; scramble: string }
interface QueuedSolve {
  localId: string;
  seq: number;
  ms: number;
  penalty: Penalty;
  stoppedAt: number;
  sent: boolean;
}
interface Stored { sessionId: string; solves: QueuedSolve[]; pending: PendingSolve | null }

function load(sessionId: string): Stored {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const p = raw ? JSON.parse(raw) as Stored : null;
    if (p && p.sessionId === sessionId && Array.isArray(p.solves)) return p;
  } catch { /* ignore */ }
  return { sessionId, solves: [], pending: null };
}
function save(s: Stored | null) {
  try {
    if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* storage unavailable — the queue just won't survive a refresh */ }
}

export interface ChallengeHandlers {
  /** A confirmed solve the server refused (sanity check). The page removes
   *  it from its Challenge session and renumbers the later ones. */
  onRefused: (localId: string, renumber: Record<string, number>) => void;
}

export function useChallenge(uid: string | null, handlers: ChallengeHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [live, setLive] = useState<ChallengeLive | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [store, setStore] = useState<Stored | null>(null);
  const storeRef = useRef<Stored | null>(null);
  const [completed, setCompleted] = useState<{ title: string } | null>(null);
  const [refusedAt, setRefusedAt] = useState(0);

  const commit = useCallback((next: Stored | null) => {
    storeRef.current = next;
    setStore(next);
    save(next);
  }, []);

  // ── The pointer ──
  useEffect(() => {
    if (!uid || !TIMER_FEATURES.challenge) { setLive(null); return; }
    return subscribeChallengeLive(uid, setLive, (e) => console.warn('[challenge] live', e));
  }, [uid]);

  const active: ActiveChallenge | null = useMemo(() => {
    if (!live?.sessionId || !live.template || live.endsAt == null) return null;
    if (now >= live.endsAt) return null;
    return { sessionId: live.sessionId, assignmentId: live.assignmentId ?? '', template: live.template, endsAt: live.endsAt };
  }, [live, now]);

  // Flip off exactly at endsAt; an already-expired pointer is closed on the
  // server (it would also close on the next action).
  const closedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!live?.sessionId || live.endsAt == null) return;
    const left = live.endsAt - Date.now();
    if (left <= 0) {
      setNow(Date.now());
      if (closedRef.current !== live.sessionId) {
        closedRef.current = live.sessionId;
        endChallengeSession(live.sessionId).catch(() => { /* next action closes it */ });
      }
      return;
    }
    const id = window.setTimeout(() => setNow(Date.now()), Math.min(left + 50, 2 ** 31 - 1));
    return () => window.clearTimeout(id);
  }, [live]);

  // Load / reset the local state for the running session. Anything kept for
  // another (closed) session is dropped — including an unconfirmed solve.
  const activeId = active?.sessionId ?? null;
  useEffect(() => {
    if (!activeId) { if (storeRef.current) commit(null); return; }
    if (storeRef.current?.sessionId !== activeId) commit(load(activeId));
  }, [activeId, commit]);

  // ── Submit queue (one request at a time, in seq order) ──
  const sendingRef = useRef(false);
  const retryRef = useRef<number | null>(null);
  const flush = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      for (;;) {
        const s = storeRef.current;
        const item = s?.solves.find(x => !x.sent);
        if (!s || !item) return;
        try {
          const r = await submitChallengeSolve({
            sessionId: s.sessionId, seq: item.seq, ms: item.ms, penalty: item.penalty, stoppedAt: item.stoppedAt,
          });
          const cur = storeRef.current;
          if (cur?.sessionId === s.sessionId) {
            commit({ ...cur, solves: cur.solves.map(x => (x.localId === item.localId ? { ...x, sent: true } : x)) });
          }
          if (r.completed) setCompleted({ title: live?.template?.title ?? '' });
        } catch (e) {
          const code = e instanceof RoomsApiError ? e.code : '';
          if (code === 'too-fast' || code === 'too-close') {
            // Refused for good: drop it and close the gap in the numbering.
            const cur = storeRef.current;
            if (!cur || cur.sessionId !== s.sessionId) return;
            const renumber: Record<string, number> = {};
            const solves = cur.solves.filter(x => x.localId !== item.localId).map(x => {
              if (x.seq > item.seq) { renumber[x.localId] = x.seq - 1; return { ...x, seq: x.seq - 1 }; }
              return x;
            });
            commit({ ...cur, solves });
            handlersRef.current.onRefused(item.localId, renumber);
            setRefusedAt(Date.now());
            continue;
          }
          if (e instanceof RoomsApiError && e.status < 500 && e.status !== 401) {
            // Closed / ended / out of order — the pointer will follow.
            console.warn('[challenge] solve refused', code);
            return;
          }
          // Offline / server hiccup: try again shortly.
          if (retryRef.current == null) {
            retryRef.current = window.setTimeout(() => { retryRef.current = null; void flush(); }, 3000);
          }
          return;
        }
      }
    } finally {
      sendingRef.current = false;
    }
  }, [commit, live]);

  useEffect(() => {
    if (store?.solves.some(x => !x.sent)) void flush();
  }, [store, flush]);
  useEffect(() => () => { if (retryRef.current != null) window.clearTimeout(retryRef.current); }, []);

  // ── Pending → confirmed ──
  const setPending = useCallback((p: PendingSolve) => {
    const cur = storeRef.current;
    if (!cur) return;
    commit({ ...cur, pending: p });
  }, [commit]);

  /** OK / +2 / DNF on the pending solve. Returns what the page stores in
   *  its Challenge session, or null when nothing is pending. Final. */
  const confirm = useCallback((penalty: Penalty) => {
    const cur = storeRef.current;
    if (!cur?.pending) return null;
    const seq = cur.solves.length + 1;
    const localId = `ch_${cur.sessionId}_${seq}_${Math.random().toString(36).slice(2, 7)}`;
    const item: QueuedSolve = { localId, seq, ms: cur.pending.ms, penalty, stoppedAt: cur.pending.stoppedAt, sent: false };
    const pending = cur.pending;
    commit({ ...cur, solves: [...cur.solves, item], pending: null });
    return { localId, seq, sessionId: cur.sessionId, ms: pending.ms, penalty, scramble: pending.scramble };
  }, [commit]);

  const progress = useMemo(() => (active && store
    ? computeProgress(active.template, store.solves)
    : null), [active, store]);

  const endSession = useCallback(async () => {
    if (!active) return;
    await endChallengeSession(active.sessionId);
  }, [active]);

  const comment = useCallback((sessionId: string, seq: number, text: string) => {
    commentChallengeSolve(sessionId, seq, text).catch(e => console.warn('[challenge] comment', e));
  }, []);

  return {
    active,
    pending: active ? store?.pending ?? null : null,
    progress,
    setPending,
    confirm,
    endSession,
    comment,
    completed,
    dismissCompleted: useCallback(() => setCompleted(null), []),
    /** Changes whenever a solve was refused (for the "Цаг хэт хурдан байна" notice). */
    refusedAt,
  };
}

export type ChallengeState = ReturnType<typeof useChallenge>;
