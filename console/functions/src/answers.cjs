'use strict';

/**
 * The shape of an application's answers (ADR 0007 §3), and how one step's
 * answers from the browser become that shape.
 *
 *   answers = {
 *     organization: { name, website, address },
 *     event: { name, shortName, tagline, timezone,
 *              days: [{ date, startTime, endTime, label? }],
 *              venue: { name, address } },
 *     webAddress: { name },
 *     tickets: { choice: 'stripe'|'eventbrite'|'spreadsheet'|'none'|null },
 *     email: { senderName, replyTo },
 *   }
 *
 * The team step has no answers: it uses the organization's members and
 * invites. Cleaning keeps only known keys, makes every value the right
 * type, and caps text so one document stays small. It does not cut the
 * list of days: saveApplicationStep refuses more than MAX_DAYS. It does
 * not decide what is valid: checks.cjs does that, with the shared rules.
 */

const ANSWER_STEPS = Object.freeze(['organization', 'event', 'webAddress', 'tickets', 'email']);
const TICKET_CHOICES = Object.freeze(['stripe', 'eventbrite', 'spreadsheet', 'none']);
const MAX_DAYS = 14;
// A hard cap on stored text, above every limit checks.cjs reports, so a
// reader sees "too long" and the text they typed is not cut.
const STORE_MAX = 1000;

const text = (value) => (typeof value === 'string' ? value.trim().slice(0, STORE_MAX) : '');
const plain = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

/** A new application's answers. */
function emptyAnswers({ organizationName = '', timezone = '' } = {}) {
  return {
    organization: { name: organizationName, website: '', address: '' },
    event: { name: '', shortName: '', tagline: '', timezone, days: [], venue: { name: '', address: '' } },
    webAddress: { name: '' },
    tickets: { choice: null },
    email: { senderName: '', replyTo: '' },
  };
}

function cleanDay(raw) {
  const day = plain(raw);
  const clean = { date: text(day.date), startTime: text(day.startTime), endTime: text(day.endTime) };
  const label = text(day.label);
  if (label) clean.label = label;
  return clean;
}

const CLEANERS = Object.freeze({
  organization: (raw) => ({ name: text(raw.name), website: text(raw.website), address: text(raw.address) }),
  event: (raw) => ({
    name: text(raw.name),
    shortName: text(raw.shortName),
    tagline: text(raw.tagline),
    timezone: text(raw.timezone),
    days: (Array.isArray(raw.days) ? raw.days : []).map(cleanDay),
    venue: { name: text(plain(raw.venue).name), address: text(plain(raw.venue).address) },
  }),
  webAddress: (raw) => ({ name: text(raw.name).toLowerCase() }),
  tickets: (raw) => ({ choice: TICKET_CHOICES.includes(raw.choice) ? raw.choice : null }),
  email: (raw) => ({ senderName: text(raw.senderName), replyTo: text(raw.replyTo).toLowerCase() }),
});

/**
 * @param {string} step one of ANSWER_STEPS
 * @param {*} raw the step's answers from the browser
 * @returns {object} the cleaned answers of that step
 */
function cleanStep(step, raw) {
  const cleaner = CLEANERS[step];
  if (!cleaner) throw new TypeError(`cleanStep: unknown step ${step}`);
  return cleaner(plain(raw));
}

/** Stored answers, completed with empty values for any missing part. */
function withDefaults(answers) {
  const base = emptyAnswers();
  const stored = plain(answers);
  return Object.fromEntries(ANSWER_STEPS.map((step) => [step, stored[step] ? cleanStep(step, stored[step]) : base[step]]));
}

module.exports = { ANSWER_STEPS, MAX_DAYS, TICKET_CHOICES, cleanStep, emptyAnswers, withDefaults };
