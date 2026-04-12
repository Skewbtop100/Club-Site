'use client';

import { useCompetitions } from '@/lib/hooks/useCompetitions';
import { useResults } from '@/lib/hooks/useResults';
import { useAthletes } from '@/lib/hooks/useAthletes';
import { useEventVisibility } from '@/lib/hooks/useEventVisibility';
import { useWcaRecords } from '@/lib/hooks/useWcaRecords';

import HeroSection from '@/components/sections/HeroSection';
import RankingsSection from '@/components/sections/RankingsSection';
import RecordsSection from '@/components/sections/RecordsSection';
import CompetitionsSection from '@/components/sections/CompetitionsSection';
import AthletesSection from '@/components/sections/AthletesSection';
import Footer from '@/components/layout/Footer';

export default function CompetitionPage() {
  const { competitions, loading: compsLoading } = useCompetitions();
  const { results, loading: resultsLoading } = useResults(competitions);
  const { athletes, loading: athletesLoading } = useAthletes();
  const eventVisibility = useEventVisibility();
  const wcaRecords = useWcaRecords();

  return (
    <>
      <HeroSection />
      <RankingsSection
        results={results}
        athletes={athletes}
        wcaRecords={wcaRecords}
        eventVisibility={eventVisibility}
      />
      <RecordsSection
        results={results}
        athletes={athletes}
        eventVisibility={eventVisibility}
      />
      <CompetitionsSection
        competitions={competitions}
        loading={compsLoading}
      />
      <AthletesSection
        athletes={athletes}
        results={results}
        loading={athletesLoading || resultsLoading}
      />
      <Footer />
    </>
  );
}
