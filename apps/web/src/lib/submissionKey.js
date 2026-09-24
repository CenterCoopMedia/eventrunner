// The idempotency key a change request form sends (issue #188). It becomes
// the stored request's document id (functions/src/admin/changeRequests.cjs),
// so a retry after a dropped answer finds the stored request rather than
// storing it twice.
//
// A key is bound to the text first sent under it. A retry of the same text
// resends the key; changed text takes a new key, because the server answers
// changed text under a used key with 409 rather than a false "sent".

/** A key in the server's shape: 8-128 characters of [A-Za-z0-9_-]. */
export function newSubmissionKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/**
 * One form session's key.
 *
 * @returns {{ keyFor: (payload: object) => string, reset: () => void }}
 *   `keyFor` answers the key to send with this payload; `reset` starts a
 *   new request after a success.
 */
export function createSubmissionKey() {
  let key = newSubmissionKey();
  let sentAs = null;
  return {
    keyFor(payload) {
      const text = JSON.stringify(payload);
      if (sentAs !== null && sentAs !== text) key = newSubmissionKey();
      sentAs = text;
      return key;
    },
    reset() {
      key = newSubmissionKey();
      sentAs = null;
    },
  };
}
