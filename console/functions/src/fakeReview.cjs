'use strict';

/**
 * TEST-ONLY seed and fake mailer for the operator review tests. It
 * follows the shared contract for `applications/{appId}` (ADR 0007 §5).
 * firebase.json leaves `src/fake*.cjs` out of the deploy.
 */

const { makeFakeDb, makeFakeSecrets } = require('./fakes.cjs');

const NOW = Date.parse('2026-11-04T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ops = { uid: 'ops', email: 'ops@ccm.example' };
const ops2 = { uid: 'ops2', email: 'ops2@ccm.example' };
const ana = { uid: 'ana', email: 'ana@example.org' };
const PUBLIC_URL = 'https://console.eventrunner.org';

function answers(overrides = {}) {
  return {
    organization: { name: 'NC Local', website: 'https://nclocal.example', address: '1 Main St, Newark, NJ' },
    event: {
      name: 'NC Local Summit',
      shortName: 'NCL Summit',
      tagline: 'A day for local news',
      timezone: 'America/New_York',
      days: [{ date: '2027-03-04', startTime: '09:00', endTime: '17:00', label: 'Day one' }],
      venue: { name: 'Hall A', address: '2 Main St, Newark, NJ' },
    },
    webAddress: { name: 'nclocal' },
    tickets: { choice: 'stripe' },
    email: { senderName: 'NC Local', replyTo: 'hello@nclocal.example' },
    ...overrides,
  };
}

/** One application in the contract's shape. */
function application(overrides = {}) {
  const frozen = answers();
  return {
    orgId: 'o1',
    status: 'submitted',
    answers: frozen,
    frozen,
    createdBy: 'ana',
    createdAt: new Date(NOW - 3 * DAY),
    updatedAt: new Date(NOW - DAY),
    updatedBy: 'ana',
    submittedAt: new Date(NOW - DAY),
    submittedBy: 'ana',
    history: [
      { status: 'draft', at: new Date(NOW - 3 * DAY), by: 'ana', note: null },
      { status: 'submitted', at: new Date(NOW - DAY), by: 'ana', note: null },
    ],
    review: null,
    connections: { stripe: { connected: true, displayName: 'NC Local', livemode: true } },
    ...overrides,
  };
}

function seeded(extra = {}) {
  return makeFakeDb({
    'console_config/operators': { emails: ['ops@ccm.example', 'ops2@ccm.example'] },
    'console_config/settings': { gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1' },
    'organizations/o1': { name: 'NC Local' },
    'organizations/o1/members/ana': { uid: 'ana', email: 'ana@example.org', role: 'owner' },
    'organizations/o1/members/bo': { uid: 'bo', email: 'bo@example.org', role: 'owner' },
    'organizations/o1/members/ben': { uid: 'ben', email: 'ben@example.org', role: 'editor' },
    'applications/a1': application(),
    'site_names/nclocal': { appId: 'a1', orgId: 'o1', reservedAt: new Date(NOW - 3 * DAY) },
    ...extra,
  });
}

/** Records each status email. With `fail`, every send rejects. */
function fakeMailer({ fail = false } = {}) {
  return {
    sent: [],
    async sendInvite(message) {
      if (fail) throw new Error('provider down');
      this.sent.push({ kind: 'invite', ...message });
    },
    async sendStatusChange(message) {
      if (fail) throw new Error('provider down');
      this.sent.push(message);
    },
  };
}

const QUIET = { info() {}, error() {} };

function deps(db, extra = {}) {
  return { db, mailer: fakeMailer(), secrets: makeFakeSecrets(), now: () => NOW, publicUrl: PUBLIC_URL, log: QUIET, ...extra };
}

module.exports = { DAY, NOW, PUBLIC_URL, QUIET, ana, answers, application, deps, fakeMailer, ops, ops2, seeded };
