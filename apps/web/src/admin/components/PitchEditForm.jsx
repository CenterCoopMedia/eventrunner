import HelpTooltip from './HelpTooltip.jsx';
import '../plannerFields.css';
// A staff edit of a pitch (ADR 0008, admin review): the proposal fields
// the pitch stepper collects, corrected in place. The check is the server's
// (editSessionPitch runs shared/pitchForm checkPitch); the form shows the
// server's refusal under the save and keeps every entry.
//
// The lead presenter's email is the submitter's and is not editable. A
// format, length or track the pitch already holds stays a choice here after
// staff take it off the call's list, as it does on the server.
import { useState } from 'react';
import { AUDIENCE_LEVELS, MAX_CO_PRESENTERS, readPitchFormOptions, readPresenters } from 'shared/pitchForm';
import {
  Notice, SelectField, TextAreaField, TextField, primaryButtonClass, secondaryButtonClass,
} from './formControls.jsx';
import AdminIconControl from './AdminIconControl.jsx';
import { AddItemButton } from './listItemControls.jsx';

const withStored = (list, value) => (value === null || value === undefined || value === '' || list.includes(value) ? list : [...list, value]);
const orEmpty = (value) => (value === null || value === undefined ? '' : value);

function formOf(pitch) {
  const [lead, ...rest] = readPresenters(pitch);
  return {
    title: orEmpty(pitch.title),
    summary: orEmpty(pitch.summary),
    description: orEmpty(pitch.description),
    organization: orEmpty(pitch.organization),
    format: orEmpty(pitch.format),
    lengthMinutes: pitch.lengthMinutes ? String(pitch.lengthMinutes) : '',
    track: orEmpty(pitch.track),
    audienceLevel: orEmpty(pitch.audienceLevel),
    leadName: orEmpty(lead?.name),
    leadRole: orEmpty(lead?.role),
    presenters: rest.map((person, index) => ({
      key: `stored-${index}`, name: orEmpty(person.name), email: orEmpty(person.email),
      organization: orEmpty(person.organization), role: orEmpty(person.role),
    })),
    accessNeeds: orEmpty(pitch.accessNeeds),
    notes: orEmpty(pitch.notes),
  };
}

/** The body editSessionPitch reads. */
function bodyOf(form) {
  const text = (value) => value.trim();
  const orNull = (value) => value.trim() || null;
  return {
    title: text(form.title),
    summary: orNull(form.summary),
    description: text(form.description),
    organization: orNull(form.organization),
    format: orNull(form.format),
    lengthMinutes: form.lengthMinutes === '' ? null : Number(form.lengthMinutes),
    track: orNull(form.track),
    audienceLevel: orNull(form.audienceLevel),
    leadName: text(form.leadName),
    leadRole: orNull(form.leadRole),
    presenters: form.presenters.map((row) => ({
      name: text(row.name), email: text(row.email), organization: orNull(row.organization), role: orNull(row.role),
    })),
    accessNeeds: orNull(form.accessNeeds),
    notes: orNull(form.notes),
  };
}

let rowCount = 0;

/**
 * @param {{ pitch: object, settings: object|null, onSave: (pitch: object) => Promise<void>,
 *   onCancel: () => void, busy: boolean, error: Error|null }} props
 */
export default function PitchEditForm({ pitch, settings, onSave, onCancel, busy, error }) {
  const [form, setForm] = useState(() => formOf(pitch));
  const options = readPitchFormOptions(settings);
  // A choice list only when the call sets one; with none, format is free
  // text on the server too, so staff can correct it here.
  const formats = options.formats.length ? withStored(options.formats, pitch.format) : [];
  const lengths = withStored(options.lengths, pitch.lengthMinutes);
  const tracks = withStored(options.tracks, pitch.track);
  const maxCo = Math.max(options.maxCoPresenters, Math.max(0, readPresenters(pitch).length - 1));
  const lead = readPresenters(pitch)[0];
  const edit = (field) => (value) => setForm((current) => ({ ...current, [field]: value }));
  const editRow = (key, patch) => setForm((current) => ({
    ...current, presenters: current.presenters.map((row) => (row.key === key ? { ...row, ...patch } : row)),
  }));
  const choices = (list, none, label = (value) => String(value)) => [{ value: '', label: none }, ...list.map((value) => ({ value: String(value), label: label(value) }))];

  return (
    <form
      className="flex flex-col gap-sm"
      noValidate
      onSubmit={(event) => { event.preventDefault(); if (!busy) onSave(bodyOf(form)); }}
    >
      <fieldset disabled={busy} className="flex flex-col gap-sm">
        <TextField help="Name the session as the proposer intended it to appear in the program." label="Title" required maxLength={160} value={form.title} onChange={edit('title')} />
        <TextField help="Describe the proposed session in one short sentence." label="One-line summary" maxLength={300} value={form.summary} onChange={edit('summary')} />
        <TextAreaField help="Describe the proposed session and what attendees would gain from it." label="Description" required maxLength={5000} rows={6} value={form.description} onChange={edit('description')} />
        <div className="planner-fields grid gap-sm md:grid-cols-2">
          {formats.length ? (
            <SelectField help="Choose how the proposed session will run, such as a panel or workshop." label="Format" value={form.format} onChange={edit('format')} options={choices(formats, 'No format')} />
          ) : (
            <TextField help="Describe how the proposed session will run, such as a panel or workshop." label="Format" maxLength={120} value={form.format} onChange={edit('format')} />
          )}
          {lengths.length ? <SelectField help="Choose how many minutes the proposed session needs." label="Length" value={form.lengthMinutes} onChange={edit('lengthMinutes')} options={choices(lengths, 'No length', (m) => `${m} minutes`)} /> : null}
          {tracks.length ? <SelectField help="Choose the program topic that best fits this proposal." label="Track" value={form.track} onChange={edit('track')} options={choices(tracks, 'No track')} /> : null}
          <SelectField help="Choose who this proposal is intended for." label="Audience" value={form.audienceLevel} onChange={edit('audienceLevel')} options={[{ value: '', label: 'Not given' }, ...AUDIENCE_LEVELS.map((level) => ({ value: level.id, label: level.label }))]} />
        </div>
        <fieldset aria-label={["Lead presenter "].join('').trim()} className="flex flex-col gap-sm border-admin-hairline border-admin-rule-hairline p-sm">
          <legend className="px-3xs text-admin-base font-semibold">Lead presenter <HelpTooltip label="Lead presenter">Record the main contact responsible for this proposal.</HelpTooltip></legend>
          <p className="text-admin-sm text-admin-ink-secondary">Email: {lead?.email || 'Not recorded'}. </p>
          <div className="planner-fields grid gap-sm md:grid-cols-3">
            <TextField data-help-skip="The label directly names the requested detail; no further explanation needed." label="Lead presenter name" required maxLength={120} value={form.leadName} onChange={edit('leadName')} />
            <TextField help="Enter the presenter’s job title, such as reporter or executive director." label="Lead presenter role" maxLength={120} value={form.leadRole} onChange={edit('leadRole')} />
            <TextField data-help-skip="The label directly names the requested detail; no further explanation needed." label="Organization" maxLength={200} value={form.organization} onChange={edit('organization')} />
          </div>
        </fieldset>
        <fieldset aria-label={["Co-presenters (", (form.presenters.length), " of ", (maxCo), ") "].join('').trim()} className="flex flex-col gap-sm">
          <legend className="text-admin-base font-semibold">Co-presenters ({form.presenters.length} of {maxCo}) <HelpTooltip label="Co-presenters">Record the other people who will present alongside the main contact.</HelpTooltip></legend>
          {form.presenters.map((row, index) => (
            <div key={row.key} className="planner-fields grid items-end gap-sm border-admin-hairline border-admin-rule-hairline p-sm md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
              <TextField data-help-skip="The label names this co-presenter’s name, email or organization." label={`Co-presenter ${index + 1} name`} required maxLength={120} value={row.name} onChange={(name) => editRow(row.key, { name })} />
              <TextField data-help-skip="The label names this co-presenter’s name, email or organization." label={`Co-presenter ${index + 1} email`} required type="email" maxLength={254} value={row.email} onChange={(email) => editRow(row.key, { email })} />
              <TextField data-help-skip="The label names this co-presenter’s name, email or organization." label={`Co-presenter ${index + 1} organization`} maxLength={200} value={row.organization} onChange={(organization) => editRow(row.key, { organization })} />
              <TextField help="Enter this co-presenter’s job title, such as reporter or executive director." label={`Co-presenter ${index + 1} role`} maxLength={120} value={row.role} onChange={(role) => editRow(row.key, { role })} />
              <AdminIconControl icon="remove" className={secondaryButtonClass} label={`Remove co-presenter ${index + 1}`} onClick={() => setForm((current) => ({ ...current, presenters: current.presenters.filter((other) => other.key !== row.key) }))} />
            </div>
          ))}
          <div>
            <AddItemButton
              unavailable={form.presenters.length >= Math.min(maxCo, MAX_CO_PRESENTERS)}
              onClick={() => setForm((current) => ({ ...current, presenters: [...current.presenters, { key: `new-${rowCount += 1}`, name: '', email: '', organization: '', role: '' }] }))}
            >
              Add a co-presenter
            </AddItemButton>
          </div>
        </fieldset>
        <div className="planner-fields grid gap-sm md:grid-cols-2">
          <TextAreaField help="Record any support the presenters need to take part in the event." label="Access needs" maxLength={2000} rows={3} value={form.accessNeeds} onChange={edit('accessNeeds')} />
          <TextAreaField help="Keep planning details here for staff reviewing this proposal." label="Notes to the organizers" maxLength={2000} rows={3} value={form.notes} onChange={edit('notes')} />
        </div>
      </fieldset>
      {error ? <Notice tone="error" message={error.message} /> : null}
      <div className="flex flex-wrap gap-xs">
        <button type="submit" className={primaryButtonClass} aria-busy={busy || undefined} aria-disabled={busy || undefined}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      <p className="text-admin-sm text-admin-ink-secondary">The copy the person submitted is kept. Saving sends no email.</p>
    </form>
  );
}
