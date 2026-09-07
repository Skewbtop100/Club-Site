import AdminGate from '../_components/AdminGate';
import TestDataManager from '../_components/TestDataManager';

// Seed / wipe realistic fixture data. Deliberately the last item in the
// sidebar and warning-tinted throughout — it writes to the same
// collections real competitions and athletes live in.
export default function OnlineCompetitionAdminTestDataPage() {
  return (
    <AdminGate current="testdata">
      <TestDataManager />
    </AdminGate>
  );
}
