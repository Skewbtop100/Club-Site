import AdminGate from '../_components/AdminGate';
import VerifiedAthletesTable from '../_components/VerifiedAthletesTable';

// Тамирчдын бүртгэл — verified athletes. Pending verification requests are
// their own page: ./requests.
export default function OnlineCompetitionAdminAthletesPage() {
  return (
    <AdminGate current="athletes">
      <VerifiedAthletesTable />
    </AdminGate>
  );
}
