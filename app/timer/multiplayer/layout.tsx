import type { ReactNode } from 'react';
import ComingSoonScreen from '@/components/timer/ComingSoonScreen';
import { TIMER_FEATURES } from '@/lib/timer-features';

// Gate for /timer/multiplayer. While racing is closed the page below is
// never rendered (so no Realtime DB listeners start); flip
// TIMER_FEATURES.racing to re-open it.
export default function MultiplayerLayout({ children }: { children: ReactNode }) {
  if (!TIMER_FEATURES.racing) return <ComingSoonScreen title="Racing" />;
  return children;
}
