'use client';

import dynamic from 'next/dynamic';
import SectionTabs, { type SectionTab } from '@/components/admin/SectionTabs';

const VirtualCompetitionsTab = dynamic(
  () => import('@/components/admin/VirtualCompetitionsTab'),
  { ssr: false },
);

const TABS: SectionTab[] = [
  {
    id: 'virtual-competitions',
    labelKey: 'admin.tab.virtual-competitions',
    render: () => <VirtualCompetitionsTab />,
  },
];

export default function AdminTimerPage() {
  return <SectionTabs tabs={TABS} />;
}
