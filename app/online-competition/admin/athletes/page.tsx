import AdminGate from '../_components/AdminGate';
import AthletesList from '../_components/AthletesList';

export default function OnlineCompetitionAdminAthletesPage() {
  return (
    <AdminGate current="athletes">
      <AthletesList />
    </AdminGate>
  );
}
