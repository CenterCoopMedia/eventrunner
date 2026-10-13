'use strict';

/** Ticket commerce values shared by the catalog editor and server pricing. */
const MAX_TICKET_TYPES = 20;
const MAX_ORDER_SEATS = 20;
const MAX_CAPACITY = 1000000;
const MAX_AMOUNT = 99999999;
// The first release deliberately supports currencies with two minor-unit digits.
// Adding a zero-decimal currency requires an explicit display and payment test.
const CURRENCY_EXPONENTS = Object.freeze({ usd: 2, cad: 2, eur: 2, gbp: 2, aud: 2, nzd: 2 });
const CURRENCY_MINIMUMS = Object.freeze({ usd: 50, cad: 50, eur: 50, gbp: 30, aud: 50, nzd: 50 });
const TAX_TREATMENTS = Object.freeze(['inclusive', 'not_collected']);
const TYPE_ID = /^[a-z][a-z0-9_-]{0,47}$/;
const REQUEST_ID = /^[a-zA-Z0-9_-]{16,100}$/;
const ORDER_ID = /^ord_[a-f0-9]{40}$/;
const RESERVED_IDS = new Set(['constructor', 'prototype', '__proto__']);

function isTicketTypeId(value) {
  return typeof value === 'string' && TYPE_ID.test(value) && !RESERVED_IDS.has(value);
}

function isCommerceRequestId(value) {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

function isCommerceOrderId(value) {
  return typeof value === 'string' && ORDER_ID.test(value);
}

function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function text(value, max, required = false) {
  if (typeof value !== 'string') return required ? null : '';
  const clean = value.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) return null;
  return clean.length <= max && (!required || clean.length > 0) ? clean : null;
}

function isoTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function validateTicketCatalog(input) {
  const issues = [];
  const problem = (path, message) => issues.push({ path, message });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, value: null, issues: [{ path: 'catalog', message: 'A ticket catalog is required.' }] };
  }
  const value = {
    schemaVersion: 1,
    revision: input.revision ?? 0,
    published: input.published ?? false,
    salesPaused: input.salesPaused ?? false,
    commercialTermsConfirmed: input.commercialTermsConfirmed ?? false,
    currency: typeof input.currency === 'string' ? input.currency.toLowerCase().trim() : '',
    capacity: input.capacity,
    maxPerOrder: input.maxPerOrder ?? MAX_ORDER_SEATS,
    refundPolicy: text(input.refundPolicy, 2000),
    taxTreatment: input.taxTreatment,
    salesStartAt: isoTime(input.salesStartAt),
    salesEndAt: isoTime(input.salesEndAt),
    ticketTypes: [],
  };
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) problem('schemaVersion', 'Unsupported catalog version.');
  if (!integer(value.revision, 0, Number.MAX_SAFE_INTEGER)) problem('revision', 'Revision must be a nonnegative integer.');
  for (const field of ['published', 'salesPaused', 'commercialTermsConfirmed']) {
    if (typeof value[field] !== 'boolean') problem(field, 'Use true or false.');
  }
  if (!Object.hasOwn(CURRENCY_EXPONENTS, value.currency)) problem('currency', 'Choose USD, CAD, EUR, GBP, AUD, or NZD.');
  if (!integer(value.capacity, 1, MAX_CAPACITY)) problem('capacity', `Event capacity must be between 1 and ${MAX_CAPACITY}.`);
  if (!integer(value.maxPerOrder, 1, MAX_ORDER_SEATS)) problem('maxPerOrder', `Allow between 1 and ${MAX_ORDER_SEATS} seats per order.`);
  if (value.refundPolicy === null) problem('refundPolicy', 'Refund policy must be text of at most 2,000 characters.');
  if (!TAX_TREATMENTS.includes(value.taxTreatment)) problem('taxTreatment', 'Choose inclusive or not_collected.');
  if (value.published && !value.commercialTermsConfirmed) problem('commercialTermsConfirmed', 'Confirm the organizer’s commercial terms before publishing.');
  if (value.published && !value.refundPolicy) problem('refundPolicy', 'State a refund policy before publishing.');
  function windowCheck(object, path) {
    for (const field of ['salesStartAt', 'salesEndAt']) {
      if (object[field] === undefined) problem(`${path}${field}`, 'Use an ISO date and time with a timezone.');
    }
    if (object.salesStartAt && object.salesEndAt && object.salesStartAt >= object.salesEndAt) {
      problem(`${path}salesEndAt`, 'Sales must end after they start.');
    }
  }
  windowCheck(value, '');
  if (!Array.isArray(input.ticketTypes) || input.ticketTypes.length < 1 || input.ticketTypes.length > MAX_TICKET_TYPES) {
    problem('ticketTypes', `Provide between 1 and ${MAX_TICKET_TYPES} ticket types.`);
  } else {
    const seen = new Set();
    for (const [i, source] of input.ticketTypes.entries()) {
      const path = `ticketTypes.${i}.`;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        problem(`ticketTypes.${i}`, 'A ticket type must be an object.');
        continue;
      }
      const type = {
        id: source.id,
        name: text(source.name, 120, true),
        description: text(source.description, 1000),
        unitAmount: source.unitAmount,
        capacity: source.capacity,
        active: source.active ?? true,
        visibility: source.visibility ?? 'public',
        minPerOrder: source.minPerOrder ?? 1,
        maxPerOrder: source.maxPerOrder ?? value.maxPerOrder,
        salesStartAt: isoTime(source.salesStartAt),
        salesEndAt: isoTime(source.salesEndAt),
      };
      if (!isTicketTypeId(type.id) || seen.has(type.id)) problem(`${path}id`, 'Use a unique lowercase ID with letters, numbers, hyphens, or underscores.');
      seen.add(type.id);
      if (!type.name) problem(`${path}name`, 'A ticket name of at most 120 characters is required.');
      if (type.description === null) problem(`${path}description`, 'Use text of at most 1,000 characters.');
      if (!integer(type.unitAmount, 0, MAX_AMOUNT)) problem(`${path}unitAmount`, 'Use an integer price in minor currency units; zero is free.');
      if (!integer(type.capacity, 1, MAX_CAPACITY)) problem(`${path}capacity`, 'Use a positive ticket capacity.');
      if (typeof type.active !== 'boolean') problem(`${path}active`, 'Use true or false.');
      if (!['public', 'hidden'].includes(type.visibility)) problem(`${path}visibility`, 'Choose public or hidden.');
      if (!integer(type.minPerOrder, 1, MAX_ORDER_SEATS)) problem(`${path}minPerOrder`, 'Use a positive minimum quantity.');
      if (!integer(type.maxPerOrder, type.minPerOrder, value.maxPerOrder)) problem(`${path}maxPerOrder`, 'The maximum must fit the minimum and the event’s per-order limit.');
      windowCheck(type, path);
      value.ticketTypes.push(type);
    }
  }
  return { ok: issues.length === 0, value: issues.length ? null : value, issues };
}

function normalizeAttendee(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !['firstName', 'lastName', 'email'].includes(key))) return null;
  const firstName = text(input.firstName, 100, true);
  const lastName = text(input.lastName, 100);
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!firstName || lastName === null || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { firstName, lastName, email };
}

/** Client input contains catalog acceptance, intent, and assignments. Prices and grants are rejected. */
function validateCheckoutRequest(input) {
  const issue = (message) => ({ ok: false, value: null, issues: [{ path: 'checkout', message }] });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return issue('A checkout request is required.');
  if (Object.keys(input).some((key) => !['requestId', 'orderId', 'lines', 'resume', 'catalogRevision'].includes(key))) return issue('Checkout accepts catalog acceptance, ticket selections, and attendee assignments only.');
  if (input.resume === true) {
    if (input.lines !== undefined || Object.hasOwn(input, 'catalogRevision')) return issue('Resume uses the saved ticket selections and accepted terms.');
    if (!Object.hasOwn(input, 'requestId') && isCommerceOrderId(input.orderId)) {
      return { ok: true, value: { orderId: input.orderId, resume: true }, issues: [] };
    }
    if (!Object.hasOwn(input, 'orderId') && isCommerceRequestId(input.requestId)) {
      return { ok: true, value: { requestId: input.requestId, resume: true }, issues: [] };
    }
    return issue('Resume requires one valid order ID or request ID.');
  }
  if (input.resume !== undefined && input.resume !== false) return issue('Invalid resume value.');
  if (Object.hasOwn(input, 'orderId')) return issue('An order ID can only resume a saved order.');
  if (!isCommerceRequestId(input.requestId)) return issue('A valid request ID is required.');
  // Trusted comp creation and old durable requests have no accepted revision.
  // The reservation transaction requires it only for a new public order.
  const hasRevision = Object.hasOwn(input, 'catalogRevision');
  if (hasRevision && !integer(input.catalogRevision, 0, Number.MAX_SAFE_INTEGER)) return issue('Review the current ticket prices and terms before starting this order.');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_TICKET_TYPES) return issue('Choose at least one ticket type.');
  const seen = new Set();
  const lines = [];
  let seatCount = 0;
  for (const line of input.lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)
        || Object.keys(line).some((key) => !['ticketTypeId', 'quantity', 'attendees'].includes(key))) return issue('A ticket selection contains unsupported fields.');
    if (!isTicketTypeId(line.ticketTypeId) || seen.has(line.ticketTypeId)) return issue('Select each ticket type only once.');
    if (!integer(line.quantity, 1, MAX_ORDER_SEATS)) return issue('Choose a whole-number ticket quantity.');
    if (!Array.isArray(line.attendees) || line.attendees.length !== line.quantity) return issue('Assign a name and email to every ticket.');
    const attendees = line.attendees.map(normalizeAttendee);
    if (attendees.some((person) => !person)) return issue('Every ticket needs a valid attendee name and email.');
    seatCount += line.quantity;
    seen.add(line.ticketTypeId);
    lines.push({ ticketTypeId: line.ticketTypeId, quantity: line.quantity, attendees });
  }
  if (seatCount > MAX_ORDER_SEATS) return issue(`An order can contain at most ${MAX_ORDER_SEATS} tickets.`);
  lines.sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));
  return { ok: true, value: { requestId: input.requestId, lines, ...(hasRevision ? { catalogRevision: input.catalogRevision } : {}) }, issues: [] };
}

function isSalesWindowOpen(object, at = new Date()) {
  const ms = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(ms)) return false;
  return (!object.salesStartAt || Date.parse(object.salesStartAt) <= ms)
    && (!object.salesEndAt || Date.parse(object.salesEndAt) > ms);
}

module.exports = {
  MAX_TICKET_TYPES, MAX_ORDER_SEATS, MAX_CAPACITY, MAX_AMOUNT,
  CURRENCY_EXPONENTS, CURRENCY_MINIMUMS, TAX_TREATMENTS,
  isTicketTypeId, isCommerceRequestId, isCommerceOrderId, normalizeAttendee,
  validateTicketCatalog, validateCheckoutRequest, isSalesWindowOpen,
};
