import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvFile } from './csv.js';

describe('parseCsv', () => {
  it('splits a plain comma-separated file into rows of cells', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles a quoted field containing a comma', () => {
    expect(parseCsv('name,note\n"Doe, Jane",hi')).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'hi'],
    ]);
  });

  it('handles a doubled quote as an escaped quote', () => {
    expect(parseCsv('note\n"she said ""hi"""')).toEqual([['note'], ['she said "hi"']]);
  });

  it('handles a quoted field containing a newline', () => {
    expect(parseCsv('note\n"line one\nline two"')).toEqual([['note'], ['line one\nline two']]);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('does not emit a phantom trailing row for a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseCsvFile', () => {
  it('turns the header row into keys and drops blank trailing rows', () => {
    const { headers, rows } = parseCsvFile('Email,Order ID\na@example.com,ord-1\n\n');
    expect(headers).toEqual(['Email', 'Order ID']);
    expect(rows).toEqual([{ Email: 'a@example.com', 'Order ID': 'ord-1' }]);
  });

  it('returns an empty shape for an empty file', () => {
    expect(parseCsvFile('')).toEqual({ headers: [], rows: [] });
  });

  it('pads a short row with empty strings for missing trailing columns', () => {
    const { rows } = parseCsvFile('Email,Order ID,Name\na@example.com,ord-1');
    expect(rows).toEqual([{ Email: 'a@example.com', 'Order ID': 'ord-1', Name: '' }]);
  });
});
