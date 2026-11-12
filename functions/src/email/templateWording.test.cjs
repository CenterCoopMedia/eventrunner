'use strict';

// The template wording helpers on their own. The speaker mail endpoint
// tests (speakers/mailTemplates.test.cjs) drive them through the handler.

const test = require('node:test');
const assert = require('node:assert/strict');

const { readWording, readDraft, renderWording, WordingError } = require('./templateWording.cjs');
const { resetTemplateCacheForTest, loadTemplate } = require('./templates.cjs');
const { defaultSpeakerWordingFields } = require('./speakerWordingFields.cjs');
const { makeSpeakersDb } = require('../speakers/speakersFake.cjs');

const CONFIG = {
  event: { name: 'Example Summit', legal: { postalAddressHtml: 'Example Org<br>1 Main St' } },
  theme: { colors: {} },
  tierA: { publicUrl: 'https://summit.example.org' },
};
const VALUES = { speaker_name: 'Sample Speaker', profile_wizard_url: 'https://summit.example.org/speaker/profile' };

test.beforeEach(() => resetTemplateCacheForTest());

test('readDraft returns null for a body with no wording only when a draft is optional', () => {
  assert.equal(readDraft('speaker.accepted', { action: 'preview' }, { required: false }), null);
  assert.throws(() => readDraft('speaker.accepted', {}), WordingError);
  assert.deepEqual(readDraft('speaker.accepted', { subject: 'Hi {{speaker_name}}', other: 1 }), { subject: 'Hi {{speaker_name}}' });
});

test('readDraft builds plain fields into the fixed source before validation', () => {
  const fields = {
    ...defaultSpeakerWordingFields('speaker.accepted'),
    buttonLabel: 'Open your profile',
  };
  const draft = readDraft('speaker.accepted', { fields });
  assert.equal(draft.subject, fields.subject);
  assert.match(draft.html, /href="\{\{profile_wizard_url\}\}"[^>]*>Open your profile<\/a>/);
  assert.ok(draft.html.includes('Questions? Write to'));
  assert.ok(draft.text.includes('{{profile_wizard_url}}'));
});

test('readDraft reports blank, unknown and malformed plain fields by their visible names', () => {
  const fields = defaultSpeakerWordingFields('speaker.invite');
  assert.throws(
    () => readDraft('speaker.invite', { fields: { ...fields, greeting: '  ' } }),
    (err) => err instanceof WordingError && err.message === 'greeting: Enter wording for this field.',
  );
  assert.throws(
    () => readDraft('speaker.invite', { fields: { ...fields, invitation: 'Welcome, {{unknown}}.' } }),
    (err) => err instanceof WordingError && err.message === 'invitation: unknown token {{unknown}}',
  );
  assert.throws(
    () => readDraft('speaker.invite', { fields: { ...fields, invitation: 'Welcome, {{event-name}}.' } }),
    (err) => err instanceof WordingError && err.message === 'invitation: malformed placeholder {{event-name}}',
  );
});

test('readWording marks valid custom structure as unsupported without changing it', async () => {
  const db = makeSpeakersDb({
    'email_templates/speaker.invite': {
      subject: 'Custom {{event_name}}',
      html: '<p><a href="{{invite_url}}">Custom invitation</a></p>',
      text: 'Custom invitation: {{invite_url}}',
    },
  });
  const wording = await readWording({ db, id: 'speaker.invite' });
  assert.deepEqual(wording.savedErrors, []);
  assert.equal(wording.saved.html, '<p><a href="{{invite_url}}">Custom invitation</a></p>');
  assert.equal(wording.editor.kind, 'unsupported');
});

test('renderWording reads saved wording fresh, past a cached older copy', async () => {
  const db = makeSpeakersDb({});
  // speaker.confirmation is a cached id: this caches its absent override.
  await loadTemplate({ db, id: 'speaker.confirmation' });
  await db.collection('email_templates').doc('speaker.confirmation').set({ subject: 'Saved for {{event_name}}' });
  const out = await renderWording({ db, id: 'speaker.confirmation', tokenValues: VALUES, config: CONFIG });
  assert.equal(out.source, 'saved');
  assert.equal(out.subject, 'Saved for Example Summit');
  // The legal footer the email core adds is in the rendered text once.
  assert.equal(out.text.split('Example Org').length - 1, 1);
});

test('renderWording labels a draft, and saved wording that fails its check as shipped', async () => {
  const db = makeSpeakersDb({ 'email_templates/speaker.accepted': { text: 'No link.' } });
  const saved = await renderWording({ db, id: 'speaker.accepted', tokenValues: VALUES, config: CONFIG });
  assert.equal(saved.source, 'shipped');
  assert.equal(saved.usedFallback, true);
  assert.match(saved.overrideErrors.join(' '), /missing required token/);
  const draft = await renderWording({
    db, id: 'speaker.accepted', draft: { subject: 'Draft' }, tokenValues: VALUES, config: CONFIG,
  });
  assert.equal(draft.source, 'draft');
  assert.equal(draft.subject, 'Draft');
});
