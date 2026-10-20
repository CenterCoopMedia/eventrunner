// The record import page's vocabulary (functions/src/imports/): the three
// record types, the fields a CSV column can be mapped to, the template each
// type downloads, and the words each preview verdict is set in.
//
// The server owns the field list. recordImport.test.js reads each
// importer's `fields` and holds this file to it, so a field cannot be added
// on one side only.

/** Each record type the import writes, in the order the page offers them. */
export const RECORD_IMPORT_TYPES = Object.freeze([
  {
    id: 'speakers',
    label: 'Speakers',
    noun: 'speaker',
    plural: 'speakers',
    // Speakers have no draft revision: a change to a published speaker is
    // queued for review (functions/src/imports/speakerImport.cjs).
    previewNote: 'New speakers are saved as drafts. A change to a published speaker waits for review on the Speakers page. Nothing is published and no email is sent.',
    doneNote: 'New speakers are drafts. Invite or approve them on the Speakers page. A change to a published speaker waits there for review.',
    fields: [
      { id: 'externalId', label: 'External ID', required: true, header: 'external_id', example: 'SPK-001' },
      { id: 'firstName', label: 'First name', header: 'first_name', example: 'Ada' },
      { id: 'lastName', label: 'Last name', header: 'last_name', example: 'Lovelace' },
      { id: 'name', label: 'Full name (if there are no separate name columns)', header: 'name', example: '', template: false },
      { id: 'slug', label: 'Page address (slug)', header: 'slug', example: '' },
      { id: 'email', label: 'Email address', header: 'email', example: 'ada@example.com' },
      { id: 'organization', label: 'Organization', header: 'organization', example: 'Example Newsroom' },
      { id: 'jobTitle', label: 'Job title', header: 'job_title', example: 'Data editor' },
      { id: 'bio', label: 'Bio', header: 'bio', example: 'Ada edits the data desk.' },
    ],
  },
  {
    id: 'sessions',
    label: 'Sessions',
    noun: 'session',
    plural: 'sessions',
    previewNote: 'New sessions are saved as hidden drafts. Changed sessions get a new draft. Nothing is published and no email is sent.',
    doneNote: 'The new and changed sessions are drafts. Publish them from the Sessions page.',
    fields: [
      { id: 'externalId', label: 'External ID', required: true, header: 'external_id', example: 'SES-001' },
      { id: 'title', label: 'Title', required: true, header: 'title', example: 'Opening keynote' },
      { id: 'description', label: 'Description', header: 'description', example: 'The year in local news.' },
      { id: 'day', label: 'Day (ID, date or label)', header: 'day', example: 'day-1' },
      { id: 'startTime', label: 'Start time', header: 'start_time', example: '09:00' },
      { id: 'endTime', label: 'End time', header: 'end_time', example: '09:45' },
      { id: 'track', label: 'Track (letter or name)', header: 'track', example: '' },
      { id: 'place', label: 'Place (ID or name)', header: 'place', example: '' },
      { id: 'location', label: 'Public location text', header: 'location', example: '' },
      { id: 'recordingUrl', label: 'Recording link', header: 'recording_url', example: '' },
      { id: 'materialsNotNeeded', label: 'Needs no slides or other materials (yes or no)', header: 'materials_not_needed', example: 'no' },
      { id: 'speakers', label: 'Speakers (external IDs or slugs, separated by ;)', header: 'speakers', example: 'SPK-001' },
      { id: 'slug', label: 'Session ID (new sessions only)', header: 'session_id', example: '' },
    ],
  },
  {
    id: 'organizations',
    label: 'Organizations',
    noun: 'organization',
    plural: 'organizations',
    previewNote: 'New organizations are saved as hidden drafts. Changed organizations get a new draft. Nothing is published and no email is sent.',
    doneNote: 'The new and changed organizations are drafts. Publish them from the Organizations page.',
    fields: [
      { id: 'externalId', label: 'External ID', required: true, header: 'external_id', example: 'ORG-001' },
      { id: 'name', label: 'Name', required: true, header: 'name', example: 'Example Foundation' },
      { id: 'slug', label: 'Page address (new organizations only)', header: 'slug', example: '' },
      { id: 'tier', label: 'Tier', header: 'tier', example: 'Presenting' },
      { id: 'url', label: 'Website', header: 'website', example: 'https://foundation.example.org' },
      { id: 'description', label: 'Description', header: 'description', example: 'Funds local reporting.' },
      { id: 'order', label: 'Order on the sponsors page', header: 'order', example: '1' },
    ],
  },
]);

export function importTypeById(id) {
  return RECORD_IMPORT_TYPES.find((type) => type.id === id) ?? RECORD_IMPORT_TYPES[0];
}

/** The words each verdict is set in. The tone is the second signal. */
export const VERDICT_WORDS = Object.freeze({
  create: 'New',
  update: 'Update',
  unchanged: 'No change',
  error: 'Error',
});
/** The word for an update that links a row to a record made before the import. */
export const MATCHED_WORD = 'Matches existing';

export const VERDICT_TONES = Object.freeze({
  create: 'ok',
  update: 'info',
  unchanged: 'neutral',
  error: 'error',
});

const squash = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Point each field at a header that names it: the template header, the
 * field id, or the label, compared without case, spaces or punctuation.
 * A header is used once.
 *
 * @param {string[]} headers
 * @param {{ fields: Array<{ id: string, label: string, header: string }> }} type
 * @returns {Record<string, string>}
 */
export function guessMapping(headers, type) {
  const mapping = {};
  const used = new Set();
  for (const field of type.fields) {
    const names = new Set([squash(field.id), squash(field.header), squash(field.label)]);
    const hit = headers.find((header) => !used.has(header) && names.has(squash(header)));
    if (hit) {
      mapping[field.id] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

/**
 * The first required mapping that is missing, as a sentence, or null.
 * The server checks the same rule and names the field the same way.
 */
export function missingMapping(mapping, type) {
  for (const field of type.fields) {
    if (field.required && !mapping[field.id]) return `Map a column to ${field.label}.`;
  }
  if (type.id === 'speakers' && !mapping.name && !(mapping.firstName && mapping.lastName)) {
    return 'Map the first and last name columns, or a full name column.';
  }
  return null;
}

/**
 * The rows the server needs: only the mapped columns, so an unmapped
 * column (a phone number, a private note) never leaves the browser.
 *
 * @param {Array<Record<string, string>>} rows
 * @param {Record<string, string>} mapping
 * @returns {Array<Record<string, string>>}
 */
export function projectRows(rows, mapping) {
  const columns = [...new Set(Object.values(mapping).filter(Boolean))];
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ''])));
}

/** Quote a CSV cell when it needs it. */
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A template file: the header row and one example row.
 *
 * @param {{ fields: Array<{ header: string, example: string, template?: boolean }> }} type
 * @returns {string}
 */
export function templateCsv(type) {
  const fields = type.fields.filter((field) => field.template !== false);
  return `${fields.map((f) => csvCell(f.header)).join(',')}\n${fields.map((f) => csvCell(f.example)).join(',')}\n`;
}

/** "3 new, 1 update, 2 no change, 0 errors" for one result. */
export function summaryWords(summary) {
  const n = (key) => summary?.[key] ?? 0;
  const errors = n('error');
  return `${n('create')} new, ${n('update')} ${n('update') === 1 ? 'update' : 'updates'}, ${n('unchanged')} no change, ${errors} ${errors === 1 ? 'error' : 'errors'}`;
}
