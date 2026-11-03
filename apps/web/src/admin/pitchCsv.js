import { IMPORT_FIELDS, PRESENTER_COLUMNS, readPresenters } from 'shared/pitchForm';
import { parseCsv } from '../lib/csv.js';

export const PITCH_COLUMNS = ['externalId', 'email', 'title', 'description', 'organization', 'format', 'consent'];
// The pitch stepper's columns (ADR 0008 §2): read when the file has them.
// The server checks them (shared/pitchForm readImportedExtras).
export const OPTIONAL_PITCH_COLUMNS = Object.freeze([...IMPORT_FIELDS, ...PRESENTER_COLUMNS]);
export function readPitchCsv(text) {
  const [rawHeaders, ...table] = parseCsv(text);
  const headers = rawHeaders?.map((header) => header.trim());
  // Other columns (an Airtable view's Created or Status) are ignored. A repeated name is ambiguous.
  if (!headers || new Set(headers).size !== headers.length || !PITCH_COLUMNS.every((name) => headers.includes(name))) throw new Error(`Use these exact headers: ${PITCH_COLUMNS.join(', ')}. Other columns are ignored.`);
  const rows = table.filter((cells) => cells.some((cell) => cell.trim()));
  if (!rows.length || rows.length > 50) throw new Error('Import 1-50 proposals at a time.');
  const ids = new Set();
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Row ${index + 1}: The column count does not match the headers.`);
    const row = Object.fromEntries(PITCH_COLUMNS.map((key) => [key, cells[headers.indexOf(key)].trim()]));
    for (const key of OPTIONAL_PITCH_COLUMNS) if (headers.includes(key)) row[key] = cells[headers.indexOf(key)].trim();
    if (!row.externalId || row.externalId.length > 128 || ids.has(row.externalId)) throw new Error(`Row ${index + 1}: A unique source ID is required.`);
    ids.add(row.externalId);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw new Error(`Row ${index + 1}: A valid email is required.`);
    if (!row.title || row.title.length > 160 || !row.description || row.description.length > 5000 || row.organization.length > 200 || row.format.length > 120) throw new Error(`Row ${index + 1}: Check required text and field lengths.`);
    // Airtable exports a ticked checkbox as "checked".
    if (row.consent !== 'true' && row.consent !== 'checked') throw new Error(`Row ${index + 1}: Consent must be true or checked and evidenced in the source form.`);
    return { ...row, consent: true };
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
