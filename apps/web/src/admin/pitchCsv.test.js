import { describe, it, expect } from 'vitest';
import { inspectPitchCsv, readPitchCsv, pitchQueueCsv } from './pitchCsv.js';

describe('reviewed pitch CSV contract', () => {
  const headers = 'externalId,email,title,description,organization,format,consent\n';
  it('preserves external IDs and quoted multiline proposal content', () => {
    expect(readPitchCsv(headers + 'external-17,one@example.test,"Local, together","First line\nSecond line",Example,Panel,true')).toEqual([
      { externalId: 'external-17', email: 'one@example.test', title: 'Local, together', description: 'First line\nSecond line', organization: 'Example', format: 'Panel', consent: true },
    ]);
  });
  it('accepts a UTF-8 BOM and surrounding header whitespace', () => {
    expect(readPitchCsv('\uFEFF externalId , email , title , description , organization , format , consent \n' + 'id,one@example.test,Title,Description,,Panel,true')[0].externalId).toBe('id');
  });
  it('rejects missing consent, duplicate IDs, and ambiguous headers before import', () => {
    expect(() => readPitchCsv(headers + 'id,one@example.test,Title,Description,,,false')).toThrow(/Consent/);
    expect(() => readPitchCsv(headers + 'id,one@example.test,Title,Description,,,true\nid,two@example.test,Other,Description,,,true')).toThrow(/unique source ID/);
    expect(() => readPitchCsv('email,email,title,description,organization,format,consent')).toThrow(/unique, nonempty headers/);
  });
  it('reads an Airtable export: a ticked checkbox as consent and extra view columns ignored', () => {
    const airtable = 'externalId,Created,email,title,description,organization,format,consent,Status\n'
      + 'rec001,10/19/2026 9:00am,one@example.test,Title,Description,,Panel,checked,Todo';
    expect(readPitchCsv(airtable)).toEqual([
      { externalId: 'rec001', email: 'one@example.test', title: 'Title', description: 'Description', organization: '', format: 'Panel', consent: true },
    ]);
    expect(() => readPitchCsv(airtable.replace(',checked,', ',,'))).toThrow(/Consent/);
  });
  it('rejects a missing required column or a repeated column name', () => {
    expect(() => readPitchCsv('externalId,email,title,description,organization,format\nid,one@example.test,T,D,,')).toThrow(/headers/);
    expect(() => readPitchCsv('externalId,email,title,description,organization,format,consent,Notes,Notes\nid,one@example.test,T,D,,,true,a,b')).toThrow(/headers/);
  });
  it('exports only explicit queue fields and escapes spreadsheet formulas', () => {
    const csv = pitchQueueCsv([{ id: 'id', title: '=CMD()', description: 'Text, "quoted"', email: 'one@example.test', privateNotes: 'PRIVATE-NOTE', uid: 'PRIVATE-UID', reviewedBy: 'PRIVATE-REVIEWER' }]);
    expect(csv).toContain('"\'=CMD()"');
    expect(csv).toContain('"Text, ""quoted"""');
    expect(csv).not.toMatch(/PRIVATE-|privateNotes|reviewedBy|uid/);
  });

  // ADR 0008 §2: the stepper's columns come in when the file has them, and
  // an export writes the same names so it imports again.
  it('reads the optional stepper columns and leaves them out when absent', () => {
    const text = 'externalId,email,title,description,organization,format,consent,summary,lengthMinutes,leadName,presenter_1_name,presenter_1_email\n'
      + 'id,one@example.test,T,D,,Panel,true,One line.,60,Ada,Bo,bo@example.test';
    expect(readPitchCsv(text)[0]).toMatchObject({ summary: 'One line.', lengthMinutes: '60', leadName: 'Ada', presenter_1_name: 'Bo', presenter_1_email: 'bo@example.test' });
    expect(Object.keys(readPitchCsv(headers + 'id,one@example.test,T,D,,,true')[0])).not.toContain('summary');
  });

  it('matches reordered source columns explicitly without shifting blank cells or changing IDs', () => {
    const text = 'Answer,Record,Contact,Agreement,Idea,Unused,Presenter\n"First line\nSecond, line",rec-017,one@example.test,checked,Local together,,Ada';
    expect(inspectPitchCsv(text)).toEqual({ headers: ['Answer', 'Record', 'Contact', 'Agreement', 'Idea', 'Unused', 'Presenter'], count: 1 });
    expect(readPitchCsv(text, { description: 'Answer', externalId: 'Record', email: 'Contact', consent: 'Agreement', title: 'Idea', leadName: 'Presenter' })).toEqual([
      { externalId: 'rec-017', email: 'one@example.test', title: 'Local together', description: 'First line\nSecond, line', organization: '', format: '', consent: true, leadName: 'Ada' },
    ]);
  });

  it('refuses ambiguous or missing matches and malformed row shapes before producing a review', () => {
    const text = headers + 'id,one@example.test,T,D,,,true';
    const mapping = Object.fromEntries(headers.trim().split(',').map((name) => [name, name]));
    expect(() => readPitchCsv(text, { ...mapping, title: 'description' })).toThrow(/matched more than once/);
    expect(() => readPitchCsv(text, { ...mapping, email: 'Missing column' })).toThrow(/existing column/);
    expect(() => readPitchCsv(text, { ...mapping, consent: '' })).toThrow(/Choose a column for consent/);
    expect(() => inspectPitchCsv(text + ',extra')).toThrow(/column count/);
    expect(() => inspectPitchCsv(text.replace(',consent', ','))).toThrow(/nonempty headers/);
    expect(() => readPitchCsv(headers + 'id,one@example.test,T,D,,,"true\nid2,two@example.test,T,D,,,true')).toThrow(/unclosed quoted field/);
  });

  it('exports the stepper columns and the presenters under the import names', () => {
    const csv = pitchQueueCsv([{ id: 'p1', email: 'ada@example.test', title: 'T', description: 'D', status: 'new', lengthMinutes: 60,
      presenters: [{ name: 'Ada', email: 'ada@example.test', role: 'Editor', lead: true }, { name: 'Bo', email: 'bo@example.test', lead: false }] }]);
    const [head, line] = csv.trim().split('\r\n');
    const columns = head.split(',').map((name) => name.replace(/"/g, ''));
    const cells = line.split(',').map((value) => value.replace(/"/g, ''));
    const value = (name) => cells[columns.indexOf(name)];
    expect(columns).toEqual(expect.arrayContaining(['summary', 'lengthMinutes', 'leadName', 'presenter_4_role']));
    expect([value('lengthMinutes'), value('leadName'), value('leadRole'), value('presenter_1_name'), value('presenter_1_email'), value('presenter_2_name')])
      .toEqual(['60', 'Ada', 'Editor', 'Bo', 'bo@example.test', '']);
    expect(csv).not.toMatch(/privateNotes|reviewedBy|uid/);
  });
});
