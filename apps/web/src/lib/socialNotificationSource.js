// Private reply notifications for the signed-in root-post owner (issues
// #543 and #207). Reads stay inside users/{uid}/notifications, where the
// Firestore rules require that same uid, a current attendee grant and both
// feed flags. Only server-confirmed snapshots leave this module.
import {
  collection,
  documentId,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { resolveFunctionsOrigin } from './errorReporting.js';
import { subscribeWithRetry } from './retrySubscription.js';

const PAGE_SIZE = 20;

function isPostId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && !value.includes('/') && value !== '.' && value !== '..';
}

/** A renderable server notification, or null for a malformed row. */
function toNotification(entry) {
  const data = entry.data();
  if (!data || data.kind !== 'post_reply' || !isPostId(data.rootPostId)
      || !isPostId(data.replyPostId) || data.replyPostId !== entry.id) return null;
  return {
    id: entry.id,
    rootPostId: data.rootPostId,
    replyId: data.replyPostId,
    createdAt: data.createdAt ?? null,
    readAt: data.readAt ?? null,
  };
}

function notificationsQuery(uid, cursor = null) {
  return query(
    collection(db, 'users', uid, 'notifications'),
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(PAGE_SIZE),
  );
}

function notificationPage(snapshot) {
  return {
    items: snapshot.docs.map(toNotification).filter(Boolean),
    // Keep the raw last row as the cursor. Dropping a malformed row from
    // the UI must not cause the next page to read it again.
    cursor: snapshot.docs.at(-1) ?? null,
    hasMore: snapshot.docs.length === PAGE_SIZE,
  };
}

/** Load one older page from the server, never from the local Firestore cache. */
export async function loadSocialNotificationPage({ uid, cursor = null }) {
  const snapshot = await getDocsFromServer(notificationsQuery(uid, cursor));
  return notificationPage(snapshot);
}

/**
 * Watch the newest page. Cache snapshots are ignored so another account's
 * old local data cannot appear during an account switch.
 */
export function watchSocialNotifications({ uid, onData, onError }) {
  const target = notificationsQuery(uid);
  return subscribeWithRetry(
    (onListenerError) => onSnapshot(
      target,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.metadata?.fromCache !== false) return;
        onData(notificationPage(snapshot));
      },
      onListenerError,
    ),
    (error) => {
      console.warn('Social notification subscription failed; retrying.', error);
      onError?.(error);
    },
  );
}

class SocialNotificationRequestError extends Error {
  constructor({ code, status, message }) {
    super(message);
    this.name = 'SocialNotificationRequestError';
    this.code = code;
    this.status = status;
  }
}

function requestError(code, status, message) {
  return new SocialNotificationRequestError({ code, status, message });
}

/** Mark one owned notification read through the server's idempotent action. */
export async function markSocialNotificationRead({
  user,
  notificationId,
  env = import.meta.env,
  fetchImpl,
}) {
  if (!user || typeof user.getIdToken !== 'function') {
    throw requestError('unauthorized', 401, 'Sign in to read a notification.');
  }
  let token;
  try {
    token = await user.getIdToken();
  } catch {
    throw requestError('unauthenticated', 401, 'Your session has expired. Sign in again.');
  }
  const send = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const origin = resolveFunctionsOrigin(env);
  if (!send || !origin) {
    throw requestError('network', 0, 'Notifications are not available right now. Try again later.');
  }
  let response;
  try {
    response = await send(`${origin}/markSocialNotificationRead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ notificationId, action: 'read' }),
    });
  } catch {
    throw requestError('network', 0, 'We could not reach the server. Check your connection and try again.');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw requestError(
      typeof error.code === 'string' ? error.code : 'unknown',
      response.status,
      typeof error.message === 'string' ? error.message : 'The notification could not be marked read. Try again.',
    );
  }
  if (payload?.notificationId !== notificationId || typeof payload.readAt !== 'string'
      || !Number.isFinite(Date.parse(payload.readAt))) {
    throw requestError('invalid-response', response.status, 'The server returned an invalid notification result.');
  }
  return { notificationId, readAt: new Date(payload.readAt).toISOString() };
}
