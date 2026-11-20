import HelpDisclosure from './HelpDisclosure.jsx';
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
const MAIN_FIELDS = PITCH_IMPORT_FIELDS.filter(({ id }) => PITCH_COLUMNS.includes(id));
const EXTRA_FIELDS = PITCH_IMPORT_FIELDS.filter(({ id }) => !PITCH_COLUMNS.includes(id));

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
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  const readVersion = useRef(0);
  const readyToImport = preview !== null && preview.every(({ row }) => row);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => () => { readVersion.current += 1; }, []);
  function clearReview() {
    setPreview(null); setReviewed(false); setResult(''); setError(null);
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
    try { setPreview(readPitchCsv(file.text, mapping)); }
    catch (err) { setError(err); }
  }
  function changeMapping(key, header) {
    clearReview(); setMapping((current) => ({ ...current, [key]: header }));
  }
  async function importRows(e) {
    e.preventDefault();
    if (busy || reading || !reviewed || !readyToImport) return;
    setBusy(true); setError(null); setResult('');
    try {
      const { imported, updated = 0, unchanged } = await call('importSessionPitches', { source, rows: preview.map(({ row }) => row) });
      setResult(`Added ${imported}. Updated ${updated}. Unchanged ${unchanged}. No emails were sent.`);
      setPreview(null); setReviewed(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <Panel help="Bring proposals from another form into the private queue. Nothing is published or emailed." title="Import proposals from CSV" description="Bring proposals from another form into the private queue. Nothing is published or emailed.">
    <form onSubmit={readyToImport ? importRows : reviewRows} className="space-y-md">
      <p className="text-admin-sm text-admin-ink-secondary">Choose a file, match its columns, then review the proposals before importing. Use 1-50 proposals per file. Unmatched columns are ignored.</p>
      <p className="text-admin-sm text-admin-ink-secondary">Using Airtable? Download your view as CSV and upload it here.</p>
      <ServerErrorSummary error={error} errorRef={errorRef} />
      <fieldset disabled={busy} className="space-y-md">
        <TextField help="Use the same source name and source IDs to update existing proposals." label="Source name" value={source} onChange={(v) => { setSource(v); clearReview(); }} required maxLength={80} pattern="[A-Za-z0-9_-]+" hint="Use the same source name and source IDs to update existing proposals." />
        <label className="flex flex-col gap-xs font-semibold">Proposal CSV<input data-help-skip="File chooser; the surrounding import instructions describe the required CSV." type="file" accept=".csv,text/csv" onChange={readFile} className="min-h-admin-control min-w-0 max-w-full text-admin-sm" /></label>
        {reading ? <p role="status">Reading the CSV…</p> : null}
        {file ? <section aria-label="Match proposal columns" className="space-y-sm">
          <div className="flex items-center gap-2xs"><h3 className="font-admin-ui text-admin-lg font-bold">Match columns</h3><HelpTooltip label="Match columns">Match each proposal detail to a column from the uploaded file.</HelpTooltip></div>
          <p className="break-words text-admin-sm">{file.name} · {file.count} {file.count === 1 ? 'proposal' : 'proposals'}</p>
          <p className="text-admin-sm text-admin-ink-secondary">Check each match. A file column can be used once. Organization and format can be left out.</p>
          <ColumnMatches fields={MAIN_FIELDS} headers={file.headers} mapping={mapping} onChange={changeMapping} />
          <HelpDisclosure title="Other proposal answers" help={"Choose which extra source answers to keep with the imported proposal."} className="text-admin-sm" titleClassName="admin-target cursor-pointer font-semibold">
            <div className="pt-sm"><ColumnMatches fields={EXTRA_FIELDS} headers={file.headers} mapping={mapping} onChange={changeMapping} /></div>
          </HelpDisclosure>
        </section> : null}
        {preview ? <>
          {readyToImport ? <p>{preview.length} {preview.length === 1 ? 'proposal' : 'proposals'} ready for review.</p>
            : <p role="alert">Correct the rows with errors, then review the proposals again.</p>}
          <ul className="space-y-sm">{preview.map(({ number, row, error: problem }) => <li key={number} className="break-words border-admin-hairline border-admin-rule-hairline p-sm">
            {problem ? <p>Row {number} — {problem}</p> : <>
              <p className="font-bold">{row.title}</p>
              <p className="text-admin-sm">{row.externalId} · {row.email} · {row.organization || 'No organization'} · {row.format || 'No format'}</p>
              <p className="whitespace-pre-wrap text-admin-sm">{row.description}</p>
              {EXTRA_FIELDS.map(({ id, label }) => row[id] && <p key={id} className="whitespace-pre-wrap text-admin-sm">{label} — {row[id]}</p>)}
              <p className="text-admin-sm">Consent: Recorded in source form</p>
            </>}
          </li>)}</ul>
          {readyToImport ? <CheckboxField help="Confirm the original form gives permission to use these proposals and presenter details." label="I reviewed these proposals and verified consent in the source form" checked={reviewed} onChange={setReviewed} /> : null}
        </> : null}
      </fieldset>
      {readyToImport ? <button className={primaryButtonClass} disabled={busy || !reviewed}>{busy ? 'Importing…' : 'Import reviewed proposals'}</button> : null}
      {file && !readyToImport ? <button className={primaryButtonClass} disabled={busy || reading}>Review proposals</button> : null}
      {result ? <SaveStatus message={result} /> : null}
    </form>
  </Panel>;
}
