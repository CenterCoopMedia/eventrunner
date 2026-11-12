'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validSample, bucketFor, bucketUpperBound, summarizeVitals } = require('./webVitals.cjs');

const sample = { route: '/attendees/:uid', device: 'mobile', name: 'LCP', value: 2500 };

test('performance samples allow only the four categorical and numeric fields', () => {
  assert.equal(validSample(sample), true);
  assert.equal(validSample({ ...sample, route: '/*' }), true);
  for (const field of ['url', 'uid', 'selector', 'id', 'cookie', 'sessionId', 'ip', 'userAgent']) {
    assert.equal(validSample({ ...sample, [field]: 'private' }), false, field);
  }
  for (const bad of [null, [], {}, { ...sample, route: '/attendees/private-user' },
    { ...sample, route: '/?token=private' }, { ...sample, name: '__proto__' },
    { ...sample, device: 'tablet' }, { ...sample, value: '2500' },
    { ...sample, value: NaN }, { ...sample, value: Infinity }, { ...sample, value: -1 },
    { ...sample, name: 'held_up', value: 2 }]) assert.equal(validSample(bad), false);
  assert.equal(validSample({ ...sample, name: 'held_up', value: 1 }), true);
});

test('histogram bounds preserve good thresholds, exact zero and finite overflow', () => {
  for (const [name, value, bucket] of [
    ['LCP', 0, '0'], ['LCP', 2500, '25'], ['LCP', 2500.01, '26'],
    ['LCP', 60000, '600'], ['LCP', 60001, '601'],
    ['INP', 200, '20'], ['INP', 200.01, '21'], ['CLS', 0.07, '7'],
    ['CLS', 0.1, '10'], ['CLS', 0.100001, '11'], ['CLS', Number.MAX_VALUE, '501'],
  ]) assert.equal(bucketFor(name, value), bucket, `${name} ${value}`);
  assert.equal(bucketUpperBound('CLS', '10'), 0.1);
  assert.equal(bucketUpperBound('LCP', '601'), Infinity);
});

test('daily counts combine by route/device and use nearest-rank p75 upper bounds', () => {
  const rows = summarizeVitals([
    { route: '/', device: 'mobile', counts: { LCP: { 20: 2, 25: 1 }, INP: { 20: 3 }, CLS: { 10: 3 }, held_up: { 1: 2 } } },
    { route: '/', device: 'mobile', counts: { LCP: { 40: 1 }, INP: { 50: 1 }, CLS: { 30: 1 }, held_up: { 1: 1 } } },
    { route: '/', device: 'desktop', counts: { LCP: { 41: 4 }, INP: { 21: 4 } } },
    { route: '/schedule', device: 'mobile', counts: { LCP: { 601: 1 }, LCP_TTFB: { 3: 1 } } },
  ]);
  const row = (route, device, name) => rows.find((entry) => entry.route === route && entry.device === device && entry.name === name);
  assert.deepEqual(row('/', 'mobile', 'LCP'), { route: '/', device: 'mobile', name: 'LCP', count: 4, p75: 2500, rating: 'good' });
  assert.equal(row('/', 'mobile', 'INP').p75, 200);
  assert.equal(row('/', 'mobile', 'CLS').p75, 0.1);
  assert.equal(row('/', 'desktop', 'LCP').rating, 'poor');
  assert.equal(row('/', 'desktop', 'INP').rating, 'needs improvement');
  assert.equal(row('/', 'mobile', 'held_up').count, 3);
  assert.equal(row('/', 'mobile', 'held_up').p75, null);
  assert.equal(row('/schedule', 'mobile', 'LCP').p75, Infinity);
  assert.equal(row('/schedule', 'mobile', 'LCP_TTFB').rating, null);
});

test('invalid aggregate categories, bucket keys and counts cannot change a percentile', () => {
  assert.deepEqual(summarizeVitals([
    { ...sample, route: '/attendees/private-user', counts: { LCP: { 1: 100 } } },
    { route: '/', device: 'mobile', counts: { unknown: { 1: 100 }, LCP: {
      '-1': 10, '01': 10, NaN: 10, 602: 10, 1: -1, 2: 1.5, 3: '4', 4: 0, 25: 4,
    } } },
  ]), [{ route: '/', device: 'mobile', name: 'LCP', count: 4, p75: 2500, rating: 'good' }]);
});
