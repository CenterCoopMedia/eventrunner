// The fields of each speaker profile step (ADR 0008 §3). The page
// (pages/SpeakerProfile.jsx) owns the state, the saves and the step moves;
// this file only draws a step's controls and the review summary.
import SpeakerPhotoField from '../media/SpeakerPhotoField.jsx';
import { inputClass } from '../controlClasses.js';

export const SPEAKER_STEPS = Object.freeze([
  { slug: 'about', title: 'About you' },
  { slug: 'bio', title: 'Bio and photo' },
  { slug: 'links', title: 'Links' },
  { slug: 'logistics', title: 'Logistics' },
  { slug: 'review', title: 'Review' },
]);

const labelClass = 'block font-semibold text-text-primary';
const hintClass = 'mt-3xs text-caption text-text-secondary';

function TextInput({ id, label, value, onChange, hint, inputRef, invalid, describedBy, autoComplete, maxLength }) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      {hint ? <p id={hintId} className={hintClass}>{hint}</p> : null}
      <input
        id={id}
        ref={inputRef}
        className={`mt-2xs ${inputClass}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={[hintId, describedBy].filter(Boolean).join(' ') || undefined}
        autoComplete={autoComplete}
        maxLength={maxLength}
      />
    </div>
  );
}

function TextArea({ id, label, value, onChange, hint, rows = 4, maxLength }) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      {hint ? <p id={hintId} className={hintClass}>{hint}</p> : null}
      <textarea
        id={id}
        rows={rows}
        className={`mt-2xs ${inputClass}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hintId}
        maxLength={maxLength}
      />
    </div>
  );
}

function AboutFields({ form, setField, nameError, nameRef }) {
  const describedBy = nameError ? 'speaker-name-error' : undefined;
  return (
    <>
      <div className="grid gap-lg sm:grid-cols-2">
        <TextInput id="firstName" label="First name" value={form.firstName} onChange={(v) => setField('firstName', v)} inputRef={nameRef} invalid={Boolean(nameError)} describedBy={describedBy} autoComplete="given-name" />
        <TextInput id="lastName" label="Last name" value={form.lastName} onChange={(v) => setField('lastName', v)} invalid={Boolean(nameError)} describedBy={describedBy} autoComplete="family-name" />
      </div>
      {nameError ? <p id="speaker-name-error" role="alert" className="font-data text-caption text-danger">{nameError}</p> : null}
      <TextInput id="pronouns" label="Pronouns (optional)" hint="Shown with your name, for example she/her or they/them." value={form.pronouns} onChange={(v) => setField('pronouns', v)} maxLength={80} />
      <div className="grid gap-lg sm:grid-cols-2">
        <TextInput id="jobTitle" label="Role" value={form.jobTitle} onChange={(v) => setField('jobTitle', v)} autoComplete="organization-title" />
        <TextInput id="organization" label="Organization" value={form.organization} onChange={(v) => setField('organization', v)} autoComplete="organization" />
      </div>
    </>
  );
}

function BioFields({ form, setField, user, speakerId }) {
  return (
    <>
      <TextArea id="bio" label="Biography" hint="A few sentences in the third person, as it should appear on the programme." rows={6} value={form.bio} onChange={(v) => setField('bio', v)} />
      <SpeakerPhotoField user={user} speakerId={speakerId} value={form.headshotPath} onChange={(path) => setField('headshotPath', path)} />
    </>
  );
}

function LinksFields({ form, setSocialRow, addSocialRow, removeSocialRow }) {
  return (
    <fieldset>
      <legend className="font-semibold text-text-primary">Social links</legend>
      <p className={hintClass}>Optional. Each link needs a platform and a handle or full address.</p>
      <div className="mt-xs space-y-xs">
        {form.socialRows.map((row, index) => (
          <div key={index} className="flex flex-wrap items-center gap-xs">
            <label className="sr-only" htmlFor={`social-label-${index}`}>Platform</label>
            <input id={`social-label-${index}`} className={`${inputClass} w-32`} placeholder="Platform, e.g. twitter" value={row.label} onChange={(e) => setSocialRow(index, 'label', e.target.value)} />
            <label className="sr-only" htmlFor={`social-handle-${index}`}>Handle or URL</label>
            <input id={`social-handle-${index}`} className={`${inputClass} flex-1`} placeholder="@you or a full URL" value={row.handle} onChange={(e) => setSocialRow(index, 'handle', e.target.value)} />
            <button type="button" className="touch-target rounded-brand px-sm py-xs font-data text-caption text-text-secondary underline hover:bg-surface-alt" onClick={() => removeSocialRow(index)}>Remove</button>
          </div>
        ))}
      </div>
      <button type="button" className="touch-target mt-xs inline-flex items-center rounded-brand border-hairline border-rule-hairline px-sm py-xs font-data text-caption font-semibold text-text-primary hover:bg-surface-alt" onClick={addSocialRow}>
        + Add another link
      </button>
    </fieldset>
  );
}

function LogisticsFields({ logistics, setLogistics }) {
  return (
    <>
      <p className="border-hairline border-rule-hairline bg-surface px-sm py-xs text-caption text-text-secondary">
        Only the organizers see these answers. They are never on the public programme.
      </p>
      <TextArea id="travel" label="Travel (optional)" hint="How you plan to arrive, and anything the organizers should arrange." value={logistics.travel} onChange={(v) => setLogistics('travel', v)} maxLength={1000} />
      <TextArea id="accessNeeds" label="Access needs (optional)" hint="For example step-free access, a seat on stage, or a quiet room." value={logistics.accessNeeds} onChange={(v) => setLogistics('accessNeeds', v)} maxLength={1000} />
      <TextArea id="avNeeds" label="Audio and video needs (optional)" hint="For example slides from your laptop, a handheld microphone, or captions." value={logistics.avNeeds} onChange={(v) => setLogistics('avNeeds', v)} maxLength={1000} />
    </>
  );
}

function Row({ term, value }) {
  return (
    <div className="grid gap-3xs border-b-hairline border-rule-hairline py-xs sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="font-semibold text-text-primary">{term}</dt>
      <dd className="whitespace-pre-line text-text-secondary [overflow-wrap:anywhere]">{value || 'Not given'}</dd>
    </div>
  );
}

function ReviewSummary({ form, logistics, socialHandles }) {
  const links = Object.entries(socialHandles).map(([label, handle]) => `${label}: ${handle}`).join('\n');
  return (
    <dl aria-label="Your answers">
      <Row term="Name" value={`${form.firstName} ${form.lastName}`.trim()} />
      <Row term="Pronouns" value={form.pronouns} />
      <Row term="Role" value={form.jobTitle} />
      <Row term="Organization" value={form.organization} />
      <Row term="Biography" value={form.bio} />
      <Row term="Photo" value={form.headshotPath ? 'Added' : ''} />
      <Row term="Links" value={links} />
      <Row term="Travel (organizers only)" value={logistics.travel} />
      <Row term="Access needs (organizers only)" value={logistics.accessNeeds} />
      <Row term="Audio and video (organizers only)" value={logistics.avNeeds} />
    </dl>
  );
}

/** The controls of one step. */
export default function SpeakerProfileFields({ slug, ...props }) {
  if (slug === 'about') return <AboutFields {...props} />;
  if (slug === 'bio') return <BioFields {...props} />;
  if (slug === 'links') return <LinksFields {...props} />;
  if (slug === 'logistics') return <LogisticsFields {...props} />;
  return <ReviewSummary {...props} />;
}
