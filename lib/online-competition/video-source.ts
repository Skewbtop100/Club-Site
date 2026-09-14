// ── Where a submission's video plays from ──────────────────────────────
// THE ONE PLACE THIS IS DECIDED. Two storage schemes coexist permanently:
// every submission filed before videos moved to R2 carries a Cloudinary
// `videoUrl`, and everything since carries an R2 `videoKey`. Nothing that
// renders a submission video may read either field directly — it asks
// here, so the two schemes can never be handled differently in two
// places.
//
// THE KEY IS STORED, NOT THE URL, deliberately. A stored URL freezes
// today's public hostname into every document; the day the bucket moves
// to a custom domain, every one of them would point at the old host.
// Building the URL at read time from NEXT_PUBLIC_R2_PUBLIC_URL means that
// move is one environment variable.

export interface VideoSourceFields {
  videoKey?: string | null;
  videoUrl?: string | null;
}

/** The URL to play, or null when there is nothing playable.
 *
 *  An R2 key wins whenever there is a public base to build it on. Without
 *  a key — or with a key but no configured base — the stored Cloudinary
 *  URL is used if present. Null only when neither exists, which the
 *  caller renders as a player with no source rather than guessing. */
export function resolveVideoSrc(
  sub: VideoSourceFields,
  publicBase: string | undefined = process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
): string | null {
  const key = typeof sub.videoKey === 'string' ? sub.videoKey.trim() : '';
  const base = typeof publicBase === 'string' ? publicBase.trim().replace(/\/+$/, '') : '';
  if (key && base) {
    // Encoded per SEGMENT: the slashes are structure and must survive,
    // anything inside a segment must not be able to become structure.
    const path = key
      .split('/')
      .filter((part) => part.length > 0)
      .map(encodeURIComponent)
      .join('/');
    return `${base}/${path}`;
  }
  const url = typeof sub.videoUrl === 'string' ? sub.videoUrl.trim() : '';
  return url.length > 0 ? url : null;
}
