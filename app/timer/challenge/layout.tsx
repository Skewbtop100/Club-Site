import type { ReactNode } from 'react';
import ComingSoonScreen from '@/components/timer/ComingSoonScreen';
import { TIMER_FEATURES } from '@/lib/timer-features';

// Gate for /timer/challenge/**: while TIMER_FEATURES.challenge is off, the
// pages below never render (no Firestore reads).
export default function ChallengeLayout({ children }: { children: ReactNode }) {
  if (!TIMER_FEATURES.challenge) return <ComingSoonScreen title="Challenge" />;
  return children;
}
