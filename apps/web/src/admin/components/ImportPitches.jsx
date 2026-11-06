import { plannerError, plannerMessage } from '../plannerErrors.js';
import '../plannerFields.css';
import { useEffect, useRef, useState } from 'react';
import { OPTIONAL_PITCH_COLUMNS, PITCH_COLUMNS, readPitchCsv } from '../pitchCsv.js';
import { parseCsvFile } from '../../lib/csv.js';
import { saveTextFile } from '../downloadFile.js';
import AdminIconControl from './AdminIconControl.jsx';
import { Panel, SaveStatus, TextField, SelectField, CheckboxField, ServerErrorSummary, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';

const LABELS = {
  externalId: 'Reference', email: 'Email', title: 'Title', description: 'Description', organization: 'Organization',
  format: 'Format', consent: 'Consent', summary: 'Summary', lengthMinutes: 'Length in minutes', track: 'Track',
  audienceLevel: 'Audience', leadName: 'Lead presenter name', leadRole: 'Lead presenter role',
  accessNeeds: 'Access needs', notes: 'Notes to the organizers',
};
const labelOf = (key) => LABELS[key] || key.replace(/^presenter_(\d+)_(.*)$/, (_, number, field) => `Co-presenter ${number} ${field}`);
const columns = [...PITCH_COLUMNS, ...OPTIONAL_PITCH_COLUMNS];
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const sourceKey = (value) => value.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '');
const squash = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export default function ImportPitches({ call }) {
  const [source, setSource] = useState('');
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  const inputRevision = useRef(0);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function readFile(e) {
    const file = e.target.files?.[0];
    const revision = ++inputRevision.current;
    setRows(null); setParsed(null); setReviewed(false); setResult(''); setError(null);
    if (!file) return;
    try {
      if (file.size > 512 * 1024) throw new Error('Use a CSV smaller than 512 KB.');
      const fileData = parseCsvFile(await file.text());
      if (revision !== inputRevision.current) return;
      if (!fileData.rows.length || fileData.rows.length > 50) throw new Error('Import 1 to 50 proposals at a time.');
      setParsed(fileData);
      setMapping(Object.fromEntries(columns.map((key) => [key, fileData.headers.find((header) => [squash(key), squash(labelOf(key))].includes(squash(header))) || ''])));
      if (!source) setSource(file.name.replace(/\.csv$/i, '').slice(0, 80));
    } catch (err) { if (revision === inputRevision.current) setError(plannerError(err)); }
  }
  function preview() {
    setError(null); setReviewed(false);
    const missing = ['externalId', 'email', 'title', 'description', 'consent'].find((key) => !mapping[key]);
    if (missing) { setError({ message: `Choose the column for ${labelOf(missing).toLowerCase()}.` }); return; }
    try {
      const included = [...PITCH_COLUMNS, ...OPTIONAL_PITCH_COLUMNS.filter((key) => mapping[key])];
      const mapped = [included.map(csvCell).join(','), ...parsed.rows.map((row) => included.map((key) => csvCell(row[mapping[key]])).join(','))].join('\n');
      setRows(readPitchCsv(mapped));
    } catch (err) { setError({ message: plannerMessage(err.message).replace(/source ID/g, 'reference').replace(/Consent must be true or checked and evidenced in the source form\./g, 'Confirm consent in the original form before importing.') }); }
  }
  async function importRows(e) {
    e.preventDefault();
    if (busy || !reviewed || !rows) return;
    if (!sourceKey(source)) { setError({ message: 'Enter a name for the original form.' }); return; }
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('importSessionPitches', { source: sourceKey(source), rows });
      setResult(`${response.imported} ${response.imported === 1 ? 'pitch' : 'pitches'} added. ${response.unchanged} ${response.unchanged === 1 ? 'was' : 'were'} already here. No emails were sent.`);
      setRows(null); setParsed(null); setReviewed(false);
    } catch (err) { setError(plannerError(err)); }
    finally { setBusy(false); }
  }
  return <Panel title="Import proposals from CSV" description="Choose a file and match its columns, then review the proposals before importing."
    actions={<AdminIconControl label="Download pitch template" icon="download" className={secondaryButtonClass} onClick={() => saveTextFile('pitch-template.csv', PITCH_COLUMNS.map((key) => csvCell(labelOf(key))).join(',') + '\n')} />}>
    <form onSubmit={importRows} className="space-y-sm">
      <ServerErrorSummary error={error} errorRef={errorRef} />
      <fieldset disabled={busy} className="space-y-sm">
        <TextField label="Source name" value={source} onChange={(v) => { setSource(v); setReviewed(false); }} required maxLength={80} hint="Name the original form. Use the same name when importing updates." />
        <label className="flex flex-col gap-xs font-semibold">Proposal CSV<input type="file" accept=".csv,text/csv" onChange={readFile} className="min-h-admin-control min-w-0 max-w-full text-admin-sm" /></label>
        {parsed ? <>
          <div className="planner-fields grid gap-sm sm:grid-cols-2">{columns.map((key) => <SelectField key={key} label={labelOf(key)} value={mapping[key] || ''}
            onChange={(value) => { setMapping((previous) => ({ ...previous, [key]: value })); setRows(null); setReviewed(false); }}
            options={[{ value: '', label: 'Not in this file' }, ...parsed.headers.map((header) => ({ value: header, label: labelOf(columns.find((key) => squash(key) === squash(header)) || header) }))]} />)}</div>
          <button type="button" className={secondaryButtonClass} onClick={preview}>Preview import</button>
        </> : null}
        {rows ? <><p>{rows.length} proposals ready for review.</p><ul className="space-y-sm">{rows.map((row) => <li key={row.externalId} className="break-words border-admin-hairline border-admin-rule-hairline p-sm"><p className="font-bold">{row.title}</p><p className="text-admin-sm">{row.email} · {row.organization || 'No organization'} · {row.format || 'No format'}</p><p className="whitespace-pre-wrap text-admin-sm">{row.description}</p><p className="text-admin-sm">Consent: Recorded in source form</p></li>)}</ul><CheckboxField label="I reviewed these proposals and verified consent in the source form" checked={reviewed} onChange={setReviewed} /></> : null}
      </fieldset>
      {rows ? <button className={primaryButtonClass} disabled={busy || !reviewed}>{busy ? 'Importing…' : 'Import'}</button> : null}
      {result ? <SaveStatus message={result} /> : null}
    </form>
  </Panel>;
}
