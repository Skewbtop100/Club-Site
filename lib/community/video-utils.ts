// Parse a YouTube or Vimeo URL into the bits we need to embed it.
// Returns null for unrecognized URLs (caller treats as invalid input).
//
// Supported YouTube forms:
//   https://www.youtube.com/watch?v=ID
//   https://www.youtube.com/watch?v=ID&t=20s
//   https://youtu.be/ID
//   https://www.youtube.com/shorts/ID
//   https://www.youtube.com/live/ID
//   https://www.youtube.com/embed/ID
//   https://m.youtube.com/watch?v=ID
//
// Supported Vimeo forms:
//   https://vimeo.com/ID
//   https://vimeo.com/video/ID
//   https://player.vimeo.com/video/ID
//
// Vimeo thumbnails would require an unauthenticated oembed call —
// callers should treat empty thumbnail as "render the brand block."

export type VideoType = 'cloudinary' | 'youtube' | 'vimeo';

export interface ParsedVideo {
  type: 'youtube' | 'vimeo';  // cloudinary doesn't go through parsing
  url: string;
  embedUrl: string;
  thumbnail: string;
  videoId: string;
}

export function parseVideoUrl(input: string): ParsedVideo | null {
  const url = input.trim();
  if (!url) return null;

  // YouTube — covers watch?v=, youtu.be/, shorts/, live/, embed/.
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    const id = ytMatch[1];
    return {
      type: 'youtube',
      url,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      videoId: id,
    };
  }

  // Vimeo — accept vimeo.com/{id}, vimeo.com/video/{id}, player.vimeo.com/video/{id}.
  const vm = url.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/)?(\d+)/);
  if (vm) {
    const id = vm[1];
    return {
      type: 'vimeo',
      url,
      embedUrl: `https://player.vimeo.com/video/${id}`,
      thumbnail: '',
      videoId: id,
    };
  }

  return null;
}

/** When rendering a stored post, derive the iframe-ready embed URL. */
export function embedUrlForStored(
  videoUrl: string,
  videoType: VideoType,
): string | null {
  if (videoType === 'cloudinary') return null;
  const parsed = parseVideoUrl(videoUrl);
  return parsed ? parsed.embedUrl : null;
}
