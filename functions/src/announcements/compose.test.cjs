'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateDraft,
  renderAnnouncement,
  personalize,
  resolveChannel,
  internals,
} = require('./compose.cjs');
const { validateTemplateBody } = require('../email/render.cjs');
const { listTemplateIds } = require('../email/templates.cjs');
const announcementTemplate = require('../email/templates/announcement.email.cjs');

const CONFIG = {
  event: { name: 'Example Event', legal: { postalAddressHtml: '1 Example Street' } },
  tierA: { publicUrl: 'https://site.example.org/' },
};

test('validateDraft trims, folds the subject to one line, and requires a label with a link', () => {
  const ok = validateDraft({ subject: '  Doors\nopen  ', message: '\r\nLine one\r\n\r\nLine two\r\n' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.subject, 'Doors open');
  assert.equal(ok.value.message, 'Line one\n\nLine two');
  assert.equal(ok.value.link, null);

  const noLabel = validateDraft({ subject: 's', message: 'm', linkUrl: 'https://example.org' });
  assert.deepEqual(noLabel.errors, ['linkLabel: must contain text when the email has a link']);
  const extra = validateDraft({ subject: 's', message: 'm', html: '<b>' });
  assert.deepEqual(extra.errors, ['html: unknown field']);
  const long = validateDraft({ subject: 'x'.repeat(internals.MAX_SUBJECT_LENGTH + 1), message: 'm' });
  assert.match(long.errors[0], /subject: must be 150 characters or fewer/);
  assert.deepEqual(validateDraft(null).errors, ['draft: must be an object']);
});

test('the message becomes escaped paragraphs with line breaks kept', () => {
  assert.equal(
    internals.messageHtml('One <i>\ntwo\n\n\nThree & four'),
    '<p style="margin:0 0 16px 0;">One &lt;i&gt;<br>two</p>\n<p style="margin:0 0 16px 0;">Three &amp; four</p>',
  );
});

test('the shipped wrapper passes the template token checks and is not editable as an override', () => {
  const check = validateTemplateBody(announcementTemplate, announcementTemplate);
  assert.deepEqual(check, { ok: true, errors: [] });
  assert.ok(!listTemplateIds().includes('announcement.email'));
});

test('app mode keeps one placeholder per body until each recipient gets a link', () => {
  const draft = validateDraft({ subject: 'Hello', message: 'Body', linkUrl: 'https://example.org/a?b=1&c=2', linkLabel: 'Open' }).value;
  const rendered = renderAnnouncement({ config: CONFIG, draft, mode: 'app' });
  assert.ok(rendered.html.includes(internals.UNSUBSCRIBE_SLOT));
  assert.ok(rendered.text.includes(internals.UNSUBSCRIBE_SLOT));
  assert.ok(rendered.html.includes('https://example.org/a?b=1&amp;c=2'));
  const bodies = personalize(rendered, 'https://site.example.org/unsubscribe?s=1&r=2');
  assert.ok(bodies.html.includes('href="https://site.example.org/unsubscribe?s=1&amp;r=2"'));
  assert.ok(bodies.text.includes('Unsubscribe from announcements: https://site.example.org/unsubscribe?s=1&r=2'));
  assert.ok(!bodies.html.includes(internals.UNSUBSCRIBE_SLOT));

  const provider = renderAnnouncement({ config: CONFIG, draft, mode: 'provider' });
  assert.ok(!provider.html.includes('Unsubscribe from announcements'));
  assert.ok(!provider.text.includes('Unsubscribe from announcements'));
  assert.equal(rendered.hasLegalFooterHtml, true);
});

test('the console channel needs a public site URL for the link', async () => {
  const ok = await resolveChannel({ provider: { name: 'console' }, config: CONFIG });
  assert.deepEqual(ok, { ok: true, provider: 'console', stream: 'announcements', mode: 'app' });
  const missing = await resolveChannel({ provider: { name: 'console' }, config: { ...CONFIG, tierA: {} } });
  assert.equal(missing.code, 'site-url-missing');
});

test('a Postmark stream read that throws is refused as unavailable', async () => {
  const provider = { name: 'postmark', sendBatch() {}, async getMessageStream() { throw new Error('offline'); } };
  const verdict = await resolveChannel({ provider, config: { ...CONFIG, providers: { email: { announcementStream: 'news' } } } });
  assert.equal(verdict.code, 'stream-unavailable');
});

test('validateDraft refuses the internal render slots in any field', () => {
  // Saved messages (issue 496) and the composer share this check. Braces stay as typed
  // (the message never reaches the token engine), but a slot word would be
  // replaced after the render, so it is refused instead.
  for (const slot of [internals.BODY_SLOT, internals.UNSUBSCRIBE_SLOT]) {
    const result = validateDraft({
      subject: `Hi ${slot}`, message: `Body ${slot}`, linkUrl: 'https://example.org', linkLabel: `Go ${slot}`,
    });
    assert.deepEqual(result.errors, [
      'subject: must not contain a reserved word',
      'message: must not contain a reserved word',
      'linkLabel: must not contain a reserved word',
    ]);
  }
  assert.equal(validateDraft({ subject: '{{event_name}}', message: '{{unsubscribe_url}}' }).ok, true);
});
