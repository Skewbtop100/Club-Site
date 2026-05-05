'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { formatRelativeTime } from '@/lib/relative-time';
import { showToast } from '@/lib/toast';
import {
  subscribePosts, createPost, deletePost,
  type Post, type PostCategory,
} from '@/lib/firebase/services/posts';
import type { AppUser } from '@/lib/auth-context';
import ImageUploader, {
  type UploadItem,
  isUploading,
  uploadedUrls,
} from '@/components/community/ImageUploader';
import ImageGrid from '@/components/community/ImageGrid';
import VideoUploader, { type VideoData } from '@/components/community/VideoUploader';
import VideoPlayer from '@/components/community/VideoPlayer';

type ChannelId = PostCategory | 'feed';

interface Channel {
  id: ChannelId;
  name: string;
  emoji: string;
  adminOnly?: boolean;
  isAll?: boolean;
}

const CHANNELS: { section: string | null; items: Channel[] }[] = [
  {
    section: null,
    items: [
      { id: 'feed', name: 'Feed', emoji: '🏠', isAll: true },
    ],
  },
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

const CHANNEL_DESCRIPTIONS: Record<ChannelId, string> = {
  feed:         'Бүх ангиллын постууд',
  announcement: 'Тэмцээний зар, мэдээ',
  general:      'Ерөнхий яриа, чат',
  question:     'Шооны асуулт, зөвлөгөө',
  achievement:  'Өөрийн амжилт, PB-г бахархан хуваалцах',
  video:        'Шооны видео хуваалцах',
};

const ROLE_BADGE: Record<NonNullable<Post['authorRole']>, { label: string; color: string; bg: string }> = {
  admin:   { label: 'ADMIN',   color: 'var(--accent)', bg: 'rgba(167,139,250,0.14)' },
  athlete: { label: 'ATHLETE', color: '#10b981',       bg: 'rgba(16,185,129,0.12)' },
  member:  { label: 'MEMBER',  color: 'var(--muted)',  bg: 'rgba(127,127,127,0.12)' },
};

// All post categories (excludes 'feed') — the targets users can post to.
const POST_CATEGORIES: { id: PostCategory; name: string; emoji: string; adminOnly?: boolean }[] = [
  { id: 'general',      name: 'ерөнхий',  emoji: '💬' },
  { id: 'question',     name: 'асуулт',   emoji: '❓' },
  { id: 'achievement',  name: 'амжилт',   emoji: '🏆' },
  { id: 'video',        name: 'видео',    emoji: '🎥' },
  { id: 'announcement', name: 'зар',      emoji: '📢', adminOnly: true },
];

const CATEGORY_META: Record<PostCategory, { name: string; emoji: string }> = {
  announcement: { name: 'зар',      emoji: '📢' },
  general:      { name: 'ерөнхий',  emoji: '💬' },
  question:     { name: 'асуулт',   emoji: '❓' },
  achievement:  { name: 'амжилт',   emoji: '🏆' },
  video:        { name: 'видео',    emoji: '🎥' },
};

const DEFAULT_CHANNEL: Channel = CHANNELS[0].items[0]; // feed

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

function Avatar({ name, photo, size = 44 }: { name: string; photo?: string | null; size?: number }) {
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
        position: 'fixed', inset: 0,
        background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
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
  const postsScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    const opts = activeChannel.isAll ? {} : { category: activeChannel.id as PostCategory };
    const unsub = subscribePosts((items) => {
      setPosts(items);
      setLoading(false);
    }, opts);
    return () => unsub();
  }, [activeChannel.id, activeChannel.isAll]);

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
            {CHANNELS.map((section, sIdx) => (
              <div key={section.section ?? `_top_${sIdx}`} style={{ marginBottom: '0.65rem' }}>
                {section.section && (
                  <div className="comm-section-label">{section.section}</div>
                )}
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
                      {!ch.isAll && <span className="comm-channel-hash">#</span>}
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
            <Link href="/" className="comm-back-mobile" aria-label="Буцах">←</Link>
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
              {!activeChannel.isAll && (
                <span style={{ color: 'var(--muted)', fontWeight: 600 }}>#</span>
              )}
              <span style={{ fontWeight: 800 }}>{activeChannel.name}</span>
              <span className="comm-header-divider" />
              <span className="comm-header-desc">{CHANNEL_DESCRIPTIONS[activeChannel.id]}</span>
            </div>
          </header>

          <div className="comm-posts" ref={postsScrollRef}>
            <div className="feed-col">
              <TopCompose
                activeChannel={activeChannel}
                user={user}
                onPosted={() => postsScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              />

              {loading ? (
                <div className="feed-status">Уншиж байна...</div>
              ) : posts.length === 0 ? (
                <div className="feed-empty">
                  <div style={{ fontSize: '2.4rem', marginBottom: '0.6rem' }}>🌱</div>
                  {activeChannel.isAll
                    ? 'Анхны post гарах гэж байна. Та эхлэх үү?'
                    : `#${activeChannel.name} -д ямар ч post алга. Анхных нь та байж магадгүй!`}
                </div>
              ) : (
                posts.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    canManage={!!user && (user.uid === p.authorId || user.role === 'admin')}
                  />
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      <style>{`
        .comm-shell {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex;
          background: var(--bg);
          color: var(--text);
        }
        .comm-sidebar {
          width: 260px;
          background: #1e1f26;
          color: #fff;
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
        .comm-back-sidebar:hover { color: #fff; background: rgba(255,255,255,0.04); }
        .comm-server {
          display: flex; align-items: center; gap: 0.55rem;
          padding: 0.95rem 1rem;
          border-bottom: 1px solid rgba(0,0,0,0.3);
          box-shadow: 0 1px 0 rgba(255,255,255,0.04);
          font-weight: 800; font-size: 0.92rem;
          color: #fff; letter-spacing: 0.01em;
        }
        .comm-server-emoji { font-size: 1.15rem; }
        .comm-nav { padding: 0.85rem 0.55rem; }
        .comm-section-label {
          padding: 0 0.55rem 0.35rem;
          font-size: 0.66rem; font-weight: 800; letter-spacing: 0.08em;
          color: rgba(255,255,255,0.42); text-transform: uppercase;
        }
        .comm-channel {
          display: flex; align-items: center; gap: 0.4rem;
          width: 100%; padding: 0.42rem 0.6rem; margin-bottom: 1px;
          border-radius: 6px; background: transparent; border: none;
          color: rgba(255,255,255,0.62);
          font-family: inherit; font-size: 0.88rem; font-weight: 600;
          text-align: left; cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .comm-channel:hover:not(:disabled):not(.active) {
          background: #2f3138; color: rgba(255,255,255,0.88);
        }
        .comm-channel.active {
          background: rgba(167,139,250,0.18);
          color: var(--accent); font-weight: 700;
        }
        .comm-channel.locked { opacity: 0.45; cursor: not-allowed; }
        .comm-channel-emoji { font-size: 0.92rem; flex-shrink: 0; }
        .comm-channel-hash { color: rgba(255,255,255,0.35); font-weight: 500; }
        .comm-channel.active .comm-channel-hash { color: var(--accent); }
        .comm-channel-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .comm-channel-lock { font-size: 0.72rem; opacity: 0.7; }

        .comm-main {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column;
          background: var(--bg);
          color: var(--text);
        }
        .comm-header {
          display: flex; align-items: center; gap: 0.7rem;
          padding: 0 1rem; height: 50px; flex-shrink: 0;
          background: var(--card);
          border-bottom: 1px solid rgba(127,127,127,0.18);
        }
        .comm-hamburger {
          display: none;
          background: transparent; border: none;
          color: var(--muted); cursor: pointer;
          padding: 0.3rem; border-radius: 6px;
        }
        .comm-hamburger:hover { background: rgba(127,127,127,0.1); color: var(--text); }
        .comm-back-mobile {
          display: none;
          align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 6px;
          color: var(--muted); font-size: 1.15rem; font-weight: 700;
          text-decoration: none; flex-shrink: 0;
        }
        .comm-back-mobile:hover { background: rgba(127,127,127,0.1); color: var(--text); }
        .comm-header-title {
          display: flex; align-items: center; gap: 0.45rem;
          flex: 1; min-width: 0; overflow: hidden;
        }
        .comm-header-divider {
          width: 1px; height: 22px;
          background: rgba(127,127,127,0.25);
          margin: 0 0.5rem; flex-shrink: 0;
        }
        .comm-header-desc {
          font-size: 0.82rem; color: var(--muted); font-weight: 500;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          min-width: 0;
        }

        .comm-posts {
          flex: 1; overflow-y: auto;
        }
        .feed-col {
          max-width: 680px; margin: 0 auto;
          padding: 1.5rem 1rem 2.5rem;
          display: flex; flex-direction: column; gap: 1rem;
        }
        .feed-status, .feed-empty {
          text-align: center; padding: 3rem 1rem;
          color: var(--muted); font-size: 0.95rem;
        }
        .feed-empty { padding: 4rem 1.5rem; }

        /* ── Compose ── */
        .tc-card {
          background: var(--card);
          border: 1px solid rgba(127,127,127,0.16);
          border-radius: 14px;
          padding: 0.85rem;
          transition: border-color 0.15s;
        }
        .tc-collapsed {
          display: flex; align-items: center; gap: 0.7rem;
        }
        .tc-collapsed-input {
          flex: 1;
          height: 42px;
          padding: 0 1rem;
          background: rgba(127,127,127,0.08);
          border: none; border-radius: 999px;
          color: var(--muted);
          font-family: inherit; font-size: 0.92rem;
          text-align: left; cursor: pointer;
          transition: background 0.12s;
        }
        .tc-collapsed-input:hover:not(:disabled) {
          background: rgba(127,127,127,0.14);
        }
        .tc-collapsed-input:disabled {
          cursor: not-allowed; opacity: 0.6;
        }
        .tc-signin {
          flex: 1;
          height: 42px; padding: 0 1rem;
          display: inline-flex; align-items: center;
          background: rgba(127,127,127,0.08);
          border-radius: 999px;
          color: var(--muted); font-size: 0.92rem; font-weight: 600;
          text-decoration: none;
        }
        .tc-signin:hover { background: rgba(127,127,127,0.14); color: var(--text); }
        .tc-blocked {
          flex: 1;
          height: 42px; padding: 0 1rem;
          display: inline-flex; align-items: center;
          background: rgba(127,127,127,0.05);
          border-radius: 999px;
          color: var(--muted); font-size: 0.9rem; opacity: 0.7;
        }
        .tc-expanded {
          display: flex; flex-direction: column; gap: 0.7rem;
        }
        .tc-pills { display: flex; gap: 0.4rem; flex-wrap: wrap; }
        .tc-pill {
          padding: 0.35rem 0.8rem;
          border-radius: 999px;
          background: rgba(127,127,127,0.08);
          border: 1px solid transparent;
          color: var(--text);
          font-family: inherit; font-size: 0.8rem; font-weight: 600;
          cursor: pointer;
          display: inline-flex; align-items: center; gap: 0.3rem;
          transition: all 0.12s;
        }
        .tc-pill:hover:not(.active):not(.disabled) {
          background: rgba(127,127,127,0.14);
        }
        .tc-pill.active {
          background: rgba(167,139,250,0.16);
          border-color: rgba(167,139,250,0.4);
          color: var(--accent);
        }
        .tc-pill.disabled { opacity: 0.4; cursor: not-allowed; }
        .tc-textarea {
          width: 100%;
          min-height: 96px; max-height: 240px;
          background: transparent; border: none; outline: none;
          color: var(--text); resize: none;
          font-family: inherit; font-size: 0.95rem; line-height: 1.55;
          padding: 0.4rem 0.1rem;
        }
        .tc-textarea::placeholder { color: var(--muted); }
        .tc-error {
          padding: 0.5rem 0.75rem;
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: 8px;
          color: #fca5a5; font-size: 0.82rem;
        }
        .tc-actions {
          display: flex; align-items: center; justify-content: space-between;
          gap: 0.5rem; padding-top: 0.4rem;
          border-top: 1px solid rgba(127,127,127,0.14);
        }
        .tc-icons { display: flex; gap: 0.15rem; }
        .tc-icon {
          width: 32px; height: 32px;
          background: transparent; border: none; border-radius: 6px;
          color: var(--muted); font-size: 1rem;
          cursor: not-allowed; opacity: 0.55;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .tc-icon-active {
          cursor: pointer; opacity: 1;
          color: var(--text);
        }
        .tc-icon-active:hover {
          background: rgba(127,127,127,0.12);
          color: var(--accent);
        }
        .tc-icon-disabled { opacity: 0.45; cursor: not-allowed; }
        .tc-icon-disabled:hover { background: transparent; color: var(--muted); }
        .tc-buttons { display: flex; gap: 0.5rem; align-items: center; }
        .tc-cancel {
          padding: 0.45rem 0.9rem;
          background: transparent; border: 1px solid rgba(127,127,127,0.25);
          border-radius: 8px;
          color: var(--muted);
          font-family: inherit; font-size: 0.82rem; font-weight: 600;
          cursor: pointer;
          transition: all 0.12s;
        }
        .tc-cancel:hover { color: var(--text); border-color: rgba(127,127,127,0.4); }
        .tc-submit {
          padding: 0.5rem 1.1rem;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          border: none; border-radius: 8px;
          color: #fff;
          font-family: inherit; font-size: 0.85rem; font-weight: 700;
          cursor: pointer;
          display: inline-flex; align-items: center; gap: 0.35rem;
          transition: opacity 0.15s, transform 0.1s;
        }
        .tc-submit:hover:not(:disabled) { transform: translateY(-1px); }
        .tc-submit:disabled { opacity: 0.4; cursor: not-allowed; }
        .tc-spin { animation: tcSpin 0.7s linear infinite; }
        @keyframes tcSpin { to { transform: rotate(360deg); } }
        .tc-expanded-link {
          display: inline-block;
          font-size: 0.78rem; color: var(--muted);
          text-decoration: none;
          padding: 0.2rem 0;
        }
        .tc-expanded-link:hover { color: var(--accent); text-decoration: underline; }

        /* ── Post card ── */
        .pc-card {
          background: var(--card);
          border: 1px solid rgba(127,127,127,0.16);
          border-radius: 14px;
          overflow: hidden;
          transition: box-shadow 0.15s, border-color 0.15s;
        }
        .pc-card:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .pc-header {
          display: flex; align-items: flex-start; gap: 0.7rem;
          padding: 0.875rem;
        }
        .pc-author-block { flex: 1; min-width: 0; }
        .pc-author-row {
          display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;
        }
        .pc-author-name {
          font-size: 0.95rem; font-weight: 700; color: var(--text);
        }
        .pc-meta-row {
          display: flex; align-items: center; gap: 0.5rem;
          margin-top: 0.2rem; flex-wrap: wrap;
        }
        .pc-role {
          font-size: 0.6rem; font-weight: 800;
          letter-spacing: 0.05em;
          padding: 0.1rem 0.36rem;
          border-radius: 4px;
        }
        .pc-time {
          font-size: 0.75rem; color: var(--muted); font-weight: 500;
        }
        .pc-channel-pill {
          font-size: 0.7rem; font-weight: 600;
          padding: 0.12rem 0.45rem;
          border-radius: 999px;
          background: rgba(167,139,250,0.12);
          color: var(--accent);
          text-decoration: none;
          display: inline-flex; align-items: center; gap: 0.2rem;
        }
        .pc-channel-pill:hover { background: rgba(167,139,250,0.2); }
        .pc-pinned {
          font-size: 0.7rem; color: var(--accent); font-weight: 700;
        }

        .pc-menu-wrap { position: relative; flex-shrink: 0; }
        .pc-menu-btn {
          width: 32px; height: 32px;
          background: transparent; border: none; border-radius: 6px;
          color: var(--muted); font-size: 1.1rem; font-weight: 700;
          cursor: pointer; line-height: 1;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .pc-menu-btn:hover { background: rgba(127,127,127,0.12); color: var(--text); }
        .pc-menu {
          position: absolute; top: calc(100% + 4px); right: 0;
          min-width: 160px;
          background: var(--card);
          border: 1px solid rgba(127,127,127,0.2);
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25);
          padding: 4px;
          z-index: 10;
          animation: pcFade 0.12s ease;
        }
        .pc-menu-item {
          display: flex; align-items: center; gap: 0.5rem;
          width: 100%;
          padding: 0.5rem 0.6rem; border-radius: 7px;
          background: transparent; border: none;
          color: var(--text);
          font-family: inherit; font-size: 0.85rem; font-weight: 600;
          text-align: left; cursor: pointer;
        }
        .pc-menu-item.danger { color: #f87171; }
        .pc-menu-item:hover { background: rgba(127,127,127,0.1); }
        .pc-menu-item.danger:hover { background: rgba(248,113,113,0.1); }

        .pc-body-link {
          display: block; padding: 0 0.875rem 0.875rem;
          color: inherit; text-decoration: none;
        }
        .pc-title {
          font-size: 1.1rem; font-weight: 800; color: var(--text);
          margin: 0 0 0.4rem; line-height: 1.3;
        }
        .pc-text {
          font-size: 0.95rem; line-height: 1.55; color: var(--text);
          white-space: pre-wrap; word-break: break-word;
          margin: 0;
        }

        .pc-images {
          padding: 0 0.875rem 0.875rem;
        }
        .pc-stats {
          padding: 0.7rem 0.875rem;
          border-top: 1px solid rgba(127,127,127,0.14);
          font-size: 0.78rem; color: var(--muted);
          display: flex; gap: 0.6rem;
        }
        .pc-actions {
          display: flex;
          padding: 0.4rem;
          border-top: 1px solid rgba(127,127,127,0.14);
          gap: 0.2rem;
        }
        .pc-action {
          flex: 1;
          display: inline-flex; align-items: center; justify-content: center;
          gap: 0.4rem;
          padding: 0.55rem 0.5rem;
          background: transparent; border: none; border-radius: 8px;
          color: var(--muted);
          font-family: inherit; font-size: 0.85rem; font-weight: 600;
          cursor: pointer; text-decoration: none;
          transition: background 0.12s, color 0.12s;
        }
        .pc-action:hover {
          background: rgba(127,127,127,0.08);
          color: var(--text);
        }
        .pc-action.like:hover { color: #f87171; }

        @keyframes pcFade {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .comm-backdrop { display: none; }

        @media (max-width: 900px) {
          .comm-sidebar {
            position: fixed; top: 0; left: 0; bottom: 0;
            z-index: 999;
            transform: translateX(-100%);
            transition: transform 0.22s cubic-bezier(.4,0,.2,1);
            box-shadow: 4px 0 24px rgba(0,0,0,0.4);
          }
          .comm-sidebar.open { transform: translateX(0); }
          .comm-backdrop {
            display: block;
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 998;
            animation: commFade 0.18s ease;
          }
          .comm-hamburger { display: inline-flex; }
          .comm-back-mobile { display: inline-flex; }
          .comm-header-divider, .comm-header-desc { display: none; }
        }
        @media (max-width: 600px) {
          .feed-col { padding: 1rem 0.75rem 2rem; gap: 0.75rem; }
          .tc-card { padding: 0.7rem; }
        }
        @keyframes commFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  );
}

function TopCompose({
  activeChannel, user, onPosted,
}: {
  activeChannel: Channel;
  user: AppUser | null;
  onPosted: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // TODO(cleanup): if user uploads images/video then cancels, the assets
  // stay orphaned in Cloudinary. Acceptable for now (25 GB free); add a
  // sweep job (cron + Admin API) once we approach the storage limit.
  const [images, setImages] = useState<UploadItem[]>([]);
  const [video, setVideo] = useState<VideoData | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoPopoverOpen, setVideoPopoverOpen] = useState(false);
  const uploaderInputId = 'tc-img-input';

  function openVideoPopover() {
    if (video) return; // X on preview is the way to remove
    if (images.length > 0) {
      if (!confirm('Зураг устах болно. Үргэлжлүүлэх үү?')) return;
      setImages([]);
    }
    setVideoPopoverOpen(true);
  }

  function openImagePicker() {
    if (video) {
      if (!confirm('Бичлэг устах болно. Үргэлжлүүлэх үү?')) return;
      setVideo(null);
    }
    document.getElementById(uploaderInputId)?.click();
  }

  // The category the post will be created in. Defaults to the active
  // channel (or 'general' when on Feed). Resets when the user navigates
  // to a different channel.
  const defaultPostCategory: PostCategory =
    activeChannel.isAll ? 'general' : (activeChannel.id as PostCategory);
  const [postCategory, setPostCategory] = useState<PostCategory>(defaultPostCategory);
  useEffect(() => {
    setPostCategory(defaultPostCategory);
  }, [defaultPostCategory]);

  // Auto-grow textarea.
  useEffect(() => {
    if (!expanded) return;
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 240) + 'px';
  }, [body, expanded]);

  // Focus textarea when expanding.
  useEffect(() => {
    if (expanded) taRef.current?.focus();
  }, [expanded]);

  // Sign-out state — user must sign in to compose at all.
  if (!user) {
    const target = `/community?channel=${activeChannel.id}`;
    return (
      <div className="tc-card">
        <div className="tc-collapsed">
          <Avatar name="?" size={36} />
          <Link
            href={`/login?redirect=${encodeURIComponent(target)}`}
            className="tc-signin"
          >
            Нэвтэрч пост бичих...
          </Link>
        </div>
      </div>
    );
  }

  // Channel-level admin gate (for announcement when on that channel
  // specifically — Feed always allows compose since user can pick another channel).
  const channelBlocked =
    !activeChannel.isAll && activeChannel.adminOnly && user.role !== 'admin';

  if (channelBlocked) {
    return (
      <div className="tc-card">
        <div className="tc-collapsed">
          <Avatar name={user.displayName} photo={user.photoURL} size={36} />
          <span className="tc-blocked">Зөвхөн админ #{activeChannel.name} -д нийтэлнэ</span>
        </div>
      </div>
    );
  }

  function collapse() {
    setExpanded(false);
    setBody('');
    setError(null);
    setImages([]);
    setVideo(null);
    setVideoPopoverOpen(false);
  }

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting || !user) return;
    if (isUploading(images) || videoUploading) return;
    if (postCategory === 'announcement' && user.role !== 'admin') {
      setError('Зар нь зөвхөн админ нийтлэх боломжтой.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const urls = uploadedUrls(images);
      // Video wins over images if both somehow set (mutual-exclusion UI
      // should prevent this, but defend against state desync).
      const mediaFields = video
        ? {
            videoUrl: video.videoUrl,
            videoType: video.videoType,
            videoThumbnail: video.videoThumbnail,
          }
        : urls.length > 0
          ? { imageUrls: urls }
          : {};
      await createPost({
        title: trimmed.slice(0, 60).trim(),
        body: trimmed,
        category: postCategory,
        authorId: user.uid,
        authorName: user.displayName,
        ...(user.photoURL ? { authorPhoto: user.photoURL } : {}),
        authorRole: user.role,
        ...mediaFields,
      });
      collapse();
      onPosted();
    } catch (err) {
      console.error('[community] inline createPost', err);
      setError(err instanceof Error ? err.message : 'Илгээхэд алдаа гарлаа.');
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      collapse();
    }
  }

  if (!expanded) {
    return (
      <div className="tc-card">
        <div className="tc-collapsed">
          <Avatar name={user.displayName} photo={user.photoURL} size={36} />
          <button
            type="button"
            className="tc-collapsed-input"
            onClick={() => setExpanded(true)}
          >
            Юу шинэ зүйл байна?
          </button>
        </div>
      </div>
    );
  }

  const uploading = isUploading(images) || videoUploading;
  const canSend = body.trim().length > 0 && !submitting && !uploading;
  const isAdmin = user.role === 'admin';

  return (
    <div className="tc-card">
      <div className="tc-expanded">
        <div className="tc-pills" aria-label="Channel">
          {POST_CATEGORIES.filter(c => !c.adminOnly || isAdmin).map((c) => {
            const active = postCategory === c.id;
            return (
              <button
                type="button"
                key={c.id}
                className={`tc-pill${active ? ' active' : ''}`}
                onClick={() => setPostCategory(c.id)}
              >
                <span>{c.emoji}</span>#{c.name}
              </button>
            );
          })}
        </div>

        <ImageUploader
          items={images}
          onChange={setImages}
          inputId={uploaderInputId}
        />
        <VideoUploader
          value={video}
          onChange={setVideo}
          popoverOpen={videoPopoverOpen}
          onPopoverChange={setVideoPopoverOpen}
          onUploadingChange={setVideoUploading}
        />

        <textarea
          ref={taRef}
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Юу шинэ зүйл байна?"
          disabled={submitting}
          className="tc-textarea"
        />

        {error && <div className="tc-error">{error}</div>}

        <Link
          href={`/community/new?channel=${postCategory}`}
          className="tc-expanded-link"
        >
          Дэлгэрэнгүй бичих →
        </Link>

        <div className="tc-actions">
          <div className="tc-icons">
            <button
              type="button"
              className="tc-icon tc-icon-active"
              title="Зураг нэмэх"
              aria-label="Зураг нэмэх"
              onClick={openImagePicker}
            >
              📷
            </button>
            <button
              type="button"
              className={`tc-icon tc-icon-active${video ? ' tc-icon-disabled' : ''}`}
              title={video ? 'Бичлэг хэдийн нэмсэн' : 'Бичлэг нэмэх'}
              aria-label="Бичлэг нэмэх"
              onClick={openVideoPopover}
              disabled={!!video}
            >
              🎥
            </button>
            <button type="button" className="tc-icon" disabled title="Удахгүй" aria-label="Эможи">😀</button>
          </div>
          <div className="tc-buttons">
            <button
              type="button"
              className="tc-cancel"
              onClick={collapse}
              disabled={submitting}
            >
              Болих
            </button>
            <button
              type="button"
              className="tc-submit"
              onClick={submit}
              disabled={!canSend}
            >
              {submitting ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" className="tc-spin" aria-hidden>
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="40 60" strokeLinecap="round"/>
                  </svg>
                  Илгээж байна
                </>
              ) : (
                <>Илгээх →</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostCard({ post, canManage }: { post: Post; canManage: boolean }) {
  const date = post.createdAt?.toDate ? post.createdAt.toDate() : new Date();
  const role = post.authorRole;
  const badge = role ? ROLE_BADGE[role] : null;
  const cat = CATEGORY_META[post.category];

  async function onShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const url = `${window.location.origin}/community/${post.id}`;
      await navigator.clipboard.writeText(url);
      showToast({ msg: 'Хуулагдлаа!', tone: 'success' });
    } catch {
      showToast({ msg: 'Хуулж чадсангүй', tone: 'error' });
    }
  }

  return (
    <article className="pc-card">
      <header className="pc-header">
        <Avatar name={post.authorName} photo={post.authorPhoto} size={44} />
        <div className="pc-author-block">
          <div className="pc-author-row">
            <span className="pc-author-name">{post.authorName}</span>
            {badge && (
              <span
                className="pc-role"
                style={{ color: badge.color, background: badge.bg }}
              >
                {badge.label}
              </span>
            )}
          </div>
          <div className="pc-meta-row">
            <Link
              href={`/community?channel=${post.category}`}
              className="pc-channel-pill"
              onClick={(e) => e.stopPropagation()}
            >
              <span>{cat.emoji}</span>#{cat.name}
            </Link>
            <span className="pc-time" title={date.toLocaleString('mn-MN')}>
              {formatRelativeTime(date)}
            </span>
            {post.pinned && <span className="pc-pinned">📌 Бэхэлсэн</span>}
          </div>
        </div>
        {canManage && <PostMenu postId={post.id} />}
      </header>

      <Link href={`/community/${post.id}`} className="pc-body-link">
        {post.title && <h3 className="pc-title">{post.title}</h3>}
        <p className="pc-text">{post.body}</p>
      </Link>

      {post.videoUrl && post.videoType ? (
        <div className="pc-images">
          <VideoPlayer
            videoUrl={post.videoUrl}
            videoType={post.videoType}
            videoThumbnail={post.videoThumbnail}
          />
        </div>
      ) : post.imageUrls && post.imageUrls.length > 0 ? (
        <div className="pc-images">
          <ImageGrid imageUrls={post.imageUrls} />
        </div>
      ) : null}

      <div className="pc-stats">
        <span>❤️ {post.likeCount} likes</span>
        <span>·</span>
        <span>💬 {post.commentCount} comments</span>
      </div>

      <div className="pc-actions">
        <button type="button" className="pc-action like" aria-label="Like">
          <span>❤️</span> Like
        </button>
        <Link href={`/community/${post.id}`} className="pc-action">
          <span>💬</span> Comment
        </Link>
        <button type="button" className="pc-action" onClick={onShare} aria-label="Share">
          <span>↗</span> Share
        </button>
      </div>
    </article>
  );
}

function PostMenu({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function onDelete() {
    setOpen(false);
    if (!confirm('Энэ post-ыг устгах уу?')) return;
    try {
      await deletePost(postId);
      showToast({ msg: 'Устгагдлаа', tone: 'success' });
    } catch (err) {
      console.error('[community] deletePost', err);
      showToast({ msg: 'Устгахад алдаа гарлаа', tone: 'error' });
    }
  }

  return (
    <div className="pc-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="pc-menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Илүү"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div className="pc-menu" role="menu">
          <button
            type="button"
            className="pc-menu-item danger"
            onClick={onDelete}
            role="menuitem"
          >
            🗑️ Устгах
          </button>
        </div>
      )}
    </div>
  );
}
