import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import LoginForm from '../../_components/LoginForm';
import AdminHeader from '../../_components/AdminHeader';
import CompetitionDetail from './_components/CompetitionDetail';

// Same auth gate / page chrome pattern as app/online-competition/admin
// /page.tsx — see that file's comment for why colors/layout are set the
// way they are here.
export default async function OnlineCompetitionAdminCompetitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const isAdmin = await isOnlineCompAdmin();
  const { id } = await params;

  if (!isAdmin) {
    return (
      <div className="min-h-screen w-full" style={{ background: 'var(--color-paper)', color: 'var(--color-ink)' }}>
        <main
          className="flex min-h-screen flex-col items-center justify-center gap-6"
          style={{ maxWidth: 384, margin: '0 auto', padding: '0 16px' }}
        >
          <h1 className="font-[family-name:var(--oc-font-heading)] text-xl font-semibold">Шүүгчийн самбар</h1>
          <LoginForm />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full" style={{ background: 'var(--color-paper)', color: 'var(--color-ink)' }}>
      <main style={{ maxWidth: 1152, margin: '0 auto', padding: '32px 24px' }}>
        <AdminHeader current="detail" />
        <CompetitionDetail competitionId={id} />
      </main>
    </div>
  );
}
