'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { render, validateTemplateBody, internals: renderInternals } = require('./render.cjs');
const {
  getDefaultTemplate,
  listTemplateIds,
  loadTemplate,
  validateOverridePayload,
  resetTemplateCacheForTest,
  internals,
} = require('./templates.cjs');
const { wrap, LAYOUT_TOKENS } = require('./templates/layout.cjs');

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
    days: [{ id: 'day-1', date: '2027-05-13' }],
    venue: { name: 'Hall', addressLine1: '1 Main St', city: 'Springfield' },
    social: { handles: [] },
  },
  // Non-hex sentinels: the renderer copies any string through the token,
  // and hex literals stay banned outside email/templates/ (spec §7.6).
  theme: { colors: { primary: 'BRAND_PRIMARY_SENTINEL', ink: 'BRAND_INK_SENTINEL' } },
  tierA: { publicUrl: 'https://summit.example.org' },
};

/** Minimal fake Firestore over a doc map, counting reads per doc id. */
function makeFakeDb(docs = {}) {
  const reads = {};
  return {
    reads,
    setDoc(id, data) {
      docs[id] = data;
    },
    collection(name) {
      assert.equal(name, 'email_templates');
      return {
        doc(id) {
          return {
            async get() {
              reads[id] = (reads[id] || 0) + 1;
              const data = docs[id];
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
      };
    },
  };
}

test.beforeEach(() => resetTemplateCacheForTest());

// --- registry -------------------------------------------------------------

test('listTemplateIds returns the phase-2 defaults plus the phase-3 speaker trio', () => {
  assert.deepEqual(listTemplateIds().sort(), [
    'account.welcome',
    'auth.otp',
    'feedback.confirmation',
    // §6.3 phase 3: tokenized WITH the invite/wizard pipeline, not after
    // it — a non-CJS deployment cannot exercise the pipeline otherwise
    // (issue #21, issue #22).
    'speaker.accepted',
    'speaker.confirmation',
    'speaker.invite',
  ]);
});

test('getDefaultTemplate returns modules for known ids, null otherwise', () => {
  assert.equal(getDefaultTemplate('auth.otp').id, 'auth.otp');
  assert.equal(getDefaultTemplate('account.welcome').id, 'account.welcome');
  assert.equal(getDefaultTemplate('nope'), null);
});

test('storeRendered flags match the spec', () => {
  assert.equal(getDefaultTemplate('auth.otp').storeRendered, false);
  assert.equal(getDefaultTemplate('account.welcome').storeRendered, true);
  // The invitation body carries a bearer token, so it gets auth.otp's
  // treatment rather than account.welcome's (§3.1: never persist rendered
  // content for auth mail). The acceptance confirmation carries none.
  assert.equal(getDefaultTemplate('speaker.invite').storeRendered, false);
  assert.equal(getDefaultTemplate('speaker.accepted').storeRendered, true);
  assert.equal(getDefaultTemplate('speaker.confirmation').storeRendered, true);
});

test('required tokens match the spec', () => {
  assert.deepEqual(getDefaultTemplate('auth.otp').requiredTokens, ['code']);
  assert.deepEqual(getDefaultTemplate('account.welcome').requiredTokens, ['login_url']);
  assert.deepEqual(getDefaultTemplate('speaker.invite').requiredTokens, ['invite_url']);
  assert.deepEqual(getDefaultTemplate('speaker.accepted').requiredTokens, ['profile_wizard_url']);
  assert.deepEqual(getDefaultTemplate('speaker.confirmation').requiredTokens, ['session_title']);
});

test('an override that drops the invite link is refused at save time', () => {
  const { validateOverridePayload } = require('./templates.cjs');
  const check = validateOverridePayload('speaker.invite', {
    html: '<p>Come and speak at {{event_name}}.</p>',
    text: 'Come and speak at {{event_name}}.',
  });
  assert.equal(check.ok, false);
  assert.equal(check.errors.some((e) => e.includes('{{invite_url}}')), true);
});

// --- shipped defaults are self-consistent ----------------------------------

test('every shipped default passes validateTemplateBody against itself', () => {
  for (const id of listTemplateIds()) {
    const t = getDefaultTemplate(id);
    const check = validateTemplateBody(t, { subject: t.subject, html: t.html, text: t.text });
    assert.deepEqual(check.errors, [], `${id}: ${check.errors.join('; ')}`);
    assert.equal(check.ok, true);
  }
});

test('no default references a token missing from its tokens list (incl. layout)', () => {
  const { referencedTokens } = renderInternals;
  for (const id of listTemplateIds()) {
    const t = getDefaultTemplate(id);
    const declared = new Set(t.tokens);
    for (const body of [t.subject, t.html, t.text]) {
      for (const name of referencedTokens(body)) {
        assert.ok(declared.has(name), `${id}: {{${name}}} not declared`);
      }
    }
  }
});

test('layout wrapper references exactly its declared LAYOUT_TOKENS', () => {
  const { referencedTokens } = renderInternals;
  assert.deepEqual([...referencedTokens(wrap(''))].sort(), [...LAYOUT_TOKENS].sort());
});

test('every _html token in a shipped default has a resolver', () => {
  for (const id of listTemplateIds()) {
    for (const token of getDefaultTemplate(id).tokens) {
      if (token.endsWith('_html')) {
        assert.ok(renderInternals.HTML_TOKEN_RESOLVERS[token], `${id}: no resolver for ${token}`);
      }
    }
  }
});

// --- render integration ----------------------------------------------------

test('auth.otp renders the code into both html and text', () => {
  const out = render({
    template: getDefaultTemplate('auth.otp'),
    tokenValues: { code: '482913', expiry_minutes: '10' },
    config: CONFIG,
  });
  assert.ok(out.html.includes('482913'));
  assert.ok(out.text.includes('482913'));
  assert.ok(out.text.includes('10 minutes'));
  assert.ok(out.subject.includes('Example Summit 2027'));
  // {{brand_primary}} substituted into the header band:
  assert.ok(out.html.includes('BRAND_PRIMARY_SENTINEL'));
  assert.ok(out.html.includes('help@example.org'));
  assert.equal(out.usedFallback, false);
  assert.deepEqual(out.warnings, []);
});

test('account.welcome renders login_url in both bodies and next_steps_html from config', () => {
  const out = render({
    template: getDefaultTemplate('account.welcome'),
    tokenValues: { first_name: 'Ada', profile_url: 'https://summit.example.org/profile' },
    config: CONFIG,
  });
  assert.ok(out.html.includes('https://summit.example.org/login'));
  assert.ok(out.text.includes('https://summit.example.org/login'));
  assert.ok(out.html.includes('<ul>')); // next_steps_html raw in html
  assert.ok(!out.text.includes('<ul>')); // stripped in text
  assert.deepEqual(out.warnings, []);
});

// --- loader caching ---------------------------------------------------------

test('loadTemplate reads once within the TTL and re-reads after', async () => {
  const db = makeFakeDb({ 'auth.otp': { subject: 'Custom {{event_name}} code' } });
  let clock = 1_000_000;
  const now = () => clock;

  const first = await loadTemplate({ db, id: 'auth.otp', now });
  assert.equal(first.template.id, 'auth.otp');
  assert.equal(first.override.subject, 'Custom {{event_name}} code');
  assert.equal(db.reads['auth.otp'], 1);

  clock += internals.CACHE_TTL_MS - 1;
  await loadTemplate({ db, id: 'auth.otp', now });
  assert.equal(db.reads['auth.otp'], 1);

  clock += 2;
  await loadTemplate({ db, id: 'auth.otp', now });
  assert.equal(db.reads['auth.otp'], 2);
});

test('loadTemplate caches an absent override as null', async () => {
  const db = makeFakeDb({});
  const now = () => 5_000;
  const first = await loadTemplate({ db, id: 'account.welcome', now });
  assert.equal(first.override, null);
  await loadTemplate({ db, id: 'account.welcome', now });
  assert.equal(db.reads['account.welcome'], 1);
});

test('loadTemplate caches per id, not globally', async () => {
  const db = makeFakeDb({});
  const now = () => 5_000;
  await loadTemplate({ db, id: 'auth.otp', now });
  await loadTemplate({ db, id: 'account.welcome', now });
  assert.equal(db.reads['auth.otp'], 1);
  assert.equal(db.reads['account.welcome'], 1);
});

test('loadTemplate throws for an unknown id without touching the db', async () => {
  const db = makeFakeDb({});
  await assert.rejects(loadTemplate({ db, id: 'nope' }), /unknown template id/);
  assert.deepEqual(db.reads, {});
});

// --- validateOverridePayload -------------------------------------------------

test('accepts a valid partial override', () => {
  const res = validateOverridePayload('auth.otp', {
    subject: 'Code for {{event_name}}',
    text: 'Your code: {{code}} ({{expiry_minutes}} min). Help: {{support_email}}',
  });
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

test('rejects protected keys by name and unknown keys', () => {
  const res = validateOverridePayload('auth.otp', {
    subject: 'ok {{code}}',
    tokens: ['code'],
    requiredTokens: [],
    storeRendered: true,
    banana: 'x',
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.includes('tokens may not be overridden'));
  assert.ok(res.errors.includes('requiredTokens may not be overridden'));
  assert.ok(res.errors.includes('storeRendered may not be overridden'));
  assert.ok(res.errors.includes('unknown key: banana'));
});

test('rejects non-string and empty values', () => {
  const res = validateOverridePayload('auth.otp', { subject: 42, html: '   ' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('subject must be a non-empty string')));
  assert.ok(res.errors.some((e) => e.includes('html must be a non-empty string')));
});

test('rejects unknown tokens in the override body', () => {
  const res = validateOverridePayload('auth.otp', { subject: 'Hi {{surprise}}' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('unknown token {{surprise}}')));
});

test('rejects an override that drops a required token', () => {
  const res = validateOverridePayload('auth.otp', { text: 'Sign in soon!' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('missing required token {{code}}')));
});

test('rejects unknown template ids and non-object payloads', () => {
  assert.equal(validateOverridePayload('nope', {}).ok, false);
  assert.equal(validateOverridePayload('auth.otp', null).ok, false);
  assert.equal(validateOverridePayload('auth.otp', ['x']).ok, false);
});

test('a valid override merges over defaults through render', () => {
  const template = getDefaultTemplate('auth.otp');
  const override = { subject: 'Custom: {{code}}' };
  assert.equal(validateOverridePayload('auth.otp', override).ok, true);
  const out = render({ template, override, tokenValues: { code: '9', expiry_minutes: '5' }, config: CONFIG });
  assert.equal(out.subject, 'Custom: 9');
  assert.equal(out.usedFallback, false);
});
