'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createEventbriteProvider } = require('./providers/eventbrite.cjs');
const { createManualProvider } = require('./providers/manual.cjs');
const { createNoneProvider } = require('./providers/none.cjs');
const {
  sendRegistrationPrompt,
  createOnUserRegistrationPromptCreated,
  internals: { buildContext, hasClaimedTicket },
} = require('./registrationPrompt.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-08-20T10:00:00.000Z');

function user(overrides = {}) {
  return {
    uid: 'uid-ada',
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    registrationStatus: 'pending',
    speakerId: null,
    ...overrides,
  };
}

function baseConfig(overrides = {}) {
  return {
    event: {
      name: 'Example Summit',
      registration: { externalUrl: null, closesAt: null },
      legal: { supportEmail: 'help@example.org' },
      sender: { email: 'summit@example.org', name: 'Example Summit' },
      ...overrides.event,
    },
    theme: { colors: {} },
    tierA: { publicUrl: 'https://summit.example.org' },
  };
}

/** Records every send() call; always reports success. */
function makeSendEmail(calls) {
  return async (message) => {
    calls.push(message);
    return { status: 'sent', providerMessageId: 'msg-1', retries: 0 };
  };
}

/** A minimal send() honoring onceKey the way email/send.cjs does (in-memory claims). */
function makeOnceKeyedSendEmail(calls, claims = new Set()) {
  return async (message) => {
    if (message.onceKey) {
      if (claims.has(message.onceKey)) {
        return { status: 'sent', providerMessageId: null, skipped: true, retries: 0 };
      }
      claims.add(message.onceKey);
    }
    calls.push(message);
    return { status: 'sent', providerMessageId: 'msg-1', retries: 0 };
  };
}

function eventbrite(getConfig) {
  return createEventbriteProvider({
    env: { TICKETING_API_TOKEN: 'tok', TICKETING_WEBHOOK_SECRET: 'sec' },
    getConfig,
  });
}

function manual(db, getConfig) {
  return createManualProvider({ db, getConfig });
}

function none() {
  return createNoneProvider({});
}

// ---------------------------------------------------------------------------
// buildContext / hasClaimedTicket
// ---------------------------------------------------------------------------

test('buildContext maps a user doc into RegistrationPromptContext (§3.5)', () => {
  const ctx = buildContext({
    uid: 'uid-1', userDoc: user({ speakerId: 'spk-1' }), hasClaimedTicket: true, trigger: 'account_created',
  });
  assert.deepEqual(ctx, {
    user: { uid: 'uid-1', email: 'ada@example.com', displayName: 'Ada Lovelace' },
    registrationStatus: 'pending',
    isSpeaker: true,
    hasClaimedTicket: true,
    trigger: 'account_created',
  });
});

test('hasClaimedTicket is true only when a ticket names this uid as claimedByUid', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': { claimedByUid: 'uid-ada', status: 'valid' } });
  assert.equal(await hasClaimedTicket({ db, uid: 'uid-ada' }), true);
  assert.equal(await hasClaimedTicket({ db, uid: 'uid-other' }), false);
});

// ---------------------------------------------------------------------------
// The §3.5 decision matrix: eventbrite / manual / none × new-user / claimed /
// speaker(entitled), trigger 'account_created'.
// ---------------------------------------------------------------------------

test('eventbrite: a brand-new signup gets ticket.get_ticket pointed at the configured checkout URL', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user() });
  const getConfig = async () => baseConfig({ event: { registration: { externalUrl: 'https://eventbrite.example/e/1' } } });
  const calls = [];
  const result = await sendRegistrationPrompt({
    db, provider: eventbrite(getConfig), sendEmail: makeSendEmail(calls), getConfig,
    uid: 'uid-ada', now: () => T0, log: QUIET,
  });
  assert.equal(result.sent, true);
  assert.equal(result.templateId, 'ticket.get_ticket');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].onceKey, 'get-ticket:uid-ada');
  assert.ok(calls[0].html.includes('https://eventbrite.example/e/1'));
  assert.ok(calls[0].html.includes('Get your ticket'));
});

test('manual: a brand-new signup with a client external URL gets ticket.get_ticket, action purchase', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user() });
  const getConfig = async () => baseConfig({ event: { registration: { externalUrl: 'https://client.example/register' } } });
  const calls = [];
  const result = await sendRegistrationPrompt({
    db, provider: manual(db, getConfig), sendEmail: makeSendEmail(calls), getConfig,
    uid: 'uid-ada', now: () => T0, log: QUIET,
  });
  assert.equal(result.sent, true);
  assert.ok(calls[0].html.includes('https://client.example/register'));
  assert.ok(calls[0].html.includes('Register for the event'));
});

test('manual: a brand-new signup with NO external URL gets the await_approval copy, no CTA button', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user() });
  const getConfig = async () => baseConfig();
  const calls = [];
  const result = await sendRegistrationPrompt({
    db, provider: manual(db, getConfig), sendEmail: makeSendEmail(calls), getConfig,
    uid: 'uid-ada', now: () => T0, log: QUIET,
  });
  assert.equal(result.sent, true);
  assert.ok(calls[0].html.includes('An organizer will confirm your registration.'));
  // §6.2: the CTA button is OMITTED, not rendered with an empty href.
  assert.ok(!calls[0].html.includes('display:inline-block'));
});

test('none: a brand-new signup gets nothing at all — send: false suppresses the message', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user() });
  const getConfig = async () => baseConfig();
  const calls = [];
  const result = await sendRegistrationPrompt({
    db, provider: none(), sendEmail: makeSendEmail(calls), getConfig,
    uid: 'uid-ada', now: () => T0, log: QUIET,
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'suppressed');
  assert.equal(calls.length, 0);
});

for (const [label, makeProvider] of [
  ['eventbrite', (db, getConfig) => eventbrite(getConfig)],
  ['manual', (db, getConfig) => manual(db, getConfig)],
  ['none', () => none()],
]) {
  test(`${label}: a speaker never gets a registration prompt, whatever the provider (§3.5 universal skip)`, async () => {
    const db = makeFakeDb({ 'users/uid-ada': user({ speakerId: 'spk-1' }) });
    const getConfig = async () => baseConfig({ event: { registration: { externalUrl: 'https://example.org/x' } } });
    const calls = [];
    const result = await sendRegistrationPrompt({
      db, provider: makeProvider(db, getConfig), sendEmail: makeSendEmail(calls), getConfig,
      uid: 'uid-ada', now: () => T0, log: QUIET,
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'suppressed');
    assert.equal(calls.length, 0);
  });

  test(`${label}: an account that already claimed a ticket never gets a registration prompt (§3.5 universal skip)`, async () => {
    const db = makeFakeDb({
      'users/uid-ada': user(),
      'tickets/tkt-1': { claimedByUid: 'uid-ada', status: 'valid' },
    });
    const getConfig = async () => baseConfig({ event: { registration: { externalUrl: 'https://example.org/x' } } });
    const calls = [];
    const result = await sendRegistrationPrompt({
      db, provider: makeProvider(db, getConfig), sendEmail: makeSendEmail(calls), getConfig,
      uid: 'uid-ada', now: () => T0, log: QUIET,
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'suppressed');
    assert.equal(calls.length, 0);
  });
}

// ---------------------------------------------------------------------------
// onceKey: exactly one send per uid, even across repeat trigger deliveries.
// ---------------------------------------------------------------------------

test('a repeat delivery of the same trigger sends at most once (onceKey get-ticket:{uid})', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user() });
  const getConfig = async () => baseConfig({ event: { registration: { externalUrl: 'https://example.org/x' } } });
  const calls = [];
  const sendEmail = makeOnceKeyedSendEmail(calls);

  const first = await sendRegistrationPrompt({
    db, provider: manual(db, getConfig), sendEmail, getConfig, uid: 'uid-ada', now: () => T0, log: QUIET,
  });
  const second = await sendRegistrationPrompt({
    db, provider: manual(db, getConfig), sendEmail, getConfig, uid: 'uid-ada', now: () => T0, log: QUIET,
  });

  assert.equal(first.sent, true);
  assert.equal(first.reason, 'sent');
  assert.equal(second.sent, true);
  assert.equal(second.reason, 'already-sent');
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Edge cases the trigger itself must survive without throwing.
// ---------------------------------------------------------------------------

test('no user document (deleted before the trigger ran) is a no-op, not a throw', async () => {
  const db = makeFakeDb({});
  const getConfig = async () => baseConfig();
  const calls = [];
  const result = await sendRegistrationPrompt({
    db, provider: none(), sendEmail: makeSendEmail(calls), getConfig, uid: 'uid-ghost', now: () => T0, log: QUIET,
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no-user');
});

test('a user document with no email address is a no-op, not a throw', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user({ email: null }) });
  const getConfig = async () => baseConfig({ event: { registration: { externalUrl: 'https://example.org/x' } } });
  const calls = [];
  const result = await sendRegistrationPrompt({
    db, provider: manual(db, getConfig), sendEmail: makeSendEmail(calls), getConfig,
    uid: 'uid-ada', now: () => T0, log: QUIET,
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no-email');
});

test('a send failure is reported, not swallowed', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user() });
  const getConfig = async () => baseConfig({ event: { registration: { externalUrl: 'https://example.org/x' } } });
  const failingSend = async () => ({ status: 'failed', providerMessageId: null, error: 'boom', retries: 2 });
  const result = await sendRegistrationPrompt({
    db, provider: manual(db, getConfig), sendEmail: failingSend, getConfig, uid: 'uid-ada', now: () => T0, log: QUIET,
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'send-failed');
});

// ---------------------------------------------------------------------------
// createOnUserRegistrationPromptCreated: the trigger core.
// ---------------------------------------------------------------------------

test('createOnUserRegistrationPromptCreated wires the account_created trigger through to a send', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user() });
  const getConfig = async () => baseConfig({ event: { registration: { externalUrl: 'https://example.org/x' } } });
  const calls = [];
  const handler = createOnUserRegistrationPromptCreated({
    db, provider: manual(db, getConfig), sendEmail: makeSendEmail(calls), getConfig, now: () => T0, log: QUIET,
  });
  const result = await handler({ uid: 'uid-ada' });
  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
});
