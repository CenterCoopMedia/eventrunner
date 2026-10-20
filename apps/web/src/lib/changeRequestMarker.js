// Whether this browser sent a change request for an account (issue #330,
// review finding 1 on #539). The footer keeps its link to the reader's own
// requests after an operator turns change requests off, but only for a
// reader who used them: a site that never turned the feature on shows no
// link. The mark is per account and per browser, holds no request data, and
// is a convenience only. A reader on another device still reaches the page
// through the link in every change request email.
const PREFIX = 'changeRequests.sent.';

/** @param {string|null|undefined} uid */
export function hasSentChangeRequest(uid) {
  if (!uid) return false;
  try {
    return window.localStorage.getItem(`${PREFIX}${uid}`) === '1';
  } catch {
    return false;
  }
}

/** @param {string|null|undefined} uid */
export function markChangeRequestSent(uid) {
  if (!uid) return;
  try {
    window.localStorage.setItem(`${PREFIX}${uid}`, '1');
  } catch {
    // Private windows and blocked storage: the link then follows the flag only.
  }
}
