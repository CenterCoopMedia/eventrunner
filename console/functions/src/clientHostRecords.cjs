'use strict';

const HOSTS = 'console_client_hosts';
const MOUNTS = 'console_event_mounts';

const clientHostRef = (db, host) => db.collection(HOSTS).doc(host);
const eventMountRef = (db, appId) => db.collection(MOUNTS).doc(appId);

function hostingOrigin(site) {
  if (typeof site !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(site)) {
    throw new Error('the event has no valid recorded Hosting site');
  }
  return `https://${site}.web.app`;
}

/** Cancel this application's enrollment in the application-close transaction. */
async function removeEventMount(tx, db, appId) {
  const ref = eventMountRef(db, appId);
  const route = (await tx.get(ref)).data();
  if (route?.state === 'enrolled') tx.update(ref, { state: 'removed' });
}

/** Keep the path reservation when its application and consent are purged. */
async function purgeEventMount(tx, db, appId) {
  const ref = eventMountRef(db, appId);
  const route = (await tx.get(ref)).data();
  if (!route) return;
  const { host, mount, publicBase, projectId, hostingOrigin: origin } = route;
  tx.set(ref, { host, mount, publicBase, projectId, hostingOrigin: origin, appId, state: 'removed' });
}

module.exports = { MOUNTS, clientHostRef, eventMountRef, hostingOrigin, purgeEventMount, removeEventMount };
