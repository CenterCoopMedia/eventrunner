// Browser-owned session ids. Each deployed event has its own Firebase project.
export const DEVICE_BOOKMARK_KEY = `eventrunner:device-bookmarks:${import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo'}:${import.meta.env.BASE_URL}`;

let snapshot;
const listeners = new Set();
const validId = (id) => typeof id === 'string' && id.length > 0 && !id.includes('/');

function readIds(storage) {
  const raw = storage.getItem(DEVICE_BOOKMARK_KEY);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = []; }
  return Array.isArray(parsed) ? [...new Set(parsed.filter(validId))] : [];
}

function read() {
  try {
    const storage = globalThis.localStorage;
    const ids = readIds(storage);
    // A readable store may still refuse writes (quota or browser policy).
    storage.setItem(DEVICE_BOOKMARK_KEY, JSON.stringify(ids));
    return { available: true, ids, merging: snapshot?.merging ?? [] };
  } catch {
    return { available: false, ids: [], merging: snapshot?.merging ?? [] };
  }
}

function publish(next) {
  if (snapshot && snapshot.available === next.available
    && snapshot.ids.length === next.ids.length && snapshot.ids.every((id, index) => id === next.ids[index])
    && snapshot.merging.length === next.merging.length && snapshot.merging.every((id, index) => id === next.merging[index])) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getDeviceBookmarks() {
  snapshot ??= read();
  return snapshot;
}

function onStorage(event) {
  if (event.key === DEVICE_BOOKMARK_KEY || event.key === null) publish(read());
}

export function subscribeDeviceBookmarks(listener) {
  if (listeners.size === 0) {
    globalThis.addEventListener?.('storage', onStorage);
    // Changes may have arrived while the public view was unmounted.
    publish(read());
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) globalThis.removeEventListener?.('storage', onStorage);
  };
}

function change(update) {
  try {
    const storage = globalThis.localStorage;
    const ids = update(readIds(storage));
    storage.setItem(DEVICE_BOOKMARK_KEY, JSON.stringify(ids));
    publish({ available: true, ids, merging: getDeviceBookmarks().merging });
    return true;
  } catch {
    publish({ available: false, ids: [], merging: getDeviceBookmarks().merging });
    return false;
  }
}

export function setDeviceBookmarked(id, bookmarked) {
  if (!validId(id)) return false;
  return change((ids) => bookmarked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id));
}

export function removeDeviceBookmarks(ids) {
  const removed = new Set(ids);
  return change((current) => current.filter((id) => !removed.has(id)));
}

// Keep an in-flight import and a row's remove action from racing in this tab.
export function setDeviceMergePending(ids) {
  publish({ ...getDeviceBookmarks(), merging: ids });
}
