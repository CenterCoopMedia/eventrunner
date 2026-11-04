'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildEvent } = require('shared/answers');
const { validateEventConfig } = require('shared/config');
const { cleanStep, emptyAnswers, withDefaults } = require('./answers.cjs');
const { checkAnswers, stepErrors, toInitAnswers } = require('./checks.cjs');
const { validAnswers } = require('./testData.cjs');

test('a complete set of answers passes every check', () => {
  assert.deepEqual(checkAnswers(validAnswers()), {});
});

test('empty answers name every required field, by path, in plain words', () => {
  const errors = checkAnswers(emptyAnswers());
  assert.deepEqual(Object.keys(errors).sort(), [
    'email.replyTo', 'email.senderName', 'event.days', 'event.name', 'event.shortName', 'event.timezone',
    'organization.address', 'organization.name', 'tickets.choice', 'webAddress.name',
  ]);
  assert.equal(errors['event.days'], 'Add at least one day.');
  for (const message of Object.values(errors)) {
    assert.ok(!/firebase|project|tenant|must be|nonempty/i.test(message), message);
  }
});

test('the event step uses the shared rules: a real date, a real time zone, times in order, days in order', () => {
  const answers = validAnswers();
  answers.event.timezone = 'Mars/Olympus';
  answers.event.days = [
    { date: '2027-05-14', startTime: '09:00', endTime: '17:00' },
    { date: '2027-05-13', startTime: '10:00', endTime: '09:00' },
    { date: '2027-02-30', startTime: '9am', endTime: '17:00' },
  ];
  const errors = checkAnswers(answers);
  assert.equal(errors['event.timezone'], 'Choose a time zone.');
  assert.equal(errors['event.days.1.date'], 'Put the days in order, earliest first, with no date twice.');
  assert.equal(errors['event.days.1.endTime'], 'The end time must be after the start time.');
  assert.equal(errors['event.days.2.date'], 'Enter a real date.');
  assert.equal(errors['event.days.2.startTime'], 'Enter a start time.');
});

test('the console agrees with init-event.cjs: what passes here passes validateEventConfig', () => {
  const event = buildEvent({ answers: toInitAnswers(validAnswers()), tierA: {} });
  assert.deepEqual(validateEventConfig(event), { ok: true, errors: [] });
  assert.equal(event.sender.email, 'hello@nclocal.eventrunner.org');
  assert.equal(event.sender.replyTo, 'ops@nclocal.org');
  assert.equal(event.legal.operatorName, 'NC Local');
  assert.equal(event.legal.postalAddressHtml, '1 Main Street<br>Raleigh, NC 27601');
  assert.equal(event.seo.organizerUrl, 'https://nclocal.org/');
  assert.deepEqual(event.days, [{ id: 'day-1', label: 'Day 1', date: '2027-05-13', startTime: '09:00', endTime: '17:00' }]);
});

test('toInitAnswers escapes the mailing address for the email footer', () => {
  const answers = validAnswers();
  answers.organization.address = '<b>1 Main</b> & Co';
  assert.equal(toInitAnswers(answers).event.legal.postalAddressHtml, '&lt;b&gt;1 Main&lt;/b&gt; &amp; Co');
});

test('the organization, web address, tickets and email steps have their own checks', () => {
  const answers = validAnswers();
  answers.organization.website = 'javascript:alert(1)';
  answers.organization.address = 'short';
  answers.webAddress.name = 'admin';
  answers.tickets.choice = 'cash';
  answers.email.replyTo = 'not an address';
  answers.email.senderName = 'x'.repeat(81);
  const errors = checkAnswers(answers);
  assert.match(errors['organization.website'], /Enter a website address/);
  assert.equal(errors['organization.address'], 'Use at least 10 characters.');
  assert.equal(errors['webAddress.name'], 'This name is not available. Choose another name.');
  assert.equal(errors['tickets.choice'], 'Choose how you sell tickets.');
  assert.equal(errors['email.replyTo'], 'Enter a valid email address.');
  assert.equal(errors['email.senderName'], 'Use 80 characters or fewer.');
});

test('stepErrors keeps one step', () => {
  const errors = { 'event.name': 'a', 'event.days.0.date': 'b', 'email.replyTo': 'c', event: 'd' };
  assert.deepEqual(stepErrors(errors, 'event'), { 'event.name': 'a', 'event.days.0.date': 'b', event: 'd' });
});

test('cleanStep keeps known keys, trims text and drops what it does not know', () => {
  assert.deepEqual(cleanStep('organization', { name: '  NC  ', website: 5, extra: 'x', address: ' a ' }), {
    name: 'NC', website: '', address: 'a',
  });
  assert.deepEqual(cleanStep('tickets', { choice: 'cash' }), { choice: null });
  assert.deepEqual(cleanStep('webAddress', { name: ' NCLocal ' }), { name: 'nclocal' });
  const event = cleanStep('event', { days: [{ date: '2027-01-01', label: '' }, 'junk'], venue: 'x' });
  assert.deepEqual(event.days, [{ date: '2027-01-01', startTime: '', endTime: '' }, { date: '', startTime: '', endTime: '' }]);
  assert.deepEqual(event.venue, { name: '', address: '' });
  assert.equal(cleanStep('event', { days: Array.from({ length: 15 }, () => ({})) }).days.length, 15, 'days are not cut short');
  assert.equal(cleanStep('email', { senderName: 'x'.repeat(5000) }).senderName.length, 1000);
  assert.throws(() => cleanStep('team', {}), TypeError);
});

test('withDefaults fills a missing step', () => {
  const answers = withDefaults({ tickets: { choice: 'none' } });
  assert.equal(answers.tickets.choice, 'none');
  assert.deepEqual(answers.webAddress, { name: '' });
});
