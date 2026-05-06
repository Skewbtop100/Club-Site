'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { formatRelativeTime } from '@/lib/relative-time';
import { showToast } from '@/lib/toast';
import {
  subscribeComments, createComment, deleteComment, toggleCommentReaction,
  type Comment,
} from '@/lib/firebase/services/posts';
import { AppleEmoji } from '@/lib/community/AppleEmoji';

interface Props {
  postId: string;
}

const ROLE_BADGE: Record<NonNullable<Comment['authorRole']>, { label: string; color: string; bg: string }> = {
  admin:   { label: 'ADMIN',   color: 'var(--accent)', bg: 'rgba(167,139,250,0.14)' },
  athlete: { label: 'ATHLETE', color: '#10b981',       bg: 'rgba(16,185,129,0.12)' },
  member:  { label: 'MEMBER',  color: 'var(--muted)',  bg: 'rgba(127,127,127,0.12)' },
};

function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const cp = trimmed.codePointAt(0);
  return cp ? String.fromCodePoint(cp).toUpperCase() : '?';
}

function Avatar({ name, photo, size = 32 }: { name: string; photo?: string | null; size?: number }) {
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

export default function InlineCommentThread({ postId }: Props) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [composeBody, setComposeBody] = useState('');
  const [composeSubmitting, setComposeSubmitting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const composeTaRef = useRef<HTMLTextAreaElement>(null);

  // Reply state — only one reply textarea open at a time per thread.
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  // Local "did I like this comment" tracking. Optimistic only — not
  // persisted across reloads. Counts come from comment.likeCount which
  // IS persisted.
  // TODO(reactions): query the user's reactions on mount so the heart
  // shows filled for previously-liked comments. Skipped for now to avoid
  // an N+1 read per thread.
  const [myLiked, setMyLiked] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const unsub = subscribeComments(postId, setComments);
    return () => unsub();
  }, [postId]);

  useEffect(() => {
    const ta = composeTaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, [composeBody]);

  const { topLevel, repliesByParent } = useMemo(() => {
    const top: Comment[] = [];
    const reply: Record<string, Comment[]> = {};
    for (const c of comments) {
      if (c.parentCommentId) {
        (reply[c.parentCommentId] ||= []).push(c);
      } else {
        top.push(c);
      }
    }
    return { topLevel: top, repliesByParent: reply };
  }, [comments]);

  async function submitTopLevel() {
    const body = composeBody.trim();
    if (!body || composeSubmitting || !user) return;
    setComposeError(null);
    setComposeSubmitting(true);
    try {
      await createComment({
        postId,
        body,
        authorId: user.uid,
        authorName: user.displayName,
        ...(user.photoURL ? { authorPhoto: user.photoURL } : {}),
        authorRole: user.role,
      });
      setComposeBody('');
    } catch (err) {
      console.error('[community] createComment', err);
      setComposeError(err instanceof Error ? err.message : 'Илгээхэд алдаа гарлаа.');
    } finally {
      setComposeSubmitting(false);
    }
  }

  async function submitReply(parentId: string) {
    const body = replyBody.trim();
    if (!body || replySubmitting || !user) return;
    setReplySubmitting(true);
    try {
      await createComment({
        postId,
        body,
        parentCommentId: parentId,
        authorId: user.uid,
        authorName: user.displayName,
        ...(user.photoURL ? { authorPhoto: user.photoURL } : {}),
        authorRole: user.role,
      });
      setReplyBody('');
      setReplyToId(null);
    } catch (err) {
      console.error('[community] createComment (reply)', err);
      showToast({ msg: 'Хариулт илгээхэд алдаа гарлаа', tone: 'error' });
    } finally {
      setReplySubmitting(false);
    }
  }

  function openReply(commentId: string) {
    setReplyToId((cur) => (cur === commentId ? null : commentId));
    setReplyBody('');
  }

  function cancelReply() {
    setReplyToId(null);
    setReplyBody('');
  }

  function onComposeKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitTopLevel();
    }
  }

  return (
    <div className="ict">
      {topLevel.length === 0 ? (
        <div className="ict-empty">Анхны сэтгэгдлийг бичээрэй</div>
      ) : (
        <div className="ict-list">
          {topLevel.map((c) => (
            <CommentItem
              key={c.id}
              postId={postId}
              comment={c}
              isReply={false}
              myLiked={myLiked}
              setMyLiked={setMyLiked}
            >
              {replyToId === c.id && (
                <div className="ict-reply-row">
                  <Avatar name={user?.displayName ?? '?'} photo={user?.photoURL} size={28} />
                  <textarea
                    autoFocus
                    rows={1}
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        submitReply(c.id);
                      } else if (e.key === 'Escape') {
                        cancelReply();
                      }
                    }}
                    placeholder={`${c.authorName}-д хариулах...`}
                    disabled={replySubmitting}
                    className="ict-reply-textarea"
                  />
                  <button
                    type="button"
                    className="ict-reply-x"
                    onClick={cancelReply}
                    aria-label="Болих"
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className="ict-send"
                    onClick={() => submitReply(c.id)}
                    disabled={!replyBody.trim() || replySubmitting}
                    aria-label="Илгээх"
                  >
                    →
                  </button>
                </div>
              )}
              {(repliesByParent[c.id] ?? []).length > 0 && (
                <div className="ict-replies">
                  {repliesByParent[c.id].map((r) => (
                    <CommentItem
                      key={r.id}
                      postId={postId}
                      comment={r}
                      isReply
                      myLiked={myLiked}
                      setMyLiked={setMyLiked}
                    />
                  ))}
                </div>
              )}
              {!isReplyOpenSomewhereElse(replyToId, c.id) && (
                <ReplyButton
                  onClick={() => openReply(c.id)}
                  disabled={!user}
                />
              )}
            </CommentItem>
          ))}
        </div>
      )}

      {/* Compose row */}
      {user ? (
        <div className="ict-compose-row">
          <Avatar name={user.displayName} photo={user.photoURL} size={32} />
          <div className="ict-compose-shell">
            {composeError && <div className="ict-error">{composeError}</div>}
            <textarea
              ref={composeTaRef}
              rows={1}
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              onKeyDown={onComposeKeyDown}
              placeholder="Сэтгэгдэл бичих..."
              disabled={composeSubmitting}
              className="ict-compose-textarea"
            />
          </div>
          <button
            type="button"
            className="ict-send"
            onClick={submitTopLevel}
            disabled={!composeBody.trim() || composeSubmitting}
            aria-label="Илгээх"
          >
            →
          </button>
        </div>
      ) : (
        <div className="ict-signin">
          Сэтгэгдэл бичихийн тулд{' '}
          <Link
            href="/login?redirect=/community"
            className="ict-signin-link"
            onClick={(e) => e.stopPropagation()}
          >
            нэвтэрнэ үү
          </Link>
        </div>
      )}

      <style>{`
        .ict {
          padding: 0.85rem 0.875rem;
          border-top: 1px solid rgba(127,127,127,0.14);
          font-size: 14px;
          color: var(--text);
        }
        .ict-empty {
          padding: 1rem 0;
          text-align: center;
          color: var(--muted);
          font-size: 13px;
        }
        .ict-list {
          display: flex; flex-direction: column;
          gap: 12px;
          margin-bottom: 12px;
        }
        .ict-replies {
          margin-top: 8px;
          margin-left: 32px;
          padding-left: 12px;
          border-left: 2px solid rgba(127,127,127,0.18);
          display: flex; flex-direction: column;
          gap: 10px;
        }
        .ict-reply-row {
          display: flex; align-items: flex-start;
          gap: 8px;
          margin-top: 8px;
          margin-left: 32px;
        }
        .ict-reply-textarea {
          flex: 1; min-width: 0;
          min-height: 32px; max-height: 100px;
          padding: 6px 10px;
          background: var(--card);
          border: 1px solid rgba(127,127,127,0.2);
          border-radius: 12px;
          color: var(--text);
          font-family: inherit; font-size: 14px; line-height: 1.45;
          outline: none;
          resize: none;
        }
        .ict-reply-textarea:focus { border-color: rgba(167,139,250,0.5); }
        .ict-reply-x {
          width: 28px; height: 28px;
          background: transparent;
          border: 1px solid rgba(127,127,127,0.2);
          border-radius: 999px;
          color: var(--muted);
          font-size: 1rem; line-height: 1;
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .ict-reply-x:hover { background: rgba(127,127,127,0.1); color: var(--text); }
        .ict-send {
          width: 32px; height: 32px;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          border: none; border-radius: 999px;
          color: #fff;
          font-size: 1rem; font-weight: 800;
          cursor: pointer;
          flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          transition: opacity 0.15s, transform 0.1s;
        }
        .ict-send:hover:not(:disabled) { transform: translateY(-1px); }
        .ict-send:disabled { opacity: 0.4; cursor: not-allowed; }
        .ict-compose-row {
          display: flex; align-items: flex-end;
          gap: 8px;
          padding-top: 4px;
        }
        .ict-compose-shell {
          flex: 1; min-width: 0;
        }
        .ict-compose-textarea {
          width: 100%;
          min-height: 36px; max-height: 140px;
          padding: 8px 12px;
          background: var(--card);
          border: 1px solid rgba(127,127,127,0.2);
          border-radius: 16px;
          color: var(--text);
          font-family: inherit; font-size: 14px; line-height: 1.45;
          outline: none;
          resize: none;
        }
        .ict-compose-textarea:focus { border-color: rgba(167,139,250,0.5); }
        .ict-error {
          padding: 6px 10px;
          margin-bottom: 4px;
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: 8px;
          color: #fca5a5;
          font-size: 12px;
        }
        .ict-signin {
          padding: 12px 14px;
          background: rgba(127,127,127,0.06);
          border-radius: 12px;
          color: var(--muted);
          font-size: 13px;
          text-align: center;
        }
        .ict-signin-link {
          color: var(--accent);
          font-weight: 700;
          text-decoration: none;
        }
        .ict-signin-link:hover { text-decoration: underline; }

        @media (max-width: 600px) {
          .ict-replies { margin-left: 16px; padding-left: 10px; }
          .ict-reply-row { margin-left: 16px; }
        }
      `}</style>
    </div>
  );
}

// Top-level only check used to hide the Reply button when this thread has
// another open reply box (prevents two open at once visually).
function isReplyOpenSomewhereElse(replyToId: string | null, ownId: string) {
  return replyToId !== null && replyToId !== ownId;
}

function ReplyButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      className="ci-reply"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      disabled={disabled}
      title={disabled ? 'Хариулахын тулд нэвтэрнэ үү' : undefined}
    >
      <span aria-hidden>💬</span> Reply
      <style>{`
        .ci-reply {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px;
          background: transparent; border: none;
          color: var(--muted);
          font-family: inherit; font-size: 12px; font-weight: 600;
          cursor: pointer; border-radius: 6px;
        }
        .ci-reply:hover:not(:disabled) {
          background: rgba(127,127,127,0.08); color: var(--text);
        }
        .ci-reply:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </button>
  );
}

interface CommentItemProps {
  postId: string;
  comment: Comment;
  isReply: boolean;
  myLiked: Set<string>;
  setMyLiked: React.Dispatch<React.SetStateAction<Set<string>>>;
  children?: React.ReactNode;
}

function CommentItem({
  postId, comment, isReply, myLiked, setMyLiked, children,
}: CommentItemProps) {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [optimisticCount, setOptimisticCount] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const date = comment.createdAt?.toDate ? comment.createdAt.toDate() : new Date();
  const role = comment.authorRole;
  const badge = role ? ROLE_BADGE[role] : null;
  const liked = myLiked.has(comment.id);
  const likeCount = optimisticCount ?? comment.likeCount ?? 0;
  const canManage = !!user && (user.uid === comment.authorId || user.role === 'admin');

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  async function onToggleLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      showToast({ msg: 'Like хийхийн тулд нэвтэрнэ үү', tone: 'info' });
      return;
    }
    // Optimistic count + local "myLiked" flip; transaction returns the
    // authoritative liking-or-unliking outcome and we reconcile.
    const prevLiked = liked;
    const optimisticDelta = prevLiked ? -1 : 1;
    setOptimisticCount(likeCount + optimisticDelta);
    setMyLiked((prev) => {
      const next = new Set(prev);
      if (prevLiked) next.delete(comment.id);
      else next.add(comment.id);
      return next;
    });
    try {
      const liking = await toggleCommentReaction(postId, comment.id, user.uid);
      // If the server outcome disagrees with our optimistic flip (e.g. the
      // user had already liked from a previous session), reconcile.
      setMyLiked((prev) => {
        const next = new Set(prev);
        if (liking) next.add(comment.id);
        else next.delete(comment.id);
        return next;
      });
    } catch (err) {
      console.error('[community] toggleCommentReaction', err);
      setOptimisticCount(null);
      setMyLiked((prev) => {
        const next = new Set(prev);
        if (prevLiked) next.add(comment.id);
        else next.delete(comment.id);
        return next;
      });
      showToast({ msg: 'Алдаа гарлаа', tone: 'error' });
    }
  }

  async function onDelete() {
    setMenuOpen(false);
    if (!confirm('Сэтгэгдлийг устгах уу?')) return;
    try {
      await deleteComment(postId, comment.id, !comment.parentCommentId);
    } catch (err) {
      console.error('[community] deleteComment', err);
      showToast({ msg: 'Устгахад алдаа гарлаа', tone: 'error' });
    }
  }

  return (
    <div className={`ci${isReply ? ' ci-reply' : ''}`}>
      <Avatar
        name={comment.authorName}
        photo={comment.authorPhoto}
        size={isReply ? 28 : 32}
      />
      <div className="ci-content">
        <div className="ci-header">
          <span className="ci-author">{comment.authorName}</span>
          {badge && (
            <span className="ci-role" style={{ color: badge.color, background: badge.bg }}>
              {badge.label}
            </span>
          )}
          <span className="ci-time" title={date.toLocaleString('mn-MN')}>
            {formatRelativeTime(date)}
          </span>
          {canManage && (
            <div className="ci-menu-wrap" ref={wrapRef}>
              <button
                type="button"
                className="ci-menu-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                aria-label="Илүү"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="ci-menu" role="menu">
                  <button
                    type="button"
                    className="ci-menu-item danger"
                    onClick={onDelete}
                    role="menuitem"
                  >
                    🗑️ Устгах
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="ci-body">{comment.body}</div>
        <div className="ci-actions">
          <button
            type="button"
            className={`ci-like${liked ? ' liked' : ''}`}
            onClick={onToggleLike}
            aria-label="Like"
            aria-pressed={liked}
          >
            <AppleEmoji emoji="❤️" size={12} />
            {likeCount > 0 && <span className="ci-like-count">{likeCount}</span>}
          </button>
          {children}
        </div>
      </div>

      <style>{`
        .ci {
          display: flex;
          gap: 10px;
        }
        .ci-content {
          flex: 1; min-width: 0;
        }
        .ci-header {
          display: flex; align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 2px;
          position: relative;
        }
        .ci-author {
          font-size: 13px; font-weight: 700; color: var(--text);
        }
        .ci-role {
          font-size: 0.58rem; font-weight: 800; letter-spacing: 0.05em;
          padding: 0.08rem 0.32rem;
          border-radius: 4px;
        }
        .ci-time {
          font-size: 12px; color: var(--muted); font-weight: 500;
        }
        .ci-body {
          font-size: 14px; line-height: 1.45;
          color: var(--text);
          white-space: pre-wrap; word-break: break-word;
        }
        .ci-actions {
          margin-top: 4px;
          display: flex; align-items: center; gap: 4px;
        }
        .ci-like {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px;
          background: transparent; border: none; border-radius: 6px;
          color: var(--muted);
          font-family: inherit; font-size: 12px; font-weight: 600;
          cursor: pointer;
          transition: background 0.12s, color 0.12s, transform 0.1s;
        }
        .ci-like:hover { background: rgba(127,127,127,0.08); color: var(--text); }
        .ci-like:active { transform: scale(0.92); }
        .ci-like.liked { color: var(--accent); }
        .ci-like-count { font-size: 12px; }
        .ci-menu-wrap {
          margin-left: auto;
          position: relative;
        }
        .ci-menu-btn {
          width: 24px; height: 24px;
          background: transparent; border: none; border-radius: 6px;
          color: var(--muted);
          font-size: 14px; line-height: 1; font-weight: 700;
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .ci-menu-btn:hover { background: rgba(127,127,127,0.1); color: var(--text); }
        .ci-menu {
          position: absolute; top: calc(100% + 4px); right: 0;
          min-width: 140px;
          background: var(--card);
          border: 1px solid rgba(127,127,127,0.2);
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25);
          padding: 4px;
          z-index: 10;
        }
        .ci-menu-item {
          display: flex; align-items: center; gap: 6px;
          width: 100%;
          padding: 6px 8px; border-radius: 6px;
          background: transparent; border: none;
          color: var(--text);
          font-family: inherit; font-size: 13px; font-weight: 600;
          text-align: left; cursor: pointer;
        }
        .ci-menu-item.danger { color: #f87171; }
        .ci-menu-item:hover { background: rgba(127,127,127,0.1); }
        .ci-menu-item.danger:hover { background: rgba(248,113,113,0.1); }
      `}</style>
    </div>
  );
}
