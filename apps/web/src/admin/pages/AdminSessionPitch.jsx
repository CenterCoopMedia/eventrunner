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
import { speakerCandidates } from 'shared/pitchForm';
import { useAdminApi } from '../adminApi.js';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import { conversionMessage, splitName } from '../pitchConversion.js';
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
  const { speakers, loading: speakersLoading } = useAdminSpeakers();
  const candidates = speakerCandidates(pitch);
  const [names, setNames] = useState(() => candidates.map((presenter) => splitName(presenter.name)));
  const [dayId, setDayId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [invite, setInvite] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The server links a presenter whose email is already on a speaker.
  const known = (presenter) => (presenter.email ? speakers.find((speaker) => speaker.email === presenter.email.toLowerCase()) : null) ?? null;
  const setName = (index, part, value) => setNames((previous) => previous.map((pair, i) => (i === index ? (part === 0 ? [value, pair[1]] : [pair[0], value]) : pair)));
  async function convert(submitEvent) {
    submitEvent.preventDefault();
    if (busy || disabled || !confirmed || speakersLoading) return;
    setBusy(true); setError(null);
    try {
      const response = await call('convertSessionPitch', {
        id: pitch.id, expectedRevision: pitchRevision(pitch), dayId, startTime, endTime, invite,
        speakers: candidates.map((presenter, index) => (known(presenter) ? null : { firstName: names[index][0], lastName: names[index][1] })),
      });
      onConverted(response);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={convert} className="space-y-sm">
      <p className="text-admin-sm text-admin-ink-secondary">Confirm each presenter and the time. This creates a hidden session draft and an unapproved speaker for each new presenter. A presenter who is already a speaker is linked, not copied.</p>
      <ServerErrorSummary error={error} />
      <fieldset disabled={busy} className="space-y-sm">
        <ul aria-label="Presenters" className="space-y-sm">
          {candidates.map((presenter, index) => {
            const speaker = known(presenter);
            const label = presenter.lead ? 'Lead presenter' : `Co-presenter ${index}`;
            return (
              <li key={presenter.email || index} className="space-y-xs">
                <p className="text-admin-sm"><span className="font-medium">{label}</span> <span className="text-admin-ink-secondary">{presenter.email || 'No email'}</span></p>
                {speaker ? (
                  <p className="text-admin-sm text-admin-ink-secondary">Already a speaker: {speaker.displayName}. This pitch links to that record and sends that speaker no invite.</p>
                ) : (
                  <div className="grid gap-sm sm:grid-cols-2">
                    <TextField label={`${label} first name`} value={names[index][0]} onChange={(value) => setName(index, 0, value)} required maxLength={100} />
                    <TextField label={`${label} last name`} value={names[index][1]} onChange={(value) => setName(index, 1, value)} required maxLength={100} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <SelectField label="Event day" value={dayId} onChange={setDayId} required options={[{ value: '', label: 'Choose a day' }, ...(event.days || []).map((day) => ({ value: day.id, label: day.label || day.date || day.id }))]} />
        <div className="grid gap-sm sm:grid-cols-2"><TextField label="Start time" type="time" value={startTime} onChange={setStartTime} required /><TextField label="End time" type="time" value={endTime} onChange={setEndTime} required /></div>
        <CheckboxField label="Invite the presenters now" hint="Each new speaker gets the speaker invite email, to make an account and fill in a profile. Linked speakers get nothing." checked={invite} onChange={setInvite} />
        <CheckboxField label="I reviewed the proposal, the presenters, consent, and the time." checked={confirmed} onChange={setConfirmed} />
      </fieldset>
      <button className={secondaryButtonClass} disabled={busy || disabled || !confirmed || speakersLoading}>{busy ? 'Creating…' : 'Create reviewed drafts'}</button>
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
  // Bumped by "Load the current version": the draft-creation form starts
  // again, so a confirmation given for the old proposal never carries over.
  const [loads, setLoads] = useState(0);
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
    setBaseline(current); setNotes(current.privateNotes || ''); setEditing(false); setError(null); setLoads((n) => n + 1); setResult('Current version loaded.');
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
            {(Array.isArray(created.speakerIds) ? created.speakerIds : [created.speakerId]).map((speakerId, index, all) => (
              <Link key={speakerId} to={`/admin/speakers/${speakerId}`} className={secondaryButtonClass}>
                {all.length === 1 ? 'Review speaker draft' : `Review speaker ${index + 1}`}
              </Link>
            ))}
          </div>
        </Panel>
      ) : baseline.status === 'accepted' ? (
        <Panel title="Create session and speaker drafts">
          <ConvertToDrafts
            key={loads}
            pitch={baseline}
            call={call}
            disabled={conflict}
            onConverted={(response) => {
              setBaseline((previous) => ({ ...previous, conversion: response, reviewRevision: response.revision }));
              setResult(conversionMessage(response));
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
