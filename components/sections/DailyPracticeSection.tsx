'use client';

import { useMemo } from 'react';
import { useLang } from '@/lib/i18n';
import { DAILY_PRACTICE_COMPETITION_ID } from '@/lib/firebase/services/competitions';
import { getResultBadgesPair, getHighestBadge, BADGE_STYLES, type RecordBadge } from '@/lib/record-badges';
import { fmtTime, todayDateStr } from '@/lib/time-utils';
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

export default function DailyPracticeSection({ results, athletes, wcaRecords, loading }: Props) {
  const { t } = useLang();

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

  const todayLabel = todayDateStr();
  const todayEntries = useMemo(() => {
    return results
      .filter((r) => r.competitionId === DAILY_PRACTICE_COMPETITION_ID && r.practiceDate === todayLabel)
      .sort((a, b) => toMillis(b.submittedAt) - toMillis(a.submittedAt));
  }, [results, todayLabel]);

  // WCA-Live "Recent records" style: only entries that actually set a record
  // appear, and single/average are judged independently — an entry that PRs
  // on both produces two rows, one on neither produces zero. Judged against
  // the full merged list (competitions + all Daily Practice history), so a
  // practice Ao5 beating an official competition record shows the same tier.
  const recordRows = useMemo(() => {
    const rows: RecordRow[] = [];
    for (const r of todayEntries) {
      const eventName = eventNameMap[r.eventId] || r.eventId;
      const athleteName = athleteNameMap[r.athleteId] || r.athleteName || r.athleteId;
      const badges = getResultBadgesPair(r, results, wcaRecords);

      const singleTier = getHighestBadge(badges.single);
      if (singleTier && r.single !== null) {
        rows.push({ key: `${r.id}-single`, tier: singleTier, type: 'single', eventName, value: r.single, athleteName, submittedAt: r.submittedAt });
      }

      const avgTier = getHighestBadge(badges.average);
      if (avgTier && r.average !== null) {
        rows.push({ key: `${r.id}-average`, tier: avgTier, type: 'average', eventName, value: r.average, athleteName, submittedAt: r.submittedAt });
      }
    }
    return rows;
  }, [todayEntries, results, wcaRecords, eventNameMap, athleteNameMap]);

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
              <div className="dp-row" key={row.key}>
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
        }
        .dp-row {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.65rem 0.75rem; border-radius: 10px;
          background: rgba(255,255,255,0.02);
        }
        .dp-tier-badge { flex-shrink: 0; font-family: monospace; }
        .dp-row-main { flex: 1; min-width: 0; }
        .dp-row-headline { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
        .dp-row-athlete { font-size: 0.78rem; color: var(--muted); margin-top: 0.15rem; }
        .dp-clock { flex-shrink: 0; font-size: 0.72rem; color: var(--muted); min-width: 7.5rem; text-align: right; white-space: nowrap; }

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
