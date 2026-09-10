import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import {
  RegistrationPatchError,
  applyRegistrationPatch,
  listCompetitionRegistrations,
} from '@/lib/online-competition/admin-registrations';
import { parseBulkPatch } from '@/lib/online-competition/registration-review';

// Admin-only registrations for one competition: the review table's data
// (GET) and its bulk action (PATCH). The single-registration change is
// ./[uid]/route.ts. Both writes go through applyRegistrationPatch — the
// only code that may set a registration's status or statusNote.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const registrations = await listCompetitionRegistrations(getOnlineCompAdminDb(), id);
  return NextResponse.json({ registrations });
}

/** Bulk: `{ uids: string[], status?, statusNote? }`. ALL OR NOTHING — see
 *  applyRegistrationPatch for why. The participant limit is NOT enforced
 *  (PR-4). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const parsed = parseBulkPatch(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const updated = await applyRegistrationPatch(getOnlineCompAdminDb(), id, parsed.value.uids, parsed.value.patch);
    return NextResponse.json({ updated });
  } catch (err) {
    if (err instanceof RegistrationPatchError) {
      return NextResponse.json({ error: err.message, missing: err.missing }, { status: err.status });
    }
    throw err;
  }
}
