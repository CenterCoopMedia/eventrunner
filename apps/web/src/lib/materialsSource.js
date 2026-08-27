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
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { subscribeWithRetry } from './retrySubscription.js';

// --- shared collection-wide subscription (issue #23 follow-up) -------------
//
// A naive per-session `where('sessionId', '==', id)` listener, one per
// caller, costs one Firestore listener PER RENDERED CARD: a schedule page
// listing N sessions opens N listeners for their MaterialsLinks, and
// SessionDetail opens a second one of its own (the pill's count AND the
// full list both call this). None of that scales with the page — session_
// materials_public is small enough per event that one WHOLE-COLLECTION
// listener, grouped by sessionId in memory and fanned out to every
// subscriber, costs exactly one regardless of how many sessions or how
// many components are asking. Ref-counted: the underlying onSnapshot
// attaches on the first subscriber and detaches once the last one leaves.
let sharedDetach = null;
let sharedReady = false;
let bySessionId = new Map();
/** @type {Set<{ sessionId: string, onNext: (rows: Array<object>) => void, onError?: (error: unknown) => void }>} */
const subscribers = new Set();

function regroupSnapshot(snapshot) {
  const next = new Map();
  for (const doc of snapshot.docs) {
    const data = { id: doc.id, ...doc.data() };
    const list = next.get(data.sessionId);
    if (list) list.push(data);
    else next.set(data.sessionId, [data]);
  }
  bySessionId = next;
  sharedReady = true;
  for (const sub of subscribers) sub.onNext(bySessionId.get(sub.sessionId) ?? []);
}

function attachSharedListener() {
  return subscribeWithRetry(
    (onListenerError) => onSnapshot(collection(db, 'session_materials_public'), regroupSnapshot, onListenerError),
    (error) => {
      // Fail-soft (matching bookmarksSource.js): keep whatever each
      // subscriber last rendered rather than flashing empty.
      console.warn('session_materials_public subscription failed; keeping last-known lists.', error);
      for (const sub of subscribers) sub.onError?.(error);
    },
  );
}

/**
 * Subscribe to a session's approved materials (the `session_materials_public`
 * projection — spec §4.4: `{sessionId, type, filename, reviewStatus}`,
 * reviewStatus always `'approved'` by construction since the projection
 * trigger never writes a non-approved row). Calls onNext(materials[])
 * immediately with the current (possibly stale-until-ready) grouping, then
 * again on every collection snapshot, each material shaped `{ id,
 * sessionId, type, filename, reviewStatus }`.
 *
 * Backed by the single shared listener above — this function's own job is
 * just registering/deregistering this call's `{sessionId, onNext, onError}`
 * entry and ref-counting the shared attach/detach.
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

  const entry = { sessionId, onNext, onError };
  if (subscribers.size === 0) {
    sharedDetach = attachSharedListener();
  }
  subscribers.add(entry);
  if (sharedReady) onNext(bySessionId.get(sessionId) ?? []);

  return () => {
    subscribers.delete(entry);
    if (subscribers.size === 0) {
      sharedDetach?.();
      sharedDetach = null;
      sharedReady = false;
      bySessionId = new Map();
    }
  };
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

/**
 * Fetch a **file**-type material's bytes and hand them to the browser's
 * save/open behavior locally (issue #23 follow-up). `getSessionMaterialUrl`
 * never returns a `url` for a file material — there is no signed Storage
 * URL to open (see functions/src/materials/download.cjs's module doc for
 * why) — so a file material can't be `window.open()`ed the way a link
 * material is. A plain top-level GET navigation also can't carry the
 * Authorization header a pre-embargo speaker/admin download needs, which is
 * why this is a `fetch` (same authenticated-POST shape as
 * fetchSessionMaterialUrl) rather than a navigation: the bytes come back as
 * a Blob, and a throwaway `<a download>` element triggers the save/open
 * exactly the way a real download link would.
 *
 * @param {{ user?: import('firebase/auth').User|null, materialId: string, filename: string }} args
 * @returns {Promise<void>}
 */
export async function downloadSessionMaterialFile({ user, materialId, filename }) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) {
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }
  let response;
  try {
    response = await fetch(`${functionsOrigin()}/downloadSessionMaterial`, {
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
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const error = payload?.error ?? {};
    throw new MaterialRequestError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      message:
        typeof error.message === 'string' ? error.message : 'This material is not available.',
    });
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename || 'download';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred: revoking immediately can race the browser's own read of the
  // blob URL in some engines.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}
