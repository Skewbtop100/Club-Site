import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { RegistrationPatchError, applyRegistrationPatch } from '@/lib/online-competition/admin-registrations';
import { parseStatusPatch } from '@/lib/online-competition/registration-review';

/** One registration: `{ status?, statusNote? }`. A blank or null
 *  statusNote clears it. The same transaction as the bulk route, with a
 *  list of one — so the two cannot drift in what they allow. The
 *  participant limit is NOT enforced (PR-4). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; uid: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id, uid } = await params;
  const parsed = parseStatusPatch(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    await applyRegistrationPatch(getOnlineCompAdminDb(), id, [uid], parsed.value);
    return NextResponse.json({ updated: 1 });
  } catch (err) {
    if (err instanceof RegistrationPatchError) {
      return NextResponse.json({ error: err.message, missing: err.missing }, { status: err.status });
    }
    throw err;
  }
}
