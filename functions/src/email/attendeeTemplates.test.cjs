'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDefaultTemplate } = require('./templates.cjs');
const { validateTemplateBody } = require('./render.cjs');
const { attendeeLanguage, registrationLanguage } = require('./attendeeLanguage.cjs');
const { renderAttendeeTemplate, spanishTemplateVariant } = require('./attendeeTemplates.cjs');
const announcement = require('./templates/announcement.email.cjs');

test('attendee mail uses saved registration language then the configured event default', () => {
  const event = { contentLanguages: { default: 'es', available: ['en', 'es'] } };
  assert.equal(attendeeLanguage({ registrationLanguage: 'en' }, event), 'en');
  assert.equal(attendeeLanguage(null, event), 'es');
  assert.equal(attendeeLanguage({ registrationLanguage: 'es' }, {}), 'es');
  assert.equal(registrationLanguage(event, 'es'), 'es');
  assert.equal(registrationLanguage({}, 'es'), null);
  assert.equal(registrationLanguage(event, ['es']), null);
});

test('Spanish attendee variants preserve required tokens in each body and English overrides fall back by unit', () => {
  for (const template of [announcement, ...[
    'attendee.approved', 'ticket.order_confirmation', 'ticket.attendee_confirmation',
    'changeRequest.received', 'changeRequest.done', 'changeRequest.declined',
  ].map(getDefaultTemplate)]) {
    const variant = spanishTemplateVariant(template.id);
    assert.deepEqual(validateTemplateBody(template, variant).errors, [], template.id);
    assert.match(variant.html, /<html lang="es">/);
  }
  const template = getDefaultTemplate('attendee.approved');
  const config = { event: { name: 'Fixture Event' } };
  const tokenValues = { attendee_name: 'Ada', dashboard_url: 'https://example.test/dashboard', registration_url: '' };
  const rendered = renderAttendeeTemplate({ template, override: { subject: 'Registration accepted' }, config, tokenValues, language: 'es' });
  assert.equal(rendered.subject, 'Registration accepted');
  assert.match(rendered.text, /Abre tu panel: https:\/\/example.test\/dashboard/);
  const fallback = renderAttendeeTemplate({ template, override: { html: template.html }, config, tokenValues, language: 'es' });
  assert.match(fallback.html, /<html lang="en">/);
  assert.match(fallback.text, /Open your dashboard/);
  const unnamed = { ...tokenValues, attendee_name: '' };
  const spanish = renderAttendeeTemplate({ template, config, tokenValues: unnamed, language: 'es' });
  assert.match(spanish.text, /^Hola:/);
  assert.match(spanish.html, /<p>Hola:<\/p>/);
  const english = renderAttendeeTemplate({ template, override: { html: template.html }, config, tokenValues: unnamed, language: 'es' });
  assert.match(english.text, /there/);
});
