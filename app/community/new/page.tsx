'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { createPost, type PostCategory } from '@/lib/firebase/services/posts';

const TITLE_MAX = 120;
const BODY_MAX = 5000;

const CATEGORIES: { id: PostCategory; label: string; emoji: string; adminOnly?: boolean }[] = [
  { id: 'announcement', label: 'Зар',     emoji: '📢', adminOnly: true },
  { id: 'question',     label: 'Асуулт',  emoji: '❓' },
  { id: 'achievement',  label: 'Амжилт',  emoji: '🏆' },
  { id: 'video',        label: 'Видео',   emoji: '🎥' },
  { id: 'general',      label: 'Ерөнхий', emoji: '💬' },
];

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
      <main style={{ minHeight: '100vh', padding: '6rem 1.25rem 4rem', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          Уншиж байна...
        </div>
      </main>
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
      <main style={{ minHeight: '100vh', padding: '6rem 1.25rem 4rem', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          Уншиж байна...
        </div>
      </main>
    );
  }

  const isAdmin = user.role === 'admin';
  const titleTrim = title.trim();
  const bodyTrim = body.trim();
  const canSubmit =
    !submitting &&
    titleTrim.length > 0 && titleTrim.length <= TITLE_MAX &&
    bodyTrim.length > 0 && bodyTrim.length <= BODY_MAX &&
    (category !== 'announcement' || isAdmin);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const id = await createPost({
        title: titleTrim,
        body: bodyTrim,
        category,
        authorId: user.uid,
        authorName: user.displayName,
        ...(user.photoURL ? { authorPhoto: user.photoURL } : {}),
        authorRole: user.role,
      });
      router.push(`/community/${id}`);
    } catch (err) {
      console.error('[community/new] createPost', err);
      setError(err instanceof Error ? err.message : 'Post үүсгэхэд алдаа гарлаа.');
      setSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', padding: '6rem 1.25rem 4rem', maxWidth: 720, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{
          fontSize: 'clamp(1.6rem, 4.5vw, 2.2rem)', fontWeight: 900, marginBottom: '0.3rem',
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          Шинэ post
        </h1>
      </div>

      {error && (
        <div style={{
          padding: '0.8rem 1rem', marginBottom: '1.2rem',
          background: 'rgba(248,113,113,0.1)',
          border: '1px solid rgba(248,113,113,0.3)',
          borderRadius: 10,
          color: '#fca5a5', fontSize: '0.88rem',
        }}>
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Category */}
        <div>
          <label style={{
            display: 'block', marginBottom: '0.5rem',
            fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)',
          }}>
            Ангилал
          </label>
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
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
                  style={{
                    padding: '0.5rem 1rem', borderRadius: 999, whiteSpace: 'nowrap',
                    background: active ? 'rgba(167,139,250,0.18)' : 'var(--card)',
                    border: `1px solid ${active ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    color: active ? 'var(--accent)' : 'var(--text)',
                    fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    transition: 'all 0.15s',
                  }}
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
            style={{
              width: '100%',
              padding: '0.85rem 1rem',
              background: 'var(--card)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              color: 'var(--text)', fontSize: '1rem', fontWeight: 600,
              fontFamily: 'inherit', outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
          <div style={{
            marginTop: '0.3rem', fontSize: '0.72rem', color: 'var(--muted)',
            textAlign: 'right',
          }}>
            {title.length}/{TITLE_MAX}
          </div>
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
            style={{
              width: '100%',
              padding: '0.85rem 1rem',
              background: 'var(--card)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              color: 'var(--text)', fontSize: '0.95rem', lineHeight: 1.55,
              fontFamily: 'inherit', outline: 'none',
              resize: 'vertical', minHeight: 200,
              transition: 'border-color 0.15s',
            }}
          />
          <div style={{
            marginTop: '0.3rem', fontSize: '0.72rem', color: 'var(--muted)',
            textAlign: 'right',
          }}>
            {body.length}/{BODY_MAX}
          </div>
        </div>

        {/* Actions */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: '0.75rem', marginTop: '0.5rem',
        }}>
          <Link href={`/community?channel=${category}`} style={{
            padding: '0.7rem 1.2rem', borderRadius: 10,
            fontSize: '0.9rem', fontWeight: 600,
            color: 'var(--muted)', textDecoration: 'none',
          }}>
            Болих
          </Link>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: '0.75rem 1.6rem', borderRadius: 10, border: 'none',
              fontSize: '0.92rem', fontWeight: 700, fontFamily: 'inherit',
              background: canSubmit
                ? 'linear-gradient(135deg, var(--accent), var(--accent2))'
                : 'rgba(167,139,250,0.25)',
              color: '#fff',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.7,
              transition: 'opacity 0.15s, transform 0.1s',
            }}
          >
            {submitting ? 'Илгээж байна...' : 'Нийтлэх'}
          </button>
        </div>
      </form>
    </main>
  );
}
