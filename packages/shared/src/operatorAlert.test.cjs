'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSubmissionAlert, renderOperatorMail } = require('./operatorAlert.cjs');

test('operator alerts keep structured facts and refuse invalid IDs, kinds, counts, and links', () => {
  const base = {
    kind: 'problem-report', site: 'event-demo', id: 'receipt-1234',
    link: 'https://console.example.test/review/problem-reports?id=receipt-1234',
    page: '/path?token=fixture', screenshotCount: 3, description: 'Reporter text',
  };
  const { text, html } = renderOperatorMail(buildSubmissionAlert(base));
  assert.match(html, /Event Runner operator alert/);
  assert.match(text, /site: event-demo\nrecord: receipt-1234\nscreenshots: 3/);
  assert.ok(!text.includes('Reporter text'));
  assert.ok(!text.includes('token=fixture'));
  for (const invalid of [
    { kind: 'error' }, { site: 'site\n' }, { id: 'bad/path' },
    { screenshotCount: 4 }, { link: 'javascript:alert(1)' }, { link: 'https://user@example.test/' },
  ]) assert.equal(buildSubmissionAlert({ ...base, ...invalid }), null);
});
