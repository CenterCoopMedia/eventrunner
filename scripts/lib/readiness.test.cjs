'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateReadiness, allReady, formatReadinessTable } = require('./readiness.cjs');

/** A deployment that passes every row; individual tests break one at a time. */
function readySnapshot(overrides = {}) {
  return {
    event: {
      legal: { reviewRequired: false },
      sender: { email: 'hello@example.org', domainVerified: true, domainVerifiedAt: '2027-01-01T00:00:00Z' },
      auth: { googleProviderEnabled: true, authorizedDomainsConfigured: true, attestedAt: '2027-01-01', attestedBy: 'ops' },
    },
    providers: { ticketing: { provider: 'none' } },
    theme: { placeholderLogos: [] },
    bootstrap: { adminEmails: ['a@example.org', 'b@example.org'] },
    seededContentCount: 0,
    ...overrides,
  };
}

test('the table has exactly the seven §5.1.1 rows, in spec order', () => {
  const rows = evaluateReadiness(readySnapshot());
  assert.deepEqual(rows.map((r) => r.id), ['legal', 'sender', 'seeded', 'branding', 'admins', 'ticketing', 'auth']);
});

test('a fully configured deployment passes every row', () => {
  assert.equal(allReady(evaluateReadiness(readySnapshot())), true);
});

test('a freshly initialized deployment fails exactly the rows init itself creates', () => {
  const fresh = evaluateReadiness({
    event: {
      legal: { reviewRequired: true },
      sender: { email: 'hello@example.org', domainVerified: false },
      auth: { googleProviderEnabled: false, authorizedDomainsConfigured: false },
    },
    providers: { ticketing: { provider: 'none' } },
    theme: { placeholderLogos: ['primary', 'mark'] },
    bootstrap: { adminEmails: ['ops@example.org'] },
    seededContentCount: 24,
  });
  assert.deepEqual(
    fresh.filter((r) => !r.ok).map((r) => r.id),
    ['legal', 'sender', 'seeded', 'branding', 'admins', 'auth'],
  );
  // Ticketing is `none`: nothing to register, so the row passes rather
  // than being an item a CSV deployment could never complete (§5.6 item 5).
  assert.equal(fresh.find((r) => r.id === 'ticketing').ok, true);
});

test('a webhook-capable ticketing provider needs a registration stamp', () => {
  const unregistered = evaluateReadiness(readySnapshot({ providers: { ticketing: { provider: 'eventbrite' } } }));
  assert.equal(unregistered.find((r) => r.id === 'ticketing').ok, false);
  const registered = evaluateReadiness(
    readySnapshot({ providers: { ticketing: { provider: 'eventbrite', webhookRegisteredAt: '2027-01-01' } } }),
  );
  assert.equal(registered.find((r) => r.id === 'ticketing').ok, true);
});

test('manual ticketing passes without a webhook', () => {
  const rows = evaluateReadiness(readySnapshot({ providers: { ticketing: { provider: 'manual' } } }));
  assert.equal(rows.find((r) => r.id === 'ticketing').ok, true);
});

test('the seeded-content row honors a configured threshold', () => {
  assert.equal(evaluateReadiness(readySnapshot({ seededContentCount: 3 })).find((r) => r.id === 'seeded').ok, false);
  assert.equal(
    evaluateReadiness(readySnapshot({ seededContentCount: 3, seededThreshold: 5 })).find((r) => r.id === 'seeded').ok,
    true,
  );
});

test('one admin is not enough — config/bootstrap must not be a single point of failure', () => {
  const rows = evaluateReadiness(readySnapshot({ bootstrap: { adminEmails: ['only@example.org'] } }));
  assert.equal(rows.find((r) => r.id === 'admins').ok, false);
});

test('a half-attested auth step does not pass', () => {
  const rows = evaluateReadiness(readySnapshot({
    event: {
      ...readySnapshot().event,
      auth: { googleProviderEnabled: true, authorizedDomainsConfigured: false },
    },
  }));
  assert.equal(rows.find((r) => r.id === 'auth').ok, false);
});

test('an empty deployment evaluates without throwing — the table is total', () => {
  const rows = evaluateReadiness({ event: null, providers: null, theme: null, bootstrap: null, seededContentCount: 0 });
  assert.equal(rows.length, 7);
  assert.equal(allReady(rows), false);
});

test('every unmet row prints a remedy', () => {
  const rows = evaluateReadiness({ event: null, providers: null, theme: null, bootstrap: null, seededContentCount: 9 });
  const table = formatReadinessTable(rows);
  for (const row of rows.filter((r) => !r.ok)) {
    assert.ok(table.includes(row.remedy), `${row.id} printed no remedy`);
  }
  assert.match(table, /UNMET/);
});
