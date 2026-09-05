import Link from 'next/link';
import type { OnlineCompetition } from '@/lib/online-competition/types';

/** Right-column companion to the hero — only rendered when a competition
 *  is actually live. */
export default function LiveMiniCard({ competition }: { competition: OnlineCompetition }) {
  const totalRounds = competition.events.reduce((sum, e) => sum + e.rounds, 0);
  const eventCodes = competition.events.map((e) => e.label).join(' · ');

  return (
    <div className="oc-v3-live-card">
      <div className="oc-v3-live-head">
        <span className="oc-v3-dot oc-v3-dot-lg" aria-hidden />
        <span
          style={{
            font: '700 10px var(--oc-font-mono), monospace',
            letterSpacing: '.24em',
            color: '#DFFF4F',
          }}
        >
          LIVE
        </span>
        <span style={{ flex: 1 }} />
        {/* The spec's participant count has no public data source (see
            LiveHero's note), so this slot carries the competition's real
            event count instead of an invented headcount. */}
        <span
          style={{
            font: '500 9px var(--oc-font-mono), monospace',
            letterSpacing: '.12em',
            color: '#6E6A62',
          }}
        >
          {competition.events.length} ТӨРӨЛ
        </span>
      </div>

      <div className="oc-v3-live-body">
        <p style={{ font: '600 17px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
          {competition.name}
        </p>

        {/* Round progress ("РАУНД 2 / 3" + a completion bar) needs a
            current-round field that doesn't exist on the competition doc
            yet — getNextEventRound() in lib/online-competition/data.ts is
            still a stub that always returns round 1. This line shows the
            configured events and total round count, both real; the
            progress bar is omitted rather than filled with a made-up
            percentage. */}
        {competition.events.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              font: '400 10px var(--oc-font-mono), monospace',
              color: '#6E6A62',
            }}
          >
            <span
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {eventCodes}
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>{totalRounds} РАУНД</span>
          </div>
        )}

        <Link href={`/online-competition/${competition.id}/details`} className="oc-v3-live-btn">
          Тэмцээнд орох
        </Link>
      </div>
    </div>
  );
}
