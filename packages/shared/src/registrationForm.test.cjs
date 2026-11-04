'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateRegistrationForm, readRegistrationForm, activeQuestions, checkAnswers, emptyForm,
  MAX_CUSTOM_QUESTIONS, STANDARD_IDS,
} = require('./registrationForm.cjs');

const SHIRT = { id: 'q_shirt', kind: 'one_choice', label: ' T-shirt size ', choices: ['S', 'M', 'L'], required: true };
const FORM = {
  standard: { organization: { enabled: true, required: true }, dietary: { enabled: true, required: false }, directoryListing: { enabled: true } },
  custom: [SHIRT, { id: 'q_topics', kind: 'many_choices', label: 'Topics', help: 'Pick any.', choices: ['Revenue', 'Audience'] }],
};

test('an operator save is checked whole and comes back trimmed, with off questions never required', () => {
  const result = validateRegistrationForm({ ...FORM, standard: { ...FORM.standard, photoConsent: { enabled: false, required: true } } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(Object.keys(result.form.standard), STANDARD_IDS);
  assert.deepEqual(result.form.standard.photoConsent, { enabled: false, required: false });
  assert.deepEqual(result.form.standard.jobTitle, { enabled: false, required: false });
  assert.equal(result.form.custom[0].label, 'T-shirt size');
  assert.equal(result.form.custom[1].required, false);
});

test('a bad save is refused by field, with nothing about revision accepted from the client', () => {
  const bad = validateRegistrationForm({
    revision: 3,
    standard: { badges: { enabled: true }, dietary: { enabled: 'yes' } },
    custom: [
      { id: 'shirt', kind: 'dropdown', label: '' },
      { id: 'q_pick', kind: 'one_choice', label: 'Pick', choices: ['A', 'a'] },
      { id: 'q_note', kind: 'short_text', label: 'Note', choices: ['x'] },
    ],
  });
  assert.equal(bad.ok, false);
  for (const field of ['revision:', 'standard.badges:', 'standard.dietary:', 'custom.0.id:', 'custom.0.kind:', 'custom.0.label:', 'custom.1.choices.1:', 'custom.2.choices:']) {
    assert.ok(bad.errors.some((error) => error.startsWith(field)), `${field} in ${JSON.stringify(bad.errors)}`);
  }
  const many = validateRegistrationForm({ custom: Array.from({ length: MAX_CUSTOM_QUESTIONS + 1 }, (_, i) => ({ id: `q_item${i}`, kind: 'yes_no', label: `Q${i}` })) });
  assert.ok(many.errors.includes(`custom: use at most ${MAX_CUSTOM_QUESTIONS} questions`));
  const twice = validateRegistrationForm({ custom: [SHIRT, SHIRT] });
  assert.ok(twice.errors.includes('custom.1.id: is used twice'));
});

test('a stored form reads safely, and a damaged entry reads as off or is dropped', () => {
  assert.deepEqual(readRegistrationForm(null), emptyForm());
  const read = readRegistrationForm({ standard: { organization: { enabled: true, required: 'yes' }, dietary: 'on' }, custom: [SHIRT, { id: 'bad' }, SHIRT], revision: 4 });
  assert.deepEqual(read.standard.organization, { enabled: true, required: false });
  assert.deepEqual(read.standard.dietary, { enabled: false, required: false });
  assert.deepEqual(read.custom.map((q) => q.id), ['q_shirt']);
  assert.equal(read.revision, 4);
});

test('the attendee sees the standard questions that are on, in order, then the custom ones', () => {
  const questions = activeQuestions(validateRegistrationForm(FORM).form);
  assert.deepEqual(questions.map((q) => [q.id, q.required]), [
    ['organization', true], ['dietary', false], ['directoryListing', false], ['q_shirt', true], ['q_topics', false],
  ]);
  assert.equal(questions.find((q) => q.id === 'dietary').sensitive, true);
  assert.ok(questions.find((q) => q.id === 'dietary').choices.includes('Other'));
  // Every standard question has a short name for staff.
  const { STANDARD_QUESTIONS } = require('./registrationForm.cjs');
  for (const question of STANDARD_QUESTIONS) assert.ok(question.name && question.name.length <= 30, question.id);
});

test('answers are checked against the form, trimmed, and an answer to a removed question is refused', () => {
  const form = validateRegistrationForm(FORM).form;
  const ok = checkAnswers({
    organization: ' Example News ', dietary: { choices: ['Other', 'Vegan'], other: ' Low sodium ' }, directoryListing: 'private',
    q_shirt: 'M', q_topics: ['Audience', 'Revenue', 'Audience'],
  }, form);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.answers, {
    organization: 'Example News', dietary: { choices: ['Vegan', 'Other'], other: 'Low sodium' }, directoryListing: 'private',
    q_shirt: 'M', q_topics: ['Revenue', 'Audience'],
  });
  const bad = checkAnswers({ organization: '', dietary: { choices: ['Other'] }, q_shirt: 'XL', q_gone: 'x', directoryListing: 'everyone' }, form);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, {
    q_gone: 'This question is no longer asked.',
    organization: 'Answer this question.',
    dietary: 'Describe your other dietary need.',
    directoryListing: 'Choose how you appear in the directory.',
    q_shirt: 'Choose one of the listed answers.',
  });
  // Optional questions may be left blank, and a blank answer is not stored.
  const blank = checkAnswers({ organization: 'Org', q_shirt: 'S', q_topics: [] }, form);
  assert.deepEqual(blank, { ok: true, answers: { organization: 'Org', q_shirt: 'S' } });
});
