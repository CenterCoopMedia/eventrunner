'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { render, validateTemplateBody, buildGlobalTokens, internals } = require('./render.cjs');

const TEMPLATE = {
  id: 'test.sample',
  subject: '{{event_short_name}}: hello {{first_name}}',
  html: '<p>Hi {{first_name}}, code {{code}}.</p>{{postal_address_html}}',
  text: 'Hi {{first_name}}, code {{code}}.\n{{postal_address_html}}',
  tokens: ['event_short_name', 'first_name', 'code', 'postal_address_html'],
  requiredTokens: ['code'],
  storeRendered: true,
};

const CONFIG = {
  event: {
    name: 'Example Summit 2027',
    shortName: 'EX27',
    sender: { email: 'summit@example.org', name: 'Example Summit' },
    legal: {
      operatorName: 'Example Org',
      postalAddressHtml: 'Example Org<br>1 Main St<br>Springfield',
      supportEmail: 'help@example.org',
    },
    days: [
      { id: 'day-1', date: '2027-05-13' },
      { id: 'day-2', date: '2027-05-14' },
    ],
    venue: { name: 'Hall', addressLine1: '1 Main St', city: 'Springfield', region: 'IL', postalCode: '11111', country: 'USA' },
    social: { handles: [{ platform: 'Mastodon', url: 'https://example.social/@ex' }] },
  },
  theme: { colors: { primary: '#336699', ink: '#111111' } }, // eslint-disable-line no-restricted-syntax
  tierA: { publicUrl: 'https://summit.example.org/' },
};

test('render substitutes globals and per-send tokens', () => {
  const out = render({ template: TEMPLATE, tokenValues: { first_name: 'Ada', code: '123456' }, config: CONFIG });
  assert.equal(out.subject, 'EX27: hello Ada');
  assert.ok(out.html.includes('code 123456'));
  assert.ok(out.text.includes('code 123456'));
  assert.equal(out.usedFallback, false);
});

test('plain tokens are HTML-escaped in html, raw in text', () => {
  const out = render({
    template: TEMPLATE,
    tokenValues: { first_name: '<b>Ada & Co</b>', code: '1' },
    config: CONFIG,
  });
  assert.ok(out.html.includes('&lt;b&gt;Ada &amp; Co&lt;/b&gt;'));
  assert.ok(out.text.includes('<b>Ada & Co</b>'));
});

test('_html tokens substitute raw into html, stripped into text', () => {
  const out = render({ template: TEMPLATE, tokenValues: { first_name: 'A', code: '1' }, config: CONFIG });
  assert.ok(out.html.includes('Example Org<br>1 Main St<br>Springfield'));
  assert.ok(out.text.includes('Example Org\n1 Main St\nSpringfield'));
});

test('per-send values can never populate an _html token', () => {
  const out = render({
    template: TEMPLATE,
    tokenValues: { first_name: 'A', code: '1', postal_address_html: '<script>evil()</script>' },
    config: CONFIG,
  });
  assert.ok(!out.html.includes('evil()'));
  assert.ok(out.warnings.some((w) => w.includes('postal_address_html')));
});

test('every _html token in shipped templates resolves through the resolver map', () => {
  // The §6.1 invariant test: templates may only reference _html tokens the
  // fixed resolver map knows about.
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, 'templates');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.cjs') && f !== 'layout.cjs') : [];
  for (const file of files) {
    const tpl = require(path.join(dir, file));
    for (const body of [tpl.subject, tpl.html, tpl.text]) {
      for (const name of internals.referencedTokens(body || '')) {
        if (name.endsWith('_html')) {
          assert.ok(
            name in internals.HTML_TOKEN_RESOLVERS,
            `${file}: {{${name}}} has no resolver`,
          );
        }
      }
    }
  }
});

test('missing plain value renders empty and warns, never throws', () => {
  const out = render({ template: TEMPLATE, tokenValues: { code: '1' }, config: CONFIG });
  assert.ok(out.subject.endsWith('hello '));
  assert.ok(out.warnings.some((w) => w.includes('first_name')));
});

test('override with unknown token falls back to the code default', () => {
  const override = { html: '<p>{{code}} {{code}} {{not_declared}}</p>', text: '{{code}}' };
  const out = render({ template: TEMPLATE, override, tokenValues: { first_name: 'A', code: '9' }, config: CONFIG });
  assert.equal(out.usedFallback, true);
  assert.ok(out.overrideErrors.some((e) => e.includes('not_declared')));
  assert.ok(out.html.includes('Hi A, code 9.'));
});

test('override omitting a required token falls back (the auth.otp lockout case)', () => {
  const override = { html: '<p>Welcome!</p>', text: 'Welcome!' };
  const out = render({ template: TEMPLATE, override, tokenValues: { first_name: 'A', code: '7' }, config: CONFIG });
  assert.equal(out.usedFallback, true);
  assert.ok(out.html.includes('code 7'));
});

test('valid override is used', () => {
  const override = { subject: 'Yo {{first_name}}', html: '<p>c={{code}}</p>', text: 'c={{code}}' };
  const out = render({ template: TEMPLATE, override, tokenValues: { first_name: 'A', code: '5' }, config: CONFIG });
  assert.equal(out.usedFallback, false);
  assert.equal(out.subject, 'Yo A');
  assert.equal(out.text, 'c=5');
});

test('render carries the template storage policy for send() composition', () => {
  const out = render({ template: TEMPLATE, tokenValues: { first_name: 'A', code: '1' }, config: CONFIG });
  assert.equal(out.storeRendered, true);
  const suppressed = render({
    template: { ...TEMPLATE, storeRendered: false },
    tokenValues: { first_name: 'A', code: '1' },
    config: CONFIG,
  });
  assert.equal(suppressed.storeRendered, false);
});

test('validateTemplateBody reports both check types at save time', () => {
  const bad = validateTemplateBody(TEMPLATE, { subject: '{{nope}}', html: 'x', text: 'y' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('unknown token')));
  assert.ok(bad.errors.some((e) => e.includes('missing required token')));
});

test('buildGlobalTokens derives urls, dates, and year', () => {
  const tokens = buildGlobalTokens(CONFIG, { now: () => new Date('2027-01-01T00:00:00Z') });
  assert.equal(tokens.site_url, 'https://summit.example.org');
  assert.equal(tokens.login_url, 'https://summit.example.org/login');
  assert.equal(tokens.event_dates, '2027-05-13 to 2027-05-14');
  assert.equal(tokens.current_year, '2027');
  assert.equal(tokens.venue_address, '1 Main St, Springfield, IL, 11111, USA');
});

test('stripHtmlToText converts breaks and strips tags', () => {
  assert.equal(
    internals.stripHtmlToText('<p>a<br>b</p><ul><li>c</li></ul>'),
    'a\nb\nc',
  );
});
