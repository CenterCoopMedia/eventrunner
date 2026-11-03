// One session pitch (/admin/pitches/:pitchId): its answers, the decision,
// staff edits, private notes, the emails to the submitter, and the drafts
// an accepted pitch becomes (ADR 0008, admin review).
//
// DECISIONS ARE BUTTONS. Accept, Decline and Mark in review each save at
// once through reviewSessionPitch, with the expected status and revision,
// so two reviewers cannot both win. A decision sends no email; the emails
// stay a separate, explicit send below. Choosing another button reverses
// it.
//
// EDITS are a staff correction of the proposal (editSessionPitch). The
// first one keeps the submitted copy on the pitch. An edit raises the
// review revision, as a decision does.
//
// CONFLICTS. The page holds the revision it last read. When the live pitch
// moves on (another reviewer, an Airtable refresh), the controls stop and a
// notice offers the current version. Unsaved notes stay on the page.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { subscribePitchCall } from '../../lib/pitchSource.js';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import { PITCH_STATUS_LABELS, PITCH_STATUS_TONES, pitchRevision } from '../pitchStatus.js';
import PitchDetails from '../components/PitchDetails.jsx';
import PitchEditForm from '../components/PitchEditForm.jsx';
import { PitchEmailDelivery } from '../components/PitchEmails.jsx';
import PitchSourceMarkers from './PitchSourceMarkers.jsx';
import AdminPageHeader, { AdminEmptyState, AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';
import {
  CheckboxField, Notice, Panel, SaveStatus, SelectField, ServerErrorSummary, TextAreaField, TextField,
  primaryButtonClass, secondaryButtonClass,
} from '../components/formControls.jsx';

const DECISIONS = Object.freeze([
  { status: 'accepted', label: 'Accept' },
  { status: 'rejected', label: 'Decline' },
  { status: 'in_review', label: 'Mark in review' },
]);

function ConvertToDrafts({ pitch, call, disabled, onConverted }) {
  const { eventConfig: event } = useEventConfig();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dayId, setDayId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function convert(event) {
    event.preventDefault();
    if (busy || disabled || !confirmed) return;
    setBusy(true); setError(null);
    try {
      const response = await call('convertSessionPitch', { id: pitch.id, expectedRevision: pitchRevision(pitch), firstName, lastName, dayId, startTime, endTime });
      onConverted(response);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={convert} className="space-y-sm">
      <p className="text-admin-sm text-admin-ink-secondary">Confirm the proposed speaker and time. This creates a hidden session draft and an unapproved speaker. It sends no invite or email.</p>
      <ServerErrorSummary error={error} />
      <fieldset disabled={busy} className="space-y-sm">
        <div className="grid gap-sm sm:grid-cols-2"><TextField label="Speaker first name" value={firstName} onChange={setFirstName} required maxLength={100} /><TextField label="Speaker last name" value={lastName} onChange={setLastName} required maxLength={100} /></div>
        <SelectField label="Event day" value={dayId} onChange={setDayId} required options={[{ value: '', label: 'Choose a day' }, ...(event.days || []).map((day) => ({ value: day.id, label: day.label || day.date || day.id }))]} />
        <div className="grid gap-sm sm:grid-cols-2"><TextField label="Start time" type="time" value={startTime} onChange={setStartTime} required /><TextField label="End time" type="time" value={endTime} onChange={setEndTime} required /></div>
        <CheckboxField label="I reviewed the proposal, speaker identity, consent, and time. Create private drafts only." checked={confirmed} onChange={setConfirmed} />
      </fieldset>
      <button className={secondaryButtonClass} disabled={busy || disabled || !confirmed}>{busy ? 'Creating…' : 'Create reviewed drafts'}</button>
    </form>
  );
}

function PitchReview({ initial, current, call, settings }) {
  const { eventConfig: event } = useEventConfig();
  const [baseline, setBaseline] = useState(initial);
  const [notes, setNotes] = useState(initial.privateNotes || '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editError, setEditError] = useState(null);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const conflict = !current || pitchRevision(current) !== pitchRevision(baseline) || current.status !== baseline.status;

  async function review(status, message) {
    if (busy || conflict) return;
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('reviewSessionPitch', { id: baseline.id, status, expectedStatus: baseline.status, expectedRevision: pitchRevision(baseline) });
      setBaseline((previous) => ({ ...previous, status, reviewRevision: response.revision }));
      setResult(message);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  async function saveNotes(event) {
    event.preventDefault();
    if (busy || conflict) return;
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('reviewSessionPitch', { id: baseline.id, status: baseline.status, privateNotes: notes, expectedStatus: baseline.status, expectedRevision: pitchRevision(baseline) });
      setBaseline((previous) => ({ ...previous, privateNotes: notes, reviewRevision: response.revision }));
      setResult('Notes saved.');
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  async function saveEdit(pitch) {
    if (busy || conflict) return;
    setBusy(true); setEditError(null); setResult('');
    try {
      const response = await call('editSessionPitch', { id: baseline.id, expectedRevision: pitchRevision(baseline), pitch });
      setEditing(false);
      setBaseline((previous) => ({ ...previous, reviewRevision: response.revision }));
      setResult(response.changed.length ? 'Changes saved. The submitted copy is kept. No email was sent.' : 'Nothing changed.');
    } catch (err) { setEditError(err); } finally { setBusy(false); }
  }
  function reload() {
    if (!current || busy) return;
    setBaseline(current); setNotes(current.privateNotes || ''); setEditing(false); setError(null); setResult('Current version loaded.');
  }

  // After an own save the live row catches up; show it, so the answers are current.
  const shown = !conflict && current ? current : baseline;
  const created = shown.conversion;
  return (
    <div className="flex flex-col gap-md [overflow-wrap:anywhere]">
      <AdminPageHeader
        title={shown.title}
        state={<StatusBadge tone={PITCH_STATUS_TONES[baseline.status]}>{PITCH_STATUS_LABELS[baseline.status]}</StatusBadge>}
        identifiers={shown.email}
        description="A private proposal. Deciding or editing it sends no email and publishes nothing."
        actions={<Link to="/admin/pitches" className={secondaryButtonClass}>Back to the queue</Link>}
      />
      {conflict ? (
        <div className="flex flex-col gap-xs">
          <Notice tone="caution" message="This pitch changed since you opened it. Your unsaved notes stay below. Copy them before you load the current version." />
          <div><button type="button" className={secondaryButtonClass} onClick={reload} disabled={busy || !current}>Load the current version</button></div>
        </div>
      ) : null}
      <ServerErrorSummary error={error} errorRef={errorRef} />
      {result ? <SaveStatus message={result} /> : null}

      <Panel title="Decision" description="Each button saves at once. Choose another to change the decision. No email is sent.">
        <div className="flex flex-wrap gap-xs" role="group" aria-label="Decision">
          {DECISIONS.filter((choice) => choice.status !== baseline.status).map((choice) => (
            <button
              key={choice.status}
              type="button"
              className={choice.status === 'accepted' ? primaryButtonClass : secondaryButtonClass}
              onClick={() => review(choice.status, `${PITCH_STATUS_LABELS[choice.status]}. No email was sent.`)}
              disabled={busy || conflict}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title="Proposal"
        description={shown.submitted ? `Edited by staff${shown.editedBy ? ` (${shown.editedBy})` : ''}. The copy the person submitted is kept.` : 'As submitted.'}
        actions={editing ? null : <button type="button" className={secondaryButtonClass} onClick={() => { setEditing(true); setEditError(null); }} disabled={busy || conflict}>Edit pitch</button>}
      >
        {editing ? (
          <PitchEditForm pitch={shown} settings={settings} busy={busy} error={editError} onSave={saveEdit} onCancel={() => setEditing(false)} />
        ) : (
          <div className="flex flex-col gap-sm">
            <PitchDetails pitch={shown} />
            <p className="text-admin-sm text-admin-ink-secondary">Consent: {shown.consent ? 'Recorded for organizer review' : 'Not recorded by the legacy API; verify before using this proposal.'}</p>
            <PitchSourceMarkers row={shown} detailed timeZone={event.timezone} />
          </div>
        )}
      </Panel>

      <Panel title="Private notes" description="Staff only. Notes are left out of every export and every public draft.">
        <form onSubmit={saveNotes} className="flex flex-col gap-sm">
          <TextAreaField label="Private review notes" value={notes} onChange={setNotes} maxLength={5000} rows={4} disabled={busy} />
          <div><button type="submit" className={secondaryButtonClass} disabled={busy || conflict}>{busy ? 'Saving…' : 'Save notes'}</button></div>
        </form>
      </Panel>

      {/* The delivery block names itself ("Emails to the submitter"). */}
      <Panel>
        <PitchEmailDelivery pitch={baseline} notices={current?.notices} disabled={busy || conflict} call={call} />
      </Panel>

      {created ? (
        <Panel title="Drafts from this pitch">
          <div className="flex flex-wrap gap-sm">
            <Link to={`/admin/sessions/${created.sessionId}`} className={secondaryButtonClass}>Review session draft</Link>
            <Link to={`/admin/speakers/${created.speakerId}`} className={secondaryButtonClass}>Review speaker draft</Link>
          </div>
        </Panel>
      ) : baseline.status === 'accepted' ? (
        <Panel title="Create session and speaker drafts">
          <ConvertToDrafts
            pitch={baseline}
            call={call}
            disabled={conflict}
            onConverted={(response) => {
              setBaseline((previous) => ({ ...previous, conversion: response, reviewRevision: response.revision }));
              setResult('Private drafts created. Review both editors before publication.');
            }}
          />
        </Panel>
      ) : null}
    </div>
  );
}

export default function AdminSessionPitch() {
  const call = useAdminApi();
  const { pitchId } = useParams();
  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  const [settings, setSettings] = useState(null);
  useEffect(() => subscribeAdminCollection('session_pitches', (docs) => { setRows(docs); setListError(null); }, setListError), []);
  useEffect(() => subscribePitchCall(setSettings, () => {}), []);
  const current = rows?.find((row) => row.id === pitchId);
  if (rows === null) return listError ? <Notice tone="caution" message="Cannot load this pitch. Reconnecting…" /> : <AdminLoadingState label="Loading the pitch…" />;
  if (!current) {
    return (
      <AdminEmptyState
        title="No such pitch"
        description="It may have been removed, or the address is wrong."
        action={<Link to="/admin/pitches" className={secondaryButtonClass}>Back to the queue</Link>}
      />
    );
  }
  return <PitchReview key={current.id} initial={current} current={current} call={call} settings={settings} />;
}
