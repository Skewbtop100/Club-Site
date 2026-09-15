import AdminGate from '../../_components/AdminGate';
import AthleteRequests from '../../_components/AthleteRequests';

// Бүртгэлийн хүсэлт — pending athlete-verification requests. Admin-only via
// AdminGate; the decisions go through the existing
// POST /api/online-competition/admin-athletes/[uid].
export default function OnlineCompetitionAdminAthleteRequestsPage() {
  return (
    <AdminGate current="athleteRequests">
      <AthleteRequests />
    </AdminGate>
  );
}
