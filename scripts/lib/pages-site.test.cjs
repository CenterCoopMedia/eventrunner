'use strict';

// The Pages site address (#514). One value decides the origin and the path
// base of every URL the documentation generator, the demo build, and the link
// checker write or check; these cases pin how that value is read and refused.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  DEFAULT_PAGES_BASE_URL,
  GITHUB_PAGES_URL,
  pagesSite,
  parsePagesBaseUrl,
} = require('./pages-site.cjs');

test('the committed default is the github.io project path', () => {
  assert.equal(DEFAULT_PAGES_BASE_URL, GITHUB_PAGES_URL);
  assert.deepEqual({ ...pagesSite({}) }, {
    url: 'https://centercoopmedia.github.io/eventrunner/',
    origin: 'https://centercoopmedia.github.io',
    base: '/eventrunner/',
    docsBase: '/eventrunner/docs/',
    docsUrl: 'https://centercoopmedia.github.io/eventrunner/docs/',
    demoBase: '/eventrunner/demo/',
  });
});

test('a custom domain serves the site from /', () => {
  assert.deepEqual({ ...parsePagesBaseUrl('https://docs.eventrunner.org/') }, {
    url: 'https://docs.eventrunner.org/',
    origin: 'https://docs.eventrunner.org',
    base: '/',
    docsBase: '/docs/',
    docsUrl: 'https://docs.eventrunner.org/docs/',
    demoBase: '/demo/',
  });
});

test('PAGES_BASE_URL overrides the default, and an empty value falls back to it', () => {
  assert.equal(pagesSite({ PAGES_BASE_URL: 'https://docs.eventrunner.org' }).url, 'https://docs.eventrunner.org/');
  assert.equal(pagesSite({ PAGES_BASE_URL: '' }).url, DEFAULT_PAGES_BASE_URL);
  assert.equal(pagesSite({ PAGES_BASE_URL: '   ' }).url, DEFAULT_PAGES_BASE_URL);
});

test('a missing trailing slash is added to the path base', () => {
  assert.equal(parsePagesBaseUrl('https://example.org/site').base, '/site/');
  assert.equal(parsePagesBaseUrl('https://example.org').base, '/');
  assert.equal(parsePagesBaseUrl('https://EXAMPLE.org/a/b/').url, 'https://example.org/a/b/');
});

test('an address that would put something unsafe into every link is refused', () => {
  for (const value of [
    'docs.eventrunner.org',
    'http://docs.eventrunner.org/',
    'https://docs.eventrunner.org/?x=1',
    'https://docs.eventrunner.org/#top',
    'https://user:secret@docs.eventrunner.org/',
    'https://docs.eventrunner.org//docs/',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => parsePagesBaseUrl(value), /PAGES_BASE_URL/, value);
  }
});

test('the command prints the resolved address for the Pages workflow', () => {
  const script = path.join(__dirname, 'pages-site.cjs');
  const run = (value) => execFileSync(process.execPath, [script], {
    env: { ...process.env, PAGES_BASE_URL: value },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(run(''), `${DEFAULT_PAGES_BASE_URL}\n`);
  assert.equal(run('https://docs.eventrunner.org'), 'https://docs.eventrunner.org/\n');
  assert.throws(() => run('http://docs.eventrunner.org/'), (error) => error.status === 2);
});
