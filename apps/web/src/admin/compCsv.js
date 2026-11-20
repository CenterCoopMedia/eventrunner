import { normalizeAttendee } from 'shared/ticketCommerce';
import { parseCsv } from '../lib/csv.js';

const columns = ['firstName', 'lastName', 'email'];
export const compCsvTemplate = `${columns.join(',')}\r\n`;

export function readCompCsv(text) {
  const [header = [], ...rows] = parseCsv(text);
  const names = header.map((value) => value.trim());
  if (names.length !== columns.length || !columns.every((name) => names.includes(name))) {
    throw new Error('Use the template columns firstName, lastName, and email.');
  }
  const attendees = [];
  const errors = [];
  const seen = new Set();
  for (const [index, cells] of rows.entries()) {
    if (cells.every((cell) => !cell.trim())) continue;
    const row = index + 2;
    const person = cells.length === names.length && normalizeAttendee(Object.fromEntries(names.map((name, column) => [name, cells[column]])));
    if (!person) {
      errors.push({ row, message: 'Enter a first name and a valid email. Last name is optional.' });
      continue;
    }
    const key = JSON.stringify(person);
    if (seen.has(key)) errors.push({ row, message: 'This attendee appears earlier in the file.' });
    else {
      seen.add(key);
      attendees.push(person);
    }
  }
  if (!attendees.length && !errors.length) throw new Error('Add at least one attendee row.');
  return { attendees, errors };
}
