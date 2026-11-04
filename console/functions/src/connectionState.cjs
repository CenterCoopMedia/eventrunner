'use strict';

/**
 * What the console's database knows about a client's connected accounts
 * (ADR 0007 §4). Pure rules, with no provider or secret code, so the answer
 * checks can use them.
 *
 *   applications/{appId}.connections = {
 *     stripe?:     { connected: true, accountId, displayName, livemode, connectedAt, connectedBy },
 *     eventbrite?: { connected: true, accountId, displayName, connectedAt, connectedBy,
 *                    event: null | { id, name, start, organizationId } },
 *   }
 *
 * Only connection state lives here. The tokens are in the console's Secret
 * Manager, and connections.cjs is the only module that handles them.
 */

const { toIso } = require('./access.cjs');

const PROVIDERS = Object.freeze(['stripe', 'eventbrite']);
const PROVIDER_NAMES = Object.freeze({ stripe: 'Stripe', eventbrite: 'Eventbrite' });
// A client can change a connection until the site is being built (ADR 0007
// §4). `awaiting_payment` is the 2026-11-04 amendment's status. From
// `approved` on, the provisioner owns the tokens.
const CHANGEABLE = Object.freeze(['draft', 'awaiting_payment', 'submitted', 'changes_requested']);
const CLOSED_STATUSES = Object.freeze(['withdrawn', 'declined']);

/** @returns {object|null} the connection state of one provider, when it is connected */
function liveConnection(connections, provider) {
  const connection = connections && typeof connections === 'object' ? connections[provider] : null;
  return connection && connection.connected === true ? connection : null;
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
  connectionForReview,
  connectionProblem,
  connectionsForClient,
  liveConnection,
};
