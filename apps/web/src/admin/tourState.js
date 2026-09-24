// The editor tour's one stored fact (issue #198): whether this account has
// ended the tour in this browser. One key per account, so a second admin on
// a shared machine still meets the tour once. The key carries a version, so
// a rewritten tour can be offered again under a new one.
//
// Browser storage can be missing or refuse a read or a write (a private
// window, blocked site data). Every call is wrapped: a read that throws means
// "not done", and an end that cannot be written is held in memory for the
// life of the tab, so the tour still closes and stays closed until a reload.
// Nothing here reaches Firestore. The admin shell reads it on every admin
// load, so it stays this small.

/** Accounts that ended the tour in this tab while the store refused the write. */
const endedInThisTab = new Set();

/** @param {string} uid */
export const tourStorageKey = (uid) => `eventrunner.adminTour.v1:${uid}`;

/**
 * @param {string} uid
 * @returns {boolean} true once this account has ended the tour here
 */
export function readTourDone(uid) {
  try {
    return endedInThisTab.has(uid) || localStorage.getItem(tourStorageKey(uid)) === 'done';
  } catch {
    return false;
  }
}

/** @param {string} uid */
export function markTourDone(uid) {
  try {
    localStorage.setItem(tourStorageKey(uid), 'done');
  } catch {
    endedInThisTab.add(uid);
  }
}
