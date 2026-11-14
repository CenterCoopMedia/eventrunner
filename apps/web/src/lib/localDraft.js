// Browser-only recovery copies. The server draft remains the saved record.
const PREFIX = 'eventrunner:admin-draft:';
const SIGN_OUT_PREFIX = 'eventrunner:admin-draft-signout:';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const generations = new Map();

function accountPrefix(accountId) {
  return `${PREFIX}${encodeURIComponent(accountId)}:`;
}

function signOutKey(accountId) {
  return `${SIGN_OUT_PREFIX}${encodeURIComponent(accountId)}`;
}

function marker(accountId) {
  try { return localStorage.getItem(signOutKey(accountId)); } catch { return null; }
}

export function clearLocalDrafts(accountId) {
  if (!accountId) return;
  generations.set(accountId, (generations.get(accountId) ?? 0) + 1);
  const value = `${Date.now()}:${Math.random()}`;
  let marked = false;
  function mark() {
    try { localStorage.setItem(signOutKey(accountId), value); marked = true; } catch { /* Still clear copies. */ }
  }
  function removeCopies() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(accountPrefix(accountId))) localStorage.removeItem(key);
      }
    } catch { /* Storage being unavailable must not prevent sign-out. */ }
  }
  // Revoke first, including tabs with no copy yet. If quota blocked the small
  // marker, deleting copies frees space; revoke and clear any intervening write.
  mark();
  removeCopies();
  if (!marked) { mark(); removeCopies(); }
  window.dispatchEvent(new Event('admin-drafts-cleared'));
}

export function openLocalDraft(accountId, docPath, version) {
  const prefix = `${accountPrefix(accountId)}${encodeURIComponent(docPath)}:`;
  const initialMarker = marker(accountId);
  const generation = generations.get(accountId) ?? 0;
  const observed = new Map();
  let writeVersion = version;
  const revoked = () => generation !== (generations.get(accountId) ?? 0)
    || initialMarker !== marker(accountId);

  function read() {
    let newest = null;
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(prefix)) continue;
        const raw = localStorage.getItem(key);
        let copy;
        try { copy = JSON.parse(raw); } catch { /* Discard a broken copy below. */ }
        if (!copy || typeof copy.value !== 'string' || typeof copy.baseline !== 'string' || typeof copy.version !== 'string'
          || !Number.isFinite(copy.savedAt) || Date.now() - copy.savedAt >= WEEK) {
          localStorage.removeItem(key);
          continue;
        }
        observed.set(key, raw);
        if (!newest || copy.savedAt > newest.savedAt) newest = { ...copy, key, raw };
      }
    } catch { return null; }
    return newest;
  }

  function write(value, baseline) {
    if (revoked()) return false;
    try {
      const key = `${prefix}${encodeURIComponent(writeVersion)}`;
      const raw = JSON.stringify({ value, baseline, version: writeVersion, savedAt: Date.now() });
      localStorage.setItem(key, raw);
      observed.set(key, raw);
      return true;
    } catch { return false; }
  }

  function clear() {
    try {
      // A save/discard in this tab must not delete newer text from another tab.
      for (const [key, raw] of observed) {
        if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
      }
    } catch { /* The form still works without storage. */ }
    observed.clear();
  }

  return {
    read, write, clear, revoked,
    restore: (copy) => { writeVersion = copy.version; },
    isSignOutEvent: (event) => event.type === 'admin-drafts-cleared'
      || event.key === signOutKey(accountId),
  };
}
