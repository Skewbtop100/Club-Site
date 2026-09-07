import AdminGate from '../_components/AdminGate';
import ReviewDashboard from '../_components/ReviewDashboard';

// Cross-competition pending queue — ReviewDashboard with no competitionId,
// which its existing API call already supports. Same scope as the
// sidebar's "Шүүлт" badge and the overview page's queue preview.
export default function OnlineCompetitionAdminReviewPage() {
  return (
    <AdminGate current="review">
      <ReviewDashboard />
    </AdminGate>
  );
}
