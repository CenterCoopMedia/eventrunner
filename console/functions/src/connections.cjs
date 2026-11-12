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
 *      provider and be unexpired. It then exchanges the code, marks the
 *      connection as changing, writes the token to Secret Manager, and only
 *      then makes the connection live.
 *
 * A disconnect holds the same mark while it deletes the token, so two calls
 * never change one token at once. A connection is live only when its token is
 * stored. A call that dies leaves a mark that runs out, and a connection that
 * is not live, which the Owner connects again.
 *
 * Tokens go only to Secret Manager. Never to Firestore, a response, a log or
 * an error message. The redirect address comes from CONSOLE_PUBLIC_URL, never
 * from the request, and the provider's page from a fixed host in connectors.cjs.
 *
 * Every member of an organization can read `applications/{appId}` directly,
 * so that document holds only what they may see (connectionState.cjs). The
 * rest is in `console_connections/{appId}`, which no browser can read:
 *   { stripe?: { accountId, connectedBy, livemode },
 *     eventbrite?: { accountId, connectedBy, eventOrganizationId } }
 *
 * One account can serve several requests, and ending a connection at the
 * provider ends it for all of them, live sites included. So nothing here
 * calls a provider's revoke except revokeIfUnused. A row in that collection
 * is removed only by a disconnect or by deleting a closed request. It stays
 * when the site builder moves a token, so it also speaks for a site running
 * from a client project, whatever happens to the application.
 *
 * For the site builder: readStoredConnection and deleteStoredConnection, below.
 */

const { createHash, randomBytes } = require('node:crypto');
const { ConsoleError } = require('./http.cjs');
const { requireOwner, toMillis } = require('./access.cjs');
const { withDefaults } = require('./answers.cjs');
const { checkAnswers, stepErrors } = require('./checks.cjs');
const { takeSlot } = require('./rateLimit.cjs');
const { BUILD_COLLECTION, RETRY_STATUSES, canRetryBuild, readBuild } = require('./buildState.cjs');
const { ARCHIVED_MESSAGE, CLOSED, readApplication } = require('./applications.cjs');
const { hostName } = require('./hostName.cjs');
const {
  BUILT_STATUSES, CHANGEABLE, PROVIDERS, PROVIDER_NAMES, connectionChanging, connectionsForClient, liveConnection,
} = require('./connectionState.cjs');

const STATE_COLLECTION = 'console_connection_states';
const ACCOUNT_COLLECTION = 'console_connections';
const DELETION_COLLECTION = 'console_token_deletions';
// Longer than a function may run (60 seconds), so a running call always holds its mark.
const CHANGE_MS = 5 * 60 * 1000;
// Long enough to make a new Stripe account on Stripe's page.
const STATE_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STARTS_PER_DAY = 30;
const STATE_MAX = 200;
const CODE_MAX = 1024;
const EVENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SECRET_APP_ID = /^[A-Za-z0-9_-]{1,200}$/;

const ONLY_OWNER = 'Only an Owner can change this account.';
const MISMATCH = 'We could not match this to your request, or it took too long. Connect the account again.';
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
const accountsRef = (db, appId) => db.collection(ACCOUNT_COLLECTION).doc(appId);
const accountsOf = (snap) => (snap.exists ? snap.data() : {});

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
  if (data.status === 'archived') throw new ConsoleError(409, 'locked', ARCHIVED_MESSAGE);
  if (!CHANGEABLE.includes(data.status)) throw new ConsoleError(409, 'locked', stillBuilding);
}

/**
 * A draft can connect any account. After acceptance the provisioner owns the
 * tokens, so an Owner can replace only the account the frozen answers chose,
 * and only while a failed build waits for its retry. `get` is a transaction's
 * or the database's.
 */
async function requireConnectable({ db, now = Date.now }, get, { appId, data, provider }) {
  if (CLOSED.includes(data.status)) throw new ConsoleError(409, 'locked', 'This request is closed.');
  if (data.status === 'archived') throw new ConsoleError(409, 'locked', ARCHIVED_MESSAGE);
  if (CHANGEABLE.includes(data.status)) return;
  if (!canRetryBuild(data, await readBuild(get, db, appId), now())) throw new ConsoleError(409, 'locked', stillBuilding);
  if (withDefaults(data.frozen || data.answers).tickets.choice !== provider) {
    throw new ConsoleError(409, 'locked', 'Your request does not use this account.');
  }
}

/**
 * Each live Stripe site's payment webhook is a platform Connect endpoint,
 * which receives every connected account's events. Until a shared receiver
 * routes events by account (eventrunner issue 835), only one live Stripe
 * account may be connected, so no client's payments reach another client's
 * site. The same request may reconnect its own account.
 */
async function requireOnlyLiveStripe(tx, db, appId) {
  // A connected account, or a built site that still holds a platform endpoint
  // after its account was disconnected, reserves the one slot.
  const held = await tx.get(db.collection(ACCOUNT_COLLECTION));
  const builds = await tx.get(db.collection(BUILD_COLLECTION));
  let other = builds.docs.some((doc) => doc.id !== appId && doc.data()?.stripeEndpointOwner === 'platform');
  for (const doc of held.docs) {
    if (other) break;
    const stripe = doc.data()?.stripe;
    if (doc.id === appId || !stripe?.accountId) continue;
    // Existing private rows predate mode storage. Unknown mode keeps the slot.
    const livemode = typeof stripe.livemode === 'boolean' ? stripe.livemode
      : (await tx.get(db.collection('applications').doc(doc.id))).data()?.connections?.stripe?.livemode;
    other = livemode !== false;
  }
  if (other) {
    throw new ConsoleError(409, 'locked', 'Event Runner can connect one live Stripe account for now. Email info@eventrunner.org and we will set up yours.');
  }
}

/** The reply after a change: the state for the page, and the tickets step's errors. */
function connectionsReply({ connectionsAvailable: available, consoleTestMode: testMode }, data, connections) {
  const reconnect = RETRY_STATUSES.includes(data.status);
  return {
    connections: connectionsForClient(connections, { available, status: data.status, role: 'owner', reconnect }),
    errors: stepErrors(checkAnswers(data.answers, connections, { testMode }), 'tickets'),
  };
}

/**
 * End a connection at the provider, unless any request or site still uses
 * the account. Call it after this request's own row has stopped naming the
 * account. Unsure means keep: a connection left open can be removed later,
 * and one wrongly ended stops another client's site from selling tickets.
 *
 * A connection finishing in the moment between the check and the revoke can
 * still be ended. Two disconnects at once cannot both keep the connection:
 * the last one sees no other row.
 *
 * @returns {Promise<{ revoked: boolean, shared: boolean }>}
 */
async function revokeIfUnused({ db, connectors, log = console }, provider, accountId, { requireSuccess = false } = {}) {
  let users;
  try {
    users = await db.collection(ACCOUNT_COLLECTION).where(`${provider}.accountId`, '==', accountId).limit(1).get();
  } catch (err) {
    log.error('console kept a connection because it could not check who uses it', provider, err.message);
    return { revoked: false, shared: false };
  }
  if (users.docs.length > 0) {
    log.info?.('console kept a connection another request uses', provider);
    return { revoked: false, shared: true };
  }
  try {
    if (!connectors?.[provider]) throw new Error('not set up');
    return { revoked: await connectors[provider].revoke(accountId), shared: false };
  } catch (err) {
    log.error('console could not revoke a connection', provider, err.message);
    if (requireSuccess) {
      throw failure(502, 'disconnect-failed', `We could not end your ${PROVIDER_NAMES[provider]} connection at the provider. Email info@eventrunner.org for help.`, err);
    }
    return { revoked: false, shared: false };
  }
}

function withoutProvider(connections, provider) {
  const { [provider]: _removed, ...rest } = connections && typeof connections === 'object' ? connections : {};
  return rest;
}

/** One provider's state before a change: what members read, and the private row. */
function previousOf(data, accounts, provider) {
  return { connection: liveConnection(data.connections, provider), account: accounts[provider] || null };
}

/** The state a provider holds while this call changes its token. Refuses when another call holds it. */
function changingState(data, provider, at, id) {
  if (connectionChanging(data.connections, at.getTime(), [provider])) {
    throw new ConsoleError(409, 'connection-busy', 'This account is being changed. Try again in a few minutes.');
  }
  return { connected: false, change: { id, until: new Date(at.getTime() + CHANGE_MS) } };
}

const holdsChange = (data, provider, changeId) => data.connections?.[provider]?.change?.id === changeId;

/** End this call's change, leaving `connection`, or no state when it is null. */
async function finishChange({ db }, { orgId, appId, provider, changeId, connection }) {
  await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    if (!holdsChange(data, provider, changeId)) throw new Error('lost the connection change');
    const rest = withoutProvider(data.connections, provider);
    tx.update(ref, { connections: connection ? { ...rest, [provider]: connection } : rest });
  });
}

/**
 * After a failed Secret Manager call, nothing can show that the token and the
 * state agree: the call may yet finish, so even a read cannot settle it. The
 * connection stops being live, and its mark stays for a full lease, so a late
 * call cannot undo the next change. The private row goes back to the account
 * that may still be connected, so that next change ends it.
 */
async function endAfterFailure({ db, now = Date.now, log = console }, { orgId, appId, provider, previous, changeId }) {
  try {
    await db.runTransaction(async (tx) => {
      const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
      if (!holdsChange(data, provider, changeId)) return;
      const accounts = accountsOf(await tx.get(accountsRef(db, appId)));
      const restAccounts = withoutProvider(accounts, provider);
      const change = { id: changeId, until: new Date(now() + CHANGE_MS) };
      tx.update(ref, { connections: { ...data.connections, [provider]: { connected: false, change } } });
      tx.set(accountsRef(db, appId), previous.account ? { ...restAccounts, [provider]: previous.account } : restAccounts);
    });
  } catch (err) {
    // The change mark is left, which is not live and runs out.
    log.error('console could not end a connection after a failure', provider, err.message);
  }
}

async function startConnection(deps, { body, user }) {
  const { db, now = Date.now, publicUrl } = deps;
  const { orgId, appId } = body;
  const provider = requireProvider(body.provider);
  await requireOwner(db, orgId, user, ONLY_OWNER);
  const { data } = await readApplication((r) => r.get(), db, orgId, appId);
  await requireConnectable(deps, (r) => r.get(), { appId, data, provider });
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

async function exchange(deps, { connector, provider, code }) {
  try {
    return await connector.exchangeCode({ code, redirectUri: redirectUri(deps.publicUrl, provider) });
  } catch (err) {
    // The provider made a connection we cannot use, so end it.
    if (err.accountId) await revokeIfUnused(deps, provider, err.accountId, { requireSuccess: true });
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
  await requireConnectable(deps, (r) => r.get(), { appId, data: first.data, provider });
  if (provider === 'stripe' && connector.livemode === true) {
    await db.runTransaction((tx) => requireOnlyLiveStripe(tx, db, appId));
  }

  const answer = await exchange(deps, { connector, provider, code: body.code });

  const at = new Date(now());
  const changeId = randomBytes(8).toString('hex');
  let previous = null;
  let connection = null;
  try {
    // The state goes first: when the request moved on while the client was
    // on the provider's page, this refuses, and nothing has been stored.
    await db.runTransaction(async (tx) => {
      const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
      await requireConnectable(deps, (r) => tx.get(r), { appId, data, provider });
      const changing = changingState(data, provider, at, changeId);
      const accounts = accountsOf(await tx.get(accountsRef(db, appId)));
      if (provider === 'stripe' && answer.details?.livemode === true) await requireOnlyLiveStripe(tx, db, appId);
      previous = previousOf(data, accounts, provider);
      const same = previous.account?.accountId === answer.accountId;
      const keepEvent = provider === 'eventbrite' ? { event: same ? previous.connection?.event ?? null : null } : {};
      const keepOrganization = same && previous.account.eventOrganizationId ? { eventOrganizationId: previous.account.eventOrganizationId } : {};
      const mode = provider === 'stripe' ? { livemode: answer.details.livemode } : {};
      connection = { connected: true, displayName: answer.displayName, ...answer.details, ...keepEvent, connectedAt: at };
      tx.update(ref, { connections: { ...data.connections, [provider]: changing }, updatedAt: at, updatedBy: user.uid });
      tx.set(accountsRef(db, appId), { ...accounts, [provider]: { accountId: answer.accountId, connectedBy: user.uid, ...mode, ...keepOrganization } });
    });
  } catch (err) {
    await revokeIfUnused(deps, provider, answer.accountId, { requireSuccess: true });
    throw err;
  }

  try {
    await secrets.writeSecret(connectionSecretId(appId, provider), answer.token);
  } catch (err) {
    await endAfterFailure(deps, { orgId, appId, provider, previous, changeId });
    await revokeIfUnused(deps, provider, answer.accountId, { requireSuccess: true });
    throw failure(502, 'connection-failed', `We could not connect your ${PROVIDER_NAMES[provider]} account. Try again in a few minutes.`, err);
  }

  try {
    await finishChange(deps, { orgId, appId, provider, changeId, connection });
  } catch (err) {
    // The token is stored and the connection is not live, which is safe: the
    // private row names the account, so connecting again or a delete tidies up.
    throw failure(502, 'connection-failed', failedToConnect(provider), err);
  }

  // Connecting a different account ends the older one, when nothing else uses it.
  const older = previous.account?.accountId;
  if (older && older !== answer.accountId) await revokeIfUnused(deps, provider, older);
  return { body: { connected: true, provider, orgId, appId } };
}

/**
 * End a built site's Stripe connection. The site runs on the token the build
 * moved to its project, so only Stripe can stop it. The state clears only
 * after Stripe answers, and a failure leaves the connection as it was. The
 * site's copy of the token stays, and stops working.
 */
async function endBuiltConnection(deps, { orgId, appId, provider, user }) {
  const { db, connectors, now = Date.now, log = console } = deps;
  const at = new Date(now());
  const changeId = randomBytes(8).toString('hex');
  let previous = null;
  let reply = null;
  await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    if (!BUILT_STATUSES.includes(data.status)) throw new ConsoleError(409, 'locked', stillBuilding);
    const changing = changingState(data, provider, at, changeId);
    previous = previousOf(data, accountsOf(await tx.get(accountsRef(db, appId))), provider);
    const connections = withoutProvider(data.connections, provider);
    tx.update(ref, { connections: { ...connections, [provider]: changing }, updatedAt: at, updatedBy: user.uid });
    reply = connectionsReply(deps, data, connections);
  });
  const accountId = previous.account?.accountId;
  const restore = () => finishChange(deps, { orgId, appId, provider, changeId, connection: previous.connection });
  if (accountId) {
    try {
      // Stripe ends the connection for every site on the account, so one Owner cannot do that for another site.
      const users = await db.collection(ACCOUNT_COLLECTION).where(`${provider}.accountId`, '==', accountId).limit(2).get();
      if (users.docs.some((doc) => doc.id !== appId)) {
        throw new ConsoleError(409, 'account-shared', `Another event site uses this ${PROVIDER_NAMES[provider]} account, so disconnecting here would stop that site too. Ask ${hostName()} for help.`);
      }
      if (!connectors?.[provider]) throw new Error('not set up');
      await connectors[provider].revoke(accountId);
    } catch (err) {
      await restore().catch((failed) => log.error('console could not restore a connection', provider, failed.message));
      if (err instanceof ConsoleError) throw err;
      throw failure(502, 'disconnect-failed', `We could not disconnect your ${PROVIDER_NAMES[provider]} account. Try again in a few minutes.`, err);
    }
  }
  // The connection is over. If these fail, a mark only runs out, and a second try finds Stripe already ended.
  try {
    await db.runTransaction(async (tx) => {
      tx.set(accountsRef(db, appId), withoutProvider(accountsOf(await tx.get(accountsRef(db, appId))), provider));
    });
    await finishChange(deps, { orgId, appId, provider, changeId, connection: null });
  } catch (err) {
    log.error('console could not finish a disconnect', provider, err.message);
  }
  return { body: { ...reply, revoked: Boolean(accountId), shared: false } };
}

async function disconnectAccount(deps, { body, user }) {
  const { db, now = Date.now, secrets, log = console } = deps;
  const { orgId, appId } = body;
  const provider = requireProvider(body.provider);
  await requireOwner(db, orgId, user, ONLY_OWNER);
  if (provider === 'stripe') {
    const { data: current } = await readApplication((r) => r.get(), db, orgId, appId);
    if (BUILT_STATUSES.includes(current.status)) return endBuiltConnection(deps, { orgId, appId, provider, user });
  }
  const at = new Date(now());
  const changeId = randomBytes(8).toString('hex');
  let previous = null;
  let reply = null;
  await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    const closed = CLOSED.includes(data.status);
    if (!closed) requireChangeable(data);
    const changing = changingState(data, provider, at, changeId);
    const accounts = accountsOf(await tx.get(accountsRef(db, appId)));
    previous = previousOf(data, accounts, provider);
    const connections = withoutProvider(data.connections, provider);
    // A closed request is still deleted 90 days after its last real change.
    tx.update(ref, { connections: { ...connections, [provider]: changing }, ...(closed ? {} : { updatedAt: at, updatedBy: user.uid }) });
    tx.set(accountsRef(db, appId), withoutProvider(accounts, provider));
    reply = connectionsReply(deps, data, connections);
  });
  try {
    await secrets.deleteSecret(connectionSecretId(appId, provider));
  } catch (err) {
    await endAfterFailure(deps, { orgId, appId, provider, previous, changeId });
    throw failure(502, 'disconnect-failed', `We could not disconnect your ${PROVIDER_NAMES[provider]} account. Try again in a few minutes.`, err);
  }
  // The token is gone. A mark left behind only runs out.
  await finishChange(deps, { orgId, appId, provider, changeId, connection: null })
    .catch((err) => log.error('console could not finish a disconnect', provider, err.message));
  const ended = previous.account?.accountId
    ? await revokeIfUnused(deps, provider, previous.account.accountId)
    : { revoked: false, shared: false };
  return { body: { ...reply, ...ended } };
}

/** The Owner's Eventbrite events, read with the stored token. */
async function readEventbriteEvents(deps, { orgId, appId, user }) {
  const { db, secrets } = deps;
  await requireOwner(db, orgId, user, ONLY_OWNER);
  const { data } = await readApplication((r) => r.get(), db, orgId, appId);
  await requireConnectable(deps, (r) => r.get(), { appId, data, provider: 'eventbrite' });
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
  // Read first: the check below refuses an event read from an earlier account.
  const accountId = accountsOf(await accountsRef(db, appId).get()).eventbrite?.accountId;
  const events = await readEventbriteEvents(deps, { orgId, appId, user });
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) throw new ConsoleError(400, 'bad-request', 'We could not find that event in your Eventbrite account.');
  const at = new Date(now());
  let reply = null;
  await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    await requireConnectable(deps, (r) => tx.get(r), { appId, data, provider: 'eventbrite' });
    const connection = liveConnection(data.connections, 'eventbrite');
    if (!connection) throw new ConsoleError(409, 'not-connected', 'Connect your Eventbrite account first.');
    const accounts = accountsOf(await tx.get(accountsRef(db, appId)));
    if (accounts.eventbrite?.accountId !== accountId) {
      throw new ConsoleError(409, 'account-changed', 'Your Eventbrite account changed. Choose your event again.');
    }
    const { organizationId, ...shown } = event;
    const connections = { ...data.connections, eventbrite: { ...connection, event: shown } };
    tx.update(ref, { connections, updatedAt: at, updatedBy: user.uid });
    tx.set(accountsRef(db, appId), { ...accounts, eventbrite: { ...accounts.eventbrite, eventOrganizationId: organizationId } });
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
 *   EVENT_STRIPE_ACCOUNT_ID, `connection.livemode` sets EVENT_STRIPE_MODE,
 *   `connection.event.id` is Eventbrite's EVENT_TICKETING_EVENT_ID, and
 *   `connection.eventOrganizationId` is the organization that holds that event.
 */
async function readStoredConnection({ db, secrets }, appId, provider) {
  const snap = await db.collection('applications').doc(appId).get();
  const connection = liveConnection(snap.exists ? snap.data().connections : null, provider);
  const account = accountsOf(await accountsRef(db, appId).get())[provider];
  if (!connection || !account) return null;
  const token = await secrets.readSecret(connectionSecretId(appId, provider));
  return token ? { token, connection: { ...connection, ...account } } : null;
}

/**
 * For the site builder, after it has moved the token to the event's project:
 * delete the console's copy. It does not revoke, because the token keeps
 * working on the client's site. The Firestore state stays, and its private
 * row is what tells a later disconnect elsewhere that the site still uses
 * the account, so never delete that row here. Safe to repeat.
 */
async function deleteStoredConnection({ secrets }, appId, provider) {
  await secrets.deleteSecret(connectionSecretId(appId, provider));
}

/**
 * Inside the transaction that deletes a request: read its private row. The
 * caller then calls recordTokenDeletion with the result, after its other reads.
 */
async function readConnectedAccounts(tx, db, appId) {
  const [row, pending] = await Promise.all([tx.get(accountsRef(db, appId)), tx.get(db.collection(DELETION_COLLECTION).doc(appId))]);
  const accounts = accountsOf(row);
  const connected = PROVIDERS.filter((provider) => accounts[provider]?.accountId)
    .map((provider) => ({ provider, accountId: accounts[provider].accountId }));
  // Closing moved its accounts to a deletion row, and a later delete must not lose them.
  return [...(pending.exists ? pending.data().connected || [] : []), ...connected];
}

/** The same transaction: leave a row, so its tokens are still found when the request is gone. */
function recordTokenDeletion(tx, db, appId, connected, at) {
  tx.set(db.collection(DELETION_COLLECTION).doc(appId), { connected, at });
}

/**
 * After that transaction: delete the tokens, end each connection nothing else
 * uses, then the row. A token that cannot be deleted throws and leaves the row
 * for the retention job. A failed revoke is logged. Safe to repeat.
 */
async function deleteRecordedTokens(deps, appId, connected) {
  for (const provider of PROVIDERS) await deps.secrets.deleteSecret(connectionSecretId(appId, provider));
  for (const { provider, accountId } of connected) await revokeIfUnused(deps, provider, accountId);
  await deps.db.collection(DELETION_COLLECTION).doc(appId).delete();
}

/** Try again for the rows an earlier delete left. Each failure is logged; the next run tries again. */
async function retryTokenDeletions(deps, batchSize) {
  const { db, log = console } = deps;
  try {
    const snap = await db.collection(DELETION_COLLECTION).limit(batchSize).get();
    for (const doc of snap.docs) {
      await deleteRecordedTokens(deps, doc.id, doc.data().connected || [])
        .catch((err) => log.error('console could not delete stored tokens', doc.id, err.message));
    }
  } catch (err) {
    log.error('console could not read the tokens left to delete', err.message);
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
  ACCOUNT_COLLECTION,
  DELETION_COLLECTION,
  STATE_COLLECTION,
  STATE_TTL_MS,
  chooseEventbriteEvent,
  completeConnection,
  connectionSecretId,
  deleteRecordedTokens,
  deleteStoredConnection,
  disconnectAccount,
  listEventbriteEvents,
  readConnectedAccounts,
  readStoredConnection,
  recordTokenDeletion,
  retryTokenDeletions,
  startConnection,
  sweepExpiredStates,
};
