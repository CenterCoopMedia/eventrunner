'use strict';

// The three pitch emails (issue #324), rendered through the shipped
// registry and render.cjs: token escaping, edited wording, and validation.
const test = require('node:test');
const assert = require('node:assert/strict');

const { render } = require('./render.cjs');
const { getDefaultTemplate, validateOverridePayload } = require('./templates.cjs');
const { pitchNoticeOverride } = require('./templates/pitchNotice.cjs');

const CONFIG = {
  event: {
    name: 'Example Summit',
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.org' },
    social: { handles: [] },
  },
  theme: { colors: { primary: 'BRAND_PRIMARY_SENTINEL' } },
  tierA: { publicUrl: 'https://summit.example.org' },
};
const HOSTILE_TITLE = '<script>alert(1)</script> & "quotes"';

test('the receipt escapes the pitch title in html and keeps it plain in text', () => {
  const out = render({ template: getDefaultTemplate('pitch.receipt'), tokenValues: { pitch_title: HOSTILE_TITLE }, config: CONFIG });
  assert.deepEqual(out.warnings, []);
  assert.equal(out.subject, 'We received your session pitch for Example Summit');
  assert.ok(out.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'));
  assert.ok(!out.html.includes('<script>'));
  assert.ok(out.text.includes(`We received “${HOSTILE_TITLE}”.`));
  assert.ok(out.html.includes('BRAND_PRIMARY_SENTINEL'), 'the shared branded layout wraps the body');
  assert.ok(out.text.includes('Example Org\n1 Main St'), 'the text footer carries the postal block');
  assert.ok(!out.text.includes('A note from the organizers'));
});

test('a decision email shows submitter feedback only when staff write it, escaped', () => {
  for (const id of ['pitch.accepted', 'pitch.declined']) {
    const template = getDefaultTemplate(id);
    const without = render({ template, tokenValues: { pitch_title: 'Panel', submitter_feedback: '' }, config: CONFIG });
    assert.ok(!without.html.includes('A note from the organizers'), id);
    assert.ok(!without.text.includes('A note from the organizers'), id);
    const feedback = 'Shorten it to 30 minutes.\n<img src=x onerror=alert(1)>';
    const withNote = render({ template, tokenValues: { pitch_title: 'Panel', submitter_feedback: feedback }, config: CONFIG });
    assert.deepEqual(withNote.warnings, [], id);
    assert.ok(withNote.html.includes('A note from the organizers:'), id);
    assert.ok(withNote.html.includes('Shorten it to 30 minutes.\n&lt;img src=x onerror=alert(1)&gt;'), id);
    assert.ok(!withNote.html.includes('<img'), id);
    assert.ok(withNote.text.includes(`A note from the organizers:\n${feedback}`), id);
  }
});

test('edited wording becomes escaped paragraphs in html and the same words in text', () => {
  const override = pitchNoticeOverride('pitch.accepted', {
    subject: 'Accepted: {{pitch_title}}',
    wording: 'Hi there,\n\nWe <b>accepted</b> “{{pitch_title}}”.\nSee you at {{event_name}}.\n\n\nThanks.',
  });
  assert.deepEqual(validateOverridePayload('pitch.accepted', override), { ok: true, errors: [] });
  const out = render({ template: getDefaultTemplate('pitch.accepted'), override, tokenValues: { pitch_title: 'A & B' }, config: CONFIG });
  assert.equal(out.usedFallback, false);
  assert.equal(out.subject, 'Accepted: A & B');
  assert.ok(out.html.includes('<p style="margin:0 0 16px 0;">We &lt;b&gt;accepted&lt;/b&gt; “A &amp; B”.<br>See you at Example Summit.</p>'));
  assert.ok(out.html.includes('<p style="margin:0 0 16px 0;">Thanks.</p>'));
  assert.ok(out.text.startsWith('Hi there,\n\nWe <b>accepted</b> “A & B”.\nSee you at Example Summit.\n\nThanks.\n\n'));
});

test('edited wording is validated against each email’s token list', () => {
  const unknown = validateOverridePayload('pitch.declined', pitchNoticeOverride('pitch.declined', { subject: 'x', wording: 'Notes: {{private_notes}}' }));
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some((error) => error.includes('unknown token {{private_notes}}')));
  // A receipt has no staff note to show.
  const receipt = validateOverridePayload('pitch.receipt', pitchNoticeOverride('pitch.receipt', { subject: 'x', wording: '{{submitter_feedback}}' }));
  assert.equal(receipt.ok, false);
  const malformed = validateOverridePayload('pitch.receipt', pitchNoticeOverride('pitch.receipt', { subject: '{{pitch-title}}', wording: 'x' }));
  assert.ok(malformed.errors.some((error) => error.includes('malformed placeholder')));
});
