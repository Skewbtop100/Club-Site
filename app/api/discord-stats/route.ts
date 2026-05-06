import { NextResponse } from 'next/server';

// Cache for 5 minutes — Discord rate limits are generous but no point
// hammering the API.
export const revalidate = 300;

export async function GET() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const serverId = process.env.DISCORD_SERVER_ID;
  if (!token || !serverId) {
    return NextResponse.json(
      { error: 'Discord not configured' },
      { status: 500 },
    );
  }
  try {
    // with_counts=true returns approximate_member_count +
    // approximate_presence_count without needing a privileged scope
    const url = `https://discord.com/api/v10/guilds/${serverId}?with_counts=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bot ${token}` },
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Discord API ${res.status}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    return NextResponse.json({
      total: data.approximate_member_count ?? 0,
      online: data.approximate_presence_count ?? 0,
    });
  } catch {
    return NextResponse.json(
      { error: 'Fetch failed' },
      { status: 500 },
    );
  }
}
