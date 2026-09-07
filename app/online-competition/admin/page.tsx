import AdminGate from './_components/AdminGate';
import AdminOverview from './_components/AdminOverview';

// The admin section's landing page is now a dashboard overview; the
// competitions list moved to ./competitions.
export default function OnlineCompetitionAdminPage() {
  return (
    <AdminGate current="overview">
      <AdminOverview />
    </AdminGate>
  );
}
