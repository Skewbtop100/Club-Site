'use client';

import { useEffect, useMemo, useState } from 'react';
import { subscribeResultsByComp } from '@/lib/firebase/services/results';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { useWcaRecords } from '@/lib/hooks/useWcaRecords';
import { getClubBests } from '@/lib/firebase/services/club-bests';
import { computeLocalBadges, type ClubBests } from '@/lib/club-bests';
import type { Competition, Result, AdvancementConfig, Athlete, WcaRecords } from '@/lib/types';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import { compareRoundResults } from '@/lib/results-entry-helpers';
import { getResultBadgesPair, BADGE_STYLES, type RecordBadge } from '@/lib/record-badges';
import PrevResultChip from '@/components/shared/PrevResultChip';
import { clubNameMatcher } from '@/lib/staged-reveal';
import JudgedBy from '@/components/shared/JudgedBy';
import { useLang, type TranslationKey } from '@/lib/i18n';

// ── helpers ───────────────────────────────────────────────────────────────────

type T = (key: TranslationKey) => string;

function getRoundLabel(roundNum: number, totalRounds: number, t: T): string {
  if (totalRounds === 1 || roundNum === totalRounds) return t('admin.round.final');
  if (totalRounds === 4 && roundNum === 3) return t('admin.round.semi');
  if (roundNum === 1) return t('admin.round.first');
  if (roundNum === 2) return t('admin.round.second');
  if (roundNum === 3) return t('admin.round.third');
  return `${t('admin.round.generic')} ${roundNum}`;
}

/** Which of an Ao5's attempts are the dropped best / worst (shown in
 *  parentheses). Nothing is dropped from fewer than 5 attempts. */
function getSolveHint(solves: (number | null)[], idx: number): 'best' | 'worst' | null {
  if (!solves || solves.length < 5) return null;
  const rank = (v: number | null): number => {
    if (v === null) return 4e9;
    if (v === -2) return 3e9;
    if (v < 0) return 2e9;
    return v;
  };
  const scored = solves.map((v, i) => ({ r: rank(v), i })).sort((a, b) => a.r !== b.r ? a.r - b.r : a.i - b.i);
  if (scored[0].i === idx) return 'best';
  if (scored[4].i === idx) return 'worst';
  return null;
}

const rKey = (evId: string, r: number) => `${evId}_r${r}`;

// lib/wca-event-icon.tsx keys the blindfolded icons by the timer's ids.
const ICON_ID: Record<string, string> = { '333bf': '333bld', '444bf': '444bld', '555bf': '555bld' };

const STATUS_KEY: Record<'complete' | 'ongoing' | 'waiting', TranslationKey> = {
  complete: 'results.status.complete',
  ongoing: 'results.status.ongoing',
  waiting: 'results.status.waiting',
};

/** WR / CR / NR for one value of a CLUB result, from the stored WCA record
 *  thresholds. TR and PR come from lib/club-bests.ts instead (they need the
 *  club's history, which this per-competition viewer gets as one summary
 *  document rather than by loading every result). */
function wcaLevelBadge(r: Result, type: 'single' | 'average', wcaRecords: WcaRecords): RecordBadge | null {
  const badges = getResultBadgesPair(r, [], wcaRecords)[type];
  return (['WR', 'CR', 'NR'] as const).find(b => badges.includes(b)) ?? null;
}

function Badge({ badge }: { badge: RecordBadge | null }) {
  if (!badge) return null;
  return <sup className="crv-badge" style={BADGE_STYLES[badge]}>{badge}</sup>;
}

// ── data container ────────────────────────────────────────────────────────────

interface Props {
  comp: Competition;
  /** Required for the overlay; unused when `embedded`. */
  onClose?: () => void;
  isLive?: boolean;
  /** Render in the page flow instead of as a full-screen overlay: no close
   *  button, no Escape-to-close, no body scroll lock (the /judge page's
   *  "live results" tab). The data shown is identical either way. */
  embedded?: boolean;
}

/**
 * Live results of one competition — the public overlay and the judge page's
 * embedded tab. This wrapper only loads the data (the same published results
 * and next-round placeholders anyone can read); CompetitionResultsView below
 * does all the rendering.
 */
export default function CompetitionResultsViewer({ comp, onClose, isLive, embedded }: Props) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [allAthletes, setAllAthletes] = useState<Athlete[]>([]);
  const wcaRecords = useWcaRecords();
  // Personal bests + club records from before this competition — one
  // document (settings/clubBests), read once per open. Without it (never
  // computed, or the read failed) the viewer simply shows no PR/TR.
  const [clubBests, setClubBests] = useState<ClubBests | null>(null);

  useEffect(() => {
    getAthletes().then(setAllAthletes);
    getClubBests().then(setClubBests).catch(() => setClubBests(null));
  }, []);

  // Real-time subscription. For live (and upcoming) comps, include placeholder
  // rows so qualified athletes show in the next round before solves are entered.
  // Finished comps only show real published results.
  const isFinishedComp = comp.status === 'finished';
  useEffect(() => {
    setLoading(true);
    const unsub = subscribeResultsByComp(comp.id, (data) => {
      const filtered = isFinishedComp
        ? data.filter(r => r.status === 'published')
        : data.filter(r => r.status === 'published' || r.isPlaceholder === true);
      setResults(filtered);
      setLoading(false);
    });
    return unsub;
  }, [comp.id, isFinishedComp]);

  return (
    <CompetitionResultsView
      comp={comp} results={results} athletes={allAthletes} wcaRecords={wcaRecords} clubBests={clubBests}
      loading={loading} isLive={isLive} embedded={embedded} onClose={onClose}
    />
  );
}

// ── view ──────────────────────────────────────────────────────────────────────

interface ViewProps extends Props {
  results: Result[];
  /** The club roster: names for club rows, and what marks a row as "club". */
  athletes: Athlete[];
  wcaRecords: WcaRecords;
  /** settings/clubBests, or null when there is none — then no PR/TR is shown. */
  clubBests: ClubBests | null;
  loading: boolean;
}

/**
 * The results layout, WCA-Live style and phone first:
 *   top bar (☰ + competition name) → "<Event> - <Round>" → compact table
 *   # | Name | Average | Best, which never scrolls sideways at phone width.
 * Tap a row for its details (attempts, judge, WCA marker); ☰ opens the
 * drawer of events and rounds. From 900px the drawer is a permanent sidebar
 * and the table gains the five attempt columns.
 * Pure: everything it shows comes in through props.
 */
export function CompetitionResultsView({ comp, results, athletes, wcaRecords, clubBests, loading, isLive, embedded, onClose }: ViewProps) {
  const { t } = useLang();
  const [evId, setEvId]             = useState('');
  const [round, setRound]           = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail]         = useState<{ result: Result; rank: number } | null>(null);

  const athleteNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    athletes.forEach(a => { m[a.id] = `${a.name || ''}${a.lastName ? ' ' + a.lastName : ''}`; });
    return m;
  }, [athletes]);
  // Club athletes = full club roster from the athletes collection.
  const clubAthleteIds = useMemo(() => new Set(athletes.map(a => a.id)), [athletes]);
  const matchClub = useMemo(
    () => clubNameMatcher((comp.athletes || []).map(a => a.id), athletes),
    [comp.athletes, athletes],
  );
  // PR / TR per result, chronologically across this competition's rounds.
  const localBadges = useMemo(
    () => computeLocalBadges(results, clubBests, clubAthleteIds),
    [results, clubBests, clubAthleteIds],
  );

  const compEvents = useMemo(
    () => comp.events ? WCA_EVENTS.filter(e => (comp.events as Record<string, boolean>)?.[e.id]) : [],
    [comp.events],
  );
  const totalRoundsFor = (ev: string) => comp.eventConfig?.[ev]?.rounds ?? 1;
  const statusOf = (ev: string, r: number): 'complete' | 'ongoing' | 'waiting' => comp.roundStatus?.[rKey(ev, r)] ?? 'waiting';

  // Until the visitor picks something: the round that is running right now,
  // else the first event's first round. (On a phone the drawer starts
  // closed, so an empty "select an event" screen would be a dead end.)
  const defaultSel = (() => {
    for (const ev of compEvents) {
      for (let r = 1; r <= totalRoundsFor(ev.id); r++) {
        if (statusOf(ev.id, r) === 'ongoing') return { evId: ev.id, round: r };
      }
    }
    return { evId: compEvents[0]?.id ?? '', round: 1 };
  })();
  const curEv = evId || defaultSel.evId;
  const curRound = evId ? round : defaultSel.round;

  // Escape closes the innermost thing that is open; the overlay also locks
  // the page behind it from scrolling.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (detail) setDetail(null);
      else if (drawerOpen) setDrawerOpen(false);
      else if (!embedded) onClose?.();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [detail, drawerOpen, embedded, onClose]);
  useEffect(() => {
    if (embedded) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [embedded]);

  // ── derived data ─────────────────────────────────────────────────────────────

  const roundRows = results
    .filter(r => r.eventId === curEv && (r.round || 1) === curRound)
    .sort(compareRoundResults);
  // Ranked results first; qualified-but-not-yet-competed athletes listed after.
  const ranked = roundRows.filter(r => !r.isPlaceholder);
  const placeholders = roundRows.filter(r => r.isPlaceholder);

  const totalRounds = totalRoundsFor(curEv);
  const isFinal     = curRound >= totalRounds;
  const advCfg: AdvancementConfig | undefined =
    !isFinal ? (comp.eventConfig?.[curEv]?.advancement?.[String(curRound)] as AdvancementConfig | undefined) : undefined;
  // Advancement math counts only real (non-placeholder) results.
  const rawAdv = advCfg
    ? advCfg.type === 'fixed' ? advCfg.value : Math.floor(ranked.length * advCfg.value / 100)
    : 0;
  const advanceCount = Math.min(rawAdv, Math.max(0, ranked.length - 1));

  const curStatus = statusOf(curEv, curRound);
  const eventName = WCA_EVENTS.find(e => e.id === curEv)?.name ?? '';

  const isClub = (r: Result) => clubAthleteIds.has(r.athleteId);
  const displayName = (r: Result) => athleteNameMap[r.athleteId] || r.athleteName || r.athleteId;
  // An imported row whose athlete shares a name with one of this
  // competition's club athletes — judged against who is registered NOW.
  const isMatchedImport = (r: Result) => !!matchClub(r);
  // Highest badge only, as everywhere else: WR > CR > NR > TR > PR.
  const badgeOf = (r: Result, type: 'single' | 'average'): RecordBadge | null => {
    if (!isClub(r)) return null;
    const local = localBadges[r.id]?.[type];
    return wcaLevelBadge(r, type, wcaRecords) ?? (local?.tr ? 'TR' : local?.pr ? 'PR' : null);
  };
  const attemptText = (r: Result, i: number) => {
    const v = r.solves?.[i] ?? null;
    return getSolveHint(r.solves ?? [], i) ? `(${fmtTime(v)})` : fmtTime(v);
  };

  function select(ev: string, r: number) {
    setEvId(ev); setRound(r); setDrawerOpen(false);
  }

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div className={`crv-root ${embedded ? 'crv-embedded' : 'crv-overlay'}`}>

      {/* Top bar: ☰ · competition name · (close) */}
      <div className="crv-top">
        <button className="crv-iconbtn crv-burger" aria-label={t('results.menu')} title={t('results.menu')} onClick={() => setDrawerOpen(v => !v)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {isLive && <span className="crv-live"><span className="crv-live-dot" />LIVE</span>}
        <span className="crv-compname">{comp.name}</span>
        {!embedded && (
          <button className="crv-iconbtn" aria-label={t('results.close')} title={t('results.close')} onClick={onClose}>✕</button>
        )}
      </div>

      <div className="crv-body">

        {/* Drawer (phone) / sidebar (desktop): events → rounds with status */}
        {drawerOpen && <div className="crv-scrim" onClick={() => setDrawerOpen(false)} />}
        <nav className={`crv-drawer${drawerOpen ? ' open' : ''}`} aria-label={t('results.menu')}>
          {compEvents.length === 0 && <div className="crv-empty">{t('results.no-events')}</div>}
          {compEvents.map(ev => {
            const total = totalRoundsFor(ev.id);
            const iconId = ICON_ID[ev.id] ?? ev.id;
            return (
              <div key={ev.id} className="crv-ev">
                <div className="crv-ev-head">
                  {hasWcaEventIcon(iconId) && <WcaEventIcon eventId={iconId} size={18} />}
                  <span className="crv-ev-name">{ev.name}</span>
                </div>
                {Array.from({ length: total }, (_, i) => i + 1).map(r => {
                  const st = statusOf(ev.id, r);
                  return (
                    <button
                      key={r}
                      className={`crv-round${curEv === ev.id && curRound === r ? ' active' : ''}`}
                      onClick={() => select(ev.id, r)}
                    >
                      <span className="crv-round-name">{getRoundLabel(r, total, t)}</span>
                      <span className={`crv-chip crv-chip-${st}`}>{t(STATUS_KEY[st])}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="crv-main">
          {loading ? (
            <div className="crv-loading"><div className="spinner" /></div>
          ) : !curEv ? (
            <div className="crv-empty">{t('results.no-events')}</div>
          ) : (
            <>
              {/* Title: "<Event> - <Round>" */}
              <div className="crv-title">
                <span className="crv-title-text">{eventName} - {getRoundLabel(curRound, totalRounds, t)}</span>
                <span className={`crv-chip crv-chip-${curStatus}`}>{t(STATUS_KEY[curStatus])}</span>
              </div>
              {advanceCount > 0 && advCfg && (
                <div className="crv-advnote">
                  <span className="crv-advnote-swatch" />
                  {(advCfg.type === 'fixed' ? t('results.advance-fixed') : t('results.advance-percent'))
                    .replace('{n}', String(advanceCount)).replace('{p}', String(advCfg.value))}
                </div>
              )}

              {ranked.length === 0 && placeholders.length === 0 ? (
                <div className="crv-empty">{t('results.empty-round')}</div>
              ) : (
                <table className="crv-table">
                  <thead>
                    <tr>
                      <th className="crv-c-rank">#</th>
                      <th className="crv-c-name">{t('results.col.name')}</th>
                      <th className="crv-c-time">{t('results.col.average')}</th>
                      <th className="crv-c-time">{t('results.col.best')}</th>
                      {[1, 2, 3, 4, 5].map(n => <th key={n} className="crv-c-att">{n}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((r, i) => {
                      const advancing = i < advanceCount;
                      const medal = !advancing && isFinal && i < 3 ? ` crv-medal-${i + 1}` : '';
                      return (
                        <tr
                          key={r.id}
                          className={`crv-row${isClub(r) ? ' crv-club' : ''}`}
                          onClick={() => setDetail({ result: r, rank: i + 1 })}
                        >
                          <td className={`crv-c-rank${advancing ? ' crv-adv' : ''}${medal}`}>{i + 1}</td>
                          <td className="crv-c-name">
                            {isMatchedImport(r) && <span className="crv-wca-dot" title={t('results.wca-chip-title')} />}
                            <span className="crv-name">{displayName(r)}</span>
                            {r.localName && <span className="crv-local"> {r.localName}</span>}
                          </td>
                          <td className={`crv-c-time crv-avg${r.average != null && r.average < 0 ? ' crv-dnf' : ''}`}>
                            {fmtTime(r.average)}<Badge badge={badgeOf(r, 'average')} />
                          </td>
                          <td className={`crv-c-time${r.single != null && r.single < 0 ? ' crv-dnf' : ''}`}>
                            {fmtTime(r.single)}<Badge badge={badgeOf(r, 'single')} />
                          </td>
                          {[0, 1, 2, 3, 4].map(si => {
                            const sv = r.solves?.[si] ?? null;
                            return (
                              <td key={si} className={`crv-c-att${sv !== null && sv < 0 ? ' crv-dnf' : ''}`}>{attemptText(r, si)}</td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {/* Qualified, not yet competed. A table of its own under a plain
                  heading, NOT a colSpan row in the table above: with the
                  attempt columns hidden on a phone, a cell spanning all nine
                  columns makes the fixed layout hand most of the name
                  column's width to columns that aren't there. Same classes,
                  so the columns line up with the table above. */}
              {placeholders.length > 0 && (
                <>
                  <div className="crv-sep">{t('results.placeholders')}</div>
                  <table className="crv-table">
                    <tbody>
                      {placeholders.map(r => (
                        <tr key={r.id} className={`crv-row crv-ph${isClub(r) ? ' crv-club' : ''}`}>
                          <td className="crv-c-rank">—</td>
                          <td className="crv-c-name"><span className="crv-name">{displayName(r)}</span></td>
                          <td className="crv-c-time">—</td>
                          <td className="crv-c-time">—</td>
                          {[0, 1, 2, 3, 4].map(si => <td key={si} className="crv-c-att">—</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Row details */}
      {detail && (() => {
        const r = detail.result;
        const judge = r.judgeName || athleteNameMap[r.judgeAthleteId || ''];
        const attempts = (r.solves ?? []).map((_, i) => attemptText(r, i));
        return (
          <div className="crv-pop-scrim" onClick={() => setDetail(null)}>
            <div className="crv-pop" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="crv-pop-head">
                <span className="crv-pop-rank">{detail.rank}</span>
                <div className="crv-pop-who">
                  <div className="crv-pop-name">{displayName(r)}</div>
                  {r.localName && <div className="crv-pop-local">{r.localName}</div>}
                  <div className="crv-pop-country">{isClub(r) ? 'Mongolia' : (r.country || '—')}</div>
                </div>
                <button className="crv-iconbtn" aria-label={t('results.close')} title={t('results.close')} onClick={() => setDetail(null)}>✕</button>
              </div>
              <div className="crv-pop-label">{t('results.attempts')}</div>
              <div className="crv-pop-attempts">{attempts.length > 0 ? attempts.join(', ') : '—'}</div>
              <div className="crv-pop-stats">
                <div className="crv-pop-stat">
                  <div className="crv-pop-label">{t('results.col.average')}</div>
                  <div className={`crv-pop-val crv-avg${r.average != null && r.average < 0 ? ' crv-dnf' : ''}`}>
                    {fmtTime(r.average)}<Badge badge={badgeOf(r, 'average')} />
                  </div>
                </div>
                <div className="crv-pop-stat">
                  <div className="crv-pop-label">{t('results.col.best')}</div>
                  <div className={`crv-pop-val${r.single != null && r.single < 0 ? ' crv-dnf' : ''}`}>
                    {fmtTime(r.single)}<Badge badge={badgeOf(r, 'single')} />
                  </div>
                </div>
              </div>
              <JudgedBy name={judge} style={{ fontSize: '0.8rem', marginTop: '0.6rem' }} />
              {isMatchedImport(r) && (
                <div className="crv-pop-wca"><PrevResultChip show /><span>{t('results.wca-chip-title')}</span></div>
              )}
            </div>
          </div>
        );
      })()}

      <style>{`
        .crv-root {
          --crv-line: rgba(128,128,128,0.22);
          --crv-line-soft: rgba(128,128,128,0.12);
          display: flex; flex-direction: column; position: relative;
          background: var(--bg); color: var(--text);
          font-size: 13.5px; line-height: 1.25; text-align: left;
        }
        .crv-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999; }
        .crv-embedded { min-height: 60vh; border-radius: 14px; overflow: hidden; border: 1px solid var(--crv-line); }

        .crv-top {
          display: flex; align-items: center; gap: 8px; flex-shrink: 0;
          height: 46px; padding: 0 8px; background: var(--surface);
          border-bottom: 1px solid var(--crv-line);
        }
        .crv-iconbtn {
          width: 34px; height: 34px; flex-shrink: 0; padding: 0; margin: 0;
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid var(--crv-line); border-radius: 8px;
          color: var(--text); font-size: 15px; line-height: 1; font-family: inherit; cursor: pointer;
        }
        .crv-compname {
          flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .crv-live {
          display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
          font-size: 10px; font-weight: 700; color: #4ade80; letter-spacing: 0.04em;
          background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.25);
          padding: 2px 7px; border-radius: 999px;
        }
        .crv-live-dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; animation: crvPulse 1.4s ease-in-out infinite; }
        @keyframes crvPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(.7); } }

        .crv-body { flex: 1; min-height: 0; display: flex; position: relative; }

        /* Drawer: slides in over the table on a phone */
        .crv-drawer {
          position: absolute; top: 0; bottom: 0; left: 0; z-index: 3;
          width: min(84%, 300px); overflow-y: auto; padding: 6px 0 14px;
          background: var(--surface); border-right: 1px solid var(--crv-line);
          transform: translateX(-102%); transition: transform 0.2s ease; visibility: hidden;
        }
        .crv-drawer.open { transform: none; visibility: visible; box-shadow: 8px 0 30px rgba(0,0,0,0.4); }
        .crv-scrim { position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 2; background: rgba(0,0,0,0.5); }
        .crv-ev { padding: 6px 0 2px; }
        .crv-ev-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px 4px; color: var(--text); }
        .crv-ev-name { font-size: 13.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .crv-round {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          width: 100%; min-height: 36px; margin: 0; padding: 4px 12px 4px 38px;
          background: none; border: none; border-left: 3px solid transparent;
          color: var(--muted); font-family: inherit; font-size: 13px; text-align: left; cursor: pointer;
        }
        .crv-round.active { background: rgba(124,58,237,0.14); border-left-color: var(--accent); color: var(--text); font-weight: 600; }
        .crv-round-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .crv-chip {
          flex-shrink: 0; padding: 1px 7px; border-radius: 999px; white-space: nowrap;
          font-size: 10px; font-weight: 600; line-height: 1.5; border: 1px solid var(--crv-line); color: var(--muted);
        }
        .crv-chip-ongoing  { color: #4ade80; border-color: rgba(74,222,128,0.4); background: rgba(74,222,128,0.1); }
        .crv-chip-complete { color: #a78bfa; border-color: rgba(167,139,250,0.4); background: rgba(124,58,237,0.1); }

        .crv-main { flex: 1; min-width: 0; overflow-x: hidden; overflow-y: auto; background: var(--card); }
        .crv-loading { display: flex; align-items: center; justify-content: center; min-height: 200px; }
        .crv-empty { padding: 28px 12px; text-align: center; color: var(--muted); font-size: 13px; }
        .crv-title { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; padding: 10px 10px 6px; }
        .crv-title-text { font-size: 15px; font-weight: 700; color: var(--text-primary); }
        .crv-advnote { display: flex; align-items: center; gap: 6px; padding: 0 10px 6px; font-size: 11.5px; color: var(--muted); }
        .crv-advnote-swatch { width: 10px; height: 10px; border-radius: 2px; background: #16a34a; flex-shrink: 0; }

        /* Table: fixed layout so the name column absorbs all the slack and
           nothing can push the table wider than its container. */
        .crv-table { width: 100%; border-collapse: collapse; border-spacing: 0; table-layout: fixed; font-size: 13.5px; }
        .crv-table th, .crv-table td {
          height: 33px; padding: 0 6px; margin: 0; vertical-align: middle;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          border-bottom: 1px solid var(--crv-line-soft);
        }
        .crv-table th {
          height: 26px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--muted); text-align: left; border-bottom-color: var(--crv-line);
        }
        .crv-table .crv-c-rank { width: 34px; padding: 0; text-align: center; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
        .crv-table .crv-c-time { width: 70px; text-align: right; font-variant-numeric: tabular-nums; }
        .crv-table .crv-c-att  { display: none; width: 66px; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
        .crv-table td.crv-c-rank.crv-adv { background: #16a34a; color: #fff; }
        .crv-table td.crv-medal-1 { color: #eab308; }
        .crv-table td.crv-medal-2 { color: #94a3b8; }
        .crv-table td.crv-medal-3 { color: #c2410c; }
        .crv-row { cursor: pointer; }
        .crv-row:hover td { background-color: rgba(128,128,128,0.07); }
        .crv-row:hover td.crv-adv { background-color: #16a34a; }
        .crv-club td { background-color: rgba(124,58,237,0.09); }
        .crv-club td.crv-c-name { box-shadow: inset 3px 0 0 rgba(124,58,237,0.7); }
        .crv-name { font-weight: 600; color: var(--text); }
        .crv-local { color: var(--muted); font-weight: 400; }
        .crv-avg { font-weight: 700; color: #a78bfa; }
        .crv-dnf { color: #f43f5e !important; }
        .crv-wca-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #fbbf24; margin-right: 5px; vertical-align: middle; }
        .crv-badge {
          display: inline-block; margin-left: 2px; padding: 0 2px; border-radius: 3px;
          font-size: 8px; font-weight: 700; line-height: 1.35; letter-spacing: 0; vertical-align: super; position: static;
        }
        .crv-sep {
          padding: 5px 6px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--muted); background: rgba(128,128,128,0.06);
          border-top: 1px solid var(--crv-line); border-bottom: 1px solid var(--crv-line-soft);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .crv-ph { cursor: default; }
        .crv-ph td, .crv-ph .crv-name { color: var(--muted); font-weight: 400; }

        /* Row details */
        .crv-pop-scrim {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10000;
          display: flex; align-items: center; justify-content: center; padding: 16px;
          background: rgba(0,0,0,0.6);
        }
        .crv-pop {
          width: 100%; max-width: 360px; max-height: 100%; overflow-y: auto; padding: 14px;
          background: var(--card); color: var(--text); border: 1px solid var(--crv-line); border-radius: 14px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5); font-size: 13.5px; text-align: left;
        }
        .crv-pop-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
        .crv-pop-rank {
          flex-shrink: 0; min-width: 30px; height: 30px; padding: 0 6px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(124,58,237,0.18); color: #a78bfa; font-weight: 700; font-variant-numeric: tabular-nums;
        }
        .crv-pop-who { flex: 1; min-width: 0; }
        .crv-pop-name { font-size: 15px; font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; }
        .crv-pop-local { color: var(--muted); overflow-wrap: anywhere; }
        .crv-pop-country { font-size: 12px; color: var(--muted); margin-top: 2px; }
        .crv-pop-label { font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); margin-bottom: 3px; }
        .crv-pop-attempts { font-size: 14px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
        .crv-pop-stats { display: flex; gap: 8px; margin-top: 12px; }
        .crv-pop-stat { flex: 1; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--crv-line-soft); background: rgba(128,128,128,0.06); }
        .crv-pop-val { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .crv-pop-wca { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--muted); }
        .crv-pop-wca > span:first-child { margin-left: 0 !important; }

        /* Desktop: the drawer is a permanent sidebar, attempts get columns */
        @media (min-width: 900px) {
          .crv-burger, .crv-scrim { display: none; }
          .crv-drawer {
            position: static; transform: none; visibility: visible; box-shadow: none;
            width: 250px; flex-shrink: 0;
          }
          .crv-table .crv-c-att { display: table-cell; }
          .crv-table .crv-c-time { width: 84px; }
          .crv-title { padding: 14px 14px 8px; }
          .crv-advnote { padding: 0 14px 8px; }
        }
      `}</style>
    </div>
  );
}
