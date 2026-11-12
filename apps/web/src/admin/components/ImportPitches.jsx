import HelpTooltip from './HelpTooltip.jsx';
// The reviewed CSV import of session pitches. Moved from the pitch page to
// its own page (/admin/pitches/import) so the queue holds the queue alone.
import { useEffect, useRef, useState } from 'react';
import { PITCH_COLUMNS, PITCH_IMPORT_FIELDS, inspectPitchCsv, readPitchCsv } from '../pitchCsv.js';
import { guessMapping } from '../recordImport.js';
import { Panel, SaveStatus, TextField, SelectField, CheckboxField, ServerErrorSummary, primaryButtonClass } from './formControls.jsx';

const MATCH_HINTS = {
  externalId: 'Keep the original ID from the source form. Never use a new ID for a retry.',
  consent: 'Values must be true or checked, with evidence in the source form.',
};

function ColumnMatches({ fields, headers, mapping, onChange }) {
  return <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
    {fields.map((field) => <SelectField help="Choose the source column for this proposal detail. Leave optional details unmatched if they are absent."
      key={field.id}
      label={`${field.label}${field.required ? ' (required)' : ''}`}
      value={mapping[field.id] ?? ''}
      onChange={(header) => onChange(field.id, header)}
      required={field.required}
      options={[
        { value: '', label: field.required ? 'Choose a column' : 'Not in this file' },
        ...headers.map((header) => ({ value: header, label: header })),
      ]}
      hint={MATCH_HINTS[field.id]}
    />)}
  </div>;
}

export default function ImportPitches({ call }) {
  const [source, setSource] = useState('');
  const [file, setFile] = useState(null);
  const [mapping, setMapping] = useState({});
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  const readVersion = useRef(0);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => () => { readVersion.current += 1; }, []);
  function clearReview() {
    setRows(null); setReviewed(false); setResult(''); setError(null);
  }
  async function readFile(e) {
    const chosen = e.target.files?.[0];
    const version = ++readVersion.current;
    clearReview(); setFile(null); setMapping({}); setReading(Boolean(chosen));
    if (!chosen) return;
    try {
      if (chosen.size > 512 * 1024) throw new Error('Use a CSV smaller than 512 KB.');
      const text = await chosen.text();
      if (version !== readVersion.current) return;
      const info = inspectPitchCsv(text);
      setFile({ ...info, text, name: chosen.name });
      setMapping(guessMapping(info.headers, { fields: PITCH_IMPORT_FIELDS }));
    } catch (err) { if (version === readVersion.current) setError(err); }
    finally { if (version === readVersion.current) setReading(false); }
  }
  function reviewRows(e) {
    e.preventDefault();
    if (busy || reading || !file) return;
    clearReview();
    try { setRows(readPitchCsv(file.text, mapping)); }
    catch (err) { setError(err); }
  }
  function changeMapping(key, header) {
    clearReview(); setMapping((current) => ({ ...current, [key]: header }));
  }
  async function importRows(e) {
    e.preventDefault();
    if (busy || reading || !reviewed || !rows) return;
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('importSessionPitches', { source, rows });
      setResult(`${response.imported} ${response.imported === 1 ? 'pitch' : 'pitches'} added. ${response.unchanged} ${response.unchanged === 1 ? 'was' : 'were'} already here. No emails were sent.`);
      setRows(null); setReviewed(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <Panel help="Bring proposals from another form into the private queue. Nothing is published or emailed." title="Import proposals from CSV" description="Bring proposals from another form into the private queue. Nothing is published or emailed.">
    <form onSubmit={rows ? importRows : reviewRows} className="space-y-md">
      <p className="text-admin-sm text-admin-ink-secondary">Choose a file, match its columns, then review the proposals before importing. Use 1-50 proposals per file. Unmatched columns are ignored.</p>
      <ServerErrorSummary error={error} errorRef={errorRef} />
      <fieldset disabled={busy} className="space-y-md">
        <TextField help="A stable name for the original form. Reuse it for retries; changing it creates a separate source." label="Source name" value={source} onChange={(v) => { setSource(v); clearReview(); }} required maxLength={80} pattern="[A-Za-z0-9_-]+"  />
        <label className="flex flex-col gap-xs font-semibold">Proposal CSV<input data-help-skip="File chooser; the surrounding import instructions describe the required CSV." type="file" accept=".csv,text/csv" onChange={readFile} className="min-h-admin-control min-w-0 max-w-full text-admin-sm" /></label>
        {reading ? <p role="status">Reading the CSV…</p> : null}
        {file ? <section aria-label="Match proposal columns" className="space-y-sm">
          <div className="flex items-center gap-2xs"><h3 className="font-admin-ui text-admin-lg font-bold">Match columns</h3><HelpTooltip label="Match columns">Match each proposal detail to a column from the uploaded file.</HelpTooltip></div>
          <p className="break-words text-admin-sm">{file.name} · {file.count} {file.count === 1 ? 'proposal' : 'proposals'}</p>
          <p className="text-admin-sm text-admin-ink-secondary">Check each match. A file column can be used once. Organization and format can be left out.</p>
          <ColumnMatches fields={PITCH_IMPORT_FIELDS.filter(({ id }) => PITCH_COLUMNS.includes(id))} headers={file.headers} mapping={mapping} onChange={changeMapping} />
          <div className="flex min-w-0 items-start gap-2xs"><details className="text-admin-sm min-w-0 flex-1">
            <summary className="admin-target cursor-pointer font-semibold">Other proposal answers </summary>
            <div className="pt-sm"><ColumnMatches fields={PITCH_IMPORT_FIELDS.filter(({ id }) => !PITCH_COLUMNS.includes(id))} headers={file.headers} mapping={mapping} onChange={changeMapping} /></div>
          </details><HelpTooltip label="Other proposal answers">Choose which extra source answers to keep with the imported proposal.</HelpTooltip></div>
        </section> : null}
        {rows ? <>
          <p>{rows.length} {rows.length === 1 ? 'proposal' : 'proposals'} ready for review.</p>
          <ul className="space-y-sm">{rows.map((row) => <li key={row.externalId} className="break-words border-admin-hairline border-admin-rule-hairline p-sm">
            <p className="font-bold">{row.title}</p>
            <p className="text-admin-sm">{row.externalId} · {row.email} · {row.organization || 'No organization'} · {row.format || 'No format'}</p>
            <p className="whitespace-pre-wrap text-admin-sm">{row.description}</p>
            <p className="text-admin-sm">Consent: Recorded in source form</p>
          </li>)}</ul>
          <CheckboxField help="Confirm the original form gives permission to use these proposals and presenter details." label="I reviewed these proposals and verified consent in the source form" checked={reviewed} onChange={setReviewed} />
        </> : null}
      </fieldset>
      {rows ? <button className={primaryButtonClass} disabled={busy || !reviewed}>{busy ? 'Importing…' : 'Import reviewed proposals'}</button> : null}
      {file && !rows ? <button className={primaryButtonClass} disabled={busy || reading}>Review proposals</button> : null}
      {result ? <SaveStatus message={result} /> : null}
    </form>
  </Panel>;
}
