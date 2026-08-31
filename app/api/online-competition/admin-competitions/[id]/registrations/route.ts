import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';

export interface RegistrationAdminView {
  uid: string;
  displayName: string;
  events: string[];
}

// Admin-only listing for the competition detail page's "Тамирчид" tab.
// Registrations live at onlineParticipants/{uid}/registrations/
// {competitionId} — there's no per-competitionId collection-group index
// for that subcollection (and, at this project's current scale, adding
// one isn't worth it): this fetches the whole `registrations` collection
// group and filters by competitionId in memory, the same pragmatic
// approach the submissions list already uses for its "all statuses" case.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getOnlineCompAdminDb();

  const snap = await db.collectionGroup('registrations').get();
  // A `collectionGroup('registrations')` query matches every collection
  // named "registrations" anywhere in this Firestore database, not just
  // onlineParticipants/{uid}/registrations — confirmed live: this project
  // also has a completely unrelated top-level `registrations` collection
  // (a club membership/event signup form, fullName/phone/email/age
  // fields) that the same query pulls in. Only trust docs that are
  // actually nested two levels under onlineParticipants — anything else
  // (no grandparent, or a different grandparent collection) is filtered
  // out before even checking competitionId.
  const matches = snap.docs.filter(
    (d) => d.ref.parent.parent?.parent.id === 'onlineParticipants' && d.data().competitionId === id,
  );

  // registrations docs don't carry displayName themselves — join against
  // onlineParticipants/{uid} (the doc's own parent) for it.
  const uids = [...new Set(matches.map((d) => d.ref.parent.parent!.id))];
  const participantDocs = uids.length > 0
    ? await db.getAll(...uids.map((uid) => db.collection('onlineParticipants').doc(uid)))
    : [];
  const nameByUid = new Map(participantDocs.map((d) => [d.id, (d.data()?.displayName as string | undefined) ?? d.id]));

  const registrations: RegistrationAdminView[] = matches.map((d) => {
    const uid = d.ref.parent.parent!.id;
    const events = d.data().events;
    return {
      uid,
      displayName: nameByUid.get(uid) ?? uid,
      events: Array.isArray(events) ? events : [],
    };
  });

  return NextResponse.json({ registrations });
}
