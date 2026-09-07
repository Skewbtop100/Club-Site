import { Suspense } from 'react';
import AdminGate from '../_components/AdminGate';
import ReviewGrid from '../_components/ReviewGrid';

// The single review destination. Competition selection happens in the
// dropdown at the top of the grid (optionally preselected via
// ?competitionId=), which is what let the competition-detail page drop its
// duplicate "Шүүгчийн самбар" tab.
export default function OnlineCompetitionAdminReviewPage() {
  return (
    <AdminGate current="review">
      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={<p className="oc-v3-status">Ачааллаж байна...</p>}>
        <ReviewGrid />
      </Suspense>
    </AdminGate>
  );
}
