'use strict';

const { parseEventPublicBase } = require('shared/config/publicBase');
const { CONSOLE_REQUEST_GROUPS } = require('shared/consoleRequest');
const { ConsoleError } = require('./http.cjs');
const { requireOwner } = require('./access.cjs');
const { NOT_FOUND, applicationRef, requireAppId, requireOperator } = require('./reviewAccess.cjs');
const { readBuild, canRetryBuild } = require('./buildState.cjs');
const { normalizeProjectId } = require('./consoleSettings.cjs');
const {
  MOUNTS, clientHostRef, eventMountRef, hostingOrigin, reservedClientPath, resolveEventPublicBase, updateEventMount,
} = require('./clientHostRecords.cjs');
const { publicEventTitle } = require('./clientHostMap.cjs');
const { routeMapError } = require('./clientHostMapStore.cjs');
const { publishClientHostMap } = require('./clientHostPublish.cjs');
const { COLLECTION: SITE_NAMES, SITE_DOMAIN, RESERVED } = require('./siteNames.cjs');

const DNS_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^(?:${DNS_LABEL}\\.)+${DNS_LABEL}$`);
const AUTHORITY_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;

function conflict(message) {
  return new ConsoleError(409, 'mount-conflict', message);
}

function managedName(host) {
  if (!host.endsWith(`.${SITE_DOMAIN}`)) return null;
  const name = host.slice(0, -SITE_DOMAIN.length - 1);
  return name.includes('.') ? null : name;
}

function parseEnrollmentBase(value) {
  try {
    if (typeof value === 'string' && value.length <= 2048) {
      const { publicBase, origin, mount } = parseEventPublicBase(value);
      if (mount) {
        const { hostname: host, port } = new URL(origin);
        if (!port && host.length <= 253 && HOSTNAME.test(host) && /[a-z]/.test(host.split('.').at(-1))
            && host !== SITE_DOMAIN && !RESERVED.has(managedName(host))
            && !/(^|\.)(web\.app|firebaseapp\.com)$/.test(host)
            && !reservedClientPath(mount)) {
          return { publicBase, host, mount };
        }
      }
    }
  } catch {
    // Report the same validation error without echoing the supplied URL.
  }
  throw new ConsoleError(400, 'invalid-mount', 'Choose an HTTPS client host and an available event path.');
}

function requireApplication(snap) {
  if (!snap.exists) throw new ConsoleError(404, 'not-found', NOT_FOUND);
  return snap.data();
}

function requireOpen(app) {
  if (CONSOLE_REQUEST_GROUPS.closed.includes(app.status) || app.status === 'archived') {
    throw conflict('The request is closed or archived.');
  }
}

async function consentEventMount({ db, now = Date.now }, { body, user }) {
  const appId = requireAppId(body.appId);
  const base = parseEnrollmentBase(body.publicBase);
  if (body.confirm !== true) throw new ConsoleError(400, 'confirm-required', 'Confirm this event’s public address.');
  const ref = applicationRef(db, appId);
  const at = new Date(now());
  await db.runTransaction(async (tx) => {
    const get = (doc) => tx.get(doc);
    await requireOwner(db, body.orgId, user, 'Only an Owner can approve this public address.', get);
    const app = requireApplication(await get(ref));
    if (app.orgId !== body.orgId) throw new ConsoleError(404, 'not-found', NOT_FOUND);
    requireOpen(app);
    const route = (await get(eventMountRef(db, appId))).data();
    if (route && route.publicBase !== base.publicBase) throw conflict('This event already has a reserved public address.');
    if (!route || route.state === 'removed') tx.update(ref, { eventMountConsent: { ...base, by: user.uid, at } });
  });
  return { body: { appId, publicBase: base.publicBase } };
}

function enrolledRoute({ appId, app, build, consent, base, user, at }) {
  const { projectId, site } = build?.resources || {};
  if (!projectId || normalizeProjectId(projectId) !== projectId || !site) {
    throw conflict('The request must have a recorded event project and Hosting site.');
  }
  return {
    ...base,
    appId,
    projectId,
    hostingOrigin: hostingOrigin(site),
    state: 'enrolled',
    consent: { orgId: app.orgId, by: consent.by, at: consent.at },
    enrolledBy: user.uid,
    enrolledAt: at,
  };
}

function overlaps(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

async function enroll(tx, db, { appId, app, ref, route, body, user, at }) {
  requireOpen(app);
  const base = parseEnrollmentBase(body.publicBase);
  if (route) {
    if (route.publicBase !== base.publicBase) throw conflict('This event already has a reserved public address.');
    if (route.state !== 'removed') return route;
  }
  const consent = app.eventMountConsent;
  if (consent?.publicBase !== base.publicBase) throw conflict('An Owner of this event must approve this exact address.');
  const get = (doc) => tx.get(doc);
  await requireOwner(db, app.orgId, { uid: consent.by }, 'An Owner must approve this address again.', get);
  const build = await readBuild(get, db, appId);
  const finished = CONSOLE_REQUEST_GROUPS.built.includes(app.status) && build?.state !== 'running';
  if (!finished && !canRetryBuild(app, build, at.getTime())) {
    throw conflict('Wait until this event’s build finishes or is ready to retry.');
  }
  const record = enrolledRoute({ appId, app, build, consent, base, user, at });
  if (route) {
    if (route.projectId !== record.projectId || route.hostingOrigin !== record.hostingOrigin) {
      throw conflict('The event must keep its original Firebase project and Hosting site.');
    }
    const revised = { consent: record.consent, state: 'enrolled', changedAt: at, changedBy: user.uid };
    tx.update(ref, revised);
    return { ...route, ...revised };
  }
  const hostRef = clientHostRef(db, base.host);
  const approved = (await get(hostRef)).data();
  if (!approved) {
    if (typeof body.authorityReference !== 'string' || !AUTHORITY_REFERENCE.test(body.authorityReference)
        || body.confirmAuthority !== true) {
      throw conflict('Verify control of this client host and record the verification reference.');
    }
    const name = managedName(base.host);
    const existing = name ? await get(db.collection(SITE_NAMES).doc(name)) : null;
    if (existing?.exists && (existing.data().deleted || existing.data().appId !== appId || existing.data().orgId !== app.orgId)) {
      throw conflict('An existing event uses this host. Its Owner must consent and its event must enroll first.');
    }
    if (existing?.exists && !finished) {
      throw conflict('Finish the existing event’s build before approving its address as a shared host.');
    }
    tx.create(hostRef, { host: base.host, authority: { reference: body.authorityReference, by: user.uid, at }, revision: 1 });
  } else {
    const reserved = await get(db.collection(MOUNTS).where('host', '==', base.host));
    if (reserved.docs.some((doc) => overlaps(doc.data().mount, base.mount) || doc.data().projectId === record.projectId
        || doc.data().hostingOrigin === record.hostingOrigin)) {
      throw conflict('Another event already reserves this path or uses this Hosting site on this host.');
    }
    // Serialize reservations on the host even when their query found no overlap.
    tx.update(hostRef, { revision: approved.revision + 1 });
  }
  tx.create(ref, record);
  return record;
}

async function manageEventMount(deps, { body, user }) {
  const { db, routeMaps, now = Date.now } = deps;
  const appId = requireAppId(body.appId);
  const ref = eventMountRef(db, appId);
  const at = new Date(now());
  const result = await db.runTransaction(async (tx) => {
    const get = (doc) => tx.get(doc);
    await requireOperator(db, user, get);
    const route = (await get(ref)).data();
    if (body.action === 'get') return route || null;
    if (body.action === 'enroll') {
      const app = requireApplication(await get(applicationRef(db, appId)));
      return enroll(tx, db, { appId, app, ref, route, body, user, at });
    }
    if (!['publish', 'remove'].includes(body.action) || body.confirm !== true) {
      throw new ConsoleError(400, 'confirm-required', 'Choose and confirm a route change.');
    }
    if (!route) throw new ConsoleError(404, 'not-found', 'No event route was enrolled.');
    const state = body.action === 'publish' ? 'published' : 'removed';
    let publicTitle;
    if (state === 'published') {
      const app = requireApplication(await get(applicationRef(db, appId)));
      const build = await readBuild(get, db, appId);
      if (!['enrolled', 'published'].includes(route.state) || !CONSOLE_REQUEST_GROUPS.built.includes(app.status)
          || build?.state === 'running' || parseEnrollmentBase(body.publicBase).publicBase !== route.publicBase) {
        throw conflict('Confirm the approved public address for a completed event.');
      }
      resolveEventPublicBase({ ...route, state }, { ...build?.resources, appId });
      publicTitle = publicEventTitle(body.publicTitle ?? route.publicTitle);
      if (!publicTitle) throw new ConsoleError(400, 'public-title-required', 'Enter the event title to list on the client host.');
    }
    if ((publicTitle || route.publishedAt) && !routeMaps) {
      throw new ConsoleError(503, 'route-map-unavailable', 'The client route map store is unavailable.');
    }
    if (route.state === state && (state !== 'published' || route.publicTitle === publicTitle)) return route;
    const updated = {
      state, changedBy: user.uid, changedAt: at,
      ...(state === 'published' ? { publicTitle, publishedAt: route.publishedAt || at } : {}),
    };
    await updateEventMount(tx, db, appId, route, updated);
    return { ...route, ...updated };
  });
  let routeMap;
  const enrolledHost = body.action === 'enroll' && routeMaps;
  const changedPublicRoute = ['publish', 'remove'].includes(body.action) && result?.publishedAt;
  if (enrolledHost || changedPublicRoute) {
    try {
      routeMap = await publishClientHostMap(deps, result);
    } catch (error) {
      const refusal = new ConsoleError(503, 'route-map-unavailable', 'The public route map could not be verified.');
      refusal.cause = routeMapError('Verifying the public route map', error).message;
      throw refusal;
    }
  }
  return { body: { route: result, ...(routeMap && { routeMap }) } };
}

module.exports = { consentEventMount, manageEventMount };
