'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type AdminSection =
  | 'overview'
  | 'competitions'
  | 'athletes'
  | 'review'
  | 'scrambles'
  | 'rounds'
  | 'settings'
  | 'testdata';

const ADMIN = '/online-competition/admin';

// Same 3x3 mark the public HubNav uses, at the sidebar's 6px scale.
const MARK = ['ink', 'ink', 'volt', 'ink', 'volt', 'ink', 'volt', 'ink', 'ink'] as const;
const MARK_COLOR = { ink: '#F4F1EA', volt: '#DFFF4F' } as const;

export function AdminMark({ size = 6 }: { size?: number }) {
  return (
    <span className="oc-adm-mark" style={{ gridTemplateColumns: `repeat(3, ${size}px)` }} aria-hidden>
      {MARK.map((tone, i) => (
        <span key={i} style={{ width: size, height: size, background: MARK_COLOR[tone] }} />
      ))}
    </span>
  );
}

interface Counts {
  competitions: number | null;
  athletes: number | null;
  review: number | null;
}

/** Persistent admin chrome: a fixed left rail on desktop, a slide-in
 *  drawer below 640px. Replaces the old AdminHeader top-tab strip.
 *
 *  Badge counts are real: competitions from admin-competitions, athletes
 *  from admin-athletes?status=pending, review from
 *  submissions?status=pending with NO competitionId — i.e. the
 *  cross-competition pending queue, the same scope the "Шүүлт" route and
 *  the overview page's queue preview use. */
export default function AdminShell({
  current,
  children,
}: {
  current: AdminSection;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts>({ competitions: null, athletes: null, review: null });

  useEffect(() => {
    let cancelled = false;
    const num = (r: Response, key: string) =>
      r.ok ? r.json().then((d: Record<string, unknown[]>) => (d[key] ?? []).length) : Promise.resolve(null);
    Promise.all([
      fetch(`/api/online-competition/admin-competitions`).then((r) => num(r, 'competitions')).catch(() => null),
      fetch(`/api/online-competition/admin-athletes?status=pending`).then((r) => num(r, 'athletes')).catch(() => null),
      fetch(`/api/online-competition/submissions?status=pending`).then((r) => num(r, 'submissions')).catch(() => null),
    ]).then(([competitions, athletes, review]) => {
      if (!cancelled) setCounts({ competitions, athletes, review });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the drawer on navigation.
  useEffect(() => {
    setOpen(false);
  }, [current]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/online-competition/admin-auth', { method: 'DELETE' });
    router.refresh();
  }, [router]);

  return (
    <div className="oc-adm-shell">
      <aside className={`oc-adm-side${open ? ' oc-adm-side-open' : ''}`}>
        <div className="oc-adm-brandblock" style={{ paddingTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AdminMark />
            <span className="oc-adm-wordmark">ХОРОМ</span>
          </div>
          <span className="oc-adm-sublabel" style={{ marginTop: 6 }}>
            АДМИН
          </span>
        </div>

        <nav className="oc-adm-navlist">
          <NavItem href={ADMIN} label="Хяналтын самбар" active={current === 'overview'} />
          <NavItem
            href={`${ADMIN}/competitions`}
            label="Тэмцээнүүд"
            active={current === 'competitions'}
            count={counts.competitions}
          />
          <NavItem href={`${ADMIN}/review`} label="Шүүлт" active={current === 'review'} count={counts.review} />
          <NavItem
            href={`${ADMIN}/athletes`}
            label="Тамирчид"
            active={current === 'athletes'}
            count={counts.athletes}
          />
          <NavItem href={`${ADMIN}/scrambles`} label="Холилт ба групп" active={current === 'scrambles'} />
          <NavItem href={`${ADMIN}/rounds`} label="Раунд удирдах" active={current === 'rounds'} />
          <NavItem href={`${ADMIN}/settings`} label="Тохиргоо" active={current === 'settings'} />
          {/* Last, and visually separated: this page seeds and wipes
              fixture data in the same collections real records live in. */}
          <Link
            href={`${ADMIN}/testdata`}
            className={`oc-adm-navitem oc-adm-navitem-test${current === 'testdata' ? ' oc-adm-navitem-active' : ''}`}
          >
            <span aria-hidden>⚠</span>
            Тест өгөгдөл
          </Link>
        </nav>

        <div className="oc-adm-sidefoot">
          {/* Auth here is a single shared password, not a per-admin
              identity, so there is no name or avatar to show. */}
          <span className="oc-adm-sublabel">АДМИН</span>
          <button type="button" className="oc-adm-signout" onClick={handleLogout}>
            ГАРАХ
          </button>
        </div>
      </aside>

      {open && (
        <button type="button" className="oc-adm-scrim" aria-label="Хаах" onClick={() => setOpen(false)} />
      )}

      <div className="oc-adm-side-gap" aria-hidden />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="oc-adm-topbar">
          <button type="button" className="oc-adm-burger" aria-label="Цэс" onClick={() => setOpen(true)}>
            <span />
            <span />
            <span />
          </button>
          <AdminMark />
          <span className="oc-adm-wordmark">ХОРОМ</span>
        </div>
        <main className="oc-adm-main">{children}</main>
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  active,
  count,
}: {
  href: string;
  label: string;
  active: boolean;
  count?: number | null;
}) {
  return (
    <Link href={href} className={`oc-adm-navitem${active ? ' oc-adm-navitem-active' : ''}`}>
      {label}
      {count !== undefined && <span className="oc-adm-navcount">{count ?? '—'}</span>}
    </Link>
  );
}
