import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import LoginForm from './_components/LoginForm';
import AdminTabs from './_components/AdminTabs';

// Server Component gate — checks the httpOnly admin cookie before
// rendering anything. Not the club's admin auth system: this page is
// gated by a single shared password (see lib/online-competition/admin-auth
// .ts and app/api/online-competition/admin-auth/route.ts), isolated from
// app/admin/ and useAdminAuth entirely.
//
// bg/text colors are set explicitly here (v2 "paper/ink" system) rather
// than on the shared oc-theme wrapper in app/online-competition/layout.tsx,
// because that wrapper's dark bg/text (v1 system) is still relied on by
// app/online-competition/[competitionId]/page.tsx, which isn't migrated to
// v2 this phase. The outer div here is full-bleed (min-h-screen w-full, no
// max-width) so the paper background actually covers the whole viewport —
// the narrower content column inside it only limits content width, not
// the background underneath it.
//
// The content column's max-width/centering/padding are set via inline
// `style`, not Tailwind's `mx-auto`/`max-w-*`/`px-*` classes, on purpose:
// app/globals.css has `*, *::before, *::after { margin: 0; padding: 0; }`
// as plain, unlayered CSS (outside any @layer), while Tailwind's utility
// classes live inside `@layer utilities`. Per the CSS Cascade Layers spec
// an unlayered rule always wins over a layered one regardless of
// specificity, so that reset silently zeroes out `mx-auto`'s margins and
// every `px-*`/`py-*` padding utility here — confirmed by inspecting
// getComputedStyle() in a real browser: `margin-left`/`margin-right`/
// `padding-left`/`padding-right` all computed to 0px despite the classes
// being present. Inline styles always win over any class regardless of
// layer, so that's what actually centers/pads this element.
export default async function OnlineCompetitionAdminPage() {
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
        <AdminTabs />
      </main>
    </div>
  );
}
