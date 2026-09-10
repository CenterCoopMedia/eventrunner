// The eight steps, in each of the four roles.
//
// Each line is set at the step it names, in the role it names, and states
// the family that role resolves to right now. Change the site style in the
// demo banner and every family line changes with it, which is the fact this
// section exists to show: a component asks for a role, and the style
// decides the face.
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { useLiveToken } from '../useLiveToken.js';
import { TYPE_ROLES, TYPE_STEPS } from '../tokens.js';
import { EXAMPLE_SESSIONS } from '../exampleContent.js';
import { eventConfig } from '@generated/eventConfig.js';
import { scheduleData } from '@generated/scheduleData.js';

// Written out rather than assembled, because the build scans for whole
// class names (components/editorial/purge.test.js).
const STEP_CLASS = Object.freeze({
  nameplate: 'text-nameplate',
  h1: 'text-h1',
  h2: 'text-h2',
  h3: 'text-h3',
  lead: 'text-lead',
  body: 'text-body',
  caption: 'text-caption',
  folio: 'text-folio',
});

const ROLE_CLASS = Object.freeze({
  heading: 'font-heading',
  body: 'font-body',
  data: 'font-data',
  mono: 'font-mono',
});

// Eight lines of real copy, one per step. The event's own where the event
// has it: the sessions where the snapshot holds three, and the address
// where the venue states one. A configuration is valid with none of that.
const LINE_SESSIONS = scheduleData.length > 2 ? scheduleData : EXAMPLE_SESSIONS;
const PLACE_LINE = [eventConfig.venue?.name, eventConfig.venue?.city].filter(Boolean).join(', ');

/** Real copy, one line per step, from the seeded event. */
const SPECIMEN_LINES = Object.freeze([
  eventConfig.shortName,
  eventConfig.name,
  LINE_SESSIONS[0].title,
  LINE_SESSIONS[1].title,
  eventConfig.tagline,
  LINE_SESSIONS[2].description,
  PLACE_LINE || LINE_SESSIONS[0].location,
  `${eventConfig.days.length} days · ${scheduleData.length} sessions`,
].filter(Boolean));

function RoleSpecimen({ role, label, job }) {
  const family = useLiveToken(`--font-${role}`);

  return (
    <Figure
      name={`${label} role`}
      file="tailwind.config.js"
      contract={null}
      note={job}
    >
      <p className="font-data text-caption text-text-secondary">
        Resolves to{' '}
        <span className="break-words font-mono">
          {family || 'a family this document does not state'}
        </span>
      </p>
      <dl className="mt-sm">
        {TYPE_STEPS.map((entry, index) => (
          <div
            key={entry.step}
            className="mt-sm grid gap-x-md gap-y-3xs border-t-hairline border-t-rule-hairline pt-sm sm:grid-cols-[10rem,1fr]"
          >
            <dt className="font-data text-caption text-text-secondary">
              {entry.label}
              {/* The token on its own line: the two together wrap inside a
                  10rem column and break the step name in half. */}
              <span className="block font-mono">--text-{entry.step}</span>
            </dt>
            <dd className={`${ROLE_CLASS[role]} ${STEP_CLASS[entry.step]} text-text-primary`}>
              {SPECIMEN_LINES[index]}
            </dd>
          </div>
        ))}
      </dl>
    </Figure>
  );
}

export default function TypeSection({ folio }) {
  return (
    <SpecimenSection
      id="specimen-type"
      title="Type"
      folio={folio}
      standfirst="Eight steps carry the whole scale, and each of the four roles sets all eight."
    >
      {TYPE_ROLES.map((entry) => (
        <RoleSpecimen key={entry.role} role={entry.role} label={entry.label} job={entry.job} />
      ))}
    </SpecimenSection>
  );
}
