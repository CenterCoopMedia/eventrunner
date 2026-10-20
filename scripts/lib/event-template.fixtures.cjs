'use strict';

/**
 * Synthetic fixtures for the event template tests (issue #328): two event
 * projects, the answers for each, and one record of every kind a template
 * must leave behind. Shared by scripts/export-event-template.test.cjs (an
 * in-memory database) and tests/event-template.rules.test.js (the
 * emulator), so both prove the same thing. Project ids start with `demo-`
 * so the emulator needs no credentials.
 */

const { getTierA } = require('../../functions/src/core/config.cjs');

const SOURCE = 'demo-past-event';
const TARGET = 'demo-next-event';

/** A complete Tier A environment for one project. */
function ENV_FOR(projectId) {
  return {
    EVENT_SLUG: projectId,
    EVENT_FIREBASE_PROJECT_ID: projectId,
    EVENT_PUBLIC_URL: `https://${projectId}.example.test`,
    EVENT_STORAGE_BUCKET: `${projectId}-bucket`,
    EVENT_ALLOWED_ORIGINS: `https://${projectId}.example.test`,
    EVENT_EMAIL_PROVIDER: 'console',
    EVENT_TICKETING_PROVIDER: 'none',
    EVENT_OPERATOR_NOTIFIER: 'none',
    EVENT_HOSTING_SITE: projectId,
    VITE_FIREBASE_API_KEY: 'x',
    VITE_FIREBASE_AUTH_DOMAIN: 'x',
    VITE_FIREBASE_PROJECT_ID: projectId,
    VITE_FIREBASE_STORAGE_BUCKET: 'x',
    VITE_FIREBASE_MESSAGING_SENDER_ID: 'x',
    VITE_FIREBASE_APP_ID: 'x',
    VITE_FIREBASE_MEASUREMENT_ID: 'x',
    VITE_EVENT_PUBLIC_URL: `https://${projectId}.example.test`,
  };
}

function tierAFor(projectId) {
  return getTierA(ENV_FOR(projectId));
}

function day(date) {
  return { id: 'day-1', label: 'Day 1', date, startTime: '09:00', endTime: '17:00' };
}

function pastEventAnswers() {
  return {
    event: {
      name: 'Past Example Summit',
      shortName: 'PES',
      tagline: 'Local news, shared',
      timezone: 'UTC',
      days: [day('2026-06-04')],
      sender: { email: 'summit@example.test' },
      legal: { operatorName: 'Example Newsroom Network', supportEmail: 'help@example.test' },
    },
  };
}

function nextEventAnswers() {
  return {
    event: {
      name: 'Next Example Summit',
      shortName: 'NES',
      timezone: 'UTC',
      days: [day('2027-06-03')],
      sender: { email: 'summit@example.test' },
    },
    owner: { name: 'Next Owner', email: 'next-owner@example.test' },
  };
}

/** One document per record kind a template must never carry. */
function operationalRecords() {
  return {
    'users/attendee-1': { email: 'attendee@example.test', displayName: 'Attendee One' },
    'users_public/attendee-1': { displayName: 'Attendee One' },
    'tickets/ticket-1': { email: 'attendee@example.test', claimToken: 'tok_fixture' },
    'ticket_orders/order-1': { email: 'attendee@example.test', stripeAccountId: 'acct_fixture' },
    'ticket_sync_queue/order-1': { status: 'pending' },
    'session_pitches/pitch-1': { title: 'pitch-secret', submitterEmail: 'attendee@example.test' },
    'sent_emails/mail-1': { to: 'attendee@example.test', subject: 'sent-subject' },
    'admin_logs/log-1': { action: 'audit-entry', actor: 'past-ops@example.test' },
    'auth_rate_limits/limit-1': { count: 3 },
    'speakers/speaker-1': { name: 'Speaker One', email: 'speaker@example.test' },
    'cmsSchedule/session-1': { title: 'Past Session' },
    'invoices/inv_fixture0000000000000001': { number: 'INV-0001', status: 'paid', billTo: { name: 'Billed Sponsor' } },
    'invoice_counters/current': { lastNumber: 1 },
    'invoice_settings/current': { prefix: 'INV', paymentInstructions: 'bank-account-secret' },
  };
}

module.exports = { SOURCE, TARGET, ENV_FOR, tierAFor, pastEventAnswers, nextEventAnswers, operationalRecords };
