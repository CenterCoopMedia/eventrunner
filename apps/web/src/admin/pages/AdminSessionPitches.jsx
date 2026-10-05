import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { subscribePitchCall } from '../../lib/pitchSource.js';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import { saveTextFile } from '../downloadFile.js';
import { PITCH_COLUMNS, readPitchCsv, pitchQueueCsv } from '../pitchCsv.js';
import AdminPageHeader, { AdminEmptyState, AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';
import { Panel, Notice, SaveStatus, TextField, TextAreaField, SelectField, CheckboxField,
  ServerErrorSummary, primaryButtonClass, secondaryButtonClass, rowTitleLinkClass } from '../components/formControls.jsx';

const labels = { new: 'New', in_review: 'In review', accepted: 'Accepted', rejected: 'Declined' };
const tones = { new: 'caution', in_review: 'info', accepted: 'ok', rejected: 'dead' };
const statuses = Object.entries(labels).map(([value, label]) => ({ value, label }));
const revision = (row) => row.reviewRevision ?? 0;

function PitchCallSettings({ settings, call }) {
  const [enabled, setEnabled] = useState(settings.enabled === true);
  const [closesAt, setClosesAt] = useState(settings.closesAt || '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setError(null); setResult(''); setBusy(true);
    try { await call('updatePitchCall', { enabled, closesAt }); setResult('Call settings saved.'); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <Panel title="Call settings" description="Only operators can open or close intake. Use a date, time, and explicit UTC offset.">
    <form onSubmit={save} className="space-y-sm">
      <ServerErrorSummary error={error} errorRef={errorRef} />
      <fieldset disabled={busy} className="space-y-sm">
        <CheckboxField label="Accept session pitches" checked={enabled} onChange={setEnabled} />
        <TextField label="Deadline (RFC3339)" value={closesAt} onChange={setClosesAt} required hint="For example, 2027-01-31T23:59:59-05:00. The offset prevents timezone ambiguity." />
      </fieldset>
      <button className={primaryButtonClass} disabled={busy}>{busy ? 'Saving…' : 'Save call settings'}</button>
      {result ? <SaveStatus message={result} /> : null}
    </form>
  </Panel>;
}

function ImportPitches({ call }) {
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
  return <details className="border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-md">
    <summary className="min-h-admin-control cursor-pointer font-semibold">Import proposals from CSV</summary>
    <form onSubmit={importRows} className="mt-sm space-y-sm">
      <p className="break-words text-admin-sm text-admin-ink-secondary">Required headers: {PITCH_COLUMNS.join(', ')}. Keep the original source IDs. Consent must be true, with evidence in the source form.</p>
      <ServerErrorSummary error={error} errorRef={errorRef} />
      <fieldset disabled={busy} className="space-y-sm">
        <TextField label="Source name" value={source} onChange={(v) => { setSource(v); setReviewed(false); }} required maxLength={80} pattern="[A-Za-z0-9_-]+" hint="A stable name for the original form. Reuse it for retries." />
        <label className="flex flex-col gap-xs font-semibold">Proposal CSV<input type="file" accept=".csv,text/csv" onChange={readFile} className="min-h-admin-control min-w-0 max-w-full text-admin-sm" /></label>
        {rows ? <><p>{rows.length} proposals ready for review.</p><ul className="space-y-sm">{rows.map((row) => <li key={row.externalId} className="break-words border-admin-hairline border-admin-rule-hairline p-sm"><p className="font-bold">{row.title}</p><p className="text-admin-sm">{row.externalId} · {row.email} · {row.organization || 'No organization'} · {row.format || 'No format'}</p><p className="whitespace-pre-wrap text-admin-sm">{row.description}</p><p className="text-admin-sm">Consent: Recorded in source form</p></li>)}</ul><CheckboxField label="I reviewed these proposals and verified consent in the source form" checked={reviewed} onChange={setReviewed} /></> : null}
      </fieldset>
      {rows ? <button className={primaryButtonClass} disabled={busy || !reviewed}>{busy ? 'Importing…' : 'Import reviewed proposals'}</button> : null}
      {result ? <SaveStatus message={result} /> : null}
    </form>
  </details>;
}

function PitchReview({ initial, current, call }) {
  const { eventConfig: event } = useEventConfig();
  const [baseline, setBaseline] = useState(initial);
  const [notes, setNotes] = useState(initial.privateNotes || '');
  const [decision, setDecision] = useState(initial.status);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [conversion, setConversion] = useState(initial.conversion);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dayId, setDayId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const conflict = !current || revision(current) !== revision(baseline) || current.status !== baseline.status;
  async function save(e) {
    e.preventDefault();
    if (busy || conflict) return;
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('reviewSessionPitch', { id: baseline.id, status: decision, privateNotes: notes, expectedStatus: baseline.status, expectedRevision: revision(baseline) });
      setBaseline({ ...baseline, privateNotes: notes, status: decision, reviewRevision: response.revision });
      setResult('Review saved. No notification was sent.');
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  async function convert(e) {
    e.preventDefault();
    if (busy || conflict || !confirmed) return;
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('convertSessionPitch', { id: baseline.id, expectedRevision: revision(baseline), firstName, lastName, dayId, startTime, endTime });
      setConversion(response);
      setBaseline((previous) => ({ ...previous, conversion: response, reviewRevision: response.revision }));
      setResult('Private drafts created. Review both editors before publication.');
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  function reload() {
    if (!current || busy) return;
    setBaseline(current); setNotes(current.privateNotes || ''); setDecision(current.status); setConversion(current.conversion); setError(null); setConfirmed(false); setResult('Current review loaded.');
  }
  const created = conversion || current?.conversion;
  return <Panel title={baseline.title} description="Private proposal details and review.">
    <div className="space-y-md [overflow-wrap:anywhere]">
      <div className="flex flex-wrap gap-sm"><StatusBadge tone={tones[baseline.status]}>{labels[baseline.status]}</StatusBadge><p className="break-all text-admin-sm">{baseline.email}</p></div>
      <p className="text-admin-sm text-admin-ink-secondary">{baseline.organization || 'No organization'} · {baseline.format || 'No format'}</p>
      <p className="whitespace-pre-wrap break-words">{baseline.description}</p>
      <p className="text-admin-sm text-admin-ink-secondary">Consent: {baseline.consent ? 'Recorded for organizer review' : 'Not recorded by the legacy API; verify before using this proposal.'}</p>
      {conflict ? <><Notice tone="caution" message="This pitch changed. Your unsaved notes remain below. Copy them before loading the current review." /><button className={secondaryButtonClass} onClick={reload} disabled={busy || !current}>Load current review</button></> : null}
      <ServerErrorSummary error={error} errorRef={errorRef} />
      <form onSubmit={save} className="space-y-sm">
        <fieldset disabled={busy} className="space-y-sm">
          <TextAreaField label="Private review notes" value={notes} onChange={setNotes} maxLength={5000} rows={4} hint="Staff only. These notes are excluded from CSV and all public drafts." />
          <SelectField label="Decision" value={decision} onChange={setDecision} options={statuses} />
        </fieldset>
        <button className={primaryButtonClass} disabled={busy || conflict}>{busy ? 'Saving…' : 'Save review decision'}</button>
      </form>
      {result ? <SaveStatus message={result} /> : null}
      {created ? <div className="flex flex-wrap gap-sm"><Link to={`/admin/sessions/${created.sessionId}`} className={secondaryButtonClass}>Review session draft</Link><Link to={`/admin/speakers/${created.speakerId}`} className={secondaryButtonClass}>Review speaker draft</Link></div> : baseline.status === 'accepted' ? <details className="border-t-admin-hairline border-admin-rule-hairline pt-md"><summary className="min-h-admin-control cursor-pointer font-semibold">Create session and speaker drafts</summary>
        <form onSubmit={convert} className="mt-sm space-y-sm">
          <p className="text-admin-sm text-admin-ink-secondary">Confirm the proposed speaker and time. This creates a hidden session draft and an unapproved speaker. It sends no invite or email.</p>
          <fieldset disabled={busy} className="space-y-sm">
            <div className="grid gap-sm sm:grid-cols-2"><TextField label="Speaker first name" value={firstName} onChange={setFirstName} required maxLength={100} /><TextField label="Speaker last name" value={lastName} onChange={setLastName} required maxLength={100} /></div>
            <SelectField label="Event day" value={dayId} onChange={setDayId} required options={[{ value: '', label: 'Choose a day' }, ...(event.days || []).map((day) => ({ value: day.id, label: day.label || day.date || day.id }))]} />
            <div className="grid gap-sm sm:grid-cols-2"><TextField label="Start time" type="time" value={startTime} onChange={setStartTime} required /><TextField label="End time" type="time" value={endTime} onChange={setEndTime} required /></div>
            <CheckboxField label="I reviewed the proposal, speaker identity, consent, and time. Create private drafts only." checked={confirmed} onChange={setConfirmed} />
          </fieldset>
          <button className={secondaryButtonClass} disabled={busy || conflict || !confirmed}>{busy ? 'Creating…' : 'Create reviewed drafts'}</button>
        </form>
      </details> : null}
    </div>
  </Panel>;
}

export default function AdminSessionPitches() {
  const call = useAdminApi();
  const { isOperator } = useAuth();
  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  const [settings, setSettings] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const detailRef = useRef(null);
  useEffect(() => subscribeAdminCollection('session_pitches', (docs) => { setRows(docs); setListError(null); }, setListError), []);
  useEffect(() => subscribePitchCall((value) => { setSettings(value); setConfigError(false); }, () => setConfigError(true)), []);
  const shown = (rows || []).filter((row) => (filter === 'all' || row.status === filter) && `${row.title} ${row.email} ${row.organization || ''}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.id.localeCompare(b.id));
  const current = rows?.find((row) => row.id === selected?.id);
  useEffect(() => { if (selected) detailRef.current?.focus(); }, [selected]);
  return <div className="flex flex-col gap-md [overflow-wrap:anywhere]">
    <AdminPageHeader title="Session pitches" description="Review private proposals. A decision does not send a notification or publish event content." actions={<button className={secondaryButtonClass} disabled={!rows || Boolean(listError)} onClick={() => saveTextFile('session-pitches.csv', pitchQueueCsv(shown))}>Export filtered queue</button>} />
    <p className="text-admin-sm text-admin-ink-secondary"><Link to="/pitch" className={rowTitleLinkClass}>Open public pitch form</Link>. CSV contains contact details: Keep the downloaded file private. Review notes are excluded.</p>
    {isOperator && settings && !configError ? <details><summary className="min-h-admin-control cursor-pointer font-semibold">Manage the call for sessions</summary><PitchCallSettings key={`${settings.enabled}-${settings.closesAt}`} settings={settings} call={call} /></details> : null}
    {configError ? <Notice tone="caution" message="Cannot check call settings. Reconnecting…" /> : null}
    <ImportPitches call={call} />
    <div className="grid gap-sm sm:grid-cols-2"><SelectField label="Filter by decision" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All pitches' }, ...statuses]} /><TextField label="Search pitches" value={search} onChange={setSearch} hint="Title, email, or organization." /></div>
    {listError ? <Notice tone="caution" message="Cannot load the queue. Reconnecting; saved values may be out of date." /> : null}
    {rows === null ? <AdminLoadingState label="Loading session pitches…" /> : <>
      <p role="status" className="text-admin-sm text-admin-ink-secondary">Showing {shown.length} of {rows.length} pitches.</p>
      <div className="grid items-start gap-md xl:grid-cols-2">
        {shown.length ? <Panel title="Review queue" flush className="min-w-0"><ul>{shown.map((row) => <li key={row.id} className="space-y-xs border-b-admin-hairline border-admin-rule-hairline px-md py-sm last:border-b-0">
          <StatusBadge tone={tones[row.status]}>{labels[row.status]}</StatusBadge>
          <button className={`${rowTitleLinkClass} block max-w-full min-w-0 [overflow-wrap:anywhere] text-start`} aria-pressed={selected?.id === row.id} onClick={() => setSelected(row)}>{row.title}</button>
          <p className="break-all text-admin-sm text-admin-ink-secondary">{row.email} · {row.organization || 'No organization'}</p>
        </li>)}</ul></Panel> : <AdminEmptyState title="No pitches in this view" description="Try another decision filter or search. Imported and submitted proposals appear here." />}
        <section ref={detailRef} tabIndex={-1} aria-label="Selected pitch" className="min-w-0">{selected ? <PitchReview key={selected.id} initial={selected} current={current} call={call} /> : <AdminEmptyState title="Choose a pitch" description="Open a proposal to see its details, private notes, and review decision." />}</section>
      </div>
    </>}
  </div>;
}
