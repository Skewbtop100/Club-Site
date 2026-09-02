// Unsigned Cloudinary upload for the public online-competition feature.
// Used instead of Firebase Storage because this project's Firebase plan
// doesn't support enabling Storage without upgrading to a paid tier.
//
// TODO: submitted videos should auto-delete once retentionExpiresAt (see
// onlineSubmissions in lib/online-competition/types.ts) passes. Not
// implemented yet — needs either a Cloudinary scheduled-deletion rule on
// this upload preset, or a Cloud Function that reads retentionExpiresAt
// and calls the Cloudinary Admin API (destroy) to remove expired videos.

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
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
          };
          resolve({ secureUrl: data.secure_url, publicId: data.public_id });
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
