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
import { functionsOrigin } from './firebaseSettings.js';
import { afterServerConfirms, SERVER_CONFIRMATION, subscribeWithRetry } from './retrySubscription.js';

/** The closed list the rules read. One definition, mirrored server-side. */
export const SCHEDULE_VISIBILITIES = Object.freeze(['private', 'attendees_only', 'public']);

function readShare(snapshot) {
  if (!snapshot.exists()) return null;
  const data = snapshot.data() ?? {};
  const storedName = data.displayName;
  // The projection stores the owner's name. A blank value is not a name.
  const displayName =
    typeof storedName === 'string' && storedName.trim() ? storedName.trim() : null;
  return {
    scheduleVisibility:
      typeof data.scheduleVisibility === 'string' ? data.scheduleVisibility : 'private',
    sessionIds: Array.isArray(data.sessionIds) ? data.sessionIds : [],
    displayName,
  };
}

function subscribeShare(uid, onNext, onError, listen) {
  if (!uid) {
    onNext(null);
    return () => {};
  }
  return subscribeWithRetry(
    (onListenerError) =>
      listen(doc(db, `schedule_shares/${uid}`), (snapshot) => onNext(readShare(snapshot)), onListenerError),
    (error) => {
      console.warn('schedule share subscription failed; keeping last-known state.', error);
      onError?.(error);
    },
  );
}

/**
 * Subscribe to the caller's own projection. onNext(share|null) — null
 * where the owner has never saved or shared anything, which is the state
 * the panel opens on. The owner always reads its own projection, so a
 * cached copy is shown at once, offline included.
 *
 * @param {string} uid
 * @param {(share: { scheduleVisibility: string, sessionIds: string[], displayName: string | null } | null) => void} onNext
 * @param {(error: unknown) => void} [onError]
 */
export function subscribeOwnScheduleShare(uid, onNext, onError) {
  return subscribeShare(uid, onNext, onError, (ref, next, fail) => onSnapshot(ref, next, fail));
}

/**
 * Any viewer the projection permits reads it the same way its owner does
 * (issue #173). The rules decide what this listener actually receives; a
 * refusal arrives at onError and the page answers it as privacy. A share
 * cached for an earlier account in this tab waits for the server, which
 * applies the directory grant (issue 1004).
 */
export function subscribeScheduleShare(uid, onNext, onError) {
  return subscribeShare(uid, onNext, onError, (ref, next, fail) =>
    onSnapshot(ref, SERVER_CONFIRMATION, afterServerConfirms(next), fail),
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
          : 'The schedule visibility could not be saved. Try again.',
    });
  }
  return payload;
}
