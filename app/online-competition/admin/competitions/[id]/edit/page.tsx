import AdminGate from '../../../_components/AdminGate';
import CompetitionEditor from '../../../_components/CompetitionEditor';

// Edit. Same component as /competitions/new, exactly as the old
// CompetitionForm served both create and edit from one file.
export default async function OnlineCompetitionAdminEditCompetitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminGate current="competitions">
      <CompetitionEditor competitionId={id} />
    </AdminGate>
  );
}
