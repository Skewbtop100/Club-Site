// Unsigned Cloudinary upload for the public online-competition feature.
// Used instead of Firebase Storage because this project's Firebase plan
// doesn't support enabling Storage without upgrading to a paid tier.
//
// Submission videos no longer come here — they go to R2 — and stills are no
// longer captured. Legacy submission assets are removed by the nightly
// sweep (app/api/online-competition/cron/sweep-videos) through
// lib/online-competition/submission-cleanup.ts, which only deletes an asset
// it can show was uploaded with the submission naming it.

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  /** THE CLIP'S REAL LENGTH IN MILLISECONDS, from the upload response.
   *
   *  Cloudinary returns `duration` on a VIDEO upload, in SECONDS as a
   *  float (e.g. 104.033). It is converted once, here, because everything
   *  that compares it — the stage marks — is in milliseconds, and a
   *  seconds/milliseconds mix-up in a consistency check would make the
   *  check fire on every honest submission.
   *
   *  Undefined for an image upload, which has no duration, and for any
   *  response that omits it. Callers must treat it as optional. */
  durationMs?: number;
}

// XMLHttpRequest (not fetch) is used deliberately — fetch has no built-in
// upload-progress event, and callers (the solve review screen, the profile
// photo picker) show a progress bar.
function uploadToCloudinary(
  resourceType: 'video' | 'image',
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<CloudinaryUploadResult> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    return Promise.reject(new Error('Cloudinary тохиргоо дутуу байна'));
  }

  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', blob);
    formData.append('upload_preset', UPLOAD_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as {
            secure_url: string;
            public_id: string;
            duration?: number;
          };
          resolve({
            secureUrl: data.secure_url,
            publicId: data.public_id,
            durationMs:
              typeof data.duration === 'number' && Number.isFinite(data.duration)
                ? Math.round(data.duration * 1000)
                : undefined,
          });
        } catch {
          reject(new Error('Cloudinary хариу уншиж чадсангүй'));
        }
      } else {
        reject(new Error(`Cloudinary upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Сүлжээний алдаа гарлаа'));

    xhr.send(formData);
  });
}

export function uploadVideoToCloudinary(
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<CloudinaryUploadResult> {
  return uploadToCloudinary('video', blob, onProgress);
}

// Used by the athlete profile form (app/online-competition/profile) for the
// admin-reviewed verification photo.
export function uploadImageToCloudinary(
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<CloudinaryUploadResult> {
  return uploadToCloudinary('image', blob, onProgress);
}

// ── Delivery URLs for the solve stills ────────────────────────────────
// The stills grabbed during the two closing holds (timerShotIds /
// cubeShotIds) are stored as Cloudinary public ids, not urls — see the
// note on those fields in types.ts. These build the delivery urls the
// review panel renders.
//
// CLOUD_NAME is the same NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME the uploads
// above use, read once at the top of this module. Reading the env var
// again from a component would be a second place for it to be missing.

/** A height-constrained thumbnail.
 *
 *  THE ORIGINALS ARE ~1080x1920. Six of them at full size is tens of
 *  megabytes shipped into a grid the judge may never click, on a
 *  dashboard that already loads a video — so the grid gets a 320px-wide
 *  variant and the full file is fetched only on click.
 *
 *  c_limit, not c_fill: it scales down to fit and never crops. A crop
 *  would be free to cut the timer face out of the frame, which is the one
 *  thing these images exist to show. q_auto/f_auto let Cloudinary pick
 *  the codec and quality per browser. */
export function cloudinaryStillThumb(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,h_240,q_auto,f_auto/${publicId}`;
}

/** The original, untransformed.
 *
 *  No q_auto here, deliberately. Every other image on this site can
 *  afford re-encoding; this one is opened precisely because a judge is
 *  trying to read digits off a phone screen inside the frame, and that is
 *  exactly the detail a quality heuristic spends first. */
export function cloudinaryStillFull(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${publicId}`;
}
