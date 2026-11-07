'use strict';

/**
 * TEST-ONLY data for the application tests: a seeded organization and a
 * complete, valid set of answers. firebase.json leaves `src/testData.cjs`
 * out of the deploy.
 */

const { makeFakeDb } = require('./fakes.cjs');
const { agreementHash } = require('./consoleSettings.cjs');

const NOW = Date.parse('2026-11-04T15:00:00Z');
const ana = { uid: 'ana', email: 'ana@example.org' };
const ben = { uid: 'ben', email: 'ben@example.org' };
const cy = { uid: 'cy', email: 'cy@example.org' };
const ops = { uid: 'ops', email: 'ops@ccm.example' };
const zed = { uid: 'zed', email: 'zed@example.org' };

/** What a connected Stripe account looks like in `applications/{appId}.connections`. */
function stripeConnection(overrides = {}) {
  return {
    connected: true,
    displayName: 'NC Local',
    livemode: true,
    connectedAt: new Date(NOW - 2000),
    ...overrides,
  };
}

function validAnswers() {
  return {
    organization: { name: 'NC Local', website: 'nclocal.org', address: '1 Main Street\nRaleigh, NC 27601' },
    event: {
      name: 'NC Local News Summit',
      shortName: 'NC Local',
      tagline: 'Local news for North Carolina',
      timezone: 'America/New_York',
      days: [{ date: '2027-05-13', startTime: '09:00', endTime: '17:00' }],
      venue: { name: 'City Hall', address: '2 Main Street' },
    },
    webAddress: { name: 'nclocal' },
    tickets: { choice: 'stripe' },
    email: { senderName: 'NC Local', replyTo: 'ops@nclocal.org' },
  };
}

/** o1: Ana (Owner), Ben (Editor). o2: Cy (Owner). Ops is an operator. */
function seededDb(extra = {}) {
  return makeFakeDb({
    'console_config/operators': { emails: ['ops@ccm.example', 'Two@CCM.example'] },
    'organizations/o1': { name: 'NC Local' },
    'organizations/o1/members/ana': { uid: 'ana', email: 'ana@example.org', role: 'owner' },
    'organizations/o1/members/ben': { uid: 'ben', email: 'ben@example.org', role: 'editor' },
    'organizations/o2': { name: 'Org two' },
    'organizations/o2/members/cy': { uid: 'cy', email: 'cy@example.org', role: 'owner' },
    ...extra,
  });
}

/** An application document as a redeemed signup link writes it, with overrides. */
function applicationDoc(overrides = {}) {
  return {
    orgId: 'o1',
    status: 'draft',
    signupLinkId: 'paid-o1',
    answers: validAnswers(),
    frozen: null,
    createdBy: 'ana',
    createdAt: new Date(NOW - 1000),
    updatedAt: new Date(NOW - 1000),
    updatedBy: 'ana',
    submittedAt: null,
    submittedBy: null,
    history: [{ status: 'draft', at: new Date(NOW - 1000), by: 'ana', note: null }],
    review: null,
    connections: { stripe: stripeConnection() },
    ...overrides,
  };
}

function fakeMailer({ fail = false } = {}) {
  return {
    sent: [],
    async sendInvite(m) { if (fail) throw new Error('provider down'); this.sent.push({ kind: 'invite', ...m }); },
    async sendStatusChange(m) { if (fail) throw new Error('provider down'); this.sent.push({ kind: 'status', ...m }); },
    async sendOperatorNotice(m) { if (fail) throw new Error('provider down'); this.sent.push({ ...m, noticeKind: m.kind, kind: 'operator' }); },
    async sendAgreementCopy(m) { if (fail) throw new Error('provider down'); this.sent.push({ kind: 'agreement', ...m }); },
  };
}

const AGREEMENT_TEXT = { title: 'Test agreement', body: 'First test paragraph.\n\nSecond test paragraph.' };
const BUILD_SETTINGS = { gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1' };

/** The documents a signup needs, with obvious fakes. */
function signupTerms() {
  const { title, body } = AGREEMENT_TEXT;
  const record = { version: 1, title, body, sha256: agreementHash(title, body), savedAt: new Date(NOW - 5000), savedBy: 'ops' };
  return {
    'console_config/settings': BUILD_SETTINGS,
    'console_config/agreement': record,
    'console_config/agreement/versions/1': record,
  };
}

function quietLog() {
  return { errors: [], error(...args) { this.errors.push(args); } };
}

module.exports = { BUILD_SETTINGS, NOW, ana, applicationDoc, ben, cy, fakeMailer, ops, quietLog, seededDb, signupTerms, stripeConnection, validAnswers, zed };
