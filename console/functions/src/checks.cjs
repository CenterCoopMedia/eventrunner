'use strict';

/**
 * The checks on an application's answers (ADR 0007 §3), by field path.
 *
 * Principle 5 says the console and init-event.cjs run one validator. So
 * the answers are turned into the answers file init-event.cjs reads
 * (`toInitAnswers`), `config/event` is built from it with the shared
 * `buildEvent`, and the shared `validateEventConfig` checks it: the same
 * two calls `buildConfigDocs` makes for that document. Each error it
 * returns is put back on the console field it came from, in plain words.
 *
 * The console adds only what init-event.cjs leaves to a person: which
 * answers are required in the console, and length limits for the form.
 *
 * An error map is `{ 'event.days.0.date': 'Enter a real date.' }`. A path
 * starts with the step id, so a step's errors are the keys with its prefix.
 */

const { buildEvent } = require('shared/answers');
const { validateEventConfig } = require('shared/config');
const { isEmailAddress } = require('shared/email');
const { safeUrlHref } = require('shared/urlSafety');
const { MAX_DAYS, TICKET_CHOICES, withDefaults } = require('./answers.cjs');
const { siteNameProblem, siteAddress } = require('./siteNames.cjs');
const { connectionProblem } = require('./connectionState.cjs');

const SENDER_LOCAL_PART = 'hello';
// Used only to check the other steps while the web address is not chosen.
const PLACEHOLDER_NAME = 'your-event';

const LIMITS = Object.freeze({
  organizationName: [2, 100],
  address: [10, 300],
  eventName: [1, 120],
  shortName: [1, 40],
  tagline: [0, 160],
  dayLabel: [0, 40],
  venueName: [0, 120],
  venueAddress: [0, 300],
  senderName: [1, 80],
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A website as typed ("nclocal.org") as a full link, or '' when it is not one. */
function websiteHref(value) {
  if (!value) return '';
  return safeUrlHref(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
}

/** `hello@name.eventrunner.org`, the sender every new site starts with. */
function senderAddress(name) {
  return `${SENDER_LOCAL_PART}@${siteAddress(name)}`;
}

/**
 * The console answers as the answers file init-event.cjs reads. The
 * provisioner hands the frozen answers to init-event.cjs in this shape.
 */
function toInitAnswers(stored) {
  const answers = withDefaults(stored);
  const { organization, event, webAddress, email } = answers;
  const name = siteNameProblem(webAddress.name) ? PLACEHOLDER_NAME : webAddress.name;
  return {
    event: {
      name: event.name,
      shortName: event.shortName,
      tagline: event.tagline,
      timezone: event.timezone,
      days: event.days.map((day, i) => ({
        id: `day-${i + 1}`,
        label: day.label || `Day ${i + 1}`,
        date: day.date,
        startTime: day.startTime,
        endTime: day.endTime,
      })),
      venue: { name: event.venue.name, addressLine1: event.venue.address },
      sender: { email: senderAddress(name), name: email.senderName, replyTo: email.replyTo || null },
      legal: {
        operatorName: organization.name,
        postalAddressHtml: escapeHtml(organization.address).replace(/\r?\n/g, '<br>'),
        supportEmail: email.replyTo,
      },
      seo: { organizerName: organization.name, organizerUrl: websiteHref(organization.website) || null },
    },
  };
}

/** Where a shared validator error goes, and what it says to the client. */
function placeSharedError(message) {
  const field = message.split(':')[0];
  const day = field.match(/^days\[(\d+)\](?:\.(\w+))?$/);
  if (day) {
    const [, i, part] = day;
    if (part === 'date' && message.includes('ascending')) {
      return [`event.days.${i}.date`, 'Put the days in order, earliest first, with no date twice.'];
    }
    if (part === 'date') return [`event.days.${i}.date`, 'Enter a real date.'];
    if (part === 'startTime') return [`event.days.${i}.startTime`, 'Enter a start time.'];
    if (part === 'endTime') return [`event.days.${i}.endTime`, 'Enter an end time.'];
    return [`event.days.${i}.endTime`, 'The end time must be after the start time.'];
  }
  const places = {
    name: ['event.name', 'Enter the event name.'],
    shortName: ['event.shortName', 'Enter a short name.'],
    timezone: ['event.timezone', 'Choose a time zone.'],
    tagline: ['event.tagline', 'Check the description.'],
    'sender.email': ['webAddress.name', 'Choose a name for your web address.'],
    'sender.name': ['email.senderName', 'Enter a sender name.'],
    'sender.replyTo': ['email.replyTo', 'Enter a valid email address.'],
    'legal.supportEmail': ['email.replyTo', 'Enter a valid email address.'],
    'legal.operatorName': ['organization.name', 'Check the organization name.'],
    'legal.postalAddressHtml': ['organization.address', 'Check the mailing address.'],
    'seo.organizerUrl': ['organization.website', 'Enter a website address, for example https://example.org.'],
  };
  if (places[field]) return places[field];
  if (field.startsWith('venue')) return ['event.venue.name', 'Check the venue.'];
  return ['event', 'Check the answers on this step.'];
}

/** Add `message` at `path` unless that field already has an error. */
function add(errors, path, message) {
  if (!errors[path]) errors[path] = message;
}

function checkLength(errors, path, value, [min, max], emptyMessage) {
  if (value.length === 0 && min > 0) add(errors, path, emptyMessage);
  else if (value.length < min) add(errors, path, `Use at least ${min} characters.`);
  else if (value.length > max) add(errors, path, `Use ${max} characters or fewer.`);
}

function checkOrganization(errors, { organization }) {
  checkLength(errors, 'organization.name', organization.name, LIMITS.organizationName, 'Enter the organization name.');
  if (organization.website && !websiteHref(organization.website)) {
    add(errors, 'organization.website', 'Enter a website address, for example https://example.org.');
  }
  checkLength(errors, 'organization.address', organization.address, LIMITS.address,
    'Enter the mailing address. It goes at the foot of every email.');
}

function checkEvent(errors, { event }) {
  checkLength(errors, 'event.name', event.name, LIMITS.eventName, 'Enter the event name.');
  checkLength(errors, 'event.shortName', event.shortName, LIMITS.shortName, 'Enter a short name.');
  checkLength(errors, 'event.tagline', event.tagline, LIMITS.tagline, '');
  if (!event.timezone) add(errors, 'event.timezone', 'Choose a time zone.');
  if (event.days.length === 0) add(errors, 'event.days', 'Add at least one day.');
  if (event.days.length > MAX_DAYS) add(errors, 'event.days', `Add ${MAX_DAYS} days or fewer.`);
  event.days.forEach((day, i) => {
    if (day.label) checkLength(errors, `event.days.${i}.label`, day.label, LIMITS.dayLabel, '');
  });
  checkLength(errors, 'event.venue.name', event.venue.name, LIMITS.venueName, '');
  checkLength(errors, 'event.venue.address', event.venue.address, LIMITS.venueAddress, '');
}

function checkWebAddressAnswer(errors, { webAddress }) {
  if (!webAddress.name) {
    add(errors, 'webAddress.name', 'Choose a name for your web address.');
    return;
  }
  const problem = siteNameProblem(webAddress.name);
  if (problem) add(errors, 'webAddress.name', problem.message);
}

function checkTickets(errors, { tickets }, connections, testMode) {
  if (!TICKET_CHOICES.includes(tickets.choice)) {
    add(errors, 'tickets.choice', 'Choose how you sell tickets.');
    return;
  }
  const problem = connectionProblem(tickets.choice, connections, { testMode });
  if (problem) add(errors, problem.field, problem.message);
}

function checkEmail(errors, { email }) {
  checkLength(errors, 'email.senderName', email.senderName, LIMITS.senderName, 'Enter a sender name.');
  if (!email.replyTo) add(errors, 'email.replyTo', 'Enter the email address that gets replies.');
  else if (!isEmailAddress(email.replyTo)) add(errors, 'email.replyTo', 'Enter a valid email address.');
}

/**
 * Every check on every answer step.
 * @param {object} stored the answers
 * @param {object} [connections] the request's `connections`. Leaving it out
 *   means nothing is connected, so a ticket provider choice fails.
 * @param {{ testMode?: boolean }} [options] `testMode` lets a test-mode connection
 *   pass, for a console whose builds run in test mode (connectionProblem).
 * @returns {Record<string, string>} errors by field path; empty when all pass
 */
function checkAnswers(stored, connections, { testMode = false } = {}) {
  const answers = withDefaults(stored);
  const errors = {};
  checkOrganization(errors, answers);
  checkEvent(errors, answers);
  checkWebAddressAnswer(errors, answers);
  checkTickets(errors, answers, connections, testMode);
  checkEmail(errors, answers);
  // The shared rules last: a console message for a field wins over the
  // general one the shared error maps to.
  const verdict = validateEventConfig(buildEvent({ answers: toInitAnswers(answers), tierA: {} }));
  if (!verdict.ok) {
    for (const message of verdict.errors) {
      const [path, words] = placeSharedError(message);
      add(errors, path, words);
    }
  }
  return errors;
}

/** The errors of one step. */
function stepErrors(errors, step) {
  return Object.fromEntries(Object.entries(errors).filter(([path]) => path === step || path.startsWith(`${step}.`)));
}

module.exports = { checkAnswers, senderAddress, stepErrors, toInitAnswers };
