import type { OnlineCompetition } from '@/lib/online-competition/types';
import { toMillisOrNull } from '../../_components/hub/format';

export type EventRowState = 'done' | 'live' | 'idle' | 'dns';

// TODO: derive "done"/"dns" from actual submission/result data once that
// model exists. For now this only distinguishes idle vs live, purely from
// whether the competition's startAt has passed — the schema has no
// per-event scheduling yet, so every event within one competition shares
// its startAt and gets the same idle/live state here.
export function deriveEventState(competition: OnlineCompetition): EventRowState {
  const startMs = toMillisOrNull(competition.startAt);
  if (startMs === null) return 'idle';
  return Date.now() >= startMs ? 'live' : 'idle';
}
