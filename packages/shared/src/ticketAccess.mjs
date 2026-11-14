import ticketAccess from './ticketAccess.cjs';

export const {
  TICKET_ACCESS_VERSION, MAX_POLICY_BYTES, MAX_CLASS_MAPPINGS, MAX_RESOURCE_REFS,
  TICKET_ACCESS_PROVIDERS, normalizeTicketClassId, ticketClassIdentity,
  validateTicketAccessPolicy, resolveTicketClassGrant,
} = ticketAccess;
