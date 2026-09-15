import AdminGate from '../../_components/AdminGate';
import DraftCompetitions from '../../_components/DraftCompetitions';

// Шинэ тэмцээн: competitions not yet announced, and the way in to create one.
// The create form itself stays at /competitions/new. A static segment, so it
// takes precedence over the sibling [id] route.
export default function OnlineCompetitionAdminDraftsPage() {
  return (
    <AdminGate current="newCompetition">
      <DraftCompetitions />
    </AdminGate>
  );
}
