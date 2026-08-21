// Session materials: the client's two seams to the backend (issue #23,
// spec §4.4). `session_materials_public` is anonymously readable, so
// discovery (the pill's count, the detail page's list of approved
// materials) subscribes straight to Firestore — same "server writes,
// client reads the public projection" split bookmarksSource.js and
// contentSource.js use. Resolving an actual material's URL is NOT a direct
// read (the canonical `session_materials` doc is fully server-only): it
// goes through the `getSessionMaterialUrl` Cloud Function, which applies
// the embargo gate server-side and is safe to call anonymously — a
// post-embargo approved material is a discovery grant for anyone, not
// only signed-in attendees (functions/src/materials/access.cjs).
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { subscribeWithRetry } from './retrySubscription.js';

/**
 * Subscribe to a session's approved materials (the `session_materials_public`
 * projection — spec §4.4: `{sessionId, type, filename, reviewStatus}`,
 * reviewStatus always `'approved'` by construction since the projection
 * trigger never writes a non-approved row). Calls onNext(materials[]) on
 * every snapshot, each material shaped `{ id, sessionId, type, filename,
 * reviewStatus }`.
 *
 * A listener error never touches `onNext` (fail-soft, matching
 * bookmarksSource.js) — the caller keeps whatever it last rendered rather
 * than flashing empty.
 *
 * @param {string} sessionId
 * @param {(materials: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onError]
 */
export function subscribeSessionMaterials(sessionId, onNext, onError) {
  if (!sessionId) {
    onNext([]);
    return () => {};
  }
  return subscribeWithRetry(
    (onListenerError) =>
      onSnapshot(
        query(collection(db, 'session_materials_public'), where('sessionId', '==', sessionId)),
        (snapshot) => onNext(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
        onListenerError,
      ),
    (error) => {
      console.warn('session_materials_public subscription failed; keeping last-known list.', error);
      onError?.(error);
    },
  );
}

/** Thrown by {@link fetchSessionMaterialUrl} on any non-2xx response. */
export class MaterialRequestError extends Error {
  constructor({ code, message, status }) {
    super(message);
    this.name = 'MaterialRequestError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Resolve one material's real URL via `getSessionMaterialUrl`. Callable
 * signed-out (`user` may be null/undefined) — the server applies the
 * embargo gate either way, so a pre-embargo call from a signed-out visitor
 * fails with a 403 the caller should present as "not available yet", not a
 * sign-in prompt.
 *
 * @param {{ user?: import('firebase/auth').User|null, materialId: string }} args
 * @returns {Promise<{ url: string, type: string, filename: string }>}
 */
export async function fetchSessionMaterialUrl({ user, materialId }) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) {
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }
  let response;
  try {
    response = await fetch(`${functionsOrigin()}/getSessionMaterialUrl`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ materialId }),
    });
  } catch {
    throw new MaterialRequestError({
      code: 'network',
      status: 0,
      message: 'We could not reach the server. Check your connection and try again.',
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
    throw new MaterialRequestError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      message:
        typeof error.message === 'string' ? error.message : 'This material is not available.',
    });
  }
  return payload;
}
