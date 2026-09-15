import { redirect } from 'next/navigation';

// This page was the season-points table. Season points were removed; the
// URL is kept so saved and shared links still land somewhere, and sends
// them to the competitions list. The nav no longer links here.
//
// The full /online-competition path, so the redirect resolves on the
// comp.* subdomain too (middleware passes /online-competition/* through).
export default function RankPage() {
  redirect('/online-competition/competitions');
}
