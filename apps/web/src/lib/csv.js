// A small, dependency-free CSV parser for the ticketing import flow (issue
// #31). No library is pulled in for this — the format this needs to handle
// is RFC 4180 plus the two things every real export actually does (quoted
// fields containing commas/newlines, and doubled-quote escaping), and a
// hand-rolled parser here is a few dozen lines versus a dependency for one
// screen. Same "no library, plain code" call formControls.jsx makes for the
// admin forms.
//
// Row shape: an array of arrays, header row included — the caller decides
// which row is the header (ticketingImport.js) and turns the rest into
// `{ [header]: value }` objects for the column-mapping UI.

/**
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n') {
      endRow();
    } else {
      field += c;
    }
  }
  // A trailing newline leaves nothing to flush; anything else (including a
  // file with no trailing newline) is one more row/field to close out.
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}

/**
 * Parse a CSV file's text into headers + row objects keyed by the header.
 * Blank trailing rows (a common trailing-newline artifact) are dropped.
 *
 * @param {string} text
 * @returns {{ headers: string[], rows: Record<string,string>[] }}
 */
export function parseCsvFile(text) {
  const table = parseCsv(text);
  if (table.length === 0) return { headers: [], rows: [] };
  const [headerRow, ...rest] = table;
  const headers = headerRow.map((h) => h.trim());
  const rows = rest
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])));
  return { headers, rows };
}
