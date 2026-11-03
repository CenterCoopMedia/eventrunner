// The reviewed CSV import of session pitches. Moved from the pitch page to
// its own page (/admin/pitches/import) so the queue holds the queue alone.
import { useEffect, useRef, useState } from 'react';
import { OPTIONAL_PITCH_COLUMNS, PITCH_COLUMNS, readPitchCsv } from '../pitchCsv.js';
import { Panel, SaveStatus, TextField, CheckboxField, ServerErrorSummary, primaryButtonClass } from './formControls.jsx';

export default function ImportPitches({ call }) {
  const [source, setSource] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function readFile(e) {
    const file = e.target.files?.[0];
    setRows(null); setReviewed(false); setResult(''); setError(null);
    if (!file) return;
    try {
      if (file.size > 512 * 1024) throw new Error('Use a CSV smaller than 512 KB.');
      setRows(readPitchCsv(await file.text()));
    } catch (err) { setError(err); }
  }
  async function importRows(e) {
    e.preventDefault();
    if (busy || !reviewed || !rows) return;
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('importSessionPitches', { source, rows });
      setResult(`${response.imported} imported; ${response.unchanged} already present. No decisions or emails were created.`);
      setRows(null); setReviewed(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <Panel title="Import proposals from CSV" description="Bring proposals from another form into the private queue. Nothing is published or emailed.">
    <form onSubmit={importRows} className="space-y-sm">
      <p className="break-words text-admin-sm text-admin-ink-secondary">Required headers: {PITCH_COLUMNS.join(', ')}. Optional headers carry the pitch form’s other answers: {OPTIONAL_PITCH_COLUMNS.slice(0, 8).join(', ')}, and presenter_1_name, presenter_1_email, presenter_1_organization, presenter_1_role up to presenter_4. An exported file has the same headers. Other columns are ignored. Keep the original source IDs. Consent must be true (or checked, from an Airtable checkbox), with evidence in the source form.</p>
      <ServerErrorSummary error={error} errorRef={errorRef} />
      <fieldset disabled={busy} className="space-y-sm">
        <TextField label="Source name" value={source} onChange={(v) => { setSource(v); setReviewed(false); }} required maxLength={80} pattern="[A-Za-z0-9_-]+" hint="A stable name for the original form. Reuse it for retries." />
        <label className="flex flex-col gap-xs font-semibold">Proposal CSV<input type="file" accept=".csv,text/csv" onChange={readFile} className="min-h-admin-control min-w-0 max-w-full text-admin-sm" /></label>
        {rows ? <><p>{rows.length} proposals ready for review.</p><ul className="space-y-sm">{rows.map((row) => <li key={row.externalId} className="break-words border-admin-hairline border-admin-rule-hairline p-sm"><p className="font-bold">{row.title}</p><p className="text-admin-sm">{row.externalId} · {row.email} · {row.organization || 'No organization'} · {row.format || 'No format'}</p><p className="whitespace-pre-wrap text-admin-sm">{row.description}</p><p className="text-admin-sm">Consent: Recorded in source form</p></li>)}</ul><CheckboxField label="I reviewed these proposals and verified consent in the source form" checked={reviewed} onChange={setReviewed} /></> : null}
      </fieldset>
      {rows ? <button className={primaryButtonClass} disabled={busy || !reviewed}>{busy ? 'Importing…' : 'Import reviewed proposals'}</button> : null}
      {result ? <SaveStatus message={result} /> : null}
    </form>
  </Panel>;
}

