'use strict';

/**
 * Private ticket-class policy contract (#555). This does not activate limited
 * access or approve an account. Claim/refund derivation and request/rules
 * enforcement use this contract in #556 and #557.
 *
 * A published revision applies to every current valid claimed contribution.
 * Publishing a later revision requires deliberate operator action and complete
 * recomputation; order descriptions and financial snapshots never change.
 * Existing server-verified admin, bootstrap staff/operator and speaker
 * exceptions remain independent. A class cannot create a role or bypass the
 * material embargo. Published content and released materials remain public.
 */

const { isTicketTypeId, MAX_TICKET_TYPES } = require('./ticketCommerce.cjs');

const TICKET_ACCESS_VERSION = 1;
const MAX_POLICY_BYTES = 128 * 1024;
const MAX_CLASS_MAPPINGS = 500;
const MAX_RESOURCE_REFS = 1000;
const TICKET_ACCESS_PROVIDERS = Object.freeze(['stripe', 'eventbrite', 'manual']);

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Opaque provider/event/resource IDs, never display labels or parsed names. */
function normalizeTicketClassId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  // eslint-disable-next-line no-control-regex
  return id && id.length <= 200 && !/[\u0000-\u001f\u007f/]/.test(id) && !['.', '..'].includes(id) ? id : null;
}

/** An absent historical ID stays unknown. Stripe already persists ticketTypeId. */
function ticketClassIdentity(ticket) {
  if (!plain(ticket) || !TICKET_ACCESS_PROVIDERS.includes(ticket.provider)) return null;
  const eventId = normalizeTicketClassId(ticket.eventId);
  const classId = normalizeTicketClassId(ticket.provider === 'stripe' ? ticket.ticketTypeId : ticket.ticketClassId);
  return eventId && classId ? { provider: ticket.provider, eventId, classId } : null;
}

/**
 * Validate an operator-owned policy against server-loaded canonical event data.
 * context is { provider, eventId, dayIds, sessionIds }; it is never browser input.
 * Returns the same {ok,value,issues} shape as the ticket catalog validator.
 */
function validateTicketAccessPolicy(input, context) {
  const issues = [];
  const problem = (path, message) => issues.push({ path, message });
  const exact = (value, keys, path) => {
    if (!plain(value)) { problem(path, 'Use an object.'); return false; }
    if (Object.keys(value).some((key) => !keys.includes(key))) problem(path, 'Contains unsupported fields.');
    return true;
  };
  const canonical = (ids, path) => {
    if (!Array.isArray(ids) || ids.some((id) => !normalizeTicketClassId(id) || normalizeTicketClassId(id) !== id) || new Set(ids).size !== ids.length) {
      problem(path, 'Provide unique canonical identifiers from the event.');
      return new Set();
    }
    return new Set(ids);
  };
  if (!plain(context) || !TICKET_ACCESS_PROVIDERS.includes(context.provider) ||
      !normalizeTicketClassId(context.eventId) || context.eventId !== context.eventId.trim()) {
    return { ok: false, value: null, issues: [{ path: 'context', message: 'A trusted provider and event scope are required.' }] };
  }
  const days = canonical(context.dayIds, 'context.dayIds');
  const sessions = canonical(context.sessionIds, 'context.sessionIds');
  if (!exact(input, ['schemaVersion', 'provider', 'eventId', 'revision', 'lifetime', 'classes', 'mappings'], 'policy')) {
    return { ok: false, value: null, issues };
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_POLICY_BYTES) {
      problem('policy', 'The policy exceeds its size limit.');
    }
  } catch {
    problem('policy', 'The policy must be JSON data.');
  }
  if (input.schemaVersion !== TICKET_ACCESS_VERSION) problem('schemaVersion', 'Unsupported ticket access version.');
  if (input.provider !== context.provider || input.eventId !== context.eventId) problem('policy', 'The policy must match the trusted provider and event.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) problem('revision', 'Use a positive policy revision.');
  if (input.lifetime !== 'current-policy') problem('lifetime', 'Use the current published policy revision.');

  const refs = (value, allowed, path) => {
    if (!Array.isArray(value) || value.length > MAX_RESOURCE_REFS) {
      problem(path, 'Provide a bounded list of canonical identifiers.');
      return [];
    }
    if (value.some((id) => typeof id !== 'string' || !allowed.has(id)) || new Set(value).size !== value.length) problem(path, 'Use unique identifiers from the canonical event.');
    return value.filter((id) => typeof id === 'string').sort();
  };
  const classes = [];
  const classIds = new Set();
  if (!Array.isArray(input.classes) || input.classes.length < 1 || input.classes.length > MAX_TICKET_TYPES) {
    problem('classes', `Provide between 1 and ${MAX_TICKET_TYPES} classes.`);
  } else {
    input.classes.forEach((entry, index) => {
      const path = `classes.${index}`;
      if (!exact(entry, ['id', 'resources'], path)) return;
      if (!isTicketTypeId(entry.id) || classIds.has(entry.id)) problem(`${path}.id`, 'Use a unique stable class ID.');
      classIds.add(entry.id);
      const grant = entry.resources;
      if (!exact(grant, ['sessions', 'directory', 'attendeeUpdates', 'interactions', 'protectedMaterials'], `${path}.resources`)) return;
      if (!exact(grant.sessions, ['all', 'dayIds', 'sessionIds'], `${path}.resources.sessions`)) return;
      if (typeof grant.sessions.all !== 'boolean') problem(`${path}.resources.sessions.all`, 'Use true or false.');
      const dayIds = refs(grant.sessions.dayIds, days, `${path}.resources.sessions.dayIds`);
      const sessionIds = refs(grant.sessions.sessionIds, sessions, `${path}.resources.sessions.sessionIds`);
      if (grant.sessions.all === true && (dayIds.length || sessionIds.length)) problem(`${path}.resources.sessions`, 'All sessions cannot also select individual resources.');
      for (const field of ['directory', 'attendeeUpdates', 'interactions']) {
        if (typeof grant[field] !== 'boolean') problem(`${path}.resources.${field}`, 'Use true or false.');
      }
      // There is no attendee early-material privilege in the current product.
      if (grant.protectedMaterials !== 'existing-embargo') problem(`${path}.resources.protectedMaterials`, 'Preserve the existing material embargo and public release.');
      classes.push({ id: entry.id, resources: {
        sessions: { all: grant.sessions.all, dayIds, sessionIds },
        directory: grant.directory, attendeeUpdates: grant.attendeeUpdates,
        interactions: grant.interactions, protectedMaterials: grant.protectedMaterials,
      } });
    });
  }

  const mappings = [];
  const sourceIds = new Set();
  if (!Array.isArray(input.mappings) || input.mappings.length > MAX_CLASS_MAPPINGS) {
    problem('mappings', 'Provide a bounded list of provider-class mappings.');
  } else {
    input.mappings.forEach((entry, index) => {
      const path = `mappings.${index}`;
      if (!exact(entry, ['sourceClassId', 'classId'], path)) return;
      if (!normalizeTicketClassId(entry.sourceClassId) || normalizeTicketClassId(entry.sourceClassId) !== entry.sourceClassId || sourceIds.has(entry.sourceClassId)) {
        problem(`${path}.sourceClassId`, 'Use a unique exact provider class ID.');
      }
      sourceIds.add(entry.sourceClassId);
      if (!classIds.has(entry.classId)) problem(`${path}.classId`, 'The mapped class must exist in this policy.');
      mappings.push({ sourceClassId: entry.sourceClassId, classId: entry.classId });
    });
  }
  const value = {
    schemaVersion: TICKET_ACCESS_VERSION, provider: input.provider, eventId: input.eventId,
    revision: input.revision, lifetime: input.lifetime, classes, mappings,
  };
  return { ok: issues.length === 0, value: issues.length ? null : value, issues };
}

/**
 * Resolve a class definition, not an attendee entitlement. #556 must first
 * select current valid claimed tickets and preserve admin approval/revocation.
 * Missing, malformed, unmapped or wrong-event identities return no contribution.
 */
function resolveTicketClassGrant(policy, ticket, context) {
  const checked = validateTicketAccessPolicy(policy, context);
  const identity = ticketClassIdentity(ticket);
  if (!checked.ok || !identity || identity.provider !== context.provider || identity.eventId !== context.eventId) return null;
  const mapping = checked.value.mappings.find((entry) => entry.sourceClassId === identity.classId);
  if (!mapping) return null;
  const selected = checked.value.classes.find((entry) => entry.id === mapping.classId);
  return { schemaVersion: TICKET_ACCESS_VERSION, policyRevision: checked.value.revision,
    classId: selected.id, resources: selected.resources };
}

module.exports = {
  TICKET_ACCESS_VERSION, MAX_POLICY_BYTES, MAX_CLASS_MAPPINGS, MAX_RESOURCE_REFS,
  TICKET_ACCESS_PROVIDERS, normalizeTicketClassId, ticketClassIdentity,
  validateTicketAccessPolicy, resolveTicketClassGrant,
};
