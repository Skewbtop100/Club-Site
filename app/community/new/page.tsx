'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { createPost, type PostCategory } from '@/lib/firebase/services/posts';
import ImageUploader, {
  type UploadItem,
  isUploading,
  uploadedUrls,
} from '@/components/community/ImageUploader';
import VideoUploader, { type VideoData } from '@/components/community/VideoUploader';

const TITLE_MAX = 120;
const BODY_MAX = 5000;

const CATEGORIES: { id: PostCategory; label: string; emoji: string; adminOnly?: boolean }[] = [
  { id: 'announcement', label: 'Зар',     emoji: '📢', adminOnly: true },
  { id: 'question',     label: 'Асуулт',  emoji: '❓' },
  { id: 'achievement',  label: 'Амжилт',  emoji: '🏆' },
  { id: 'video',        label: 'Видео',   emoji: '🎥' },
  { id: 'general',      label: 'Ерөнхий', emoji: '💬' },
];

const CHANNEL_NAMES: Record<PostCategory, string> = {
  announcement: 'зар',
  general:      'ерөнхий',
  question:     'асуулт',
  achievement:  'амжилт',
  video:        'видео',
};

const VALID_CATEGORIES = new Set<PostCategory>(CATEGORIES.map(c => c.id));

function readChannelParam(value: string | null | undefined): PostCategory {
  if (value && VALID_CATEGORIES.has(value as PostCategory)) {
    return value as PostCategory;
  }
  return 'general';
}

export default function NewPostPage() {
  return (
    <Suspense fallback={
      <div style={{
        position: 'fixed', inset: 0, background: '#2a2b32',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.5)',
      }}>Уншиж байна...</div>
    }>
      <NewPostInner />
    </Suspense>
  );
}

function NewPostInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const initialChannel = readChannelParam(searchParams?.get('channel'));
  const [category, setCategory] = useState<PostCategory>(initialChannel);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // TODO(cleanup): orphan Cloudinary assets if user cancels with uploads
  // pending. Acceptable until storage pressure — sweep via Admin API.
  const [images, setImages] = useState<UploadItem[]>([]);
  const [video, setVideo] = useState<VideoData | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoPopoverOpen, setVideoPopoverOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      const target = `/community/new?channel=${initialChannel}`;
      router.replace(`/login?redirect=${encodeURIComponent(target)}`);
    }
  }, [authLoading, user, router, initialChannel]);

  // If a non-admin lands on ?channel=announcement, silently fall back to general.
  useEffect(() => {
    if (user && category === 'announcement' && user.role !== 'admin') {
      setCategory('general');
    }
  }, [user, category]);

  if (authLoading || !user) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#2a2b32',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.5)',
      }}>
        Уншиж байна...
      </div>
    );
  }

  const isAdmin = user.role === 'admin';
  const titleTrim = title.trim();
  const bodyTrim = body.trim();
  const uploading = isUploading(images) || videoUploading;
  const canSubmit =
    !submitting && !uploading &&
    titleTrim.length > 0 && titleTrim.length <= TITLE_MAX &&
    bodyTrim.length > 0 && bodyTrim.length <= BODY_MAX &&
    (category !== 'announcement' || isAdmin);

  function openImagePicker() {
    if (video) {
      if (!confirm('Бичлэг устах болно. Үргэлжлүүлэх үү?')) return;
      setVideo(null);
    }
    document.getElementById('np-img-input')?.click();
  }

  function openVideoPopover() {
    if (video) return;
    if (images.length > 0) {
      if (!confirm('Зураг устах болно. Үргэлжлүүлэх үү?')) return;
      setImages([]);
    }
    setVideoPopoverOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const urls = uploadedUrls(images);
      const mediaFields = video
        ? {
            videoUrl: video.videoUrl,
            videoType: video.videoType,
            videoThumbnail: video.videoThumbnail,
          }
        : urls.length > 0
          ? { imageUrls: urls }
          : {};
      const id = await createPost({
        title: titleTrim,
        body: bodyTrim,
        category,
        authorId: user.uid,
        authorName: user.displayName,
        ...(user.photoURL ? { authorPhoto: user.photoURL } : {}),
        authorRole: user.role,
        ...mediaFields,
      });
      router.push(`/community/${id}`);
    } catch (err) {
      console.error('[community/new] createPost', err);
      setError(err instanceof Error ? err.message : 'Post үүсгэхэд алдаа гарлаа.');
      setSubmitting(false);
    }
  }

  return (
    <div className="np-shell">
      <div className="np-container">
        <Link href={`/community?channel=${category}`} className="np-breadcrumb">
          ← #{CHANNEL_NAMES[category]}-руу буцах
        </Link>

        <header className="np-header">
          <h1 className="np-title">Дэлгэрэнгүй post бичих</h1>
          <p className="np-subtitle">Гарчиг + урт текст бүхий пост</p>
        </header>

        {error && <div className="np-error">{error}</div>}

        <form onSubmit={onSubmit} className="np-form">
          {/* Category */}
          <div>
            <label className="np-label">Ангилал</label>
            <div className="np-pills">
              {CATEGORIES.map(c => {
                const disabled = c.adminOnly && !isAdmin;
                const active = category === c.id;
                return (
                  <button
                    type="button"
                    key={c.id}
                    disabled={disabled}
                    onClick={() => setCategory(c.id)}
                    title={disabled ? 'Зөвхөн админ' : undefined}
                    className={`np-pill${active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
                  >
                    <span>{c.emoji}</span>{c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              placeholder="Гарчиг..."
              required
              className="np-input"
            />
            <div className="np-counter">{title.length}/{TITLE_MAX}</div>
          </div>

          {/* Body */}
          <div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={BODY_MAX}
              placeholder="Та юу бичмээр байна?"
              required
              rows={10}
              className="np-textarea"
            />
            <div className="np-counter">{body.length}/{BODY_MAX}</div>
          </div>

          {/* Images */}
          <div>
            <label className="np-label">Зураг (хамгийн ихдээ 5)</label>
            <ImageUploader
              items={images}
              onChange={setImages}
              inputId="np-img-input"
            />
            <button
              type="button"
              className="np-image-trigger"
              onClick={openImagePicker}
            >
              📷 Зураг нэмэх
            </button>
          </div>

          {/* Video */}
          <div>
            <label className="np-label">Бичлэг (нэг л байж болно)</label>
            <VideoUploader
              value={video}
              onChange={setVideo}
              popoverOpen={videoPopoverOpen}
              onPopoverChange={setVideoPopoverOpen}
              onUploadingChange={setVideoUploading}
            />
            <button
              type="button"
              className="np-image-trigger"
              onClick={openVideoPopover}
              disabled={!!video}
              style={video ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            >
              🎥 Бичлэг нэмэх
            </button>
          </div>

          {/* Actions */}
          <div className="np-actions">
            <Link href={`/community?channel=${category}`} className="np-cancel">
              Болих
            </Link>
            <button
              type="submit"
              disabled={!canSubmit}
              className="np-submit"
            >
              {submitting
                ? 'Илгээж байна...'
                : videoUploading
                  ? 'Бичлэг ачаалж байна...'
                  : isUploading(images)
                    ? 'Зураг ачаалж байна...'
                    : 'Нийтлэх'}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .np-shell {
          position: fixed;
          inset: 0;
          background: #2a2b32;
          color: #fff;
          overflow-y: auto;
        }
        .np-container {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.4rem 1.25rem 4rem;
        }
        .np-breadcrumb {
          display: inline-block;
          color: rgba(255,255,255,0.55);
          font-size: 0.85rem;
          font-weight: 600;
          text-decoration: none;
          padding: 0.4rem 0.6rem;
          margin: 0 0 1.2rem -0.6rem;
          border-radius: 7px;
          transition: background 0.12s, color 0.12s;
        }
        .np-breadcrumb:hover { background: rgba(255,255,255,0.05); color: #fff; }
        .np-header { margin-bottom: 1.6rem; }
        .np-title {
          font-size: clamp(1.6rem, 4.5vw, 2.1rem);
          font-weight: 900;
          line-height: 1.2;
          margin-bottom: 0.35rem;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .np-subtitle {
          font-size: 0.92rem;
          color: rgba(255,255,255,0.55);
        }
        .np-error {
          padding: 0.8rem 1rem;
          margin-bottom: 1.2rem;
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: 10px;
          color: #fca5a5;
          font-size: 0.88rem;
        }
        .np-form { display: flex; flex-direction: column; gap: 1.25rem; }
        .np-label {
          display: block;
          margin-bottom: 0.5rem;
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.6);
        }
        .np-pills { display: flex; gap: 0.45rem; flex-wrap: wrap; }
        .np-pill {
          padding: 0.5rem 1rem;
          border-radius: 999px;
          white-space: nowrap;
          background: #34353c;
          border: 1px solid rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.78);
          font-size: 0.85rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          transition: all 0.15s;
        }
        .np-pill:hover:not(.active):not(.disabled) {
          background: #3c3d44;
          color: #fff;
        }
        .np-pill.active {
          background: rgba(167,139,250,0.18);
          border-color: rgba(167,139,250,0.4);
          color: var(--accent);
        }
        .np-pill.disabled { opacity: 0.4; cursor: not-allowed; }
        .np-input, .np-textarea {
          width: 100%;
          background: #34353c;
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 10px;
          color: #fff;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s;
        }
        .np-input:focus, .np-textarea:focus { border-color: rgba(167,139,250,0.4); }
        .np-input {
          padding: 0.85rem 1rem;
          font-size: 1rem;
          font-weight: 600;
        }
        .np-input::placeholder, .np-textarea::placeholder {
          color: rgba(255,255,255,0.35);
        }
        .np-textarea {
          padding: 0.85rem 1rem;
          font-size: 0.95rem;
          line-height: 1.55;
          resize: vertical;
          min-height: 200px;
        }
        .np-counter {
          margin-top: 0.3rem;
          font-size: 0.7rem;
          color: rgba(255,255,255,0.4);
          text-align: right;
        }
        .np-image-trigger {
          display: inline-flex; align-items: center; gap: 0.4rem;
          padding: 0.55rem 0.95rem;
          background: #34353c;
          border: 1px dashed rgba(255,255,255,0.2);
          border-radius: 10px;
          color: rgba(255,255,255,0.78);
          font-size: 0.85rem; font-weight: 600;
          cursor: pointer;
          transition: background 0.12s, border-color 0.12s, color 0.12s;
        }
        .np-image-trigger:hover {
          background: #3c3d44;
          color: #fff;
          border-color: rgba(167,139,250,0.5);
        }
        .np-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.75rem;
          margin-top: 0.5rem;
        }
        .np-cancel {
          padding: 0.7rem 1.2rem;
          border-radius: 10px;
          font-size: 0.9rem;
          font-weight: 600;
          color: rgba(255,255,255,0.6);
          text-decoration: none;
        }
        .np-cancel:hover { color: #fff; }
        .np-submit {
          padding: 0.75rem 1.6rem;
          border-radius: 10px;
          border: none;
          font-size: 0.92rem;
          font-weight: 700;
          font-family: inherit;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          color: #fff;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }
        .np-submit:hover:not(:disabled) { transform: translateY(-1px); }
        .np-submit:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          background: rgba(167,139,250,0.25);
        }
      `}</style>
    </div>
  );
}
