import AdminGate from '../../_components/AdminGate';
import CompetitionDetail from './_components/CompetitionDetail';

export default async function OnlineCompetitionAdminCompetitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminGate current="competitions">
      <CompetitionDetail competitionId={id} />
    </AdminGate>
  );
}
