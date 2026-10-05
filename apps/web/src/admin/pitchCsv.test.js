import { describe, it, expect } from 'vitest';
import { readPitchCsv, pitchQueueCsv } from './pitchCsv.js';

describe('reviewed pitch CSV contract', () => {
  const headers = 'externalId,email,title,description,organization,format,consent\n';
  it('preserves external IDs and quoted multiline proposal content', () => {
    expect(readPitchCsv(headers + 'external-17,one@example.test,"Local, together","First line\nSecond line",Example,Panel,true')).toEqual([
      { externalId: 'external-17', email: 'one@example.test', title: 'Local, together', description: 'First line\nSecond line', organization: 'Example', format: 'Panel', consent: true },
    ]);
  });
  it('rejects missing consent, duplicate IDs, and ambiguous headers before import', () => {
    expect(() => readPitchCsv(headers + 'id,one@example.test,Title,Description,,,false')).toThrow(/Consent/);
    expect(() => readPitchCsv(headers + 'id,one@example.test,Title,Description,,,true\nid,two@example.test,Other,Description,,,true')).toThrow(/unique source ID/);
    expect(() => readPitchCsv('email,email,title,description,organization,format,consent')).toThrow(/exact headers/);
  });
  it('exports only explicit queue fields and escapes spreadsheet formulas', () => {
    const csv = pitchQueueCsv([{ id: 'id', title: '=CMD()', description: 'Text, "quoted"', email: 'one@example.test', privateNotes: 'PRIVATE-NOTE', uid: 'PRIVATE-UID', reviewedBy: 'PRIVATE-REVIEWER' }]);
    expect(csv).toContain('"\'=CMD()"');
    expect(csv).toContain('"Text, ""quoted"""');
    expect(csv).not.toMatch(/PRIVATE-|privateNotes|reviewedBy|uid/);
  });
});
