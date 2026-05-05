// Cloudinary upload + URL transformation helpers for community images.
//
// Setup:
//   1. In your Cloudinary dashboard, create an Unsigned upload preset
//      named `community_unsigned` (or override via env var). Set the
//      preset's "Folder" to `community` and "Signing Mode" to Unsigned.
//   2. Optionally set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and
//      NEXT_PUBLIC_CLOUDINARY_COMMUNITY_PRESET in .env to override the
//      defaults below.
//
// Notes:
//   * Uploads are unsigned (browser → Cloudinary directly). The preset
//     is the only thing protecting from arbitrary uploads, so configure
//     allowed formats + max file size on the preset itself if you want
//     server-side guardrails beyond the client-side checks.
//   * Compression is applied at delivery time via URL transformations,
//     not at upload time. One source asset → many sized variants.
//   * Orphan cleanup is a TODO — see InlineCompose: if a user uploads
//     images and then cancels without submitting, the assets remain in
//     Cloudinary. With 25 GB free we can defer.

const CLOUD_NAME =
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? 'dzq3strz5';
const COMMUNITY_PRESET =
  process.env.NEXT_PUBLIC_CLOUDINARY_COMMUNITY_PRESET ?? 'community_unsigned';

export interface CloudinaryUploadResult {
  publicId: string;
  url: string;     // secure_url returned by Cloudinary (canonical, unsized)
  width: number;
  height: number;
}

export const COMMUNITY_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const COMMUNITY_IMAGE_MAX_PER_POST = 5;
export const COMMUNITY_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Unsigned XHR upload to Cloudinary. Reports progress 0-100. */
export function uploadCommunityImage(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText);
          resolve({
            publicId: json.public_id,
            url: json.secure_url,
            width: json.width,
            height: json.height,
          });
        } catch (e) {
          reject(e);
        }
      } else {
        let msg = `Cloudinary upload failed (${xhr.status})`;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j?.error?.message) msg = j.error.message;
        } catch { /* ignore parse error */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));

    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', COMMUNITY_PRESET);
    fd.append('folder', 'community');
    xhr.send(fd);
  });
}

/** Insert a transformation segment into a Cloudinary delivery URL. No-op
 * for non-Cloudinary URLs. */
function cldTransform(url: string, transformation: string): string {
  if (!url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/${transformation}/`);
}

/** Small square thumbnail (compose preview, future avatars). */
export const cldThumb = (url: string, w = 200) =>
  cldTransform(url, `q_auto:good,f_auto,w_${w},c_fill,ar_1:1`);

/** Mid-size variant for the in-feed grid. */
export const cldGrid = (url: string, w = 800) =>
  cldTransform(url, `q_auto:good,f_auto,w_${w}`);

/** Full-size delivery for the lightbox. */
export const cldFull = (url: string, w = 1600) =>
  cldTransform(url, `q_auto:good,f_auto,w_${w}`);
