import type { ReactNode } from 'react';
import ComingSoonScreen from '@/components/timer/ComingSoonScreen';
import { TIMER_FEATURES } from '@/lib/timer-features';

// Gate for every /timer/competitions/** route. While competitions are
// closed none of the pages below render (so no Firestore reads); flip
// TIMER_FEATURES.competition to re-open them.
export default function CompetitionsLayout({ children }: { children: ReactNode }) {
  if (!TIMER_FEATURES.competition) return <ComingSoonScreen title="Competition" />;
  return children;
}
