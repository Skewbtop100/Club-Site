'use client';

import { useEffect, useRef, useState } from 'react';
import {
  uploadCommunityVideo,
  COMMUNITY_VIDEO_MAX_BYTES,
} from '@/lib/cloudinary';
import { parseVideoUrl, type VideoType } from '@/lib/community/video-utils';

export interface VideoData {
  videoUrl: string;
  videoType: VideoType;
  videoThumbnail: string;
}

interface Props {
  value: VideoData | null;
  onChange: (v: VideoData | null) => void;
  popoverOpen: boolean;
  onPopoverChange: (open: boolean) => void;
  /** Bubbles up upload-in-flight so parent can disable the submit button. */
  onUploadingChange?: (uploading: boolean) => void;
}

export default function VideoUploader({
  value, onChange, popoverOpen, onPopoverChange, onUploadingChange,
}: Props) {
  type Mode = 'choose' | 'link';
  const [mode, setMode] = useState<Mode>('choose');
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;

  // Reset chooser state whenever the popover opens.
  useEffect(() => {
    if (popoverOpen) {
      setMode('choose');
      setLinkValue('');
      setLinkError(null);
    }
  }, [popoverOpen]);

  // Bubble upload state to parent, ignoring identity changes of the callback.
  useEffect(() => {
    onUploadingChangeRef.current?.(uploadProgress !== null);
  }, [uploadProgress]);

  // Revoke any leftover object URL on unmount.
  useEffect(() => () => {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
  }, [uploadPreview]);

  function chooseFile() {
    fileInputRef.current?.click();
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setUploadError('Зөвхөн бичлэг оруулах боломжтой');
      return;
    }
    if (file.size > COMMUNITY_VIDEO_MAX_BYTES) {
      setUploadError('Бичлэг 100MB-аас бага байх ёстой');
      return;
    }

    setUploadError(null);
    onPopoverChange(false);
    const previewUrl = URL.createObjectURL(file);
    setUploadPreview(previewUrl);
    setUploadProgress(0);

    uploadCommunityVideo(file, (pct) => setUploadProgress(pct))
      .then((res) => {
        onChange({
          videoUrl: res.url,
          videoType: 'cloudinary',
          videoThumbnail: res.thumbnail,
        });
        setUploadProgress(null);
        URL.revokeObjectURL(previewUrl);
        setUploadPreview(null);
      })
      .catch((err) => {
        console.error('[community] video upload failed', err);
        setUploadError(err instanceof Error ? err.message : 'Алдаа');
        setUploadProgress(null);
        URL.revokeObjectURL(previewUrl);
        setUploadPreview(null);
      });
  }

  function submitLink() {
    const parsed = parseVideoUrl(linkValue);
    if (!parsed) {
      setLinkError('Зөвхөн YouTube эсвэл Vimeo линк');
      return;
    }
    onChange({
      videoUrl: parsed.url,
      videoType: parsed.type,
      videoThumbnail: parsed.thumbnail,
    });
    onPopoverChange(false);
    setLinkValue('');
    setLinkError(null);
  }

  function removeVideo() {
    onChange(null);
    setUploadError(null);
    setUploadProgress(null);
    if (uploadPreview) {
      URL.revokeObjectURL(uploadPreview);
      setUploadPreview(null);
    }
  }

  const showPopover = popoverOpen && uploadProgress === null && !value;
  const showProgressPreview = uploadProgress !== null;
  const showStoredPreview = !!value && uploadProgress === null;

  return (
    <div className="vu-root">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={onFileChosen}
        className="vu-input"
      />

      {uploadError && <div className="vu-error">{uploadError}</div>}

      {showPopover && (
        <div className="vu-popover" role="dialog" aria-label="Бичлэг нэмэх">
          {mode === 'choose' && (
            <>
              <button type="button" className="vu-choice" onClick={chooseFile}>
                <span className="vu-choice-icon">📎</span>
                <span>
                  <div className="vu-choice-title">Файл оруулах</div>
                  <div className="vu-choice-sub">100MB хүртэл, MP4/MOV/WebM</div>
                </span>
              </button>
              <button type="button" className="vu-choice" onClick={() => setMode('link')}>
                <span className="vu-choice-icon">🔗</span>
                <span>
                  <div className="vu-choice-title">Линк оруулах</div>
                  <div className="vu-choice-sub">YouTube эсвэл Vimeo</div>
                </span>
              </button>
              <button
                type="button"
                className="vu-popover-close"
                onClick={() => onPopoverChange(false)}
                aria-label="Хаах"
              >
                ×
              </button>
            </>
          )}
          {mode === 'link' && (
            <div className="vu-link-row">
              <input
                type="url"
                value={linkValue}
                onChange={(e) => { setLinkValue(e.target.value); setLinkError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitLink(); }
                  if (e.key === 'Escape') { e.preventDefault(); onPopoverChange(false); }
                }}
                placeholder="YouTube эсвэл Vimeo линк..."
                className="vu-link-input"
                autoFocus
              />
              <button
                type="button"
                className="vu-link-submit"
                onClick={submitLink}
                aria-label="Нэмэх"
              >
                ✓
              </button>
              <button
                type="button"
                className="vu-link-back"
                onClick={() => setMode('choose')}
                aria-label="Буцах"
              >
                ←
              </button>
              {linkError && <div className="vu-link-error">{linkError}</div>}
            </div>
          )}
        </div>
      )}

      {(showProgressPreview || showStoredPreview) && (
        <div className="vu-preview-wrap">
          <Preview
            value={value}
            uploadPreview={uploadPreview}
            uploadProgress={uploadProgress}
            onRemove={removeVideo}
          />
          {value?.videoType === 'cloudinary' && (
            <div className="vu-note">Бичлэг автоматаар шахагдана</div>
          )}
        </div>
      )}

      <style>{`
        .vu-root { position: relative; }
        .vu-input {
          position: absolute;
          width: 1px; height: 1px;
          opacity: 0; pointer-events: none;
        }
        .vu-error {
          padding: 0.45rem 0.7rem;
          margin-bottom: 0.5rem;
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: 8px;
          color: #fca5a5;
          font-size: 0.78rem;
        }
        .vu-popover {
          position: relative;
          padding: 0.65rem;
          margin-bottom: 0.6rem;
          background: rgba(127,127,127,0.08);
          border: 1px solid rgba(127,127,127,0.2);
          border-radius: 10px;
          display: flex; flex-direction: column; gap: 0.4rem;
        }
        .vu-popover-close {
          position: absolute; top: 6px; right: 6px;
          width: 24px; height: 24px;
          background: transparent; border: none;
          color: var(--muted);
          font-size: 1.05rem; line-height: 1;
          cursor: pointer; border-radius: 6px;
        }
        .vu-popover-close:hover { background: rgba(127,127,127,0.15); color: var(--text); }
        .vu-choice {
          display: flex; align-items: center; gap: 0.6rem;
          padding: 0.55rem 0.65rem;
          background: var(--card);
          border: 1px solid rgba(127,127,127,0.18);
          border-radius: 8px;
          font-family: inherit; text-align: left;
          color: var(--text);
          cursor: pointer;
          transition: background 0.12s, border-color 0.12s;
        }
        .vu-choice:hover {
          background: rgba(167,139,250,0.08);
          border-color: rgba(167,139,250,0.35);
        }
        .vu-choice-icon {
          font-size: 1.25rem; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px;
          background: rgba(127,127,127,0.12);
          border-radius: 7px;
        }
        .vu-choice-title {
          font-size: 0.88rem; font-weight: 700; line-height: 1.2;
        }
        .vu-choice-sub {
          font-size: 0.72rem; color: var(--muted);
          margin-top: 0.15rem;
        }
        .vu-link-row {
          display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
        }
        .vu-link-back {
          width: 32px; height: 32px;
          background: transparent;
          border: 1px solid rgba(127,127,127,0.2);
          border-radius: 7px;
          color: var(--muted);
          cursor: pointer;
          font-size: 0.95rem;
          order: -1;
        }
        .vu-link-back:hover { background: rgba(127,127,127,0.1); color: var(--text); }
        .vu-link-input {
          flex: 1; min-width: 0;
          padding: 0.5rem 0.75rem;
          background: var(--card);
          border: 1px solid rgba(127,127,127,0.2);
          border-radius: 7px;
          color: var(--text);
          font-family: inherit; font-size: 0.85rem;
          outline: none;
        }
        .vu-link-input:focus { border-color: rgba(167,139,250,0.5); }
        .vu-link-submit {
          width: 32px; height: 32px;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          border: none; border-radius: 7px;
          color: #fff;
          cursor: pointer;
          font-size: 0.9rem; font-weight: 700;
        }
        .vu-link-error {
          flex-basis: 100%;
          font-size: 0.74rem;
          color: #fca5a5;
        }
        .vu-preview-wrap { margin-bottom: 0.5rem; }
        .vu-note {
          margin-top: 0.3rem;
          font-size: 0.7rem;
          color: var(--muted);
        }
      `}</style>
    </div>
  );
}

function Preview({
  value, uploadPreview, uploadProgress, onRemove,
}: {
  value: VideoData | null;
  uploadPreview: string | null;
  uploadProgress: number | null;
  onRemove: () => void;
}) {
  // Three rendering branches: uploading, vimeo (no thumbnail), or stored
  // (cloudinary/youtube — we have a poster).
  const isUploading = uploadProgress !== null;
  const showVimeoBlock = !isUploading && value?.videoType === 'vimeo';
  const thumb = isUploading
    ? null
    : value?.videoThumbnail || null;
  const overlayLabel = value?.videoType === 'youtube' ? 'YT' : null;

  return (
    <div className="pv-thumb">
      {showVimeoBlock ? (
        <div className="pv-vimeo">
          <span className="pv-vimeo-mark">Vimeo</span>
        </div>
      ) : isUploading && uploadPreview ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <video src={uploadPreview} className="pv-img" muted playsInline />
      ) : thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="pv-img" />
      ) : (
        <div className="pv-placeholder">🎥</div>
      )}

      {!isUploading && !showVimeoBlock && (
        <div className="pv-play">▶</div>
      )}
      {overlayLabel && !isUploading && (
        <div className="pv-yt">{overlayLabel}</div>
      )}

      {isUploading && (
        <div className="pv-progress">
          <div className="pv-progress-bar" style={{ width: `${uploadProgress}%` }} />
          <div className="pv-progress-pct">{uploadProgress}%</div>
        </div>
      )}

      <button
        type="button"
        className="pv-x"
        onClick={onRemove}
        aria-label="Бичлэгийг устгах"
      >
        ×
      </button>

      <style>{`
        .pv-thumb {
          position: relative;
          width: 120px; height: 80px;
          border-radius: 10px;
          overflow: hidden;
          background: rgba(127,127,127,0.15);
          flex-shrink: 0;
        }
        .pv-img {
          width: 100%; height: 100%;
          object-fit: cover;
          display: block;
        }
        .pv-placeholder {
          width: 100%; height: 100%;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.6rem;
        }
        .pv-vimeo {
          width: 100%; height: 100%;
          background: #1ab7ea;
          display: flex; align-items: center; justify-content: center;
        }
        .pv-vimeo-mark {
          color: #fff; font-weight: 800;
          font-size: 0.95rem; letter-spacing: 0.04em;
        }
        .pv-play {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-size: 1.4rem;
          text-shadow: 0 1px 4px rgba(0,0,0,0.7);
          pointer-events: none;
        }
        .pv-yt {
          position: absolute;
          bottom: 4px; left: 4px;
          background: #ff0000;
          color: #fff;
          font-size: 0.6rem; font-weight: 800;
          padding: 0.1rem 0.32rem;
          border-radius: 3px;
          letter-spacing: 0.04em;
        }
        .pv-progress {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 18px;
          background: rgba(0,0,0,0.55);
          display: flex; align-items: center;
        }
        .pv-progress-bar {
          position: absolute; left: 0; top: 0; bottom: 0;
          background: var(--accent);
          transition: width 0.15s linear;
        }
        .pv-progress-pct {
          position: relative;
          width: 100%;
          text-align: center;
          color: #fff; font-size: 0.7rem; font-weight: 700;
        }
        .pv-x {
          position: absolute;
          top: 4px; right: 4px;
          width: 20px; height: 20px;
          border-radius: 999px;
          background: #ef4444;
          border: none;
          color: #fff;
          font-size: 0.95rem; font-weight: 700;
          line-height: 1;
          cursor: pointer; padding: 0;
          display: inline-flex; align-items: center; justify-content: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }
        .pv-x:hover { background: #dc2626; }
      `}</style>
    </div>
  );
}
