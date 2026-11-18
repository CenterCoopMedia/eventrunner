'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseEventPublicBase, joinEventPath, stripEventMount } = require('./publicBase.mjs');

const origin = 'https://events.example.org';

test('unconfigured and configured root builds have the same route and asset paths', () => {
  assert.deepEqual(parseEventPublicBase(), { publicBase: null, origin: null, mount: '', assetBase: '/' });
  assert.deepEqual(parseEventPublicBase(''), parseEventPublicBase());
  for (const base of [origin, `${origin}/`]) {
    assert.deepEqual(parseEventPublicBase(base), { publicBase: `${origin}/`, origin, mount: '', assetBase: '/' });
  }
  assert.equal(stripEventMount('/schedule', ''), '/schedule');
  assert.equal(joinEventPath('/', '/schedule'), '/schedule');
});

test('mounts normalize one slash and strip only a complete matching prefix', () => {
  for (const mount of ['/conference', '/events/conference-2027']) {
    const assetBase = `${mount}/`;
    const publicBase = `${origin}${assetBase}`;
    assert.deepEqual(parseEventPublicBase(`${origin}${mount}`), { publicBase, origin, mount, assetBase });
    assert.deepEqual(parseEventPublicBase(publicBase), parseEventPublicBase(`${origin}${mount}`));
    assert.equal(joinEventPath(assetBase, '/'), assetBase);
    assert.equal(joinEventPath(assetBase, '/schedule/one'), `${mount}/schedule/one`);
    assert.equal(stripEventMount(mount, mount), '/');
    assert.equal(stripEventMount(assetBase, mount), '/');
    assert.equal(stripEventMount(`${mount}/schedule/one`, mount), '/schedule/one');
    assert.equal(stripEventMount(`${mount}${mount}/schedule`, mount), `${mount}/schedule`);
    for (const lookalike of [`${mount}-old/`, `${mount}%2Fschedule`, mount.toUpperCase(), '/schedule']) {
      assert.equal(stripEventMount(lookalike, mount), null, lookalike);
    }
  }
});

test('malformed public bases fail before URL normalization', () => {
  for (const base of [
    '/conference', ` ${origin}/conference`, `http://events.example.org/conference`,
    'https:///events.example.org/conference', 'https://events.example.org:bad/conference',
    'https://synthetic@example.org/conference', 'https://@example.org/conference',
    `${origin}/conference?`, `${origin}/conference#`, `${origin}/conference?x=1`,
    `${origin}/conference#fragment`, `${origin}/conference/%`, `${origin}/conference/%xz`,
    `${origin}/conference/%2F`, `${origin}/conference/%5c`, `${origin}/conference/%2e%2E`,
    `${origin}/./conference`, `${origin}/a/../conference`, `${origin}//conference`,
    `${origin}/conference//`, `${origin}/conference\\schedule`, `${origin}/confer\tence`,
    `${origin}/Conference`, `${origin}/__/auth`, `${origin}\n`, `${origin}\u0001`,
  ]) assert.throws(() => parseEventPublicBase(base), /must be an HTTPS URL/);
});
