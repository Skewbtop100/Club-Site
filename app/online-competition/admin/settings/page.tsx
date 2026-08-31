import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import LoginForm from '../_components/LoginForm';
import AdminHeader from '../_components/AdminHeader';

// Placeholder shell — no functional settings yet, just the route +
// nav entry so the admin section's information architecture is complete.
// Same auth gate / page chrome pattern as app/online-competition/admin
// /page.tsx.
export default async function OnlineCompetitionAdminSettingsPage() {
  const isAdmin = await isOnlineCompAdmin();

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
        <AdminHeader current="settings" />
        <h1 className="font-[family-name:var(--oc-font-heading)] text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
          Тохиргоо
        </h1>
        <p className="text-sm" style={{ marginTop: 8, color: 'var(--color-ink-faint)' }}>
          Тохиргооны хэсэг удахгүй нэмэгдэнэ.
        </p>
      </main>
    </div>
  );
}
