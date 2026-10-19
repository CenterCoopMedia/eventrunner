// Airtable connection for session pitches: the refresh status and the
// refresh action for staff, and the connection settings for operators.
// The server is functions/src/sessions/airtableSync.cjs.
import { useEffect, useRef, useState } from 'react';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { subscribeAdminCollection } from '../adminSource.js';
import { formatPublishedAt } from '../versionHistory.js';
import { StatusBadge } from '../components/adminChrome.jsx';
import { Notice, SaveStatus, TextField, SelectField, CheckboxField, ServerErrorSummary,
  primaryButtonClass, secondaryButtonClass } from '../components/formControls.jsx';

const BASE_ID_RE = /^app[A-Za-z0-9]{14}$/;
const FIELDS = [
  { key: 'email', label: 'Email field', required: true },
  { key: 'title', label: 'Title field', required: true },
  { key: 'description', label: 'Description field', required: true },
  { key: 'consent', label: 'Consent checkbox field', required: true, hint: 'A checkbox field. Only a ticked box counts as consent.' },
  { key: 'organization', label: 'Organization field (optional)' },
  { key: 'format', label: 'Format field (optional)' },
  { key: 'externalId', label: 'External ID field (optional)', hint: 'Leave empty to use the Airtable record ID. Do not change this after the first refresh.' },
];
const DEFAULT_MAP = { email: 'email', title: 'title', description: 'description', consent: 'consent', organization: 'organization', format: 'format', externalId: '' };
const SCHEDULES = [
  { value: '0', label: 'Off. Staff refresh by hand.' },
  { value: '15', label: 'Every 15 minutes' },
  { value: '60', label: 'Every hour' },
];
const OUTCOMES = {
  completed: { tone: 'ok', word: 'Completed' },
  partial: { tone: 'caution', word: 'Completed in part' },
  failed: { tone: 'error', word: 'Failed' },
};
const REASONS = {
  'no-consent': 'Consent box not ticked',
  'invalid-email': 'Email missing or not valid',
  'invalid-field': 'Required text missing or too long',
  'missing-id': 'External ID missing',
  'duplicate-id': 'External ID used twice',
};
const COUNTS = [
  ['created', 'Created'], ['updated', 'Updated'], ['unchanged', 'Unchanged'], ['restored', 'Back in Airtable'],
  ['skipped', 'Skipped'], ['removed', 'Flagged as removed'],
];

function useDoc(collection, id, enabled = true) {
  const [value, setValue] = useState(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeAdminCollection(collection, (docs) => { setValue(docs.find((doc) => doc.id === id) || null); setFailed(false); }, () => setFailed(true));
  }, [collection, id, enabled]);
  return [value, failed];
}

// Lowercase only the first letter, so "Back in Airtable" keeps its capital.
function summary(counts = {}) {
  return COUNTS.map(([key, label]) => `${label[0].toLowerCase()}${label.slice(1)} ${counts[key] ?? 0}`).join(', ');
}

function RunStatus({ status, timeZone }) {
  if (status === undefined) return <p className="text-admin-sm text-admin-ink-secondary">Loading the refresh status…</p>;
  const run = status?.lastRun;
  const running = status?.running;
  return <div className="space-y-sm" aria-label="Airtable refresh status">
    {running ? <Notice tone="info" message={`A refresh is running. It started ${formatPublishedAt(running.startedAt, timeZone)}.`} /> : null}
    {!run ? <p className="text-admin-sm">No refresh has run yet.</p> : <>
      <p className="flex flex-wrap items-center gap-xs text-admin-sm">
        <StatusBadge tone={OUTCOMES[run.outcome]?.tone}>{OUTCOMES[run.outcome]?.word || 'Unknown'}</StatusBadge>
        <span>Last refresh {formatPublishedAt(run.finishedAt || run.startedAt, timeZone)}, {run.trigger === 'scheduled' ? 'on the schedule' : `by ${run.by || 'staff'}`}.</span>
      </p>
      {run.outcome === 'partial' ? <p className="text-admin-sm">The view has more records than one refresh reads (1,000). Records past that limit were not read, and no record was flagged as removed. Use a smaller view.</p> : null}
      <dl className="grid grid-cols-2 gap-x-md gap-y-3xs text-admin-sm sm:grid-cols-3">
        {COUNTS.map(([key, label]) => <div key={key} className="flex justify-between gap-sm border-b-admin-hairline border-admin-rule-hairline py-3xs"><dt>{label}</dt><dd className="font-admin-data">{run.counts?.[key] ?? 0}</dd></div>)}
      </dl>
      {run.counts?.skipped ? <details>
        <summary className="min-h-admin-control cursor-pointer text-admin-sm font-semibold">Why records were skipped</summary>
        <ul className="mt-xs space-y-3xs text-admin-sm">
          {Object.entries(run.skippedReasons || {}).map(([reason, count]) => <li key={reason}>{REASONS[reason] || reason}: {count}</li>)}
        </ul>
        {run.skippedRecords?.length ? <><p className="mt-xs text-admin-sm text-admin-ink-secondary">Airtable record IDs (first {run.skippedRecords.length}). Find them in Airtable with the record ID search.</p>
          <ul className="mt-3xs space-y-3xs font-admin-data text-admin-xs">{run.skippedRecords.map((item) => <li key={`${item.recordId}-${item.reason}`} className="break-all">{item.recordId} · {REASONS[item.reason] || item.reason}{item.field ? ` · ${item.field}` : ''}</li>)}</ul></> : null}
      </details> : null}
      {run.error ? <Notice tone="caution" message={`Last error: ${run.error.message}`} /> : null}
    </>}
  </div>;
}

function RefreshAction({ call }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function refresh() {
    if (busy) return;
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('refreshAirtablePitches', {});
      setResult(`Refresh ${response.outcome === 'partial' ? 'completed in part' : 'complete'}: ${summary(response.counts)}. No decision was changed and no email was sent.`);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <div className="space-y-sm">
    <ServerErrorSummary error={error} errorRef={errorRef} title="The refresh did not finish" />
    <button type="button" className={primaryButtonClass} onClick={refresh} aria-disabled={busy || undefined} aria-busy={busy || undefined}>{busy ? 'Refreshing…' : 'Refresh from Airtable'}</button>
    {result ? <SaveStatus message={result} /> : null}
  </div>;
}

function readSettings(stored) {
  return {
    enabled: stored ? stored.enabled === true : true,
    baseId: stored?.baseId || '',
    table: stored?.table || '',
    view: stored?.view || '',
    scheduleMinutes: String(stored?.scheduleMinutes ?? 0),
    fieldMap: { ...DEFAULT_MAP, ...Object.fromEntries(Object.entries(stored?.fieldMap || {}).map(([key, value]) => [key, value || ''])) },
  };
}

// The form keeps its own entries after the first load, so a save (which
// changes the stored document) never closes it or clears its result.
function ConnectionSettings({ stored, call }) {
  const [form, setForm] = useState(() => readSettings(stored));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  const formRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const set = (key) => (value) => { setForm((prev) => ({ ...prev, [key]: value })); setErrors((prev) => ({ ...prev, [key]: '' })); };
  const setField = (key) => (value) => { setForm((prev) => ({ ...prev, fieldMap: { ...prev.fieldMap, [key]: value } })); setErrors((prev) => ({ ...prev, [key]: '' })); };
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    const problems = {};
    if (!BASE_ID_RE.test(form.baseId.trim())) problems.baseId = 'Enter the base ID: app followed by 14 letters or numbers.';
    if (!form.table.trim()) problems.table = 'Enter the table ID or the table name.';
    for (const field of FIELDS) if (field.required && !form.fieldMap[field.key].trim()) problems[field.key] = 'Enter the Airtable field name.';
    if (Object.keys(problems).length) {
      setErrors(problems);
      const first = Object.keys(problems)[0];
      formRef.current?.querySelector(`[name="${first}"]`)?.focus();
      return;
    }
    setBusy(true); setError(null); setResult('');
    try {
      await call('updateAirtablePitchSource', {
        enabled: form.enabled,
        baseId: form.baseId.trim(),
        table: form.table.trim(),
        view: form.view.trim() || null,
        scheduleMinutes: Number(form.scheduleMinutes),
        fieldMap: Object.fromEntries(FIELDS.map(({ key }) => [key, form.fieldMap[key].trim() || null])),
      });
      setResult('Airtable settings saved. Refresh to check the connection.');
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <details className="border-t-admin-hairline border-admin-rule-hairline pt-sm">
    <summary className="min-h-admin-control cursor-pointer font-semibold">Connection settings</summary>
    <form ref={formRef} onSubmit={save} noValidate className="mt-sm space-y-sm">
      <p className="text-admin-sm text-admin-ink-secondary">Only operators can change these settings. The access token is a deployment secret (AIRTABLE_API_TOKEN). It is never entered or shown here.</p>
      <ServerErrorSummary error={error} errorRef={errorRef} />
      <fieldset disabled={busy} className="space-y-sm">
        <CheckboxField label="Use this Airtable connection" checked={form.enabled} onChange={set('enabled')} hint="Clear the box to stop every refresh. Pitches already in the queue stay." />
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField name="baseId" label="Base ID" value={form.baseId} onChange={set('baseId')} required maxLength={17} error={errors.baseId} hint="Copy it from the base address in Airtable. It starts with app." />
          <TextField name="table" label="Table ID or name" value={form.table} onChange={set('table')} required maxLength={100} error={errors.table} hint="Use the table ID (starts with tbl), so a renamed table still works." />
        </div>
        <TextField name="view" label="View (optional)" value={form.view} onChange={set('view')} maxLength={100} hint="Only records in this view come in. A record that leaves the view is flagged as removed, not deleted." />
        <fieldset className="space-y-sm">
          <legend className="font-semibold">Airtable field names</legend>
          <div className="grid gap-sm sm:grid-cols-2">
            {FIELDS.map((field) => <TextField key={field.key} name={field.key} label={field.label} value={form.fieldMap[field.key]} onChange={setField(field.key)} required={field.required} maxLength={100} error={errors[field.key]} hint={field.hint} />)}
          </div>
        </fieldset>
        <SelectField label="Automatic refresh" value={form.scheduleMinutes} onChange={set('scheduleMinutes')} options={SCHEDULES} hint="A scheduled refresh does the same work as the button. It never publishes or sends email." />
      </fieldset>
      <button className={secondaryButtonClass} aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Save Airtable settings'}</button>
      {result ? <SaveStatus message={result} /> : null}
    </form>
  </details>;
}

/**
 * @param {{ call: Function, isOperator: boolean }} props
 */
export default function AirtablePitchSync({ call, isOperator }) {
  const { eventConfig } = useEventConfig();
  const timeZone = eventConfig?.timezone;
  const [status, statusFailed] = useDoc('session_pitch_sync', 'airtable');
  const [settings, settingsFailed] = useDoc('session_pitch_sources', 'airtable', isOperator);
  return <details className="border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-md">
    <summary className="min-h-admin-control cursor-pointer font-semibold">Refresh pitches from Airtable</summary>
    <div className="mt-sm space-y-md">
      <p className="text-admin-sm text-admin-ink-secondary">A refresh reads the approved Airtable table and adds new pitches to this private queue. A changed record updates the proposal text and keeps its decision and notes. Nothing is deleted, published or emailed.</p>
      {statusFailed ? <Notice tone="caution" message="Cannot load the refresh status. Reconnecting…" /> : <RunStatus status={status} timeZone={timeZone} />}
      <RefreshAction call={call} />
      {isOperator && settingsFailed ? <Notice tone="caution" message="Cannot load the Airtable settings. Reconnecting…" /> : null}
      {isOperator && settings !== undefined && !settingsFailed ? <ConnectionSettings stored={settings} call={call} /> : null}
    </div>
  </details>;
}
