'use client';

import dynamic from 'next/dynamic';
import SectionTabs, { type SectionTab } from '@/components/admin/SectionTabs';

// Lazy-load tab bodies — keeps the section page itself small and avoids
// pulling Firebase services for tabs the user never opens.
const CompetitionsTab = dynamic(() => import('@/components/admin/CompetitionsTab'), { ssr: false });
const ResultsEntryTab = dynamic(() => import('@/components/admin/ResultsEntryTab'), { ssr: false });
const CompResultsTab  = dynamic(() => import('@/components/admin/CompResultsTab'),  { ssr: false });
const HistoryTab      = dynamic(() => import('@/components/admin/HistoryTab'),      { ssr: false });
const WcaImportTab    = dynamic(() => import('@/components/admin/WcaImportTab'),    { ssr: false });
const DailyPracticeManageTab = dynamic(() => import('@/components/admin/DailyPracticeManageTab'), { ssr: false });

const TABS: SectionTab[] = [
  { id: 'competitions', labelKey: 'admin.tab.competitions', render: () => <CompetitionsTab /> },
  { id: 'results',      labelKey: 'admin.tab.results',      render: () => <ResultsEntryTab /> },
  { id: 'compResults',  labelKey: 'admin.tab.comp-results', render: () => <CompResultsTab /> },
  { id: 'dailyPractice', labelKey: 'admin.tab.daily-practice', render: () => <DailyPracticeManageTab /> },
  { id: 'history',      labelKey: 'admin.tab.history',      render: () => <HistoryTab /> },
  { id: 'wcaImport',    labelKey: 'admin.tab.wca-records',  render: () => <WcaImportTab /> },
];

export default function AdminCompetitionsPage() {
  return <SectionTabs tabs={TABS} />;
}
