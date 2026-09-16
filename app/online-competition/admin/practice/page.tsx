import AdminGate from '../_components/AdminGate';
import PracticeReview from '../_components/PracticeReview';

// Туршилтын шүүлт — the practice area's review queue.
//
// ITS OWN ROUTE, deliberately not a tab of /admin/review: that screen is
// built around a competition, a round and a ranking, and a practice run has
// none of the three. See the header on PracticeReview for the whole of the
// reasoning.
export default function OnlineCompetitionAdminPracticePage() {
  return (
    <AdminGate current="practice">
      <PracticeReview />
    </AdminGate>
  );
}
