// A pitch's answers in the review panel (ADR 0008 §2): every step of the
// pitch stepper, the presenters with the lead first, and the private access
// needs and notes. A pitch stored before the stepper reads as one lead
// presenter (shared/pitchForm readPresenters), so this one view fits both.
import { AUDIENCE_LEVELS, readPresenters } from 'shared/pitchForm';

const NOT_GIVEN = 'Not given';
const levelLabel = (id) => AUDIENCE_LEVELS.find((level) => level.id === id)?.label ?? id;

function Row({ term, children }) {
  return (
    <div className="grid gap-3xs sm:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)]">
      <dt className="text-admin-sm font-semibold text-admin-ink">{term}</dt>
      <dd className="whitespace-pre-wrap break-words text-admin-sm text-admin-ink">{children || NOT_GIVEN}</dd>
    </div>
  );
}

/** @param {{ pitch: object }} props a session_pitches document */
export default function PitchDetails({ pitch }) {
  const presenters = readPresenters(pitch);
  return (
    <div className="space-y-sm">
      {pitch.summary ? <p className="text-admin-base font-semibold text-admin-ink">{pitch.summary}</p> : null}
      <p className="whitespace-pre-wrap break-words">{pitch.description}</p>
      <dl className="space-y-xs">
        <Row term="Format">{pitch.format}</Row>
        <Row term="Length">{pitch.lengthMinutes ? `${pitch.lengthMinutes} minutes` : null}</Row>
        <Row term="Track">{pitch.track}</Row>
        <Row term="Audience">{pitch.audienceLevel ? levelLabel(pitch.audienceLevel) : null}</Row>
        <Row term="Organization">{pitch.organization}</Row>
        <Row term={presenters.length === 1 ? 'Presenter' : `Presenters (${presenters.length})`}>
          <ul className="space-y-3xs">
            {presenters.map((person, index) => (
              <li key={`${person.email ?? 'lead'}-${index}`}>
                {[person.name || (person.lead ? 'The person who pitched' : null), person.email, person.role, person.organization]
                  .filter(Boolean).join(' · ')}
                {person.lead ? ' (lead)' : ''}
              </li>
            ))}
          </ul>
        </Row>
        <Row term="Access needs">{pitch.accessNeeds}</Row>
        <Row term="Notes to the organizers">{pitch.notes}</Row>
      </dl>
    </div>
  );
}
