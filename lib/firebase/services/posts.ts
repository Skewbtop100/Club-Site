import { db } from '@/lib/firebase';
import {
  collection, doc, addDoc, deleteDoc, getDocs, getDoc,
  onSnapshot, query, orderBy, serverTimestamp, Timestamp,
  where, limit as fbLimit,
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
