import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Stored at settings/navigation. The whole document is overwritten on
// every save (single source of truth, no merge logic). Falls back to
// getDefaultNavigation() while the doc doesn't exist or hasn't loaded.

export type NavStatus = 'active' | 'soon' | 'hidden';

export interface NavLink {
  id: string;
  label: string;
  href: string;
  status: NavStatus;
  featured: boolean;
  visible: boolean;
  order: number;
}

interface NavigationDoc {
  links: NavLink[];
}

const navigationDocRef = doc(db, 'settings', 'navigation');

/** Hard-coded fallback that mirrors the navbar's intended state when no
 * Firestore doc has been written yet. The first admin save replaces this
 * with whatever they configured. */
export function getDefaultNavigation(): NavLink[] {
  return [
    { id: 'timer',       label: 'Timer',       href: '/timer',       status: 'active', featured: true,  visible: true, order: 0 },
    { id: 'competition', label: 'Competition', href: '/competition', status: 'active', featured: false, visible: true, order: 1 },
    { id: 'community',   label: 'Community',   href: '/community',   status: 'soon',   featured: false, visible: true, order: 2 },
    { id: 'algorithms',  label: 'Algorithms',  href: '/algorithms',  status: 'soon',   featured: false, visible: true, order: 3 },
    { id: 'gallery',     label: 'Gallery',     href: '/gallery',     status: 'hidden', featured: false, visible: false, order: 4 },
  ];
}

function sortByOrder(links: NavLink[]): NavLink[] {
  return [...links].sort((a, b) => a.order - b.order);
}

/** Realtime subscription. Calls onChange with the default array whenever
 * the doc is missing, malformed, or fails to load — callers never need
 * to special-case "loading". */
export function subscribeNavigation(
  onChange: (links: NavLink[]) => void,
): () => void {
  return onSnapshot(
    navigationDocRef,
    (snap) => {
      if (!snap.exists()) {
        onChange(getDefaultNavigation());
        return;
      }
      const data = snap.data() as Partial<NavigationDoc> | undefined;
      const links = Array.isArray(data?.links) ? data!.links : null;
      onChange(links && links.length > 0 ? sortByOrder(links) : getDefaultNavigation());
    },
    () => onChange(getDefaultNavigation()),
  );
}

/** Persist the full link list. Caller is responsible for ensuring `order`
 * fields match array positions before calling. */
export async function updateNavigation(links: NavLink[]): Promise<void> {
  await setDoc(navigationDocRef, { links });
}
