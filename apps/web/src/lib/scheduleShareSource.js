// The schedule share's client seam (issue #172).
//
// The projection document is readable by its owner, so the share panel
// subscribes to it directly. Changing the visibility is a server call —
// the rules deny every client write to schedule_shares — through the same
// authenticated-POST shape the other owner-owned acts use.
//
// Tests mock this module rather than the SDK (lib/contentSource.js rule).
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { subscribeWithRetry } from './retrySubscription.js';

/** The closed list the rules read. One definition, mirrored server-side. */
export const SCHEDULE_VISIBILITIES = Object.freeze(['private', 'attendees_only', 'public']);

/**
 * Subscribe to the caller's own projection. onNext(share|null) — null
 * where the owner has never saved or shared anything, which is the state
 * the panel opens on.
 *
 * @param {string} uid
 * @param {(share: { scheduleVisibility: string, sessionIds: string[] } | null) => void} onNext
 * @param {(error: unknown) => void} [onError]
 */
export function subscribeOwnScheduleShare(uid, onNext, onError) {
  if (!uid) {
    onNext(null);
    return () => {};
  }
  return subscribeWithRetry(
    (onListenerError) =>
      onSnapshot(
        doc(db, `schedule_shares/${uid}`),
        (snapshot) => {
          if (!snapshot.exists()) {
            onNext(null);
            return;
          }
          const data = snapshot.data() ?? {};
          onNext({
            scheduleVisibility:
              typeof data.scheduleVisibility === 'string' ? data.scheduleVisibility : 'private',
            sessionIds: Array.isArray(data.sessionIds) ? data.sessionIds : [],
          });
        },
        onListenerError,
      ),
    (error) => {
      console.warn('schedule share subscription failed; keeping last-known state.', error);
      onError?.(error);
    },
  );
}

/** Thrown by {@link setScheduleVisibility} on any non-2xx response. */
export class ScheduleShareError extends Error {
  constructor({ message, status }) {
    super(message);
    this.name = 'ScheduleShareError';
    this.status = status;
  }
}

/**
 * Record the owner's visibility choice. The server validates the value
 * against the same closed list; a refusal here is the server's answer,
 * stated verbatim.
 *
 * @param {{ user: import('firebase/auth').User, visibility: string }} args
 * @returns {Promise<{ scheduleVisibility: string, sessionIds: string[] }>}
 */
export async function setScheduleVisibility({ user, visibility }) {
  if (!user) {
    throw new ScheduleShareError({ message: 'Sign in first.', status: 401 });
  }
  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${functionsOrigin()}/setScheduleVisibility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ visibility }),
    });
  } catch {
    throw new ScheduleShareError({
      message: 'We could not reach the server. Check your connection and try again.',
      status: 0,
    });
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ScheduleShareError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      message:
        typeof error.message === 'string'
          ? error.message
          : 'The schedule visibility could not be saved.',
    });
  }
  return payload;
}
