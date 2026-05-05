'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { formatRelativeTime } from '@/lib/relative-time';
import {
  subscribePosts, deletePost,
  type Post, type PostCategory,
} from '@/lib/firebase/services/posts';

interface Channel {
  id: PostCategory;
  name: string;
  emoji: string;
  adminOnly?: boolean;
}

const CHANNELS: { section: string; items: Channel[] }[] = [
  {
    section: 'МЭДЭЭ',
    items: [
      { id: 'announcement', name: 'зар',     emoji: '📢', adminOnly: true },
    ],
  },
  {
    section: 'ЯРИА',
    items: [
      { id: 'general',     name: 'ерөнхий',  emoji: '💬' },
      { id: 'question',    name: 'асуулт',   emoji: '❓' },
      { id: 'achievement', name: 'амжилт',   emoji: '🏆' },
    ],
  },
  {
    section: 'МЕДИА',
    items: [
      { id: 'video',       name: 'видео',    emoji: '🎥' },
    ],
  },
];

const CHANNEL_DESCRIPTIONS: Record<PostCategory, string> = {
  announcement: 'Тэмцээний зар, мэдээ',
  general:      'Ерөнхий яриа, чат',
  question:     'Шооны асуулт, зөвлөгөө',
  achievement:  'Өөрийн амжилт, PB-г бахархан хуваалцах',
  video:        'Шооны видео хуваалцах',
};

const ROLE_BADGE: Record<NonNullable<Post['authorRole']>, { label: string; color: string }> = {
  admin:   { label: 'ADMIN',   color: 'var(--accent)' },
  athlete: { label: 'ATHLETE', color: '#34d399' },
  member:  { label: 'MEMBER',  color: 'rgba(255,255,255,0.4)' },
};

const DEFAULT_CHANNEL: Channel = CHANNELS[1].items[0]; // general

function findChannel(id: string | null | undefined): Channel {
  if (!id) return DEFAULT_CHANNEL;
  for (const section of CHANNELS) {
    for (const ch of section.items) {
      if (ch.id === id) return ch;
    }
  }
  return DEFAULT_CHANNEL;
}

function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const cp = trimmed.codePointAt(0);
  return cp ? String.fromCodePoint(cp).toUpperCase() : '?';
}

function Avatar({ name, photo, size = 40 }: { name: string; photo?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      overflow: 'hidden', flexShrink: 0,
      background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
      color: '#fff', fontSize: size * 0.42, fontWeight: 700,
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

export default function CommunityPage() {
  return (
    <Suspense fallback={
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: '#2a2b32', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted)',
      }}>Уншиж байна...</div>
    }>
      <CommunityInner />
    </Suspense>
  );
}

function CommunityInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const activeChannel = findChannel(searchParams?.get('channel'));

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribePosts(
      (items) => { setPosts(items); setLoading(false); },
      { category: activeChannel.id },
    );
    return () => unsub();
  }, [activeChannel.id]);

  // Tick every 30s so relative timestamps refresh.
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  function selectChannel(ch: Channel) {
    if (ch.adminOnly && user?.role !== 'admin') return;
    router.replace(`/community?channel=${ch.id}`);
    setSidebarOpen(false);
  }

  function openCompose() {
    const target = `/community/new?channel=${activeChannel.id}`;
    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent(target)}`);
      return;
    }
    if (activeChannel.adminOnly && user.role !== 'admin') return;
    router.push(target);
  }

  const composeBlocked = activeChannel.adminOnly && user?.role !== 'admin';

  return (
    <>
      <main className="comm-shell">
        {/* Sidebar */}
        <aside className={`comm-sidebar${sidebarOpen ? ' open' : ''}`}>
          <Link href="/" className="comm-back-sidebar">← Буцах</Link>
          <header className="comm-server">
            <span className="comm-server-emoji">🧊</span>
            <span className="comm-server-name">Mongolian Speedcubers</span>
          </header>
          <nav className="comm-nav">
            {CHANNELS.map((section) => (
              <div key={section.section} style={{ marginBottom: '0.65rem' }}>
                <div className="comm-section-label">{section.section}</div>
                {section.items.map((ch) => {
                  const locked = !!ch.adminOnly && user?.role !== 'admin';
                  const active = ch.id === activeChannel.id;
                  return (
                    <button
                      key={ch.id}
                      className={`comm-channel${active ? ' active' : ''}${locked ? ' locked' : ''}`}
                      onClick={() => selectChannel(ch)}
                      disabled={locked}
                      title={locked ? 'Зөвхөн админ' : undefined}
                    >
                      <span className="comm-channel-emoji">{ch.emoji}</span>
                      <span className="comm-channel-hash">#</span>
                      <span className="comm-channel-name">{ch.name}</span>
                      {locked && <span className="comm-channel-lock">🔒</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="comm-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}

        {/* Main column */}
        <section className="comm-main">
          <header className="comm-header">
            <Link href="/" className="comm-back-mobile" aria-label="Буцах">
              ←
            </Link>
            <button
              className="comm-hamburger"
              onClick={() => setSidebarOpen(true)}
              aria-label="Сувгийн жагсаалт"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="4" y1="6" x2="20" y2="6"/>
                <line x1="4" y1="12" x2="20" y2="12"/>
                <line x1="4" y1="18" x2="20" y2="18"/>
              </svg>
            </button>
            <div className="comm-header-title">
              <span style={{ fontSize: '1.05rem' }}>{activeChannel.emoji}</span>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>#</span>
              <span style={{ fontWeight: 800, color: '#fff' }}>{activeChannel.name}</span>
              <span className="comm-header-divider" />
              <span className="comm-header-desc">
                {CHANNEL_DESCRIPTIONS[activeChannel.id]}
              </span>
            </div>
            <button
              className="comm-newpost"
              onClick={openCompose}
              disabled={composeBlocked}
              title={composeBlocked ? 'Зөвхөн админ нийтлэх боломжтой' : undefined}
            >
              + Шинэ post
            </button>
          </header>

          <div className="comm-posts">
            {loading ? (
              <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'rgba(255,255,255,0.4)' }}>
                Уншиж байна...
              </div>
            ) : posts.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '5rem 1.5rem',
                color: 'rgba(255,255,255,0.5)', fontSize: '0.95rem',
              }}>
                <div style={{ fontSize: '2.4rem', marginBottom: '0.6rem' }}>🌱</div>
                #{activeChannel.name} -д ямар ч post алга. Анхных нь та байж магадгүй!
              </div>
            ) : (
              posts.map((p) => (
                <MessagePostItem key={p.id} post={p} canManage={!!user && (user.uid === p.authorId || user.role === 'admin')} />
              ))
            )}
          </div>

          <div className="comm-compose">
            <button
              className="comm-compose-input"
              onClick={openCompose}
              disabled={composeBlocked}
            >
              {composeBlocked
                ? `#${activeChannel.name} -д зөвхөн админ нийтлэх боломжтой`
                : `#${activeChannel.name} -д бичих...`}
            </button>
          </div>
        </section>
      </main>

      <style>{`
        .comm-shell {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex;
          background: #2a2b32;
          color: #fff;
        }
        .comm-sidebar {
          width: 260px;
          background: #1e1f26;
          display: flex;
          flex-direction: column;
          border-right: 1px solid rgba(0,0,0,0.3);
          flex-shrink: 0;
          overflow-y: auto;
        }
        .comm-back-sidebar {
          display: block;
          padding: 0.55rem 1rem 0.4rem;
          font-size: 0.74rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: rgba(255,255,255,0.45);
          text-decoration: none;
          text-transform: uppercase;
          transition: color 0.12s, background 0.12s;
        }
        .comm-back-sidebar:hover {
          color: #fff;
          background: rgba(255,255,255,0.04);
        }
        .comm-server {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.95rem 1rem;
          border-bottom: 1px solid rgba(0,0,0,0.3);
          box-shadow: 0 1px 0 rgba(255,255,255,0.04);
          font-weight: 800;
          font-size: 0.92rem;
          color: #fff;
          letter-spacing: 0.01em;
        }
        .comm-server-emoji { font-size: 1.15rem; }
        .comm-nav { padding: 0.85rem 0.55rem; }
        .comm-section-label {
          padding: 0 0.55rem 0.35rem;
          font-size: 0.66rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          color: rgba(255,255,255,0.42);
          text-transform: uppercase;
        }
        .comm-channel {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          width: 100%;
          padding: 0.42rem 0.6rem;
          margin-bottom: 1px;
          border-radius: 6px;
          background: transparent;
          border: none;
          color: rgba(255,255,255,0.62);
          font-family: inherit;
          font-size: 0.88rem;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .comm-channel:hover:not(:disabled):not(.active) {
          background: #2f3138;
          color: rgba(255,255,255,0.88);
        }
        .comm-channel.active {
          background: rgba(167,139,250,0.18);
          color: var(--accent);
          font-weight: 700;
        }
        .comm-channel.locked {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .comm-channel-emoji { font-size: 0.92rem; flex-shrink: 0; }
        .comm-channel-hash {
          color: rgba(255,255,255,0.35);
          font-weight: 500;
        }
        .comm-channel.active .comm-channel-hash {
          color: var(--accent);
        }
        .comm-channel-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .comm-channel-lock { font-size: 0.72rem; opacity: 0.7; }

        .comm-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          background: #2a2b32;
        }
        .comm-header {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          padding: 0 1rem;
          height: 50px;
          flex-shrink: 0;
          background: #2a2b32;
          border-bottom: 1px solid rgba(0,0,0,0.3);
          box-shadow: 0 1px 0 rgba(255,255,255,0.03);
        }
        .comm-hamburger {
          display: none;
          background: transparent;
          border: none;
          color: rgba(255,255,255,0.7);
          cursor: pointer;
          padding: 0.3rem;
          border-radius: 6px;
        }
        .comm-hamburger:hover { background: rgba(255,255,255,0.06); color: #fff; }
        .comm-back-mobile {
          display: none;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          color: rgba(255,255,255,0.7);
          font-size: 1.15rem;
          font-weight: 700;
          text-decoration: none;
          flex-shrink: 0;
        }
        .comm-back-mobile:hover { background: rgba(255,255,255,0.06); color: #fff; }
        .comm-header-title {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }
        .comm-header-divider {
          width: 1px;
          height: 22px;
          background: rgba(255,255,255,0.12);
          margin: 0 0.5rem;
          flex-shrink: 0;
        }
        .comm-header-desc {
          font-size: 0.82rem;
          color: rgba(255,255,255,0.5);
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .comm-newpost {
          padding: 0.45rem 0.95rem;
          border-radius: 7px;
          border: none;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          color: #fff;
          font-family: inherit;
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
          flex-shrink: 0;
          transition: opacity 0.15s, transform 0.1s;
        }
        .comm-newpost:hover:not(:disabled) { transform: translateY(-1px); }
        .comm-newpost:disabled { opacity: 0.4; cursor: not-allowed; }

        .comm-posts {
          flex: 1;
          overflow-y: auto;
          padding: 1rem 0 1.5rem;
        }

        .post-row {
          position: relative;
          padding: 0.7rem 1.2rem 0.7rem 1.2rem;
          transition: background 0.1s;
        }
        .post-row::before {
          content: '';
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 3px;
          background: var(--accent);
          opacity: 0;
          transition: opacity 0.12s;
        }
        .post-row:hover {
          background: rgba(255,255,255,0.03);
        }
        .post-row:hover::before { opacity: 1; }
        .post-row:hover .post-action { opacity: 1; }

        .post-link {
          display: flex;
          gap: 0.85rem;
          text-decoration: none;
          color: inherit;
        }
        .post-content { min-width: 0; flex: 1; }
        .post-meta {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          margin-bottom: 0.15rem;
          flex-wrap: wrap;
        }
        .post-author {
          font-size: 0.95rem;
          font-weight: 700;
          color: #fff;
        }
        .post-role {
          font-size: 0.6rem;
          font-weight: 800;
          letter-spacing: 0.05em;
          padding: 0.08rem 0.32rem;
          border-radius: 3px;
          background: rgba(255,255,255,0.06);
        }
        .post-time {
          font-size: 0.72rem;
          color: rgba(255,255,255,0.4);
          font-weight: 500;
        }
        .post-pinned {
          font-size: 0.7rem;
          color: var(--accent);
          font-weight: 700;
        }
        .post-title {
          font-size: 1.05rem;
          font-weight: 800;
          color: #fff;
          margin: 0.15rem 0 0.35rem;
          line-height: 1.3;
        }
        .post-text {
          font-size: 0.92rem;
          line-height: 1.55;
          color: rgba(255,255,255,0.78);
          white-space: pre-wrap;
          word-break: break-word;
          margin: 0 0 0.5rem;
        }
        .post-counts {
          font-size: 0.78rem;
          color: rgba(255,255,255,0.45);
        }
        .post-action {
          position: absolute;
          top: 0.55rem;
          right: 0.85rem;
          background: #34353c;
          border: 1px solid rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.7);
          width: 32px;
          height: 32px;
          border-radius: 7px;
          font-size: 0.95rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.12s, background 0.12s, color 0.12s;
        }
        .post-action:hover {
          background: rgba(248,113,113,0.15);
          color: #fca5a5;
          border-color: rgba(248,113,113,0.3);
        }

        .comm-compose {
          padding: 0.7rem 1rem 1rem;
          background: #2a2b32;
          flex-shrink: 0;
        }
        .comm-compose-input {
          width: 100%;
          height: 48px;
          padding: 0 1.1rem;
          background: #34353c;
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 10px;
          color: rgba(255,255,255,0.55);
          font-family: inherit;
          font-size: 0.92rem;
          text-align: left;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .comm-compose-input:hover:not(:disabled) {
          background: #3c3d44;
          color: rgba(255,255,255,0.75);
        }
        .comm-compose-input:disabled { opacity: 0.5; cursor: not-allowed; }

        .comm-backdrop { display: none; }

        @media (max-width: 900px) {
          .comm-sidebar {
            position: fixed;
            top: 0; left: 0; bottom: 0;
            z-index: 999;
            transform: translateX(-100%);
            transition: transform 0.22s cubic-bezier(.4,0,.2,1);
            box-shadow: 4px 0 24px rgba(0,0,0,0.4);
          }
          .comm-sidebar.open { transform: translateX(0); }
          .comm-backdrop {
            display: block;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 998;
            animation: commFade 0.18s ease;
          }
          .comm-hamburger { display: inline-flex; }
          .comm-back-mobile { display: inline-flex; }
          .comm-header-divider, .comm-header-desc { display: none; }
          .post-row { padding-left: 1rem; padding-right: 1rem; }
          .comm-newpost { display: none; }
        }
        @keyframes commFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  );
}

function MessagePostItem({ post, canManage }: { post: Post; canManage: boolean }) {
  const date = post.createdAt?.toDate ? post.createdAt.toDate() : new Date();
  const role = post.authorRole;
  const badge = role ? ROLE_BADGE[role] : null;

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Энэ post-ыг устгах уу?')) return;
    try {
      await deletePost(post.id);
    } catch (err) {
      console.error('[community] deletePost', err);
      alert('Устгахад алдаа гарлаа.');
    }
  }

  return (
    <div className="post-row">
      <Link href={`/community/${post.id}`} className="post-link">
        <Avatar name={post.authorName} photo={post.authorPhoto} size={40} />
        <div className="post-content">
          <div className="post-meta">
            <span className="post-author">{post.authorName}</span>
            {badge && (
              <span className="post-role" style={{ color: badge.color }}>
                {badge.label}
              </span>
            )}
            <span className="post-time" title={date.toLocaleString('mn-MN')}>
              {formatRelativeTime(date)}
            </span>
            {post.pinned && <span className="post-pinned">📌 Бэхэлсэн</span>}
          </div>
          <h3 className="post-title">{post.title}</h3>
          <p className="post-text">{post.body}</p>
          <div className="post-counts">
            💬 {post.commentCount} · ❤️ {post.likeCount}
          </div>
        </div>
      </Link>
      {canManage && (
        <button
          className="post-action"
          onClick={onDelete}
          title="Устгах"
          aria-label="Устгах"
        >
          🗑️
        </button>
      )}
    </div>
  );
}
