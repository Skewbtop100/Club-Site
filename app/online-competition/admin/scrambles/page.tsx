import AdminGate from '../_components/AdminGate';
import ScramblesManager from '../_components/ScramblesManager';

// Official scramble import (WCA TNoodle JSON) + snake-seeded group
// assignment. Replaces the sidebar's disabled "Холилт ба групп (Удахгүй)"
// placeholder.
export default function OnlineCompetitionAdminScramblesPage() {
  return (
    <AdminGate current="scrambles">
      <ScramblesManager />
    </AdminGate>
  );
}
