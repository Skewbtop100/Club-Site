'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { formatRelativeTime } from '@/lib/relative-time';
import {
  getPost, subscribeComments, createComment, deletePost,
  type Post, type Comment, type PostCategory,
} from '@/lib/firebase/services/posts';

const CATEGORIES: Record<PostCategory, { label: string; emoji: string }> = {
  announcement: { label: 'Зар',     emoji: '📢' },
  question:     { label: 'Асуулт',  emoji: '❓' },
  achievement:  { label: 'Амжилт',  emoji: '🏆' },
  video:        { label: 'Видео',   emoji: '🎥' },
  general:      { label: 'Ерөнхий', emoji: '💬' },
};

const COMMENT_MAX = 1000;

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
  const [comments, setComments] = useState<Comment[]>([]);
  const [now, setNow] = useState(() => Date.now());

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

  // Realtime comments.
  useEffect(() => {
    if (!postId) return;
    const unsub = subscribeComments(postId, setComments);
    return () => unsub();
  }, [postId]);

  // Tick every 30s so relative timestamps refresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
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
        <h1 style={{
          fontSize: 'clamp(1.4rem, 4vw, 1.85rem)', fontWeight: 800,
          color: 'var(--text)', lineHeight: 1.25, marginBottom: '0.85rem',
        }}>
          {post.title}
        </h1>

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

        {/* Footer: counts + delete */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: '0.9rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: '0.82rem', color: 'var(--muted)',
        }}>
          <span>
            💬 {comments.length} · ❤️ {post.likeCount}
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

      {/* Comments */}
      <CommentsSection
        postId={post.id}
        comments={comments}
        nowTick={now}
      />
    </main>
  );
}

function CommentsSection({
  postId, comments, nowTick,
}: { postId: string; comments: Comment[]; nowTick: number }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > COMMENT_MAX || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await createComment({
        postId,
        body: trimmed,
        authorId: user.uid,
        authorName: user.displayName,
        ...(user.photoURL ? { authorPhoto: user.photoURL } : {}),
        authorRole: user.role,
      });
      setBody('');
    } catch (err) {
      console.error('[community] createComment', err);
      setError(err instanceof Error ? err.message : 'Сэтгэгдэл илгээхэд алдаа гарлаа.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2 style={{
        fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)',
        marginBottom: '1rem',
      }}>
        Сэтгэгдэл ({comments.length})
      </h2>

      {user ? (
        <form onSubmit={onSubmit} style={{ marginBottom: '1.5rem' }}>
          {error && (
            <div style={{
              padding: '0.6rem 0.85rem', marginBottom: '0.6rem',
              background: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 8,
              color: '#fca5a5', fontSize: '0.82rem',
            }}>
              {error}
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={COMMENT_MAX}
            rows={3}
            placeholder="Сэтгэгдэл бичих..."
            style={{
              width: '100%',
              padding: '0.75rem 0.9rem',
              background: 'var(--card)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10,
              color: 'var(--text)', fontSize: '0.92rem', lineHeight: 1.5,
              fontFamily: 'inherit', outline: 'none',
              resize: 'vertical', minHeight: 80,
            }}
          />
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            marginTop: '0.5rem', gap: '0.75rem',
          }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              {body.length}/{COMMENT_MAX}
            </span>
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              style={{
                padding: '0.55rem 1.2rem', borderRadius: 8, border: 'none',
                fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit',
                background: !submitting && body.trim()
                  ? 'linear-gradient(135deg, var(--accent), var(--accent2))'
                  : 'rgba(167,139,250,0.25)',
                color: '#fff',
                cursor: !submitting && body.trim() ? 'pointer' : 'not-allowed',
                opacity: !submitting && body.trim() ? 1 : 0.7,
              }}
            >
              {submitting ? '...' : 'Илгээх'}
            </button>
          </div>
        </form>
      ) : (
        <div style={{
          padding: '0.9rem 1rem', marginBottom: '1.5rem',
          background: 'var(--card)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10,
          fontSize: '0.85rem', color: 'var(--muted)', textAlign: 'center',
        }}>
          Сэтгэгдэл бичихийн тулд{' '}
          <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 700 }}>
            нэвтэрнэ үү
          </Link>
        </div>
      )}

      {comments.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '2.2rem 1rem',
          color: 'var(--muted)', fontSize: '0.88rem',
        }}>
          Анхны сэтгэгдлийг бичээрэй
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} nowTick={nowTick} />
          ))}
        </div>
      )}
    </section>
  );
}

function CommentItem({ comment, nowTick }: { comment: Comment; nowTick: number }) {
  // nowTick is intentionally read so the relative timestamp re-renders on tick.
  void nowTick;
  const date = comment.createdAt?.toDate ? comment.createdAt.toDate() : new Date();
  return (
    <div style={{
      display: 'flex', gap: '0.65rem',
      padding: '0.85rem 1rem',
      background: 'var(--card)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: 12,
    }}>
      <Avatar name={comment.authorName} photo={comment.authorPhoto} size={32} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: '0.5rem',
          marginBottom: '0.25rem', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>
            {comment.authorName}
          </span>
          {comment.authorRole === 'admin' && (
            <span style={{ fontSize: '0.62rem', color: 'var(--accent)', fontWeight: 700 }}>
              ADMIN
            </span>
          )}
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }} title={date.toLocaleString('mn-MN')}>
            {formatRelativeTime(date)}
          </span>
        </div>
        <div style={{
          fontSize: '0.9rem', lineHeight: 1.55, color: 'var(--text)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {comment.body}
        </div>
      </div>
    </div>
  );
}
