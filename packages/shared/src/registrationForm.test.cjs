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
  assert.deepEqual(questions.map((q) => q.name), ['Organization', 'Dietary needs', 'Attendee directory', 'T-shirt size', 'Topics']);
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

const { answerText, summarizeAnswers } = require('./registrationForm.cjs');

test('an answer reads as plain text for staff and the export', () => {
  const questions = activeQuestions(validateRegistrationForm({ ...FORM, standard: { ...FORM.standard, photoConsent: { enabled: true } } }).form);
  const byId = Object.fromEntries(questions.map((q) => [q.id, q]));
  assert.equal(answerText(byId.dietary, { choices: ['Vegan', 'Other'], other: 'Low sodium' }), 'Vegan; Other: Low sodium');
  assert.equal(answerText(byId.directoryListing, 'attendees_only'), 'List me only for other attendees');
  assert.equal(answerText(byId.photoConsent, false), 'No');
  assert.equal(answerText(byId.q_topics, ['Revenue', 'Audience']), 'Revenue; Audience');
  assert.equal(answerText(byId.organization, undefined), '');
});

test('the counts summary tallies diet, access and photo answers for planning', () => {
  const form = validateRegistrationForm({ standard: { dietary: { enabled: true }, accessNeeds: { enabled: true }, photoConsent: { enabled: true } } }).form;
  const summary = summarizeAnswers([
    { answers: { dietary: { choices: ['Vegan'], other: null }, accessNeeds: 'Step-free stage.', photoConsent: true } },
    { answers: { dietary: { choices: ['Vegan', 'Other'], other: 'Low sodium' }, photoConsent: false } },
    { answers: {} },
  ], form);
  assert.deepEqual(summary, {
    total: 3,
    dietary: { answered: 2, choices: { Vegan: 2, Other: 1 }, other: ['Low sodium'] },
    accessNeeds: { answered: 1 },
    photoConsent: { yes: 1, no: 1 },
  });
  assert.deepEqual(summarizeAnswers([], emptyForm()), { total: 0 });
});

test('the summary counts only answers on tickets that are still valid, and reads each answer with the question it answered', () => {
  const form = validateRegistrationForm({ standard: { dietary: { enabled: true } } }).form;
  const summary = summarizeAnswers([
    { ticketStatus: 'valid', answers: { dietary: { choices: ['Vegan'] } } },
    { ticketStatus: 'refunded', answers: { dietary: { choices: ['Vegan'] } } },
    { answers: { dietary: { choices: ['Halal'] } } },
  ], form);
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.dietary.choices, { Vegan: 1, Halal: 1 });
  // A yes/no answer stays readable after the question became short text.
  const now = { id: 'q_x', name: 'Bring a guest', kind: 'short_text' };
  const answered = { id: 'q_x', name: 'Bring a guest?', kind: 'yes_no' };
  assert.equal(answerText(now, false, answered), 'No');
  assert.equal(answerText(now, 'Maybe'), 'Maybe');
});

test('answerFromText reads a CSV cell back into the answer answerText writes', () => {
  const { answerFromText, answerText } = require('./registrationForm.cjs');
  const questions = Object.fromEntries(activeQuestions({
    ...FORM, standard: { ...FORM.standard, photoConsent: { enabled: true } },
  }).map((question) => [question.id, question]));
  const cases = [
    ['organization', 'Gazette'],
    ['photoConsent', true],
    ['photoConsent', false],
    ['directoryListing', 'attendees_only'],
    ['q_shirt', 'M'],
    ['q_topics', ['Revenue', 'Audience']],
    ['dietary', { choices: ['Vegan', 'Other'], other: 'No mushrooms' }],
  ];
  for (const [id, value] of cases) {
    assert.deepEqual(answerFromText(questions[id], answerText(questions[id], value)), value, id);
  }
  // Loose spellings an export from another platform uses.
  assert.equal(answerFromText(questions.photoConsent, ' YES '), true);
  assert.equal(answerFromText(questions.photoConsent, 'n'), false);
  assert.equal(answerFromText(questions.directoryListing, 'private'), 'private');
  assert.equal(answerFromText(questions.q_shirt, ' m '), 'M');
  assert.deepEqual(answerFromText(questions.q_topics, 'audience;revenue'), ['Audience', 'Revenue']);
  assert.deepEqual(answerFromText(questions.dietary, 'vegetarian; gluten-free'), { choices: ['Vegetarian', 'Gluten-free'], other: '' });
  // Blank is no answer; a value no choice matches is kept as typed so checkAnswers names it.
  assert.equal(answerFromText(questions.organization, '   '), undefined);
  assert.equal(answerFromText(questions.q_shirt, 'XXL'), 'XXL');
  assert.equal(answerFromText(questions.photoConsent, 'maybe'), 'maybe');
  assert.deepEqual(checkAnswers({ q_shirt: 'XXL', organization: 'Gazette' }, FORM).ok, false);
});

test('answerFromText keeps a choice that contains a semicolon, and reads Other without a slow pattern', () => {
  const { answerFromText, answerText } = require('./registrationForm.cjs');
  const question = { id: 'q_pick', kind: 'many_choices', choices: ['A; B', 'A', 'B'] };
  assert.deepEqual(answerFromText(question, answerText(question, ['A; B'])), ['A; B']);
  assert.deepEqual(answerFromText(question, 'A; B; B'), ['A; B', 'B']);
  assert.deepEqual(answerFromText(question, 'a;b'), ['A; B']);
  const dietary = { id: 'dietary', kind: 'dietary', choices: [] };
  assert.deepEqual(answerFromText(dietary, 'Vegan; Other: no nuts; no shellfish'), { choices: ['Vegan', 'Other'], other: 'no nuts; no shellfish' });
  // A long run of tabs after "other" returns at once (CodeQL: polynomial regex).
  const started = Date.now();
  answerFromText(dietary, `other${'\t'.repeat(50000)}x`);
  assert.ok(Date.now() - started < 200);
});

test('choice import parsing bounds work by configured choices even for a delimiter-filled cell', () => {
  const { answerFromText } = require('./registrationForm.cjs');
  const question = { kind: 'many_choices', choices: ['News; local', 'Revenue'] };
  assert.deepEqual(answerFromText(question, ';'.repeat(4990) + 'unknown'), ['unknown']);
  assert.deepEqual(answerFromText(question, 'news ; LOCAL; Revenue'), ['News; local', 'Revenue']);
});
