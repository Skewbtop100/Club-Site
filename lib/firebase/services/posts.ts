import { db } from '@/lib/firebase';
import {
  collection, doc, addDoc, deleteDoc, getDocs, getDoc,
  onSnapshot, query, orderBy, serverTimestamp, Timestamp,
  where, limit as fbLimit, increment, runTransaction,
} from 'firebase/firestore';

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
}

export interface CreateCommentInput {
  postId: string;
  body: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  authorRole?: 'member' | 'athlete' | 'admin';
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
  const { postId, ...commentData } = input;
  // Use a transaction so commentCount on the post stays accurate.
  const result = await runTransaction(db, async (tx) => {
    const postRef = postDoc(postId);
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists()) throw new Error('Post not found');
    const newCommentRef = doc(commentsCol(postId));
    tx.set(newCommentRef, {
      ...commentData,
      createdAt: serverTimestamp(),
    });
    tx.update(postRef, { commentCount: increment(1) });
    return newCommentRef.id;
  });
  return result;
}

export async function deletePost(postId: string): Promise<void> {
  await deleteDoc(postDoc(postId));
}
