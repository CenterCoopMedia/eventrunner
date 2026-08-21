'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { main, formatReport } = require('./validate-deploy-env.cjs');

const VALID_ENV = {
  EVENT_SLUG: 'demo-event',
  EVENT_FIREBASE_PROJECT_ID: 'demo-project',
  EVENT_PUBLIC_URL: 'https://summit.example.org',
  EVENT_STORAGE_BUCKET: 'demo-project.appspot.com',
  EVENT_ALLOWED_ORIGINS: 'https://summit.example.org',
  EVENT_EMAIL_PROVIDER: 'console',
  EVENT_TICKETING_PROVIDER: 'none',
  EVENT_OPERATOR_NOTIFIER: 'none',
  EVENT_HOSTING_SITE: 'demo-project',
  VITE_FIREBASE_API_KEY: 'AIzaFake',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-project.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-project.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abc',
  VITE_FIREBASE_MEASUREMENT_ID: 'G-FAKE',
  VITE_EVENT_PUBLIC_URL: 'https://summit.example.org',
};

test('exits 0 on a fully populated environment', () => {
  assert.equal(main(VALID_ENV), 0);
});

test('exits 1 when a required GitHub Environment variable was never set', () => {
  const { EVENT_STORAGE_BUCKET, ...missingBucket } = VALID_ENV;
  assert.equal(main(missingBucket), 1);
});

test('exits 1 on an empty string — the exact shape an unset vars.* renders as in a workflow env: block', () => {
  assert.equal(main({ ...VALID_ENV, EVENT_STORAGE_BUCKET: '' }), 1);
});

test('formatReport names every missing and invalid key, not just the first', () => {
  const report = formatReport({
    ok: false,
    missing: ['EVENT_STORAGE_BUCKET', 'EVENT_HOSTING_SITE'],
    errors: ['EVENT_SLUG: must be lowercase [a-z0-9-]'],
  });
  assert.match(report, /EVENT_STORAGE_BUCKET/);
  assert.match(report, /EVENT_HOSTING_SITE/);
  assert.match(report, /EVENT_SLUG: must be lowercase/);
});
