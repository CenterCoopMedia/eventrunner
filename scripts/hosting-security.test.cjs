const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));

test('all Hosting entry points prohibit framing, including direct SPA access', () => {
  const rules = config.hosting.headers;
  const global = rules.find((rule) => rule.source === '**');
  assert.ok(global, 'Protect every entry point, including /admin, nested routes and /index.html');
  const headers = Object.fromEntries(global.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers['content-security-policy'], "frame-ancestors 'none'");
  assert.equal(headers['x-frame-options'], 'DENY');
  for (const rule of rules) {
    for (const { key, value } of rule.headers) {
      if (key.toLowerCase() === 'content-security-policy') {
        assert.match(value, /(?:^|;)\s*frame-ancestors 'none'\s*(?:;|$)/);
      }
      if (key.toLowerCase() === 'x-frame-options') assert.equal(value, 'DENY');
    }
  }
});

test('admin rewrites retain noindex alongside the global framing policy', () => {
  for (const source of ['/admin', '/admin/**']) {
    assert.ok(config.hosting.rewrites.some((rule) => rule.source === source && rule.destination === '/index.html'));
    assert.ok(config.hosting.headers.some((rule) => rule.source === source &&
      rule.headers.some(({ key, value }) => key === 'X-Robots-Tag' && value === 'noindex')));
  }
});
