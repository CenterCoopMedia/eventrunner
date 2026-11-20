'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../console/functions/src/fakes.cjs');
const { migrateWebVitalsDefault } = require('./migrate-web-vitals-default.cjs');

test('deploy removes only the old seed false and keeps the rest of the features document', async () => {
  const cases = [
    [{ coreWebVitals: false, updatedBy: 'init-event-script' }, true],
    [{ coreWebVitals: false, updatedBy: 'operator@example.test' }, false],
    [{ coreWebVitals: false, updatedBy: 'init-event-answers' }, false],
    [{ updatedBy: 'init-event-script' }, false],
    [{ coreWebVitals: true, updatedBy: 'init-event-script' }, false],
  ];
  for (const [setting, changed] of cases) {
    const original = { schedule: true, ...setting };
    const db = makeFakeDb({ 'config/features': original });
    assert.equal(await migrateWebVitalsDefault({ db }), changed);
    const expected = { ...original };
    if (changed) delete expected.coreWebVitals;
    assert.deepEqual(db.read('config/features'), expected);
    assert.equal(await migrateWebVitalsDefault({ db }), false);
  }
});
