import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import LoginForm from './LoginForm';
import AdminShell, { AdminMark, type AdminSection } from './AdminShell';

// Shared auth gate + chrome for every admin route. The gate itself is
// unchanged: the same httpOnly shared-password cookie check that each
// page used to run inline (see lib/online-competition/admin-auth.ts) —
// this only removes five copies of it, and swaps the old AdminHeader
// top-tab shell for the sidebar one.
export default async function AdminGate({
  current,
  children,
}: {
  current: AdminSection;
  children: React.ReactNode;
}) {
  if (!(await isOnlineCompAdmin())) {
    return (
      <div className="min-h-screen w-full" style={{ background: '#08080A', color: '#F4F1EA' }}>
        <main
          className="flex min-h-screen flex-col items-center justify-center"
          style={{ maxWidth: 384, margin: '0 auto', padding: '0 16px' }}
        >
          <div style={{ border: '1px solid #1C1C21', background: '#0D0D10', padding: 32, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AdminMark />
              <span className="oc-adm-wordmark">ХОРОМ</span>
            </div>
            <span className="oc-adm-sublabel" style={{ marginTop: 6 }}>
              АДМИН ТАЛБАР
            </span>
            <div style={{ marginTop: 24 }}>
              <LoginForm />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return <AdminShell current={current}>{children}</AdminShell>;
}
