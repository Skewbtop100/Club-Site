import type { OnlineSeasonAthletePoints } from '@/lib/online-competition/types';
import { EmptyState } from '../ui';

// The athlete-directory block still has no data model behind it (a later
// phase) — only the leaderboard is real now, fed by the season-points
// recompute (lib/online-competition/seasonPoints.ts).
export default function Sidebar({
  season,
  leaderboard,
}: {
  season: string;
  leaderboard: OnlineSeasonAthletePoints[];
}) {
  return (
    <div className="oc-hub-right">
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span className="oc-mono-label">Онооны хүснэгт</span>
          <span style={{ font: '400 10px var(--oc-font-mono), monospace', color: '#A9A392' }}>
            {season ? season.toUpperCase() : ''}
          </span>
        </div>
        <div className="oc-hub-list" style={{ marginTop: 10 }}>
          {leaderboard.length === 0 ? (
            <EmptyState text="Онооны мэдээлэл алга." />
          ) : (
            leaderboard.map((athlete, i) => (
              <div key={athlete.uid} className="oc-hub-lb-row">
                <span className="oc-hub-lb-rank">{i + 1}</span>
                <span className="oc-hub-lb-name">{athlete.displayName}</span>
                <span className="oc-hub-lb-points">{athlete.totalPoints}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <span className="oc-mono-label">Тамирчид</span>
        <div className="oc-hub-list" style={{ marginTop: 10 }}>
          <EmptyState text="Тамирчны мэдээлэл алга." />
        </div>
      </section>
    </div>
  );
}
