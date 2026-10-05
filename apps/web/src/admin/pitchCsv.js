import { parseCsv } from '../lib/csv.js';

export const PITCH_COLUMNS = ['externalId', 'email', 'title', 'description', 'organization', 'format', 'consent'];
export function readPitchCsv(text) {
  const [headers, ...table] = parseCsv(text);
  if (!headers || headers.length !== PITCH_COLUMNS.length || !PITCH_COLUMNS.every((name) => headers.includes(name))) throw new Error(`Use these exact headers: ${PITCH_COLUMNS.join(', ')}.`);
  const rows = table.filter((cells) => cells.some((cell) => cell.trim()));
  if (!rows.length || rows.length > 50) throw new Error('Import 1-50 proposals at a time.');
  const ids = new Set();
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Row ${index + 1}: The column count does not match the headers.`);
    const row = Object.fromEntries(headers.map((key, i) => [key, cells[i].trim()]));
    if (!row.externalId || row.externalId.length > 128 || ids.has(row.externalId)) throw new Error(`Row ${index + 1}: A unique source ID is required.`);
    ids.add(row.externalId);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw new Error(`Row ${index + 1}: A valid email is required.`);
    if (!row.title || row.title.length > 160 || !row.description || row.description.length > 5000 || row.organization.length > 200 || row.format.length > 120) throw new Error(`Row ${index + 1}: Check required text and field lengths.`);
    if (row.consent !== 'true') throw new Error(`Row ${index + 1}: Consent must be true and evidenced in the source form.`);
    return { ...row, consent: true };
  });
}
function cell(value) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
// Explicit fields: private notes, auth UIDs, and reviewer identities never export.
export function pitchQueueCsv(rows) {
  const fields = ['id', 'source', 'externalId', 'email', 'title', 'description', 'organization', 'format', 'status'];
  return [fields.map(cell).join(','), ...rows.map((row) => fields.map((key) => cell(row[key])).join(','))].join('\r\n') + '\r\n';
}
