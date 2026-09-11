'use client';

// ── Calling a route AS the signed-in athlete ────────────────────────────
// The client half of athlete-auth.ts. Attaches a Firebase ID token as
// `Authorization: Bearer <jwt>` — a header, not a query parameter, because
// query strings end up in server logs, proxy logs and browser history.
//
// WHY A MODULE AND NOT A HOOK: useOnlineAuth() deliberately exposes a
// plain object (uid, displayName, photoURL, email, isAnonymous), not the
// Firebase User, so getIdToken() is not reachable through it. Adding a
// getToken() to the context was the alternative; this is a module because
// every caller needs the token inside an async callback or effect that
// already closed over its own state — a hook value would be a second,
// staler source of truth for "who is signed in" than
// onlineCompAuth.currentUser, which the SDK keeps current. It is also
// usable from code that is not a component.
//
// It must be `onlineCompAuth` — the SECOND named Firebase app,
// 'online-competition'. lib/firebase.ts's default app is the club site's
// session; a token from it would carry a club member's identity, and this
// feature deliberately keeps the two apart (see the long note in
// lib/online-competition/firebase.ts).

import { onlineCompAuth } from './firebase';

/** No usable session on this device: signed out, or an anonymous session,
 *  which the routes refuse for the same reason the solve page treats it as
 *  signed-out. */
export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'NotSignedInError';
  }
}

/** fetch(), with the athlete's ID token attached.
 *
 *  `forceRefresh` re-mints the token rather than using the cached one. The
 *  SDK refreshes on its own about five minutes before expiry, so this is
 *  for the case that survives that: a token the SERVER rejected — a device
 *  clock far enough out that the client believes a stale token is still
 *  good, or a refresh that failed while offline. Callers use it for their
 *  ONE retry after a 401; retrying with the same rejected token would just
 *  fail again. */
export async function authedFetch(url: string, options: { forceRefresh?: boolean } = {}): Promise<Response> {
  const user = onlineCompAuth.currentUser;
  if (!user || user.isAnonymous) throw new NotSignedInError();
  const token = await user.getIdToken(options.forceRefresh ?? false);
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

/** authedFetch with the standard retry: one repeat with a freshly minted
 *  token if the first attempt came back 401.
 *
 *  A 401 is not always the athlete's fault — a token can expire during a
 *  long run, and a device whose clock is behind will keep serving one the
 *  server has already rejected. Both are fixed by asking for a new token,
 *  which is cheap, so it happens before anyone is told anything. */
export async function authedFetchWithRetry(url: string): Promise<Response> {
  const first = await authedFetch(url);
  if (first.status !== 401) return first;
  return authedFetch(url, { forceRefresh: true });
}
