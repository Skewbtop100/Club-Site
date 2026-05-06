import { db } from '@/lib/firebase';
import {
  collection, doc, addDoc, deleteDoc, getDocs, getDoc,
  onSnapshot, query, orderBy, serverTimestamp, Timestamp,
  where, limit as fbLimit, increment, runTransaction,
} from 'firebase/firestore';
import type { ReactionType } from '@/lib/community/reactions';

export type PostCategory = 'announcement' | 'question' | 'achievement' | 'general' | 'video';

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  authorRole?: 'member' | 'athlete' | 'admin';
  title: string;
  body: string;
  category: PostCategory;
  imageUrls?: string[];
  videoUrl?: string;
  videoType?: 'cloudinary' | 'youtube' | 'vimeo';
  videoThumbnail?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  likeCount: number;
  commentCount: number;
  pinned?: boolean;
}

const postsCol = () => collection(db, 'posts');
const postDoc = (id: string) => doc(db, 'posts', id);

export function subscribePosts(
  onChange: (posts: Post[]) => void,
  opts?: { category?: PostCategory; limit?: number },
) {
  const constraints = [];
  if (opts?.category) constraints.push(where('category', '==', opts.category));
  constraints.push(orderBy('pinned', 'desc'));
  constraints.push(orderBy('createdAt', 'desc'));
  if (opts?.limit) constraints.push(fbLimit(opts.limit));
  const q = query(postsCol(), ...constraints);
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Post);
    onChange(items);
  });
}

export async function getPost(id: string): Promise<Post | null> {
  const snap = await getDoc(postDoc(id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Post;
}

export interface CreatePostInput {
  title: string;
  body: string;
  category: PostCategory;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  authorRole?: 'member' | 'athlete' | 'admin';
  imageUrls?: string[];
  videoUrl?: string;
  videoType?: 'cloudinary' | 'youtube' | 'vimeo';
  videoThumbnail?: string;
}

export async function createPost(input: CreatePostInput): Promise<string> {
  const ref = await addDoc(postsCol(), {
    ...input,
    likeCount: 0,
    commentCount: 0,
    pinned: false,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  authorRole?: 'member' | 'athlete' | 'admin';
  body: string;
  createdAt: Timestamp;
  parentCommentId?: string;
  reactionCounts?: Partial<Record<ReactionType, number>>;
  likeCount?: number;
}

export interface CreateCommentInput {
  postId: string;
  body: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  authorRole?: 'member' | 'athlete' | 'admin';
  parentCommentId?: string;
}

const commentsCol = (postId: string) =>
  collection(db, 'posts', postId, 'comments');

export function subscribeComments(
  postId: string,
  onChange: (comments: Comment[]) => void,
) {
  const q = query(commentsCol(postId), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Comment);
    onChange(items);
  });
}

export async function createComment(input: CreateCommentInput): Promise<string> {
  const { postId, parentCommentId, ...commentData } = input;
  const isTopLevel = !parentCommentId;
  // Use a transaction so commentCount on the post stays accurate.
  // Only top-level comments increment the post's commentCount; replies
  // are tracked under their parent and deliberately don't bump the
  // headline number.
  const result = await runTransaction(db, async (tx) => {
    const postRef = postDoc(postId);
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists()) throw new Error('Post not found');
    const newCommentRef = doc(commentsCol(postId));
    tx.set(newCommentRef, {
      ...commentData,
      ...(parentCommentId ? { parentCommentId } : {}),
      createdAt: serverTimestamp(),
    });
    if (isTopLevel) {
      tx.update(postRef, { commentCount: increment(1) });
    }
    return newCommentRef.id;
  });
  return result;
}

export async function deleteComment(
  postId: string,
  commentId: string,
  isTopLevel: boolean,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    tx.delete(doc(commentsCol(postId), commentId));
    if (isTopLevel) {
      tx.update(postDoc(postId), { commentCount: increment(-1) });
    }
    // Note: doesn't delete child replies — they become orphaned but the
    // UI groups by parent and filters them out. TODO: cascade later (or
    // accept the slow leak; user-deleted comments are rare).
  });
}

/** Toggle a per-uid reaction doc on a comment and bump the comment's
 * likeCount in the same transaction. Returns true if the reaction was
 * created (liked), false if it was removed (unliked). */
export async function toggleCommentReaction(
  postId: string,
  commentId: string,
  uid: string,
  type: ReactionType = '❤️',
): Promise<boolean> {
  const reactionRef = doc(db, 'posts', postId, 'comments', commentId, 'reactions', uid);
  const commentRef = doc(commentsCol(postId), commentId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(reactionRef);
    const liking = !snap.exists();
    if (liking) {
      tx.set(reactionRef, { type, createdAt: serverTimestamp() });
    } else {
      tx.delete(reactionRef);
    }
    tx.update(commentRef, { likeCount: increment(liking ? 1 : -1) });
    return liking;
  });
}

export async function deletePost(postId: string): Promise<void> {
  await deleteDoc(postDoc(postId));
}
