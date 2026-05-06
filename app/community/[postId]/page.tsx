'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { formatRelativeTime } from '@/lib/relative-time';
import {
  getPost, deletePost,
  type Post, type PostCategory,
} from '@/lib/firebase/services/posts';
import ImageGrid from '@/components/community/ImageGrid';
import VideoPlayer from '@/components/community/VideoPlayer';
import InlineCommentThread from '@/components/community/InlineCommentThread';

const CATEGORIES: Record<PostCategory, { label: string; emoji: string }> = {
  announcement: { label: 'Зар',     emoji: '📢' },
  question:     { label: 'Асуулт',  emoji: '❓' },
  achievement:  { label: 'Амжилт',  emoji: '🏆' },
  video:        { label: 'Видео',   emoji: '🎥' },
  general:      { label: 'Ерөнхий', emoji: '💬' },
};

function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const cp = trimmed.codePointAt(0);
  return cp ? String.fromCodePoint(cp).toUpperCase() : '?';
}

function Avatar({ name, photo, size = 36 }: { name: string; photo?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      overflow: 'hidden', flexShrink: 0,
      background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
      color: '#fff', fontSize: size * 0.45, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      lineHeight: 1,
    }}>
      {photo && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        initialOf(name)
      )}
    </span>
  );
}

export default function PostDetailPage() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useParams<{ postId: string }>();
  const postId = params?.postId;

  const [post, setPost] = useState<Post | null>(null);
  const [postLoading, setPostLoading] = useState(true);
  const [, setNowTick] = useState(0);

  // One-time fetch of the post.
  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    setPostLoading(true);
    getPost(postId)
      .then((p) => { if (!cancelled) { setPost(p); setPostLoading(false); } })
      .catch((err) => {
        console.error('[community] getPost', err);
        if (!cancelled) { setPost(null); setPostLoading(false); }
      });
    return () => { cancelled = true; };
  }, [postId]);

  // Tick every 30s so the post's own relative timestamp refreshes.
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (postLoading) {
    return (
      <main style={{ minHeight: '100vh', padding: '6rem 1.25rem 4rem', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          Уншиж байна...
        </div>
      </main>
    );
  }

  if (!post) {
    return (
      <main style={{ minHeight: '100vh', padding: '6rem 1.25rem 4rem', maxWidth: 720, margin: '0 auto' }}>
        <div style={{
          textAlign: 'center', padding: '4rem 1rem',
          background: 'var(--card)', borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🤷</div>
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
            Post олдсонгүй
          </div>
          <Link href="/community" style={{
            color: 'var(--accent)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem',
          }}>
            ← Буцах
          </Link>
        </div>
      </main>
    );
  }

  const cat = CATEGORIES[post.category];
  const postDate = post.createdAt?.toDate ? post.createdAt.toDate() : new Date();
  const canDelete = !!user && (user.uid === post.authorId || user.role === 'admin');

  async function onDelete() {
    if (!post) return;
    if (!confirm('Энэ post-ыг устгах уу?')) return;
    try {
      await deletePost(post.id);
      router.push('/community');
    } catch (err) {
      console.error('[community] deletePost', err);
      alert('Устгахад алдаа гарлаа.');
    }
  }

  return (
    <main style={{ minHeight: '100vh', padding: '6rem 1.25rem 4rem', maxWidth: 720, margin: '0 auto' }}>
      <Link href="/community" style={{
        display: 'inline-block', marginBottom: '1.25rem',
        color: 'var(--muted)', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600,
      }}>
        ← Буцах
      </Link>

      {/* Post card */}
      <article style={{
        background: 'var(--card)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16,
        padding: '1.4rem 1.5rem',
        marginBottom: '2rem',
      }}>
        {/* Meta row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          marginBottom: '0.85rem', fontSize: '0.72rem', flexWrap: 'wrap',
        }}>
          {post.pinned && (
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>📌 Бэхэлсэн</span>
          )}
          <span style={{
            padding: '0.18rem 0.55rem', borderRadius: 6,
            background: 'rgba(167,139,250,0.12)', color: 'var(--accent)',
            fontWeight: 600,
          }}>
            {cat.emoji} {cat.label}
          </span>
          <span style={{ color: 'var(--muted)' }} title={postDate.toLocaleString('mn-MN')}>
            {formatRelativeTime(postDate)}
          </span>
        </div>

        {/* Title */}
        {post.title?.trim() && (
          <h1 style={{
            fontSize: 'clamp(1.4rem, 4vw, 1.85rem)', fontWeight: 800,
            color: 'var(--text)', lineHeight: 1.25, marginBottom: '0.85rem',
          }}>
            {post.title}
          </h1>
        )}

        {/* Author */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.55rem',
          marginBottom: '1.2rem',
        }}>
          <Avatar name={post.authorName} photo={post.authorPhoto} size={36} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)' }}>
              {post.authorName}
            </div>
            {post.authorRole === 'admin' && (
              <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontWeight: 700 }}>
                ADMIN
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{
          fontSize: '0.97rem', lineHeight: 1.65, color: 'var(--text)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          marginBottom: '1.4rem',
        }}>
          {post.body}
        </div>

        {post.videoUrl && post.videoType ? (
          <div style={{ marginBottom: '1.4rem' }}>
            <VideoPlayer
              videoUrl={post.videoUrl}
              videoType={post.videoType}
              videoThumbnail={post.videoThumbnail}
            />
          </div>
        ) : post.imageUrls && post.imageUrls.length > 0 ? (
          <div style={{ marginBottom: '1.4rem' }}>
            <ImageGrid imageUrls={post.imageUrls} />
          </div>
        ) : null}

        {/* Footer: counts + delete */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: '0.9rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: '0.82rem', color: 'var(--muted)',
        }}>
          <span>
            💬 {post.commentCount} · ❤️ {post.likeCount}
          </span>
          {canDelete && (
            <button
              onClick={onDelete}
              style={{
                padding: '0.4rem 0.85rem', borderRadius: 8,
                background: 'rgba(248,113,113,0.08)',
                border: '1px solid rgba(248,113,113,0.25)',
                color: '#fca5a5', fontSize: '0.78rem', fontWeight: 600,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              Устгах
            </button>
          )}
        </div>
      </article>

      <section style={{
        background: 'var(--card)',
        border: '1px solid rgba(127,127,127,0.16)',
        borderRadius: 14,
        overflow: 'hidden',
      }}>
        <InlineCommentThread postId={post.id} />
      </section>
    </main>
  );
}
