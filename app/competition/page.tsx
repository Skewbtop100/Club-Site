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
  console.log('Competition page rendering');
  const { competitions, loading: compsLoading } = useCompetitions();
  console.log('competitions:', competitions);
  const { results, loading: resultsLoading } = useResults(competitions);
  console.log('results:', results);
  const { athletes, loading: athletesLoading } = useAthletes();
  console.log('athletes:', athletes);
  const eventVisibility = useEventVisibility();
  const wcaRecords = useWcaRecords();

  return (
    <>
      <HeroSection />
      <RankingsSection
        results={results}
        athletes={athletes}
        competitions={competitions}
        wcaRecords={wcaRecords}
        eventVisibility={eventVisibility}
      />
      <RecordsSection
        results={results}
        athletes={athletes}
        competitions={competitions}
        eventVisibility={eventVisibility}
      />
      <CompetitionsSection
        competitions={competitions}
        athletes={athletes}
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
