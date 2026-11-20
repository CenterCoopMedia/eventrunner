import { IMPORT_FIELDS, PRESENTER_COLUMNS, readImportedExtras, readPresenters } from 'shared/pitchForm';
import { parseCsv } from '../lib/csv.js';

export const PITCH_COLUMNS = ['externalId', 'email', 'title', 'description', 'organization', 'format', 'consent'];
// The pitch stepper's columns (ADR 0008 §2): read when the file has them.
// The server checks them (shared/pitchForm readImportedExtras).
export const OPTIONAL_PITCH_COLUMNS = Object.freeze([...IMPORT_FIELDS, ...PRESENTER_COLUMNS]);
const FIELD_LABELS = {
  externalId: 'Source ID', email: 'Email', title: 'Proposal title', description: 'Description',
  organization: 'Organization', format: 'Format', consent: 'Consent', summary: 'Summary',
  lengthMinutes: 'Length in minutes', track: 'Track', audienceLevel: 'Audience level',
  leadName: 'Lead presenter name', leadRole: 'Lead presenter role', accessNeeds: 'Access needs', notes: 'Notes',
};
export const PITCH_IMPORT_FIELDS = Object.freeze([...PITCH_COLUMNS, ...OPTIONAL_PITCH_COLUMNS].map((id) => {
  const presenter = id.match(/^presenter_(\d)_(\w+)$/);
  return { id, header: id, label: FIELD_LABELS[id] ?? `Co-presenter ${presenter[1]} ${presenter[2]}`,
    required: ['externalId', 'email', 'title', 'description', 'consent'].includes(id) };
}));

function parsePitchCsv(text) {
  const [rawHeaders, ...table] = parseCsv(text);
  const headers = rawHeaders?.map((header) => header.trim());
  if (!headers?.length || headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error('Use unique, nonempty headers for every CSV column.');
  }
  const rows = table.filter((cells) => cells.some((cell) => cell.trim()));
  if (!rows.length || rows.length > 50) throw new Error('Import 1-50 proposals at a time.');
  return { headers, rows };
}

export function inspectPitchCsv(text) {
  const { headers, rows } = parsePitchCsv(text);
  return { headers, count: rows.length };
}

function rowProblem(row, ids) {
  if (!row.externalId || row.externalId.length > 128 || ids.has(row.externalId)) {
    return 'Enter a unique source ID of at most 128 characters.';
  }
  ids.add(row.externalId);
  if (row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) return 'Enter a valid email address.';
  if (!row.title || row.title.length > 160) return 'Enter a proposal title of at most 160 characters.';
  if (!row.description || row.description.length > 5000) return 'Enter a description of at most 5,000 characters.';
  if (row.organization?.length > 200) return 'Use at most 200 characters for the organization.';
  if (row.format?.length > 120) return 'Use at most 120 characters for the format.';
  if (row.consent !== 'true' && row.consent !== 'checked') return 'Consent must be true or checked and evidenced in the source form.';
  const extras = readImportedExtras(row, { email: row.email.toLowerCase() });
  if (extras.ok) return null;
  const label = PITCH_IMPORT_FIELDS.find(({ id }) => id === extras.field)?.label ?? 'Presenter details';
  return `${label} — ${extras.message.slice(extras.field.length + 2)}`;
}

export function readPitchCsv(text, mapping) {
  const { headers, rows } = parsePitchCsv(text);
  const selected = mapping ?? Object.fromEntries(PITCH_IMPORT_FIELDS.filter(({ id }) => headers.includes(id)).map(({ id }) => [id, id]));
  const used = new Set();
  for (const field of PITCH_IMPORT_FIELDS) {
    const header = selected[field.id];
    if (!header && field.required) throw new Error(`Match the required headers: Choose a column for ${field.label.toLowerCase()}.`);
    if (!header) continue;
    if (!headers.includes(header)) throw new Error(`Choose an existing column for ${field.label.toLowerCase()}.`);
    if (used.has(header)) throw new Error(`The column "${header}" is matched more than once. Choose a different column for each field.`);
    used.add(header);
  }
  const ids = new Set();
  return rows.map((cells, index) => {
    const number = index + 1;
    if (cells.length !== headers.length) return { number, error: 'Use the same number of columns as the header row.' };
    const row = Object.fromEntries(PITCH_IMPORT_FIELDS.flatMap(({ id }) =>
      selected[id] ? [[id, cells[headers.indexOf(selected[id])].trim()]] : [],
    ));
    const error = rowProblem(row, ids);
    return error ? { number, error } : { number, row: { ...row, consent: true } };
  });
}
function cell(value) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
// Explicit fields: private notes, auth UIDs, and reviewer identities never
// export. The stepper columns use the import's names, so an exported file
// imports again; the lead presenter is leadName and leadRole, and each
// co-presenter takes presenter_N_* columns.
const EXPORT_FIELDS = ['id', 'source', 'externalId', 'email', 'title', 'description', 'organization', 'format', 'status',
  ...IMPORT_FIELDS, ...PRESENTER_COLUMNS];

function exportRow(row) {
  const [lead, ...co] = readPresenters(row);
  const flat = { ...row, leadName: lead?.name ?? null, leadRole: lead?.role ?? null };
  co.slice(0, 4).forEach((person, index) => {
    for (const field of ['name', 'email', 'organization', 'role']) flat[`presenter_${index + 1}_${field}`] = person[field] ?? null;
  });
  return flat;
}

export function pitchQueueCsv(rows) {
  return [EXPORT_FIELDS.map(cell).join(','), ...rows.map((row) => {
    const flat = exportRow(row);
    return EXPORT_FIELDS.map((key) => cell(flat[key])).join(',');
  })].join('\r\n') + '\r\n';
}
