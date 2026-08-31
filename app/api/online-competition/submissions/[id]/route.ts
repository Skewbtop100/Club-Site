import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';

// Deletes a submission — Admin SDK only, same reasoning as
// app/api/online-competition/review/route.ts (no Firebase Auth admin
// identity here; the dashboard is gated by the shared password cookie,
// and client-side Firestore rules deny direct deletes from every client).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getOnlineCompAdminDb();
  const ref = db.collection('onlineSubmissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const cloudinaryPublicId = snap.data()?.cloudinaryPublicId as string | undefined;

  await ref.delete();

  // Best-effort Cloudinary cleanup — never blocks the Firestore delete
  // above (which is what the dashboard actually reflects) since a
  // Cloudinary hiccup shouldn't leave a "deleted" submission still
  // showing up for the admin.
  //
  // TODO: CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET (server-only) aren't
  // configured yet — only NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and
  // NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET exist, for the client's unsigned
  // upload. Add both (Cloudinary Console -> Settings -> Access Keys) to
  // actually remove the underlying video asset; until then, deleted
  // submissions' videos remain as orphaned Cloudinary assets.
  let cloudinaryDeleted = false;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (apiKey && apiSecret && cloudName && cloudinaryPublicId) {
    try {
      const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/resources/video/upload?public_ids[]=${encodeURIComponent(cloudinaryPublicId)}`,
        { method: 'DELETE', headers: { Authorization: `Basic ${auth}` } },
      );
      cloudinaryDeleted = res.ok;
    } catch {
      // Swallow — see comment above.
    }
  }

  return NextResponse.json({ ok: true, cloudinaryDeleted });
}
