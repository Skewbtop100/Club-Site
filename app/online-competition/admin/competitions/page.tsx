import AdminGate from '../_components/AdminGate';
import CompetitionsList from '../_components/CompetitionsList';

// Was app/online-competition/admin/page.tsx before the sidebar
// restructure; the component itself is unchanged.
export default function OnlineCompetitionAdminCompetitionsPage() {
  return (
    <AdminGate current="competitions">
      <CompetitionsList />
    </AdminGate>
  );
}
