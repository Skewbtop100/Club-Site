'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type AdminSection =
  | 'overview'
  | 'competitions'
  | 'newCompetition'
  | 'athletes'
  | 'athleteRequests'
  | 'review'
  | 'scrambles'
  | 'rounds'
  | 'settings';

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
  /** Verified athletes — Тамирчдын бүртгэл. */
  approvedAthletes: number | null;
  /** Pending verification requests — Бүртгэлийн хүсэлт. */
  athletes: number | null;
  review: number | null;
}

// ── The two groups ───────────────────────────────────────────────────────
// design-mockups/Khorom Admin.dc.html: Хяналтын самбар alone above, then the
// Тэмцээн and Тамирчид groups, then Тохиргоо below. Бүртгэлийн хүсэлт is the
// athlete-verification queue (/athletes/requests).

type GroupKey = 'competitions' | 'athletes';

const GROUP_OF: Partial<Record<AdminSection, GroupKey>> = {
  competitions: 'competitions',
  newCompetition: 'competitions',
  scrambles: 'competitions',
  rounds: 'competitions',
  review: 'competitions',
  athletes: 'athletes',
  athleteRequests: 'athletes',
};

/** Which groups the admin has opened, for this browser tab. */
const OPEN_KEY = 'oc-adm-nav-open';

/** Persistent admin chrome: a fixed left rail on desktop, a slide-in
 *  drawer below 640px. Replaces the old AdminHeader top-tab strip.
 *
 *  Badge counts are real: competitions from admin-competitions, athletes
 *  from admin-athletes?status=pending, review from
 *  submissions?status=pending with NO competitionId — i.e. the
 *  cross-competition pending queue, the same scope the "Шүүлт" route and
 *  the overview page's queue preview use. A failed count shows "—". */
export default function AdminShell({
  current,
  children,
}: {
  current: AdminSection;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts>({ competitions: null, approvedAthletes: null, athletes: null, review: null });

  // ── Group open state ──
  // The group holding the current page is ALWAYS open on load. Any other
  // group the admin opened is remembered for the browser TAB
  // (sessionStorage): every admin page mounts its own shell, so without it
  // each navigation would close what was just opened — while a new session
  // starts from the plain "current group open" state rather than one left
  // from days ago. Read after mount, so the server render and the first
  // client render agree.
  const currentGroup = GROUP_OF[current] ?? null;
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({
    competitions: currentGroup === 'competitions',
    athletes: currentGroup === 'athletes',
  });

  useEffect(() => {
    let stored: Partial<Record<GroupKey, unknown>> = {};
    try {
      stored = JSON.parse(window.sessionStorage.getItem(OPEN_KEY) ?? '{}') ?? {};
    } catch {
      // Storage unavailable or unreadable: just the current group.
    }
    setOpenGroups({
      competitions: currentGroup === 'competitions' || stored.competitions === true,
      athletes: currentGroup === 'athletes' || stored.athletes === true,
    });
  }, [currentGroup]);

  const toggleGroup = useCallback((group: GroupKey) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [group]: !prev[group] };
      try {
        window.sessionStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // Not remembered; the toggle itself still works.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const num = (r: Response, key: string) =>
      r.ok ? r.json().then((d: Record<string, unknown[]>) => (d[key] ?? []).length) : Promise.resolve(null);
    Promise.all([
      fetch(`/api/online-competition/admin-competitions`).then((r) => num(r, 'competitions')).catch(() => null),
      fetch(`/api/online-competition/admin-athletes?status=approved`).then((r) => num(r, 'athletes')).catch(() => null),
      fetch(`/api/online-competition/admin-athletes?status=pending`).then((r) => num(r, 'athletes')).catch(() => null),
      fetch(`/api/online-competition/submissions?status=pending`).then((r) => num(r, 'submissions')).catch(() => null),
    ]).then(([competitions, approvedAthletes, athletes, review]) => {
      if (!cancelled) setCounts({ competitions, approvedAthletes, athletes, review });
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

          <NavGroup
            id="competitions"
            label="Тэмцээн"
            open={openGroups.competitions}
            holdsCurrent={currentGroup === 'competitions'}
            onToggle={() => toggleGroup('competitions')}
          >
            <NavChild
              href={`${ADMIN}/competitions`}
              label="Тэмцээнүүд"
              active={current === 'competitions'}
              count={counts.competitions}
            />
            <NavChild href={`${ADMIN}/competitions/new`} label="Шинэ тэмцээн" active={current === 'newCompetition'} />
            <NavChild href={`${ADMIN}/scrambles`} label="Холилт ба групп" active={current === 'scrambles'} />
            <NavChild href={`${ADMIN}/rounds`} label="Раунд удирдах" active={current === 'rounds'} />
            <NavChild
              href={`${ADMIN}/review`}
              label="Шүүлт"
              active={current === 'review'}
              count={counts.review}
              urgent
            />
          </NavGroup>

          <NavGroup
            id="athletes"
            label="Тамирчид"
            open={openGroups.athletes}
            holdsCurrent={currentGroup === 'athletes'}
            onToggle={() => toggleGroup('athletes')}
          >
            {/* Verified athletes, counted plainly — as the mockup has it. */}
            <NavChild
              href={`${ADMIN}/athletes`}
              label="Тамирчдын бүртгэл"
              active={current === 'athletes'}
              count={counts.approvedAthletes}
            />
            {/* Pending verification requests — volt while any wait. */}
            <NavChild
              href={`${ADMIN}/athletes/requests`}
              label="Бүртгэлийн хүсэлт"
              active={current === 'athleteRequests'}
              count={counts.athletes}
              urgent
            />
          </NavGroup>

          <NavItem href={`${ADMIN}/settings`} label="Тохиргоо" active={current === 'settings'} />
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
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`oc-adm-navitem${active ? ' oc-adm-navitem-active' : ''}`}
    >
      {label}
      {count !== undefined && <span className="oc-adm-navcount">{count ?? '—'}</span>}
    </Link>
  );
}

/** A group header and, while open, its children. The header is lit
 *  (#131318) when the group holds the current page, whether or not it is
 *  open, so a collapsed group still says "you are in here". */
function NavGroup({
  id,
  label,
  open,
  holdsCurrent,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  holdsCurrent: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const listId = `oc-adm-navgroup-${id}`;
  return (
    <>
      <button
        type="button"
        className={`oc-adm-navgroup${holdsCurrent ? ' oc-adm-navgroup-current' : ''}`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
      >
        <span>{label}</span>
        {/* Open: a volt triangle pointing up. Closed: a muted one pointing
            down. The mockup's exact 4px/5px geometry. */}
        <span
          aria-hidden
          style={{
            width: 0,
            height: 0,
            flex: 'none',
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            ...(open ? { borderBottom: '5px solid #DFFF4F' } : { borderTop: '5px solid #6E6A62' }),
          }}
        />
      </button>
      {open && (
        <div id={listId} className="oc-adm-navchildren">
          {children}
        </div>
      )}
    </>
  );
}

function NavChild({
  href,
  label,
  active,
  count,
  urgent = false,
}: {
  href: string;
  label: string;
  active: boolean;
  count?: number | null;
  /** Volt when above zero — something is waiting on the admin. */
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`oc-adm-navchild${active ? ' oc-adm-navchild-active' : ''}`}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className="oc-adm-navcount"
          style={{ flex: 'none', color: urgent && typeof count === 'number' && count > 0 ? '#DFFF4F' : undefined }}
        >
          {count ?? '—'}
        </span>
      )}
    </Link>
  );
}
