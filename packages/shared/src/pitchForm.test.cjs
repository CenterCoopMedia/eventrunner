'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkPitch, readPitchFormOptions, validatePitchFormOptions, presenterList, readPresenters,
  DEFAULT_FORM_OPTIONS, STEP_FIELDS, LIMITS,
} = require('./pitchForm.cjs');

const OPTIONS = {
  formats: ['Panel', 'Workshop'],
  lengths: [30, 60],
  tracks: ['Revenue', 'Audience'],
  maxCoPresenters: 2,
};

const FULL = {
  title: '  Local news in the library  ',
  summary: 'How libraries host newsrooms.',
  description: 'A full description.',
  organization: 'Example Library',
  format: 'Workshop',
  lengthMinutes: 60,
  track: 'Audience',
  audienceLevel: 'beginner',
  leadName: 'Ada Reporter',
  leadRole: 'Editor',
  presenters: [{ name: 'Bo Writer', email: 'Bo@Example.org', organization: '', role: 'Reporter' }],
  accessNeeds: 'Step-free stage.',
  notes: '',
  consent: true,
};

test('a complete pitch passes and comes back trimmed and normalized', () => {
  const result = checkPitch(FULL, { options: OPTIONS, submitterEmail: 'ada@example.org' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.pitch.title, 'Local news in the library');
  assert.equal(result.pitch.notes, null);
  assert.deepEqual(result.pitch.presenters, [{ name: 'Bo Writer', email: 'bo@example.org', organization: null, role: 'Reporter' }]);
});

test('the required fields are named with a sentence for a person', () => {
  const result = checkPitch({}, { options: OPTIONS });
  assert.deepEqual(Object.keys(result.errors).sort(), ['consent', 'description', 'leadName', 'title']);
  assert.equal(result.errors.title, 'Enter a session title.');
});

test('a step checks only its own fields', () => {
  const session = checkPitch({ title: 'T' }, { options: OPTIONS, fields: STEP_FIELDS.session });
  assert.deepEqual(Object.keys(session.errors), ['description']);
  const format = checkPitch({ format: 'Keynote' }, { options: OPTIONS, fields: STEP_FIELDS.format });
  assert.deepEqual(format.errors, { format: 'Choose one of the listed formats.' });
});

test('choices must come from the staff lists, and a free-text format works with no list', () => {
  const bad = checkPitch({ ...FULL, lengthMinutes: 45, track: 'Other', audienceLevel: 'expert' }, { options: OPTIONS });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['audienceLevel', 'lengthMinutes', 'track']);
  const free = checkPitch({ ...FULL, format: 'Fishbowl', lengthMinutes: null, track: null }, { options: DEFAULT_FORM_OPTIONS });
  assert.equal(free.ok, true, JSON.stringify(free.errors));
  assert.equal(free.pitch.format, 'Fishbowl');
});

test('co-presenters need a name and a valid, new address, within the call limit', () => {
  const result = checkPitch({
    ...FULL,
    presenters: [
      { name: '', email: 'not-an-address' },
      { name: 'Ada again', email: 'ADA@example.org' },
      { name: 'Three', email: 'three@example.org' },
    ],
  }, { options: OPTIONS, submitterEmail: 'ada@example.org' });
  assert.equal(result.errors.presenters, 'Add at most 2 co-presenters.');
  assert.equal(result.errors['presenters.0.name'], 'Enter the co-presenter’s name.');
  assert.equal(result.errors['presenters.0.email'], 'Enter an email address like name@example.org.');
  assert.equal(result.errors['presenters.1.email'], 'This address is already on the pitch.');
  const none = checkPitch({ ...FULL }, { options: { ...OPTIONS, maxCoPresenters: 0 } });
  assert.equal(none.errors.presenters, 'This call takes one presenter per pitch.');
});

test('lengths over the limit and wrong types are refused, not cut', () => {
  const long = checkPitch({ ...FULL, title: 'x'.repeat(LIMITS.title + 1), notes: 7 }, { options: OPTIONS });
  assert.equal(long.errors.title, `Use at most ${LIMITS.title} characters.`);
  assert.equal(long.errors.notes, 'notes: must be text.');
});

test('stored option lists read safely, and a damaged list reads as none', () => {
  assert.deepEqual(readPitchFormOptions(null), { formats: [], lengths: [], tracks: [], maxCoPresenters: 4 });
  const read = readPitchFormOptions({ formOptions: { formats: ['Panel', 'panel', '', 7], lengths: [60, 30, 2, 30.5], tracks: 'x', maxCoPresenters: 9 } });
  assert.deepEqual(read, { formats: ['Panel'], lengths: [30, 60], tracks: [], maxCoPresenters: 4 });
});

test('an operator save of option lists is refused by name when wrong', () => {
  assert.deepEqual(validatePitchFormOptions({ formats: [' Panel '], lengths: [60, 30], tracks: [], maxCoPresenters: 1 }), {
    ok: true, options: { formats: ['Panel'], lengths: [30, 60], tracks: [], maxCoPresenters: 1 },
  });
  const bad = validatePitchFormOptions({ formats: ['A', 'a'], lengths: [3], extra: true, maxCoPresenters: 5 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.startsWith('extra:')));
  assert.ok(bad.errors.some((e) => e.includes('listed twice')));
  assert.ok(bad.errors.some((e) => e.startsWith('lengths:')));
  assert.ok(bad.errors.some((e) => e.startsWith('maxCoPresenters:')));
});

test('the stored presenter list starts with the lead, and an old pitch reads as one lead', () => {
  const { pitch } = checkPitch(FULL, { options: OPTIONS });
  const list = presenterList(pitch, 'ada@example.org');
  assert.deepEqual(list.map((p) => [p.name, p.email, p.lead]), [['Ada Reporter', 'ada@example.org', true], ['Bo Writer', 'bo@example.org', false]]);
  assert.deepEqual(readPresenters({ email: 'old@example.org', organization: 'Org' }), [
    { name: null, email: 'old@example.org', organization: 'Org', role: null, lead: true },
  ]);
});
