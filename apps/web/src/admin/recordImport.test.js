import { describe, expect, it } from 'vitest';
import * as speakerImport from '../../../../functions/src/imports/speakerImport.cjs';
import * as sessionImport from '../../../../functions/src/imports/sessionImport.cjs';
import * as organizationImport from '../../../../functions/src/imports/organizationImport.cjs';
import { parseCsvFile } from '../lib/csv.js';
import {
  RECORD_IMPORT_TYPES,
  guessMapping,
  importTypeById,
  missingMapping,
  projectRows,
  summaryWords,
  templateCsv,
} from './recordImport.js';

const SERVER = { speakers: speakerImport, sessions: sessionImport, organizations: organizationImport };

describe('record import vocabulary', () => {
  it('offers exactly the fields each server importer maps, with the same required ones', () => {
    for (const type of RECORD_IMPORT_TYPES) {
      const server = SERVER[type.id];
      expect(type.fields.map((f) => f.id)).toEqual(server.fields.map((f) => f.id));
      expect(type.fields.filter((f) => f.required).map((f) => f.id))
        .toEqual(server.fields.filter((f) => f.required).map((f) => f.id));
    }
  });

  it('maps a downloaded template back onto every field it carries, and the server accepts that mapping', () => {
    for (const type of RECORD_IMPORT_TYPES) {
      const { headers, rows } = parseCsvFile(templateCsv(type));
      expect(rows).toHaveLength(1);
      const mapping = guessMapping(headers, type);
      const carried = type.fields.filter((f) => f.template !== false).map((f) => f.id);
      expect(Object.keys(mapping).sort()).toEqual([...carried].sort());
      expect(missingMapping(mapping, type)).toBeNull();
      expect(SERVER[type.id].mappingError(mapping)).toBeNull();
    }
  });

  it('guesses from labels and ids without case or punctuation, and uses a header once', () => {
    const type = importTypeById('speakers');
    expect(guessMapping(['External ID', 'First Name', 'LAST_NAME', 'E-mail', 'Job title'], type)).toEqual({
      externalId: 'External ID',
      firstName: 'First Name',
      lastName: 'LAST_NAME',
      email: 'E-mail',
      jobTitle: 'Job title',
    });
    const orgs = importTypeById('organizations');
    expect(guessMapping(['name', 'Website'], orgs)).toEqual({ name: 'name', url: 'Website' });
  });

  it('names the first missing required mapping, and the speaker name rule', () => {
    expect(missingMapping({}, importTypeById('sessions'))).toBe('Map a column to External ID.');
    expect(missingMapping({ externalId: 'ID' }, importTypeById('sessions'))).toBe('Map a column to Title.');
    expect(missingMapping({ externalId: 'ID', firstName: 'F' }, importTypeById('speakers')))
      .toBe('Map the first and last name columns, or a full name column.');
    expect(missingMapping({ externalId: 'ID', name: 'N' }, importTypeById('speakers'))).toBeNull();
  });

  it('sends only the mapped columns', () => {
    const rows = [{ ID: '1', Name: 'Ada', Phone: '555', Notes: 'private' }];
    expect(projectRows(rows, { externalId: 'ID', name: 'Name', email: '' })).toEqual([{ ID: '1', Name: 'Ada' }]);
  });

  it('quotes template cells that hold a comma', () => {
    const csv = templateCsv({ fields: [{ header: 'a', example: 'x, y' }, { header: 'b', example: 'say "hi"' }] });
    expect(csv).toBe('a,b\n"x, y","say ""hi"""\n');
  });

  it('states a summary in words, singular and plural', () => {
    expect(summaryWords({ create: 2, update: 1, unchanged: 0, error: 1 })).toBe('2 new, 1 update, 0 no change, 1 error');
    expect(summaryWords({ create: 0, update: 2, unchanged: 3, error: 0 })).toBe('0 new, 2 updates, 3 no change, 0 errors');
  });
});
