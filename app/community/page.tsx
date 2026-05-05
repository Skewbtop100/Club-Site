'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { subscribePosts, type Post, type PostCategory } from '@/lib/firebase/services/posts';
import { useAuth } from '@/lib/auth-context';

const CATEGORIES: { id: PostCategory | 'all'; label: string; emoji: string }[] = [
  { id: 'all',          label: 'Бүгд',         emoji: '📋' },
  { id: 'announcement', label: 'Зар',          emoji: '📢' },
  { id: 'question',     label: 'Асуулт',       emoji: '❓' },
  { id: 'achievement',  label: 'Амжилт',       emoji: '🏆' },
  { id: 'video',        label: 'Видео',        emoji: '🎥' },
  { id: 'general',      label: 'Ерөнхий',      emoji: '💬' },
];

export default function CommunityPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [activeCategory, setActiveCategory] = useState<PostCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribePosts(
      (items) => { setPosts(items); setLoading(false); },
      activeCategory === 'all' ? {} : { category: activeCategory },
    );
    return () => unsub();
  }, [activeCategory]);

  return (
    <main style={{ minHeight: '100vh', padding: '6rem 1.25rem 4rem', maxWidth: 920, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{
            fontSize: 'clamp(1.8rem, 5vw, 2.5rem)', fontWeight: 900, marginBottom: '0.3rem',
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            Community
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>
            Монголын шоочдын нэгдэл
          </p>
        </div>
        {user && (
          <Link href="/community/new" style={{
            padding: '0.7rem 1.4rem', borderRadius: 10, fontSize: '0.92rem', fontWeight: 700,
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            color: '#fff', textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          }}>
            + Шинэ post
          </Link>
        )}
      </div>

      {/* Category tabs */}
      <div style={{
        display: 'flex', gap: '0.45rem', marginBottom: '1.5rem',
        overflowX: 'auto', paddingBottom: '0.3rem',
      }}>
        {CATEGORIES.map(c => {
          const active = activeCategory === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              style={{
                padding: '0.5rem 1rem', borderRadius: 999, whiteSpace: 'nowrap',
                background: active ? 'rgba(167,139,250,0.18)' : 'var(--card)',
                border: `1px solid ${active ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: active ? 'var(--accent)' : 'var(--text)',
                fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                transition: 'all 0.15s',
              }}
            >
              <span>{c.emoji}</span>{c.label}
            </button>
          );
        })}
      </div>

      {/* Posts list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          Уншиж байна...
        </div>
      ) : posts.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '4rem 1rem',
          background: 'var(--card)', borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>💭</div>
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.4rem' }}>
            Энд ямар ч post алга
          </div>
          <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
            Анхны post-ыг бичих хүн та байж магадгүй!
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {posts.map(p => <PostListItem key={p.id} post={p} />)}
        </div>
      )}
    </main>
  );
}

function PostListItem({ post }: { post: Post }) {
  const cat = CATEGORIES.find(c => c.id === post.category);
  const date = post.createdAt?.toDate ? post.createdAt.toDate() : new Date();
  const dateStr = date.toLocaleDateString('mn-MN', { month: 'short', day: 'numeric' });
  return (
    <Link href={`/community/${post.id}`} style={{
      display: 'block', textDecoration: 'none',
      padding: '1rem 1.2rem',
      background: 'var(--card)',
      border: `1px solid ${post.pinned ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 14,
      transition: 'border-color 0.15s, transform 0.15s',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        marginBottom: '0.5rem', fontSize: '0.7rem',
      }}>
        {post.pinned && (
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>📌 Бэхэлсэн</span>
        )}
        <span style={{
          padding: '0.18rem 0.5rem', borderRadius: 6,
          background: 'rgba(167,139,250,0.12)', color: 'var(--accent)',
          fontWeight: 600,
        }}>
          {cat?.emoji} {cat?.label}
        </span>
        <span style={{ color: 'var(--muted)' }}>{dateStr}</span>
      </div>
      <h3 style={{
        fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)',
        marginBottom: '0.35rem', lineHeight: 1.3,
      }}>
        {post.title}
      </h3>
      <p style={{
        fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.5,
        marginBottom: '0.7rem',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {post.body}
      </p>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: '0.78rem', color: 'var(--muted)',
      }}>
        <span>{post.authorName}</span>
        <span>💬 {post.commentCount} · ❤️ {post.likeCount}</span>
      </div>
    </Link>
  );
}
