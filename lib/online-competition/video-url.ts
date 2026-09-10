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
  /** Vimeo only: the privacy hash of an UNLISTED video — the `abc123` in
   *  vimeo.com/123456789/abc123, or the `h=` query parameter. The embed
   *  player refuses an unlisted video without it ("because of its privacy
   *  settings, this video cannot be played here"), so it has to survive
   *  the parse even though it is not part of the video's identity. */
  hash?: string;
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
  // Three shapes, tried most specific first:
  //
  //   vimeo.com/<id>[/<hash>]            a plain or UNLISTED video link
  //   player.vimeo.com/video/<id>[?h=]   an embed link
  //   vimeo.com/groups/x/videos/<id>,    a video inside a channel, group
  //   vimeo.com/channels/x/<id> ...      or showcase: the id is LAST
  //
  // The first shape used to fall through to the "last numeric segment"
  // scan too, which was wrong twice over: it discarded the unlisted hash
  // the embed needs, and a hash that happened to be all digits (it is
  // hex, so roughly 1 in 110 are) matched the id pattern and was taken
  // AS the id — a different video, or none. Reading the positions the
  // shapes actually define fixes both.
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const queryHash = cleanHash(url.searchParams.get('h'));

    if (host === 'player.vimeo.com') {
      return segments[0] === 'video' && segments[1] && VIMEO_ID.test(segments[1])
        ? withHash({ provider: 'vimeo', id: segments[1] }, queryHash)
        : null;
    }
    if (segments[0] && VIMEO_ID.test(segments[0])) {
      return withHash({ provider: 'vimeo', id: segments[0] }, cleanHash(segments[1]) ?? queryHash);
    }
    for (let i = segments.length - 1; i >= 0; i--) {
      if (VIMEO_ID.test(segments[i])) return withHash({ provider: 'vimeo', id: segments[i] }, queryHash);
    }
    return null;
  }

  return null;
}

/** A Vimeo privacy hash: hex, ten characters in every link seen so far,
 *  accepted from six to twenty. Hex rather than any alphanumeric run so a
 *  trailing path word ("vimeo.com/123456789/likes") is not mistaken for a
 *  hash and sent to the player as `h=likes` — and so nothing that could
 *  carry a path or query ever reaches the embed url. */
function cleanHash(raw: string | null | undefined): string | undefined {
  return typeof raw === 'string' && /^[0-9a-f]{6,20}$/i.test(raw) ? raw.toLowerCase() : undefined;
}

function withHash(parsed: ParsedVideo, hash: string | undefined): ParsedVideo {
  return hash ? { ...parsed, hash } : parsed;
}

/** The iframe src for a parsed video. Built ONLY from a ParsedVideo, never
 *  from the raw url, so nothing an admin typed reaches the iframe except an
 *  id and hash that already passed the strict patterns above.
 *
 *  Privacy defaults, both chosen because this is a public page that a
 *  visitor did not come to in order to be tracked by a video host:
 *
 *   YouTube — the youtube-nocookie.com host, YouTube's "privacy-enhanced
 *             mode": no tracking cookies are set until the viewer presses
 *             play. Same player, same controls.
 *   Vimeo   — `dnt=1`, Vimeo's do-not-track flag: the player sets no
 *             cookies and records no session data. An unlisted video's
 *             `h=` hash is carried, or the player refuses to play it. */
export function videoEmbedUrl(parsed: ParsedVideo): string {
  if (parsed.provider === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${parsed.id}`;
  }
  const params = new URLSearchParams({ dnt: '1' });
  if (parsed.hash) params.set('h', parsed.hash);
  return `https://player.vimeo.com/video/${parsed.id}?${params.toString()}`;
}

/** "YouTube · dQw4w9WgXcQ" — the readback shown under the url input, so
 *  the admin can see the link was understood and which video it resolved
 *  to before they save. */
export function describeVideo(parsed: ParsedVideo): string {
  return `${parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} · ${parsed.id}`;
}
