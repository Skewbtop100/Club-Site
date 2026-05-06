'use client';

import dynamic from 'next/dynamic';
import SectionTabs, { type SectionTab } from '@/components/admin/SectionTabs';

const AthletesTab      = dynamic(() => import('@/components/admin/AthletesTab'),      { ssr: false });
const EventSettingsTab = dynamic(() => import('@/components/admin/EventSettingsTab'), { ssr: false });
const NavigationTab    = dynamic(() => import('@/components/admin/NavigationTab'),    { ssr: false });

const TABS: SectionTab[] = [
  { id: 'athletes',   labelKey: 'admin.tab.athletes',   render: () => <AthletesTab /> },
  { id: 'events',     labelKey: 'admin.tab.events',     render: () => <EventSettingsTab /> },
  { id: 'navigation', labelKey: 'admin.tab.navigation', render: () => <NavigationTab /> },
];

export default function AdminClubPage() {
  return <SectionTabs tabs={TABS} />;
}
