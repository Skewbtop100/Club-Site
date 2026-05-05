'use client';

import { useEffect, useRef, useState } from 'react';
import {
  uploadCommunityImage,
  cldThumb,
  COMMUNITY_IMAGE_MAX_BYTES,
  COMMUNITY_IMAGE_MAX_PER_POST,
  COMMUNITY_ALLOWED_MIME,
} from '@/lib/cloudinary';

export interface UploadItem {
  id: string;
  file: File;
  previewUrl: string;     // local object URL (instant preview before upload)
  uploadedUrl?: string;   // Cloudinary secure_url after success
  progress?: number;      // 0-100 (upload bytes)
  error?: string;         // upload-side failure message
}

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function isUploading(items: UploadItem[]): boolean {
  return items.some((i) => !i.uploadedUrl && !i.error);
}

export function uploadedUrls(items: UploadItem[]): string[] {
  return items.filter((i) => i.uploadedUrl).map((i) => i.uploadedUrl!);
}

interface Props {
  items: UploadItem[];
  onChange: React.Dispatch<React.SetStateAction<UploadItem[]>>;
  inputId: string;       // required — used by external label/button to trigger picker
  max?: number;
}

export default function ImageUploader({
  items, onChange, inputId, max = COMMUNITY_IMAGE_MAX_PER_POST,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke any leftover object URLs on unmount.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => {
    itemsRef.current.forEach((i) => {
      if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
    });
  }, []);

  function startUpload(item: UploadItem) {
    uploadCommunityImage(item.file, (pct) => {
      onChange((curr) =>
        curr.map((x) => (x.id === item.id ? { ...x, progress: pct } : x)),
      );
    })
      .then((res) => {
        onChange((curr) =>
          curr.map((x) =>
            x.id === item.id ? { ...x, uploadedUrl: res.url, progress: 100 } : x,
          ),
        );
      })
      .catch((err) => {
        console.error('[community] upload failed', err);
        onChange((curr) =>
          curr.map((x) =>
            x.id === item.id
              ? { ...x, error: err instanceof Error ? err.message : 'Алдаа' }
              : x,
          ),
        );
      });
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const validCount = items.filter((i) => !i.error).length;
    const room = max - validCount;
    if (room <= 0) {
      setError(`Хамгийн ихдээ ${max} зураг`);
      return;
    }

    const arr = Array.from(files);
    const toAdd: UploadItem[] = [];
    let pickedTooMany = arr.length > room;
    let lastError: string | null = null;

    for (const file of arr.slice(0, room)) {
      if (!COMMUNITY_ALLOWED_MIME.has(file.type)) {
        lastError = 'Зөвхөн зураг оруулах боломжтой';
        continue;
      }
      if (file.size > COMMUNITY_IMAGE_MAX_BYTES) {
        lastError = 'Зураг 10MB-аас бага байх ёстой';
        continue;
      }
      toAdd.push({
        id: makeId(),
        file,
        previewUrl: URL.createObjectURL(file),
        progress: 0,
      });
    }

    if (pickedTooMany) lastError = `Хамгийн ихдээ ${max} зураг`;
    if (lastError) setError(lastError);

    if (toAdd.length === 0) {
      // Reset input so re-picking the same file refires onChange.
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    onChange((curr) => [...curr, ...toAdd]);
    toAdd.forEach(startUpload);

    if (inputRef.current) inputRef.current.value = '';
  }

  function removeItem(id: string) {
    setError(null);
    onChange((curr) => {
      const target = curr.find((i) => i.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return curr.filter((i) => i.id !== id);
    });
  }

  return (
    <div className="iu-root">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={(e) => onFiles(e.target.files)}
        className="iu-input"
      />

      {error && <div className="iu-error">{error}</div>}

      {items.length > 0 && (
        <div className="iu-strip">
          {items.map((it) => {
            const showSpinner = !it.uploadedUrl && !it.error;
            const previewSrc = it.uploadedUrl ? cldThumb(it.uploadedUrl, 240) : it.previewUrl;
            return (
              <div key={it.id} className={`iu-thumb${it.error ? ' has-error' : ''}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewSrc} alt="" className="iu-thumb-img" />
                {showSpinner && (
                  <div className="iu-overlay">
                    <svg width="22" height="22" viewBox="0 0 24 24" className="iu-spin" aria-hidden>
                      <circle cx="12" cy="12" r="9" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="40 60" strokeLinecap="round"/>
                    </svg>
                  </div>
                )}
                {it.uploadedUrl && (
                  <span className="iu-check" title="Хуулагдсан" aria-hidden>✓</span>
                )}
                {it.error && (
                  <div className="iu-fail" title={it.error}>!</div>
                )}
                <button
                  type="button"
                  className="iu-x"
                  onClick={() => removeItem(it.id)}
                  aria-label="Зургийг устгах"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .iu-input {
          position: absolute;
          width: 1px; height: 1px;
          opacity: 0; pointer-events: none;
        }
        .iu-error {
          padding: 0.45rem 0.7rem;
          margin-bottom: 0.5rem;
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: 8px;
          color: #fca5a5;
          font-size: 0.78rem;
        }
        .iu-strip {
          display: flex; flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .iu-thumb {
          position: relative;
          width: 80px; height: 80px;
          border-radius: 10px;
          overflow: hidden;
          background: rgba(127,127,127,0.15);
          flex-shrink: 0;
        }
        .iu-thumb.has-error {
          outline: 2px solid rgba(248,113,113,0.6);
          outline-offset: -2px;
        }
        .iu-thumb-img {
          width: 100%; height: 100%;
          object-fit: cover;
          display: block;
        }
        .iu-overlay {
          position: absolute; inset: 0;
          background: rgba(255,255,255,0.55);
          display: flex; align-items: center; justify-content: center;
          color: #555;
        }
        .iu-spin { animation: iuSpin 0.7s linear infinite; color: var(--accent); }
        @keyframes iuSpin { to { transform: rotate(360deg); } }
        .iu-check {
          position: absolute;
          right: 4px; bottom: 4px;
          width: 18px; height: 18px;
          border-radius: 999px;
          background: #10b981;
          color: #fff;
          font-size: 0.72rem; font-weight: 800;
          display: inline-flex; align-items: center; justify-content: center;
          line-height: 1;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .iu-fail {
          position: absolute;
          right: 4px; bottom: 4px;
          width: 18px; height: 18px;
          border-radius: 999px;
          background: #f87171;
          color: #fff;
          font-size: 0.78rem; font-weight: 800;
          display: inline-flex; align-items: center; justify-content: center;
          line-height: 1;
        }
        .iu-x {
          position: absolute;
          top: 4px; right: 4px;
          width: 18px; height: 18px;
          border-radius: 999px;
          background: #ef4444;
          border: none;
          color: #fff;
          font-size: 0.85rem; font-weight: 700;
          line-height: 1;
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer;
          padding: 0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .iu-x:hover { background: #dc2626; }
      `}</style>
    </div>
  );
}
