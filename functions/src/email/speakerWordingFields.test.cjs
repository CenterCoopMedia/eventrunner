'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SpeakerWordingFieldsError,
  buildSpeakerWording,
  parseSpeakerWording,
  defaultSpeakerWordingFields,
} = require('./templates/speakerWordingFields.cjs');

const TEMPLATE_IDS = ['speaker.invite', 'speaker.accepted', 'speaker.reminder'];

test('each shipped and edited field set makes an exact round trip', () => {
  for (const id of TEMPLATE_IDS) {
    const defaults = defaultSpeakerWordingFields(id);
    const shipped = buildSpeakerWording(id, defaults);
    assert.deepEqual(parseSpeakerWording(id, shipped), defaults);

    const edited = Object.fromEntries(Object.entries(defaults).map(([name, value]) => [
      name,
      `${value} & <plain> "quoted" 'single' {{event_name}}`,
    ]));
    const source = buildSpeakerWording(id, edited);
    assert.deepEqual(parseSpeakerWording(id, source), edited);
    assert.ok(source.html.includes('&amp; &lt;plain&gt; &quot;quoted&quot; &#39;single&#39;'));
    assert.ok(source.text.includes('& <plain> "quoted" \'single\''));
  }
});

test('blank lines and text that repeats nearby delimiters still round-trip exactly', () => {
  const cases = [
    ['speaker.invite', 'invitation', 'Accept your invitation:\n{{invite_url}}'],
    ['speaker.accepted', 'confirmation', 'Write your speaker profile\n{{profile_wizard_url}}'],
    ['speaker.reminder', 'introduction', 'Open your speaker dashboard:\n{{dashboard_url}}'],
  ];
  for (const [id, field, repeatedText] of cases) {
    const fields = {
      ...defaultSpeakerWordingFields(id),
      [field]: [
        'First paragraph.',
        '',
        repeatedText,
        '',
        '<p style="margin:0 0 16px 0;">This looks like a source delimiter.</p>',
        '',
        'Last paragraph.',
      ].join('\n'),
    };
    const source = buildSpeakerWording(id, fields);
    assert.deepEqual(parseSpeakerWording(id, source), fields);
    assert.deepEqual(buildSpeakerWording(id, parseSpeakerWording(id, source)), source);
  }
});

test('staff fields cannot add or close conditional blocks', () => {
  const fields = defaultSpeakerWordingFields('speaker.reminder');
  assert.throws(
    () => buildSpeakerWording('speaker.reminder', { ...fields, biographyItem: '{{#if needs_bio}}Biography' }),
    (err) => err instanceof SpeakerWordingFieldsError && /^biographyItem: Conditional blocks stay fixed/.test(err.message),
  );
  assert.throws(
    () => buildSpeakerWording('speaker.reminder', { ...fields, biographyItem: 'Biography {{/if}}' }),
    SpeakerWordingFieldsError,
  );
});

test('every visible field needs non-blank wording', () => {
  const fields = defaultSpeakerWordingFields('speaker.accepted');
  assert.throws(
    () => buildSpeakerWording('speaker.accepted', { ...fields, reviewNote: ' \n\t ' }),
    (err) => err instanceof SpeakerWordingFieldsError && err.message === 'reviewNote: Enter wording for this field.',
  );
});

test('a changed link, footer or reminder condition is unsupported', () => {
  const invite = buildSpeakerWording('speaker.invite');
  assert.equal(parseSpeakerWording('speaker.invite', {
    ...invite,
    html: invite.html.replace('href="{{invite_url}}"', 'href="https://other.example"'),
  }), null);
  assert.equal(parseSpeakerWording('speaker.invite', {
    ...invite,
    html: invite.html.replace('</body>', ''),
  }), null);

  const reminder = buildSpeakerWording('speaker.reminder');
  assert.equal(parseSpeakerWording('speaker.reminder', {
    ...reminder,
    text: reminder.text.replace('{{#if needs_bio}}', '{{#if needs_headshot}}'),
  }), null);
});
