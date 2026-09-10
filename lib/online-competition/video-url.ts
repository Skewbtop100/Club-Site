// ── YouTube / Vimeo URL parsing ─────────────────────────────────────────
// Shared by the section editor (which shows the parsed id back to the
// admin, so they can see the url was understood) and by
// validateCompetitionInput (which refuses a url it cannot parse). ONE
// rule, imported by both — a client that accepts a url the server rejects
// is a save that fails with no explanation.
//
// Pure: no DOM, no firebase-admin, no fetch. Nothing here contacts either
// provider, so a parsed id means "this is a well-formed link", NOT "this
// video exists". A typo'd but well-formed id is stored and fails at
// render time, which is the same trade the whole web makes.

export type VideoProvider = 'youtube' | 'vimeo';

export interface ParsedVideo {
  provider: VideoProvider;
  /** YouTube: the 11-char id. Vimeo: the numeric id, digits only. */
  id: string;
}

/** YouTube ids are exactly 11 chars of [A-Za-z0-9_-]. Anchored, so a
 *  longer path segment is a non-match rather than a truncated id — an id
 *  quietly cut to its first 11 characters would play the wrong video. */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
/** Vimeo ids are numeric. 6–12 digits covers every id in circulation
 *  without matching a stray year or page number. */
const VIMEO_ID = /^[0-9]{6,12}$/;

const YT_HOSTS = ['youtube.com', 'youtube-nocookie.com'];
/** The path prefixes YouTube serves a single video under. /watch is
 *  handled separately (its id is a query param, not a path segment). */
const YT_PATH_PREFIXES = ['embed', 'shorts', 'live', 'v'];

/** Parses a YouTube or Vimeo url into provider + id, or null if it is
 *  neither.
 *
 *  Deliberately FORGIVING about the wrapper and STRICT about the id:
 *  a missing scheme is filled in, `www.`/`m.` are ignored, and extra
 *  query params (`&t=30`, `?si=…`) are ignored — those are what an admin
 *  actually pastes out of a browser or a share sheet. The id itself must
 *  match its provider's shape exactly.
 *
 *  Returns null for everything else, including a non-video YouTube url
 *  (a channel, a playlist with no `v`), which is the case worth getting
 *  right: `youtube.com/playlist?list=…` is a real YouTube link that is
 *  not a video, and accepting it would store a section block that can
 *  never render. */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;

  let url: URL;
  try {
    // A pasted "youtu.be/xxxx" has no scheme; URL requires one. Anything
    // that already declares a scheme keeps it, so "ftp://…" still parses
    // and then fails the host check rather than being silently upgraded.
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');
  const segments = url.pathname.split('/').filter(Boolean);

  // ── youtu.be/<id> ──
  if (host === 'youtu.be') {
    return segments.length >= 1 && YT_ID.test(segments[0]) ? { provider: 'youtube', id: segments[0] } : null;
  }

  // ── youtube.com ──
  if (YT_HOSTS.includes(host)) {
    if (segments[0] === 'watch') {
      const v = url.searchParams.get('v') ?? '';
      return YT_ID.test(v) ? { provider: 'youtube', id: v } : null;
    }
    if (segments.length >= 2 && YT_PATH_PREFIXES.includes(segments[0]) && YT_ID.test(segments[1])) {
      return { provider: 'youtube', id: segments[1] };
    }
    return null;
  }

  // ── vimeo.com ──
  // The id is the LAST numeric segment, not the first: an unlisted link is
  // vimeo.com/<id>/<hash> (first wins) but a group link is
  // vimeo.com/groups/<name>/videos/<id> (last wins). Taking the last
  // numeric segment that looks like an id handles both, and the private
  // hash is not numeric so it never competes.
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (VIMEO_ID.test(segments[i])) return { provider: 'vimeo', id: segments[i] };
    }
    return null;
  }

  return null;
}

/** "YouTube · dQw4w9WgXcQ" — the readback shown under the url input, so
 *  the admin can see the link was understood and which video it resolved
 *  to before they save. */
export function describeVideo(parsed: ParsedVideo): string {
  return `${parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} · ${parsed.id}`;
}
