import AdminGate from '../../_components/AdminGate';
import CompetitionEditor from '../../_components/CompetitionEditor';

// Create. A static segment, so it takes precedence over the sibling
// [id] route — /competitions/new never resolves to a competition whose
// id happens to be "new".
export default function OnlineCompetitionAdminNewCompetitionPage() {
  return (
    <AdminGate current="competitions">
      <CompetitionEditor competitionId={null} />
    </AdminGate>
  );
}
