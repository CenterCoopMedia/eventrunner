'use strict';

const { readBuild } = require('./buildState.cjs');
const { projectRouteMap } = require('./clientHostMap.cjs');
const { RouteMapError, routeMapError, writeVerifiedRouteMap } = require('./clientHostMapStore.cjs');
const { MOUNTS, clientHostRef, eventMountRef } = require('./clientHostRecords.cjs');

const PUBLISH_ATTEMPTS = 3;

async function readApprovedProjection(db, host, exportedAt) {
  try {
    return await db.runTransaction(async (tx) => {
      const approved = (await tx.get(clientHostRef(db, host))).data();
      if (approved?.host !== host) throw new RouteMapError('The client host has no approval record.');
      const { docs } = await tx.get(db.collection(MOUNTS).where('host', '==', host));
      const enrollments = await Promise.all(docs.map(async (doc) => {
        const record = doc.data();
        if (record.state !== 'published') return { record };
        const build = await readBuild((ref) => tx.get(ref), db, doc.id);
        return { record, identity: { ...build?.resources, appId: doc.id } };
      }));
      return projectRouteMap(approved, enrollments, exportedAt);
    }, { readOnly: true });
  } catch (error) {
    throw routeMapError('Reading and validating the approved host records', error);
  }
}

async function publishClientHostMap({ db, routeMaps, now = Date.now }, expected) {
  if (!routeMaps) throw new RouteMapError('The client route map store is not configured.');
  for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt += 1) {
    const map = await readApprovedProjection(db, expected.host, new Date(now()).toISOString());
    const route = map.routes.find(({ mount }) => mount === expected.mount);
    const matches = expected.state === 'published'
      ? route?.hostingOrigin === expected.hostingOrigin && route?.publicTitle === expected.publicTitle
      : !route;
    if (!matches) throw new RouteMapError('The event route changed during publication.');
    const verified = await writeVerifiedRouteMap(routeMaps, map);
    if (verified) return verified;
  }
  throw new RouteMapError('The public route map changed during publication. Try again.');
}

async function refreshApplicationRouteMap(deps, appId) {
  try {
    const route = (await eventMountRef(deps.db, appId).get()).data();
    if (route?.publishedAt) return await publishClientHostMap(deps, route);
  } catch (error) {
    throw routeMapError('Verifying the event lifecycle route map', error);
  }
}

module.exports = { publishClientHostMap, refreshApplicationRouteMap };
