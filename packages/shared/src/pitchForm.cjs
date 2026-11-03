'use strict';

/**
 * The session pitch form (ADR 0008 §2): its field limits, the option lists
 * staff set on the call, and the one check the browser steps and the
 * server both run. A step in the browser shows the same message the server
 * would return, so a pitch that passes every step is a pitch the server
 * stores.
 *
 * Pure. No clock, no Firestore. Messages are plain sentences for a person;
 * each is keyed by the field it belongs to, so a step can show it under that
 * field and the server can return the first one.
 */

const { isEmailAddress } = require('./email.cjs');

const LIMITS = Object.freeze({
  title: 160,
  summary: 300,
  description: 5000,
  organization: 200,
  format: 120,
  track: 120,
  name: 120,
  role: 120,
  email: 254,
  accessNeeds: 2000,
  notes: 2000,
});

const MAX_CO_PRESENTERS = 4;
const MAX_OPTIONS = 20;
const MAX_OPTION_LABEL = 80;
const MIN_LENGTH_MINUTES = 5;
const MAX_LENGTH_MINUTES = 480;

/** Audience levels, in the order the form offers them. */
const AUDIENCE_LEVELS = Object.freeze([
  Object.freeze({ id: 'everyone', label: 'Everyone' }),
  Object.freeze({ id: 'beginner', label: 'New to the topic' }),
  Object.freeze({ id: 'intermediate', label: 'Some experience' }),
  Object.freeze({ id: 'advanced', label: 'Experienced practitioners' }),
]);
const AUDIENCE_LEVEL_IDS = Object.freeze(AUDIENCE_LEVELS.map((level) => level.id));

const DEFAULT_FORM_OPTIONS = Object.freeze({
  formats: Object.freeze([]),
  lengths: Object.freeze([]),
  tracks: Object.freeze([]),
  maxCoPresenters: MAX_CO_PRESENTERS,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanLabels(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const labels = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const label = entry.trim();
    const key = label.toLowerCase();
    if (!label || label.length > MAX_OPTION_LABEL || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels.slice(0, MAX_OPTIONS);
}

function cleanLengths(list) {
  if (!Array.isArray(list)) return [];
  const lengths = [...new Set(list.filter((value) => Number.isInteger(value)
    && value >= MIN_LENGTH_MINUTES && value <= MAX_LENGTH_MINUTES))];
  return lengths.sort((a, b) => a - b).slice(0, MAX_OPTIONS);
}

/**
 * The option lists a stored config/pitch_call carries, made safe to show.
 * A missing or damaged value reads as no list, so the field is not shown.
 *
 * @param {object|null|undefined} call the config/pitch_call document
 * @returns {{ formats: string[], lengths: number[], tracks: string[], maxCoPresenters: number }}
 */
function readPitchFormOptions(call) {
  const source = isPlainObject(call?.formOptions) ? call.formOptions : {};
  const max = source.maxCoPresenters;
  return {
    formats: cleanLabels(source.formats),
    lengths: cleanLengths(source.lengths),
    tracks: cleanLabels(source.tracks),
    maxCoPresenters: Number.isInteger(max) && max >= 0 && max <= MAX_CO_PRESENTERS ? max : MAX_CO_PRESENTERS,
  };
}

/**
 * Check the option lists an operator saves. Refuses by name rather than
 * dropping, so a typo in an admin form is shown, not lost.
 *
 * @param {unknown} input
 * @returns {{ ok: true, options: object } | { ok: false, errors: string[] }}
 */
function validatePitchFormOptions(input) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['formOptions: must be an object.'] };
  for (const key of Object.keys(input)) {
    if (!['formats', 'lengths', 'tracks', 'maxCoPresenters'].includes(key)) {
      errors.push(`${key}: unknown form option.`);
    }
  }
  for (const key of ['formats', 'tracks']) {
    const list = input[key] ?? [];
    if (!Array.isArray(list)) { errors.push(`${key}: must be a list.`); continue; }
    if (list.length > MAX_OPTIONS) errors.push(`${key}: at most ${MAX_OPTIONS} choices.`);
    const seen = new Set();
    for (const entry of list) {
      const label = typeof entry === 'string' ? entry.trim() : '';
      if (!label) errors.push(`${key}: each choice needs a name.`);
      else if (label.length > MAX_OPTION_LABEL) errors.push(`${key}: "${label.slice(0, 20)}…" is longer than ${MAX_OPTION_LABEL} characters.`);
      else if (seen.has(label.toLowerCase())) errors.push(`${key}: "${label}" is listed twice.`);
      seen.add(label.toLowerCase());
    }
  }
  const lengths = input.lengths ?? [];
  if (!Array.isArray(lengths)) errors.push('lengths: must be a list.');
  else {
    if (lengths.length > MAX_OPTIONS) errors.push(`lengths: at most ${MAX_OPTIONS} choices.`);
    for (const value of lengths) {
      if (!Number.isInteger(value) || value < MIN_LENGTH_MINUTES || value > MAX_LENGTH_MINUTES) {
        errors.push(`lengths: each length is a whole number of minutes from ${MIN_LENGTH_MINUTES} to ${MAX_LENGTH_MINUTES}.`);
        break;
      }
    }
    if (new Set(lengths).size !== lengths.length) errors.push('lengths: a length is listed twice.');
  }
  const max = input.maxCoPresenters ?? MAX_CO_PRESENTERS;
  if (!Number.isInteger(max) || max < 0 || max > MAX_CO_PRESENTERS) {
    errors.push(`maxCoPresenters: a whole number from 0 to ${MAX_CO_PRESENTERS}.`);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    options: {
      formats: (input.formats ?? []).map((label) => label.trim()),
      lengths: [...lengths].sort((a, b) => a - b),
      tracks: (input.tracks ?? []).map((label) => label.trim()),
      maxCoPresenters: max,
    },
  };
}

function text(source, field) {
  const raw = source[field];
  if (raw === undefined || raw === null) return { value: '' };
  if (typeof raw !== 'string') return { error: 'must be text' };
  return { value: raw.trim() };
}

/**
 * The fields of each step, in step order. A step checks only its own.
 */
const STEP_FIELDS = Object.freeze({
  session: Object.freeze(['title', 'summary', 'description']),
  format: Object.freeze(['format', 'lengthMinutes', 'track', 'audienceLevel']),
  presenters: Object.freeze(['leadName', 'organization', 'leadRole', 'presenters']),
  access: Object.freeze(['accessNeeds', 'notes']),
  review: Object.freeze(['consent']),
});

const REQUIRED_MESSAGES = Object.freeze({
  title: 'Enter a session title.',
  description: 'Describe your session idea.',
  leadName: 'Enter your name.',
});

/**
 * Check a pitch, or the part of it one step holds.
 *
 * Title, description, the lead presenter's name and consent are required.
 * Everything else is optional. A choice field must name one of the staff's
 * choices when staff set a list; with no list, `format` stays free text so
 * a call that sets no formats keeps the old behaviour and `lengthMinutes`
 * and `track` stay empty.
 *
 * @param {object} source the answers
 * @param {{ options: object, submitterEmail?: string|null, fields?: string[] }} context
 *   `fields` limits the check to one step's fields.
 * @returns {{ ok: boolean, errors: Record<string, string>, pitch: object }}
 *   `errors` is keyed by field; for a co-presenter, `presenters.<index>.<field>`.
 */
function checkPitch(source, { options, submitterEmail = null, fields = null } = {}) {
  const input = isPlainObject(source) ? source : {};
  const opts = options ?? DEFAULT_FORM_OPTIONS;
  const wanted = (field) => !fields || fields.includes(field);
  const errors = {};
  const pitch = {};

  for (const field of ['title', 'summary', 'description', 'organization', 'accessNeeds', 'notes']) {
    const read = text(input, field);
    if (read.error) { if (wanted(field)) errors[field] = `${field}: ${read.error}.`; continue; }
    pitch[field] = read.value || null;
    if (!wanted(field)) continue;
    if (!read.value && REQUIRED_MESSAGES[field]) errors[field] = REQUIRED_MESSAGES[field];
    else if (read.value.length > LIMITS[field]) errors[field] = `Use at most ${LIMITS[field]} characters.`;
  }

  const leadName = text(input, 'leadName');
  pitch.leadName = leadName.value || null;
  const leadRole = text(input, 'leadRole');
  pitch.leadRole = leadRole.value || null;
  if (wanted('leadName')) {
    if (leadName.error) errors.leadName = `leadName: ${leadName.error}.`;
    else if (!leadName.value) errors.leadName = REQUIRED_MESSAGES.leadName;
    else if (leadName.value.length > LIMITS.name) errors.leadName = `Use at most ${LIMITS.name} characters.`;
  }
  if (wanted('leadRole') && (leadRole.error || leadRole.value.length > LIMITS.role)) {
    errors.leadRole = leadRole.error ? `leadRole: ${leadRole.error}.` : `Use at most ${LIMITS.role} characters.`;
  }

  const format = text(input, 'format');
  pitch.format = format.value || null;
  if (wanted('format')) {
    if (format.error) errors.format = `format: ${format.error}.`;
    else if (format.value && opts.formats.length && !opts.formats.includes(format.value)) errors.format = 'Choose one of the listed formats.';
    else if (format.value.length > LIMITS.format) errors.format = `Use at most ${LIMITS.format} characters.`;
  }

  const track = text(input, 'track');
  pitch.track = track.value || null;
  if (wanted('track') && track.value && !opts.tracks.includes(track.value)) errors.track = 'Choose one of the listed tracks.';

  const length = input.lengthMinutes;
  pitch.lengthMinutes = length === undefined || length === null || length === '' ? null : length;
  if (wanted('lengthMinutes') && pitch.lengthMinutes !== null && !opts.lengths.includes(pitch.lengthMinutes)) {
    errors.lengthMinutes = 'Choose one of the listed lengths.';
  }

  const level = input.audienceLevel;
  pitch.audienceLevel = typeof level === 'string' && level ? level : null;
  if (wanted('audienceLevel') && pitch.audienceLevel && !AUDIENCE_LEVEL_IDS.includes(pitch.audienceLevel)) {
    errors.audienceLevel = 'Choose one of the listed audience levels.';
  }

  const rawPresenters = input.presenters ?? [];
  pitch.presenters = [];
  if (!Array.isArray(rawPresenters)) {
    if (wanted('presenters')) errors.presenters = 'presenters: must be a list.';
  } else {
    if (wanted('presenters') && rawPresenters.length > opts.maxCoPresenters) {
      errors.presenters = opts.maxCoPresenters === 0
        ? 'This call takes one presenter per pitch.'
        : `Add at most ${opts.maxCoPresenters} co-presenters.`;
    }
    const seen = new Set(submitterEmail ? [String(submitterEmail).toLowerCase()] : []);
    rawPresenters.forEach((row, index) => {
      const entry = isPlainObject(row) ? row : {};
      const person = {};
      for (const field of ['name', 'email', 'organization', 'role']) {
        const read = text(entry, field);
        person[field] = read.error ? '' : read.value;
        if (!wanted('presenters')) continue;
        const key = `presenters.${index}.${field}`;
        if (read.error) errors[key] = `${field}: ${read.error}.`;
        else if (read.value.length > LIMITS[field]) errors[key] = `Use at most ${LIMITS[field]} characters.`;
      }
      person.email = person.email.toLowerCase();
      if (wanted('presenters')) {
        if (!person.name) errors[`presenters.${index}.name`] = 'Enter the co-presenter’s name.';
        if (!person.email) errors[`presenters.${index}.email`] = 'Enter the co-presenter’s email address.';
        else if (!isEmailAddress(person.email)) errors[`presenters.${index}.email`] = 'Enter an email address like name@example.org.';
        else if (seen.has(person.email)) errors[`presenters.${index}.email`] = 'This address is already on the pitch.';
      }
      seen.add(person.email);
      pitch.presenters.push({
        name: person.name,
        email: person.email,
        organization: person.organization || null,
        role: person.role || null,
      });
    });
  }

  pitch.consent = input.consent === true;
  if (wanted('consent') && !pitch.consent) errors.consent = 'Agree to organizer review before submitting.';

  return { ok: Object.keys(errors).length === 0, errors, pitch };
}

/**
 * The stored presenter list: the lead first, from the account and the
 * Presenters step, then each co-presenter.
 *
 * @param {object} pitch a checked pitch
 * @param {string} email the submitter's verified email
 */
function presenterList(pitch, email) {
  return [
    {
      name: pitch.leadName,
      email,
      organization: pitch.organization ?? null,
      role: pitch.leadRole ?? null,
      lead: true,
    },
    ...pitch.presenters.map((person) => ({ ...person, lead: false })),
  ];
}

/**
 * A pitch stored before presenters existed reads as one lead presenter, the
 * submitter, so every reader of a pitch can use one shape.
 *
 * @param {object} stored a session_pitches document
 */
function readPresenters(stored) {
  if (Array.isArray(stored?.presenters) && stored.presenters.length) return stored.presenters;
  return [{
    name: null,
    email: typeof stored?.email === 'string' ? stored.email : null,
    organization: stored?.organization ?? null,
    role: null,
    lead: true,
  }];
}

/** The stepper fields an import may carry beside the seven legacy columns. */
const IMPORT_FIELDS = Object.freeze([
  'summary', 'lengthMinutes', 'track', 'audienceLevel', 'leadName', 'leadRole', 'accessNeeds', 'notes',
]);
const PRESENTER_COLUMN_RE = /^presenter_([1-4])_(name|email|organization|role)$/;

/** `presenter_1_name` … `presenter_4_role`, in column order. */
const PRESENTER_COLUMNS = Object.freeze([1, 2, 3, 4].flatMap((n) => ['name', 'email', 'organization', 'role'].map((f) => `presenter_${n}_${f}`)));

function readLevel(value) {
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  const level = AUDIENCE_LEVELS.find((entry) => entry.id === text || entry.label.toLowerCase() === text);
  return level ? level.id : value;
}

/**
 * The stepper fields of an imported row (a CSV line or an Airtable record),
 * ADR 0008 §2. Only the fields the row carries come back, so a file with the
 * legacy columns alone imports exactly as before.
 *
 * An outside form names its own choices, so a format, length or track is
 * not held to the call's lists: a length is any whole number of minutes in
 * range, and a track is any short text. An audience level may be its id or
 * its label. The lead presenter's name is optional here; an imported pitch
 * has no account to take it from.
 *
 * @param {object} source the row, with the legacy fields as well
 * @param {{ email: string }} context the row's (lead) email
 * @returns {{ ok: true, extras: object } | { ok: false, field: string, message: string }}
 */
function readImportedExtras(source, { email }) {
  const input = isPlainObject(source) ? source : {};
  const present = IMPORT_FIELDS.filter((field) => input[field] !== undefined && input[field] !== null);
  const presenterRows = [];
  for (const [key, value] of Object.entries(input)) {
    const match = key.match(PRESENTER_COLUMN_RE);
    if (!match || value === undefined || value === null) continue;
    const index = Number(match[1]) - 1;
    presenterRows[index] = { ...(presenterRows[index] || {}), [match[2]]: value };
  }
  const coPresenters = presenterRows.filter((row) => row && Object.values(row).some((v) => String(v).trim()));
  if (!present.length && !coPresenters.length) return { ok: true, extras: {} };

  const rawLength = input.lengthMinutes;
  const length = rawLength === undefined || rawLength === null || String(rawLength).trim() === ''
    ? null : (/^\d+$/.test(String(rawLength).trim()) ? Number(String(rawLength).trim()) : Number.NaN);
  if (Number.isNaN(length) || (length !== null && (length < MIN_LENGTH_MINUTES || length > MAX_LENGTH_MINUTES))) {
    return { ok: false, field: 'lengthMinutes', message: `lengthMinutes: a whole number of minutes from ${MIN_LENGTH_MINUTES} to ${MAX_LENGTH_MINUTES}.` };
  }
  const track = typeof input.track === 'string' ? input.track.trim() : input.track;
  if (track !== undefined && track !== null && (typeof track !== 'string' || track.length > LIMITS.track)) {
    return { ok: false, field: 'track', message: `track: at most ${LIMITS.track} characters.` };
  }
  const candidate = {
    ...input,
    title: input.title ?? 'x',
    description: input.description ?? 'x',
    lengthMinutes: length,
    track: track || null,
    audienceLevel: input.audienceLevel === undefined || input.audienceLevel === null ? null : readLevel(input.audienceLevel),
    presenters: coPresenters,
  };
  const options = { formats: [], lengths: length === null ? [] : [length], tracks: track ? [track] : [], maxCoPresenters: MAX_CO_PRESENTERS };
  const fields = ['summary', 'audienceLevel', 'leadRole', 'accessNeeds', 'notes', 'lengthMinutes', 'track', 'presenters'];
  const checked = checkPitch(candidate, { options, submitterEmail: email, fields });
  const leadName = typeof input.leadName === 'string' ? input.leadName.trim() : '';
  if (input.leadName !== undefined && input.leadName !== null && (typeof input.leadName !== 'string' || leadName.length > LIMITS.name)) {
    return { ok: false, field: 'leadName', message: `leadName: at most ${LIMITS.name} characters.` };
  }
  if (!checked.ok) {
    const [field, message] = Object.entries(checked.errors)[0];
    return { ok: false, field, message: `${field}: ${message}` };
  }
  const extras = {};
  for (const field of present) {
    if (field === 'leadName' || field === 'leadRole') continue;
    extras[field] = checked.pitch[field] ?? null;
  }
  if (present.includes('leadName') || present.includes('leadRole') || coPresenters.length) {
    extras.presenters = presenterList({
      leadName: leadName || null,
      leadRole: checked.pitch.leadRole ?? null,
      organization: typeof input.organization === 'string' && input.organization.trim() ? input.organization.trim() : null,
      presenters: checked.pitch.presenters,
    }, email);
  }
  return { ok: true, extras };
}

module.exports = {
  IMPORT_FIELDS,
  PRESENTER_COLUMNS,
  readImportedExtras,
  LIMITS,
  MAX_CO_PRESENTERS,
  MAX_OPTIONS,
  MAX_OPTION_LABEL,
  MIN_LENGTH_MINUTES,
  MAX_LENGTH_MINUTES,
  AUDIENCE_LEVELS,
  AUDIENCE_LEVEL_IDS,
  DEFAULT_FORM_OPTIONS,
  STEP_FIELDS,
  readPitchFormOptions,
  validatePitchFormOptions,
  checkPitch,
  presenterList,
  readPresenters,
};
