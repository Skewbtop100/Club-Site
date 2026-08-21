'use client';

import { useMemo, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { DAILY_PRACTICE_COMPETITION_ID } from '@/lib/firebase/services/competitions';
import { getResultBadgesPair, getHighestBadge, BADGE_STYLES, BADGE_PRIORITY, type RecordBadge } from '@/lib/record-badges';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { Athlete, Result, WcaRecords } from '@/lib/types';

interface Props {
  /** Now includes Daily Practice's full history alongside finished-competition
   *  results (useResults widens visibility to `finished || isDailyPractice`) —
   *  this single list covers both today's feed and the all-time record pool. */
  results: Result[];
  athletes: Athlete[];
  wcaRecords: WcaRecords;
  loading: boolean;
}

interface RecordRow {
  key: string;
  tier: RecordBadge;
  type: 'single' | 'average';
  eventName: string;
  value: number;
  athleteName: string;
  submittedAt: unknown;
  result: Result;
}

/** Index of the solve that produced the recorded single — same "lowest valid
 *  time" logic RankingsSection uses to highlight a result's best solve. */
function findBestSolveIdx(solves: (number | null)[] | undefined): number {
  if (!solves) return -1;
  return solves.reduce<number>((bi, s, idx) => {
    if (s === null || s <= 0 || s === -1 || s === -2) return bi;
    if (bi === -1) return idx;
    return s < (solves[bi] as number) ? idx : bi;
  }, -1);
}

/** Best-effort read of a Firestore Timestamp | Date | string | number into ms. */
function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (typeof ts === 'number') return ts;
  return 0;
}

function fmtClock(ts: unknown): string {
  const ms = toMillis(ts);
  if (!ms) return '';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${y}-${m}-${day} ${time}`;
}

const FEED_WINDOW_DAYS = 14;

/** Start-of-window date (YYYY-MM-DD, local time), inclusive of today —
 *  matches practiceDate's local-timezone convention (see todayDateStr). */
function windowStartDateStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function DailyPracticeSection({ results, athletes, wcaRecords, loading }: Props) {
  const { t } = useLang();
  const [scrambleModal, setScrambleModal] = useState<Result | null>(null);

  const athleteNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    athletes.forEach((a) => { m[a.id] = (a.name || '') + (a.lastName ? ' ' + a.lastName : ''); });
    return m;
  }, [athletes]);

  const eventNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    WCA_EVENTS.forEach((e) => { m[e.id] = e.name; });
    return m;
  }, []);

  const windowStart = windowStartDateStr(FEED_WINDOW_DAYS);
  const recentEntries = useMemo(() => {
    return results
      .filter((r) => r.competitionId === DAILY_PRACTICE_COMPETITION_ID && !!r.practiceDate && r.practiceDate >= windowStart)
      .sort((a, b) => toMillis(b.submittedAt) - toMillis(a.submittedAt));
  }, [results, windowStart]);

  // WCA-Live "Recent records" style: only entries that actually set a record
  // appear, and single/average are judged independently — an entry that PRs
  // on both produces two rows, one on neither produces zero. Judged against
  // the full merged list (competitions + all Daily Practice history), so a
  // practice Ao5 beating an official competition record shows the same tier.
  const recordRows = useMemo(() => {
    const rows: RecordRow[] = [];
    for (const r of recentEntries) {
      const eventName = eventNameMap[r.eventId] || r.eventId;
      const athleteName = athleteNameMap[r.athleteId] || r.athleteName || r.athleteId;
      const badges = getResultBadgesPair(r, results, wcaRecords);

      const singleTier = getHighestBadge(badges.single);
      if (singleTier && r.single !== null) {
        rows.push({ key: `${r.id}-single`, tier: singleTier, type: 'single', eventName, value: r.single, athleteName, submittedAt: r.submittedAt, result: r });
      }

      const avgTier = getHighestBadge(badges.average);
      if (avgTier && r.average !== null) {
        rows.push({ key: `${r.id}-average`, tier: avgTier, type: 'average', eventName, value: r.average, athleteName, submittedAt: r.submittedAt, result: r });
      }
    }
    // Group by tier (WR > CR > NR > TR > PR), most recent first within each tier.
    rows.sort((a, b) => {
      const tierDiff = BADGE_PRIORITY.indexOf(a.tier) - BADGE_PRIORITY.indexOf(b.tier);
      if (tierDiff !== 0) return tierDiff;
      return toMillis(b.submittedAt) - toMillis(a.submittedAt);
    });
    return rows;
  }, [recentEntries, results, wcaRecords, eventNameMap, athleteNameMap]);

  return (
    <section id="daily-practice" style={{ padding: '6rem 2rem', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div className="section-tag">
            <span className="dp-live-dot" aria-hidden />
            {t('section-tag.daily-practice')}
          </div>
          <h2 className="section-title">{t('section-title.daily-practice')}</h2>
          <p className="section-desc">{t('section-desc.daily-practice')}</p>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" />
          </div>
        ) : recordRows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⏱️</div>
            {t('daily-practice.empty')}
          </div>
        ) : (
          <div className="dp-feed">
            {recordRows.map((row) => (
              <div className="dp-row" key={row.key} onClick={() => setScrambleModal(row.result)}>
                <span
                  className="dp-tier-badge"
                  style={{
                    fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.04em', lineHeight: 1,
                    padding: '2px 4px', borderRadius: 4, ...BADGE_STYLES[row.tier],
                  }}
                >
                  {row.tier}
                </span>
                <div className="dp-row-main">
                  <div className="dp-row-headline">
                    {row.eventName} {row.type === 'single' ? t('rankings.single') : t('rankings.average')} - {fmtTime(row.value)}
                  </div>
                  <div className="dp-row-athlete">{row.athleteName}</div>
                </div>
                <span className="dp-clock">{fmtClock(row.submittedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scramble transparency modal — all 5 scrambles for the clicked entry */}
      {scrambleModal && (() => {
        const bestIdx = findBestSolveIdx(scrambleModal.solves);
        const scrambles = scrambleModal.scrambles ?? [];
        const hasAny = scrambles.some((s) => s);
        return (
          <div className="wca-modal-backdrop" onClick={() => setScrambleModal(null)}>
            <div
              className="wca-modal"
              style={{ maxWidth: '520px', borderColor: 'rgba(124,58,237,0.35)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="wca-modal-title">
                {eventNameMap[scrambleModal.eventId] || scrambleModal.eventId}
              </div>
              <div className="wca-modal-sub">
                {(athleteNameMap[scrambleModal.athleteId] || scrambleModal.athleteName || scrambleModal.athleteId)}
                {' · '}{scrambleModal.practiceDate}
                {' · Ao5 '}{fmtTime(scrambleModal.average)}
              </div>
              {hasAny ? (
                <div className="dp-scramble-list">
                  {scrambles.map((s, i) => (
                    <div key={i} className={`dp-scramble-row${i === bestIdx ? ' dp-scramble-best' : ''}`}>
                      <div className="dp-scramble-head">
                        <span className="dp-scramble-idx">S{i + 1}{i === bestIdx ? ` — ${t('rankings.single')}` : ''}</span>
                        <span className="dp-scramble-time">{fmtTime(scrambleModal.solves?.[i] ?? null)}</span>
                      </div>
                      <div className="dp-scramble-text">{s || '—'}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dp-scramble-empty">{t('daily-practice.no-scrambles')}</div>
              )}
              <div className="wca-modal-actions">
                <button className="wca-modal-btn" onClick={() => setScrambleModal(null)}>{t('daily-practice.close')}</button>
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        .section-tag {
          display: inline-flex; align-items: center; gap: 0.4rem;
          font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
          text-transform: uppercase; color: #a78bfa;
          background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
          padding: 0.28rem 0.8rem; border-radius: 999px; margin-bottom: 0.9rem;
        }
        .section-title { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; color: var(--text-primary); margin-bottom: 0.6rem; text-align: center; display: block; border-bottom: none; padding-bottom: 0; text-transform: none; letter-spacing: normal; }
        .section-title::before { display: none; }
        .section-desc { font-size: 1rem; color: var(--muted); max-width: 580px; margin: 0 auto; line-height: 1.65; }

        .dp-live-dot {
          width: 6px; height: 6px; border-radius: 50%; background: #4ade80;
          box-shadow: 0 0 6px #4ade80; animation: dpPulse 1.6s ease-in-out infinite;
        }
        @keyframes dpPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

        .dp-feed {
          display: flex; flex-direction: column; gap: 0.5rem;
          max-height: 480px; overflow-y: auto;
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 0.6rem;
          scrollbar-width: thin; scrollbar-color: var(--accent) transparent;
        }
        .dp-feed::-webkit-scrollbar { width: 8px; }
        .dp-feed::-webkit-scrollbar-track { background: transparent; }
        .dp-feed::-webkit-scrollbar-thumb {
          background: rgba(124,58,237,0.35); border-radius: 999px;
          border: 2px solid transparent; background-clip: padding-box;
        }
        .dp-feed::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,0.55); background-clip: padding-box; }
        .dp-row {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.65rem 0.75rem; border-radius: 10px;
          background: rgba(255,255,255,0.02);
          cursor: pointer; transition: background 0.15s, border-color 0.15s;
          border: 1px solid transparent;
        }
        .dp-row:hover { background: rgba(124,58,237,0.07); border-color: rgba(124,58,237,0.2); }
        .dp-tier-badge { flex-shrink: 0; font-family: monospace; }
        .dp-row-main { flex: 1; min-width: 0; }
        .dp-row-headline { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
        .dp-row-athlete { font-size: 0.78rem; color: var(--muted); margin-top: 0.15rem; }
        .dp-clock { flex-shrink: 0; font-size: 0.72rem; color: var(--muted); min-width: 7.5rem; text-align: right; white-space: nowrap; }

        .dp-scramble-list { max-height: 55vh; overflow-y: auto; margin: 0.9rem 0 1.1rem; }
        .dp-scramble-row {
          padding: 0.55rem 0.6rem; border-radius: 8px; margin-bottom: 0.4rem;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
        }
        .dp-scramble-row:last-child { margin-bottom: 0; }
        .dp-scramble-row.dp-scramble-best {
          background: rgba(124,58,237,0.1); border-color: rgba(124,58,237,0.35);
        }
        .dp-scramble-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.3rem; }
        .dp-scramble-idx { font-size: 0.7rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .dp-scramble-best .dp-scramble-idx { color: #a78bfa; }
        .dp-scramble-time { font-family: monospace; font-weight: 700; font-size: 0.85rem; color: var(--text); }
        .dp-scramble-text { font-family: monospace; font-size: 0.8rem; color: var(--muted); line-height: 1.5; }
        .dp-scramble-best .dp-scramble-text { color: var(--text); }
        .dp-scramble-empty { text-align: center; color: var(--muted); font-size: 0.85rem; padding: 1.5rem 0; }

        .spinner { width:32px;height:32px;border-radius:50%;border:3px solid rgba(124,58,237,0.2);border-top-color:var(--accent);animation:spin .8s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }
        .empty-state { text-align:center;padding:3rem 1rem;color:var(--muted);font-size:.95rem; }
        .empty-icon { font-size:2.5rem;margin-bottom:.7rem;opacity:.4; }

        @media (max-width: 700px) {
          #daily-practice { padding: 3rem 1rem; }
          #daily-practice > div { max-width: none; padding: 0; }
          .dp-row-headline { font-size: 0.82rem; }
          .dp-clock { display: none; }
        }
      `}</style>
    </section>
  );
}
