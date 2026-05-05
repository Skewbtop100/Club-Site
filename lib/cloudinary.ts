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

export const COMMUNITY_VIDEO_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

// Delivery-side transformation. Cloudinary forbids `eager`/`eager_async`
// for unsigned uploads, so the eager pipeline is configured on the
// `community_unsigned` preset itself in the Cloudinary console. This
// constant is only used by cldVideo() to build the optimized delivery URL.
const COMMUNITY_VIDEO_DELIVERY = 'vc_h264,c_limit,h_720,q_auto:good,f_mp4';

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

export interface CloudinaryVideoUploadResult {
  publicId: string;
  url: string;        // secure_url (original)
  thumbnail: string;  // derived poster URL
  duration: number;
  width: number;
  height: number;
}

/** Unsigned video upload. The 720p H.264 MP4 transcode is configured
 * on the `community_unsigned` preset in the Cloudinary console (eager
 * params are forbidden on unsigned uploads). The secure_url returned is
 * the original asset; use cldVideo() to build a delivery URL pointing to
 * the optimized derivative. */
export function uploadCommunityVideo(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<CloudinaryVideoUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`,
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
            thumbnail: deriveCloudinaryVideoThumbnail(json.secure_url),
            duration: json.duration ?? 0,
            width: json.width ?? 0,
            height: json.height ?? 0,
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

/** Derive a still-frame poster URL from a Cloudinary video URL. Uses
 * the second frame (so_2) since most clips have a frame-0 splash. */
export function deriveCloudinaryVideoThumbnail(url: string): string {
  if (!url.includes('/video/upload/')) return '';
  const transformed = url.replace(
    '/video/upload/',
    '/video/upload/so_2,w_640,q_auto:good/',
  );
  return transformed.replace(/\.[a-z0-9]+$/i, '.jpg');
}

/** Build the optimized delivery URL (mp4, 720p cap). */
export function cldVideo(url: string): string {
  if (!url.includes('/video/upload/')) return url;
  const transformed = url.replace(
    '/video/upload/',
    `/video/upload/${COMMUNITY_VIDEO_DELIVERY}/`,
  );
  return transformed.replace(/\.[a-z0-9]+$/i, '.mp4');
}
