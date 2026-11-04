'use strict';

/**
 * What the console's database knows about a client's connected accounts
 * (ADR 0007 §4). Pure rules, with no provider or secret code, so the answer
 * checks can use them.
 *
 *   applications/{appId}.connections = {
 *     stripe?:     { connected: true, displayName, livemode, connectedAt },
 *     eventbrite?: { connected: true, displayName, connectedAt, event: null | { id, name, start } },
 *   }
 *
 * Any member of the organization can read that document directly, so it holds
 * only what a member may see. Account ids are in `console_connections`, which
 * no browser can read, and tokens are in the console's Secret Manager.
 * connections.cjs is the only module that handles either.
 *
 * While a call changes a provider's token, that provider holds
 * { connected: false, change: { id, until } }. It is not live, so every check
 * on a connection refuses it until the token and this state agree.
 */

const { toIso, toMillis } = require('./access.cjs');

const PROVIDERS = Object.freeze(['stripe', 'eventbrite']);
const PROVIDER_NAMES = Object.freeze({ stripe: 'Stripe', eventbrite: 'Eventbrite' });
// A client can change a connection until the request can be paid for (ADR 0007
// §4, amendment 2026-11-04). The fee webhook approves with no further check,
// so `awaiting_payment` is locked, and an Owner reopens the request to change
// the account. From `approved` on, the provisioner owns the tokens.
const CHANGEABLE = Object.freeze(['draft', 'submitted', 'changes_requested']);
const CLOSED_STATUSES = Object.freeze(['withdrawn', 'declined']);

/** @returns {object|null} the connection state of one provider, when it is connected */
function liveConnection(connections, provider) {
  const connection = connections && typeof connections === 'object' ? connections[provider] : null;
  return connection && connection.connected === true ? connection : null;
}

/** True while a call may still be changing a token of one of `providers`. */
function connectionChanging(connections, at, providers = PROVIDERS) {
  return providers.some((provider) => toMillis(connections?.[provider]?.change?.until) > at);
}

/**
 * Why the ticket choice cannot go ahead yet. A missing `connections` counts
 * as not connected, so a caller that forgets to pass it refuses the request.
 *
 * @returns {{ field: string, message: string }|null}
 */
function connectionProblem(choice, connections) {
  if (!PROVIDERS.includes(choice)) return null;
  const connection = liveConnection(connections, choice);
  if (!connection) return { field: 'tickets.connection', message: `Connect your ${PROVIDER_NAMES[choice]} account.` };
  if (choice === 'eventbrite' && !connection.event?.id) {
    return { field: 'tickets.event', message: 'Choose your Eventbrite event.' };
  }
  return null;
}

/**
 * What the browser gets. `available` says which providers the console has
 * set up. An Owner can also disconnect a closed request's account, rather
 * than wait for it to be deleted.
 */
function connectionsForClient(connections, { available = {}, status, role } = {}) {
  const owner = role === 'owner';
  const canChange = owner && CHANGEABLE.includes(status);
  const one = (provider) => {
    const connection = liveConnection(connections, provider);
    return {
      available: available[provider] === true,
      connected: Boolean(connection),
      displayName: connection?.displayName || null,
      connectedAt: toIso(connection?.connectedAt),
    };
  };
  const event = liveConnection(connections, 'eventbrite')?.event;
  return {
    canChange,
    canDisconnect: canChange || (owner && CLOSED_STATUSES.includes(status)),
    stripe: one('stripe'),
    eventbrite: { ...one('eventbrite'), event: event ? { id: event.id, name: event.name, start: event.start || null } : null },
  };
}

/** The operator's line on the review page. */
function connectionForReview(choice, connections) {
  if (!PROVIDERS.includes(choice)) return { state: 'none', label: 'No account to connect' };
  const connection = liveConnection(connections, choice);
  if (!connection) return { state: 'not_connected', label: 'Not connected yet' };
  const parts = [`Connected: ${connection.displayName || PROVIDER_NAMES[choice]}`];
  if (connection.livemode === false) parts.push('(test mode)');
  if (choice === 'eventbrite') parts.push(connection.event?.name ? `Event: ${connection.event.name}` : 'No event chosen yet');
  return { state: 'connected', label: parts.join(' ') };
}

module.exports = {
  CHANGEABLE,
  PROVIDERS,
  PROVIDER_NAMES,
  connectionChanging,
  connectionForReview,
  connectionProblem,
  connectionsForClient,
  liveConnection,
};
