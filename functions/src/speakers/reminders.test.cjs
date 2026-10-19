'use strict';

// The shipped speaker.reminder template, rendered through the same path
// the endpoint uses (renderReminder → render → withLegalFooter), plus the
// request checks and the CSV cell rule. The handler's auth, dedupe and
// demo guard run against the real Firestore emulator in
// tests/speaker-reminders.rules.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultTemplate, validateOverridePayload } = require('../email/templates.cjs');
const { speakerReadiness } = require('shared/speakerReadiness');
const {
  internals: { renderReminder, readSelection, csvForRows, reminderTokenValues, MAX_RECIPIENTS },
} = require('./reminders.cjs');

const CONFIG = {
  event: {
    name: 'Example Event',
    sender: { email: 'events@example.test', name: 'Example Event' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.test' },
    days: [{ id: 'day-1', date: '2027-05-13' }],
    social: { handles: [] },
  },
  theme: { colors: { primary: 'BRAND_PRIMARY_SENTINEL', ink: 'BRAND_INK_SENTINEL' } },
  tierA: { publicUrl: 'https://site.example.test/' },
};
const ACTOR = { uid: 'staff-1', email: 'staff@example.test' };
const HOSTILE = '<script>alert(1)</script> & "quotes"';

function hostileRecipient(overrides = {}) {
  const speaker = { firstName: HOSTILE, lastName: '', email: ' speaker@example.test ', bio: '', headshotPath: '' };
  const sessions = [{ id: 's1', title: `Panel ${HOSTILE}`, description: '', visible: true, speakerIds: ['sp1'] }];
  const readiness = speakerReadiness({ speaker, sessions, materialsBySession: {} });
  return { speaker, readiness, items: readiness.missing, ...overrides };
}

function renderShipped(recipient, override = null) {
  return renderReminder({
    template: getDefaultTemplate('speaker.reminder'),
    override,
    config: CONFIG,
    actor: ACTOR,
    ...recipient,
  });
}

test('the shipped reminder escapes names and session titles in html and keeps them plain in text', () => {
  const out = renderShipped(hostileRecipient());
  const { html, text, subject } = out.delivered;
  assert.equal(subject, 'Items we still need for Example Event');
  assert.ok(!html.includes('<script>'), 'no raw script tag reaches the html body');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'));
  assert.ok(html.includes(`Send us a description for: Panel &lt;script&gt;`));
  assert.ok(text.includes(`Hi ${HOSTILE}`));
  assert.ok(text.includes(`- Send your slides or other materials for: Panel ${HOSTILE}.`));
  assert.ok(text.includes('- Add a short biography to your speaker profile.'));
  assert.ok(text.includes('- Add a headshot to your speaker profile.'));
  assert.ok(html.includes('href="https://site.example.test/speaker/dashboard"'));
  assert.ok(text.includes('https://site.example.test/speaker/dashboard'));
  assert.ok(text.includes('write to staff@example.test'));
  // The footer the provider gets is in the preview, once.
  assert.equal(text.split('Example Org').length - 1, 1);
  assert.equal(out.message.to, 'speaker@example.test');
  assert.equal(out.message.tag, 'speaker.reminder');
  assert.equal(out.message.storeRendered, true);
});

test('a reminder names only the chosen items the speaker is missing', () => {
  const recipient = hostileRecipient();
  const out = renderShipped({ ...recipient, items: ['materials'] });
  assert.ok(!out.delivered.text.includes('biography'));
  assert.ok(!out.delivered.text.includes('headshot'));
  assert.ok(!out.delivered.text.includes('description for'));
  assert.ok(out.delivered.text.includes('materials for: Panel'));
  assert.ok(!out.delivered.html.includes('biography'));

  const values = reminderTokenValues({
    config: CONFIG,
    speaker: recipient.speaker,
    readiness: { ...recipient.readiness, bio: false },
    items: ['bio'],
    actor: ACTOR,
  });
  assert.equal(values.needs_bio, '', 'a chosen item the speaker has done is left out');
});

test('a reminder is refused when the event has no public site address', () => {
  assert.throws(
    () => renderReminder({
      template: getDefaultTemplate('speaker.reminder'),
      override: null,
      config: { ...CONFIG, tierA: {} },
      actor: ACTOR,
      ...hostileRecipient(),
    }),
    (err) => err.status === 409 && /public site address/.test(err.message),
  );
});

test('saved wording is used, and wording with an unknown token or no dashboard link is refused', () => {
  const override = {
    subject: 'Reminder from {{event_name}}',
    text: 'Dear {{speaker_name}}, open {{dashboard_url}}{{#if materials_sessions}} for {{materials_sessions}}{{/if}}.',
  };
  assert.deepEqual(validateOverridePayload('speaker.reminder', override), { ok: true, errors: [] });
  const out = renderShipped(hostileRecipient(), override);
  assert.equal(out.delivered.subject, 'Reminder from Example Event');
  assert.ok(out.delivered.text.startsWith(`Dear ${HOSTILE}, open https://site.example.test/speaker/dashboard for Panel`));
  assert.equal(out.usedFallback, false);

  const unknown = validateOverridePayload('speaker.reminder', { text: '{{dashboard_url}} {{deadline}}' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join(';'), /unknown token \{\{deadline\}\}/);

  const noLink = validateOverridePayload('speaker.reminder', { text: 'Hi {{speaker_name}}.' });
  assert.equal(noLink.ok, false);
  assert.match(noLink.errors.join(';'), /missing required token \{\{dashboard_url\}\}/);

  // A stored override that fails the check falls back to the shipped copy.
  const fallback = renderShipped(hostileRecipient(), { text: 'Hi {{nope}}' });
  assert.equal(fallback.usedFallback, true);
  assert.ok(fallback.delivered.text.includes('We still need these items'));
});

test('a selection needs one to MAX_RECIPIENTS speaker ids and known topics', () => {
  assert.throws(() => readSelection({}), /Choose at least one speaker/);
  assert.throws(() => readSelection({ speakerIds: ['a/b'] }), /speaker id/);
  assert.throws(
    () => readSelection({ speakerIds: Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `s${i}`) }),
    /at most/,
  );
  assert.throws(() => readSelection({ speakerIds: ['a'], topics: ['other'] }), /topics/);
  assert.deepEqual(readSelection({ speakerIds: ['a', 'a', 'b'], topics: ['materials'] }), {
    speakerIds: ['a', 'b'],
    topics: ['materials'],
  });
  assert.deepEqual(readSelection({ speakerIds: ['a'] }).topics, ['bio', 'headshot', 'description', 'materials']);
});

test('the readiness CSV has one row per speaker and escapes formula cells', () => {
  const stores = { speakers: new Map([['sp1', { email: '=cmd@example.test' }]]) };
  const csv = csvForRows([{
    id: 'sp1',
    name: '+Sum',
    status: 'accepted',
    readiness: {
      missing: ['bio', 'materials'],
      descriptionSessions: [],
      materialsSessions: [{ id: 's1', title: '@Panel' }, { id: 's2', title: 'Two' }],
    },
    lastRemindedAt: null,
  }], stores);
  const [header, row, end] = csv.split('\r\n');
  assert.equal(header, '"Name","Email","Status","Missing","Sessions without a description","Sessions without materials","Last reminded"');
  assert.equal(row, `"'+Sum","'=cmd@example.test","accepted","Biography; Materials","","'@Panel; Two",""`);
  assert.equal(end, '');
});
