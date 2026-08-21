'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function isOnRequest(handler) {
  // v1 background functions expose __endpoint through a lazy getter that
  // needs GCLOUD_PROJECT. HTTP handlers in this barrel are v2 functions and
  // carry direct metadata, so inspect the property without invoking getters.
  const endpoint = Object.getOwnPropertyDescriptor(handler, '__endpoint')?.value;
  if (!endpoint || !Object.hasOwn(endpoint, 'httpsTrigger')) return false;
  return !Object.hasOwn(endpoint, 'callableTrigger')
    && endpoint.labels?.['deployment-callable'] !== 'true';
}

test('the smoke manifest covers every onRequest export exactly once', () => {
  const manifestPath = path.join(ROOT, '.github', 'smoke-endpoints.json');
  const { endpoints } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const deployable = require(path.join(ROOT, 'functions', 'index.js'));
  const onRequestNames = Object.entries(deployable)
    .filter(([, handler]) => isOnRequest(handler))
    .map(([name]) => name)
    .sort();

  assert.ok(Array.isArray(endpoints));
  assert.equal(new Set(endpoints).size, endpoints.length, 'smoke endpoints must be unique');
  assert.deepEqual([...endpoints].sort(), onRequestNames);
});
