import { NextResponse } from 'next/server';

// Proxies worldcubeassociation.org's public persons API (no auth required,
// CORS is wide open there — but routing it through our own server lets us
// share one 24h cache across every visitor instead of every browser hitting
// WCA's API independently. WCA ranks only change when new competition
// results get published in batches, so a day-long cache is safe.
export async function GET(req: Request) {
  const wcaId = new URL(req.url).searchParams.get('wcaId');
  if (!wcaId) {
    return NextResponse.json({ error: 'Missing wcaId param' }, { status: 400 });
  }
  try {
    const res = await fetch(
      `https://www.worldcubeassociation.org/api/v0/persons/${encodeURIComponent(wcaId)}`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) {
      return NextResponse.json({ error: `WCA API returned ${res.status}` }, { status: res.status === 404 ? 404 : 502 });
    }
    const data = await res.json();
    return NextResponse.json({ personalRecords: data.personal_records ?? {} });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
