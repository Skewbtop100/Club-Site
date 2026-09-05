import Link from 'next/link';
import type { OnlineSeasonAthletePoints } from '@/lib/online-competition/types';
import EmptyBlock from './EmptyBlock';

const HUB = '/online-competition';

/** Season points table — fed by fetchSeasonLeaderboard (the admin
 *  points-recompute writes onlineSeasonPoints/{season}/athletes). */
export default function LeaderboardCard({
  season,
  leaderboard,
}: {
  season: string;
  leaderboard: OnlineSeasonAthletePoints[];
}) {
  return (
    <div className="oc-v3-card">
      <div className="oc-v3-card-head oc-v3-card-head-sm">
        <span className="oc-v3-label">Онооны хүснэгт</span>
        {season && <span className="oc-v3-season">{season.toUpperCase()}</span>}
      </div>

      {leaderboard.length === 0 ? (
        <EmptyBlock text="Онооны мэдээлэл алга." />
      ) : (
        leaderboard.map((athlete, i) => (
          <div key={athlete.uid} className="oc-v3-lb-row">
            <span className={`oc-v3-lb-rank${i < 3 ? ' oc-v3-lb-rank-top' : ''}`}>{i + 1}</span>
            <span className="oc-v3-lb-name">{athlete.displayName}</span>
            {/* No trend indicator: there is no previous-period snapshot to
                compare against, and inventing up/down/flat arrows would be
                fabricated data. */}
            <span className="oc-v3-lb-points">{athlete.totalPoints}</span>
          </div>
        ))
      )}

      {/* Same destination as the "Ранк" tab — no standalone leaderboard
          route exists yet. */}
      <Link href={HUB} className="oc-v3-lb-all">
        БҮГДИЙГ ХАРАХ
      </Link>
    </div>
  );
}
