'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDeployEnv, DEFAULTS } = require('./deploy.cjs');

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

test('valid env passes', () => {
  const result = validateDeployEnv(VALID_ENV);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.errors, []);
});

test('missing VITE frontend build key fails', () => {
  const { VITE_FIREBASE_API_KEY, ...rest } = VALID_ENV;
  const result = validateDeployEnv(rest);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['VITE_FIREBASE_API_KEY']);
});

test('missing required keys are reported by name', () => {
  const { EVENT_STORAGE_BUCKET, ...rest } = VALID_ENV;
  const result = validateDeployEnv(rest);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['EVENT_STORAGE_BUCKET']);
});

test('EVENT_SLUG must be lowercase [a-z0-9-]', () => {
  const result = validateDeployEnv({ ...VALID_ENV, EVENT_SLUG: 'Demo_Event' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('EVENT_SLUG:')));
});

test('EVENT_PUBLIC_URL must be a parseable https URL', () => {
  for (const url of ['not a url', 'http://summit.example.org', 'ftp://x.example']) {
    const result = validateDeployEnv({ ...VALID_ENV, EVENT_PUBLIC_URL: url });
    assert.equal(result.ok, false, url);
    assert.ok(result.errors.some((e) => e.startsWith('EVENT_PUBLIC_URL:')));
  }
});

test('provider enums are enforced', () => {
  for (const [key, value] of [
    ['EVENT_EMAIL_PROVIDER', 'smtp'],
    ['EVENT_TICKETING_PROVIDER', 'tickets-r-us'],
    ['EVENT_OPERATOR_NOTIFIER', 'pager'],
  ]) {
    const result = validateDeployEnv({ ...VALID_ENV, [key]: value });
    assert.equal(result.ok, false, key);
    assert.ok(result.errors.some((e) => e.startsWith(`${key}:`)));
  }
});

test('EVENT_TICKETING_EVENT_ID required only for eventbrite', () => {
  const eb = validateDeployEnv({ ...VALID_ENV, EVENT_TICKETING_PROVIDER: 'eventbrite' });
  assert.equal(eb.ok, false);
  assert.ok(eb.missing.includes('EVENT_TICKETING_EVENT_ID'));

  const withId = validateDeployEnv({
    ...VALID_ENV,
    EVENT_TICKETING_PROVIDER: 'eventbrite',
    EVENT_TICKETING_EVENT_ID: '123456',
  });
  assert.equal(withId.ok, true);

  const manual = validateDeployEnv({ ...VALID_ENV, EVENT_TICKETING_PROVIDER: 'manual' });
  assert.equal(manual.ok, true);
});

test('EVENT_FIREBASE_REGION has a default and is never required', () => {
  assert.equal(DEFAULTS.EVENT_FIREBASE_REGION, 'us-central1');
  assert.equal(validateDeployEnv(VALID_ENV).missing.includes('EVENT_FIREBASE_REGION'), false);
});

test('resolved applies EVENT_FIREBASE_REGION default and preserves explicit values', () => {
  const defaulted = validateDeployEnv(VALID_ENV);
  assert.equal(defaulted.resolved.EVENT_FIREBASE_REGION, 'us-central1');
  assert.equal(defaulted.resolved.EVENT_SLUG, 'demo-event');

  const explicit = validateDeployEnv({ ...VALID_ENV, EVENT_FIREBASE_REGION: 'europe-west1' });
  assert.equal(explicit.resolved.EVENT_FIREBASE_REGION, 'europe-west1');
});

test('never throws on garbage input', () => {
  assert.equal(validateDeployEnv(null).ok, false);
  assert.equal(validateDeployEnv({}).ok, false);
});

// --- OTP abuse controls (issue #45) -----------------------------------------

test('the OTP abuse controls default off and are never reported missing', () => {
  const result = validateDeployEnv(VALID_ENV);
  assert.equal(result.ok, true);
  assert.equal(result.resolved.EVENT_APP_CHECK_ENFORCED, 'false');
  assert.equal(result.resolved.EVENT_OTP_SEND_CEILING_PER_HOUR, '500');
  assert.equal(result.missing.includes('EVENT_APP_CHECK_ENFORCED'), false);
  assert.equal(result.missing.includes('EVENT_OTP_SEND_CEILING_PER_HOUR'), false);
});

test('EVENT_APP_CHECK_ENFORCED=true requires a site key in the bundle', () => {
  // Enforcement without a key in the bundle is a total sign-in outage, so
  // it fails the build rather than the first visitor.
  const noKey = validateDeployEnv({ ...VALID_ENV, EVENT_APP_CHECK_ENFORCED: 'true' });
  assert.equal(noKey.ok, false);
  assert.ok(noKey.missing.includes('VITE_FIREBASE_APP_CHECK_SITE_KEY'));

  const withKey = validateDeployEnv({
    ...VALID_ENV,
    EVENT_APP_CHECK_ENFORCED: 'true',
    VITE_FIREBASE_APP_CHECK_SITE_KEY: 'site-key',
  });
  assert.equal(withKey.ok, true);

  const bad = validateDeployEnv({ ...VALID_ENV, EVENT_APP_CHECK_ENFORCED: 'yes' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.startsWith('EVENT_APP_CHECK_ENFORCED')));
});

test('EVENT_OTP_SEND_CEILING_PER_HOUR must be a positive integer', () => {
  assert.equal(
    validateDeployEnv({ ...VALID_ENV, EVENT_OTP_SEND_CEILING_PER_HOUR: '50' }).ok,
    true,
  );
  for (const bad of ['0', '-1', '1.5', 'lots']) {
    const result = validateDeployEnv({ ...VALID_ENV, EVENT_OTP_SEND_CEILING_PER_HOUR: bad });
    assert.equal(result.ok, false, `"${bad}" must fail the build`);
    assert.ok(result.errors.some((e) => e.startsWith('EVENT_OTP_SEND_CEILING_PER_HOUR')));
  }
});
