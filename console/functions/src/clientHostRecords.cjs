'use strict';

const { parseEventPublicBase } = require('shared/config/publicBase');

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

/** Resolve the address that provisioning, ordinary deploy and CMS publication use. */
function resolveEventPublicBase(route, { appId, projectId, site, domain, existingPublicUrl }) {
  const published = route?.state === 'published';
  const prior = route?.standalonePublicBase || (published && existingPublicUrl);
  const previous = prior ? parseEventPublicBase(prior) : null;
  if (previous?.mount) throw new Error('the prior standalone event address must be a root URL');
  const standalone = previous?.origin || `https://${domain}`;
  const sharedRollback = !published && route?.publishedAt && route.host === new URL(standalone).hostname;
  // A reservation has no effect on the deployed address until publication.
  if (!published && !sharedRollback) return { publicBase: standalone, origin: standalone, mount: '' };
  const base = parseEventPublicBase(route.publicBase);
  const origin = hostingOrigin(site);
  if (route.appId !== appId || route.projectId !== projectId || route.hostingOrigin !== origin
      || !base.mount || base.mount !== route.mount || new URL(base.origin).hostname !== route.host) {
    throw new Error('the event mount does not match its application, project and Hosting site');
  }
  return published ? { ...base, standalonePublicBase: standalone } : { publicBase: origin, origin, mount: '' };
}

async function recordStandalonePublicBase(db, appId, base) {
  if (!base.mount) return;
  await db.runTransaction(async (tx) => {
    const ref = eventMountRef(db, appId);
    const current = (await tx.get(ref)).data();
    if (current?.state !== 'published' || current.publicBase !== base.publicBase) {
      throw new Error('the published event address changed during synchronization');
    }
    if (!current.standalonePublicBase) tx.update(ref, { standalonePublicBase: base.standalonePublicBase });
  });
}

/** Record the effective address only after the ordinary deployment succeeds. */
async function recordAppliedPublicBase(db, identity, publicBase) {
  await db.runTransaction(async (tx) => {
    const ref = eventMountRef(db, identity.appId);
    const route = (await tx.get(ref)).data();
    if (!route || resolveEventPublicBase(route, identity).publicBase !== publicBase) {
      throw new Error('the event address changed during deployment');
    }
    tx.update(ref, { appliedPublicBase: publicBase });
  });
}

/** Keep the path reservation when its application and consent are purged. */
async function purgeEventMount(tx, db, appId) {
  const ref = eventMountRef(db, appId);
  const route = (await tx.get(ref)).data();
  if (!route) return;
  const { host, mount, publicBase, projectId, hostingOrigin: origin } = route;
  tx.set(ref, { host, mount, publicBase, projectId, hostingOrigin: origin, appId, state: 'removed' });
}

/** Change only this route inside the application lifecycle transaction. */
async function changeMountForApplication(tx, db, appId, change) {
  const ref = eventMountRef(db, appId);
  const route = (await tx.get(ref)).data();
  if (!route || route.state === 'removed') return;
  if (change === 'remove') tx.update(ref, { state: 'removed' });
  if (change === 'retire' && route.state === 'published') tx.update(ref, { state: 'retired' });
  if (change === 'restore' && route.state === 'retired') tx.update(ref, { state: 'published' });
}

module.exports = {
  MOUNTS, changeMountForApplication, clientHostRef, eventMountRef, hostingOrigin, purgeEventMount,
  recordAppliedPublicBase, recordStandalonePublicBase, resolveEventPublicBase,
};
