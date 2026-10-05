'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readImport } = require('./pitchQueue.cjs');
const row = { externalId: '17', email: 'speaker@example.test', title: 'Local reporting', description: 'A practical session.', consent: true };
test('external-form import requires real consent and stable unique source identities', () => {
  const parsed = readImport({ source: 'external-form', rows: [row] });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].externalId, '17');
  assert.equal(parsed.rows[0].id, readImport({ source: 'external-form', rows: [row] }).rows[0].id);
  assert.notEqual(parsed.rows[0].id, readImport({ source: 'other-form', rows: [row] }).rows[0].id);
  assert.match(readImport({ source: 'external-form', rows: [{ ...row, consent: false }] }).error, /consent/);
  assert.match(readImport({ source: 'external-form', rows: [null] }).error, /externalId/);
  assert.match(readImport({ source: 'external-form', rows: [row, row] }).error, /unique externalId/);
  assert.match(readImport({ source: 'external-form', rows: [row, { ...row, externalId: '18', title: '' }] }).error, /title/);
});
