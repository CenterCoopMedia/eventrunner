'use strict';

/**
 * The coming-soon state of a new site (config/launch).
 *
 * init-event writes `{ comingSoon: true }` on a project's first run, and the
 * public site shows a coming-soon page while it holds (apps/web/src/
 * components/ComingSoon.jsx). The team's first publish from the admin opens
 * the site: this clears the flag. A site with no config/launch document is
 * an older site that was never closed, and stays open.
 *
 * Fail-soft: the publish it follows is already committed, so a failed write
 * here is logged and the next publish tries again.
 *
 * config/* is publicly readable, so this records when the site opened and
 * not who opened it; the publish's own admin log names the admin.
 *
 * @param {{ db: object, now?: () => number, log?: Console }} deps
 * @returns {Promise<boolean>} whether this call opened the site
 */
async function openSiteOnFirstPublish({ db, now = Date.now, log = console }) {
  try {
    const ref = db.collection('config').doc('launch');
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.comingSoon !== true) return false;
    await ref.set(
      {
        comingSoon: false,
        openedAt: new Date(now()),
        updatedAt: new Date(now()),
      },
      { merge: true },
    );
    return true;
  } catch (err) {
    log.error('could not open the site after its first publish', err);
    return false;
  }
}

/**
 * Whether the site is still on its coming-soon page. A failed read answers
 * false, the open-site answer, so a publish never fails on it.
 *
 * @param {{ db: object, log?: Console }} deps
 * @returns {Promise<boolean>}
 */
async function isComingSoon({ db, log = console }) {
  try {
    const snap = await db.collection('config').doc('launch').get();
    return snap.exists && snap.data()?.comingSoon === true;
  } catch (err) {
    log.error('could not read the coming-soon state', err);
    return false;
  }
}

module.exports = { isComingSoon, openSiteOnFirstPublish };
