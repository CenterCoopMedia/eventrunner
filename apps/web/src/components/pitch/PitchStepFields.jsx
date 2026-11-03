// The fields of each pitch step, and the Review step's summary (ADR 0008
// §2). The page (pages/SessionPitch.jsx) owns the draft, the checks and the
// moves between steps; this file only draws a step's fields from the draft
// and the errors it is given, so each step reads the same way.
//
// A choice field shows only when staff set its list on the call
// (config/pitch_call.formOptions). With no format list, Format stays the
// free-text field the one-page form had.
import { Link } from 'react-router';
import { AUDIENCE_LEVELS } from 'shared/pitchForm';
import { SelectField, TextAreaField, TextField } from '../forms/publicForm.jsx';
import { Checkbox } from '../forms/Choice.jsx';
import Repeater from '../forms/Repeater.jsx';
import { newRowId } from '../../lib/pitchDraft.js';

export const PITCH_STEPS = Object.freeze([
  Object.freeze({ slug: 'session', title: 'Your session' }),
  Object.freeze({ slug: 'format', title: 'Format' }),
  Object.freeze({ slug: 'presenters', title: 'Presenters' }),
  Object.freeze({ slug: 'access', title: 'Access and notes' }),
  Object.freeze({ slug: 'review', title: 'Review and submit' }),
]);

const choice = (list, none) => [{ value: '', label: none }, ...list];

function SessionFields({ draft, edit, errors }) {
  return (
    <>
      <TextField label="Session title" required maxLength={160} value={draft.title} onChange={edit('title')} error={errors.title} />
      <TextField label="One-line summary (optional)" maxLength={300} value={draft.summary} onChange={edit('summary')} error={errors.summary} hint="One sentence the organizers can read at a glance." />
      <TextAreaField label="Session description" required maxLength={5000} rows={8} value={draft.description} onChange={edit('description')} error={errors.description} hint="Describe the topic, who it is for, what people will learn, and how you will involve them." />
    </>
  );
}

function FormatFields({ draft, edit, errors, options }) {
  return (
    <>
      {options.formats.length ? (
        <SelectField label="Format" value={draft.format} onChange={edit('format')} error={errors.format} options={choice(options.formats.map((label) => ({ value: label, label })), 'Choose a format')} />
      ) : (
        <TextField label="Format (optional)" maxLength={120} value={draft.format} onChange={edit('format')} error={errors.format} hint="For example, panel or workshop." />
      )}
      {options.lengths.length ? (
        <SelectField label="Length" value={String(draft.lengthMinutes)} onChange={(value) => edit('lengthMinutes')(value === '' ? '' : Number(value))} error={errors.lengthMinutes} options={choice(options.lengths.map((minutes) => ({ value: String(minutes), label: `${minutes} minutes` })), 'Choose a length')} />
      ) : null}
      {options.tracks.length ? (
        <SelectField label="Track" value={draft.track} onChange={edit('track')} error={errors.track} options={choice(options.tracks.map((label) => ({ value: label, label })), 'Choose a track')} />
      ) : null}
      <SelectField label="Who is it for? (optional)" value={draft.audienceLevel} onChange={edit('audienceLevel')} error={errors.audienceLevel} options={choice(AUDIENCE_LEVELS.map((level) => ({ value: level.id, label: level.label })), 'Not sure yet')} />
    </>
  );
}

function PresenterFields({ draft, edit, errors, options, email }) {
  const update = (id, patch) => edit('presenters')(draft.presenters.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <>
      <fieldset className="space-y-md border-hairline border-rule-hairline p-md">
        <legend className="px-2xs font-semibold">You, the lead presenter</legend>
        <p className="text-caption text-text-secondary">
          {email ? `The organizers contact you at ${email}, the address you signed in with.` : 'The organizers contact you at the address you sign in with on the last step.'}
        </p>
        <TextField label="Your name" required maxLength={120} autoComplete="name" value={draft.leadName} onChange={edit('leadName')} error={errors.leadName} />
        <div className="grid gap-md sm:grid-cols-2">
          <TextField label="Your role (optional)" maxLength={120} autoComplete="organization-title" value={draft.leadRole} onChange={edit('leadRole')} error={errors.leadRole} hint="For example, reporter or executive director." />
          <TextField label="Your organization (optional)" maxLength={200} autoComplete="organization" value={draft.organization} onChange={edit('organization')} error={errors.organization} />
        </div>
      </fieldset>
      {options.maxCoPresenters > 0 ? (
        <>
          <p className="text-caption text-text-secondary">Co-presenters get no email now. If the organizers accept the pitch, each one is invited to the event.</p>
          {errors.presenters ? <p className="text-caption text-danger">{errors.presenters}</p> : null}
          <Repeater
            legend="Co-presenters (optional)"
            rowName="co-presenter"
            max={options.maxCoPresenters}
            addLabel="Add a co-presenter"
            emptyLine="No co-presenters yet."
            rows={draft.presenters}
            onAdd={() => edit('presenters')([...draft.presenters, { id: newRowId(), name: '', email: '', organization: '', role: '' }])}
            onRemove={(id) => edit('presenters')(draft.presenters.filter((row) => row.id !== id))}
            renderRow={(row, index) => (
              <div className="grid gap-md sm:grid-cols-2">
                <TextField label={`Co-presenter ${index + 1} name`} required maxLength={120} value={row.name} onChange={(name) => update(row.id, { name })} error={errors[`presenters.${index}.name`]} />
                <TextField label={`Co-presenter ${index + 1} email`} required type="email" maxLength={254} value={row.email} onChange={(value) => update(row.id, { email: value })} error={errors[`presenters.${index}.email`]} />
                <TextField label={`Co-presenter ${index + 1} organization (optional)`} maxLength={200} value={row.organization} onChange={(organization) => update(row.id, { organization })} />
                <TextField label={`Co-presenter ${index + 1} role (optional)`} maxLength={120} value={row.role} onChange={(role) => update(row.id, { role })} />
              </div>
            )}
          />
        </>
      ) : null}
    </>
  );
}

function AccessFields({ draft, edit, errors }) {
  return (
    <>
      <TextAreaField label="Access needs (optional)" maxLength={2000} rows={4} value={draft.accessNeeds} onChange={edit('accessNeeds')} error={errors.accessNeeds} hint="For example, a step-free stage, captions, or a seat on the panel. Only the organizers see this." />
      <TextAreaField label="Notes to the organizers (optional)" maxLength={2000} rows={4} value={draft.notes} onChange={edit('notes')} error={errors.notes} hint="Anything else the organizers should know, such as days you cannot attend." />
    </>
  );
}

function Answer({ term, value }) {
  return (
    <div className="grid gap-3xs sm:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)]">
      <dt className="font-semibold">{term}</dt>
      <dd className="whitespace-pre-wrap break-words text-text-secondary">{value || 'Not given'}</dd>
    </div>
  );
}

function ReviewGroup({ step, hrefFor, children }) {
  return (
    <section className="space-y-sm border-t-hairline border-rule-hairline pt-sm" aria-labelledby={`pitch-review-${step.slug}`}>
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h3 id={`pitch-review-${step.slug}`} className="font-heading text-h3 font-semibold">{step.title}</h3>
        <Link to={hrefFor(step)} className="underline underline-offset-2">Edit<span className="sr-only"> {step.title.toLowerCase()}</span></Link>
      </div>
      <dl className="space-y-xs">{children}</dl>
    </section>
  );
}

function ReviewFields({ draft, edit, errors, options, hrefFor, email }) {
  const [session, format, presenters, access] = PITCH_STEPS;
  const level = AUDIENCE_LEVELS.find((entry) => entry.id === draft.audienceLevel)?.label;
  return (
    <>
      <ReviewGroup step={session} hrefFor={hrefFor}>
        <Answer term="Title" value={draft.title} />
        <Answer term="Summary" value={draft.summary} />
        <Answer term="Description" value={draft.description} />
      </ReviewGroup>
      <ReviewGroup step={format} hrefFor={hrefFor}>
        <Answer term="Format" value={draft.format} />
        {options.lengths.length ? <Answer term="Length" value={draft.lengthMinutes ? `${draft.lengthMinutes} minutes` : ''} /> : null}
        {options.tracks.length ? <Answer term="Track" value={draft.track} /> : null}
        <Answer term="Who it is for" value={level} />
      </ReviewGroup>
      <ReviewGroup step={presenters} hrefFor={hrefFor}>
        <Answer term="Lead presenter" value={[draft.leadName, draft.leadRole, draft.organization, email].filter(Boolean).join(' · ')} />
        {draft.presenters.map((row, index) => (
          <Answer key={row.id} term={`Co-presenter ${index + 1}`} value={[row.name, row.role, row.organization, row.email].filter(Boolean).join(' · ')} />
        ))}
      </ReviewGroup>
      <ReviewGroup step={access} hrefFor={hrefFor}>
        <Answer term="Access needs" value={draft.accessNeeds} />
        <Answer term="Notes" value={draft.notes} />
      </ReviewGroup>
      <Checkbox
        checked={draft.consent}
        onChange={(event) => edit('consent')(event.target.checked)}
        required
        error={errors.consent}
        label="I agree that organizers may store my pitch and sign-in email to review this proposal and contact me about it."
        description="Your proposal stays private until staff explicitly create, edit, and publish event content."
      />
    </>
  );
}

const BODIES = Object.freeze({
  session: SessionFields,
  format: FormatFields,
  presenters: PresenterFields,
  access: AccessFields,
  review: ReviewFields,
});

/**
 * One step's fields.
 *
 * @param {{ slug: string, draft: object, edit: (field: string) => (value: unknown) => void,
 *   errors: Record<string, string>, options: object, hrefFor: (step: object) => string,
 *   email: string|null }} props
 */
export default function PitchStepFields({ slug, ...props }) {
  const Body = BODIES[slug];
  return Body ? <Body {...props} /> : null;
}
