'use strict';

/**
 * Connecting a client's own Stripe or Eventbrite account (ADR 0007 §4).
 *
 * The flow, for an Owner:
 *   1. startConnection returns the provider's page. It stores the SHA-256 of a
 *      random `state` in `console_connection_states/{hash}`, with the user,
 *      the request, the provider and an expiry.
 *   2. The provider sends the browser to `<console>/connect/<provider>/return`.
 *      That page posts the code and state with the signed-in user's ID token.
 *   3. completeConnection deletes the state row first, so the state works once
 *      and a code is never sent to the provider twice. (Stripe ends a
 *      connection when a code is used again.) The row must name this user and
 *      provider and be unexpired. It then exchanges the code, writes the
 *      connection state to Firestore, and writes the token to Secret Manager.
 *
 * Tokens go only to Secret Manager. Never to Firestore, a response, a log or
 * an error message. The redirect address comes from CONSOLE_PUBLIC_URL, never
 * from the request, and the provider's page from a fixed host in connectors.cjs.
 *
 * For the site builder: readStoredConnection and deleteStoredConnection, below.
 */

const { createHash, randomBytes } = require('node:crypto');
const { ConsoleError } = require('./http.cjs');
const { requireOwner, toMillis } = require('./access.cjs');
const { withDefaults } = require('./answers.cjs');
const { checkAnswers, stepErrors } = require('./checks.cjs');
const { takeSlot } = require('./rateLimit.cjs');
const { CLOSED, EDITABLE, readApplication } = require('./applications.cjs');
const { CHANGEABLE, PROVIDERS, PROVIDER_NAMES, connectionsForClient, liveConnection } = require('./connectionState.cjs');

const STATE_COLLECTION = 'console_connection_states';
// Long enough to make a new Stripe account on Stripe's page.
const STATE_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STARTS_PER_DAY = 30;
const STATE_MAX = 200;
const CODE_MAX = 1024;
const EVENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SECRET_APP_ID = /^[A-Za-z0-9_-]{1,200}$/;

const ONLY_OWNER = 'Only an Owner can change this account.';
const MISMATCH = 'We could not match this to your request, or it took too long. Start again from the tickets step.';
const stillBuilding = 'Your site is being built, so you cannot change this account here now.';
const failedToConnect = (provider) => `We could not connect your ${PROVIDER_NAMES[provider]} account. Try again.`;

/** A refusal caused by a failure. postEndpoint logs the cause, which holds no token, code or provider body. */
function failure(status, code, message, cause) {
  const err = new ConsoleError(status, code, message);
  err.cause = cause;
  return err;
}

const hashState = (state) => createHash('sha256').update(state, 'utf8').digest('hex');
const stateRef = (db, state) => db.collection(STATE_COLLECTION).doc(hashState(state));

/** The Secret Manager id of one connection's token. */
function connectionSecretId(appId, provider) {
  if (!SECRET_APP_ID.test(appId) || !PROVIDERS.includes(provider)) throw new TypeError('connectionSecretId: bad id');
  return `connection-${provider}-${appId}`;
}

function requireProvider(value) {
  if (!PROVIDERS.includes(value)) throw new ConsoleError(400, 'bad-request', 'Choose an account to connect.');
  return value;
}

function requireConnector({ connectors, publicUrl }, provider) {
  const connector = connectors?.[provider];
  if (!connector || !publicUrl) {
    throw new ConsoleError(503, 'not-available', `Connecting a ${PROVIDER_NAMES[provider]} account is not available yet.`);
  }
  return connector;
}

const redirectUri = (publicUrl, provider) => `${publicUrl}/connect/${provider}/return`;

function requireChangeable(data) {
  if (CLOSED.includes(data.status)) throw new ConsoleError(409, 'locked', 'This request is closed.');
  if (!CHANGEABLE.includes(data.status)) throw new ConsoleError(409, 'locked', stillBuilding);
}

/** After the answers are frozen, only the account they chose can be connected. */
function requireConnectable(data, provider) {
  requireChangeable(data);
  if (EDITABLE.includes(data.status)) return;
  if (withDefaults(data.frozen || data.answers).tickets.choice !== provider) {
    throw new ConsoleError(409, 'locked', 'Your request does not use this account.');
  }
}

/** The reply after a change: the state for the page, and the tickets step's errors. */
function connectionsReply({ connectionsAvailable: available }, data, connections) {
  return {
    connections: connectionsForClient(connections, { available, status: data.status, role: 'owner' }),
    errors: stepErrors(checkAnswers(data.answers, connections), 'tickets'),
  };
}

async function revokeQuietly({ connectors, log = console }, provider, accountId) {
  try {
    const connector = connectors?.[provider];
    if (!connector) throw new Error('not set up');
    return await connector.revoke(accountId);
  } catch (err) {
    log.error('console could not revoke a connection', provider, err.message);
    return false;
  }
}

function withoutProvider(connections, provider) {
  const { [provider]: _removed, ...rest } = connections && typeof connections === 'object' ? connections : {};
  return rest;
}

/** Put one provider's state back after a failed Secret Manager call. */
async function restoreState({ db, log = console }, { orgId, appId, provider, previous }) {
  try {
    await db.runTransaction(async (tx) => {
      const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
      const rest = withoutProvider(data.connections, provider);
      tx.update(ref, { connections: previous ? { ...rest, [provider]: previous } : rest });
    });
  } catch (err) {
    log.error('console could not restore a connection state', provider, err.message);
  }
}

async function startConnection(deps, { body, user }) {
  const { db, now = Date.now, publicUrl } = deps;
  const { orgId, appId } = body;
  const provider = requireProvider(body.provider);
  await requireOwner(db, orgId, user, ONLY_OWNER);
  const { data } = await readApplication((r) => r.get(), db, orgId, appId);
  requireConnectable(data, provider);
  const connector = requireConnector(deps, provider);
  await takeSlot(db, {
    key: `connect-${user.uid}`,
    max: STARTS_PER_DAY,
    windowMs: DAY_MS,
    now,
    message: 'You have tried to connect too many times today. Try again tomorrow.',
  });
  const state = randomBytes(32).toString('base64url');
  const at = now();
  await stateRef(db, state).create({
    uid: user.uid, orgId, appId, provider, createdAt: new Date(at), expiresAt: new Date(at + STATE_TTL_MS),
  });
  return { body: { url: connector.authorizeUrl({ state, redirectUri: redirectUri(publicUrl, provider) }) } };
}

/**
 * Use up the state, whatever happens next, and check what it was bound to.
 * Every refusal has the same words, so a stranger learns nothing from them.
 */
async function consumeState({ db, now = Date.now }, { state, provider, user }) {
  const refuse = () => new ConsoleError(400, 'state-mismatch', MISMATCH);
  if (typeof state !== 'string' || !state || state.length > STATE_MAX) throw refuse();
  const ref = stateRef(db, state);
  const row = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref);
    return snap.data();
  });
  if (!row || row.uid !== user.uid || row.provider !== provider || !(toMillis(row.expiresAt) > now())) throw refuse();
  return row;
}

async function exchange(deps, { connector, provider, code, knownAccount }) {
  try {
    return await connector.exchangeCode({ code, redirectUri: redirectUri(deps.publicUrl, provider) });
  } catch (err) {
    // The provider made a connection we cannot use, so end it.
    if (err.accountId && err.accountId !== knownAccount) await revokeQuietly(deps, provider, err.accountId);
    throw failure(502, 'connection-failed', failedToConnect(provider), err);
  }
}

async function completeConnection(deps, { body, user }) {
  const { db, now = Date.now, secrets } = deps;
  const provider = PROVIDERS.includes(body.provider) ? body.provider : null;
  if (!provider) throw new ConsoleError(400, 'state-mismatch', MISMATCH);
  const { orgId, appId } = await consumeState(deps, { state: body.state, provider, user });
  await requireOwner(db, orgId, user, ONLY_OWNER);
  if (body.denied === true) return { body: { connected: false, provider, orgId, appId } };
  if (typeof body.code !== 'string' || !body.code || body.code.length > CODE_MAX) {
    throw new ConsoleError(400, 'connection-failed', failedToConnect(provider));
  }
  const connector = requireConnector(deps, provider);
  const first = await readApplication((r) => r.get(), db, orgId, appId);
  requireConnectable(first.data, provider);
  const knownAccount = liveConnection(first.data.connections, provider)?.accountId ?? null;

  const answer = await exchange(deps, { connector, provider, code: body.code, knownAccount });

  const at = new Date(now());
  let previous = null;
  try {
    // The state goes first: when the request moved on while the client was
    // on the provider's page, this refuses, and nothing has been stored.
    await db.runTransaction(async (tx) => {
      const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
      requireConnectable(data, provider);
      previous = liveConnection(data.connections, provider);
      const keepEvent = provider === 'eventbrite' ? { event: previous?.accountId === answer.accountId ? previous.event ?? null : null } : {};
      const connection = {
        connected: true,
        accountId: answer.accountId,
        displayName: answer.displayName,
        ...answer.details,
        ...keepEvent,
        connectedAt: at,
        connectedBy: user.uid,
      };
      tx.update(ref, { connections: { ...data.connections, [provider]: connection }, updatedAt: at, updatedBy: user.uid });
    });
  } catch (err) {
    if (answer.accountId !== knownAccount) await revokeQuietly(deps, provider, answer.accountId);
    throw err;
  }

  try {
    await secrets.writeSecret(connectionSecretId(appId, provider), answer.token);
  } catch (err) {
    await restoreState(deps, { orgId, appId, provider, previous });
    if (answer.accountId !== previous?.accountId) await revokeQuietly(deps, provider, answer.accountId);
    throw failure(502, 'connection-failed', failedToConnect(provider), err);
  }

  // Connecting a different account ends the older one.
  if (previous?.accountId && previous.accountId !== answer.accountId) await revokeQuietly(deps, provider, previous.accountId);
  return { body: { connected: true, provider, orgId, appId } };
}

async function disconnectAccount(deps, { body, user }) {
  const { db, now = Date.now, secrets } = deps;
  const { orgId, appId } = body;
  const provider = requireProvider(body.provider);
  await requireOwner(db, orgId, user, ONLY_OWNER);
  const at = new Date(now());
  let previous = null;
  let reply = null;
  await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    const closed = CLOSED.includes(data.status);
    if (!closed) requireChangeable(data);
    previous = liveConnection(data.connections, provider);
    const connections = withoutProvider(data.connections, provider);
    // A closed request is still deleted 90 days after its last real change.
    tx.update(ref, { connections, ...(closed ? {} : { updatedAt: at, updatedBy: user.uid }) });
    reply = connectionsReply(deps, data, connections);
  });
  try {
    await secrets.deleteSecret(connectionSecretId(appId, provider));
  } catch (err) {
    await restoreState(deps, { orgId, appId, provider, previous });
    throw failure(502, 'disconnect-failed', `We could not disconnect your ${PROVIDER_NAMES[provider]} account. Try again.`, err);
  }
  const revoked = previous?.accountId ? await revokeQuietly(deps, provider, previous.accountId) : false;
  return { body: { ...reply, revoked } };
}

/** The Owner's Eventbrite events, read with the stored token. */
async function readEventbriteEvents(deps, { orgId, appId, user }) {
  const { db, secrets } = deps;
  await requireOwner(db, orgId, user, ONLY_OWNER);
  const { data } = await readApplication((r) => r.get(), db, orgId, appId);
  requireChangeable(data);
  const connector = requireConnector(deps, 'eventbrite');
  const refusal = 'We could not read your Eventbrite events. Try again, or connect your account again.';
  if (!liveConnection(data.connections, 'eventbrite')) throw new ConsoleError(409, 'not-connected', 'Connect your Eventbrite account first.');
  try {
    const token = await secrets.readSecret(connectionSecretId(appId, 'eventbrite'));
    if (!token) throw new Error('no stored connection');
    return await connector.listEvents(token);
  } catch (err) {
    throw failure(502, 'events-failed', refusal, err);
  }
}

async function listEventbriteEvents(deps, { body, user }) {
  const events = await readEventbriteEvents(deps, { orgId: body.orgId, appId: body.appId, user });
  return { body: { events: events.map(({ id, name, start }) => ({ id, name, start })) } };
}

async function chooseEventbriteEvent(deps, { body, user }) {
  const { db, now = Date.now } = deps;
  const { orgId, appId, eventId } = body;
  if (typeof eventId !== 'string' || !EVENT_ID.test(eventId)) throw new ConsoleError(400, 'bad-request', 'Choose your Eventbrite event.');
  // Only an event this account really has. The browser's word is not enough.
  const events = await readEventbriteEvents(deps, { orgId, appId, user });
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) throw new ConsoleError(400, 'bad-request', 'We could not find that event in your Eventbrite account.');
  const at = new Date(now());
  let reply = null;
  await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    requireChangeable(data);
    const connection = liveConnection(data.connections, 'eventbrite');
    if (!connection) throw new ConsoleError(409, 'not-connected', 'Connect your Eventbrite account first.');
    const connections = { ...data.connections, eventbrite: { ...connection, event } };
    tx.update(ref, { connections, updatedAt: at, updatedBy: user.uid });
    reply = connectionsReply(deps, data, connections);
  });
  return { body: reply };
}

/**
 * For the site builder (ADR 0007 §6 step 6): one connection's token and state.
 *
 * @param {{ db: object, secrets: { readSecret: Function } }} deps
 * @returns {Promise<{ token: string, connection: object }|null>} null when it is
 *   not connected or holds no token. `connection.accountId` is
 *   EVENT_STRIPE_ACCOUNT_ID, `connection.livemode` sets EVENT_STRIPE_MODE, and
 *   `connection.event.id` is Eventbrite's EVENT_TICKETING_EVENT_ID.
 */
async function readStoredConnection({ db, secrets }, appId, provider) {
  const snap = await db.collection('applications').doc(appId).get();
  const connection = liveConnection(snap.exists ? snap.data().connections : null, provider);
  if (!connection) return null;
  const token = await secrets.readSecret(connectionSecretId(appId, provider));
  return token ? { token, connection } : null;
}

/**
 * For the site builder, after it has moved the token to the event's project:
 * delete the console's copy. It does not revoke, because the token keeps
 * working on the client's site, and the Firestore state stays. Safe to repeat.
 */
async function deleteStoredConnection({ secrets }, appId, provider) {
  await secrets.deleteSecret(connectionSecretId(appId, provider));
}

/**
 * Delete a request's stored tokens and end its connections, for a request
 * that is being deleted. Throws when a token cannot be deleted, so the caller
 * keeps the request and tries again. A failed revoke is logged.
 */
async function forgetConnections(deps, app) {
  for (const provider of PROVIDERS) {
    await deps.secrets.deleteSecret(connectionSecretId(app.id, provider));
    const accountId = liveConnection(app.connections, provider)?.accountId;
    if (accountId) await revokeQuietly(deps, provider, accountId);
  }
}

/** Delete state rows nobody came back for. A failure is logged; the next run tries again. */
async function sweepExpiredStates({ db, log = console }, at, batchSize) {
  try {
    for (;;) {
      const snap = await db.collection(STATE_COLLECTION).where('expiresAt', '<=', new Date(at)).limit(batchSize).get();
      if (snap.docs.length === 0) return;
      const batch = db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
      if (snap.docs.length < batchSize) return;
    }
  } catch (err) {
    log.error('console could not clear expired connection states', err.message);
  }
}

module.exports = {
  STATE_COLLECTION,
  STATE_TTL_MS,
  chooseEventbriteEvent,
  completeConnection,
  connectionSecretId,
  deleteStoredConnection,
  disconnectAccount,
  forgetConnections,
  listEventbriteEvents,
  readStoredConnection,
  startConnection,
  sweepExpiredStates,
};
