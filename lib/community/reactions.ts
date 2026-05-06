// Shared reaction taxonomy used by both the posts service (Comment +
// reactionCounts type) and the UI (PostCard reaction pills, comment
// likes). Keeping it here breaks the would-be cycle between
// lib/firebase/services/posts.ts and the React components.

export const REACTION_TYPES = ['❤️', '🔥', '👏', '😂', '😮'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const DEFAULT_REACTION: ReactionType = '❤️';
