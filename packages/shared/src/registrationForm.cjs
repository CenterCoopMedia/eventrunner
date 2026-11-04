'use strict';

/**
 * The attendee registration questions (ADR 0008 §4). One module, used by
 * the browser, the save endpoint, checkout and the import, so every surface
 * accepts the same form and the same answers.
 *
 * The form lives in `config/registration_form`:
 *
 *   { standard: { [id]: { enabled, required } }, custom: [question], revision }
 *
 * STANDARD questions are fixed in wording and shape; an operator turns each
 * one on or off and makes it required or optional. CUSTOM questions (at
 * most 10) are written by the operator. Answers are keyed by question id.
 *
 * Every error is `field: reason`, the shape the admin forms split on.
 */

const MAX_CUSTOM_QUESTIONS = 10;
const MAX_CHOICES = 20;
const LIMITS = Object.freeze({ label: 200, help: 300, choice: 100, shortText: 200, longText: 1000, other: 200 });

const DIETARY_CHOICES = Object.freeze([
  'Vegetarian', 'Vegan', 'Halal', 'Kosher', 'Gluten-free', 'Dairy-free', 'Nut allergy', 'Other',
]);

/** The account's directory setting (shared/profile `profileVisibility`), as an answer. */
const DIRECTORY_CHOICES = Object.freeze([
  { id: 'public', label: 'Yes, list me in the public attendee directory' },
  { id: 'attendees_only', label: 'List me only for other attendees' },
  { id: 'private', label: 'Do not list me' },
]);

/**
 * The standard set, in the order an attendee sees it. `name` is the short
 * name staff see in the editor and the export; `label` is the attendee's
 * wording. `sensitive` answers (dietary, access) are shown to staff for
 * planning and never published.
 */
const STANDARD_QUESTIONS = Object.freeze([
  { id: 'organization', name: 'Organization', kind: 'short_text', label: 'Organization' },
  { id: 'jobTitle', name: 'Job title', kind: 'short_text', label: 'Job title' },
  { id: 'dietary', name: 'Dietary needs', kind: 'dietary', label: 'Dietary needs', help: 'Choose any that apply. Choose Other to describe something else.', sensitive: true },
  { id: 'accessNeeds', name: 'Access needs', kind: 'long_text', label: 'Access needs', help: 'Anything the organizers should arrange so you can take part.', sensitive: true },
  { id: 'photoConsent', name: 'Photo consent', kind: 'yes_no', label: 'May the organizers photograph you and use the photos?' },
  { id: 'directoryListing', name: 'Attendee directory', kind: 'directory', label: 'Attendee directory', help: 'You can change this later on your profile.' },
]);
const STANDARD_IDS = Object.freeze(STANDARD_QUESTIONS.map((question) => question.id));

const CUSTOM_KINDS = Object.freeze(['short_text', 'long_text', 'one_choice', 'many_choices', 'yes_no']);
const CUSTOM_ID_RE = /^q_[a-z0-9]{4,24}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** A form with every standard question off and no custom questions. */
function emptyForm() {
  return {
    standard: Object.fromEntries(STANDARD_IDS.map((id) => [id, { enabled: false, required: false }])),
    custom: [],
    revision: 0,
  };
}

/**
 * The stored form, read safely. A damaged entry reads as off or is
 * dropped, so a bad record never breaks registration.
 */
function readRegistrationForm(stored) {
  const form = emptyForm();
  const source = isPlainObject(stored) ? stored : {};
  if (isPlainObject(source.standard)) {
    for (const id of STANDARD_IDS) {
      const entry = source.standard[id];
      if (isPlainObject(entry) && entry.enabled === true) form.standard[id] = { enabled: true, required: entry.required === true };
    }
  }
  if (Array.isArray(source.custom)) {
    const seen = new Set();
    for (const entry of source.custom.slice(0, MAX_CUSTOM_QUESTIONS)) {
      const checked = checkCustomQuestion(entry, 0);
      if (checked.question && !seen.has(checked.question.id)) {
        seen.add(checked.question.id);
        form.custom.push(checked.question);
      }
    }
  }
  form.revision = Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0;
  return form;
}

function text(value, max, field, errors, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) errors.push(`${field}: required`);
    return '';
  }
  if (typeof value !== 'string') { errors.push(`${field}: must be text`); return ''; }
  const trimmed = value.trim();
  if (required && !trimmed) errors.push(`${field}: required`);
  if (trimmed.length > max) errors.push(`${field}: use at most ${max} characters`);
  return trimmed;
}

/** One custom question. @returns {{ question: object|null, errors: string[] }} */
function checkCustomQuestion(entry, index) {
  const at = `custom.${index}`;
  const errors = [];
  if (!isPlainObject(entry)) return { question: null, errors: [`${at}: must be a question`] };
  for (const key of Object.keys(entry)) {
    if (!['id', 'kind', 'label', 'help', 'choices', 'required'].includes(key)) errors.push(`${at}.${key}: is not a question field`);
  }
  const id = typeof entry.id === 'string' ? entry.id : '';
  if (!CUSTOM_ID_RE.test(id)) errors.push(`${at}.id: must look like q_ and 4-24 lower-case letters or digits`);
  const kind = CUSTOM_KINDS.includes(entry.kind) ? entry.kind : null;
  if (!kind) errors.push(`${at}.kind: choose one of ${CUSTOM_KINDS.join(', ')}`);
  const label = text(entry.label, LIMITS.label, `${at}.label`, errors, { required: true });
  const help = text(entry.help, LIMITS.help, `${at}.help`, errors);
  let choices = [];
  if (kind === 'one_choice' || kind === 'many_choices') {
    if (!Array.isArray(entry.choices)) {
      errors.push(`${at}.choices: add at least two choices`);
    } else {
      const seen = new Set();
      entry.choices.forEach((choice, n) => {
        const value = text(choice, LIMITS.choice, `${at}.choices.${n}`, errors, { required: true });
        if (!value) return;
        if (seen.has(value.toLowerCase())) errors.push(`${at}.choices.${n}: "${value}" is listed twice`);
        seen.add(value.toLowerCase());
        choices.push(value);
      });
      if (choices.length < 2) errors.push(`${at}.choices: add at least two choices`);
      if (entry.choices.length > MAX_CHOICES) errors.push(`${at}.choices: use at most ${MAX_CHOICES} choices`);
    }
  } else if (entry.choices !== undefined && !(Array.isArray(entry.choices) && entry.choices.length === 0)) {
    errors.push(`${at}.choices: only a choice question has choices`);
  }
  if (entry.required !== undefined && typeof entry.required !== 'boolean') errors.push(`${at}.required: must be true or false`);
  if (errors.length) return { question: null, errors };
  choices = choices.slice(0, MAX_CHOICES);
  return { question: { id, kind, label, help, choices, required: entry.required === true }, errors };
}

/**
 * An operator's save, checked whole. `revision` is set by the server, so a
 * payload may not carry it.
 *
 * @returns {{ ok: true, form: { standard: object, custom: object[] } } | { ok: false, errors: string[] }}
 */
function validateRegistrationForm(payload) {
  if (!isPlainObject(payload)) return { ok: false, errors: ['form: must be an object'] };
  const errors = [];
  for (const key of Object.keys(payload)) {
    if (key !== 'standard' && key !== 'custom') errors.push(`${key}: is not a form field`);
  }
  const standard = {};
  const sourceStandard = payload.standard === undefined ? {} : payload.standard;
  if (!isPlainObject(sourceStandard)) {
    errors.push('standard: must be an object');
  } else {
    for (const key of Object.keys(sourceStandard)) {
      if (!STANDARD_IDS.includes(key)) errors.push(`standard.${key}: is not a standard question`);
    }
    for (const id of STANDARD_IDS) {
      const entry = sourceStandard[id];
      if (entry === undefined) { standard[id] = { enabled: false, required: false }; continue; }
      if (!isPlainObject(entry) || typeof entry.enabled !== 'boolean' || (entry.required !== undefined && typeof entry.required !== 'boolean')) {
        errors.push(`standard.${id}: set enabled and required to true or false`);
        continue;
      }
      // A question that is off cannot be required.
      standard[id] = { enabled: entry.enabled, required: entry.enabled && entry.required === true };
    }
  }
  const custom = [];
  const sourceCustom = payload.custom === undefined ? [] : payload.custom;
  if (!Array.isArray(sourceCustom)) {
    errors.push('custom: must be a list');
  } else {
    if (sourceCustom.length > MAX_CUSTOM_QUESTIONS) errors.push(`custom: use at most ${MAX_CUSTOM_QUESTIONS} questions`);
    const ids = new Set();
    sourceCustom.forEach((entry, index) => {
      const checked = checkCustomQuestion(entry, index);
      errors.push(...checked.errors);
      if (!checked.question) return;
      if (ids.has(checked.question.id)) errors.push(`custom.${index}.id: is used twice`);
      ids.add(checked.question.id);
      custom.push(checked.question);
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, form: { standard, custom } };
}

/**
 * The questions an attendee sees, in order: the standard ones that are on,
 * then the custom ones. Each has what a form needs to draw it.
 */
function activeQuestions(form) {
  const read = readRegistrationForm(form);
  const standard = STANDARD_QUESTIONS
    .filter((question) => read.standard[question.id].enabled)
    .map((question) => ({
      id: question.id,
      name: question.name,
      kind: question.kind,
      label: question.label,
      help: question.help || '',
      required: read.standard[question.id].required,
      sensitive: question.sensitive === true,
      choices: question.kind === 'dietary' ? [...DIETARY_CHOICES]
        : question.kind === 'directory' ? DIRECTORY_CHOICES.map((choice) => choice.label) : [],
      standard: true,
    }));
  const custom = read.custom.map((question) => ({ ...question, name: question.label, choices: [...question.choices], sensitive: false, standard: false }));
  return [...standard, ...custom];
}

function isBlank(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** One answer against its question. @returns {{ value?: unknown, error?: string }} */
function checkAnswer(question, value) {
  if (isBlank(value) || (question.kind === 'dietary' && isPlainObject(value) && isBlank(value.choices) && isBlank(value.other))) {
    return question.required ? { error: 'Answer this question.' } : { value: null };
  }
  switch (question.kind) {
    case 'short_text':
    case 'long_text': {
      const max = question.kind === 'short_text' ? LIMITS.shortText : LIMITS.longText;
      if (typeof value !== 'string') return { error: 'Enter text.' };
      const trimmed = value.trim();
      if (!trimmed) return question.required ? { error: 'Answer this question.' } : { value: null };
      return trimmed.length > max ? { error: `Use at most ${max} characters.` } : { value: trimmed };
    }
    case 'yes_no':
      return typeof value === 'boolean' ? { value } : { error: 'Choose yes or no.' };
    case 'one_choice':
      return question.choices.includes(value) ? { value } : { error: 'Choose one of the listed answers.' };
    case 'many_choices': {
      if (!Array.isArray(value) || value.some((choice) => !question.choices.includes(choice))) return { error: 'Choose from the listed answers.' };
      const unique = question.choices.filter((choice) => value.includes(choice));
      return unique.length ? { value: unique } : (question.required ? { error: 'Answer this question.' } : { value: null });
    }
    case 'directory': {
      const choice = DIRECTORY_CHOICES.find((entry) => entry.id === value);
      return choice ? { value: choice.id } : { error: 'Choose how you appear in the directory.' };
    }
    case 'dietary': {
      if (!isPlainObject(value)) return { error: 'Choose your dietary needs.' };
      const picked = Array.isArray(value.choices) ? value.choices : [];
      if (picked.some((choice) => !DIETARY_CHOICES.includes(choice))) return { error: 'Choose from the listed answers.' };
      const choices = DIETARY_CHOICES.filter((choice) => picked.includes(choice));
      const other = typeof value.other === 'string' ? value.other.trim() : '';
      if (other.length > LIMITS.other) return { error: `Use at most ${LIMITS.other} characters.` };
      if (choices.includes('Other') && !other) return { error: 'Describe your other dietary need.' };
      if (!choices.length) return question.required ? { error: 'Answer this question.' } : { value: null };
      return { value: { choices, other: choices.includes('Other') ? other : null } };
    }
    default:
      return { error: 'This question cannot be answered.' };
  }
}

/**
 * An attendee's answers against the form. Unknown keys are refused, so an
 * answer to a removed question is never stored.
 *
 * @returns {{ ok: true, answers: Record<string, unknown> } | { ok: false, errors: Record<string, string> }}
 */
function checkAnswers(source, form) {
  const questions = activeQuestions(form);
  const errors = {};
  const answers = {};
  const given = isPlainObject(source) ? source : {};
  for (const key of Object.keys(given)) {
    if (!questions.some((question) => question.id === key)) errors[key] = 'This question is no longer asked.';
  }
  for (const question of questions) {
    const checked = checkAnswer(question, given[question.id]);
    if (checked.error) errors[question.id] = checked.error;
    else if (checked.value !== null) answers[question.id] = checked.value;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}

/**
 * One stored answer as plain text, for the attendee record and the export.
 * `answered` is the question as the attendee saw it (the record's own copy,
 * see saveTicketAnswers); its kind reads the value, so an answer stays
 * readable after an operator changes the question.
 */
function answerText(question, value, answered = null) {
  if (value === undefined || value === null) return '';
  switch ((answered ?? question)?.kind) {
    case 'yes_no': return value === true ? 'Yes' : value === false ? 'No' : '';
    case 'directory': return DIRECTORY_CHOICES.find((choice) => choice.id === value)?.label ?? '';
    case 'dietary': {
      if (!isPlainObject(value) || !Array.isArray(value.choices)) return '';
      return value.choices.map((choice) => (choice === 'Other' && value.other ? `Other: ${value.other}` : choice)).join('; ');
    }
    case 'many_choices': return Array.isArray(value) ? value.join('; ') : '';
    default: return typeof value === 'string' ? value : '';
  }
}

/**
 * A CSV cell read back into an answer: the reverse of answerText, for the
 * registration import (ADR 0008 §7). Case and spacing do not matter, and
 * yes/no takes y/n and true/false. Blank is no answer (undefined). A value
 * no choice matches is kept as typed, so checkAnswers names the problem.
 */
function answerFromText(question, text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return undefined;
  const key = (value) => value.trim().toLowerCase();
  const pick = (choices, value) => choices.find((choice) => key(choice) === key(value)) ?? value.trim();
  const items = () => raw.split(';').map((item) => item.trim()).filter(Boolean);
  switch (question?.kind) {
    case 'yes_no':
      if (['yes', 'y', 'true'].includes(key(raw))) return true;
      if (['no', 'n', 'false'].includes(key(raw))) return false;
      return raw;
    case 'directory':
      return DIRECTORY_CHOICES.find((choice) => key(choice.id) === key(raw) || key(choice.label) === key(raw))?.id ?? raw;
    case 'one_choice':
      return pick(question.choices, raw);
    case 'many_choices':
      return items().map((item) => pick(question.choices, item));
    case 'dietary': {
      const choices = [];
      let other = '';
      for (const item of items()) {
        const match = /^other\s*:\s*(.*)$/i.exec(item);
        if (match) { choices.push('Other'); other = match[1].trim(); } else choices.push(pick(DIETARY_CHOICES, item));
      }
      return { choices, other };
    }
    default:
      return raw;
  }
}

/**
 * The questions an answer record keeps, as the attendee saw them: enough to
 * read each answer later, whatever the form becomes.
 */
function answeredQuestions(form, answers) {
  return activeQuestions(form)
    .filter((question) => Object.prototype.hasOwnProperty.call(answers || {}, question.id))
    .map(({ id, name, kind, choices }) => ({ id, name, kind, choices: [...choices] }));
}

/**
 * Counts for catering and access planning, from stored answer records
 * (`{ answers }`). Only the questions the form asks are counted. Access
 * needs are counted, never quoted: staff read them one by one on each
 * attendee's record.
 */
function summarizeAnswers(records, form) {
  const read = readRegistrationForm(form);
  // A refunded or cancelled ticket's answers stay on record but are not
  // planned for. A record with no status predates the field and counts.
  const list = (Array.isArray(records) ? records : [])
    .filter((record) => record?.ticketStatus === undefined || record?.ticketStatus === 'valid');
  const summary = { total: list.length };
  const answersOf = (record) => (isPlainObject(record?.answers) ? record.answers : {});
  if (read.standard.dietary.enabled) {
    const dietary = { answered: 0, choices: {}, other: [] };
    for (const record of list) {
      const value = answersOf(record).dietary;
      if (!isPlainObject(value) || !Array.isArray(value.choices) || !value.choices.length) continue;
      dietary.answered += 1;
      for (const choice of value.choices) if (DIETARY_CHOICES.includes(choice)) dietary.choices[choice] = (dietary.choices[choice] ?? 0) + 1;
      if (typeof value.other === 'string' && value.other) dietary.other.push(value.other);
    }
    summary.dietary = dietary;
  }
  if (read.standard.accessNeeds.enabled) {
    summary.accessNeeds = { answered: list.filter((record) => typeof answersOf(record).accessNeeds === 'string' && answersOf(record).accessNeeds).length };
  }
  if (read.standard.photoConsent.enabled) {
    summary.photoConsent = {
      yes: list.filter((record) => answersOf(record).photoConsent === true).length,
      no: list.filter((record) => answersOf(record).photoConsent === false).length,
    };
  }
  return summary;
}

module.exports = {
  answerFromText,
  answerText,
  answeredQuestions,
  summarizeAnswers,
  MAX_CUSTOM_QUESTIONS,
  MAX_CHOICES,
  LIMITS,
  DIETARY_CHOICES,
  DIRECTORY_CHOICES,
  STANDARD_QUESTIONS,
  STANDARD_IDS,
  CUSTOM_KINDS,
  emptyForm,
  readRegistrationForm,
  validateRegistrationForm,
  activeQuestions,
  checkAnswers,
};
