'use strict';

/**
 * TEST-ONLY data for the application tests: a seeded organization and a
 * complete, valid set of answers. firebase.json leaves `src/testData.cjs`
 * out of the deploy.
 */

const { makeFakeDb } = require('./fakes.cjs');

const NOW = Date.parse('2026-11-04T15:00:00Z');
const ana = { uid: 'ana', email: 'ana@example.org' };
const ben = { uid: 'ben', email: 'ben@example.org' };
const cy = { uid: 'cy', email: 'cy@example.org' };
const ops = { uid: 'ops', email: 'ops@ccm.example' };
const zed = { uid: 'zed', email: 'zed@example.org' };

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

/** An application document as createApplication writes it, with overrides. */
function applicationDoc(overrides = {}) {
  return {
    orgId: 'o1',
    status: 'draft',
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
    ...overrides,
  };
}

function fakeMailer({ fail = false } = {}) {
  return {
    sent: [],
    async sendInvite(m) { if (fail) throw new Error('provider down'); this.sent.push({ kind: 'invite', ...m }); },
    async sendStatusChange(m) { if (fail) throw new Error('provider down'); this.sent.push({ kind: 'status', ...m }); },
    async sendOperatorNotice(m) { if (fail) throw new Error('provider down'); this.sent.push({ kind: 'operator', ...m }); },
  };
}

function quietLog() {
  return { errors: [], error(...args) { this.errors.push(args); } };
}

module.exports = { NOW, ana, applicationDoc, ben, cy, fakeMailer, ops, quietLog, seededDb, validAnswers, zed };
