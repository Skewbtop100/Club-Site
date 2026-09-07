import { Suspense } from 'react';
import AdminGate from '../_components/AdminGate';
import RoundsManager from '../_components/RoundsManager';

// Round open / close / advance. Replaces the sidebar's disabled
// "Раунд удирдах (Удахгүй)" placeholder.
export default function OnlineCompetitionAdminRoundsPage() {
  return (
    <AdminGate current="rounds">
      {/* useSearchParams (?competitionId= from the review grid) needs a
          Suspense boundary in the App Router. */}
      <Suspense fallback={<p className="oc-v3-status">Ачааллаж байна...</p>}>
        <RoundsManager />
      </Suspense>
    </AdminGate>
  );
}
