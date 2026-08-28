'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createInspectPublishQueueHandler,
  internals,
} = require('./webMcpDiagnostics.cjs');

function config() {
  return {
    event: {
      legal: { reviewRequired: false },
      sender: {
        email: 'private@example.org',
        domainVerified: true,
        domainVerifiedAt: '2026-08-28T00:00:00Z',
      },
      auth: {
        googleProviderEnabled: true,
        authorizedDomainsConfigured: true,
      },
    },
    providers: {
      ticketing: {
        provider: 'manual',
        externalEventId: 'private-event',
        webhookId: 'private-hook',
      },
    },
    theme: { placeholderLogos: [] },
    bootstrap: { adminEmails: ['admin@example.org', 'backup@example.org'] },
  };
}

function seed() {
  const rows = {
    'cmsContent/hero': { seeded: false, image: 'media/used.png' },
    'cmsPages_drafts/home': {
      label: '',
      path: '/',
      icon: null,
      order: 0,
      visible: true,
      systemPage: true,
      sections: [],
    },
    'media_assets/used': { path: 'media/used.png' },
    'media_assets/unused': { path: 'media/unused.png' },
    'media_assets/malformed': { size: 10 },
    'ticket_sync_queue/pending': { status: 'pending', readyAt: new Date(1000) },
    'ticket_webhook_deliveries/latest': { receivedAt: new Date(2000), attendeeEmail: 'private@example.org' },
  };
  for (let index = 0; index < 12; index += 1) {
    rows[`cmsPublishQueue/queue-${index}`] = {
      status: index % 2 ? 'done' : 'failed',
      requestedAt: new Date(index * 1000),
      updatedAt: new Date(index * 1000),
      requestedBy: 'private@example.org',
      error: { token: 'private-token' },
      request: { cmsPages: ['home'] },
      progress: { cmsPages: { published: 1 } },
    };
  }
  for (let index = 0; index < 22; index += 1) {
    rows[`system_errors/error-${index}`] = {
      kind: 'client-error',
      message: `private message ${index}`,
      url: 'https://private.example.org',
      userEmail: 'private@example.org',
      resolved: false,
      createdAt: new Date(index * 1000),
    };
  }
  return rows;
}

function response() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
}

test('the recursive redactor removes explicit sensitive key classes', () => {
  const redacted = internals.redactDiagnosticValue({
    safe: true,
    attendee: { email: 'private@example.org' },
    nested: {
      ticketToken: 'secret',
      paymentId: 'payment',
      invitation: 'invite',
      providerCredential: 'credential',
      storagePath: 'path',
      userId: 'user',
    },
  });
  assert.deepEqual(redacted, { safe: true, nested: {} });
});

test('readiness reuses the launch policy and returns only check state', async () => {
  const db = makeFakeDb(seed());
  const result = await internals.readEventReadiness({ db, getConfig: async () => config() });
  assert.equal(result.ready, true);
  assert.equal(result.checks.total, 7);
  assert.equal(result.checks.truncated, 0);
  assert.doesNotMatch(JSON.stringify(result), /private@example\.org/);
});

test('the current-page diagnostic uses the route-owned id and bounds validator issues', async () => {
  const db = makeFakeDb(seed());
  const result = await internals.readCurrentPageDraft({ db }, { pageId: 'home' });
  assert.equal(result.valid, false);
  assert.ok(result.issues.total > 0);
  await assert.rejects(
    internals.readCurrentPageDraft({ db }, { pageId: 'home', collection: 'users' }),
    (error) => error.code === 'invalid-input',
  );
});

test('publish and system-error diagnostics are bounded and omit raw records', async () => {
  const db = makeFakeDb(seed());
  const publish = await internals.readPublishQueue({ db });
  const errors = await internals.readSystemErrors({ db });
  assert.equal(publish.rows.total, 12);
  assert.equal(publish.rows.items.length, 10);
  assert.equal(publish.rows.truncated, 2);
  assert.equal(errors.rows.total, 22);
  assert.equal(errors.rows.items.length, 20);
  assert.equal(errors.rows.truncated, 2);
  const json = JSON.stringify({ publish, errors });
  assert.doesNotMatch(json, /private@example\.org|private-token|private message|private\.example/);
});

test('media and ticketing diagnostics return counts and health without identifiers', async () => {
  const db = makeFakeDb(seed());
  const media = await internals.readMediaUsage({ db });
  const ticketing = await internals.readTicketingHealth({
    db,
    provider: { name: 'manual', externalEventId: 'private-event' },
    getConfig: async () => config(),
    now: () => new Date(3000),
  });
  assert.deepEqual(media.assets, {
    checked: 2,
    total: 3,
    truncated: 0,
    referenced: 1,
    unused: 1,
    references: 1,
    missingIndexData: 1,
  });
  assert.equal(ticketing.integration, 'manual');
  assert.equal(ticketing.queue.pending, 1);
  assert.doesNotMatch(JSON.stringify(ticketing), /private-event|private-hook|private@example\.org/);
});

test('the server gate rejects signed-out callers and sanitizes an authorized result', async () => {
  const db = makeFakeDb(seed());
  const getConfig = async () => config();
  const auth = {
    verifyIdToken: async () => ({
      uid: 'admin-uid',
      email: 'admin@example.org',
      email_verified: true,
    }),
  };
  const handler = createInspectPublishQueueHandler({ db, getConfig, auth, log: console });

  const signedOut = response();
  await handler({ method: 'POST', headers: {}, body: {} }, signedOut);
  assert.equal(signedOut.statusCode, 401);

  const authorized = response();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer valid' },
    body: {},
  }, authorized);
  assert.equal(authorized.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(authorized.body), /private@example\.org|private-token/);
});
